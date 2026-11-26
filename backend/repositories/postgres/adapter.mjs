/**
 * 《微风垂钓物语 2.0》生产 Netlify Postgres 存储适配器 (backend/repositories/postgres/adapter.mjs)
 * ----------------------------------------------------------------------------
 * 设计说明：
 * - 运行时按需动态导入 `@netlify/database` (`getDatabase({ connectionString })`)，避免未安装依赖时阻断本地构建。
 * - 支持通过 `deps.db` 或 `config.postgresDb` 注入兼容 Postgres 客户端（具备 `pool`/`query`/`sql` 接口），便于自动化集成测试。
 */
import { createDomainError } from './helpers.mjs';
import { createPostgresUsersAndSavesRepos } from './users_saves_repo.mjs';
import { createPostgresEconomyRepo } from './economy_repo.mjs';
import { createPostgresAquariumAndWorldRepo } from './aquarium_world_repo.mjs';
import { createPostgresSocialAndLeaderboardRepos } from './social_leaderboard_repo.mjs';

async function loadNetlifyDatabaseClient(connectionString) {
  const pkgName = '@netlify/database';
  try {
    const mod = await import(pkgName);
    if (typeof mod.getDatabase === 'function') {
      return connectionString
        ? mod.getDatabase({ connectionString })
        : mod.getDatabase();
    }
    throw new Error('@netlify/database 未导出 getDatabase');
  } catch (err) {
    const wrapped = new Error(`Postgres 适配器依赖 @netlify/database，当前尚未安装或未初始化: ${err.message}`);
    wrapped.code = 'NOT_IMPLEMENTED';
    wrapped.status = 501;
    throw wrapped;
  }
}

function invokeTaggedSql(sqlFn, sqlText, params = []) {
  if (!Array.isArray(params) || params.length === 0) {
    const strings = Object.assign([sqlText], { raw: [sqlText] });
    return sqlFn(strings);
  }
  const strings = [];
  const values = [];
  const re = /\$(\d+)/g;
  let lastIndex = 0;
  let match;
  while ((match = re.exec(sqlText)) !== null) {
    const paramIndex = Number(match[1]) - 1;
    strings.push(sqlText.slice(lastIndex, match.index));
    values.push(params[paramIndex]);
    lastIndex = match.index + match[0].length;
  }
  strings.push(sqlText.slice(lastIndex));
  Object.defineProperty(strings, 'raw', { value: strings.slice() });
  return sqlFn(strings, ...values);
}

function normalizeToPgPool(rawDb) {
  if (!rawDb) {
    throw createDomainError('SERVICE_UNAVAILABLE', 'Postgres 客户端实例为空', 503);
  }

  const candidatePool = rawDb.pool && typeof rawDb.pool.query === 'function'
    ? rawDb.pool
    : rawDb;

  if (typeof candidatePool.query === 'function') {
    const query = (sql, params = []) => candidatePool.query(sql, params);
    const connect = typeof candidatePool.connect === 'function'
      ? () => candidatePool.connect()
      : async () => ({
          query,
          release() {}
        });
    const end = typeof candidatePool.end === 'function'
      ? () => candidatePool.end()
      : (typeof rawDb.end === 'function' ? () => rawDb.end() : async () => {});

    return { query, connect, end };
  }

  if (rawDb.sql && typeof rawDb.sql.query === 'function') {
    const query = (sql, params = []) => rawDb.sql.query(sql, params);
    const end = typeof rawDb.end === 'function' ? () => rawDb.end() : async () => {};
    return {
      query,
      async connect() {
        return { query, release() {} };
      },
      end
    };
  }

  if (typeof rawDb.sql === 'function') {
    const query = (sql, params = []) => invokeTaggedSql(rawDb.sql, sql, params);
    const end = typeof rawDb.end === 'function' ? () => rawDb.end() : async () => {};
    return {
      query,
      async connect() {
        return { query, release() {} };
      },
      end
    };
  }

  throw createDomainError('INTERNAL_ERROR', '无效的 Postgres 客户端：缺少 pool、query 或 sql 接口', 500);
}

export function createPostgresRepositories(config = {}, deps = {}) {
  const injectedDb = deps?.db ?? config?.postgresDb ?? null;
  let poolPromise = null;
  let ownedPool = null;

  async function getPool() {
    if (poolPromise) return poolPromise;
    poolPromise = (async () => {
      if (injectedDb) {
        return normalizeToPgPool(injectedDb);
      }
      if (!config?.netlifyDbUrl && config?.runtime !== 'netlify-functions') {
        throw createDomainError('SERVICE_UNAVAILABLE', 'NETLIFY_DB_URL 未配置，无法连接 PostgreSQL', 503);
      }
      const db = await loadNetlifyDatabaseClient(config?.netlifyDbUrl || '');
      const normalized = normalizeToPgPool(db);
      ownedPool = normalized;
      return normalized;
    })();
    try {
      return await poolPromise;
    } catch (err) {
      poolPromise = null;
      throw err;
    }
  }

  const { users, saves } = createPostgresUsersAndSavesRepos(getPool);
  const economy = createPostgresEconomyRepo(getPool);
  const { worldEvents, aquariumHelpers } = createPostgresAquariumAndWorldRepo(getPool);
  const { leaderboards, social } = createPostgresSocialAndLeaderboardRepos(getPool);

  return {
    driver: 'postgres',
    async healthCheck() {
      if (!injectedDb && !config?.netlifyDbUrl && config?.runtime !== 'netlify-functions') {
        return {
          ok: false,
          driver: 'postgres',
          details: { configured: false, message: 'NETLIFY_DB_URL 未配置' }
        };
      }
      try {
        const pool = await getPool();
        const pingRes = await pool.query('SELECT 1 AS ok');
        const pingOk = Number(pingRes?.rows?.[0]?.ok) === 1;
        const tablesRes = await pool.query(`
          SELECT COUNT(*) AS count
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        `);
        const tableCount = Number(tablesRes?.rows?.[0]?.count || 0);
        return {
          ok: pingOk,
          driver: 'postgres',
          details: {
            configured: true,
            injected: Boolean(injectedDb),
            tableCount
          }
        };
      } catch (err) {
        return {
          ok: false,
          driver: 'postgres',
          details: {
            configured: Boolean(injectedDb || config?.netlifyDbUrl),
            error: err.message
          }
        };
      }
    },
    async close() {
      const toClose = ownedPool;
      ownedPool = null;
      poolPromise = null;
      if (toClose && typeof toClose.end === 'function') {
        await toClose.end();
      }
    },
    users,
    saves,
    economy,
    leaderboards,
    worldEvents,
    aquariumHelpers,
    social
  };
}
