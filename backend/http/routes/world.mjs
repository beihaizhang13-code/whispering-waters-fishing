/**
 * 《微风垂钓物语 2.0》全服天气与黄金鱼潮路由 (backend/http/routes/world.mjs)
 */
import { readJsonBody } from '../middleware.mjs';
import { jsonError, jsonOk } from '../response.mjs';

export function createWorldRoutes({ services }) {
  return [
    {
      method: 'GET',
      path: '/api/v1/world/state',
      milestone: 'M0',
      authRequired: false,
      idempotent: true,
      async handler(_req, ctx) {
        const state = await services.worldEvent.getWorldState();
        return jsonOk(state, {}, 200, ctx.requestId);
      }
    },
    {
      method: 'POST',
      path: '/api/v1/world/golden-tide/summon',
      milestone: 'M3',
      authRequired: true,
      idempotent: true,
      async handler(req, ctx) {
        const userId = ctx.authUser?.id || ctx.authUser?.userId;
        if (!ctx.authUser || !userId) {
          return jsonError('UNAUTHORIZED', '未登录或会话凭证已失效', null, 401, ctx.requestId);
        }
        const body = await readJsonBody(req);
        const paymentMethod = body.paymentMethod !== undefined ? body.paymentMethod : 'luck';
        const idempotencyKey = ctx.idempotencyKey || req.headers.get('idempotency-key') || '';
        const result = await services.worldEvent.summonGoldenTide({
          userId,
          paymentMethod,
          idempotencyKey
        });
        return jsonOk(result, {}, 200, ctx.requestId);
      }
    }
  ];
}
