/**
 * 《微风垂钓物语 2.0》云存档与导出导入路由 (backend/http/routes/save.mjs)
 */
import { readJsonBody } from '../middleware.mjs';
import { jsonError, jsonOk } from '../response.mjs';

function handleRouteError(err, ctx) {
  if (err && err.code) {
    return jsonError(
      err.code,
      err.message,
      err.details || null,
      err.status || null,
      ctx.requestId
    );
  }
  throw err;
}

export function createSaveRoutes({ services }) {
  return [
    {
      method: 'GET',
      path: '/api/v1/save',
      milestone: 'M1',
      authRequired: true,
      idempotent: true,
      async handler(_req, ctx) {
        try {
          const result = await services.saveMerge.getCloudSave({ userId: ctx.authUser.id });
          return jsonOk(result, {}, 200, ctx.requestId);
        } catch (err) {
          return handleRouteError(err, ctx);
        }
      }
    },
    {
      method: 'PUT',
      path: '/api/v1/save',
      milestone: 'M1',
      authRequired: true,
      idempotent: true,
      async handler(req, ctx) {
        try {
          const body = await readJsonBody(req);
          const result = await services.saveMerge.putCloudSave({
            userId: ctx.authUser.id,
            baseRevision: body.baseRevision,
            snapshot: body.snapshot
          });
          return jsonOk(result, {}, 200, ctx.requestId);
        } catch (err) {
          return handleRouteError(err, ctx);
        }
      }
    },
    {
      method: 'POST',
      path: '/api/v1/save/merge',
      milestone: 'M1',
      authRequired: true,
      idempotent: false,
      async handler(req, ctx) {
        try {
          const body = await readJsonBody(req);
          const localSnapshot = body.localSnapshot ?? body.snapshot ?? body.localSave;
          const strategy = body.strategy || 'safe_union';
          const result = await services.saveMerge.mergeSnapshots({
            userId: ctx.authUser.id,
            localSnapshot,
            strategy
          });
          return jsonOk(result, {}, 200, ctx.requestId);
        } catch (err) {
          return handleRouteError(err, ctx);
        }
      }
    },
    {
      method: 'GET',
      path: '/api/v1/save/export',
      milestone: 'M1',
      authRequired: true,
      idempotent: true,
      async handler(_req, ctx) {
        try {
          const bundle = await services.saveMerge.exportSaveBundle({ userId: ctx.authUser.id });
          return jsonOk(bundle, {}, 200, ctx.requestId);
        } catch (err) {
          return handleRouteError(err, ctx);
        }
      }
    },
    {
      method: 'POST',
      path: '/api/v1/save/import',
      milestone: 'M1',
      authRequired: true,
      idempotent: false,
      async handler(req, ctx) {
        try {
          const body = await readJsonBody(req);
          const bundle = body.bundle || body;
          const result = await services.saveMerge.importSaveBundle({
            userId: ctx.authUser.id,
            bundle
          });
          return jsonOk(result, {}, 200, ctx.requestId);
        } catch (err) {
          return handleRouteError(err, ctx);
        }
      }
    }
  ];
}
