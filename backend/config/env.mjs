/**
 * 《微风垂钓物语 2.0》运行时环境配置加载器 (backend/config/env.mjs)
 * ----------------------------------------------------------------------------
 * 同时兼容本地 Node.js (`process.env` + 可选 `.env` 加载) 与 Netlify Functions (`Netlify.env`)。
 */
import fs from 'node:fs';
import path from 'node:path';

function parseDotEnvFile(filePath) {
  const result = {};
  if (!fs.existsSync(filePath)) return result;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

function readEnvValue(key, envObj, fallback) {
  if (typeof globalThis !== 'undefined' && globalThis.Netlify && globalThis.Netlify.env) {
    try {
      const netlifyVal = globalThis.Netlify.env.get(key);
      if (netlifyVal !== undefined && netlifyVal !== '') return netlifyVal;
    } catch {
      // 非 Netlify 运行时忽略
    }
  }
  if (envObj && envObj[key] !== undefined && envObj[key] !== '') {
    return envObj[key];
  }
  return fallback;
}

function parseBoolean(val, fallback = false) {
  if (val === undefined || val === null || val === '') return fallback;
  const normalized = String(val).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return fallback;
}

function parsePositiveInt(val, fallback) {
  const num = Number(val);
  return Number.isInteger(num) && num > 0 ? num : fallback;
}

export function loadConfig(overrides = {}) {
  const cwd = overrides.cwd || process.cwd();
  const dotEnv = overrides.skipDotEnv ? {} : parseDotEnvFile(path.join(cwd, '.env'));
  const mergedEnv = { ...dotEnv, ...process.env, ...overrides.env };

  const isNetlify = Boolean(
    mergedEnv.NETLIFY ||
    mergedEnv.NETLIFY_LOCAL ||
    (typeof globalThis !== 'undefined' && globalThis.Netlify)
  );

  const storageDriver = readEnvValue(
    'STORAGE_DRIVER',
    mergedEnv,
    isNetlify && readEnvValue('NETLIFY_DB_URL', mergedEnv, '') ? 'postgres' : 'sqlite'
  );

  return Object.freeze({
    nodeEnv: readEnvValue('NODE_ENV', mergedEnv, 'development'),
    appEnv: readEnvValue('APP_ENV', mergedEnv, isNetlify ? 'netlify' : 'local'),
    runtime: isNetlify ? 'netlify-functions' : 'node-local',
    port: parsePositiveInt(readEnvValue('PORT', mergedEnv, '18888'), 18888),
    host: readEnvValue('HOST', mergedEnv, '127.0.0.1'),
    storageDriver: storageDriver === 'postgres' ? 'postgres' : 'sqlite',
    sqliteDbPath: overrides.dbPath || readEnvValue('SQLITE_DB_PATH', mergedEnv, './data/whispering_waters.sqlite'),
    netlifyDbUrl: readEnvValue('NETLIFY_DB_URL', mergedEnv, ''),
    authSessionSecret: readEnvValue('AUTH_SESSION_SECRET', mergedEnv, 'dev-insecure-session-secret-change-in-prod'),
    authGuestTokenSecret: readEnvValue('AUTH_GUEST_TOKEN_SECRET', mergedEnv, 'dev-insecure-guest-secret-change-in-prod'),
    sessionTtlDays: parsePositiveInt(readEnvValue('SESSION_TTL_DAYS', mergedEnv, '30'), 30),
    oauthGoogleClientId: readEnvValue('OAUTH_GOOGLE_CLIENT_ID', mergedEnv, ''),
    oauthGoogleClientSecret: readEnvValue('OAUTH_GOOGLE_CLIENT_SECRET', mergedEnv, ''),
    oauthGithubClientId: readEnvValue('OAUTH_GITHUB_CLIENT_ID', mergedEnv, ''),
    oauthGithubClientSecret: readEnvValue('OAUTH_GITHUB_CLIENT_SECRET', mergedEnv, ''),
    oauthRedirectBaseUrl: readEnvValue('OAUTH_REDIRECT_BASE_URL', mergedEnv, ''),
    corsAllowedOrigins: String(readEnvValue('CORS_ALLOWED_ORIGINS', mergedEnv, 'http://localhost:18888,http://127.0.0.1:18888'))
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    rateLimitWindowSec: parsePositiveInt(readEnvValue('RATE_LIMIT_WINDOW_SEC', mergedEnv, '60'), 60),
    rateLimitMaxReq: parsePositiveInt(readEnvValue('RATE_LIMIT_MAX_REQ', mergedEnv, '120'), 120),
    worldClockSeed: readEnvValue('WORLD_CLOCK_SEED', mergedEnv, 'wwf-v2-global'),
    offlineAquariumMaxHours: parsePositiveInt(readEnvValue('OFFLINE_AQUARIUM_MAX_HOURS', mergedEnv, '24'), 24),
    features: Object.freeze({
      cloudSync: parseBoolean(readEnvValue('FEATURE_CLOUD_SYNC', mergedEnv, 'false'), false),
      leaderboards: parseBoolean(readEnvValue('FEATURE_LEADERBOARDS', mergedEnv, 'false'), false),
      socialShares: parseBoolean(readEnvValue('FEATURE_SOCIAL_SHARES', mergedEnv, 'false'), false)
    })
  });
}
