import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiHandler } from '../../backend/http/router.mjs';
import { loadConfig } from '../../backend/config/env.mjs';

function buildTestApiHandler() {
  const config = loadConfig({
    skipDotEnv: true,
    dbPath: ':memory:',
    env: {
      NODE_ENV: 'test',
      APP_ENV: 'test',
      STORAGE_DRIVER: 'sqlite'
    }
  });
  return createApiHandler({
    config,
    logger: { info() {}, warn() {}, error() {} }
  });
}

test('GET /api/v1/health 返回 200 与标准成功信封及安全响应头', async () => {
  const api = buildTestApiHandler();
  try {
    const res = await api.handleRequest(new Request('http://localhost/api/v1/health'));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.ok(res.headers.get('x-request-id'));

    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.data.status, 'ok');
    assert.equal(json.data.catalogVersion, '2.0.0');
    assert.equal(json.data.storageDriver, 'sqlite');
    assert.equal(json.data.storage.ok, true);
  } finally {
    await api.close();
  }
});

test('GET /api/v1/world/state 返回 200 与全服天气时钟', async () => {
  const api = buildTestApiHandler();
  try {
    const res = await api.handleRequest(new Request('http://localhost/api/v1/world/state'));
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.ok(['sunny', 'rain', 'storm', 'meteor'].includes(json.data.weather.weatherId));
    assert.equal(typeof json.data.goldenTide.active, 'boolean');
  } finally {
    await api.close();
  }
});

test('未鉴权访问受保护路由返回 401，未配置 OAuth 凭据返回 503，公开榜单返回 200', async () => {
  const api = buildTestApiHandler();
  try {
    const protectedEndpoints = [
      ['GET', '/api/v1/save'],
      ['POST', '/api/v1/gameplay/catches'],
      ['GET', '/api/v1/achievements']
    ];
    for (const [method, path] of protectedEndpoints) {
      const res = await api.handleRequest(new Request(`http://localhost${path}`, { method }));
      assert.equal(res.status, 401, `${method} ${path} 未登录应返回 401`);
      const json = await res.json();
      assert.equal(json.ok, false);
      assert.equal(json.error.code, 'UNAUTHORIZED');
    }

    const oauthRes = await api.handleRequest(new Request('http://localhost/api/v1/auth/oauth/google'));
    assert.equal(oauthRes.status, 503);
    const oauthJson = await oauthRes.json();
    assert.equal(oauthJson.error.code, 'SERVICE_UNAVAILABLE');

    const badProviderRes = await api.handleRequest(new Request('http://localhost/api/v1/auth/oauth/unknown'));
    assert.equal(badProviderRes.status, 400);

    const lbRes = await api.handleRequest(new Request('http://localhost/api/v1/leaderboards/wealth'));
    assert.equal(lbRes.status, 200);
    const lbJson = await lbRes.json();
    assert.equal(lbJson.ok, true);
  } finally {
    await api.close();
  }
});

test('不存在的路由返回 404，存在路径但错误方法返回 405', async () => {
  const api = buildTestApiHandler();
  try {
    const res404 = await api.handleRequest(new Request('http://localhost/api/v1/does-not-exist'));
    assert.equal(res404.status, 404);
    const body404 = await res404.json();
    assert.equal(body404.error.code, 'NOT_FOUND');

    const res405 = await api.handleRequest(new Request('http://localhost/api/v1/health', { method: 'POST' }));
    assert.equal(res405.status, 405);
    assert.equal(res405.headers.get('allow'), 'GET');
    const body405 = await res405.json();
    assert.equal(body405.error.code, 'METHOD_NOT_ALLOWED');
  } finally {
    await api.close();
  }
});

test('跨站非白名单 Origin 写请求被同源 CSRF 防线拦截为 403', async () => {
  const api = buildTestApiHandler();
  try {
    const res = await api.handleRequest(new Request('http://localhost/api/v1/auth/guest', {
      method: 'POST',
      headers: { Origin: 'https://evil-attacker.example' }
    }));
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.error.code, 'FORBIDDEN');
  } finally {
    await api.close();
  }
});

test('存储健康检查失败时 GET /api/v1/health 返回 503 与 ready=false', async () => {
  const config = loadConfig({
    skipDotEnv: true,
    env: { NODE_ENV: 'test', APP_ENV: 'test', STORAGE_DRIVER: 'postgres' }
  });
  const api = createApiHandler({
    config,
    logger: { info() {}, warn() {}, error() {} }
  });
  try {
    const res = await api.handleRequest(new Request('http://localhost/api/v1/health'));
    assert.equal(res.status, 503);
    const json = await res.json();
    assert.equal(json.ok, false);
    assert.equal(json.error.code, 'SERVICE_UNAVAILABLE');
    assert.equal(json.error.details.ready, false);
    assert.equal(json.error.details.storage.ok, false);
  } finally {
    await api.close();
  }
});

test('路由器限流器生效且拦截 cross-site Sec-Fetch-Site 写请求', async () => {
  const config = loadConfig({
    skipDotEnv: true,
    dbPath: ':memory:',
    env: {
      NODE_ENV: 'test',
      APP_ENV: 'test',
      STORAGE_DRIVER: 'sqlite',
      RATE_LIMIT_MAX_REQ: '2',
      RATE_LIMIT_WINDOW_SEC: '60'
    }
  });
  const api = createApiHandler({
    config,
    logger: { info() {}, warn() {}, error() {} }
  });
  try {
    const csrfRes = await api.handleRequest(new Request('http://localhost/api/v1/auth/guest', {
      method: 'POST',
      headers: { 'Sec-Fetch-Site': 'cross-site' }
    }));
    assert.equal(csrfRes.status, 403);

    const r1 = await api.handleRequest(new Request('http://localhost/api/v1/world/state'));
    const r2 = await api.handleRequest(new Request('http://localhost/api/v1/world/state'));
    const r3 = await api.handleRequest(new Request('http://localhost/api/v1/world/state'));
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(r3.status, 429);
    assert.ok(r3.headers.get('retry-after'));
    const body3 = await r3.json();
    assert.equal(body3.error.code, 'RATE_LIMITED');
  } finally {
    await api.close();
  }
});
