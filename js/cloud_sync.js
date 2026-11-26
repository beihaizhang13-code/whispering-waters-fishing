/**
 * ============================================================================
 * 《微风垂钓物语 2.0》前端本地优先云同步管理器契约桩 (js/cloud_sync.js)
 * ============================================================================
 * 设计原则：
 * 1. Local-First (本地优先)：任何时候都先写 localStorage，保障 60fps 手感与断网可玩；
 * 2. 后台增量同步与防冲突：维护 cloudRevision 与 pendingQueue，遇 409 SAVE_CONFLICT 触发合并钩子；
 * 3. 当前处于 M0 工程基座阶段，默认 enabled = false；待 M1 后端启用后开启。
 */
(function () {
    'use strict';

    const WWF = window.WWF = window.WWF || {};
    const SYNC_META_KEY = 'wwf_cloud_sync_meta_v1';
    const MAX_PENDING_QUEUE = 1000;

    const state = {
        enabled: false,
        status: 'disabled', // 'disabled' | 'idle' | 'syncing' | 'offline' | 'conflict' | 'error'
        cloudRevision: 0,
        lastSyncedAt: null,
        pendingActions: [],
        lastError: null
    };

    const listeners = new Set();

    function loadMeta() {
        try {
            const raw = localStorage.getItem(SYNC_META_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (typeof parsed.cloudRevision === 'number') state.cloudRevision = parsed.cloudRevision;
            if (typeof parsed.lastSyncedAt === 'string') state.lastSyncedAt = parsed.lastSyncedAt;
            if (Array.isArray(parsed.pendingActions)) state.pendingActions = parsed.pendingActions;
        } catch {
            // 忽略读取异常
        }
    }

    function persistMeta() {
        try {
            localStorage.setItem(SYNC_META_KEY, JSON.stringify({
                cloudRevision: state.cloudRevision,
                lastSyncedAt: state.lastSyncedAt,
                pendingActions: state.pendingActions
            }));
        } catch {
            // 忽略写入异常
        }
    }

    function notify() {
        const snapshot = { ...state, pendingCount: state.pendingActions.length };
        listeners.forEach(fn => {
            try {
                fn(snapshot);
            } catch {
                // 避免订阅者异常影响主流程
            }
        });
    }

    loadMeta();

    WWF.CloudSync = {
        getStatus() {
            return { ...state, pendingCount: state.pendingActions.length };
        },

        subscribe(listener) {
            if (typeof listener !== 'function') return () => {};
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        configure(options = {}) {
            if (typeof options.enabled === 'boolean') {
                state.enabled = options.enabled;
                state.status = options.enabled ? 'idle' : 'disabled';
                notify();
            }
        },

        /**
         * 探测后端服务是否在线且存储层就绪（供 M1+ 启动时决定启用在线模式或静默降级为单机）。
         */
        async probeBackend() {
            if (!WWF.ApiClient) return { available: false, reason: 'ApiClient_missing' };
            const res = await WWF.ApiClient.getHealth();
            const isStorageReady = Boolean(
                res &&
                res.ok &&
                res.data &&
                res.data.ready !== false &&
                (!res.data.storage || res.data.storage.ok !== false)
            );
            return {
                available: isStorageReady,
                reason: isStorageReady ? 'ready' : (res && res.error && res.error.code) || 'storage_not_ready',
                response: res
            };
        },

        /**
         * 将本地事件（捕鱼结算、商店购买等）入队等待云端核验同步（M1/M2 实现）。
         */
        enqueueEvent(eventType, payload, idempotencyKey) {
            if (!state.enabled) return false;
            if (state.pendingActions.length >= MAX_PENDING_QUEUE) {
                state.status = 'error';
                state.lastError = 'OFFLINE_QUEUE_FULL';
                notify();
                return false;
            }
            state.pendingActions.push({
                idempotencyKey: idempotencyKey || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                eventType,
                payload,
                queuedAt: new Date().toISOString()
            });
            persistMeta();
            notify();
            return true;
        },

        /**
         * 触发全量存档拉取/推送对齐（M1 实现）。
         */
        async syncNow() {
            if (!state.enabled) {
                return { ok: false, skipped: true, reason: 'cloud_sync_disabled_in_m0' };
            }
            return {
                ok: false,
                skipped: true,
                reason: 'not_implemented_until_m1'
            };
        }
    };
})();
