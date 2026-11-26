/**
 * 《微风垂钓物语 2.0》排行榜路由 (backend/http/routes/leaderboard.mjs)
 */
import { jsonOk } from '../response.mjs';

export function createLeaderboardRoutes({ services }) {
  return [
    {
      method: 'GET',
      path: '/api/v1/leaderboards/me',
      milestone: 'M3',
      authRequired: true,
      idempotent: true,
      async handler(_req, ctx) {
        const userId = ctx.authUser.id || ctx.authUser.userId;
        const result = await services.leaderboard.getUserRankSummary({ userId });
        return jsonOk(result, {}, 200, ctx.requestId);
      }
    },
    {
      method: 'GET',
      path: '/api/v1/leaderboards/species/:fishId',
      milestone: 'M3',
      authRequired: false,
      idempotent: true,
      async handler(_req, ctx) {
        const result = await services.leaderboard.getSpeciesBoard({
          fishId: ctx.params.fishId,
          metric: ctx.query.get('metric') || 'weight',
          limit: ctx.query.get('limit') ?? 50,
          offset: ctx.query.get('offset') ?? 0
        });
        return jsonOk(result, {}, 200, ctx.requestId);
      }
    },
    {
      method: 'GET',
      path: '/api/v1/leaderboards/:boardType',
      milestone: 'M3',
      authRequired: false,
      idempotent: true,
      async handler(_req, ctx) {
        const scopeKey = ctx.query.get('scopeKey') || ctx.query.get('scope') || 'global';
        const result = await services.leaderboard.getBoard({
          boardType: ctx.params.boardType,
          scopeKey,
          limit: ctx.query.get('limit') ?? 50,
          offset: ctx.query.get('offset') ?? 0
        });
        return jsonOk(result, {}, 200, ctx.requestId);
      }
    }
  ];
}
