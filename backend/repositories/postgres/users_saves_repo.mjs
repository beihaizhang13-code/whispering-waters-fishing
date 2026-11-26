/**
 * 《微风垂钓物语 2.0》PostgreSQL 用户、身份、会话与云存档仓储实现 (backend/repositories/postgres/users_saves_repo.mjs)
 */
import saveSchema from '../../../shared/save_schema.js';
import {
  computeSaveChecksum,
  createDomainError,
  extractSaveSummary,
  readPlayerSaveRowPg,
  recordLedgerPgInTx,
  runInPgTransaction,
  toIsoString,
  updatePlayerSavePgInTx
} from './helpers.mjs';

function isPgUniqueViolation(err) {
  if (!err) return false;
  if (err.code === '23505') return true;
  return /duplicate key value violates unique constraint|UNIQUE constraint failed/i.test(String(err.message || ''));
}

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
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    deletedAt: toIsoString(row.deleted_at)
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
    lastUsedAt: toIsoString(row.last_used_at),
    createdAt: toIsoString(row.created_at)
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
    expiresAt: toIsoString(row.expires_at),
    revokedAt: toIsoString(row.revoked_at),
    createdAt: toIsoString(row.created_at),
    lastSeenAt: toIsoString(row.last_seen_at)
  };
}

function mapIdentityWithUserRow(row) {
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
      lastUsedAt: toIsoString(row.i_last_used_at),
      createdAt: toIsoString(row.i_created_at)
    },
    user: {
      id: row.u_id,
      accountType: row.u_account_type,
      displayName: row.u_display_name,
      avatarFrame: row.u_avatar_frame,
      status: row.u_status,
      role: row.u_role,
      mergedIntoUserId: row.u_merged_into_user_id || null,
      createdAt: toIsoString(row.u_created_at),
      updatedAt: toIsoString(row.u_updated_at),
      deletedAt: toIsoString(row.u_deleted_at)
    }
  };
}

async function insertInitialSavePgInTx(client, userId, initialSaveObj, nowIso) {
  const saveInput = initialSaveObj || saveSchema.createDefaultPlayerState();
  const summary = extractSaveSummary(saveInput);
  const checksum = computeSaveChecksum(summary.payloadJson);
  const schemaVersion = Number(summary.clean.schemaVersion) || saveSchema.CURRENT_SAVE_SCHEMA_VERSION || 2;

  await client.query(`
    INSERT INTO player_saves (
      user_id, schema_version, revision, coins, luck_points, aquarium_level,
      aquarium_last_settled_at, species_unlocked_count, total_catches,
      save_payload, payload_checksum, updated_at
    ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
  `, [
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
  ]);

  return readPlayerSaveRowPg(client, userId);
}

async function insertSessionPgInTx(queryable, {
  sessionId,
  userId,
  tokenHash,
  deviceLabel = null,
  ipHash = null,
  userAgent = null,
  expiresAt,
  nowIso
}) {
  const res = await queryable.query(`
    INSERT INTO sessions (
      id, user_id, token_hash, device_label, ip_hash, user_agent,
      expires_at, created_at, last_seen_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id, user_id, token_hash, device_label, ip_hash, user_agent,
              expires_at, revoked_at, created_at, last_seen_at
  `, [
    sessionId,
    userId,
    tokenHash,
    deviceLabel ?? null,
    ipHash ?? null,
    userAgent ?? null,
    expiresAt,
    nowIso,
    nowIso
  ]);

  return mapSessionRow(res?.rows?.[0] || null);
}

export function createPostgresUsersAndSavesRepos(getPool) {
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
      const ts = nowIso || new Date().toISOString();

      return runInPgTransaction(getPool, async (client) => {
        const userRes = await client.query(`
          INSERT INTO users (
            id, account_type, display_name, avatar_frame, status, role, created_at, updated_at
          ) VALUES ($1, 'guest', $2, 'straw', 'active', 'player', $3, $4)
          RETURNING *
        `, [userId, displayName, ts, ts]);

        await client.query(`
          INSERT INTO auth_identities (
            id, user_id, provider, provider_subject, email, email_verified, password_hash, last_used_at, created_at
          ) VALUES ($1, $2, 'guest_device', $3, NULL, FALSE, NULL, $4, $5)
        `, [identityId, userId, guestSubject, ts, ts]);

        const session = await insertSessionPgInTx(client, {
          sessionId,
          userId,
          tokenHash,
          deviceLabel,
          ipHash,
          userAgent,
          expiresAt,
          nowIso: ts
        });

        const save = await insertInitialSavePgInTx(client, userId, initialSaveObj, ts);
        return {
          user: mapUserRow(userRes?.rows?.[0] || null),
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
      const ts = nowIso || new Date().toISOString();
      const normEmail = String(email || '').trim().toLowerCase();

      return runInPgTransaction(getPool, async (client) => {
        const userRes = await client.query(`
          INSERT INTO users (
            id, account_type, display_name, avatar_frame, status, role, created_at, updated_at
          ) VALUES ($1, 'registered', $2, 'straw', 'active', 'player', $3, $4)
          RETURNING *
        `, [userId, displayName, ts, ts]);

        try {
          await client.query(`
            INSERT INTO auth_identities (
              id, user_id, provider, provider_subject, email, email_verified, password_hash, last_used_at, created_at
            ) VALUES ($1, $2, 'email_password', $3, $4, FALSE, $5, $6, $7)
          `, [identityId, userId, normEmail, normEmail, passwordHash, ts, ts]);
        } catch (err) {
          if (isPgUniqueViolation(err)) {
            throw createDomainError('VALIDATION_ERROR', '该邮箱已被注册', 409);
          }
          throw err;
        }

        const session = await insertSessionPgInTx(client, {
          sessionId,
          userId,
          tokenHash,
          deviceLabel,
          ipHash,
          userAgent,
          expiresAt,
          nowIso: ts
        });

        const save = await insertInitialSavePgInTx(client, userId, initialSaveObj, ts);
        return {
          user: mapUserRow(userRes?.rows?.[0] || null),
          session,
          save
        };
      });
    },

    async findIdentityByEmail(email) {
      const normEmail = String(email || '').trim().toLowerCase();
      if (!normEmail) return null;
      const pool = await getPool();
      const res = await pool.query(`
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
        WHERE i.provider = 'email_password' AND LOWER(TRIM(i.email)) = $1
        LIMIT 1
      `, [normEmail]);
      return mapIdentityWithUserRow(res?.rows?.[0] || null);
    },

    async findIdentityByProviderSubject(provider, providerSubject) {
      if (!provider || !providerSubject) return null;
      const pool = await getPool();
      const res = await pool.query(`
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
        WHERE i.provider = $1 AND i.provider_subject = $2
        LIMIT 1
      `, [provider, providerSubject]);
      return mapIdentityWithUserRow(res?.rows?.[0] || null);
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
      const ts = nowIso || new Date().toISOString();
      const normEmail = email ? String(email).trim().toLowerCase() : null;

      return runInPgTransaction(getPool, async (client) => {
        const userRes = await client.query(`
          INSERT INTO users (
            id, account_type, display_name, avatar_frame, status, role, created_at, updated_at
          ) VALUES ($1, 'registered', $2, 'straw', 'active', 'player', $3, $4)
          RETURNING *
        `, [userId, displayName, ts, ts]);

        let identityRow = null;
        try {
          const identityRes = await client.query(`
            INSERT INTO auth_identities (
              id, user_id, provider, provider_subject, email, email_verified, password_hash, last_used_at, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8)
            RETURNING id, user_id, provider, provider_subject, email, email_verified, last_used_at, created_at
          `, [
            identityId,
            userId,
            provider,
            providerSubject,
            normEmail,
            Boolean(emailVerified),
            ts,
            ts
          ]);
          identityRow = identityRes?.rows?.[0] || null;
        } catch (err) {
          if (isPgUniqueViolation(err)) {
            throw createDomainError('VALIDATION_ERROR', '该第三方账号已绑定其他用户', 409);
          }
          throw err;
        }

        const session = await insertSessionPgInTx(client, {
          sessionId,
          userId,
          tokenHash,
          deviceLabel,
          ipHash,
          userAgent,
          expiresAt,
          nowIso: ts
        });

        const save = await insertInitialSavePgInTx(client, userId, initialSaveObj, ts);
        return {
          user: mapUserRow(userRes?.rows?.[0] || null),
          identity: mapIdentityRow(identityRow),
          session,
          save
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
      const ts = nowIso || new Date().toISOString();
      const normEmail = email ? String(email).trim().toLowerCase() : null;

      return runInPgTransaction(getPool, async (client) => {
        const currentRes = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
        const currentUser = currentRes?.rows?.[0];
        if (!currentUser || currentUser.status !== 'active') {
          throw createDomainError('NOT_FOUND', '游客账号不存在或已注销', 404);
        }
        if (currentUser.account_type !== 'guest') {
          throw createDomainError('VALIDATION_ERROR', '当前账号已是正式账号，无需游客升级', 400);
        }

        const existingRes = await client.query(`
          SELECT id FROM auth_identities
          WHERE provider = $1 AND provider_subject = $2
          LIMIT 1
        `, [provider, providerSubject]);
        if (existingRes?.rows?.[0]) {
          throw createDomainError('VALIDATION_ERROR', '该第三方账号已绑定其他用户', 409);
        }

        if (typeof displayName === 'string' && displayName.trim()) {
          await client.query(`
            UPDATE users
            SET account_type = 'registered',
                display_name = $1,
                updated_at = $2
            WHERE id = $3
          `, [displayName.trim().slice(0, 32), ts, userId]);
        } else {
          await client.query(`
            UPDATE users
            SET account_type = 'registered',
                updated_at = $1
            WHERE id = $2
          `, [ts, userId]);
        }

        try {
          await client.query(`
            INSERT INTO auth_identities (
              id, user_id, provider, provider_subject, email, email_verified, password_hash, last_used_at, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8)
          `, [
            identityId,
            userId,
            provider,
            providerSubject,
            normEmail,
            Boolean(emailVerified),
            ts,
            ts
          ]);
        } catch (err) {
          if (isPgUniqueViolation(err)) {
            throw createDomainError('VALIDATION_ERROR', '该第三方账号已绑定其他用户', 409);
          }
          throw err;
        }

        let save = null;
        if (mergedSaveObj) {
          save = await updatePlayerSavePgInTx(client, userId, mergedSaveObj, { nowIso: ts });
        } else {
          save = await readPlayerSaveRowPg(client, userId);
        }

        const updatedUserRes = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
        const identitiesRes = await client.query(`
          SELECT id, user_id, provider, provider_subject, email, email_verified, last_used_at, created_at
          FROM auth_identities
          WHERE user_id = $1
          ORDER BY created_at ASC
        `, [userId]);

        return {
          user: mapUserRow(updatedUserRes?.rows?.[0] || null),
          save,
          identities: (identitiesRes?.rows || []).map(mapIdentityRow)
        };
      });
    },

    async findSessionByTokenHash(tokenHash) {
      if (!tokenHash) return null;
      const pool = await getPool();
      const res = await pool.query(`
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
        WHERE s.token_hash = $1
          AND s.revoked_at IS NULL
          AND u.status = 'active'
        LIMIT 1
      `, [tokenHash]);
      const row = res?.rows?.[0];
      if (!row) return null;

      return {
        session: {
          id: row.s_id,
          userId: row.s_user_id,
          tokenHash: row.s_token_hash,
          deviceLabel: row.s_device_label || null,
          ipHash: row.s_ip_hash || null,
          userAgent: row.s_user_agent || null,
          expiresAt: toIsoString(row.s_expires_at),
          revokedAt: toIsoString(row.s_revoked_at),
          createdAt: toIsoString(row.s_created_at),
          lastSeenAt: toIsoString(row.s_last_seen_at)
        },
        user: {
          id: row.u_id,
          accountType: row.u_account_type,
          displayName: row.u_display_name,
          avatarFrame: row.u_avatar_frame,
          status: row.u_status,
          role: row.u_role,
          mergedIntoUserId: row.u_merged_into_user_id || null,
          createdAt: toIsoString(row.u_created_at),
          updatedAt: toIsoString(row.u_updated_at),
          deletedAt: toIsoString(row.u_deleted_at)
        }
      };
    },

    async touchSession(sessionId, nowIso) {
      if (!sessionId) return { updated: false };
      const pool = await getPool();
      const ts = nowIso || new Date().toISOString();
      const res = await pool.query(`
        UPDATE sessions
        SET last_seen_at = $1
        WHERE id = $2 AND revoked_at IS NULL
      `, [ts, sessionId]);
      const changed = res?.rowCount ?? res?.changes ?? 0;
      return { updated: changed > 0 };
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
      const pool = await getPool();
      const ts = nowIso || new Date().toISOString();
      return insertSessionPgInTx(pool, {
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
      const pool = await getPool();
      const ts = nowIso || new Date().toISOString();
      const res = userId
        ? await pool.query(`
            UPDATE sessions
            SET revoked_at = $1
            WHERE id = $2 AND user_id = $3 AND revoked_at IS NULL
          `, [ts, sessionId, userId])
        : await pool.query(`
            UPDATE sessions
            SET revoked_at = $1
            WHERE id = $2 AND revoked_at IS NULL
          `, [ts, sessionId]);
      const changed = res?.rowCount ?? res?.changes ?? 0;
      return { revoked: changed > 0 };
    },

    async listIdentitiesByUserId(userId) {
      const pool = await getPool();
      const res = await pool.query(`
        SELECT id, user_id, provider, provider_subject, email, email_verified, last_used_at, created_at
        FROM auth_identities
        WHERE user_id = $1
        ORDER BY created_at ASC
      `, [userId]);
      return (res?.rows || []).map(mapIdentityRow);
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
      const ts = nowIso || new Date().toISOString();
      const normEmail = String(email || '').trim().toLowerCase();

      return runInPgTransaction(getPool, async (client) => {
        const currentRes = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
        const currentUser = currentRes?.rows?.[0];
        if (!currentUser || currentUser.status !== 'active') {
          throw createDomainError('NOT_FOUND', '游客账号不存在或已注销', 404);
        }
        if (currentUser.account_type !== 'guest') {
          throw createDomainError('VALIDATION_ERROR', '当前账号已是正式账号，无需游客升级', 400);
        }

        const existingRes = await client.query(`
          SELECT id FROM auth_identities
          WHERE provider = 'email_password' AND LOWER(TRIM(email)) = $1
          LIMIT 1
        `, [normEmail]);
        if (existingRes?.rows?.[0]) {
          throw createDomainError('VALIDATION_ERROR', '该邮箱已被注册', 409);
        }

        if (typeof displayName === 'string' && displayName.trim()) {
          await client.query(`
            UPDATE users
            SET account_type = 'registered',
                display_name = $1,
                updated_at = $2
            WHERE id = $3
          `, [displayName.trim().slice(0, 32), ts, userId]);
        } else {
          await client.query(`
            UPDATE users
            SET account_type = 'registered',
                updated_at = $1
            WHERE id = $2
          `, [ts, userId]);
        }

        try {
          await client.query(`
            INSERT INTO auth_identities (
              id, user_id, provider, provider_subject, email, email_verified, password_hash, last_used_at, created_at
            ) VALUES ($1, $2, 'email_password', $3, $4, FALSE, $5, $6, $7)
          `, [identityId, userId, normEmail, normEmail, passwordHash, ts, ts]);
        } catch (err) {
          if (isPgUniqueViolation(err)) {
            throw createDomainError('VALIDATION_ERROR', '该邮箱已被注册', 409);
          }
          throw err;
        }

        let save = null;
        if (mergedSaveObj) {
          save = await updatePlayerSavePgInTx(client, userId, mergedSaveObj, { nowIso: ts });
        } else {
          save = await readPlayerSaveRowPg(client, userId);
        }

        const updatedUserRes = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
        const identitiesRes = await client.query(`
          SELECT id, user_id, provider, provider_subject, email, email_verified, last_used_at, created_at
          FROM auth_identities
          WHERE user_id = $1
          ORDER BY created_at ASC
        `, [userId]);

        return {
          user: mapUserRow(updatedUserRes?.rows?.[0] || null),
          save,
          identities: (identitiesRes?.rows || []).map(mapIdentityRow)
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
      const ts = nowIso || new Date().toISOString();

      return runInPgTransaction(getPool, async (client) => {
        const guestRes = await client.query('SELECT id, account_type, status FROM users WHERE id = $1', [guestUserId]);
        const guestUser = guestRes?.rows?.[0];
        if (!guestUser || guestUser.status !== 'active') {
          throw createDomainError('NOT_FOUND', '待合并游客账号不存在或已失效', 404);
        }
        const targetRes = await client.query('SELECT id, account_type, status FROM users WHERE id = $1', [targetUserId]);
        const targetUser = targetRes?.rows?.[0];
        if (!targetUser || targetUser.status !== 'active') {
          throw createDomainError('NOT_FOUND', '目标正式账号不存在或已失效', 404);
        }
        if (guestUserId === targetUserId) {
          throw createDomainError('VALIDATION_ERROR', '源账号与目标账号不能相同', 400);
        }

        await client.query(`
          UPDATE users
          SET merged_into_user_id = $1,
              updated_at = $2
          WHERE id = $3
        `, [targetUserId, ts, guestUserId]);

        await client.query(`
          UPDATE sessions
          SET revoked_at = COALESCE(revoked_at, $1)
          WHERE user_id = $2
        `, [ts, guestUserId]);

        let updatedSave = null;
        let ledgerEntry = null;
        if (mergedSaveObj) {
          updatedSave = await updatePlayerSavePgInTx(client, targetUserId, mergedSaveObj, { nowIso: ts });
          if (updatedSave && (Number(coinsDelta) !== 0 || Number(luckDelta) !== 0)) {
            const key = idempotencyKey || `merge_${guestUserId}_into_${targetUserId}_${ts}`;
            ledgerEntry = await recordLedgerPgInTx(client, {
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
          updatedSave = await readPlayerSaveRowPg(client, targetUserId);
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
      const ts = nowIso || new Date().toISOString();

      return runInPgTransaction(getPool, async (client) => {
        const res = await client.query(`
          UPDATE users
          SET status = 'deleted',
              deleted_at = $1,
              updated_at = $2
          WHERE id = $3 AND status != 'deleted'
        `, [ts, ts, userId]);

        await client.query(`
          UPDATE sessions
          SET revoked_at = COALESCE(revoked_at, $1)
          WHERE user_id = $2
        `, [ts, userId]);

        await client.query(`
          UPDATE auth_identities
          SET email = NULL,
              password_hash = NULL,
              provider_subject = 'deleted_' || id
          WHERE user_id = $1
        `, [userId]);

        const changed = res?.rowCount ?? res?.changes ?? 0;
        return {
          deleted: changed > 0,
          userId,
          deletedAt: ts
        };
      });
    }
  };

  const saves = {
    async getSaveByUserId(userId) {
      const pool = await getPool();
      return readPlayerSaveRowPg(pool, userId);
    },

    async putSaveOptimistic({ userId, baseRevision, snapshot, nowIso = null }) {
      const ts = nowIso || new Date().toISOString();
      return runInPgTransaction(getPool, async (client) => {
        const updated = await updatePlayerSavePgInTx(client, userId, snapshot, {
          expectedRevision: baseRevision,
          nowIso: ts
        });
        if (!updated) {
          const current = await readPlayerSaveRowPg(client, userId);
          return { conflict: true, current };
        }
        return { conflict: false, save: updated };
      });
    },

    async mergeSaveAtomic({ userId, baseRevision = undefined, mergedSnapshot, nowIso = null }) {
      const ts = nowIso || new Date().toISOString();
      return runInPgTransaction(getPool, async (client) => {
        const opts = { nowIso: ts };
        if (baseRevision !== undefined && baseRevision !== null) {
          opts.expectedRevision = baseRevision;
        }
        const updated = await updatePlayerSavePgInTx(client, userId, mergedSnapshot, opts);
        if (!updated) {
          const current = await readPlayerSaveRowPg(client, userId);
          return { conflict: true, current };
        }
        return { conflict: false, save: updated };
      });
    }
  };

  return { users, saves };
}
