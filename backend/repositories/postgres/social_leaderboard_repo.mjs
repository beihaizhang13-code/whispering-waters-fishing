/**
 * 《微风垂钓物语 2.0》PostgreSQL 排行榜、成就与水族箱分享仓储 (backend/repositories/postgres/social_leaderboard_repo.mjs)
 */
import {
  createDomainError,
  findLedgerPg,
  parseJsonField,
  readPlayerSaveRowPg,
  recordLedgerPgInTx,
  runInPgTransaction,
  toIsoString,
  updatePlayerSavePgInTx,
  upsertAchievementProgressPgInTx,
  upsertLeaderboardPgInTx
} from './helpers.mjs';

function mapAchievementRow(row) {
  const unlockedAt = toIsoString(row.unlocked_at);
  const claimedAt = toIsoString(row.claimed_at);
  return {
    code: row.code,
    title: row.title,
    description: row.description,
    category: row.category,
    targetValue: Number(row.target_value),
    rewardCoins: Number(row.reward_coins),
    rewardLuck: Number(row.reward_luck),
    progressValue: Number(row.progress_value || 0),
    unlockedAt,
    claimedAt,
    isUnlocked: Boolean(unlockedAt),
    isClaimed: Boolean(claimedAt)
  };
}

function mapAquariumShareRow(row) {
  const snapshot = parseJsonField(row.snapshot_json, {});
  return {
    id: row.id,
    shareCode: row.share_code,
    userId: row.user_id,
    title: row.title,
    ownerDisplayName: row.owner_display_name,
    aquariumLevel: Number(row.aquarium_level),
    snapshot: snapshot && typeof snapshot === 'object' ? snapshot : {},
    likesCount: Number(row.likes_count || 0),
    viewsCount: Number(row.views_count || 0),
    isPublic: Boolean(row.is_public),
    expiresAt: toIsoString(row.expires_at),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

export function createPostgresSocialAndLeaderboardRepos(getPool) {
  const leaderboards = {
    async queryBoard({ boardType, scopeKey = 'global', limit = 50, offset = 0 }) {
      const pool = await getPool();
      const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
      const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));

      const countRes = await pool.query(`
        SELECT COUNT(*) AS total
        FROM leaderboard_records
        WHERE board_type = $1 AND scope_key = $2 AND audit_status = 'verified'
      `, [boardType, scopeKey]);
      const countRow = countRes?.rows?.[0];

      const rowsRes = await pool.query(`
        SELECT id, user_id, board_type, scope_key, score_numeric, display_name_snapshot,
               is_shiny, metadata_json, achieved_at, updated_at
        FROM leaderboard_records
        WHERE board_type = $1 AND scope_key = $2 AND audit_status = 'verified'
        ORDER BY score_numeric DESC, achieved_at ASC
        LIMIT $3 OFFSET $4
      `, [boardType, scopeKey, safeLimit, safeOffset]);
      const rows = rowsRes?.rows || [];

      const items = rows.map((row, idx) => {
        const metadata = parseJsonField(row.metadata_json, {});
        return {
          rank: safeOffset + idx + 1,
          userId: row.user_id,
          boardType: row.board_type,
          scopeKey: row.scope_key,
          displayName: row.display_name_snapshot,
          score: Number(row.score_numeric),
          isShiny: Boolean(row.is_shiny),
          metadata: metadata && typeof metadata === 'object' ? metadata : {},
          achievedAt: toIsoString(row.achieved_at),
          updatedAt: toIsoString(row.updated_at)
        };
      });

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
      const pool = await getPool();
      const res = await pool.query(`
        SELECT
          ranked.board_type,
          ranked.scope_key,
          ranked.score_numeric,
          ranked.display_name_snapshot,
          ranked.is_shiny,
          ranked.metadata_json,
          ranked.achieved_at,
          ranked.updated_at,
          ranked.rank,
          ranked.total
        FROM (
          SELECT
            user_id,
            board_type,
            scope_key,
            score_numeric,
            display_name_snapshot,
            is_shiny,
            metadata_json,
            achieved_at,
            updated_at,
            RANK() OVER (
              PARTITION BY board_type, scope_key
              ORDER BY score_numeric DESC, achieved_at ASC
            ) AS rank,
            COUNT(*) OVER (
              PARTITION BY board_type, scope_key
            ) AS total
          FROM leaderboard_records
          WHERE audit_status = 'verified'
        ) ranked
        WHERE ranked.user_id = $1
        ORDER BY ranked.board_type ASC, ranked.scope_key ASC
      `, [userId]);

      return (res?.rows || []).map(row => {
        const metadata = parseJsonField(row.metadata_json, {});
        return {
          boardType: row.board_type,
          scopeKey: row.scope_key,
          score: Number(row.score_numeric),
          rank: Number(row.rank),
          total: Number(row.total),
          displayName: row.display_name_snapshot,
          isShiny: Boolean(row.is_shiny),
          metadata: metadata && typeof metadata === 'object' ? metadata : {},
          achievedAt: toIsoString(row.achieved_at),
          updatedAt: toIsoString(row.updated_at)
        };
      });
    }
  };

  const social = {
    async listUserAchievements(userId) {
      const pool = await getPool();
      const res = await pool.query(`
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
          ON u.achievement_code = d.code AND u.user_id = $1
        ORDER BY d.sort_order ASC, d.code ASC
      `, [userId]);

      return (res?.rows || []).map(mapAchievementRow);
    },

    async claimAchievementAtomic({ userId, code, idempotencyKey, requestDigest, nowIso }) {
      const effectiveNow = nowIso || new Date().toISOString();

      return runInPgTransaction(getPool, async (client) => {
        // 1. 幂等校验：同键同摘要重放，异摘要抛 409 IDEMPOTENCY_CONFLICT
        const existingLedger = await findLedgerPg(client, userId, idempotencyKey);
        if (existingLedger) {
          const prevDigest = existingLedger.metadata?.requestDigest;
          if (existingLedger.eventType !== 'achievement_claim' || prevDigest !== requestDigest) {
            throw createDomainError('IDEMPOTENCY_CONFLICT', '重复的幂等操作键或请求参数不一致', 409);
          }
          const defRes = await client.query(`
            SELECT code, title, reward_coins, reward_luck
            FROM achievement_definitions
            WHERE code = $1
          `, [code]);
          const def = defRes?.rows?.[0];
          const uaRes = await client.query(`
            SELECT claimed_at
            FROM user_achievements
            WHERE user_id = $1 AND achievement_code = $2
          `, [userId, code]);
          const ua = uaRes?.rows?.[0];
          const currentSave = await readPlayerSaveRowPg(client, userId);
          return {
            idempotentReplay: true,
            code,
            title: def?.title || existingLedger.metadata?.title || code,
            rewardCoins: existingLedger.coinsDelta,
            rewardLuck: existingLedger.luckDelta,
            claimedAt: toIsoString(ua?.claimed_at) || existingLedger.createdAt,
            coins: currentSave ? currentSave.coins : existingLedger.coinsAfter,
            luckPoints: currentSave ? currentSave.luckPoints : existingLedger.luckAfter,
            revision: currentSave ? currentSave.revision : null,
            ledgerId: existingLedger.id
          };
        }

        // 2. 校验成就定义及玩家解锁/领奖状态
        const defRes = await client.query(`
          SELECT code, title, reward_coins, reward_luck, target_value
          FROM achievement_definitions
          WHERE code = $1
        `, [code]);
        const def = defRes?.rows?.[0];
        if (!def) {
          throw createDomainError('NOT_FOUND', `未找到成就定义: ${code}`, 404);
        }

        const uaRes = await client.query(`
          SELECT progress_value, unlocked_at, claimed_at
          FROM user_achievements
          WHERE user_id = $1 AND achievement_code = $2
        `, [userId, code]);
        const ua = uaRes?.rows?.[0];
        if (!ua || !ua.unlocked_at) {
          throw createDomainError('VALIDATION_ERROR', '该成就尚未解锁，无法领取奖励', 400);
        }
        if (ua.claimed_at !== null && ua.claimed_at !== undefined) {
          throw createDomainError('VALIDATION_ERROR', '该成就奖励已领取，不可重复领取', 400);
        }

        // 3. 标记已领取
        await client.query(`
          UPDATE user_achievements
          SET claimed_at = $1
          WHERE user_id = $2 AND achievement_code = $3
        `, [effectiveNow, userId, code]);

        // 4. 更新存档金币与幸运值，记录账本并刷新 wealth 榜单
        const saveRow = await readPlayerSaveRowPg(client, userId);
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
        const updatedSave = await updatePlayerSavePgInTx(client, userId, nextPayload, { nowIso: effectiveNow });
        if (!updatedSave) {
          throw createDomainError('INTERNAL_ERROR', '更新玩家存档失败', 500);
        }

        const ledger = await recordLedgerPgInTx(client, {
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

        const userRes = await client.query('SELECT display_name FROM users WHERE id = $1', [userId]);
        const userRow = userRes?.rows?.[0];
        await upsertLeaderboardPgInTx(client, {
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
      const pool = await getPool();
      const userRes = await pool.query(`
        SELECT id, display_name, avatar_frame, status
        FROM users
        WHERE id = $1
      `, [userId]);
      const userRow = userRes?.rows?.[0];
      if (!userRow || userRow.status === 'deleted') {
        return null;
      }
      const saveRow = await readPlayerSaveRowPg(pool, userId);
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
      const effectiveNow = nowIso || new Date().toISOString();
      const normalizedSnapshotJson = typeof snapshotJson === 'string'
        ? snapshotJson
        : JSON.stringify(snapshotJson || {});

      return runInPgTransaction(getPool, async (client) => {
        await client.query(`
          INSERT INTO aquarium_shares (
            id, share_code, user_id, title, owner_display_name, aquarium_level,
            snapshot_json, likes_count, views_count, is_public, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 0, 0, TRUE, $8, $9)
        `, [
          id,
          shareCode,
          userId,
          title,
          ownerDisplayName,
          aquariumLevel,
          normalizedSnapshotJson,
          effectiveNow,
          effectiveNow
        ]);

        const achievementProgress = await upsertAchievementProgressPgInTx(client, {
          userId,
          code: 'aquarium_share',
          progressValue: 1,
          unlockedAt: effectiveNow,
          mode: 'add'
        });

        const parsedSnapshot = parseJsonField(normalizedSnapshotJson, {});
        return {
          id,
          shareCode,
          userId,
          title,
          ownerDisplayName,
          aquariumLevel,
          snapshot: parsedSnapshot && typeof parsedSnapshot === 'object' ? parsedSnapshot : {},
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
      return runInPgTransaction(getPool, async (client) => {
        const res = await client.query(`
          SELECT id, share_code, user_id, title, owner_display_name, aquarium_level,
                 snapshot_json, likes_count, views_count, is_public, expires_at,
                 created_at, updated_at
          FROM aquarium_shares
          WHERE share_code = $1
            AND is_public = TRUE
            AND (expires_at IS NULL OR expires_at > NOW())
        `, [shareCode]);
        const row = res?.rows?.[0];

        if (!row) return null;

        if (incrementViews) {
          await client.query(`
            UPDATE aquarium_shares
            SET views_count = views_count + 1
            WHERE id = $1
          `, [row.id]);
          row.views_count = Number(row.views_count || 0) + 1;
        }

        return mapAquariumShareRow(row);
      });
    },

    async likeAquariumShare(shareCode) {
      const nowIso = new Date().toISOString();

      return runInPgTransaction(getPool, async (client) => {
        const res = await client.query(`
          SELECT id, share_code, likes_count
          FROM aquarium_shares
          WHERE share_code = $1
            AND is_public = TRUE
            AND (expires_at IS NULL OR expires_at > NOW())
        `, [shareCode]);
        const row = res?.rows?.[0];

        if (!row) {
          throw createDomainError('NOT_FOUND', '未找到对应的水族箱分享卡片', 404);
        }

        const nextLikes = Number(row.likes_count || 0) + 1;
        await client.query(`
          UPDATE aquarium_shares
          SET likes_count = $1, updated_at = $2
          WHERE id = $3
        `, [nextLikes, nowIso, row.id]);

        return {
          shareCode: row.share_code,
          likesCount: nextLikes
        };
      });
    }
  };

  return { leaderboards, social };
}
