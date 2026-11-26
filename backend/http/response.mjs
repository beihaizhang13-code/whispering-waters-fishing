/**
 * 《微风垂钓物语 2.0》统一 HTTP JSON 响应信封与安全头构造器 (backend/http/response.mjs)
 */
import errorCodes from '../../shared/error_codes.js';

const { getErrorDef } = errorCodes;

const BASE_SECURITY_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};

export function buildResponseHeaders(requestId, extraHeaders = {}) {
  return {
    ...BASE_SECURITY_HEADERS,
    ...(requestId ? { 'X-Request-Id': requestId } : {}),
    ...extraHeaders
  };
}

export function jsonOk(data, meta = {}, status = 200, requestId = null, extraHeaders = {}) {
  const body = {
    ok: true,
    data,
    meta: {
      requestId,
      serverTime: new Date().toISOString(),
      ...meta
    }
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: buildResponseHeaders(requestId, extraHeaders)
  });
}

export function jsonError(code, message, details = null, statusOverride = null, requestId = null, extraHeaders = {}) {
  const def = getErrorDef(code);
  const status = statusOverride || def.httpStatus || 500;
  const body = {
    ok: false,
    error: {
      code: def.code,
      message: message || def.message,
      ...(details ? { details } : {})
    },
    meta: {
      requestId,
      serverTime: new Date().toISOString()
    }
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: buildResponseHeaders(requestId, extraHeaders)
  });
}

export function notImplemented(routeMeta, requestId = null) {
  return jsonError(
    'NOT_IMPLEMENTED',
    `接口契约已就绪 [${routeMeta.method} ${routeMeta.path}]，具体业务逻辑将在 ${routeMeta.milestone} 实现`,
    {
      contractEndpoint: `${routeMeta.method} ${routeMeta.path}`,
      plannedMilestone: routeMeta.milestone,
      authRequired: Boolean(routeMeta.authRequired),
      idempotent: Boolean(routeMeta.idempotent),
      docRef: 'docs/04-api-contract.md'
    },
    501,
    requestId
  );
}
