/**
 * 《微风垂钓物语 2.0》成就与水族箱分享路由 (backend/http/routes/social.mjs)
 */
import { readJsonBody } from '../middleware.mjs';
import { jsonOk } from '../response.mjs';

export function createSocialRoutes({ services }) {
  return [
    {
      method: 'GET',
      path: '/api/v1/achievements',
      milestone: 'M3',
      authRequired: true,
      idempotent: true,
      async handler(_req, ctx) {
        const userId = ctx.authUser.id || ctx.authUser.userId;
        const result = await services.social.listUserAchievements({ userId });
        return jsonOk(result, {}, 200, ctx.requestId);
      }
    },
    {
      method: 'POST',
      path: '/api/v1/achievements/:code/claim',
      milestone: 'M3',
      authRequired: true,
      idempotent: true,
      async handler(_req, ctx) {
        const userId = ctx.authUser.id || ctx.authUser.userId;
        const result = await services.social.claimAchievementReward({
          userId,
          code: ctx.params.code,
          idempotencyKey: ctx.idempotencyKey
        });
        return jsonOk(result, {}, 200, ctx.requestId);
      }
    },
    {
      method: 'POST',
      path: '/api/v1/aquarium/shares',
      milestone: 'M3',
      authRequired: true,
      idempotent: false,
      async handler(req, ctx) {
        const userId = ctx.authUser.id || ctx.authUser.userId;
        const body = await readJsonBody(req);
        const result = await services.social.createAquariumShare({
          userId,
          title: body.title
        });
        return jsonOk(result, {}, 201, ctx.requestId);
      }
    },
    {
      method: 'GET',
      path: '/api/v1/aquarium/shares/:shareCode',
      milestone: 'M3',
      authRequired: false,
      idempotent: true,
      async handler(_req, ctx) {
        const result = await services.social.getAquariumShareByCode({
          shareCode: ctx.params.shareCode
        });
        return jsonOk(result, {}, 200, ctx.requestId);
      }
    },
    {
      method: 'POST',
      path: '/api/v1/aquarium/shares/:shareCode/like',
      milestone: 'M3',
      authRequired: false,
      idempotent: true,
      async handler(_req, ctx) {
        const viewerKey = ctx.idempotencyKey
          ? `idem:${ctx.idempotencyKey}`
          : (ctx.authUser ? `user:${ctx.authUser.id || ctx.authUser.userId}` : null);
        const result = await services.social.likeAquariumShare({
          shareCode: ctx.params.shareCode,
          viewerKey
        });
        return jsonOk(result, {}, 200, ctx.requestId);
      }
    }
  ];
}
