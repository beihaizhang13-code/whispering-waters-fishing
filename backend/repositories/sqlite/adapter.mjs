/**
 * 《微风垂钓物语 2.0》本地 Node 24 SQLite 存储适配器 (backend/repositories/sqlite/adapter.mjs)
 * ----------------------------------------------------------------------------
 * 使用 Node.js v24 内置 node:sqlite (零外部依赖)，作为线上 PostgreSQL 的本地开发镜像。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_MIGRATIONS_DIR, DEFAULT_SEEDS_DIR } from './helpers.mjs';
import { createSqliteUsersAndSavesRepos } from './users_saves_repo.mjs';
import { createSqliteEconomyRepo } from './economy_repo.mjs';
import { createSqliteAquariumAndWorldRepo } from './aquarium_world_repo.mjs';
import { createSqliteSocialAndLeaderboardRepos } from './social_leaderboard_repo.mjs';

export function openSqliteDatabase(dbPath = './data/whispering_waters.sqlite') {
  if (dbPath !== ':memory:') {
    const absDir = path.dirname(path.resolve(dbPath));
    fs.mkdirSync(absDir, { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  return db;
}

export function applySqliteMigrations(db, migrationsDir, seedsDir = null) {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all();
  const appliedSet = new Set(appliedRows.map(r => r.version));

  const migrationFiles = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
    : [];

  const newlyApplied = [];
  for (const file of migrationFiles) {
    if (appliedSet.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    db.exec('BEGIN;');
    try {
      db.exec(sql);
      db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(file);
      db.exec('COMMIT;');
      newlyApplied.push(file);
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }

  const appliedSeeds = [];
  if (seedsDir && fs.existsSync(seedsDir)) {
    const seedFiles = fs.readdirSync(seedsDir).filter(f => f.endsWith('.sql')).sort();
    for (const seedFile of seedFiles) {
      const seedSql = fs.readFileSync(path.join(seedsDir, seedFile), 'utf8');
      db.exec('BEGIN;');
      try {
        db.exec(seedSql);
        db.exec('COMMIT;');
        appliedSeeds.push(seedFile);
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }
    }
  }

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map(r => r.name);

  return { newlyApplied, appliedSeeds, tables };
}

export function getSqliteHealth(db) {
  const ping = db.prepare('SELECT 1 AS ok').get();
  const tables = db
    .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .get();
  return {
    ok: ping?.ok === 1,
    driver: 'sqlite',
    details: { tableCount: tables?.count || 0 }
  };
}

export function createSqliteRepositories(config) {
  let db = null;

  function ensureDb() {
    if (!db) {
      db = openSqliteDatabase(config.sqliteDbPath);
      const hasUsersTable = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'")
        .get();
      if (!hasUsersTable) {
        applySqliteMigrations(db, DEFAULT_MIGRATIONS_DIR, DEFAULT_SEEDS_DIR);
      }
    }
    return db;
  }

  const { users, saves } = createSqliteUsersAndSavesRepos(ensureDb);
  const economy = createSqliteEconomyRepo(ensureDb);
  const { worldEvents, aquariumHelpers } = createSqliteAquariumAndWorldRepo(ensureDb);
  const { leaderboards, social } = createSqliteSocialAndLeaderboardRepos(ensureDb);

  return {
    driver: 'sqlite',
    async healthCheck() {
      try {
        const instance = ensureDb();
        return getSqliteHealth(instance);
      } catch (err) {
        return { ok: false, driver: 'sqlite', details: { error: err.message } };
      }
    },
    async close() {
      if (db) {
        db.close();
        db = null;
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
