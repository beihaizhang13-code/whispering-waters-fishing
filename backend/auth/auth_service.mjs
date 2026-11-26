/**
 * 《微风垂钓物语 2.0》账号认证与游客升级服务 (backend/auth/auth_service.mjs)
 * ----------------------------------------------------------------------------
 * 职责边界：
 * - 游客免登录即玩：签发随机高熵 guest_device 凭据，仅将 SHA-256 哈希存入 sessions / auth_identities；
 * - 邮箱/密码注册与登录：使用 Node.js 内置 crypto.scrypt + timingSafeEqual 校验密码；
 * - Google & GitHub OAuth 2.0 登录与游客升级：支持防篡改 HMAC state、授权码换取与无损游客合并；
 * - 游客升级绑定：将临时游客用户平滑绑定 email_password 或第三方 OAuth，并触发存档无损合并；
 * - 合规注销：支持软删除与吊销全部会话、清理个人认证凭据。
 */
import crypto from 'node:crypto';
import saveSchema from '../../shared/save_schema.js';
import gameCatalog from '../../shared/game_catalog.js';
import { sha256Hex } from '../http/middleware.mjs';
import { createDomainError } from '../repositories/sqlite/helpers.mjs';
import { mergeSaveSnapshotsPure } from '../domain/save_merge_service.mjs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const OAUTH_PROVIDER_META = Object.freeze({
  google: Object.freeze({
    id: 'google',
    label: 'Google',
    clientIdKey: 'oauthGoogleClientId',
    clientSecretKey: 'oauthGoogleClientSecret',
    clientIdEnv: 'OAUTH_GOOGLE_CLIENT_ID',
    clientSecretEnv: 'OAUTH_GOOGLE_CLIENT_SECRET',
    authorizeEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    userInfoEndpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
    fallbackDisplayName: 'Google钓友'
  }),
  github: Object.freeze({
    id: 'github',
    label: 'GitHub',
    clientIdKey: 'oauthGithubClientId',
    clientSecretKey: 'oauthGithubClientSecret',
    clientIdEnv: 'OAUTH_GITHUB_CLIENT_ID',
    clientSecretEnv: 'OAUTH_GITHUB_CLIENT_SECRET',
    authorizeEndpoint: 'https://github.com/login/oauth/authorize',
    tokenEndpoint: 'https://github.com/login/oauth/access_token',
    userInfoEndpoint: 'https://api.github.com/user',
    emailsEndpoint: 'https://api.github.com/user/emails',
    scope: 'read:user user:email',
    fallbackDisplayName: 'GitHub钓友'
  })
});

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validateEmailOrThrow(email) {
  const norm = normalizeEmail(email);
  if (!norm || norm.length > 254 || !EMAIL_RE.test(norm)) {
    throw createDomainError('VALIDATION_ERROR', '邮箱格式不正确', 400);
  }
  return norm;
}

function validatePasswordOrThrow(password) {
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
    throw createDomainError('VALIDATION_ERROR', '密码长度必须为 6 到 128 位', 400);
  }
  return password;
}

function hashPassword(password) {
  const saltHex = crypto.randomBytes(16).toString('hex');
  const hashHex = crypto.scryptSync(password, saltHex, 64).toString('hex');
  return `scrypt$${saltHex}$${hashHex}`;
}

function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, saltHex, hashHex] = parts;
  if (!saltHex || !hashHex) return false;
  try {
    const derived = crypto.scryptSync(password, saltHex, 64);
    const expected = Buffer.from(hashHex, 'hex');
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function generateSessionToken(prefix) {
  return `${prefix}_${crypto.randomBytes(32).toString('hex')}`;
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    accountType: user.accountType,
    displayName: user.displayName,
    avatarFrame: user.avatarFrame,
    status: user.status,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function isUntouchedFreshSave(saveRow) {
  if (!saveRow || saveRow.revision !== 1 || !saveRow.snapshot) return false;
  const s = saveRow.snapshot;
  return (
    Object.keys(s.records || {}).length === 0 &&
    Number(s.coins) === 80 &&
    Number(s.luckPoints) === 0 &&
    Number(s.rodLevel) === 1 &&
    Number(s.reelLevel) === 1 &&
    Number(s.aquariumLevel) === 1 &&
    (s.basket || []).length === 0 &&
    (s.aquarium || []).length === 0
  );
}

function resolveOAuthProviderMeta(provider) {
  const norm = String(provider || '').trim().toLowerCase();
  const meta = OAUTH_PROVIDER_META[norm];
  if (!meta) {
    throw createDomainError(
      'VALIDATION_ERROR',
      `不支持的 OAuth 登录提供商: ${String(provider || '')}，仅支持 google 或 github`,
      400
    );
  }
  return meta;
}

function getOAuthCredentialsOrThrow(config, meta, { requireSecret = false } = {}) {
  const clientId = String(config?.[meta.clientIdKey] || '').trim();
  const clientSecret = String(config?.[meta.clientSecretKey] || '').trim();
  const missingEnv = [];
  if (!clientId) missingEnv.push(meta.clientIdEnv);
  if (requireSecret && !clientSecret) missingEnv.push(meta.clientSecretEnv);

  if (missingEnv.length > 0) {
    throw createDomainError(
      'SERVICE_UNAVAILABLE',
      `${meta.label} OAuth 未配置，请设置环境变量: ${missingEnv.join(', ')}`,
      503,
      { provider: meta.id, missingEnv }
    );
  }
  return { clientId, clientSecret };
}

function signOAuthState(payload, secret) {
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sigB64 = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sigB64}`;
}

function verifyOAuthState(state, expectedProvider, secret) {
  if (typeof state !== 'string' || !state.trim()) {
    throw createDomainError('VALIDATION_ERROR', '缺少 OAuth state 参数', 400);
  }
  const parts = state.trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw createDomainError('UNAUTHORIZED', 'OAuth state 格式无效', 401);
  }
  const [payloadB64, sigB64] = parts;
  const expectedSigB64 = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const expectedBuf = Buffer.from(expectedSigB64, 'utf8');
  const actualBuf = Buffer.from(sigB64, 'utf8');
  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    throw createDomainError('UNAUTHORIZED', 'OAuth state 签名校验失败', 401);
  }

  let payload = null;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    throw createDomainError('UNAUTHORIZED', 'OAuth state 载荷解析失败', 401);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createDomainError('UNAUTHORIZED', 'OAuth state 载荷无效', 401);
  }
  if (payload.provider !== expectedProvider) {
    throw createDomainError('UNAUTHORIZED', 'OAuth state 与当前登录提供商不匹配', 401);
  }
  if (typeof payload.nonce !== 'string' || !payload.nonce) {
    throw createDomainError('UNAUTHORIZED', 'OAuth state 缺少 nonce', 401);
  }
  if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= Date.now()) {
    throw createDomainError('UNAUTHORIZED', 'OAuth 授权状态已过期，请重新发起登录', 401);
  }
  return payload;
}

async function safeReadJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchOAuthProfile({ meta, clientId, clientSecret, code, redirectUri, httpFetch }) {
  if (typeof httpFetch !== 'function') {
    throw createDomainError('SERVICE_UNAVAILABLE', '当前运行时不支持 fetch，无法请求第三方 OAuth 服务', 503);
  }

  const tokenParams = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri
  });
  if (meta.id === 'google') {
    tokenParams.set('grant_type', 'authorization_code');
  }

  let tokenRes;
  try {
    tokenRes = await httpFetch(meta.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: tokenParams.toString()
    });
  } catch (err) {
    throw createDomainError('SERVICE_UNAVAILABLE', `请求 ${meta.label} 令牌接口失败: ${err?.message || '网络异常'}`, 503);
  }

  const tokenData = await safeReadJson(tokenRes);
  if (!tokenRes.ok) {
    if (tokenRes.status >= 500) {
      throw createDomainError('SERVICE_UNAVAILABLE', `${meta.label} 令牌服务暂不可用`, 503);
    }
    throw createDomainError(
      'UNAUTHORIZED',
      `${meta.label} 授权码无效或已过期`,
      401,
      tokenData?.error ? { oauthError: tokenData.error } : null
    );
  }
  if (!tokenData || tokenData.error || !tokenData.access_token) {
    throw createDomainError(
      'UNAUTHORIZED',
      `${meta.label} 未返回有效的访问令牌`,
      401,
      tokenData?.error ? { oauthError: tokenData.error } : null
    );
  }

  const accessToken = tokenData.access_token;
  const userHeaders = {
    Authorization: `Bearer ${accessToken}`,
    Accept: meta.id === 'github' ? 'application/vnd.github+json' : 'application/json',
    ...(meta.id === 'github' ? { 'User-Agent': 'WhisperingWatersFishing/2.0' } : {})
  };

  let userRes;
  try {
    userRes = await httpFetch(meta.userInfoEndpoint, { headers: userHeaders });
  } catch (err) {
    throw createDomainError('SERVICE_UNAVAILABLE', `请求 ${meta.label} 用户信息接口失败: ${err?.message || '网络异常'}`, 503);
  }

  const profile = await safeReadJson(userRes);
  if (!userRes.ok || !profile) {
    if (userRes.status >= 500) {
      throw createDomainError('SERVICE_UNAVAILABLE', `${meta.label} 用户信息服务暂不可用`, 503);
    }
    throw createDomainError('UNAUTHORIZED', `获取 ${meta.label} 用户信息失败`, 401);
  }

  if (meta.id === 'google') {
    const providerSubject = profile.sub ? String(profile.sub).trim() : '';
    if (!providerSubject) {
      throw createDomainError('UNAUTHORIZED', 'Google 未返回有效的用户标识 sub', 401);
    }
    const email = profile.email ? normalizeEmail(profile.email) : null;
    const rawName = profile.name || profile.given_name || (email ? email.split('@')[0] : meta.fallbackDisplayName);
    return {
      providerSubject,
      email,
      emailVerified: Boolean(profile.email_verified),
      displayName: String(rawName).trim().slice(0, 32) || meta.fallbackDisplayName
    };
  }

  const providerSubject = (profile.id !== undefined && profile.id !== null) ? String(profile.id).trim() : '';
  if (!providerSubject) {
    throw createDomainError('UNAUTHORIZED', 'GitHub 未返回有效的用户标识 id', 401);
  }

  let email = profile.email ? normalizeEmail(profile.email) : null;
  let emailVerified = false;
  if (meta.emailsEndpoint) {
    try {
      const emailsRes = await httpFetch(meta.emailsEndpoint, { headers: userHeaders });
      if (emailsRes && emailsRes.ok) {
        const emails = await safeReadJson(emailsRes);
        if (Array.isArray(emails) && emails.length > 0) {
          const picked =
            emails.find(e => e && e.primary && e.verified) ||
            emails.find(e => e && e.verified) ||
            emails.find(e => e && e.primary) ||
            emails[0];
          if (picked && picked.email) {
            email = normalizeEmail(picked.email);
            emailVerified = Boolean(picked.verified);
          }
        }
      }
    } catch {
      // 若邮箱列表请求失败，回退使用 /user 返回的公开邮箱
    }
  }

  const rawName = profile.name || profile.login || (email ? email.split('@')[0] : meta.fallbackDisplayName);
  return {
    providerSubject,
    email,
    emailVerified,
    displayName: String(rawName).trim().slice(0, 32) || meta.fallbackDisplayName
  };
}

export function createAuthService({ config, repositories, saveMergeService, logger, fetchFn } = {}) {
  const sessionTtlDays = Number(config?.sessionTtlDays) > 0 ? Number(config.sessionTtlDays) : 30;
  const sessionSecret = String(config?.authSessionSecret || 'dev-insecure-session-secret-change-in-prod');
  const httpFetch = typeof fetchFn === 'function' ? fetchFn : globalThis.fetch;

  function buildOAuthRedirectUri(provider, origin) {
    const base = String(config?.oauthRedirectBaseUrl || origin || '').trim().replace(/\/+$/, '');
    if (!base) {
      throw createDomainError('VALIDATION_ERROR', '缺少 OAuth 回调基础地址 origin 或 OAUTH_REDIRECT_BASE_URL', 400);
    }
    return `${base}/api/v1/auth/oauth/${provider}/callback`;
  }

  function computeExpiresAt(nowMs = Date.now()) {
    return new Date(nowMs + sessionTtlDays * 86400 * 1000).toISOString();
  }

  function mergeWithLocalIfProvided(cloudSaveRow, localSaveSnapshot) {
    if (!localSaveSnapshot) return null;
    if (saveMergeService && typeof saveMergeService.mergeTwoSnapshots === 'function') {
      return saveMergeService.mergeTwoSnapshots(
        cloudSaveRow?.snapshot || saveSchema.createDefaultPlayerState(),
        localSaveSnapshot,
        { isFreshCloud: isUntouchedFreshSave(cloudSaveRow) }
      ).mergedSnapshot;
    }
    return mergeSaveSnapshotsPure(
      cloudSaveRow?.snapshot || saveSchema.createDefaultPlayerState(),
      localSaveSnapshot,
      { isFreshCloud: isUntouchedFreshSave(cloudSaveRow) }
    ).mergedSnapshot;
  }

  return {
    /** 创建游客账号并签发高熵设备凭证 */
    async issueGuestSession({ deviceLabel = null, ipHash = null, userAgent = null } = {}) {
      const nowIso = new Date().toISOString();
      const userId = `usr_${crypto.randomUUID()}`;
      const identityId = `idn_${crypto.randomUUID()}`;
      const guestSubject = `guest_${crypto.randomUUID()}`;
      const sessionId = `ses_${crypto.randomUUID()}`;
      const token = generateSessionToken('gst');
      const tokenHash = sha256Hex(token);
      const expiresAt = computeExpiresAt();
      const displayName = `微风旅人#${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

      const created = await repositories.users.createGuestUser({
        userId,
        displayName,
        identityId,
        guestSubject,
        sessionId,
        tokenHash,
        expiresAt,
        deviceLabel,
        ipHash,
        userAgent,
        initialSaveObj: saveSchema.createDefaultPlayerState(),
        nowIso
      });

      logger?.info?.('guest_session_issued', { userId, sessionId });
      return {
        user: sanitizeUser(created.user),
        token,
        tokenType: 'guest',
        expiresAt,
        sessionId: created.session.id,
        save: created.save
      };
    },

    /** 使用邮箱与密码注册正式账号（若附带有效游客令牌则自动原地升级并合并存档） */
    async registerWithEmail({
      email,
      password,
      displayName = null,
      guestToken = null,
      localSaveSnapshot = null,
      deviceLabel = null,
      ipHash = null,
      userAgent = null
    } = {}) {
      const normEmail = validateEmailOrThrow(email);
      validatePasswordOrThrow(password);

      const existing = await repositories.users.findIdentityByEmail(normEmail);
      if (existing) {
        throw createDomainError('VALIDATION_ERROR', '该邮箱已被注册', 409);
      }

      const finalDisplayName = (typeof displayName === 'string' && displayName.trim())
        ? displayName.trim().slice(0, 32)
        : normEmail.split('@')[0].slice(0, 24);
      const passwordHash = hashPassword(password);
      const nowIso = new Date().toISOString();

      // 检查是否传入有效 guestToken
      let validGuest = null;
      if (typeof guestToken === 'string' && guestToken.trim()) {
        const guestSession = await repositories.users.findSessionByTokenHash(sha256Hex(guestToken.trim()));
        if (
          guestSession &&
          guestSession.user &&
          guestSession.user.accountType === 'guest' &&
          guestSession.user.status === 'active' &&
          Date.parse(guestSession.session.expiresAt) > Date.now()
        ) {
          validGuest = guestSession;
        }
      }

      if (validGuest) {
        const guestUserId = validGuest.user.id;
        const guestSave = await repositories.saves.getSaveByUserId(guestUserId);
        const mergedSaveObj = mergeWithLocalIfProvided(guestSave, localSaveSnapshot);

        const upgraded = await repositories.users.upgradeGuestToRegistered({
          userId: guestUserId,
          identityId: `idn_${crypto.randomUUID()}`,
          email: normEmail,
          passwordHash,
          displayName: typeof displayName === 'string' && displayName.trim() ? finalDisplayName : null,
          nowIso,
          mergedSaveObj
        });

        const token = generateSessionToken('ses');
        const sessionId = `ses_${crypto.randomUUID()}`;
        const expiresAt = computeExpiresAt();
        await repositories.users.createSession({
          sessionId,
          userId: guestUserId,
          tokenHash: sha256Hex(token),
          deviceLabel,
          ipHash,
          userAgent,
          expiresAt,
          nowIso
        });

        logger?.info?.('guest_registered_inplace', { userId: guestUserId });
        return {
          user: sanitizeUser(upgraded.user),
          token,
          tokenType: 'bearer',
          expiresAt,
          sessionId,
          upgradedFromGuest: true,
          save: upgraded.save
        };
      }

      let initialSaveObj = saveSchema.createDefaultPlayerState();
      if (localSaveSnapshot) {
        const check = saveSchema.sanitizeAndValidateSave(localSaveSnapshot, gameCatalog);
        if (!check.valid) {
          throw createDomainError(
            'VALIDATION_ERROR',
            check.errors[0] || '本地存档格式校验失败',
            400,
            { errors: check.errors }
          );
        }
        initialSaveObj = check.sanitized;
      }

      const userId = `usr_${crypto.randomUUID()}`;
      const identityId = `idn_${crypto.randomUUID()}`;
      const sessionId = `ses_${crypto.randomUUID()}`;
      const token = generateSessionToken('ses');
      const expiresAt = computeExpiresAt();

      const created = await repositories.users.createRegisteredUser({
        userId,
        displayName: finalDisplayName,
        identityId,
        email: normEmail,
        passwordHash,
        sessionId,
        tokenHash: sha256Hex(token),
        expiresAt,
        deviceLabel,
        ipHash,
        userAgent,
        initialSaveObj,
        nowIso
      });

      logger?.info?.('user_registered', { userId });
      return {
        user: sanitizeUser(created.user),
        token,
        tokenType: 'bearer',
        expiresAt,
        sessionId: created.session.id,
        upgradedFromGuest: false,
        save: created.save
      };
    },

    /** 邮箱密码登录并签发新会话 */
    async loginWithEmail({
      email,
      password,
      deviceLabel = null,
      ipHash = null,
      userAgent = null
    } = {}) {
      if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
        throw createDomainError('VALIDATION_ERROR', '请提供邮箱与密码', 400);
      }
      const normEmail = normalizeEmail(email);
      const found = await repositories.users.findIdentityByEmail(normEmail);
      if (!found || !found.user || found.user.status !== 'active') {
        throw createDomainError('UNAUTHORIZED', '邮箱或密码错误', 401);
      }
      if (!verifyPassword(password, found.identity.passwordHash)) {
        throw createDomainError('UNAUTHORIZED', '邮箱或密码错误', 401);
      }

      const nowIso = new Date().toISOString();
      const sessionId = `ses_${crypto.randomUUID()}`;
      const token = generateSessionToken('ses');
      const expiresAt = computeExpiresAt();

      await repositories.users.createSession({
        sessionId,
        userId: found.user.id,
        tokenHash: sha256Hex(token),
        deviceLabel,
        ipHash,
        userAgent,
        expiresAt,
        nowIso
      });

      const save = await repositories.saves.getSaveByUserId(found.user.id);
      logger?.info?.('user_logged_in', { userId: found.user.id, sessionId });
      return {
        user: sanitizeUser(found.user),
        token,
        tokenType: 'bearer',
        expiresAt,
        sessionId,
        save
      };
    },

    /** 游客账号原地绑定正式邮箱（或合并入已有正式账号），并与本地存档执行合并 */
    async upgradeGuestIdentity({
      guestUserId,
      targetProvider = 'email_password',
      credentials = {},
      localSaveSnapshot = null
    } = {}) {
      if (targetProvider !== 'email_password') {
        throw createDomainError(
          'NOT_IMPLEMENTED',
          `暂不支持升级绑定 ${String(targetProvider)}，当前仅支持 email_password`,
          501
        );
      }

      const normEmail = validateEmailOrThrow(credentials?.email);
      validatePasswordOrThrow(credentials?.password);
      const nowIso = new Date().toISOString();

      const existing = await repositories.users.findIdentityByEmail(normEmail);
      if (existing) {
        // 情况 B：显式允许合并到已有正式账号且密码校验通过
        if (
          credentials?.mergeExisting &&
          existing.user &&
          existing.user.status === 'active' &&
          existing.user.id !== guestUserId &&
          verifyPassword(credentials.password, existing.identity.passwordHash)
        ) {
          const guestSave = await repositories.saves.getSaveByUserId(guestUserId);
          const targetSave = await repositories.saves.getSaveByUserId(existing.user.id);
          const effectiveGuestSnap = mergeWithLocalIfProvided(guestSave, localSaveSnapshot)
            || guestSave?.snapshot
            || saveSchema.createDefaultPlayerState();
          const merged = mergeSaveSnapshotsPure(
            targetSave?.snapshot || saveSchema.createDefaultPlayerState(),
            effectiveGuestSnap,
            { isFreshCloud: isUntouchedFreshSave(targetSave) }
          ).mergedSnapshot;

          const coinsDelta = (merged.coins || 0) - (targetSave?.coins || 0);
          const luckDelta = (merged.luckPoints || 0) - (targetSave?.luckPoints || 0);
          const mergeRes = await repositories.users.mergeGuestIntoTarget({
            guestUserId,
            targetUserId: existing.user.id,
            mergedSaveObj: merged,
            coinsDelta,
            luckDelta,
            nowIso
          });

          const token = generateSessionToken('ses');
          const sessionId = `ses_${crypto.randomUUID()}`;
          const expiresAt = computeExpiresAt();
          await repositories.users.createSession({
            sessionId,
            userId: existing.user.id,
            tokenHash: sha256Hex(token),
            expiresAt,
            nowIso
          });

          return {
            user: sanitizeUser(existing.user),
            token,
            tokenType: 'bearer',
            expiresAt,
            sessionId,
            upgradedFromGuest: true,
            mergedIntoExisting: true,
            save: mergeRes.save
          };
        }
        throw createDomainError('VALIDATION_ERROR', '该邮箱已被注册', 409);
      }

      const guestSave = await repositories.saves.getSaveByUserId(guestUserId);
      const mergedSaveObj = mergeWithLocalIfProvided(guestSave, localSaveSnapshot);
      const displayName = typeof credentials?.displayName === 'string' && credentials.displayName.trim()
        ? credentials.displayName.trim().slice(0, 32)
        : null;

      const upgraded = await repositories.users.upgradeGuestToRegistered({
        userId: guestUserId,
        identityId: `idn_${crypto.randomUUID()}`,
        email: normEmail,
        passwordHash: hashPassword(credentials.password),
        displayName,
        nowIso,
        mergedSaveObj
      });

      const token = generateSessionToken('ses');
      const sessionId = `ses_${crypto.randomUUID()}`;
      const expiresAt = computeExpiresAt();
      await repositories.users.createSession({
        sessionId,
        userId: guestUserId,
        tokenHash: sha256Hex(token),
        expiresAt,
        nowIso
      });

      logger?.info?.('guest_upgraded_to_email', { userId: guestUserId });
      return {
        user: sanitizeUser(upgraded.user),
        token,
        tokenType: 'bearer',
        expiresAt,
        sessionId,
        upgradedFromGuest: true,
        mergedIntoExisting: false,
        save: upgraded.save,
        identities: upgraded.identities
      };
    },

    /** 根据 Bearer / Guest 会话凭证解析当前活跃用户并刷新 last_seen_at */
    async resolveSessionUser({ scheme, token } = {}) {
      if (!token || (scheme !== 'bearer' && scheme !== 'guest')) {
        return null;
      }
      const tokenHash = sha256Hex(String(token).trim());
      const found = await repositories.users.findSessionByTokenHash(tokenHash);
      if (!found || !found.session || !found.user) {
        return null;
      }
      const expMs = Date.parse(found.session.expiresAt);
      if (!Number.isFinite(expMs) || expMs <= Date.now()) {
        return null;
      }
      if (found.user.status !== 'active') {
        return null;
      }

      await repositories.users.touchSession(found.session.id, new Date().toISOString());
      return {
        user: sanitizeUser(found.user),
        session: found.session
      };
    },

    /** 注销当前会话 */
    async revokeSession({ sessionId, userId = null } = {}) {
      if (!sessionId) {
        throw createDomainError('VALIDATION_ERROR', '缺少有效会话标识', 400);
      }
      await repositories.users.revokeSession(sessionId, userId, new Date().toISOString());
      return { revoked: true, sessionId };
    },

    /** 账号注销与数据清理（合规） */
    async deleteAccount({ userId, confirmText } = {}) {
      if (confirmText !== 'DELETE' && confirmText !== '确认注销') {
        throw createDomainError(
          'VALIDATION_ERROR',
          '注销确认文本无效，请输入 DELETE 或 确认注销',
          400
        );
      }
      const result = await repositories.users.softDeleteAccount({
        userId,
        nowIso: new Date().toISOString()
      });
      logger?.info?.('account_soft_deleted', { userId });
      return result;
    },

    /** 构造 Google / GitHub OAuth 2.0 授权重定向地址与防篡改 state */
    async buildOAuthAuthorizationUrl({
      provider,
      origin,
      guestUserId = null,
      redirectAfter = null
    } = {}) {
      const meta = resolveOAuthProviderMeta(provider);
      const { clientId } = getOAuthCredentialsOrThrow(config, meta, { requireSecret: false });
      const redirectUri = buildOAuthRedirectUri(meta.id, origin);
      const statePayload = {
        provider: meta.id,
        nonce: crypto.randomBytes(16).toString('hex'),
        guestUserId: guestUserId || null,
        redirectAfter: redirectAfter || null,
        exp: Date.now() + OAUTH_STATE_TTL_MS
      };
      const state = signOAuthState(statePayload, sessionSecret);

      const url = new URL(meta.authorizeEndpoint);
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('scope', meta.scope);
      url.searchParams.set('state', state);
      if (meta.id === 'google') {
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('access_type', 'online');
        url.searchParams.set('prompt', 'select_account');
      }

      logger?.info?.('oauth_authorize_url_built', {
        provider: meta.id,
        hasGuestContext: Boolean(guestUserId)
      });

      return {
        provider: meta.id,
        authorizeUrl: url.toString(),
        state,
        redirectUri
      };
    },

    /** 处理 Google / GitHub OAuth 2.0 回调：验签 state、换取用户信息并登录或升级游客账号 */
    async handleOAuthCallback({
      provider,
      code,
      state,
      origin,
      deviceLabel = null,
      ipHash = null,
      userAgent = null
    } = {}) {
      const meta = resolveOAuthProviderMeta(provider);
      if (typeof code !== 'string' || !code.trim()) {
        throw createDomainError('VALIDATION_ERROR', '缺少 OAuth 授权码 code 参数', 400);
      }

      const statePayload = verifyOAuthState(state, meta.id, sessionSecret);
      const { clientId, clientSecret } = getOAuthCredentialsOrThrow(config, meta, { requireSecret: true });
      const redirectUri = buildOAuthRedirectUri(meta.id, origin);

      const profile = await fetchOAuthProfile({
        meta,
        clientId,
        clientSecret,
        code: code.trim(),
        redirectUri,
        httpFetch
      });

      const nowIso = new Date().toISOString();
      const existing = await repositories.users.findIdentityByProviderSubject(meta.id, profile.providerSubject);

      if (existing) {
        if (!existing.user || existing.user.status !== 'active') {
          throw createDomainError('UNAUTHORIZED', '该账号已被停用或注销', 401);
        }

        let upgradedFromGuest = false;
        let save = null;

        if (statePayload.guestUserId && statePayload.guestUserId !== existing.user.id) {
          try {
            const guestIdentities = await repositories.users.listIdentitiesByUserId(statePayload.guestUserId);
            const isPureGuest = guestIdentities.length > 0 && guestIdentities.every(i => i.provider === 'guest_device');
            if (isPureGuest) {
              const guestSave = await repositories.saves.getSaveByUserId(statePayload.guestUserId);
              const targetSave = await repositories.saves.getSaveByUserId(existing.user.id);
              const merged = mergeSaveSnapshotsPure(
                targetSave?.snapshot || saveSchema.createDefaultPlayerState(),
                guestSave?.snapshot || saveSchema.createDefaultPlayerState(),
                { isFreshCloud: isUntouchedFreshSave(targetSave) }
              ).mergedSnapshot;
              const coinsDelta = (merged.coins || 0) - (targetSave?.coins || 0);
              const luckDelta = (merged.luckPoints || 0) - (targetSave?.luckPoints || 0);
              const mergeRes = await repositories.users.mergeGuestIntoTarget({
                guestUserId: statePayload.guestUserId,
                targetUserId: existing.user.id,
                mergedSaveObj: merged,
                coinsDelta,
                luckDelta,
                nowIso
              });
              save = mergeRes.save;
              upgradedFromGuest = true;
              logger?.info?.('oauth_guest_merged_into_existing', {
                provider: meta.id,
                guestUserId: statePayload.guestUserId,
                targetUserId: existing.user.id
              });
            }
          } catch (err) {
            logger?.warn?.('oauth_guest_merge_skipped', {
              provider: meta.id,
              guestUserId: statePayload.guestUserId,
              targetUserId: existing.user.id,
              reason: err?.message
            });
          }
        }

        if (!save) {
          save = await repositories.saves.getSaveByUserId(existing.user.id);
        }

        const sessionId = `ses_${crypto.randomUUID()}`;
        const token = generateSessionToken('ses');
        const expiresAt = computeExpiresAt();
        await repositories.users.createSession({
          sessionId,
          userId: existing.user.id,
          tokenHash: sha256Hex(token),
          deviceLabel,
          ipHash,
          userAgent,
          expiresAt,
          nowIso
        });

        logger?.info?.('oauth_user_logged_in', {
          provider: meta.id,
          userId: existing.user.id,
          sessionId,
          upgradedFromGuest
        });

        return {
          user: sanitizeUser(existing.user),
          token,
          tokenType: 'bearer',
          expiresAt,
          sessionId,
          provider: meta.id,
          upgradedFromGuest,
          save
        };
      }

      if (statePayload.guestUserId) {
        try {
          const upgraded = await repositories.users.linkOAuthToGuest({
            userId: statePayload.guestUserId,
            identityId: `idn_${crypto.randomUUID()}`,
            provider: meta.id,
            providerSubject: profile.providerSubject,
            email: profile.email,
            emailVerified: profile.emailVerified,
            displayName: profile.displayName,
            nowIso,
            mergedSaveObj: null
          });

          const sessionId = `ses_${crypto.randomUUID()}`;
          const token = generateSessionToken('ses');
          const expiresAt = computeExpiresAt();
          await repositories.users.createSession({
            sessionId,
            userId: upgraded.user.id,
            tokenHash: sha256Hex(token),
            deviceLabel,
            ipHash,
            userAgent,
            expiresAt,
            nowIso
          });

          logger?.info?.('oauth_guest_upgraded_inplace', {
            provider: meta.id,
            userId: upgraded.user.id,
            sessionId
          });

          return {
            user: sanitizeUser(upgraded.user),
            token,
            tokenType: 'bearer',
            expiresAt,
            sessionId,
            provider: meta.id,
            upgradedFromGuest: true,
            save: upgraded.save
          };
        } catch (err) {
          const isStaleOrAlreadyRegistered =
            err?.status === 404 ||
            (err?.code === 'VALIDATION_ERROR' && err?.status === 400);
          if (!isStaleOrAlreadyRegistered) {
            throw err;
          }
          logger?.warn?.('oauth_guest_link_fallback_to_create', {
            provider: meta.id,
            guestUserId: statePayload.guestUserId,
            reason: err?.message
          });
        }
      }

      const userId = `usr_${crypto.randomUUID()}`;
      const identityId = `idn_${crypto.randomUUID()}`;
      const sessionId = `ses_${crypto.randomUUID()}`;
      const token = generateSessionToken('ses');
      const expiresAt = computeExpiresAt();

      const created = await repositories.users.createOAuthUser({
        userId,
        displayName: profile.displayName,
        identityId,
        provider: meta.id,
        providerSubject: profile.providerSubject,
        email: profile.email,
        emailVerified: profile.emailVerified,
        sessionId,
        tokenHash: sha256Hex(token),
        expiresAt,
        deviceLabel,
        ipHash,
        userAgent,
        initialSaveObj: saveSchema.createDefaultPlayerState(),
        nowIso
      });

      logger?.info?.('oauth_user_created', {
        provider: meta.id,
        userId,
        sessionId
      });

      return {
        user: sanitizeUser(created.user),
        token,
        tokenType: 'bearer',
        expiresAt,
        sessionId: created.session.id,
        provider: meta.id,
        upgradedFromGuest: false,
        save: created.save
      };
    }
  };
}
