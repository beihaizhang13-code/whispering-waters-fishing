/**
 * 《微风垂钓物语 2.0》核心玩法校验与经济交易路由 (backend/http/routes/gameplay.mjs)
 */
import { readJsonBody } from '../middleware.mjs';
import { jsonError, jsonOk } from '../response.mjs';

export function createGameplayRoutes({ services } = {}) {
  function resolveServices(ctx) {
    return services || ctx.services;
  }

  function resolveIdempotencyKey(ctx, body) {
    if (ctx.idempotencyKey) return ctx.idempotencyKey;
    if (body && typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()) {
      return body.idempotencyKey.trim();
    }
    return null;
  }

  return [
    {
      method: 'POST',
      path: '/api/v1/gameplay/catches',
      milestone: 'M2',
      authRequired: true,
      idempotent: true,
      async handler(req, ctx) {
        if (!ctx.authUser?.id) {
          return jsonError('UNAUTHORIZED', '未登录或会话凭证已失效', null, 401, ctx.requestId);
        }
        const body = await readJsonBody(req);
        const svc = resolveServices(ctx);
        const result = await svc.economy.submitCatchAndDisposition({
          userId: ctx.authUser.id,
          catchPayload: body,
          disposition: body.disposition,
          idempotencyKey: resolveIdempotencyKey(ctx, body),
          clientIpHash: ctx.clientIpHash,
          requestId: ctx.requestId
        });
        return jsonOk(result, {}, 200, ctx.requestId);
      }
    },
    {
      method: 'POST',
      path: '/api/v1/gameplay/shop/purchase',
      milestone: 'M2',
      authRequired: true,
      idempotent: true,
      async handler(req, ctx) {
        if (!ctx.authUser?.id) {
          return jsonError('UNAUTHORIZED', '未登录或会话凭证已失效', null, 401, ctx.requestId);
        }
        const body = await readJsonBody(req);
        const svc = resolveServices(ctx);
        const result = await svc.economy.purchaseShopItem({
          userId: ctx.authUser.id,
          itemType: body.itemType,
          itemId: body.itemId,
          quantity: body.quantity,
          idempotencyKey: resolveIdempotencyKey(ctx, body)
        });
        return jsonOk(result, {}, 200, ctx.requestId);
      }
    },
    {
      method: 'POST',
      path: '/api/v1/gameplay/orders/deliver',
      milestone: 'M2',
      authRequired: true,
      idempotent: true,
      async handler(req, ctx) {
        if (!ctx.authUser?.id) {
          return jsonError('UNAUTHORIZED', '未登录或会话凭证已失效', null, 401, ctx.requestId);
        }
        const body = await readJsonBody(req);
        const svc = resolveServices(ctx);
        const result = await svc.economy.deliverBountyOrder({
          userId: ctx.authUser.id,
          orderId: body.orderId,
          fishUid: body.fishUid,
          source: body.source,
          idempotencyKey: resolveIdempotencyKey(ctx, body)
        });
        return jsonOk(result, {}, 200, ctx.requestId);
      }
    },
    {
      method: 'POST',
      path: '/api/v1/gameplay/aquarium/claim-offline',
      milestone: 'M2',
      authRequired: true,
      idempotent: true,
      async handler(req, ctx) {
        if (!ctx.authUser?.id) {
          return jsonError('UNAUTHORIZED', '未登录或会话凭证已失效', null, 401, ctx.requestId);
        }
        const body = await readJsonBody(req);
        const svc = resolveServices(ctx);
        const result = await svc.aquarium.claimOfflineIncome({
          userId: ctx.authUser.id,
          idempotencyKey: resolveIdempotencyKey(ctx, body)
        });
        return jsonOk(result, {}, 200, ctx.requestId);
      }
    },
    {
      method: 'POST',
      path: '/api/v1/gameplay/aquarium/feed',
      milestone: 'M2',
      authRequired: true,
      idempotent: true,
      async handler(req, ctx) {
        if (!ctx.authUser?.id) {
          return jsonError('UNAUTHORIZED', '未登录或会话凭证已失效', null, 401, ctx.requestId);
        }
        const body = await readJsonBody(req);
        const svc = resolveServices(ctx);
        const result = await svc.aquarium.feedAquarium({
          userId: ctx.authUser.id,
          idempotencyKey: resolveIdempotencyKey(ctx, body)
        });
        return jsonOk(result, {}, 200, ctx.requestId);
      }
    },
    {
      method: 'POST',
      path: '/api/v1/gameplay/aquarium/upgrade',
      milestone: 'M2',
      authRequired: true,
      idempotent: true,
      async handler(req, ctx) {
        if (!ctx.authUser?.id) {
          return jsonError('UNAUTHORIZED', '未登录或会话凭证已失效', null, 401, ctx.requestId);
        }
        const body = await readJsonBody(req);
        const svc = resolveServices(ctx);
        const result = await svc.aquarium.upgradeAquarium({
          userId: ctx.authUser.id,
          targetLevel: body.targetLevel,
          idempotencyKey: resolveIdempotencyKey(ctx, body)
        });
        return jsonOk(result, {}, 200, ctx.requestId);
      }
    }
  ];
}
