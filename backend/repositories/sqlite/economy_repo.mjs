/**
 * 《微风垂钓物语 2.0》SQLite 捕鱼审计与经济账本仓储 (backend/repositories/sqlite/economy_repo.mjs)
 */
import {
  createDomainError,
  runInTransaction,
  readPlayerSaveRow,
  updatePlayerSaveInTx,
  recordLedgerInTx,
  findLedgerInDb,
  upsertLeaderboardInTx,
  upsertAchievementProgressInTx
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
    caughtAt: row.caught_at,
    createdAt: row.created_at
  };
}

function readUserRow(db, userId) {
  return db.prepare(`
    SELECT id, account_type, display_name, avatar_frame, status, role
    FROM users
    WHERE id = ?
  `).get(userId) || null;
}

function insertAuditEventInTx(db, userId, auditEvent, nowIso) {
  if (!auditEvent) return null;
  const info = db.prepare(`
    INSERT INTO audit_security_events (
      user_id, event_category, severity, ip_hash, request_id, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId || null,
    auditEvent.eventCategory || 'economy_security',
    auditEvent.severity || 'warn',
    auditEvent.ipHash || null,
    auditEvent.requestId || null,
    JSON.stringify(auditEvent.details || {}),
    auditEvent.createdAt || nowIso
  );
  return { id: Number(info.lastInsertRowid) };
}

export function createSqliteEconomyRepo(ensureDb) {
  return {
    async findCatchByClientUid(userId, clientCatchUid) {
      if (!userId || !clientCatchUid) return null;
      const db = ensureDb();
      const row = db.prepare(`
        SELECT id, user_id, client_catch_uid, fish_id, rarity, biome_id, depth_zone, bait_id,
               weather_id, is_golden_tide, is_shiny, length_cm, weight_kg, computed_value,
               disposition, validation_status, validation_reason, caught_at, created_at
        FROM catch_logs
        WHERE user_id = ? AND client_catch_uid = ?
      `).get(userId, clientCatchUid);
      return mapCatchRow(row);
    },

    async findLedgerByIdempotencyKey(userId, idempotencyKey) {
      if (!userId || !idempotencyKey) return null;
      const db = ensureDb();
      return findLedgerInDb(db, userId, idempotencyKey);
    },

    async countRecentCatches(userId, sinceIso) {
      if (!userId) return 0;
      const db = ensureDb();
      const row = db.prepare(`
        SELECT COUNT(*) AS cnt
        FROM catch_logs
        WHERE user_id = ? AND created_at >= ?
      `).get(userId, sinceIso);
      return Number(row?.cnt || 0);
    },

    async getPlayerSaveAndUser(userId) {
      if (!userId) return { saveRow: null, userRow: null };
      const db = ensureDb();
      return {
        saveRow: readPlayerSaveRow(db, userId),
        userRow: readUserRow(db, userId)
      };
    },

    async recordAuditEvent({ userId = null, eventCategory, severity = 'warn', ipHash = null, requestId = null, details = {} }) {
      const db = ensureDb();
      const nowIso = new Date().toISOString();
      return insertAuditEventInTx(db, userId, {
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
      const db = ensureDb();
      const nowIso = new Date().toISOString();

      return runInTransaction(db, () => {
        const existingRow = db.prepare(`
          SELECT id, user_id, client_catch_uid, fish_id, rarity, biome_id, depth_zone, bait_id,
                 weather_id, is_golden_tide, is_shiny, length_cm, weight_kg, computed_value,
                 disposition, validation_status, validation_reason, caught_at, created_at
          FROM catch_logs
          WHERE user_id = ? AND client_catch_uid = ?
        `).get(userId, clientCatchUid);

        if (existingRow) {
          const existingCatch = mapCatchRow(existingRow);
          const existingLedger = idempotencyKey ? findLedgerInDb(db, userId, idempotencyKey) : null;
          return {
            duplicate: true,
            existingCatch,
            save: readPlayerSaveRow(db, userId),
            ledger: existingLedger
          };
        }

        const caughtAtIso = typeof catchLog.caughtAt === 'number'
          ? new Date(catchLog.caughtAt).toISOString()
          : (catchLog.caughtAt || nowIso);

        const insertInfo = db.prepare(`
          INSERT INTO catch_logs (
            user_id, client_catch_uid, fish_id, rarity, biome_id, depth_zone, bait_id,
            weather_id, is_golden_tide, is_shiny, length_cm, weight_kg, computed_value,
            disposition, validation_status, validation_reason, caught_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          userId,
          clientCatchUid,
          catchLog.fishId,
          catchLog.rarity,
          catchLog.biomeId,
          catchLog.depthZone,
          catchLog.baitId,
          catchLog.weatherId || 'sunny',
          catchLog.isGoldenTide ? 1 : 0,
          catchLog.isShiny ? 1 : 0,
          catchLog.lengthCm,
          catchLog.weightKg,
          catchLog.computedValue,
          catchLog.disposition,
          catchLog.validationStatus || 'verified',
          catchLog.validationReason || null,
          caughtAtIso,
          nowIso
        );

        const insertedRow = db.prepare(`
          SELECT id, user_id, client_catch_uid, fish_id, rarity, biome_id, depth_zone, bait_id,
                 weather_id, is_golden_tide, is_shiny, length_cm, weight_kg, computed_value,
                 disposition, validation_status, validation_reason, caught_at, created_at
          FROM catch_logs
          WHERE id = ?
        `).get(Number(insertInfo.lastInsertRowid));
        const persistedCatch = mapCatchRow(insertedRow);

        let ledger = null;
        if (ledgerEntry) {
          const effectiveLedgerKey = ledgerEntry.idempotencyKey || idempotencyKey;
          if (!effectiveLedgerKey) {
            throw createDomainError('VALIDATION_ERROR', '写入经济账本缺少幂等键', 400);
          }
          const existingLedger = findLedgerInDb(db, userId, effectiveLedgerKey);
          if (existingLedger) {
            if (existingLedger.referenceId && existingLedger.referenceId !== clientCatchUid) {
              throw createDomainError('IDEMPOTENCY_CONFLICT', '重复的幂等操作键或参数不一致', 409);
            }
            ledger = existingLedger;
          } else {
            ledger = recordLedgerInTx(db, {
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
          insertAuditEventInTx(db, userId, auditEvent, nowIso);
        }

        const updatedSave = updatePlayerSaveInTx(db, userId, nextSaveObj, { nowIso });
        if (!updatedSave) {
          throw createDomainError('NOT_FOUND', '玩家存档不存在，无法记录渔获', 404);
        }

        const userRow = readUserRow(db, userId);
        const displayNameSnapshot = userRow?.display_name || '无名钓友';

        for (const lb of leaderboardUpdates || []) {
          upsertLeaderboardInTx(db, {
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
          upsertAchievementProgressInTx(db, {
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
      const db = ensureDb();
      const nowIso = new Date().toISOString();

      return runInTransaction(db, () => {
        const existingLedger = findLedgerInDb(db, userId, cleanKey);
        if (existingLedger) {
          const storedDigest = existingLedger.metadata?.requestDigest;
          if (expectedPayloadHash && storedDigest !== expectedPayloadHash) {
            throw createDomainError('IDEMPOTENCY_CONFLICT', '重复的幂等操作键或参数不一致', 409);
          }
          return {
            idempotentReplay: true,
            ledger: existingLedger,
            save: readPlayerSaveRow(db, userId),
            responseData: existingLedger.metadata?.responseData ?? null
          };
        }

        const saveRow = readPlayerSaveRow(db, userId);
        const userRow = readUserRow(db, userId);
        if (!userRow || !saveRow) {
          throw createDomainError('NOT_FOUND', '玩家账号或云存档不存在', 404);
        }

        const mutation = mutateFn({ db, saveRow, userRow });
        const updatedSave = updatePlayerSaveInTx(db, userId, mutation.nextSaveObj, {
          expectedRevision: saveRow.revision,
          nowIso,
          ...(mutation.saveOptions || {})
        });
        if (!updatedSave) {
          throw createDomainError('SAVE_CONFLICT', '云端存档版本已更新，请先拉取合并后再重试', 409);
        }

        let ledger = null;
        if (mutation.ledgerData) {
          ledger = recordLedgerInTx(db, {
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
          upsertLeaderboardInTx(db, {
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
          upsertAchievementProgressInTx(db, {
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
