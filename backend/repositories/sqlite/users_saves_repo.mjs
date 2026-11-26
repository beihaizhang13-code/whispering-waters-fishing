/**
 * 《微风垂钓物语 2.0》SQLite 用户、身份、会话与云存档仓储实现 (backend/repositories/sqlite/users_saves_repo.mjs)
 */
import saveSchema from '../../../shared/save_schema.js';
import {
  computeSaveChecksum,
  createDomainError,
  extractSaveSummary,
  readPlayerSaveRow,
  recordLedgerInTx,
  runInTransaction,
  updatePlayerSaveInTx
} from './helpers.mjs';

function mapUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountType: row.account_type,
    displayName: row.display_name,
    avatarFrame: row.avatar_frame,
    status: row.status,
    role: row.role,
    mergedIntoUserId: row.merged_into_user_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null
  };
}

function mapIdentityRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    providerSubject: row.provider_subject,
    email: row.email || null,
    emailVerified: Boolean(row.email_verified),
    lastUsedAt: row.last_used_at || null,
    createdAt: row.created_at
  };
}

function mapSessionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    deviceLabel: row.device_label || null,
    ipHash: row.ip_hash || null,
    userAgent: row.user_agent || null,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at || null,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at
  };
}

function mapJoinedIdentityAndUser(row) {
  if (!row) return null;
  return {
    identity: {
      id: row.i_id,
      userId: row.i_user_id,
      provider: row.i_provider,
      providerSubject: row.i_provider_subject,
      email: row.i_email || null,
      emailVerified: Boolean(row.i_email_verified),
      passwordHash: row.i_password_hash || null,
      lastUsedAt: row.i_last_used_at || null,
      createdAt: row.i_created_at
    },
    user: {
      id: row.u_id,
      accountType: row.u_account_type,
      displayName: row.u_display_name,
      avatarFrame: row.u_avatar_frame,
      status: row.u_status,
      role: row.u_role,
      mergedIntoUserId: row.u_merged_into_user_id || null,
      createdAt: row.u_created_at,
      updatedAt: row.u_updated_at,
      deletedAt: row.u_deleted_at || null
    }
  };
}

function insertInitialSaveInTx(db, userId, initialSaveObj, nowIso) {
  const saveInput = initialSaveObj || saveSchema.createDefaultPlayerState();
  const summary = extractSaveSummary(saveInput);
  const checksum = computeSaveChecksum(summary.payloadJson);
  const schemaVersion = Number(summary.clean.schemaVersion) || saveSchema.CURRENT_SAVE_SCHEMA_VERSION || 2;

  db.prepare(`
    INSERT INTO player_saves (
      user_id, schema_version, revision, coins, luck_points, aquarium_level,
      aquarium_last_settled_at, species_unlocked_count, total_catches,
      save_payload, payload_checksum, updated_at
    ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    schemaVersion,
    summary.coins,
    summary.luckPoints,
    summary.aquariumLevel,
    nowIso,
    summary.speciesUnlockedCount,
    summary.totalCatches,
    summary.payloadJson,
    checksum,
    nowIso
  );

  return readPlayerSaveRow(db, userId);
}

function insertSessionInTx(db, {
  sessionId,
  userId,
  tokenHash,
  deviceLabel = null,
  ipHash = null,
  userAgent = null,
  expiresAt,
  nowIso
}) {
  db.prepare(`
    INSERT INTO sessions (
      id, user_id, token_hash, device_label, ip_hash, user_agent,
      expires_at, created_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    userId,
    tokenHash,
    deviceLabel ?? null,
    ipHash ?? null,
    userAgent ?? null,
    expiresAt,
    nowIso,
    nowIso
  );

  const row = db.prepare(`
    SELECT id, user_id, token_hash, device_label, ip_hash, user_agent,
           expires_at, revoked_at, created_at, last_seen_at
    FROM sessions
    WHERE id = ?
  `).get(sessionId);
  return mapSessionRow(row);
}

export function createSqliteUsersAndSavesRepos(ensureDb) {
  const users = {
    async createGuestUser({
      userId,
      displayName,
      identityId,
      guestSubject,
      sessionId,
      tokenHash,
      expiresAt,
      deviceLabel = null,
      ipHash = null,
      userAgent = null,
      initialSaveObj = null,
      nowIso = null
    }) {
      const db = ensureDb();
      const ts = nowIso || new Date().toISOString();

      return runInTransaction(db, () => {
        db.prepare(`
          INSERT INTO users (
            id, account_type, display_name, avatar_frame, status, role, created_at, updated_at
          ) VALUES (?, 'guest', ?, 'straw', 'active', 'player', ?, ?)
        `).run(userId, displayName, ts, ts);

        db.prepare(`
          INSERT INTO auth_identities (
            id, user_id, provider, provider_subject, email, email_verified, password_hash, last_used_at, created_at
          ) VALUES (?, ?, 'guest_device', ?, NULL, 0, NULL, ?, ?)
        `).run(identityId, userId, guestSubject, ts, ts);

        const session = insertSessionInTx(db, {
          sessionId,
          userId,
          tokenHash,
          deviceLabel,
          ipHash,
          userAgent,
          expiresAt,
          nowIso: ts
        });

        const save = insertInitialSaveInTx(db, userId, initialSaveObj, ts);
        const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        return {
          user: mapUserRow(userRow),
          session,
          save
        };
      });
    },

    async createRegisteredUser({
      userId,
      displayName,
      identityId,
      email,
      passwordHash,
      sessionId,
      tokenHash,
      expiresAt,
      deviceLabel = null,
      ipHash = null,
      userAgent = null,
      initialSaveObj = null,
      nowIso = null
    }) {
      const db = ensureDb();
      const ts = nowIso || new Date().toISOString();
      const normEmail = String(email || '').trim().toLowerCase();

      return runInTransaction(db, () => {
        db.prepare(`
          INSERT INTO users (
            id, account_type, display_name, avatar_frame, status, role, created_at, updated_at
          ) VALUES (?, 'registered', ?, 'straw', 'active', 'player', ?, ?)
        `).run(userId, displayName, ts, ts);

        try {
          db.prepare(`
            INSERT INTO auth_identities (
              id, user_id, provider, provider_subject, email, email_verified, password_hash, last_used_at, created_at
            ) VALUES (?, ?, 'email_password', ?, ?, 0, ?, ?, ?)
          `).run(identityId, userId, normEmail, normEmail, passwordHash, ts, ts);
        } catch (err) {
          if (err && /UNIQUE constraint failed/i.test(String(err.message))) {
            throw createDomainError('VALIDATION_ERROR', '该邮箱已被注册', 409);
          }
          throw err;
        }

        const session = insertSessionInTx(db, {
          sessionId,
          userId,
          tokenHash,
          deviceLabel,
          ipHash,
          userAgent,
          expiresAt,
          nowIso: ts
        });

        const save = insertInitialSaveInTx(db, userId, initialSaveObj, ts);
        const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        return {
          user: mapUserRow(userRow),
          session,
          save
        };
      });
    },

    async findIdentityByEmail(email) {
      const normEmail = String(email || '').trim().toLowerCase();
      if (!normEmail) return null;
      const db = ensureDb();
      const row = db.prepare(`
        SELECT i.id AS i_id, i.user_id AS i_user_id, i.provider AS i_provider,
               i.provider_subject AS i_provider_subject, i.email AS i_email,
               i.email_verified AS i_email_verified, i.password_hash AS i_password_hash,
               i.last_used_at AS i_last_used_at, i.created_at AS i_created_at,
               u.id AS u_id, u.account_type AS u_account_type, u.display_name AS u_display_name,
               u.avatar_frame AS u_avatar_frame, u.status AS u_status, u.role AS u_role,
               u.merged_into_user_id AS u_merged_into_user_id, u.created_at AS u_created_at,
               u.updated_at AS u_updated_at, u.deleted_at AS u_deleted_at
        FROM auth_identities i
        JOIN users u ON u.id = i.user_id
        WHERE i.provider = 'email_password' AND lower(trim(i.email)) = ?
        LIMIT 1
      `).get(normEmail);
      return mapJoinedIdentityAndUser(row);
    },

    async findIdentityByProviderSubject(provider, providerSubject) {
      const normProvider = String(provider || '').trim().toLowerCase();
      const normSubject = String(providerSubject || '').trim();
      if (!normProvider || !normSubject) return null;
      const db = ensureDb();
      const row = db.prepare(`
        SELECT i.id AS i_id, i.user_id AS i_user_id, i.provider AS i_provider,
               i.provider_subject AS i_provider_subject, i.email AS i_email,
               i.email_verified AS i_email_verified, i.password_hash AS i_password_hash,
               i.last_used_at AS i_last_used_at, i.created_at AS i_created_at,
               u.id AS u_id, u.account_type AS u_account_type, u.display_name AS u_display_name,
               u.avatar_frame AS u_avatar_frame, u.status AS u_status, u.role AS u_role,
               u.merged_into_user_id AS u_merged_into_user_id, u.created_at AS u_created_at,
               u.updated_at AS u_updated_at, u.deleted_at AS u_deleted_at
        FROM auth_identities i
        JOIN users u ON u.id = i.user_id
        WHERE i.provider = ? AND i.provider_subject = ?
        LIMIT 1
      `).get(normProvider, normSubject);
      return mapJoinedIdentityAndUser(row);
    },

    async createOAuthUser({
      userId,
      displayName,
      identityId,
      provider,
      providerSubject,
      email = null,
      emailVerified = true,
      sessionId,
      tokenHash,
      expiresAt,
      deviceLabel = null,
      ipHash = null,
      userAgent = null,
      initialSaveObj = null,
      nowIso = null
    }) {
      const db = ensureDb();
      const ts = nowIso || new Date().toISOString();
      const normProvider = String(provider || '').trim().toLowerCase();
      const normSubject = String(providerSubject || '').trim();
      const normEmail = email ? String(email).trim().toLowerCase() : null;
      const safeDisplayName = (typeof displayName === 'string' && displayName.trim())
        ? displayName.trim().slice(0, 32)
        : '微风钓友';

      return runInTransaction(db, () => {
        db.prepare(`
          INSERT INTO users (
            id, account_type, display_name, avatar_frame, status, role, created_at, updated_at
          ) VALUES (?, 'registered', ?, 'straw', 'active', 'player', ?, ?)
        `).run(userId, safeDisplayName, ts, ts);

        try {
          db.prepare(`
            INSERT INTO auth_identities (
              id, user_id, provider, provider_subject, email, email_verified, password_hash, last_used_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
          `).run(
            identityId,
            userId,
            normProvider,
            normSubject,
            normEmail,
            emailVerified ? 1 : 0,
            ts,
            ts
          );
        } catch (err) {
          if (err && /UNIQUE constraint failed/i.test(String(err.message))) {
            throw createDomainError('VALIDATION_ERROR', '该第三方账号已绑定其他用户', 409);
          }
          throw err;
        }

        const session = insertSessionInTx(db, {
          sessionId,
          userId,
          tokenHash,
          deviceLabel,
          ipHash,
          userAgent,
          expiresAt,
          nowIso: ts
        });

        const save = insertInitialSaveInTx(db, userId, initialSaveObj, ts);
        const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        const identityRow = db.prepare(`
          SELECT id, user_id, provider, provider_subject, email, email_verified, last_used_at, created_at
          FROM auth_identities
          WHERE id = ?
        `).get(identityId);

        return {
          user: mapUserRow(userRow),
          identity: mapIdentityRow(identityRow),
          session,
          save
        };
      });
    },

    async findSessionByTokenHash(tokenHash) {
      if (!tokenHash) return null;
      const db = ensureDb();
      const row = db.prepare(`
        SELECT s.id AS s_id, s.user_id AS s_user_id, s.token_hash AS s_token_hash,
               s.device_label AS s_device_label, s.ip_hash AS s_ip_hash, s.user_agent AS s_user_agent,
               s.expires_at AS s_expires_at, s.revoked_at AS s_revoked_at,
               s.created_at AS s_created_at, s.last_seen_at AS s_last_seen_at,
               u.id AS u_id, u.account_type AS u_account_type, u.display_name AS u_display_name,
               u.avatar_frame AS u_avatar_frame, u.status AS u_status, u.role AS u_role,
               u.merged_into_user_id AS u_merged_into_user_id, u.created_at AS u_created_at,
               u.updated_at AS u_updated_at, u.deleted_at AS u_deleted_at
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?
          AND s.revoked_at IS NULL
          AND u.status = 'active'
        LIMIT 1
      `).get(tokenHash);
      if (!row) return null;

      return {
        session: {
          id: row.s_id,
          userId: row.s_user_id,
          tokenHash: row.s_token_hash,
          deviceLabel: row.s_device_label || null,
          ipHash: row.s_ip_hash || null,
          userAgent: row.s_user_agent || null,
          expiresAt: row.s_expires_at,
          revokedAt: row.s_revoked_at || null,
          createdAt: row.s_created_at,
          lastSeenAt: row.s_last_seen_at
        },
        user: {
          id: row.u_id,
          accountType: row.u_account_type,
          displayName: row.u_display_name,
          avatarFrame: row.u_avatar_frame,
          status: row.u_status,
          role: row.u_role,
          mergedIntoUserId: row.u_merged_into_user_id || null,
          createdAt: row.u_created_at,
          updatedAt: row.u_updated_at,
          deletedAt: row.u_deleted_at || null
        }
      };
    },

    async touchSession(sessionId, nowIso) {
      if (!sessionId) return { updated: false };
      const db = ensureDb();
      const ts = nowIso || new Date().toISOString();
      const res = db.prepare(`
        UPDATE sessions
        SET last_seen_at = ?
        WHERE id = ? AND revoked_at IS NULL
      `).run(ts, sessionId);
      return { updated: Boolean(res && res.changes > 0) };
    },

    async createSession({
      sessionId,
      userId,
      tokenHash,
      deviceLabel = null,
      ipHash = null,
      userAgent = null,
      expiresAt,
      nowIso = null
    }) {
      const db = ensureDb();
      const ts = nowIso || new Date().toISOString();
      return insertSessionInTx(db, {
        sessionId,
        userId,
        tokenHash,
        deviceLabel,
        ipHash,
        userAgent,
        expiresAt,
        nowIso: ts
      });
    },

    async revokeSession(sessionId, userId = null, nowIso = null) {
      if (!sessionId) return { revoked: false };
      const db = ensureDb();
      const ts = nowIso || new Date().toISOString();
      const res = userId
        ? db.prepare(`
            UPDATE sessions
            SET revoked_at = ?
            WHERE id = ? AND user_id = ? AND revoked_at IS NULL
          `).run(ts, sessionId, userId)
        : db.prepare(`
            UPDATE sessions
            SET revoked_at = ?
            WHERE id = ? AND revoked_at IS NULL
          `).run(ts, sessionId);
      return { revoked: Boolean(res && res.changes > 0) };
    },

    async listIdentitiesByUserId(userId) {
      const db = ensureDb();
      const rows = db.prepare(`
        SELECT id, user_id, provider, provider_subject, email, email_verified, last_used_at, created_at
        FROM auth_identities
        WHERE user_id = ?
        ORDER BY created_at ASC
      `).all(userId);
      return rows.map(mapIdentityRow);
    },

    async upgradeGuestToRegistered({
      userId,
      identityId,
      email,
      passwordHash,
      displayName = null,
      nowIso = null,
      mergedSaveObj = null
    }) {
      const db = ensureDb();
      const ts = nowIso || new Date().toISOString();
      const normEmail = String(email || '').trim().toLowerCase();

      return runInTransaction(db, () => {
        const currentUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        if (!currentUser || currentUser.status !== 'active') {
          throw createDomainError('NOT_FOUND', '游客账号不存在或已注销', 404);
        }
        if (currentUser.account_type !== 'guest') {
          throw createDomainError('VALIDATION_ERROR', '当前账号已是正式账号，无需游客升级', 400);
        }

        const existingEmail = db.prepare(`
          SELECT id FROM auth_identities
          WHERE provider = 'email_password' AND lower(trim(email)) = ?
          LIMIT 1
        `).get(normEmail);
        if (existingEmail) {
          throw createDomainError('VALIDATION_ERROR', '该邮箱已被注册', 409);
        }

        if (typeof displayName === 'string' && displayName.trim()) {
          db.prepare(`
            UPDATE users
            SET account_type = 'registered',
                display_name = ?,
                updated_at = ?
            WHERE id = ?
          `).run(displayName.trim().slice(0, 32), ts, userId);
        } else {
          db.prepare(`
            UPDATE users
            SET account_type = 'registered',
                updated_at = ?
            WHERE id = ?
          `).run(ts, userId);
        }

        db.prepare(`
          INSERT INTO auth_identities (
            id, user_id, provider, provider_subject, email, email_verified, password_hash, last_used_at, created_at
          ) VALUES (?, ?, 'email_password', ?, ?, 0, ?, ?, ?)
        `).run(identityId, userId, normEmail, normEmail, passwordHash, ts, ts);

        let save = null;
        if (mergedSaveObj) {
          save = updatePlayerSaveInTx(db, userId, mergedSaveObj, { nowIso: ts });
        } else {
          save = readPlayerSaveRow(db, userId);
        }

        const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        const identities = db.prepare(`
          SELECT id, user_id, provider, provider_subject, email, email_verified, last_used_at, created_at
          FROM auth_identities
          WHERE user_id = ?
          ORDER BY created_at ASC
        `).all(userId).map(mapIdentityRow);

        return {
          user: mapUserRow(updatedUser),
          save,
          identities
        };
      });
    },

    async linkOAuthToGuest({
      userId,
      identityId,
      provider,
      providerSubject,
      email = null,
      emailVerified = true,
      displayName = null,
      nowIso = null,
      mergedSaveObj = null
    }) {
      const db = ensureDb();
      const ts = nowIso || new Date().toISOString();
      const normProvider = String(provider || '').trim().toLowerCase();
      const normSubject = String(providerSubject || '').trim();
      const normEmail = email ? String(email).trim().toLowerCase() : null;

      return runInTransaction(db, () => {
        const currentUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        if (!currentUser || currentUser.status !== 'active') {
          throw createDomainError('NOT_FOUND', '游客账号不存在或已注销', 404);
        }
        if (currentUser.account_type !== 'guest') {
          throw createDomainError('VALIDATION_ERROR', '当前账号已是正式账号，无需游客升级', 400);
        }

        const existingOAuth = db.prepare(`
          SELECT id FROM auth_identities
          WHERE provider = ? AND provider_subject = ?
          LIMIT 1
        `).get(normProvider, normSubject);
        if (existingOAuth) {
          throw createDomainError('VALIDATION_ERROR', '该第三方账号已绑定其他用户', 409);
        }

        if (typeof displayName === 'string' && displayName.trim()) {
          db.prepare(`
            UPDATE users
            SET account_type = 'registered',
                display_name = ?,
                updated_at = ?
            WHERE id = ?
          `).run(displayName.trim().slice(0, 32), ts, userId);
        } else {
          db.prepare(`
            UPDATE users
            SET account_type = 'registered',
                updated_at = ?
            WHERE id = ?
          `).run(ts, userId);
        }

        db.prepare(`
          INSERT INTO auth_identities (
            id, user_id, provider, provider_subject, email, email_verified, password_hash, last_used_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
        `).run(identityId, userId, normProvider, normSubject, normEmail, emailVerified ? 1 : 0, ts, ts);

        const save = mergedSaveObj
          ? updatePlayerSaveInTx(db, userId, mergedSaveObj, { nowIso: ts })
          : readPlayerSaveRow(db, userId);

        const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        const identities = db.prepare(`
          SELECT id, user_id, provider, provider_subject, email, email_verified, last_used_at, created_at
          FROM auth_identities
          WHERE user_id = ?
          ORDER BY created_at ASC
        `).all(userId).map(mapIdentityRow);

        return {
          user: mapUserRow(updatedUser),
          save,
          identities
        };
      });
    },

    async mergeGuestIntoTarget({
      guestUserId,
      targetUserId,
      mergedSaveObj = null,
      coinsDelta = 0,
      luckDelta = 0,
      idempotencyKey = null,
      nowIso = null
    }) {
      const db = ensureDb();
      const ts = nowIso || new Date().toISOString();

      return runInTransaction(db, () => {
        const guestUser = db.prepare('SELECT id, account_type, status FROM users WHERE id = ?').get(guestUserId);
        if (!guestUser || guestUser.status !== 'active') {
          throw createDomainError('NOT_FOUND', '待合并游客账号不存在或已失效', 404);
        }
        const targetUser = db.prepare('SELECT id, account_type, status FROM users WHERE id = ?').get(targetUserId);
        if (!targetUser || targetUser.status !== 'active') {
          throw createDomainError('NOT_FOUND', '目标正式账号不存在或已失效', 404);
        }
        if (guestUserId === targetUserId) {
          throw createDomainError('VALIDATION_ERROR', '源账号与目标账号不能相同', 400);
        }

        db.prepare(`
          UPDATE users
          SET merged_into_user_id = ?,
              updated_at = ?
          WHERE id = ?
        `).run(targetUserId, ts, guestUserId);

        db.prepare(`
          UPDATE sessions
          SET revoked_at = COALESCE(revoked_at, ?)
          WHERE user_id = ?
        `).run(ts, guestUserId);

        let updatedSave = null;
        let ledgerEntry = null;
        if (mergedSaveObj) {
          updatedSave = updatePlayerSaveInTx(db, targetUserId, mergedSaveObj, { nowIso: ts });
          if (updatedSave && (Number(coinsDelta) !== 0 || Number(luckDelta) !== 0)) {
            const key = idempotencyKey || `merge_${guestUserId}_into_${targetUserId}_${ts}`;
            ledgerEntry = recordLedgerInTx(db, {
              userId: targetUserId,
              idempotencyKey: key,
              eventType: 'save_merge_adjustment',
              coinsDelta: Math.trunc(Number(coinsDelta) || 0),
              luckDelta: Math.trunc(Number(luckDelta) || 0),
              coinsAfter: updatedSave.coins,
              luckAfter: updatedSave.luckPoints,
              referenceId: guestUserId,
              metadata: { guestUserId, targetUserId },
              createdAt: ts
            });
          }
        } else {
          updatedSave = readPlayerSaveRow(db, targetUserId);
        }

        return {
          guestUserId,
          targetUserId,
          save: updatedSave,
          ledgerEntry
        };
      });
    },

    async softDeleteAccount({ userId, nowIso = null }) {
      const db = ensureDb();
      const ts = nowIso || new Date().toISOString();

      return runInTransaction(db, () => {
        const res = db.prepare(`
          UPDATE users
          SET status = 'deleted',
              deleted_at = ?,
              updated_at = ?
          WHERE id = ? AND status != 'deleted'
        `).run(ts, ts, userId);

        db.prepare(`
          UPDATE sessions
          SET revoked_at = COALESCE(revoked_at, ?)
          WHERE user_id = ?
        `).run(ts, userId);

        db.prepare(`
          UPDATE auth_identities
          SET email = NULL,
              password_hash = NULL,
              provider_subject = 'deleted_' || id
          WHERE user_id = ?
        `).run(userId);

        return {
          deleted: Boolean(res && res.changes > 0),
          userId,
          deletedAt: ts
        };
      });
    }
  };

  const saves = {
    async getSaveByUserId(userId) {
      return readPlayerSaveRow(ensureDb(), userId);
    },

    async putSaveOptimistic({ userId, baseRevision, snapshot, nowIso = null }) {
      const db = ensureDb();
      const ts = nowIso || new Date().toISOString();
      return runInTransaction(db, () => {
        const updated = updatePlayerSaveInTx(db, userId, snapshot, {
          expectedRevision: baseRevision,
          nowIso: ts
        });
        if (!updated) {
          const current = readPlayerSaveRow(db, userId);
          return { conflict: true, current };
        }
        return { conflict: false, save: updated };
      });
    },

    async mergeSaveAtomic({ userId, baseRevision = undefined, mergedSnapshot, nowIso = null }) {
      const db = ensureDb();
      const ts = nowIso || new Date().toISOString();
      return runInTransaction(db, () => {
        const opts = { nowIso: ts };
        if (baseRevision !== undefined && baseRevision !== null) {
          opts.expectedRevision = baseRevision;
        }
        const updated = updatePlayerSaveInTx(db, userId, mergedSnapshot, opts);
        if (!updated) {
          const current = readPlayerSaveRow(db, userId);
          return { conflict: true, current };
        }
        return { conflict: false, save: updated };
      });
    }
  };

  return { users, saves };
}
