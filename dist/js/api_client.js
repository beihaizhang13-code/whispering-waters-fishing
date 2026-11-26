/**
 * ============================================================================
 * 《微风垂钓物语 2.0》前端 API 请求客户端契约桩 (js/api_client.js)
 * ============================================================================
 * 说明：
 * - 非侵入式挂载至 window.WWF.ApiClient，不改动现有单机玩法逻辑；
 * - 统一处理同源 /api/v1/* 请求、超时控制、离线快速失败、游客/会话令牌与标准错误信封解析。
 */
(function () {
    'use strict';

    const WWF = window.WWF = window.WWF || {};

    const CLIENT_VERSION = '2.1.0-foundation';
    const STORAGE_AUTH_KEY = 'wwf_auth_credentials_v1';
    const DEFAULT_TIMEOUT_MS = 8000;

    function loadStoredAuth() {
        try {
            const raw = localStorage.getItem(STORAGE_AUTH_KEY);
            return raw ? JSON.parse(raw) : { mode: 'anonymous', guestToken: null, accessToken: null };
        } catch {
            return { mode: 'anonymous', guestToken: null, accessToken: null };
        }
    }

    function saveStoredAuth(authObj) {
        try {
            localStorage.setItem(STORAGE_AUTH_KEY, JSON.stringify(authObj));
        } catch {
            // 隐私模式下忽略写入失败
        }
    }

    async function request(method, path, options = {}) {
        const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            return {
                ok: false,
                status: 0,
                error: { code: 'OFFLINE', message: '当前处于离线状态，已自动保持本地游玩模式' }
            };
        }

        const auth = loadStoredAuth();
        const headers = {
            Accept: 'application/json',
            'X-Client-Version': CLIENT_VERSION,
            ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
            ...(options.headers || {})
        };

        if (auth.accessToken) {
            headers.Authorization = `Bearer ${auth.accessToken}`;
        } else if (auth.guestToken) {
            headers['X-Guest-Token'] = auth.guestToken;
        }

        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

        try {
            const res = await fetch(path, {
                method,
                headers,
                credentials: 'same-origin',
                ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
                ...(controller ? { signal: controller.signal } : {})
            });

            const text = await res.text();
            let parsed = null;
            try {
                parsed = text ? JSON.parse(text) : null;
            } catch {
                parsed = null;
            }

            if (parsed && typeof parsed.ok === 'boolean') {
                return { status: res.status, ...parsed };
            }

            return {
                ok: res.ok,
                status: res.status,
                data: parsed,
                ...(res.ok ? {} : { error: { code: 'HTTP_ERROR', message: `HTTP ${res.status}` } })
            };
        } catch (err) {
            const isTimeout = err && err.name === 'AbortError';
            return {
                ok: false,
                status: 0,
                error: {
                    code: isTimeout ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
                    message: isTimeout ? '云端服务响应超时，已切换本地模式' : (err?.message || '网络请求失败')
                }
            };
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    WWF.ApiClient = {
        CLIENT_VERSION,
        getAuthState: loadStoredAuth,
        setAuthState: saveStoredAuth,
        clearAuthState() {
            saveStoredAuth({ mode: 'anonymous', guestToken: null, accessToken: null });
        },
        getHealth() {
            return request('GET', '/api/v1/health');
        },
        getWorldState() {
            return request('GET', '/api/v1/world/state');
        },
        // M1-M3 业务契约方法桩
        ensureGuestSession(payload = {}) {
            return request('POST', '/api/v1/auth/guest', { body: payload });
        },
        pullSave() {
            return request('GET', '/api/v1/save');
        },
        pushSave(baseRevision, snapshot) {
            return request('PUT', '/api/v1/save', { body: { baseRevision, snapshot } });
        },
        submitCatch(payload, idempotencyKey) {
            return request('POST', '/api/v1/gameplay/catches', { body: payload, idempotencyKey });
        },
        claimOfflineAquarium(idempotencyKey) {
            return request('POST', '/api/v1/gameplay/aquarium/claim-offline', { body: {}, idempotencyKey });
        },
        getLeaderboard(boardType, scopeKey = 'global') {
            return request('GET', `/api/v1/leaderboards/${encodeURIComponent(boardType)}?scope=${encodeURIComponent(scopeKey)}`);
        }
    };
})();
