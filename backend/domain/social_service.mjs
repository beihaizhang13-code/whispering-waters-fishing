/**
 * 《微风垂钓物语 2.0》成就里程碑与水族箱分享服务 (backend/domain/social_service.mjs)
 */
import crypto from 'node:crypto';
import gameCatalog from '../../shared/game_catalog.js';
import saveSchema from '../../shared/save_schema.js';

const SHARE_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_LIKE_CACHE_ENTRIES = 10000;

function createDomainError(code, message, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function generateShortShareCode(length = 6) {
  const bytes = crypto.randomBytes(length);
  let suffix = '';
  for (let i = 0; i < length; i++) {
    suffix += SHARE_CODE_ALPHABET[bytes[i] % SHARE_CODE_ALPHABET.length];
  }
  return `WWF-${suffix}`;
}

function sanitizeAquariumSnapshot(rawSnapshot) {
  const safeSave = saveSchema.sanitizeAndValidateSave(
    rawSnapshot && typeof rawSnapshot === 'object' ? rawSnapshot : saveSchema.createDefaultPlayerState(),
    gameCatalog
  ).sanitized;

  const aquariumLevel = Math.max(1, Math.min(5, Math.floor(Number(safeSave.aquariumLevel) || 1)));
  const levelInfo = gameCatalog.getAquariumLevelInfo(aquariumLevel);
  const themeIndex = Math.max(0, Math.min(2, Math.floor(Number(safeSave.themeIndex) || 0)));

  const fish = (Array.isArray(safeSave.aquarium) ? safeSave.aquarium : [])
    .slice(0, levelInfo.capacity)
    .map(item => {
      const def = gameCatalog.getFishById(item.fishId);
      return {
        fishId: item.fishId,
        name: def?.name || item.name,
        rarity: def?.rarity || item.rarity,
        lengthCm: Number(item.lengthCm),
        weightKg: Number(item.weightKg),
        isShiny: Boolean(item.isShiny),
        shape: def?.shape || 'oval',
        caughtAt: item.caughtAt || null
      };
    });

  return {
    aquariumLevel,
    snapshotObj: {
      aquariumLevel,
      aquariumName: levelInfo.name,
      capacity: levelInfo.capacity,
      themeIndex,
      fish
    }
  };
}

function toPublicShareView(share) {
  return {
    shareCode: share.shareCode,
    title: share.title,
    ownerDisplayName: share.ownerDisplayName,
    aquariumLevel: share.aquariumLevel,
    snapshot: share.snapshot,
    likesCount: Number(share.likesCount || 0),
    viewsCount: Number(share.viewsCount || 0),
    createdAt: share.createdAt,
    updatedAt: share.updatedAt
  };
}

export function createSocialService({ repositories, logger }) {
  const recentLikeDedupe = new Map();

  function rememberLike(cacheKey, likesCount) {
    if (recentLikeDedupe.size >= MAX_LIKE_CACHE_ENTRIES) {
      const oldestKey = recentLikeDedupe.keys().next().value;
      if (oldestKey !== undefined) {
        recentLikeDedupe.delete(oldestKey);
      }
    }
    recentLikeDedupe.set(cacheKey, { likesCount, at: Date.now() });
  }

  return {
    async listUserAchievements({ userId }) {
      if (typeof userId !== 'string' || !userId.trim()) {
        throw createDomainError('VALIDATION_ERROR', '缺少有效的 userId', 400);
      }
      const cleanUserId = userId.trim();
      const achievements = await repositories.social.listUserAchievements(cleanUserId);
      const unlockedCount = achievements.filter(a => Boolean(a.unlockedAt)).length;
      const claimedCount = achievements.filter(a => Boolean(a.claimedAt)).length;

      return {
        achievements,
        total: achievements.length,
        unlockedCount,
        claimedCount
      };
    },

    async claimAchievementReward({ userId, code, idempotencyKey }) {
      if (typeof userId !== 'string' || !userId.trim()) {
        throw createDomainError('VALIDATION_ERROR', '缺少有效的 userId', 400);
      }
      if (typeof code !== 'string' || !code.trim()) {
        throw createDomainError('VALIDATION_ERROR', '缺少有效的成就编码 code', 400);
      }
      if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
        throw createDomainError('VALIDATION_ERROR', '领取成就奖励必须提供 Idempotency-Key 请求头', 400);
      }

      const cleanUserId = userId.trim();
      const cleanCode = code.trim();
      const cleanKey = idempotencyKey.trim();
      const requestDigest = crypto
        .createHash('sha256')
        .update(JSON.stringify({ action: 'achievement_claim', userId: cleanUserId, code: cleanCode }))
        .digest('hex');

      return repositories.social.claimAchievementAtomic({
        userId: cleanUserId,
        code: cleanCode,
        idempotencyKey: cleanKey,
        requestDigest,
        nowIso: new Date().toISOString()
      });
    },

    async createAquariumShare({ userId, title }) {
      if (typeof userId !== 'string' || !userId.trim()) {
        throw createDomainError('VALIDATION_ERROR', '缺少有效的 userId', 400);
      }
      if (title !== undefined && title !== null && typeof title !== 'string') {
        throw createDomainError('VALIDATION_ERROR', '分享标题 title 必须为字符串', 400);
      }

      const cleanUserId = userId.trim();
      let user = null;
      let save = null;

      if (typeof repositories.social.getUserAquariumProfile === 'function') {
        const profile = await repositories.social.getUserAquariumProfile(cleanUserId);
        if (profile) {
          user = profile.user;
          save = profile.save;
        }
      } else {
        if (repositories.users && typeof repositories.users.findById === 'function') {
          user = await repositories.users.findById(cleanUserId);
        }
        if (repositories.saves && typeof repositories.saves.getByUserId === 'function') {
          save = await repositories.saves.getByUserId(cleanUserId);
        }
      }

      if (!user) {
        throw createDomainError('NOT_FOUND', '未找到玩家账号', 404);
      }

      const ownerDisplayName = (user.displayName || user.display_name || '无名钓友').trim() || '无名钓友';
      const rawTitle = typeof title === 'string' ? title.replace(/[\r\n\t]+/g, ' ').trim() : '';
      const finalTitle = (rawTitle || `${ownerDisplayName} 的梦幻水族箱`).slice(0, 60);

      const { aquariumLevel, snapshotObj } = sanitizeAquariumSnapshot(save?.snapshot || null);
      const snapshotJson = JSON.stringify(snapshotObj);
      const nowIso = new Date().toISOString();

      let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const id = `share_${crypto.randomUUID()}`;
        const shareCode = generateShortShareCode(6);
        try {
          const created = await repositories.social.createAquariumShare({
            id,
            shareCode,
            userId: cleanUserId,
            title: finalTitle,
            ownerDisplayName,
            aquariumLevel,
            snapshotJson,
            nowIso
          });
          return {
            ...toPublicShareView(created),
            achievementProgress: created.achievementProgress || null
          };
        } catch (err) {
          lastErr = err;
          const msg = String(err?.message || '');
          if (!msg.includes('UNIQUE') && !msg.includes('share_code')) {
            throw err;
          }
        }
      }

      if (logger && typeof logger.error === 'function') {
        logger.error('aquarium_share_code_collision', { userId: cleanUserId });
      }
      throw lastErr || createDomainError('INTERNAL_ERROR', '生成水族箱分享码失败，请重试', 500);
    },

    async getAquariumShareByCode({ shareCode }) {
      if (typeof shareCode !== 'string' || !shareCode.trim()) {
        throw createDomainError('VALIDATION_ERROR', '缺少有效的分享码 shareCode', 400);
      }
      const cleanCode = shareCode.trim().slice(0, 32);
      const share = await repositories.social.getAquariumShareByCode(cleanCode, true);
      if (!share) {
        throw createDomainError('NOT_FOUND', '未找到对应的水族箱分享卡片', 404);
      }
      return toPublicShareView(share);
    },

    async likeAquariumShare({ shareCode, viewerKey }) {
      if (typeof shareCode !== 'string' || !shareCode.trim()) {
        throw createDomainError('VALIDATION_ERROR', '缺少有效的分享码 shareCode', 400);
      }
      const cleanCode = shareCode.trim().slice(0, 32);
      const cleanViewerKey = typeof viewerKey === 'string' && viewerKey.trim() ? viewerKey.trim() : null;

      if (cleanViewerKey) {
        const cacheKey = `${cleanCode}:${cleanViewerKey}`;
        if (recentLikeDedupe.has(cacheKey)) {
          const current = await repositories.social.getAquariumShareByCode(cleanCode, false);
          if (!current) {
            throw createDomainError('NOT_FOUND', '未找到对应的水族箱分享卡片', 404);
          }
          return {
            shareCode: current.shareCode,
            likesCount: Number(current.likesCount || 0),
            idempotentReplay: true
          };
        }

        const res = await repositories.social.likeAquariumShare(cleanCode);
        rememberLike(cacheKey, res.likesCount);
        return {
          ...res,
          idempotentReplay: false
        };
      }

      const res = await repositories.social.likeAquariumShare(cleanCode);
      return {
        ...res,
        idempotentReplay: false
      };
    }
  };
}
