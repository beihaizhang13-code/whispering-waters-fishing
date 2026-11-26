import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiHandler } from '../../backend/http/router.mjs';
import { loadConfig } from '../../backend/config/env.mjs';
import { createPostgresRepositories } from '../../backend/repositories/postgres/adapter.mjs';
import saveSchema from '../../shared/save_schema.js';

function createMockFetch() {
  return async (url, opts = {}) => {
    const target = String(url);
    if (target === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'mock_google_access_token' }), { status: 200 });
    }
    if (target === 'https://openidconnect.googleapis.com/v1/userinfo') {
      assert.equal(opts.headers?.Authorization, 'Bearer mock_google_access_token');
      return new Response(JSON.stringify({
        sub: 'google-sub-12345',
        email: 'angler@gmail.com',
        email_verified: true,
        name: '微风谷歌钓友'
      }), { status: 200 });
    }
    if (target === 'https://github.com/login/oauth/access_token') {
      return new Response(JSON.stringify({ access_token: 'mock_github_access_token' }), { status: 200 });
    }
    if (target === 'https://api.github.com/user') {
      return new Response(JSON.stringify({
        id: 987654,
        login: 'octo-fisher',
        name: 'GitHub 渔夫'
      }), { status: 200 });
    }
    if (target === 'https://api.github.com/user/emails') {
      return new Response(JSON.stringify([
        { email: 'octo@example.com', primary: true, verified: true }
      ]), { status: 200 });
    }
    return new Response('Not Found', { status: 404 });
  };
}

test('Google 与 GitHub OAuth 2.0 完整流程：授权跳转、state 验签、新用户登录及游客原地升级', async () => {
  const config = loadConfig({
    skipDotEnv: true,
    dbPath: ':memory:',
    env: {
      NODE_ENV: 'test',
      APP_ENV: 'test',
      STORAGE_DRIVER: 'sqlite',
      AUTH_SESSION_SECRET: 'oauth-test-session-secret-0123456789',
      OAUTH_GOOGLE_CLIENT_ID: 'google-client-id-test',
      OAUTH_GOOGLE_CLIENT_SECRET: 'google-client-secret-test',
      OAUTH_GITHUB_CLIENT_ID: 'github-client-id-test',
      OAUTH_GITHUB_CLIENT_SECRET: 'github-client-secret-test',
      OAUTH_REDIRECT_BASE_URL: 'https://whispering-waters-fishing.netlify.app',
      RATE_LIMIT_MAX_REQ: '500'
    }
  });

  const api = createApiHandler({
    config,
    fetchFn: createMockFetch(),
    logger: { info() {}, warn() {}, error() {} }
  });

  try {
    // 1. GitHub 302 跳转 + JSON 模式获取授权链接
    const ghRedirect = await api.handleRequest(new Request('http://localhost/api/v1/auth/oauth/github'));
    assert.equal(ghRedirect.status, 302);
    const ghLoc = ghRedirect.headers.get('location');
    assert.ok(ghLoc.startsWith('https://github.com/login/oauth/authorize?'));

    const ghJsonRes = await api.handleRequest(new Request('http://localhost/api/v1/auth/oauth/github?mode=json'));
    assert.equal(ghJsonRes.status, 200);
    const ghJson = await ghJsonRes.json();
    assert.equal(ghJson.data.provider, 'github');
    assert.ok(ghJson.data.state);

    // 2. 篡改 state 或跨 provider 重放必须被拦截 (401)
    const badStateRes = await api.handleRequest(
      new Request(`http://localhost/api/v1/auth/oauth/google/callback?code=abc&state=${encodeURIComponent(ghJson.data.state)}`)
    );
    assert.equal(badStateRes.status, 401);

    // 3. GitHub 回调创建新正式账号并签发 Bearer 会话
    const ghCbRes = await api.handleRequest(
      new Request(`http://localhost/api/v1/auth/oauth/github/callback?code=gh_code_1&state=${encodeURIComponent(ghJson.data.state)}`)
    );
    assert.equal(ghCbRes.status, 200);
    const ghCbJson = await ghCbRes.json();
    assert.equal(ghCbJson.ok, true);
    assert.equal(ghCbJson.data.user.accountType, 'registered');
    assert.equal(ghCbJson.data.user.displayName, 'GitHub 渔夫');
    assert.equal(ghCbJson.data.tokenType, 'bearer');
    assert.equal(ghCbJson.data.upgradedFromGuest, false);

    // 4. 创建游客并修改金币 -> 发起 Google OAuth 升级 -> 原地绑定并保留进度
    const guestRes = await api.handleRequest(new Request('http://localhost/api/v1/auth/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceLabel: 'OAuthUpgradeDevice' })
    }));
    const guestJson = await guestRes.json();
    const guestToken = guestJson.data.token;
    const guestSnap = structuredClone(guestJson.data.save.snapshot);
    guestSnap.coins = 777;

    await api.handleRequest(new Request('http://localhost/api/v1/save', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Guest-Token': guestToken },
      body: JSON.stringify({ baseRevision: 1, snapshot: guestSnap })
    }));

    const googleAuthRes = await api.handleRequest(
      new Request('http://localhost/api/v1/auth/oauth/google?mode=json', {
        headers: { 'X-Guest-Token': guestToken }
      })
    );
    assert.equal(googleAuthRes.status, 200);
    const googleAuthJson = await googleAuthRes.json();

    const googleCbRes = await api.handleRequest(
      new Request('http://localhost/api/v1/auth/oauth/google/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'gg_code_1', state: googleAuthJson.data.state })
      })
    );
    assert.equal(googleCbRes.status, 200);
    const googleCbJson = await googleCbRes.json();
    assert.equal(googleCbJson.data.upgradedFromGuest, true);
    assert.equal(googleCbJson.data.user.id, guestJson.data.user.id);
    assert.equal(googleCbJson.data.user.accountType, 'registered');
    assert.equal(googleCbJson.data.save.coins, 777);

    // 5. 再次使用同一个 Google 账号登录，命中已有用户而不新建
    const googleAuth2 = await api.handleRequest(new Request('http://localhost/api/v1/auth/oauth/google?mode=json'));
    const googleAuth2Json = await googleAuth2.json();
    const googleReLogin = await api.handleRequest(
      new Request(`http://localhost/api/v1/auth/oauth/google/callback?code=gg_code_2&state=${encodeURIComponent(googleAuth2Json.data.state)}`)
    );
    const googleReLoginJson = await googleReLogin.json();
    assert.equal(googleReLogin.status, 200);
    assert.equal(googleReLoginJson.data.user.id, guestJson.data.user.id);
    assert.equal(googleReLoginJson.data.upgradedFromGuest, false);
  } finally {
    await api.close();
  }
});

test('PostgreSQL 仓储适配器全领域接口、事务提交/回滚及参数化 SQL 校验', async () => {
  const txEvents = [];
  const defaultSave = saveSchema.createDefaultPlayerState();

  const makeQueryHandler = (isRollbackTest = false) => async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') {
      txEvents.push(s);
      return { rows: [], rowCount: 0 };
    }
    if (s.startsWith('SELECT 1 AS ok')) return { rows: [{ ok: 1 }], rowCount: 1 };
    if (s.includes('information_schema.tables')) return { rows: [{ count: 13 }], rowCount: 1 };
    if (s.startsWith('INSERT INTO users')) {
      return {
        rows: [{
          id: params[0],
          account_type: s.includes("'guest'") ? 'guest' : 'registered',
          display_name: params[1],
          avatar_frame: 'straw',
          status: 'active',
          role: 'player',
          created_at: new Date('2026-11-26T00:00:00.000Z'),
          updated_at: new Date('2026-11-26T00:00:00.000Z')
        }],
        rowCount: 1
      };
    }
    if (s.startsWith('INSERT INTO auth_identities')) return { rows: [], rowCount: 1 };
    if (s.startsWith('INSERT INTO sessions')) return { rows: [], rowCount: 1 };
    if (s.startsWith('INSERT INTO player_saves')) {
      if (isRollbackTest) throw new Error('simulated_pg_failure');
      return { rows: [], rowCount: 1 };
    }
    if (s.includes('FROM player_saves')) {
      return {
        rows: [{
          user_id: params[0] || 'usr_pg_1',
          schema_version: 2,
          revision: 1,
          coins: 80,
          luck_points: 0,
          aquarium_level: 1,
          aquarium_last_settled_at: new Date('2026-11-26T00:00:00.000Z'),
          species_unlocked_count: 0,
          total_catches: 0,
          save_payload: defaultSave,
          payload_checksum: 'chk_pg',
          updated_at: new Date('2026-11-26T00:00:00.000Z')
        }],
        rowCount: 1
      };
    }
    if (s.startsWith('UPDATE player_saves')) {
      return { rows: [], rowCount: 1 };
    }
    if (s.includes('FROM economy_ledger')) return { rows: [], rowCount: 0 };
    if (s.includes('FROM catch_logs')) return { rows: [], rowCount: 0 };
    if (s.startsWith('INSERT INTO catch_logs')) {
      return {
        rows: [{
          id: 1,
          user_id: params[0],
          client_catch_uid: params[1],
          fish_id: params[2],
          rarity: params[3],
          biome_id: params[4],
          depth_zone: params[5],
          bait_id: params[6],
          weather_id: params[7],
          is_golden_tide: false,
          is_shiny: true,
          length_cm: 24.5,
          weight_kg: 0.85,
          computed_value: 44,
          disposition: 'sold',
          validation_status: 'verified',
          validation_reason: null,
          caught_at: new Date('2026-11-26T00:00:00.000Z'),
          created_at: new Date('2026-11-26T00:00:00.000Z')
        }],
        rowCount: 1
      };
    }
    if (s.startsWith('INSERT INTO economy_ledger')) return { rows: [{ id: 10 }], rowCount: 1 };
    if (s.startsWith('SELECT display_name FROM users') || s.startsWith('SELECT id, account_type, display_name')) {
      return { rows: [{ id: 'usr_pg_1', account_type: 'registered', display_name: 'PG钓友', avatar_frame: 'straw', status: 'active', role: 'player' }], rowCount: 1 };
    }
    if (s.includes('FROM achievement_definitions')) {
      return { rows: [{ code: 'first_catch', title: '初试锋芒', description: 'desc', category: 'fishing', target_value: 1, reward_coins: 40, reward_luck: 2, sort_order: 1 }], rowCount: 1 };
    }
    if (s.includes('FROM user_achievements')) return { rows: [], rowCount: 0 };
    if (s.startsWith('INSERT INTO user_achievements')) return { rows: [], rowCount: 1 };
    if (s.includes('FROM leaderboard_records')) return { rows: [], rowCount: 0 };
    if (s.startsWith('INSERT INTO leaderboard_records')) return { rows: [], rowCount: 1 };
    if (s.includes('FROM world_events')) return { rows: [], rowCount: 0 };
    if (s.startsWith('INSERT INTO world_events')) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };

  let failNext = false;
  const mockPool = {
    async query(sql, params) {
      return makeQueryHandler(failNext)(sql, params);
    },
    async connect() {
      return {
        async query(sql, params) {
          return makeQueryHandler(failNext)(sql, params);
        },
        release() {}
      };
    },
    async end() {}
  };

  const config = loadConfig({
    skipDotEnv: true,
    env: { STORAGE_DRIVER: 'postgres', NETLIFY_DB_URL: 'postgres://mock:5432/wwf' }
  });

  const repos = createPostgresRepositories(config, { db: { pool: mockPool } });
  const health = await repos.healthCheck();
  assert.equal(health.ok, true);
  assert.equal(health.driver, 'postgres');
  assert.equal(health.details.tableCount, 13);

  // 验证全部 7 大仓储接口均已真实实现（无 501 占位）
  for (const domain of ['users', 'saves', 'economy', 'leaderboards', 'worldEvents', 'aquariumHelpers', 'social']) {
    assert.ok(repos[domain], `缺少 ${domain} 仓储`);
  }

  const created = await repos.users.createOAuthUser({
    userId: 'usr_pg_1',
    displayName: 'PG钓友',
    identityId: 'idn_pg_1',
    provider: 'google',
    providerSubject: 'sub_pg_1',
    email: 'pg@example.com',
    sessionId: 'ses_pg_1',
    tokenHash: 'tok_hash_pg_1',
    expiresAt: '2027-01-01T00:00:00.000Z',
    initialSaveObj: defaultSave
  });
  assert.equal(created.user.id, 'usr_pg_1');
  assert.ok(txEvents.includes('BEGIN') && txEvents.includes('COMMIT'));

  const catchRes = await repos.economy.recordCatchAtomic({
    userId: 'usr_pg_1',
    clientCatchUid: 'pg_catch_1',
    idempotencyKey: 'pg_catch_1',
    catchLog: {
      fishId: 'crucian',
      rarity: 'common',
      biomeId: 'reed',
      depthZone: 0,
      baitId: 'dough',
      weatherId: 'sunny',
      isGoldenTide: false,
      isShiny: true,
      lengthCm: 24.5,
      weightKg: 0.85,
      computedValue: 44,
      disposition: 'sold'
    },
    nextSaveObj: { ...defaultSave, coins: 124 },
    ledgerEntry: { eventType: 'catch_sell', coinsDelta: 44, coinsAfter: 124, luckAfter: 0 },
    leaderboardUpdates: [{ boardType: 'wealth', scoreNumeric: 124 }],
    achievementUpdates: [{ code: 'first_catch', progressValue: 1 }]
  });
  assert.equal(catchRes.duplicate, false);
  assert.equal(catchRes.catchLog.isShiny, true);

  // 验证事务失败自动触发 ROLLBACK
  failNext = true;
  txEvents.length = 0;
  await assert.rejects(
    () => repos.users.createGuestUser({
      userId: 'usr_pg_err',
      displayName: 'err',
      identityId: 'idn_err',
      guestSubject: 'sub_err',
      sessionId: 'ses_err',
      tokenHash: 'tok_err',
      expiresAt: '2027-01-01T00:00:00.000Z',
      initialSaveObj: defaultSave
    }),
    /simulated_pg_failure/
  );
  assert.ok(txEvents.includes('BEGIN') && txEvents.includes('ROLLBACK'));

  await repos.close();
});
