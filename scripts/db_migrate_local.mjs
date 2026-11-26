/**
 * 《微风垂钓物语 2.0》本地 SQLite 迁移与种子脚本 (scripts/db_migrate_local.mjs)
 * ----------------------------------------------------------------------------
 * 用法：
 *   node scripts/db_migrate_local.mjs
 *   node scripts/db_migrate_local.mjs --db=:memory:
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../backend/config/env.mjs';
import { openSqliteDatabase, applySqliteMigrations } from '../backend/repositories/sqlite/adapter.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function parseDbArg(argv) {
  for (const arg of argv) {
    if (arg.startsWith('--db=')) {
      return arg.slice('--db='.length);
    }
  }
  return null;
}

const config = loadConfig({ cwd: ROOT_DIR });
const targetDb = parseDbArg(process.argv.slice(2)) || config.sqliteDbPath;
const resolvedTarget = targetDb === ':memory:' ? ':memory:' : path.resolve(ROOT_DIR, targetDb);

const db = openSqliteDatabase(resolvedTarget);
try {
  const result = applySqliteMigrations(
    db,
    path.join(ROOT_DIR, 'db', 'migrations', 'sqlite'),
    path.join(ROOT_DIR, 'db', 'seeds')
  );
  console.log(JSON.stringify({
    ok: true,
    db: targetDb,
    newlyAppliedMigrations: result.newlyApplied,
    appliedSeeds: result.appliedSeeds,
    tableCount: result.tables.length,
    tables: result.tables
  }, null, 2));
} finally {
  db.close();
}
