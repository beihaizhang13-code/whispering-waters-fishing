import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiHandler } from '../../backend/http/router.mjs';
import { loadConfig } from '../../backend/config/env.mjs';

function buildFullStackTestApi() {
  const config = loadConfig({
    skipDotEnv: true,
    dbPath: ':memory:',
    env: {
      NODE_ENV: 'test',
      APP_ENV: 'test',
      STORAGE_DRIVER: 'sqlite',
      AUTH_SESSION_SECRET: 'test-session-secret-0123456789abcdef',
      RATE_LIMIT_MAX_REQ: '500',
      RATE_LIMIT_WINDOW_SEC: '60'
    }
  });
  return createApiHandler({
    config,
    logger: { info() {}, warn() {}, error() {} }
  });
}

async function callJson(api, method, path, { token, scheme = 'guest', body, idempotencyKey } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) {
    if (scheme === 'bearer') headers.Authorization = `Bearer ${token}`;
    else headers['X-Guest-Token'] = token;
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const res = await api.handleRequest(new Request(`http://localhost${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  }));
  const json = await res.json();
  return { status: res.status, json };
}

test('全后端 M1-M3 端到端闭环：游客建档、云存档合并、捕鱼风控、商店、水族箱、鱼潮、成就、分享、榜单与账号升级', async () => {
  const api = buildFullStackTestApi();
  try {
    // 1. 游客无门槛建档
    const guestRes = await callJson(api, 'POST', '/api/v1/auth/guest', {
      body: { deviceLabel: 'IntegrationTest' }
    });
    assert.equal(guestRes.status, 201);
    assert.equal(guestRes.json.ok, true);
    const guestToken = guestRes.json.data.token;
    assert.ok(guestToken);

    const meRes = await callJson(api, 'GET', '/api/v1/auth/me', { token: guestToken });
    assert.equal(meRes.status, 200);
    assert.equal(meRes.json.data.user.accountType, 'guest');

    // 2. 云存档读取、乐观锁更新、409 冲突、合并与导出/导入验签
    const getSave1 = await callJson(api, 'GET', '/api/v1/save', { token: guestToken });
    assert.equal(getSave1.status, 200);
    assert.equal(getSave1.json.data.revision, 1);

    const nextSnap = structuredClone(getSave1.json.data.snapshot);
    nextSnap.equippedHat = 'straw';
    nextSnap.coins = 500;
    const putSave1 = await callJson(api, 'PUT', '/api/v1/save', {
      token: guestToken,
      body: { baseRevision: 1, snapshot: nextSnap }
    });
    assert.equal(putSave1.status, 200);
    assert.equal(putSave1.json.data.revision, 2);

    // 用过期版本号写回触发 409
    const conflictPut = await callJson(api, 'PUT', '/api/v1/save', {
      token: guestToken,
      body: { baseRevision: 1, snapshot: nextSnap }
    });
    assert.equal(conflictPut.status, 409);
    assert.equal(conflictPut.json.error.code, 'SAVE_CONFLICT');
    assert.equal(conflictPut.json.error.details.serverRevision, 2);

    // 合并本地进度
    const mergeRes = await callJson(api, 'POST', '/api/v1/save/merge', {
      token: guestToken,
      body: {
        localSnapshot: {
          ...nextSnap,
          unlockedHats: ['straw', 'frog'],
          records: { crucian: { count: 2, maxKg: 0.9, maxLen: 28, shinyCount: 0 } }
        }
      }
    });
    assert.equal(mergeRes.status, 200);
    assert.ok(mergeRes.json.data.snapshot.unlockedHats.includes('frog'));

    const exportRes = await callJson(api, 'GET', '/api/v1/save/export', { token: guestToken });
    assert.equal(exportRes.status, 200);
    const badBundle = structuredClone(exportRes.json.data);
    badBundle.snapshot.coins = 999999;
    const badImport = await callJson(api, 'POST', '/api/v1/save/import', {
      token: guestToken,
      body: { bundle: badBundle }
    });
    assert.equal(badImport.status, 400);

    // 3. 混合权威捕鱼校验：无船报沉船湾被 422 拒绝，合法捕鱼服务端重算售价并幂等
    const cheatCatch = await callJson(api, 'POST', '/api/v1/gameplay/catches', {
      token: guestToken,
      idempotencyKey: 'catch_cheat_1',
      body: {
        clientCatchUid: 'catch_cheat_1',
        fishId: 'dragon_koi',
        biomeId: 'abyss',
        depthZone: 2,
        baitId: 'dough',
        lengthCm: 150,
        weightKg: 30,
        isShiny: true,
        disposition: 'sold'
      }
    });
    assert.equal(cheatCatch.status, 422);
    assert.equal(cheatCatch.json.error.code, 'ANTICHEAT_REJECTED');

    const validCatch = await callJson(api, 'POST', '/api/v1/gameplay/catches', {
      token: guestToken,
      idempotencyKey: 'catch_valid_1',
      body: {
        clientCatchUid: 'catch_valid_1',
        fishId: 'perch',
        biomeId: 'pier',
        depthZone: 1,
        baitId: 'dough',
        lengthCm: 35,
        weightKg: 1.4,
        sizeFactor: 0.7,
        isShiny: false,
        value: 999999, // 客户端恶意改价应被服务端忽略重算
        disposition: 'sold'
      }
    });
    assert.equal(validCatch.status, 200);
    assert.equal(validCatch.json.data.duplicate, false);
    assert.ok(validCatch.json.data.catchLog.computedValue < 100);

    // 同 clientCatchUid 幂等重放不重复发金币
    const replayCatch = await callJson(api, 'POST', '/api/v1/gameplay/catches', {
      token: guestToken,
      idempotencyKey: 'catch_valid_1',
      body: {
        clientCatchUid: 'catch_valid_1',
        fishId: 'perch',
        biomeId: 'pier',
        depthZone: 1,
        baitId: 'dough',
        lengthCm: 35,
        weightKg: 1.4,
        disposition: 'sold'
      }
    });
    assert.equal(replayCatch.status, 200);
    assert.equal(replayCatch.json.data.duplicate, true);
    assert.equal(replayCatch.json.data.save.coins, validCatch.json.data.save.coins);

    // 4. 商店购买船只与鱼饵 + 幂等冲突检测
    const buyBoat = await callJson(api, 'POST', '/api/v1/gameplay/shop/purchase', {
      token: guestToken,
      idempotencyKey: 'shop_boat_1',
      body: { itemType: 'boat', itemId: 'rowboat' }
    });
    assert.equal(buyBoat.status, 200);
    assert.ok(buyBoat.json.data.save.snapshot.unlockedBoats.includes('rowboat'));

    const shopConflict = await callJson(api, 'POST', '/api/v1/gameplay/shop/purchase', {
      token: guestToken,
      idempotencyKey: 'shop_boat_1',
      body: { itemType: 'bait', itemId: 'worm', quantity: 2 }
    });
    assert.equal(shopConflict.status, 409);
    assert.equal(shopConflict.json.error.code, 'IDEMPOTENCY_CONFLICT');

    // 5. 捕获入水族箱 + 喂食 + 扩建 + 离线结算
    const catchToAq = await callJson(api, 'POST', '/api/v1/gameplay/catches', {
      token: guestToken,
      idempotencyKey: 'catch_aq_1',
      body: {
        clientCatchUid: 'catch_aq_1',
        fishId: 'koi',
        biomeId: 'islet',
        depthZone: 1,
        baitId: 'dough',
        lengthCm: 55,
        weightKg: 4.2,
        isShiny: true,
        disposition: 'aquarium'
      }
    });
    assert.equal(catchToAq.status, 200);
    assert.equal(catchToAq.json.data.save.snapshot.aquarium.length, 1);

    const feedRes = await callJson(api, 'POST', '/api/v1/gameplay/aquarium/feed', {
      token: guestToken,
      idempotencyKey: 'feed_1',
      body: {}
    });
    assert.equal(feedRes.status, 200);

    const upgBad = await callJson(api, 'POST', '/api/v1/gameplay/aquarium/upgrade', {
      token: guestToken,
      idempotencyKey: 'aq_upg_bad',
      body: { targetLevel: 3 }
    });
    assert.equal(upgBad.status, 400);

    const upgOk = await callJson(api, 'POST', '/api/v1/gameplay/aquarium/upgrade', {
      token: guestToken,
      idempotencyKey: 'aq_upg_2',
      body: { targetLevel: 2 }
    });
    assert.equal(upgOk.status, 200);
    assert.equal(upgOk.json.data.save.aquariumLevel, 2);

    const claimOff = await callJson(api, 'POST', '/api/v1/gameplay/aquarium/claim-offline', {
      token: guestToken,
      idempotencyKey: 'aq_claim_1',
      body: {}
    });
    assert.equal(claimOff.status, 200);

    // 6. 捕获入鱼篓并交付悬赏订单
    const catchToBasket = await callJson(api, 'POST', '/api/v1/gameplay/catches', {
      token: guestToken,
      idempotencyKey: 'catch_basket_1',
      body: {
        clientCatchUid: 'catch_basket_1',
        fishId: 'crucian',
        biomeId: 'reed',
        depthZone: 0,
        baitId: 'dough',
        lengthCm: 25,
        weightKg: 0.6,
        disposition: 'basket'
      }
    });
    assert.equal(catchToBasket.status, 200);
    const basketUid = catchToBasket.json.data.save.snapshot.basket[0].uid;

    const deliverRes = await callJson(api, 'POST', '/api/v1/gameplay/orders/deliver', {
      token: guestToken,
      idempotencyKey: 'order_1',
      body: { orderId: 'ord_test_1', fishUid: basketUid, source: 'basket' }
    });
    assert.equal(deliverRes.status, 200);
    assert.equal(deliverRes.json.data.save.snapshot.completedOrdersCount, 1);

    // 7. 召唤全服黄金鱼潮 & 检验世界时钟状态
    const summonTide = await callJson(api, 'POST', '/api/v1/world/golden-tide/summon', {
      token: guestToken,
      idempotencyKey: 'tide_1',
      body: { paymentMethod: 'coins' }
    });
    assert.equal(summonTide.status, 200);
    assert.equal(summonTide.json.data.worldState.goldenTide.active, true);

    const worldRes = await callJson(api, 'GET', '/api/v1/world/state');
    assert.equal(worldRes.status, 200);
    assert.equal(worldRes.json.data.goldenTide.active, true);

    // 8. 成就列表/领奖、水族箱分享/点赞、以及多维排行榜
    const achList = await callJson(api, 'GET', '/api/v1/achievements', { token: guestToken });
    assert.equal(achList.status, 200);
    assert.equal(achList.json.data.achievements.length, 12);

    const claimAch = await callJson(api, 'POST', '/api/v1/achievements/first_catch/claim', {
      token: guestToken,
      idempotencyKey: 'claim_ach_1'
    });
    assert.equal(claimAch.status, 200);

    const shareRes = await callJson(api, 'POST', '/api/v1/aquarium/shares', {
      token: guestToken,
      body: { title: '我的微风海景缸' }
    });
    assert.equal(shareRes.status, 201);
    const shareCode = shareRes.json.data.shareCode;

    const getShare = await callJson(api, 'GET', `/api/v1/aquarium/shares/${shareCode}`);
    assert.equal(getShare.status, 200);
    assert.equal(getShare.json.data.viewsCount, 1);

    const likeShare = await callJson(api, 'POST', `/api/v1/aquarium/shares/${shareCode}/like`, {
      idempotencyKey: 'like_1'
    });
    assert.equal(likeShare.status, 200);
    assert.equal(likeShare.json.data.likesCount, 1);

    const lbWealth = await callJson(api, 'GET', '/api/v1/leaderboards/wealth');
    assert.equal(lbWealth.status, 200);
    assert.ok(lbWealth.json.data.items.length >= 1);

    const lbSpecies = await callJson(api, 'GET', '/api/v1/leaderboards/species/perch?metric=weight');
    assert.equal(lbSpecies.status, 200);
    assert.equal(lbSpecies.json.data.items.length, 1);

    const lbMe = await callJson(api, 'GET', '/api/v1/leaderboards/me', { token: guestToken });
    assert.equal(lbMe.status, 200);
    assert.ok(lbMe.json.data.ranks.length >= 1);

    // 9. 游客绑定邮箱升级 -> 登出 -> 重新登录 -> 账号注销
    const upgradeRes = await callJson(api, 'POST', '/api/v1/auth/upgrade', {
      token: guestToken,
      body: {
        targetProvider: 'email_password',
        credentials: {
          email: 'fisher@example.com',
          password: 'secretPassword123',
          displayName: '宗师钓手'
        }
      }
    });
    assert.equal(upgradeRes.status, 200);
    assert.equal(upgradeRes.json.data.user.accountType, 'registered');

    const logoutRes = await callJson(api, 'POST', '/api/v1/auth/logout', { token: guestToken });
    assert.equal(logoutRes.status, 200);

    const loginRes = await callJson(api, 'POST', '/api/v1/auth/login', {
      body: { email: 'fisher@example.com', password: 'secretPassword123' }
    });
    assert.equal(loginRes.status, 200);
    const bearerToken = loginRes.json.data.token;
    assert.ok(bearerToken);

    const delRes = await callJson(api, 'DELETE', '/api/v1/auth/account', {
      token: bearerToken,
      scheme: 'bearer',
      body: { confirmText: 'DELETE' }
    });
    assert.equal(delRes.status, 200);

    const afterDelMe = await callJson(api, 'GET', '/api/v1/auth/me', {
      token: bearerToken,
      scheme: 'bearer'
    });
    assert.equal(afterDelMe.status, 401);
  } finally {
    await api.close();
  }
});
