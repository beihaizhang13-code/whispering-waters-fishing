/**
 * 《微风垂钓物语 2.0》结构化 JSON 日志器 (backend/observability/logger.mjs)
 * ----------------------------------------------------------------------------
 * 输出单行结构化 JSON，自动递归脱敏敏感键（password, token, secret, cookie 等）。
 */

const SENSITIVE_KEY_PATTERN = /(password|secret|token|authorization|cookie|session|credential|apiKey)/i;

export function redactSensitive(value, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map(item => redactSensitive(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactSensitive(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export function createLogger(baseContext = {}, sink = console) {
  function emit(level, message, meta = {}) {
    const record = {
      ts: new Date().toISOString(),
      level,
      message,
      ...redactSensitive(baseContext),
      ...redactSensitive(meta)
    };
    const serialized = JSON.stringify(record);
    if (level === 'error') {
      sink.error(serialized);
    } else if (level === 'warn') {
      sink.warn(serialized);
    } else {
      sink.log(serialized);
    }
  }

  return {
    info: (message, meta) => emit('info', message, meta),
    warn: (message, meta) => emit('warn', message, meta),
    error: (message, meta) => emit('error', message, meta)
  };
}
