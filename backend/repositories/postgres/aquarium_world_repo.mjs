/**
 * 《微风垂钓物语 2.0》PostgreSQL 水族箱事务与全服世界事件仓储 (backend/repositories/postgres/aquarium_world_repo.mjs)
 */
import crypto from 'node:crypto';
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

function formatWorldEventRow(row) {
  if (!row) return null;
  const payload = parseJsonField(row.payload_json, {});
  return {
    id: row.id,
    eventType: row.event_type,
    triggeredByUserId: row.triggered_by_user_id,
    payload: payload && typeof payload === 'object' ? payload : {},
    startsAt: toIsoString(row.starts_at),
    endsAt: toIsoString(row.ends_at),
    createdAt: toIsoString(row.created_at)
  };
}

export function createPostgresAquariumAndWorldRepo(getPool) {
  const worldEvents = {
    async findActiveGoldenTide(nowIso = new Date().toISOString()) {
      const pool = await getPool();
      try {
        const res = await pool.query(`
          SELECT id, ends_at, triggered_by_user_id
          FROM world_events
          WHERE event_type = 'golden_tide_summon' AND ends_at > $1
          ORDER BY ends_at DESC
          LIMIT 1
        `, [nowIso]);

        const row = res?.rows?.[0];
        return row
          ? {
              id: row.id,
              endsAt: toIsoString(row.ends_at),
              triggeredBy: row.triggered_by_user_id
            }
          : null;
      } catch (err) {
        if (
          err
          && (err.code === '42P01' || /relation .*world_events.* does not exist/i.test(String(err.message || '')))
        ) {
          return null;
        }
        throw err;
      }
    },

    async summonGoldenTideAtomic({
      userId,
      idempotencyKey,
      requestDigest,
      eventId,
      startsAt,
      endsAt,
      payload,
      mutateSaveFn
    }) {
      if (!userId || !idempotencyKey) {
        throw createDomainError('VALIDATION_ERROR', '缺少 userId 或 idempotencyKey', 400);
      }
      if (typeof mutateSaveFn !== 'function') {
        throw createDomainError('INTERNAL_ERROR', 'summonGoldenTideAtomic 缺少 mutateSaveFn', 500);
      }

      return runInPgTransaction(getPool, async (client) => {
        const existingLedger = await findLedgerPg(client, userId, idempotencyKey);
        if (existingLedger) {
          const prevDigest = existingLedger.metadata?.requestDigest ?? null;
          if (prevDigest !== (requestDigest ?? null)) {
            throw createDomainError('IDEMPOTENCY_CONFLICT', '重复的幂等操作键或参数不一致', 409);
          }
          const save = await readPlayerSaveRowPg(client, userId);
          let event = null;
          if (existingLedger.referenceId) {
            const evRes = await client.query(`
              SELECT id, event_type, triggered_by_user_id, payload_json, starts_at, ends_at, created_at
              FROM world_events
              WHERE id = $1
            `, [existingLedger.referenceId]);
            event = formatWorldEventRow(evRes?.rows?.[0]);
          }
          return { save, ledger: existingLedger, event, replayed: true };
        }

        const saveRow = await readPlayerSaveRowPg(client, userId);
        if (!saveRow) {
          throw createDomainError('NOT_FOUND', '玩家存档不存在', 404);
        }

        const mutation = await mutateSaveFn(saveRow);
        if (!mutation || !mutation.nextSaveObj) {
          throw createDomainError('INTERNAL_ERROR', 'mutateSaveFn 未返回有效存档快照', 500);
        }

        const finalEventId = eventId || `we_${crypto.randomUUID()}`;
        const nowIso = startsAt || new Date().toISOString();
        const finalEndsAt = endsAt || nowIso;
        const payloadJson = JSON.stringify(payload || {});

        await client.query(`
          INSERT INTO world_events (
            id, event_type, triggered_by_user_id, payload_json, starts_at, ends_at, created_at
          ) VALUES ($1, 'golden_tide_summon', $2, $3::jsonb, $4, $5, $6)
        `, [finalEventId, userId, payloadJson, nowIso, finalEndsAt, nowIso]);

        const event = {
          id: finalEventId,
          eventType: 'golden_tide_summon',
          triggeredByUserId: userId,
          payload: payload || {},
          startsAt: nowIso,
          endsAt: finalEndsAt,
          createdAt: nowIso
        };

        const updatedSave = await updatePlayerSavePgInTx(client, userId, mutation.nextSaveObj, {
          expectedRevision: saveRow.revision,
          nowIso
        });
        if (!updatedSave) {
          throw createDomainError('SAVE_CONFLICT', '云端存档版本冲突，请重试', 409);
        }

        const ledger = await recordLedgerPgInTx(client, {
          userId,
          idempotencyKey,
          eventType: 'golden_tide_summon',
          coinsDelta: Number(mutation.coinsDelta) || 0,
          luckDelta: Number(mutation.luckDelta) || 0,
          coinsAfter: updatedSave.coins,
          luckAfter: updatedSave.luckPoints,
          referenceId: finalEventId,
          metadata: {
            ...(mutation.metadata || {}),
            requestDigest
          },
          createdAt: nowIso
        });

        return { save: updatedSave, ledger, event, replayed: false };
      });
    }
  };

  const aquariumHelpers = {
    async runAquariumTx({ userId, idempotencyKey, requestDigest, handlerFn }) {
      if (!userId || !idempotencyKey) {
        throw createDomainError('VALIDATION_ERROR', '缺少 userId 或 idempotencyKey', 400);
      }
      if (typeof handlerFn !== 'function') {
        throw createDomainError('INTERNAL_ERROR', 'runAquariumTx 缺少 handlerFn', 500);
      }

      return runInPgTransaction(getPool, async (client) => {
        const existingLedger = await findLedgerPg(client, userId, idempotencyKey);
        if (existingLedger) {
          const prevDigest = existingLedger.metadata?.requestDigest ?? null;
          if (prevDigest !== (requestDigest ?? null)) {
            throw createDomainError('IDEMPOTENCY_CONFLICT', '重复的幂等操作键或参数不一致', 409);
          }
          const save = await readPlayerSaveRowPg(client, userId);
          return {
            replayed: true,
            save,
            ledger: existingLedger,
            result: existingLedger.metadata?.result ?? null
          };
        }

        const saveRow = await readPlayerSaveRowPg(client, userId);
        if (!saveRow) {
          throw createDomainError('NOT_FOUND', '玩家存档不存在', 404);
        }

        const outcome = await handlerFn({ client, db: client, saveRow });
        if (!outcome || !outcome.eventType) {
          throw createDomainError('INTERNAL_ERROR', 'handlerFn 未返回有效事务结果', 500);
        }

        const nowIso = outcome.nowIso || new Date().toISOString();
        let updatedSave = saveRow;
        if (outcome.nextSaveObj) {
          updatedSave = await updatePlayerSavePgInTx(client, userId, outcome.nextSaveObj, {
            expectedRevision: saveRow.revision,
            aquariumLastSettledAt: outcome.aquariumLastSettledAt || undefined,
            nowIso
          });
          if (!updatedSave) {
            throw createDomainError('SAVE_CONFLICT', '云端存档版本冲突，请重试', 409);
          }
        }

        if (Array.isArray(outcome.achievements) && outcome.achievements.length > 0) {
          for (const ach of outcome.achievements) {
            if (!ach || !ach.code) continue;
            await upsertAchievementProgressPgInTx(client, {
              userId,
              code: ach.code,
              progressValue: ach.progressValue,
              unlockedAt: ach.unlockedAt ?? nowIso,
              mode: ach.mode || 'max'
            });
          }
        }

        if (outcome.leaderboard) {
          const lbEntries = Array.isArray(outcome.leaderboard)
            ? outcome.leaderboard
            : [outcome.leaderboard];
          const userRes = await client.query('SELECT display_name FROM users WHERE id = $1', [userId]);
          const userRow = userRes?.rows?.[0];
          const fallbackName = (userRow && userRow.display_name) || '无名钓友';

          for (const lb of lbEntries) {
            if (!lb || !lb.boardType) continue;
            await upsertLeaderboardPgInTx(client, {
              userId,
              boardType: lb.boardType,
              scopeKey: lb.scopeKey || 'global',
              scoreNumeric: lb.scoreNumeric,
              displayNameSnapshot: lb.displayNameSnapshot || fallbackName,
              isShiny: Boolean(lb.isShiny),
              metadata: lb.metadata || {},
              auditStatus: lb.auditStatus || 'verified',
              nowIso: lb.nowIso || nowIso
            });
          }
        }

        const ledger = await recordLedgerPgInTx(client, {
          userId,
          idempotencyKey,
          eventType: outcome.eventType,
          coinsDelta: Number(outcome.coinsDelta) || 0,
          luckDelta: Number(outcome.luckDelta) || 0,
          coinsAfter: updatedSave.coins,
          luckAfter: updatedSave.luckPoints,
          referenceId: outcome.referenceId ?? null,
          metadata: {
            ...(outcome.metadata || {}),
            ...(outcome.result !== undefined ? { result: outcome.result } : {}),
            requestDigest
          },
          createdAt: nowIso
        });

        return {
          replayed: false,
          save: updatedSave,
          ledger,
          result: outcome.result ?? null
        };
      });
    }
  };

  return {
    worldEvents,
    aquariumHelpers
  };
}
