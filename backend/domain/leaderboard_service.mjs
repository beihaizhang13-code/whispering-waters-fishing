/**
 * 《微风垂钓物语 2.0》排行榜与反作弊审核服务 (backend/domain/leaderboard_service.mjs)
 * ----------------------------------------------------------------------------
 * 仅采信 audit_status = 'verified' 且源自服务端核验后 catch_logs / player_saves 的成绩。
 * 支持维度：species_weight / species_length / encyclopedia / wealth / bounty_master。
 */
import gameCatalog from '../../shared/game_catalog.js';

const VALID_BOARD_TYPES = new Set([
  'species_weight',
  'species_length',
  'encyclopedia',
  'wealth',
  'bounty_master'
]);

const VALID_METRICS = new Set(['weight', 'length']);

function createDomainError(code, message, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function parseLimit(rawLimit, fallback = 50) {
  if (rawLimit === undefined || rawLimit === null || rawLimit === '') return fallback;
  const num = Number(rawLimit);
  if (!Number.isFinite(num) || num < 1) {
    throw createDomainError('VALIDATION_ERROR', '分页参数 limit 必须为正整数', 400);
  }
  return Math.max(1, Math.min(100, Math.floor(num)));
}

function parseOffset(rawOffset, fallback = 0) {
  if (rawOffset === undefined || rawOffset === null || rawOffset === '') return fallback;
  const num = Number(rawOffset);
  if (!Number.isFinite(num) || num < 0) {
    throw createDomainError('VALIDATION_ERROR', '分页参数 offset 不能为负数', 400);
  }
  return Math.floor(num);
}

export function createLeaderboardService({ repositories, logger }) {
  return {
    async getBoard({ boardType, scopeKey = 'global', limit = 50, offset = 0 }) {
      if (typeof boardType !== 'string' || !VALID_BOARD_TYPES.has(boardType)) {
        throw createDomainError(
          'VALIDATION_ERROR',
          `无效的排行榜类型: ${String(boardType)}`,
          400
        );
      }

      const normalizedScope = typeof scopeKey === 'string' && scopeKey.trim()
        ? scopeKey.trim().slice(0, 64)
        : 'global';
      const safeLimit = parseLimit(limit, 50);
      const safeOffset = parseOffset(offset, 0);

      if ((boardType === 'species_weight' || boardType === 'species_length') && normalizedScope !== 'global') {
        if (!gameCatalog.FISH_BY_ID[normalizedScope]) {
          throw createDomainError('VALIDATION_ERROR', `未知鱼种 scopeKey: ${normalizedScope}`, 400);
        }
      }

      const result = await repositories.leaderboards.queryBoard({
        boardType,
        scopeKey: normalizedScope,
        limit: safeLimit,
        offset: safeOffset
      });

      return result;
    },

    async getSpeciesBoard({ fishId, metric = 'weight', limit = 50, offset = 0 }) {
      if (typeof fishId !== 'string' || !fishId.trim() || !gameCatalog.FISH_BY_ID[fishId.trim()]) {
        throw createDomainError('VALIDATION_ERROR', `未知鱼种 ID: ${String(fishId)}`, 400);
      }
      const cleanFishId = fishId.trim();
      const cleanMetric = typeof metric === 'string' && metric.trim() ? metric.trim() : 'weight';
      if (!VALID_METRICS.has(cleanMetric)) {
        throw createDomainError(
          'VALIDATION_ERROR',
          `无效的排行指标 metric: ${cleanMetric}，仅支持 weight 或 length`,
          400
        );
      }

      const boardType = cleanMetric === 'length' ? 'species_length' : 'species_weight';
      const safeLimit = parseLimit(limit, 50);
      const safeOffset = parseOffset(offset, 0);
      const fish = gameCatalog.FISH_BY_ID[cleanFishId];

      const board = await repositories.leaderboards.queryBoard({
        boardType,
        scopeKey: cleanFishId,
        limit: safeLimit,
        offset: safeOffset
      });

      return {
        ...board,
        metric: cleanMetric,
        fish: {
          id: fish.id,
          name: fish.name,
          rarity: fish.rarity
        }
      };
    },

    async getUserRankSummary({ userId }) {
      if (typeof userId !== 'string' || !userId.trim()) {
        throw createDomainError('VALIDATION_ERROR', '缺少有效的 userId', 400);
      }
      void logger;
      const ranks = await repositories.leaderboards.queryUserRankSummary(userId.trim());
      return {
        userId: userId.trim(),
        ranks
      };
    }
  };
}
