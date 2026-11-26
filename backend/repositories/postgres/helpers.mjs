/**
 * 《微风垂钓物语 2.0》PostgreSQL 仓储公共事务、字段归一化与账本工具 (backend/repositories/postgres/helpers.mjs)
 */
import {
  computeSaveChecksum,
  createDomainError,
  extractSaveSummary
} from '../sqlite/helpers.mjs';

export {
  computeSaveChecksum,
  createDomainError,
  extractSaveSummary
};

export function toIsoString(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

export function parseJsonField(val, fallback = {}) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(String(val));
  } catch {
    return fallback;
  }
}

export async function runInPgTransaction(getPool, fn) {
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // 忽略回滚二次异常
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function readPlayerSaveRowPg(queryable, userId) {
  const res = await queryable.query(`
    SELECT user_id, schema_version, revision, coins, luck_points, aquarium_level,
           aquarium_last_settled_at, species_unlocked_count, total_catches,
           save_payload, payload_checksum, updated_at
    FROM player_saves
    WHERE user_id = $1
  `, [userId]);
  const row = res?.rows?.[0];
  if (!row) return null;

  const parsed = parseJsonField(row.save_payload, null);
  return {
    userId: row.user_id,
    schemaVersion: Number(row.schema_version),
    revision: Number(row.revision),
    coins: Number(row.coins),
    luckPoints: Number(row.luck_points),
    aquariumLevel: Number(row.aquarium_level),
    aquariumLastSettledAt: toIsoString(row.aquarium_last_settled_at),
    speciesUnlockedCount: Number(row.species_unlocked_count),
    totalCatches: Number(row.total_catches),
    snapshot: parsed,
    payloadChecksum: row.payload_checksum,
    updatedAt: toIsoString(row.updated_at)
  };
}

export async function updatePlayerSavePgInTx(client, userId, nextPayloadObj, options = {}) {
  const nowIso = options.nowIso || new Date().toISOString();
  const summary = extractSaveSummary(nextPayloadObj);
  const checksum = computeSaveChecksum(summary.payloadJson);

  const params = [
    summary.coins,
    summary.luckPoints,
    summary.aquariumLevel,
    ...(options.aquariumLastSettledAt ? [options.aquariumLastSettledAt] : []),
    summary.speciesUnlockedCount,
    summary.totalCatches,
    summary.payloadJson,
    checksum,
    nowIso,
    userId,
    ...(options.expectedRevision !== undefined ? [options.expectedRevision] : [])
  ];

  let nextIdx = 4;
  let settledSql = '';
  if (options.aquariumLastSettledAt) {
    settledSql = `, aquarium_last_settled_at = $${nextIdx++}`;
  }
  const idxSpecies = nextIdx++;
  const idxCatches = nextIdx++;
  const idxPayload = nextIdx++;
  const idxChecksum = nextIdx++;
  const idxUpdated = nextIdx++;
  const idxUser = nextIdx++;
  const whereClause = options.expectedRevision !== undefined
    ? `WHERE user_id = $${idxUser} AND revision = $${nextIdx}`
    : `WHERE user_id = $${idxUser}`;

  const res = await client.query(`
    UPDATE player_saves
    SET revision = revision + 1,
        coins = $1,
        luck_points = $2,
        aquarium_level = $3${settledSql},
        species_unlocked_count = $${idxSpecies},
        total_catches = $${idxCatches},
        save_payload = $${idxPayload}::jsonb,
        payload_checksum = $${idxChecksum},
        updated_at = $${idxUpdated}
    ${whereClause}
  `, params);

  const changed = res?.rowCount ?? res?.changes ?? 0;
  if (changed === 0) return null;
  return readPlayerSaveRowPg(client, userId);
}

export async function findLedgerPg(queryable, userId, idempotencyKey) {
  if (!idempotencyKey) return null;
  const res = await queryable.query(`
    SELECT id, user_id, idempotency_key, event_type, coins_delta, luck_delta,
           coins_after, luck_after, reference_id, metadata_json, created_at
    FROM economy_ledger
    WHERE user_id = $1 AND idempotency_key = $2
    LIMIT 1
  `, [userId, idempotencyKey]);
  const row = res?.rows?.[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    userId: row.user_id,
    idempotencyKey: row.idempotency_key,
    eventType: row.event_type,
    coinsDelta: Number(row.coins_delta),
    luckDelta: Number(row.luck_delta),
    coinsAfter: Number(row.coins_after),
    luckAfter: Number(row.luck_after),
    referenceId: row.reference_id || null,
    metadata: parseJsonField(row.metadata_json, {}),
    createdAt: toIsoString(row.created_at)
  };
}

export async function recordLedgerPgInTx(client, {
  userId,
  idempotencyKey,
  eventType,
  coinsDelta = 0,
  luckDelta = 0,
  coinsAfter,
  luckAfter,
  referenceId = null,
  metadata = {},
  createdAt = new Date().toISOString()
}) {
  const metadataJson = JSON.stringify(metadata || {});
  const res = await client.query(`
    INSERT INTO economy_ledger (
      user_id, idempotency_key, event_type, coins_delta, luck_delta,
      coins_after, luck_after, reference_id, metadata_json, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
    RETURNING id
  `, [
    userId,
    idempotencyKey,
    eventType,
    coinsDelta,
    luckDelta,
    coinsAfter,
    luckAfter,
    referenceId,
    metadataJson,
    createdAt
  ]);
  const insertedId = res?.rows?.[0]?.id ?? null;
  return {
    id: insertedId !== null ? Number(insertedId) : null,
    userId,
    idempotencyKey,
    eventType,
    coinsDelta,
    luckDelta,
    coinsAfter,
    luckAfter,
    referenceId,
    metadata,
    createdAt
  };
}

export async function upsertAchievementProgressPgInTx(client, {
  userId,
  code,
  progressValue,
  unlockedAt = null,
  mode = 'max'
}) {
  const defRes = await client.query('SELECT target_value FROM achievement_definitions WHERE code = $1', [code]);
  const def = defRes?.rows?.[0];
  if (!def) return null;

  const existingRes = await client.query(`
    SELECT progress_value, unlocked_at, claimed_at
    FROM user_achievements
    WHERE user_id = $1 AND achievement_code = $2
  `, [userId, code]);
  const existing = existingRes?.rows?.[0];

  const prevProg = existing ? Number(existing.progress_value || 0) : 0;
  const nextProg = mode === 'add' ? prevProg + progressValue : Math.max(prevProg, progressValue);
  const nowIso = unlockedAt || new Date().toISOString();
  const nextUnlocked = (existing && existing.unlocked_at)
    ? toIsoString(existing.unlocked_at)
    : (nextProg >= Number(def.target_value) ? nowIso : null);

  if (!existing) {
    await client.query(`
      INSERT INTO user_achievements (user_id, achievement_code, progress_value, unlocked_at)
      VALUES ($1, $2, $3, $4)
    `, [userId, code, nextProg, nextUnlocked]);
  } else {
    await client.query(`
      UPDATE user_achievements
      SET progress_value = $1, unlocked_at = $2
      WHERE user_id = $3 AND achievement_code = $4
    `, [nextProg, nextUnlocked, userId, code]);
  }
  return { code, progressValue: nextProg, unlockedAt: nextUnlocked };
}

export async function upsertLeaderboardPgInTx(client, {
  userId,
  boardType,
  scopeKey = 'global',
  scoreNumeric,
  displayNameSnapshot,
  isShiny = false,
  metadata = {},
  auditStatus = 'verified',
  nowIso = new Date().toISOString()
}) {
  const existingRes = await client.query(`
    SELECT id, score_numeric, display_name_snapshot, audit_status
    FROM leaderboard_records
    WHERE user_id = $1 AND board_type = $2 AND scope_key = $3
  `, [userId, boardType, scopeKey]);
  const existing = existingRes?.rows?.[0];
  const metaJson = JSON.stringify(metadata || {});

  if (!existing) {
    await client.query(`
      INSERT INTO leaderboard_records (
        user_id, board_type, scope_key, score_numeric, display_name_snapshot,
        is_shiny, metadata_json, audit_status, achieved_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
    `, [
      userId,
      boardType,
      scopeKey,
      scoreNumeric,
      displayNameSnapshot || '无名钓友',
      Boolean(isShiny),
      metaJson,
      auditStatus,
      nowIso,
      nowIso
    ]);
    return { updated: true, scoreNumeric };
  }

  const prevScore = Number(existing.score_numeric || 0);
  if (scoreNumeric > prevScore || existing.display_name_snapshot !== displayNameSnapshot) {
    const keepHigher = Math.max(prevScore, scoreNumeric);
    const isNewBest = scoreNumeric > prevScore;
    await client.query(`
      UPDATE leaderboard_records
      SET score_numeric = $1,
          display_name_snapshot = $2,
          is_shiny = CASE WHEN $3 > 0 AND $4 = TRUE THEN TRUE ELSE is_shiny END,
          metadata_json = CASE WHEN $3 > 0 THEN $5::jsonb ELSE metadata_json END,
          audit_status = CASE WHEN $6 = 'flagged' THEN 'flagged' ELSE audit_status END,
          achieved_at = CASE WHEN $3 > 0 THEN $7 ELSE achieved_at END,
          updated_at = $8
      WHERE id = $9
    `, [
      keepHigher,
      displayNameSnapshot || '无名钓友',
      isNewBest ? 1 : 0,
      Boolean(isShiny),
      metaJson,
      auditStatus,
      nowIso,
      nowIso,
      existing.id
    ]);
    return { updated: isNewBest, scoreNumeric: keepHigher };
  }
  return { updated: false, scoreNumeric: prevScore };
}
