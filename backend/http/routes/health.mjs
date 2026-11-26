/**
 * 《微风垂钓物语 2.0》健康检查路由 (backend/http/routes/health.mjs)
 */
import gameCatalog from '../../../shared/game_catalog.js';
import { jsonError, jsonOk } from '../response.mjs';

export function createHealthRoutes({ config, repositories }) {
  return [
    {
      method: 'GET',
      path: '/api/v1/health',
      milestone: 'M0',
      authRequired: false,
      idempotent: true,
      async handler(_req, ctx) {
        let storage = { ok: true, driver: config.storageDriver, skipped: true };
        if (repositories && typeof repositories.healthCheck === 'function') {
          storage = await repositories.healthCheck();
        }

        const isReady = Boolean(storage && storage.ok !== false);
        const publicStorage = {
          ok: isReady,
          driver: (storage && storage.driver) || config.storageDriver,
          ...(storage && storage.skipped ? { skipped: true } : {})
        };

        const payload = {
          service: 'whispering-waters-fishing-api',
          status: isReady ? 'ok' : 'degraded',
          ready: isReady,
          version: '2.1.0-foundation',
          catalogVersion: gameCatalog.CATALOG_VERSION,
          runtime: config.runtime,
          appEnv: config.appEnv,
          storageDriver: config.storageDriver,
          storage: publicStorage,
          features: config.features
        };

        if (!isReady) {
          if (ctx.logger && typeof ctx.logger.warn === 'function') {
            ctx.logger.warn('health_storage_not_ready', {
              requestId: ctx.requestId,
              storageDriver: config.storageDriver,
              details: storage && storage.details ? storage.details : null
            });
          }
          return jsonError(
            'SERVICE_UNAVAILABLE',
            '依赖存储服务暂未就绪，服务当前处于降级状态',
            payload,
            503,
            ctx.requestId
          );
        }

        return jsonOk(payload, {}, 200, ctx.requestId);
      }
    }
  ];
}
