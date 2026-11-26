/**
 * 《微风垂钓物语 2.0》全项目工程完整性自检脚本 (scripts/verify.mjs)
 * ----------------------------------------------------------------------------
 * 校验项：
 * 1. 核心架构文件、共享契约、数据库迁移、Netlify 配置与工程文档完整性；
 * 2. 全仓所有 .js / .mjs 脚本执行 `node --check` 语法检查；
 * 3. `dist/` 发布目录与源码文件 SHA-256 哈希严格同步；
 * 4. 内存 SQLite 建表与种子执行验证（12 张核心业务表 + 12 条初始成就）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openSqliteDatabase, applySqliteMigrations } from '../backend/repositories/sqlite/adapter.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const REQUIRED_PATHS = [
  'package.json',
  '.env.example',
  '.editorconfig',
  '.gitignore',
  'manifest.webmanifest',
  'netlify.toml',
  'server.js',
  'index.html',
  'README.md',
  'archive/cozy_fishing_game.html',
  '.github/PULL_REQUEST_TEMPLATE.md',
  'shared/game_catalog.js',
  'shared/save_schema.js',
  'shared/world_clock.js',
  'shared/error_codes.js',
  'db/migrations/sqlite/0001_initial_schema.sql',
  'db/migrations/postgres/20261126000100_initial_schema.sql',
  'db/seeds/0001_achievements_and_world.sql',
  'netlify/database/README.md',
  'netlify/functions/api.mjs',
  'backend/config/env.mjs',
  'backend/observability/logger.mjs',
  'backend/http/response.mjs',
  'backend/http/middleware.mjs',
  'backend/http/router.mjs',
  'backend/auth/auth_service.mjs',
  'backend/domain/save_merge_service.mjs',
  'backend/domain/aquarium_service.mjs',
  'backend/domain/economy_validator.mjs',
  'backend/domain/leaderboard_service.mjs',
  'backend/domain/world_event_service.mjs',
  'backend/domain/social_service.mjs',
  'backend/repositories/interfaces.mjs',
  'backend/repositories/factory.mjs',
  'backend/repositories/sqlite/adapter.mjs',
  'backend/repositories/postgres/adapter.mjs',
  'js/api_client.js',
  'js/cloud_sync.js',
  'scripts/build.mjs',
  'scripts/db_migrate_local.mjs',
  'scripts/verify.mjs',
  'docs/README.md',
  'docs/01-architecture.md',
  'docs/02-domain-and-anticheat.md',
  'docs/03-database-schema.md',
  'docs/04-api-contract.md',
  'docs/05-security-and-compliance.md',
  'docs/06-devops-and-runbook.md',
  'docs/07-roadmap.md'
];

const EXPECTED_CORE_TABLES = [
  'users',
  'auth_identities',
  'sessions',
  'player_saves',
  'catch_logs',
  'economy_ledger',
  'leaderboard_records',
  'world_events',
  'achievement_definitions',
  'user_achievements',
  'aquarium_shares',
  'audit_security_events'
];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function collectJsFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectJsFiles(full, out);
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
      out.push(full);
    }
  }
  return out;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function collectRelativeFiles(baseDir, prefix = '', out = []) {
  for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      collectRelativeFiles(full, rel, out);
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out.sort();
}

function verifyRequiredPaths() {
  const missing = REQUIRED_PATHS.filter(rel => !fs.existsSync(path.join(ROOT_DIR, rel)));
  assert(missing.length === 0, `缺少必要项目文件: ${missing.join(', ')}`);
  assert(!fs.existsSync(path.join(ROOT_DIR, 'cozy_fishing_game.html')), '根目录仍存在未归档的 cozy_fishing_game.html');
}

function verifyJsSyntax() {
  const files = [
    path.join(ROOT_DIR, 'server.js'),
    ...collectJsFiles(path.join(ROOT_DIR, 'js')),
    ...collectJsFiles(path.join(ROOT_DIR, 'shared')),
    ...collectJsFiles(path.join(ROOT_DIR, 'backend')),
    ...collectJsFiles(path.join(ROOT_DIR, 'netlify')),
    ...collectJsFiles(path.join(ROOT_DIR, 'scripts')),
    ...collectJsFiles(path.join(ROOT_DIR, 'tests'))
  ];
  for (const file of files) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }
  return files.length;
}

function verifyDistSync() {
  const distDir = path.join(ROOT_DIR, 'dist');
  assert(fs.existsSync(distDir), 'dist/ 目录不存在，请先运行 node scripts/build.mjs');

  const expectedPairs = [
    ['index.html', 'dist/index.html'],
    ['manifest.webmanifest', 'dist/manifest.webmanifest']
  ];
  for (const dirName of ['css', 'js', 'shared']) {
    const srcDir = path.join(ROOT_DIR, dirName);
    for (const rel of collectRelativeFiles(srcDir)) {
      expectedPairs.push([`${dirName}/${rel}`, `dist/${dirName}/${rel}`]);
    }
  }

  for (const [srcRel, distRel] of expectedPairs) {
    const srcPath = path.join(ROOT_DIR, srcRel);
    const distPath = path.join(ROOT_DIR, distRel);
    assert(fs.existsSync(distPath), `dist 缺少同步产物: ${distRel}`);
    assert(sha256File(srcPath) === sha256File(distPath), `dist 产物与源码不一致: ${distRel}`);
  }
  return expectedPairs.length;
}

function verifySqliteMigration() {
  const db = openSqliteDatabase(':memory:');
  try {
    const res = applySqliteMigrations(
      db,
      path.join(ROOT_DIR, 'db', 'migrations', 'sqlite'),
      path.join(ROOT_DIR, 'db', 'seeds')
    );
    for (const tableName of EXPECTED_CORE_TABLES) {
      assert(res.tables.includes(tableName), `SQLite 迁移后缺少核心表: ${tableName}`);
    }
    const row = db.prepare('SELECT COUNT(*) AS count FROM achievement_definitions').get();
    assert(row && row.count === 12, `期望成就种子为 12 条，实际为 ${row?.count}`);
    return { tables: res.tables.length, achievements: row.count };
  } finally {
    db.close();
  }
}

verifyRequiredPaths();
const checkedJsCount = verifyJsSyntax();
const syncedDistCount = verifyDistSync();
const dbSummary = verifySqliteMigration();

console.log(JSON.stringify({
  ok: true,
  requiredPaths: REQUIRED_PATHS.length,
  syntaxCheckedJsFiles: checkedJsCount,
  syncedDistFiles: syncedDistCount,
  sqliteTablesVerified: dbSummary.tables,
  achievementSeedsVerified: dbSummary.achievements
}, null, 2));
