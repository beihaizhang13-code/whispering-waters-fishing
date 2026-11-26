import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { openSqliteDatabase, applySqliteMigrations } from '../../backend/repositories/sqlite/adapter.mjs';

const require = createRequire(import.meta.url);
const { createAppServer } = require('../../server.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');

test('SQLite 迁移与种子可幂等执行且外键与唯一约束正常生效', () => {
  const db = openSqliteDatabase(':memory:');
  try {
    const migrationsDir = path.join(ROOT_DIR, 'db', 'migrations', 'sqlite');
    const seedsDir = path.join(ROOT_DIR, 'db', 'seeds');

    const first = applySqliteMigrations(db, migrationsDir, seedsDir);
    assert.equal(first.newlyApplied.length, 1);
    assert.equal(first.appliedSeeds.length, 1);

    const expectedTables = [
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
    for (const tbl of expectedTables) {
      assert.ok(first.tables.includes(tbl), `缺少表 ${tbl}`);
    }

    // 二次执行幂等性检查
    const second = applySqliteMigrations(db, migrationsDir, seedsDir);
    assert.equal(second.newlyApplied.length, 0);
    const achCount = db.prepare('SELECT COUNT(*) AS c FROM achievement_definitions').get();
    assert.equal(achCount.c, 12);

    // 验证外键约束生效（插入不存在的 user_id 必须抛错）
    assert.throws(() => {
      db.prepare("INSERT INTO player_saves (user_id, save_payload, payload_checksum) VALUES ('nonexistent', '{}', 'abc')").run();
    });

    // 验证唯一约束生效
    db.prepare("INSERT INTO users (id, account_type, display_name) VALUES ('u1', 'guest', '渔夫一号')").run();
    db.prepare("INSERT INTO economy_ledger (user_id, idempotency_key, event_type, coins_delta, luck_delta, coins_after, luck_after) VALUES ('u1', 'k1', 'catch_sell', 15, 0, 95, 0)").run();
    assert.throws(() => {
      db.prepare("INSERT INTO economy_ledger (user_id, idempotency_key, event_type, coins_delta, luck_delta, coins_after, luck_after) VALUES ('u1', 'k1', 'catch_sell', 15, 0, 110, 0)").run();
    });
  } finally {
    db.close();
  }
});

test('本地 server.js 安全提供静态资源与 /api/v1/* 并阻止路径遍历及敏感文件访问', async () => {
  const app = await createAppServer({ dbPath: ':memory:' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const htmlRes = await fetch(`${baseUrl}/index.html`);
    assert.equal(htmlRes.status, 200);
    assert.equal(htmlRes.headers.get('x-content-type-options'), 'nosniff');
    const htmlBody = await htmlRes.text();
    assert.ok(htmlBody.includes('微风垂钓物语'));

    const sharedRes = await fetch(`${baseUrl}/shared/game_catalog.js`);
    assert.equal(sharedRes.status, 200);

    const healthRes = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.equal(healthJson.ok, true);
    assert.equal(healthJson.data.status, 'ok');

    // 拦截敏感路径与路径遍历
    for (const blockedPath of ['/.env', '/.env.example', '/package.json', '/backend/config/env.mjs', '/db/migrations/sqlite/0001_initial_schema.sql', '/js/../package.json']) {
      const blockedRes = await fetch(`${baseUrl}${blockedPath}`);
      assert.equal(blockedRes.status, 403, `${blockedPath} 应被安全白名单拒绝 (403)`);
    }
  } finally {
    await app.close();
  }
});
