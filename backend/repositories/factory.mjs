/**
 * 《微风垂钓物语 2.0》数据仓储工厂 (backend/repositories/factory.mjs)
 */
import { createSqliteRepositories } from './sqlite/adapter.mjs';
import { createPostgresRepositories } from './postgres/adapter.mjs';

export function createRepositories(config, deps = {}) {
  if (config.storageDriver === 'postgres') {
    return createPostgresRepositories(config, deps);
  }
  return createSqliteRepositories(config);
}
