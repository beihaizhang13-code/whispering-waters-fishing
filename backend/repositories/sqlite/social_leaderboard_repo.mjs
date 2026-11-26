/**
 * 《微风垂钓物语 2.0》SQLite 排行榜、成就与水族箱分享仓储 (backend/repositories/sqlite/social_leaderboard_repo.mjs)
 */
import {
  createDomainError,
  findLedgerInDb,
  readPlayerSaveRow,
  recordLedgerInTx,
  runInTransaction,
  updatePlayerSaveInTx,
  upsertAchievementProgressInTx,
  upsertLeaderboardInTx
} from './helpers.mjs';

function parseJsonSafe(raw, fallback = {}) {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function mapAchievementRow(row) {
  return {
    code: row.code,
    title: row.title,
    description: row.description,
    category: row.category,
    targetValue: Number(row.target_value),
    rewardCoins: Number(row.reward_coins),
    rewardLuck: Number(row.reward_luck),
    progressValue: Number(row.progress_value || 0),
    unlockedAt: row.unlocked_at || null,
    claimedAt: row.claimed_at || null,
    isUnlocked: Boolean(row.unlocked_at),
    isClaimed: Boolean(row.claimed_at)
  };
}

function mapAquariumShareRow(row) {
  return {
    id: row.id,
    shareCode: row.share_code,
    userId: row.user_id,
    title: row.title,
    ownerDisplayName: row.owner_display_name,
    aquariumLevel: Number(row.aquarium_level),
    snapshot: parseJsonSafe(row.snapshot_json, {}),
    likesCount: Number(row.likes_count || 0),
    viewsCount: Number(row.views_count || 0),
    isPublic: Boolean(row.is_public),
    expiresAt: row.expires_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createSqliteSocialAndLeaderboardRepos(ensureDb) {
  const leaderboards = {
    async queryBoard({ boardType, scopeKey = 'global', limit = 50, offset = 0 }) {
      const db = ensureDb();
      const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
      const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));

      const countRow = db.prepare(`
        SELECT COUNT(*) AS total
        FROM leaderboard_records
        WHERE board_type = ? AND scope_key = ? AND audit_status = 'verified'
      `).get(boardType, scopeKey);

      const rows = db.prepare(`
        SELECT id, user_id, board_type, scope_key, score_numeric, display_name_snapshot,
               is_shiny, metadata_json, achieved_at, updated_at
        FROM leaderboard_records
        WHERE board_type = ? AND scope_key = ? AND audit_status = 'verified'
        ORDER BY score_numeric DESC, achieved_at ASC
        LIMIT ? OFFSET ?
      `).all(boardType, scopeKey, safeLimit, safeOffset);

      const items = rows.map((row, idx) => ({
        rank: safeOffset + idx + 1,
        userId: row.user_id,
        boardType: row.board_type,
        scopeKey: row.scope_key,
        displayName: row.display_name_snapshot,
        score: Number(row.score_numeric),
        isShiny: Boolean(row.is_shiny),
        metadata: parseJsonSafe(row.metadata_json, {}),
        achievedAt: row.achieved_at,
        updatedAt: row.updated_at
      }));

      return {
        boardType,
        scopeKey,
        total: Number(countRow?.total || 0),
        limit: safeLimit,
        offset: safeOffset,
        items
      };
    },

    async queryUserRankSummary(userId) {
      const db = ensureDb();
      const rows = db.prepare(`
        SELECT
          r.board_type,
          r.scope_key,
          r.score_numeric,
          r.display_name_snapshot,
          r.is_shiny,
          r.metadata_json,
          r.achieved_at,
          r.updated_at,
          (
            SELECT COUNT(*) + 1
            FROM leaderboard_records o
            WHERE o.board_type = r.board_type
              AND o.scope_key = r.scope_key
              AND o.audit_status = 'verified'
              AND (
                o.score_numeric > r.score_numeric
                OR (o.score_numeric = r.score_numeric AND o.achieved_at < r.achieved_at)
              )
          ) AS rank,
          (
            SELECT COUNT(*)
            FROM leaderboard_records o
            WHERE o.board_type = r.board_type
              AND o.scope_key = r.scope_key
              AND o.audit_status = 'verified'
          ) AS total
        FROM leaderboard_records r
        WHERE r.user_id = ? AND r.audit_status = 'verified'
        ORDER BY r.board_type ASC, r.scope_key ASC
      `).all(userId);

      return rows.map(row => ({
        boardType: row.board_type,
        scopeKey: row.scope_key,
        score: Number(row.score_numeric),
        rank: Number(row.rank),
        total: Number(row.total),
        displayName: row.display_name_snapshot,
        isShiny: Boolean(row.is_shiny),
        metadata: parseJsonSafe(row.metadata_json, {}),
        achievedAt: row.achieved_at,
        updatedAt: row.updated_at
      }));
    }
  };

  const social = {
    async listUserAchievements(userId) {
      const db = ensureDb();
      const rows = db.prepare(`
        SELECT
          d.code,
          d.title,
          d.description,
          d.category,
          d.target_value,
          d.reward_coins,
          d.reward_luck,
          d.sort_order,
          COALESCE(u.progress_value, 0) AS progress_value,
          u.unlocked_at,
          u.claimed_at
        FROM achievement_definitions d
        LEFT JOIN user_achievements u
          ON u.achievement_code = d.code AND u.user_id = ?
        ORDER BY d.sort_order ASC, d.code ASC
      `).all(userId);

      return rows.map(mapAchievementRow);
    },

    async claimAchievementAtomic({ userId, code, idempotencyKey, requestDigest, nowIso }) {
      const db = ensureDb();
      const effectiveNow = nowIso || new Date().toISOString();

      return runInTransaction(db, () => {
        // 1. 幂等校验：同键同摘要重放，异摘要抛 409 IDEMPOTENCY_CONFLICT
        const existingLedger = findLedgerInDb(db, userId, idempotencyKey);
        if (existingLedger) {
          const prevDigest = existingLedger.metadata?.requestDigest;
          if (existingLedger.eventType !== 'achievement_claim' || prevDigest !== requestDigest) {
            throw createDomainError('IDEMPOTENCY_CONFLICT', '重复的幂等操作键或请求参数不一致', 409);
          }
          const def = db.prepare(`
            SELECT code, title, reward_coins, reward_luck
            FROM achievement_definitions
            WHERE code = ?
          `).get(code);
          const ua = db.prepare(`
            SELECT claimed_at
            FROM user_achievements
            WHERE user_id = ? AND achievement_code = ?
          `).get(userId, code);
          const currentSave = readPlayerSaveRow(db, userId);
          return {
            idempotentReplay: true,
            code,
            title: def?.title || existingLedger.metadata?.title || code,
            rewardCoins: existingLedger.coinsDelta,
            rewardLuck: existingLedger.luckDelta,
            claimedAt: ua?.claimed_at || existingLedger.createdAt,
            coins: currentSave ? currentSave.coins : existingLedger.coinsAfter,
            luckPoints: currentSave ? currentSave.luckPoints : existingLedger.luckAfter,
            revision: currentSave ? currentSave.revision : null,
            ledgerId: existingLedger.id
          };
        }

        // 2. 校验成就定义及玩家解锁/领奖状态
        const def = db.prepare(`
          SELECT code, title, reward_coins, reward_luck, target_value
          FROM achievement_definitions
          WHERE code = ?
        `).get(code);
        if (!def) {
          throw createDomainError('NOT_FOUND', `未找到成就定义: ${code}`, 404);
        }

        const ua = db.prepare(`
          SELECT progress_value, unlocked_at, claimed_at
          FROM user_achievements
          WHERE user_id = ? AND achievement_code = ?
        `).get(userId, code);
        if (!ua || !ua.unlocked_at) {
          throw createDomainError('VALIDATION_ERROR', '该成就尚未解锁，无法领取奖励', 400);
        }
        if (ua.claimed_at !== null && ua.claimed_at !== undefined) {
          throw createDomainError('VALIDATION_ERROR', '该成就奖励已领取，不可重复领取', 400);
        }

        // 3. 标记已领取
        db.prepare(`
          UPDATE user_achievements
          SET claimed_at = ?
          WHERE user_id = ? AND achievement_code = ?
        `).run(effectiveNow, userId, code);

        // 4. 更新存档金币与幸运值，记录账本并刷新 wealth 榜单
        const saveRow = readPlayerSaveRow(db, userId);
        if (!saveRow) {
          throw createDomainError('NOT_FOUND', '未找到玩家云存档，无法发放成就奖励', 404);
        }

        const rewardCoins = Math.max(0, Number(def.reward_coins || 0));
        const rewardLuck = Math.max(0, Number(def.reward_luck || 0));
        const nextPayload = {
          ...saveRow.snapshot,
          coins: Number(saveRow.coins || 0) + rewardCoins,
          luckPoints: Number(saveRow.luckPoints || 0) + rewardLuck
        };
        const updatedSave = updatePlayerSaveInTx(db, userId, nextPayload, { nowIso: effectiveNow });
        if (!updatedSave) {
          throw createDomainError('INTERNAL_ERROR', '更新玩家存档失败', 500);
        }

        const ledger = recordLedgerInTx(db, {
          userId,
          idempotencyKey,
          eventType: 'achievement_claim',
          coinsDelta: rewardCoins,
          luckDelta: rewardLuck,
          coinsAfter: updatedSave.coins,
          luckAfter: updatedSave.luckPoints,
          referenceId: code,
          metadata: {
            requestDigest,
            achievementCode: code,
            title: def.title
          },
          createdAt: effectiveNow
        });

        const userRow = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId);
        upsertLeaderboardInTx(db, {
          userId,
          boardType: 'wealth',
          scopeKey: 'global',
          scoreNumeric: updatedSave.coins,
          displayNameSnapshot: userRow?.display_name || '无名钓友',
          nowIso: effectiveNow
        });

        return {
          idempotentReplay: false,
          code: def.code,
          title: def.title,
          rewardCoins,
          rewardLuck,
          claimedAt: effectiveNow,
          coins: updatedSave.coins,
          luckPoints: updatedSave.luckPoints,
          revision: updatedSave.revision,
          ledgerId: ledger.id
        };
      });
    },

    async getUserAquariumProfile(userId) {
      const db = ensureDb();
      const userRow = db.prepare(`
        SELECT id, display_name, avatar_frame, status
        FROM users
        WHERE id = ?
      `).get(userId);
      if (!userRow || userRow.status === 'deleted') {
        return null;
      }
      const saveRow = readPlayerSaveRow(db, userId);
      return {
        user: {
          id: userRow.id,
          displayName: userRow.display_name,
          avatarFrame: userRow.avatar_frame
        },
        save: saveRow
      };
    },

    async createAquariumShare({ id, shareCode, userId, title, ownerDisplayName, aquariumLevel, snapshotJson, nowIso }) {
      const db = ensureDb();
      const effectiveNow = nowIso || new Date().toISOString();

      return runInTransaction(db, () => {
        db.prepare(`
          INSERT INTO aquarium_shares (
            id, share_code, user_id, title, owner_display_name, aquarium_level,
            snapshot_json, likes_count, views_count, is_public, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 1, ?, ?)
        `).run(
          id,
          shareCode,
          userId,
          title,
          ownerDisplayName,
          aquariumLevel,
          snapshotJson,
          effectiveNow,
          effectiveNow
        );

        const achievementProgress = upsertAchievementProgressInTx(db, {
          userId,
          code: 'aquarium_share',
          progressValue: 1,
          unlockedAt: effectiveNow,
          mode: 'add'
        });

        return {
          id,
          shareCode,
          userId,
          title,
          ownerDisplayName,
          aquariumLevel,
          snapshot: parseJsonSafe(snapshotJson, {}),
          likesCount: 0,
          viewsCount: 0,
          isPublic: true,
          expiresAt: null,
          createdAt: effectiveNow,
          updatedAt: effectiveNow,
          achievementProgress
        };
      });
    },

    async getAquariumShareByCode(shareCode, incrementViews = true) {
      const db = ensureDb();
      const nowIso = new Date().toISOString();

      return runInTransaction(db, () => {
        const row = db.prepare(`
          SELECT id, share_code, user_id, title, owner_display_name, aquarium_level,
                 snapshot_json, likes_count, views_count, is_public, expires_at,
                 created_at, updated_at
          FROM aquarium_shares
          WHERE share_code = ?
            AND is_public = 1
            AND (expires_at IS NULL OR expires_at > ?)
        `).get(shareCode, nowIso);

        if (!row) return null;

        if (incrementViews) {
          db.prepare(`
            UPDATE aquarium_shares
            SET views_count = views_count + 1
            WHERE id = ?
          `).run(row.id);
          row.views_count = Number(row.views_count || 0) + 1;
        }

        return mapAquariumShareRow(row);
      });
    },

    async likeAquariumShare(shareCode) {
      const db = ensureDb();
      const nowIso = new Date().toISOString();

      return runInTransaction(db, () => {
        const row = db.prepare(`
          SELECT id, share_code, likes_count
          FROM aquarium_shares
          WHERE share_code = ?
            AND is_public = 1
            AND (expires_at IS NULL OR expires_at > ?)
        `).get(shareCode, nowIso);

        if (!row) {
          throw createDomainError('NOT_FOUND', '未找到对应的水族箱分享卡片', 404);
        }

        const nextLikes = Number(row.likes_count || 0) + 1;
        db.prepare(`
          UPDATE aquarium_shares
          SET likes_count = ?, updated_at = ?
          WHERE id = ?
        `).run(nextLikes, nowIso, row.id);

        return {
          shareCode: row.share_code,
          likesCount: nextLikes
        };
      });
    }
  };

  return { leaderboards, social };
}
