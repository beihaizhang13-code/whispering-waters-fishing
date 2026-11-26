/**
 * 《微风垂钓物语 2.0》PostgreSQL 捕鱼审计与经济账本仓储 (backend/repositories/postgres/economy_repo.mjs)
 */
import {
  createDomainError,
  findLedgerPg,
  readPlayerSaveRowPg,
  recordLedgerPgInTx,
  runInPgTransaction,
  toIsoString,
  updatePlayerSavePgInTx,
  upsertAchievementProgressPgInTx,
  upsertLeaderboardPgInTx
} from './helpers.mjs';

function mapCatchRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    userId: row.user_id,
    clientCatchUid: row.client_catch_uid,
    fishId: row.fish_id,
    rarity: row.rarity,
    biomeId: row.biome_id,
    depthZone: Number(row.depth_zone),
    baitId: row.bait_id,
    weatherId: row.weather_id,
    isGoldenTide: Boolean(row.is_golden_tide),
    isShiny: Boolean(row.is_shiny),
    lengthCm: Number(row.length_cm),
    weightKg: Number(row.weight_kg),
    computedValue: Number(row.computed_value),
    disposition: row.disposition,
    validationStatus: row.validation_status,
    validationReason: row.validation_reason || null,
    caughtAt: toIsoString(row.caught_at),
    createdAt: toIsoString(row.created_at)
  };
}

async function readUserRowPg(queryable, userId) {
  const res = await queryable.query(`
    SELECT id, account_type, display_name, avatar_frame, status, role
    FROM users
    WHERE id = $1
  `, [userId]);
  return res?.rows?.[0] || null;
}

async function insertAuditEventPgInTx(queryable, userId, auditEvent, nowIso) {
  if (!auditEvent) return null;
  const res = await queryable.query(`
    INSERT INTO audit_security_events (
      user_id, event_category, severity, ip_hash, request_id, details_json, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
    RETURNING id
  `, [
    userId || null,
    auditEvent.eventCategory || 'economy_security',
    auditEvent.severity || 'warn',
    auditEvent.ipHash || null,
    auditEvent.requestId || null,
    JSON.stringify(auditEvent.details || {}),
    auditEvent.createdAt || nowIso
  ]);
  const insertedId = res?.rows?.[0]?.id ?? null;
  return { id: insertedId !== null ? Number(insertedId) : null };
}

export function createPostgresEconomyRepo(getPool) {
  return {
    async findCatchByClientUid(userId, clientCatchUid) {
      if (!userId || !clientCatchUid) return null;
      const pool = await getPool();
      const res = await pool.query(`
        SELECT id, user_id, client_catch_uid, fish_id, rarity, biome_id, depth_zone, bait_id,
               weather_id, is_golden_tide, is_shiny, length_cm, weight_kg, computed_value,
               disposition, validation_status, validation_reason, caught_at, created_at
        FROM catch_logs
        WHERE user_id = $1 AND client_catch_uid = $2
      `, [userId, clientCatchUid]);
      return mapCatchRow(res?.rows?.[0] || null);
    },

    async findLedgerByIdempotencyKey(userId, idempotencyKey) {
      if (!userId || !idempotencyKey) return null;
      const pool = await getPool();
      return findLedgerPg(pool, userId, idempotencyKey);
    },

    async countRecentCatches(userId, sinceIso) {
      if (!userId) return 0;
      const pool = await getPool();
      const res = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM catch_logs
        WHERE user_id = $1 AND created_at >= $2
      `, [userId, sinceIso]);
      return Number(res?.rows?.[0]?.cnt || 0);
    },

    async getPlayerSaveAndUser(userId) {
      if (!userId) return { saveRow: null, userRow: null };
      const pool = await getPool();
      const saveRow = await readPlayerSaveRowPg(pool, userId);
      const userRow = await readUserRowPg(pool, userId);
      return { saveRow, userRow };
    },

    async recordAuditEvent({ userId = null, eventCategory, severity = 'warn', ipHash = null, requestId = null, details = {} }) {
      const pool = await getPool();
      const nowIso = new Date().toISOString();
      return insertAuditEventPgInTx(pool, userId, {
        eventCategory,
        severity,
        ipHash,
        requestId,
        details
      }, nowIso);
    },

    async recordCatchAtomic({
      userId,
      clientCatchUid,
      idempotencyKey = null,
      catchLog,
      nextSaveObj,
      ledgerEntry = null,
      leaderboardUpdates = [],
      achievementUpdates = [],
      auditEvent = null
    }) {
      const nowIso = new Date().toISOString();

      return runInPgTransaction(getPool, async (client) => {
        const existingRes = await client.query(`
          SELECT id, user_id, client_catch_uid, fish_id, rarity, biome_id, depth_zone, bait_id,
                 weather_id, is_golden_tide, is_shiny, length_cm, weight_kg, computed_value,
                 disposition, validation_status, validation_reason, caught_at, created_at
          FROM catch_logs
          WHERE user_id = $1 AND client_catch_uid = $2
        `, [userId, clientCatchUid]);
        const existingRow = existingRes?.rows?.[0];

        if (existingRow) {
          const existingCatch = mapCatchRow(existingRow);
          const existingLedger = idempotencyKey ? await findLedgerPg(client, userId, idempotencyKey) : null;
          return {
            duplicate: true,
            existingCatch,
            save: await readPlayerSaveRowPg(client, userId),
            ledger: existingLedger
          };
        }

        const caughtAtIso = typeof catchLog.caughtAt === 'number'
          ? new Date(catchLog.caughtAt).toISOString()
          : (catchLog.caughtAt || nowIso);

        const insertRes = await client.query(`
          INSERT INTO catch_logs (
            user_id, client_catch_uid, fish_id, rarity, biome_id, depth_zone, bait_id,
            weather_id, is_golden_tide, is_shiny, length_cm, weight_kg, computed_value,
            disposition, validation_status, validation_reason, caught_at, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
          RETURNING *
        `, [
          userId,
          clientCatchUid,
          catchLog.fishId,
          catchLog.rarity,
          catchLog.biomeId,
          catchLog.depthZone,
          catchLog.baitId,
          catchLog.weatherId || 'sunny',
          Boolean(catchLog.isGoldenTide),
          Boolean(catchLog.isShiny),
          catchLog.lengthCm,
          catchLog.weightKg,
          catchLog.computedValue,
          catchLog.disposition,
          catchLog.validationStatus || 'verified',
          catchLog.validationReason || null,
          caughtAtIso,
          nowIso
        ]);

        const persistedCatch = mapCatchRow(insertRes?.rows?.[0] || null);

        let ledger = null;
        if (ledgerEntry) {
          const effectiveLedgerKey = ledgerEntry.idempotencyKey || idempotencyKey;
          if (!effectiveLedgerKey) {
            throw createDomainError('VALIDATION_ERROR', '写入经济账本缺少幂等键', 400);
          }
          const existingLedger = await findLedgerPg(client, userId, effectiveLedgerKey);
          if (existingLedger) {
            if (existingLedger.referenceId && existingLedger.referenceId !== clientCatchUid) {
              throw createDomainError('IDEMPOTENCY_CONFLICT', '重复的幂等操作键或参数不一致', 409);
            }
            ledger = existingLedger;
          } else {
            ledger = await recordLedgerPgInTx(client, {
              userId,
              idempotencyKey: effectiveLedgerKey,
              eventType: ledgerEntry.eventType,
              coinsDelta: ledgerEntry.coinsDelta || 0,
              luckDelta: ledgerEntry.luckDelta || 0,
              coinsAfter: ledgerEntry.coinsAfter,
              luckAfter: ledgerEntry.luckAfter,
              referenceId: ledgerEntry.referenceId ?? clientCatchUid,
              metadata: ledgerEntry.metadata || {},
              createdAt: ledgerEntry.createdAt || nowIso
            });
          }
        }

        if (auditEvent) {
          await insertAuditEventPgInTx(client, userId, auditEvent, nowIso);
        }

        const updatedSave = await updatePlayerSavePgInTx(client, userId, nextSaveObj, { nowIso });
        if (!updatedSave) {
          throw createDomainError('NOT_FOUND', '玩家存档不存在，无法记录渔获', 404);
        }

        const userRow = await readUserRowPg(client, userId);
        const displayNameSnapshot = userRow?.display_name || '无名钓友';

        for (const lb of leaderboardUpdates || []) {
          await upsertLeaderboardPgInTx(client, {
            userId,
            boardType: lb.boardType,
            scopeKey: lb.scopeKey || 'global',
            scoreNumeric: lb.scoreNumeric,
            displayNameSnapshot: lb.displayNameSnapshot || displayNameSnapshot,
            isShiny: Boolean(lb.isShiny),
            metadata: lb.metadata || {},
            auditStatus: lb.auditStatus || 'verified',
            nowIso
          });
        }

        for (const ach of achievementUpdates || []) {
          await upsertAchievementProgressPgInTx(client, {
            userId,
            code: ach.code,
            progressValue: ach.progressValue,
            unlockedAt: ach.unlockedAt || nowIso,
            mode: ach.mode || 'max'
          });
        }

        return {
          duplicate: false,
          catchLog: persistedCatch,
          save: updatedSave,
          ledger
        };
      });
    },

    async runEconomyMutationAtomic({ userId, idempotencyKey, expectedPayloadHash, mutateFn }) {
      if (!idempotencyKey || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
        throw createDomainError('VALIDATION_ERROR', '缺少必要的 Idempotency-Key 请求头', 400);
      }
      const cleanKey = idempotencyKey.trim();
      const nowIso = new Date().toISOString();

      return runInPgTransaction(getPool, async (client) => {
        const existingLedger = await findLedgerPg(client, userId, cleanKey);
        if (existingLedger) {
          const storedDigest = existingLedger.metadata?.requestDigest;
          if (expectedPayloadHash && storedDigest !== expectedPayloadHash) {
            throw createDomainError('IDEMPOTENCY_CONFLICT', '重复的幂等操作键或参数不一致', 409);
          }
          return {
            idempotentReplay: true,
            ledger: existingLedger,
            save: await readPlayerSaveRowPg(client, userId),
            responseData: existingLedger.metadata?.responseData ?? null
          };
        }

        const saveRow = await readPlayerSaveRowPg(client, userId);
        const userRow = await readUserRowPg(client, userId);
        if (!userRow || !saveRow) {
          throw createDomainError('NOT_FOUND', '玩家账号或云存档不存在', 404);
        }

        const mutation = await mutateFn({ client, db: client, saveRow, userRow });
        const updatedSave = await updatePlayerSavePgInTx(client, userId, mutation.nextSaveObj, {
          expectedRevision: saveRow.revision,
          nowIso,
          ...(mutation.saveOptions || {})
        });
        if (!updatedSave) {
          throw createDomainError('SAVE_CONFLICT', '云端存档版本已更新，请先拉取合并后再重试', 409);
        }

        let ledger = null;
        if (mutation.ledgerData) {
          ledger = await recordLedgerPgInTx(client, {
            userId,
            idempotencyKey: cleanKey,
            eventType: mutation.ledgerData.eventType,
            coinsDelta: mutation.ledgerData.coinsDelta || 0,
            luckDelta: mutation.ledgerData.luckDelta || 0,
            coinsAfter: mutation.ledgerData.coinsAfter,
            luckAfter: mutation.ledgerData.luckAfter,
            referenceId: mutation.ledgerData.referenceId ?? null,
            metadata: {
              ...(mutation.ledgerData.metadata || {}),
              ...(expectedPayloadHash ? { requestDigest: expectedPayloadHash } : {}),
              ...(mutation.responseData ? { responseData: mutation.responseData } : {})
            },
            createdAt: nowIso
          });
        }

        const displayNameSnapshot = userRow.display_name || '无名钓友';
        for (const lb of mutation.leaderboardUpdates || []) {
          await upsertLeaderboardPgInTx(client, {
            userId,
            boardType: lb.boardType,
            scopeKey: lb.scopeKey || 'global',
            scoreNumeric: lb.scoreNumeric,
            displayNameSnapshot: lb.displayNameSnapshot || displayNameSnapshot,
            isShiny: Boolean(lb.isShiny),
            metadata: lb.metadata || {},
            auditStatus: lb.auditStatus || 'verified',
            nowIso
          });
        }

        for (const ach of mutation.achievementUpdates || []) {
          await upsertAchievementProgressPgInTx(client, {
            userId,
            code: ach.code,
            progressValue: ach.progressValue,
            unlockedAt: ach.unlockedAt || nowIso,
            mode: ach.mode || 'max'
          });
        }

        return {
          idempotentReplay: false,
          save: updatedSave,
          ledger,
          responseData: mutation.responseData ?? null
        };
      });
    }
  };
}
