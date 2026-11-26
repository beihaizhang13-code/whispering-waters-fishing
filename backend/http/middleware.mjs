/**
 * 《微风垂钓物语 2.0》HTTP 中间件与安全护栏骨架 (backend/http/middleware.mjs)
 * ----------------------------------------------------------------------------
 * 提供请求 ID、Origin/Referer 同源防 CSRF 校验、鉴权头解析与内存限流器契约。
 */
import crypto from 'node:crypto';

export function generateRequestId() {
  return `req_${crypto.randomUUID()}`;
}

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

export async function readJsonBody(req, maxBytes = 2 * 1024 * 1024) {
  const text = await req.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    const err = new Error('请求体大小超出限制');
    err.code = 'VALIDATION_ERROR';
    err.status = 413;
    throw err;
  }
  if (!text || !text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const err = new Error('请求体必须为 JSON 对象');
      err.code = 'VALIDATION_ERROR';
      err.status = 400;
      throw err;
    }
    return parsed;
  } catch (e) {
    if (e && e.code === 'VALIDATION_ERROR') throw e;
    const err = new Error('请求体 JSON 格式无效');
    err.code = 'VALIDATION_ERROR';
    err.status = 400;
    throw err;
  }
}

export function parseAuthHeader(req) {
  const header = req.headers.get('authorization') || '';
  if (header.startsWith('Bearer ')) {
    return { scheme: 'bearer', token: header.slice(7).trim() };
  }
  const guestToken = req.headers.get('x-guest-token') || '';
  if (guestToken) {
    return { scheme: 'guest', token: guestToken.trim() };
  }
  return { scheme: 'anonymous', token: null };
}

/**
 * 针对状态变更请求 (POST/PUT/PATCH/DELETE) 校验同源性以防御 CSRF。
 * M0 基座阶段返回结构化判定，M1 启用 Cookie 会话后在路由器层强制拦截非白名单跨站来源。
 */
export function verifySameOrigin(req, config) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return { allowed: true, reason: 'safe_method' };
  }
  const origin = req.headers.get('origin');
  const secFetchSite = (req.headers.get('sec-fetch-site') || '').toLowerCase();
  if (secFetchSite === 'cross-site') {
    return { allowed: false, reason: 'cross_site_sec_fetch', secFetchSite };
  }
  if (!origin) {
    // 非浏览器客户端或部分同源请求不携带 Origin；已在上方拦截明确的 cross-site Sec-Fetch-Site
    return { allowed: true, reason: 'no_origin_header' };
  }
  const allowedOrigins = new Set(config?.corsAllowedOrigins || []);
  try {
    const reqUrl = new URL(req.url);
    allowedOrigins.add(reqUrl.origin);
  } catch {
    // 忽略相对 URL 解析失败
  }
  if (allowedOrigins.has(origin)) {
    return { allowed: true, reason: 'origin_matched' };
  }
  return { allowed: false, reason: 'origin_mismatch', origin };
}

/**
 * 单实例滑窗限流器骨架 (M1/M2 用于保护登录/存档/排行榜接口；分布式多实例可替换 Edge RateLimit)。
 */
export function createMemoryRateLimiter(config) {
  const buckets = new Map();
  const windowMs = (config?.rateLimitWindowSec || 60) * 1000;
  const maxReq = config?.rateLimitMaxReq || 120;

  return {
    check(key, nowMs = Date.now()) {
      const entry = buckets.get(key);
      if (!entry || nowMs >= entry.resetAt) {
        const fresh = { count: 1, resetAt: nowMs + windowMs };
        buckets.set(key, fresh);
        return { allowed: true, remaining: maxReq - 1, resetAt: fresh.resetAt };
      }
      entry.count += 1;
      const allowed = entry.count <= maxReq;
      return {
        allowed,
        remaining: Math.max(0, maxReq - entry.count),
        resetAt: entry.resetAt
      };
    }
  };
}
