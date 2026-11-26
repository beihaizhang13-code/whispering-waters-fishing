/**
 * 《微风垂钓物语 2.0》平台无关 HTTP API 路由器 (backend/http/router.mjs)
 * ----------------------------------------------------------------------------
 * 使用 Web 标准 Request / Response 签名，可同时被：
 * - netlify/functions/api.mjs (线上 Netlify Functions v2)
 * - server.js (本地 Node.js 24 开发服务器)
 * - tests/contract/api_router.test.mjs (单元测试直调)
 * 无缝复用。
 */
import { loadConfig } from '../config/env.mjs';
import { createLogger } from '../observability/logger.mjs';
import { createRepositories } from '../repositories/factory.mjs';
import { createAuthService } from '../auth/auth_service.mjs';
import { createSaveMergeService } from '../domain/save_merge_service.mjs';
import { createAquariumService } from '../domain/aquarium_service.mjs';
import { createEconomyValidator } from '../domain/economy_validator.mjs';
import { createLeaderboardService } from '../domain/leaderboard_service.mjs';
import { createWorldEventService } from '../domain/world_event_service.mjs';
import { createSocialService } from '../domain/social_service.mjs';
import { createMemoryRateLimiter, generateRequestId, parseAuthHeader, sha256Hex, verifySameOrigin } from './middleware.mjs';
import { jsonError } from './response.mjs';
import { createHealthRoutes } from './routes/health.mjs';
import { createWorldRoutes } from './routes/world.mjs';
import { createAuthRoutes } from './routes/auth.mjs';
import { createSaveRoutes } from './routes/save.mjs';
import { createGameplayRoutes } from './routes/gameplay.mjs';
import { createLeaderboardRoutes } from './routes/leaderboard.mjs';
import { createSocialRoutes } from './routes/social.mjs';

function compileRoutePattern(pattern) {
  const paramNames = [];
  const regexStr = pattern
    .split('/')
    .map(segment => {
      if (segment.startsWith(':')) {
        paramNames.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return {
    regex: new RegExp(`^${regexStr}/?$`),
    paramNames
  };
}

export function createApiHandler(deps = {}) {
  const config = deps.config || loadConfig();
  const logger = deps.logger || createLogger({ service: 'wwf-api', runtime: config.runtime });
  const repositories = deps.repositories || createRepositories(config, deps);
  const rateLimiter = deps.rateLimiter || createMemoryRateLimiter(config);

  const saveMergeService = createSaveMergeService({ config, repositories, logger });
  const services = {
    auth: createAuthService({ config, repositories, saveMergeService, logger, fetchFn: deps.fetchFn }),
    saveMerge: saveMergeService,
    aquarium: createAquariumService({ config, repositories, logger }),
    economy: createEconomyValidator({ config, repositories, logger }),
    leaderboard: createLeaderboardService({ repositories, logger }),
    worldEvent: createWorldEventService({ config, repositories, logger }),
    social: createSocialService({ repositories, logger })
  };

  const routes = [
    ...createHealthRoutes({ config, repositories }),
    ...createWorldRoutes({ services }),
    ...createAuthRoutes({ services }),
    ...createSaveRoutes({ services }),
    ...createGameplayRoutes({ services }),
    ...createLeaderboardRoutes({ services }),
    ...createSocialRoutes({ services })
  ].map(route => ({
    ...route,
    compiled: compileRoutePattern(route.path)
  }));

  async function handleRequest(req, platformContext = {}) {
    const requestId = req.headers.get('x-request-id') || generateRequestId();
    const startMs = Date.now();
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const method = req.method.toUpperCase();

    try {
      const originCheck = verifySameOrigin(req, config);
      if (!originCheck.allowed) {
        return jsonError(
          'FORBIDDEN',
          '请求来源未通过同源校验',
          { reason: originCheck.reason },
          403,
          requestId
        );
      }

      if (rateLimiter && pathname !== '/api/v1/health') {
        const clientIp = req.headers.get('x-nf-client-connection-ip')
          || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
          || 'local';
        const limitResult = rateLimiter.check(`${clientIp}:${method}:${pathname}`);
        if (!limitResult.allowed) {
          const retryAfterSec = Math.max(1, Math.ceil((limitResult.resetAt - Date.now()) / 1000));
          return jsonError(
            'RATE_LIMITED',
            '请求过于频繁，请稍后再试',
            { retryAfterSec },
            429,
            requestId,
            { 'Retry-After': String(retryAfterSec) }
          );
        }
      }

      const pathMatchedRoutes = [];
      let matchedRoute = null;
      let matchedParams = {};

      for (const route of routes) {
        const m = pathname.match(route.compiled.regex);
        if (!m) continue;
        pathMatchedRoutes.push(route);
        if (route.method === method) {
          matchedRoute = route;
          route.compiled.paramNames.forEach((name, idx) => {
            matchedParams[name] = decodeURIComponent(m[idx + 1]);
          });
          break;
        }
      }

      if (!matchedRoute && pathMatchedRoutes.length > 0) {
        const allowed = Array.from(new Set(pathMatchedRoutes.map(r => r.method))).join(', ');
        return jsonError(
          'METHOD_NOT_ALLOWED',
          `不支持使用 ${method} 访问 ${pathname}`,
          { allowedMethods: allowed },
          405,
          requestId,
          { Allow: allowed }
        );
      }

      if (!matchedRoute) {
        return jsonError('NOT_FOUND', `未找到 API 路由: ${pathname}`, null, 404, requestId);
      }

      const authCreds = parseAuthHeader(req);
      let authUser = null;
      let authSession = null;
      if (authCreds.token && services.auth && typeof services.auth.resolveSessionUser === 'function') {
        try {
          const resolved = await services.auth.resolveSessionUser(authCreds);
          if (resolved && resolved.user) {
            authUser = resolved.user;
            authSession = resolved.session || null;
          }
        } catch (err) {
          if (err && err.code !== 'NOT_IMPLEMENTED') {
            throw err;
          }
        }
      }

      if (matchedRoute.authRequired && !authUser) {
        return jsonError('UNAUTHORIZED', '未登录或会话凭证已失效', null, 401, requestId);
      }

      const clientIp = req.headers.get('x-nf-client-connection-ip')
        || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
        || 'local';

      const response = await matchedRoute.handler(req, {
        requestId,
        params: matchedParams,
        query: url.searchParams,
        route: matchedRoute,
        platformContext,
        config,
        logger,
        services,
        repositories,
        authCreds,
        authUser,
        authSession,
        clientIpHash: sha256Hex(clientIp),
        idempotencyKey: req.headers.get('idempotency-key') || null
      });

      logger.info('api_request_completed', {
        requestId,
        method,
        pathname,
        status: response.status,
        durationMs: Date.now() - startMs
      });

      return response;
    } catch (err) {
      logger.error('api_request_failed', {
        requestId,
        method,
        pathname,
        errorMessage: err?.message,
        errorCode: err?.code
      });
      return jsonError(
        err?.code || 'INTERNAL_ERROR',
        err?.message || '服务器处理请求时发生异常',
        err?.details || null,
        err?.status || null,
        requestId
      );
    }
  }

  return {
    handleRequest,
    routes,
    config,
    repositories,
    services,
    async close() {
      if (repositories && typeof repositories.close === 'function') {
        await repositories.close();
      }
    }
  };
}
