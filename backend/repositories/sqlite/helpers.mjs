/**
 * 《微风垂钓物语 2.0》SQLite 仓储公共事务、迁移自动引导与校验工具 (backend/repositories/sqlite/helpers.mjs)
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import saveSchema from '../../../shared/save_schema.js';
import gameCatalog from '../../../shared/game_catalog.js';

const HELPERS_FILE_PATH = fileURLToPath(import.meta.url);
const HELPERS_DIR_PATH = path.dirname(HELPERS_FILE_PATH);
const ROOT_DIR = path.resolve(HELPERS_DIR_PATH, '..', '..', '..');

export const DEFAULT_MIGRATIONS_DIR = path.join(ROOT_DIR, 'db', 'migrations', 'sqlite');
export const DEFAULT_SEEDS_DIR = path.join(ROOT_DIR, 'db', 'seeds');

export function computeSaveChecksum(payloadJson) {
  return crypto.createHash('sha256').update(String(payloadJson || '')).digest('hex');
}

export function createDomainError(code, message, status = 400, details = null) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (details !== null && details !== undefined) err.details = details;
  return err;
}

export function runInTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // 忽略回滚二次异常
    }
    throw err;
  }
}

export function extractSaveSummary(payloadObj) {
  const clean = saveSchema.sanitizeAndValidateSave(payloadObj, gameCatalog).sanitized;
  const records = clean.records || {};
  let totalCatches = 0;
  for (const rec of Object.values(records)) {
    totalCatches += Math.max(0, Math.floor(Number(rec.count) || 0));
  }
  return {
    clean,
    payloadJson: JSON.stringify(clean),
    coins: Math.max(0, Math.floor(Number(clean.coins) || 0)),
    luckPoints: Math.max(0, Math.floor(Number(clean.luckPoints) || 0)),
    aquariumLevel: Math.max(1, Math.min(5, Math.floor(Number(clean.aquariumLevel) || 1))),
    speciesUnlockedCount: Object.keys(records).length,
    totalCatches
  };
}

export function readPlayerSaveRow(db, userId) {
  const row = db.prepare(`
    SELECT user_id, schema_version, revision, coins, luck_points, aquarium_level,
           aquarium_last_settled_at, species_unlocked_count, total_catches,
           save_payload, payload_checksum, updated_at
    FROM player_saves
    WHERE user_id = ?
  `).get(userId);
  if (!row) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(row.save_payload);
  } catch {
    parsed = saveSchema.createDefaultPlayerState();
  }
  return {
    userId: row.user_id,
    schemaVersion: row.schema_version,
    revision: row.revision,
    coins: row.coins,
    luckPoints: row.luck_points,
    aquariumLevel: row.aquarium_level,
    aquariumLastSettledAt: row.aquarium_last_settled_at,
    speciesUnlockedCount: row.species_unlocked_count,
    totalCatches: row.total_catches,
    snapshot: parsed,
    payloadChecksum: row.payload_checksum,
    updatedAt: row.updated_at
  };
}

export function updatePlayerSaveInTx(db, userId, nextPayloadObj, options = {}) {
  const nowIso = options.nowIso || new Date().toISOString();
  const summary = extractSaveSummary(nextPayloadObj);
  const checksum = computeSaveChecksum(summary.payloadJson);

  const whereClause = options.expectedRevision !== undefined
    ? 'WHERE user_id = ? AND revision = ?'
    : 'WHERE user_id = ?';
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

  const settledSql = options.aquariumLastSettledAt ? ', aquarium_last_settled_at = ?' : '';
  const res = db.prepare(`
    UPDATE player_saves
    SET revision = revision + 1,
        coins = ?,
        luck_points = ?,
        aquarium_level = ?${settledSql},
        species_unlocked_count = ?,
        total_catches = ?,
        save_payload = ?,
        payload_checksum = ?,
        updated_at = ?
    ${whereClause}
  `).run(...params);

  if (!res || res.changes === 0) {
    return null;
  }
  return readPlayerSaveRow(db, userId);
}

export function recordLedgerInTx(db, {
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
  const info = db.prepare(`
    INSERT INTO economy_ledger (
      user_id, idempotency_key, event_type, coins_delta, luck_delta,
      coins_after, luck_after, reference_id, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
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
  );
  return {
    id: Number(info.lastInsertRowid),
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

export function findLedgerInDb(db, userId, idempotencyKey) {
  if (!idempotencyKey) return null;
  const row = db.prepare(`
    SELECT id, user_id, idempotency_key, event_type, coins_delta, luck_delta,
           coins_after, luck_after, reference_id, metadata_json, created_at
    FROM economy_ledger
    WHERE user_id = ? AND idempotency_key = ?
  `).get(userId, idempotencyKey);
  if (!row) return null;
  let metadata = {};
  try {
    metadata = JSON.parse(row.metadata_json || '{}');
  } catch {
    metadata = {};
  }
  return {
    id: row.id,
    userId: row.user_id,
    idempotencyKey: row.idempotency_key,
    eventType: row.event_type,
    coinsDelta: row.coins_delta,
    luckDelta: row.luck_delta,
    coinsAfter: row.coins_after,
    luckAfter: row.luck_after,
    referenceId: row.reference_id,
    metadata,
    createdAt: row.created_at
  };
}

export function upsertAchievementProgressInTx(db, { userId, code, progressValue, unlockedAt = null, mode = 'max' }) {
  const def = db.prepare('SELECT target_value FROM achievement_definitions WHERE code = ?').get(code);
  if (!def) return null;
  const existing = db.prepare(`
    SELECT progress_value, unlocked_at, claimed_at
    FROM user_achievements
    WHERE user_id = ? AND achievement_code = ?
  `).get(userId, code);

  const prevProg = existing ? Number(existing.progress_value || 0) : 0;
  const nextProg = mode === 'add' ? prevProg + progressValue : Math.max(prevProg, progressValue);
  const nowIso = unlockedAt || new Date().toISOString();
  const nextUnlocked = (existing && existing.unlocked_at)
    ? existing.unlocked_at
    : (nextProg >= def.target_value ? nowIso : null);

  if (!existing) {
    db.prepare(`
      INSERT INTO user_achievements (user_id, achievement_code, progress_value, unlocked_at)
      VALUES (?, ?, ?, ?)
    `).run(userId, code, nextProg, nextUnlocked);
  } else {
    db.prepare(`
      UPDATE user_achievements
      SET progress_value = ?, unlocked_at = ?
      WHERE user_id = ? AND achievement_code = ?
    `).run(nextProg, nextUnlocked, userId, code);
  }
  return { code, progressValue: nextProg, unlockedAt: nextUnlocked };
}

export function upsertLeaderboardInTx(db, {
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
  const existing = db.prepare(`
    SELECT id, score_numeric, audit_status
    FROM leaderboard_records
    WHERE user_id = ? AND board_type = ? AND scope_key = ?
  `).get(userId, boardType, scopeKey);

  const metaJson = JSON.stringify(metadata || {});
  if (!existing) {
    db.prepare(`
      INSERT INTO leaderboard_records (
        user_id, board_type, scope_key, score_numeric, display_name_snapshot,
        is_shiny, metadata_json, audit_status, achieved_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId, boardType, scopeKey, scoreNumeric, displayNameSnapshot || '无名钓友',
      isShiny ? 1 : 0, metaJson, auditStatus, nowIso, nowIso
    );
    return { updated: true, scoreNumeric };
  }

  if (scoreNumeric > existing.score_numeric || existing.display_name_snapshot !== displayNameSnapshot) {
    const keepHigher = Math.max(existing.score_numeric, scoreNumeric);
    const isNewBest = scoreNumeric > existing.score_numeric;
    db.prepare(`
      UPDATE leaderboard_records
      SET score_numeric = ?,
          display_name_snapshot = ?,
          is_shiny = CASE WHEN ? > 0 AND ? = 1 THEN 1 ELSE is_shiny END,
          metadata_json = CASE WHEN ? > 0 THEN ? ELSE metadata_json END,
          audit_status = CASE WHEN ? = 'flagged' THEN 'flagged' ELSE audit_status END,
          achieved_at = CASE WHEN ? > 0 THEN ? ELSE achieved_at END,
          updated_at = ?
      WHERE id = ?
    `).run(
      keepHigher,
      displayNameSnapshot || '无名钓友',
      isNewBest ? 1 : 0, isShiny ? 1 : 0,
      isNewBest ? 1 : 0, metaJson,
      auditStatus,
      isNewBest ? 1 : 0, nowIso,
      nowIso,
      existing.id
    );
    return { updated: isNewBest, scoreNumeric: keepHigher };
  }
  return { updated: false, scoreNumeric: existing.score_numeric };
}
