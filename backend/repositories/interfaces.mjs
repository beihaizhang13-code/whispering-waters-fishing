/**
 * 《微风垂钓物语 2.0》数据仓储抽象接口契约 (backend/repositories/interfaces.mjs)
 * ----------------------------------------------------------------------------
 * 领域服务仅依赖此契约，不感知底层是本地 node:sqlite 还是线上 Netlify Postgres。
 *
 * @typedef {Object} Repositories
 * @property {string} driver - 'sqlite' | 'postgres'
 * @property {() => Promise<{ok: boolean, driver: string, details?: Object}>} healthCheck
 * @property {() => Promise<void>} close
 * @property {Object} users - 账号、身份凭据与会话管理仓储
 * @property {Object} saves - 云存档快照与乐观锁仓储
 * @property {Object} economy - 捕鱼审计与经济账本仓储
 * @property {Object} leaderboards - 排行榜读写仓储
 * @property {Object} worldEvents - 全服祈愿事件仓储
 * @property {Object} social - 成就与水族箱分享仓储
 */

export const REPOSITORY_DOMAINS = Object.freeze([
  'users',
  'saves',
  'economy',
  'leaderboards',
  'worldEvents',
  'social'
]);

export function createNotImplementedRepoProxy(driver, domainName) {
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') return undefined;
      return async () => {
        const err = new Error(`Repository[${driver}].${domainName}.${String(prop)} 尚未实现 (将在 M1/M2/M3 接入)`);
        err.code = 'NOT_IMPLEMENTED';
        err.status = 501;
        throw err;
      };
    }
  });
}
