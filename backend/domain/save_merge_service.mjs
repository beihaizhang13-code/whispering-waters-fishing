/**
 * 《微风垂钓物语 2.0》云存档与版本冲突合并服务 (backend/domain/save_merge_service.mjs)
 * ----------------------------------------------------------------------------
 * 合并原则（用于游客升级、跨端登录及 409 冲突恢复）：
 * 1. 图鉴记录 (records)：按 fishId 取并集，count/shinyCount 取较大值，maxKg/maxLen 取最大值；
 * 2. 已解锁船只/帽子/服饰：取集合并集；
 * 3. 钓竿/卷线器/水族箱等级：取两者较高值；
 * 4. 货币与鱼篓/水族箱：防作弊保留权威余额，安全去重并受容量上限保护。
 */
import crypto from 'node:crypto';
import saveSchema from '../../shared/save_schema.js';
import gameCatalog from '../../shared/game_catalog.js';
import { createDomainError, computeSaveChecksum } from '../repositories/sqlite/helpers.mjs';

const DEFAULT_SIGNING_SECRET = 'dev-insecure-session-secret-change-in-prod';

function isUntouchedDefaultSnapshot(snap, cloudRevision) {
  if (cloudRevision !== 1 || !snap) return false;
  return (
    Object.keys(snap.records || {}).length === 0 &&
    Number(snap.coins) === 80 &&
    Number(snap.luckPoints) === 0 &&
    Number(snap.rodLevel) === 1 &&
    Number(snap.reelLevel) === 1 &&
    Number(snap.aquariumLevel) === 1 &&
    (snap.basket || []).length === 0 &&
    (snap.aquarium || []).length === 0
  );
}

function mergeFishCollection(primaryList = [], secondaryList = [], maxCap) {
  const seen = new Set();
  const merged = [];
  for (const list of [primaryList, secondaryList]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const uid = typeof item.uid === 'string' && item.uid ? item.uid : null;
      if (uid && seen.has(uid)) continue;
      if (uid) seen.add(uid);
      merged.push(item);
      if (merged.length >= maxCap) return merged;
    }
  }
  return merged;
}

export function mergeSaveSnapshotsPure(cloudRaw, localRaw, options = {}) {
  const cloudSanitized = saveSchema.sanitizeAndValidateSave(cloudRaw || saveSchema.createDefaultPlayerState(), gameCatalog).sanitized;
  const localCheck = saveSchema.sanitizeAndValidateSave(localRaw, gameCatalog);
  if (!localCheck.valid) {
    throw createDomainError(
      'VALIDATION_ERROR',
      localCheck.errors[0] || '本地存档格式校验失败',
      400,
      { errors: localCheck.errors, warnings: localCheck.warnings }
    );
  }
  const localSanitized = localCheck.sanitized;

  const isFreshCloud = Boolean(options.isFreshCloud);

  // 1. 图鉴记录并集
  const mergedRecords = {};
  const allFishIds = new Set([
    ...Object.keys(cloudSanitized.records || {}),
    ...Object.keys(localSanitized.records || {})
  ]);
  for (const fishId of allFishIds) {
    const c = cloudSanitized.records?.[fishId] || { count: 0, maxKg: 0, maxLen: 0, shinyCount: 0 };
    const l = localSanitized.records?.[fishId] || { count: 0, maxKg: 0, maxLen: 0, shinyCount: 0 };
    mergedRecords[fishId] = {
      count: Math.max(c.count || 0, l.count || 0),
      maxKg: +(Math.max(c.maxKg || 0, l.maxKg || 0)).toFixed(2),
      maxLen: +(Math.max(c.maxLen || 0, l.maxLen || 0)).toFixed(1),
      shinyCount: Math.max(c.shinyCount || 0, l.shinyCount || 0)
    };
  }

  // 2. 解锁集合并集
  const unlockedBoats = Array.from(new Set([
    ...(cloudSanitized.unlockedBoats || ['none']),
    ...(localSanitized.unlockedBoats || ['none'])
  ]));
  const unlockedHats = Array.from(new Set([
    ...(cloudSanitized.unlockedHats || ['straw']),
    ...(localSanitized.unlockedHats || ['straw'])
  ]));
  const unlockedOutfits = Array.from(new Set([
    ...(cloudSanitized.unlockedOutfits || ['casual']),
    ...(localSanitized.unlockedOutfits || ['casual'])
  ]));

  // 3. 装备与水族箱等级取最大值
  const rodLevel = Math.max(cloudSanitized.rodLevel || 1, localSanitized.rodLevel || 1);
  const reelLevel = Math.max(cloudSanitized.reelLevel || 1, localSanitized.reelLevel || 1);
  const aquariumLevel = Math.max(cloudSanitized.aquariumLevel || 1, localSanitized.aquariumLevel || 1);

  // 4. 货币、鱼饵与进度：若云端为初始空白存档则接纳本地进度，否则以云端权威防作弊余额为准
  const coins = isFreshCloud
    ? Math.max(cloudSanitized.coins || 0, localSanitized.coins || 0)
    : (cloudSanitized.coins ?? 0);
  const luckPoints = isFreshCloud
    ? Math.max(cloudSanitized.luckPoints || 0, localSanitized.luckPoints || 0)
    : (cloudSanitized.luckPoints ?? 0);
  const aquariumUnclaimedCoins = isFreshCloud
    ? Math.max(cloudSanitized.aquariumUnclaimedCoins || 0, localSanitized.aquariumUnclaimedCoins || 0)
    : (cloudSanitized.aquariumUnclaimedCoins ?? 0);
  const baits = isFreshCloud
    ? {
        worm: Math.max(cloudSanitized.baits?.worm || 0, localSanitized.baits?.worm || 0),
        gold: Math.max(cloudSanitized.baits?.gold || 0, localSanitized.baits?.gold || 0),
        star: Math.max(cloudSanitized.baits?.star || 0, localSanitized.baits?.star || 0)
      }
    : { ...(cloudSanitized.baits || { worm: 5, gold: 1, star: 0 }) };

  // 5. 鱼篓与水族箱安全合并（去重且不超容量）
  const maxBasket = gameCatalog.ECONOMY_CONSTANTS?.MAX_BASKET_SIZE || 200;
  const aqCapacity = gameCatalog.getAquariumLevelInfo(aquariumLevel).capacity;
  const basket = mergeFishCollection(cloudSanitized.basket, localSanitized.basket, maxBasket);
  const aquarium = mergeFishCollection(cloudSanitized.aquarium, localSanitized.aquarium, aqCapacity);

  const equippedBoat = unlockedBoats.includes(localSanitized.equippedBoat)
    ? localSanitized.equippedBoat
    : cloudSanitized.equippedBoat;
  const equippedHat = unlockedHats.includes(localSanitized.equippedHat)
    ? localSanitized.equippedHat
    : cloudSanitized.equippedHat;
  const equippedOutfit = unlockedOutfits.includes(localSanitized.equippedOutfit)
    ? localSanitized.equippedOutfit
    : cloudSanitized.equippedOutfit;

  const candidate = {
    schemaVersion: saveSchema.CURRENT_SAVE_SCHEMA_VERSION,
    coins,
    luckPoints,
    pityCounter: Math.max(cloudSanitized.pityCounter || 0, localSanitized.pityCounter || 0),
    rodLevel,
    reelLevel,
    selectedBait: localSanitized.selectedBait || cloudSanitized.selectedBait || 'dough',
    baits,
    records: mergedRecords,
    themeIndex: localSanitized.themeIndex ?? cloudSanitized.themeIndex ?? 0,
    weatherId: localSanitized.weatherId || cloudSanitized.weatherId || 'sunny',
    muted: localSanitized.muted ?? cloudSanitized.muted ?? false,
    worldX: localSanitized.worldX ?? cloudSanitized.worldX ?? 760,
    inBoat: Boolean(localSanitized.inBoat || cloudSanitized.inBoat),
    unlockedBoats,
    equippedBoat,
    unlockedHats,
    equippedHat,
    unlockedOutfits,
    equippedOutfit,
    basket,
    aquarium,
    aquariumLevel,
    aquariumUnclaimedCoins,
    bountyOrders: (localSanitized.bountyOrders && localSanitized.bountyOrders.length > 0)
      ? localSanitized.bountyOrders
      : (cloudSanitized.bountyOrders || []),
    completedOrdersCount: Math.max(cloudSanitized.completedOrdersCount || 0, localSanitized.completedOrdersCount || 0)
  };

  const finalCheck = saveSchema.sanitizeAndValidateSave(candidate, gameCatalog);
  return {
    mergedSnapshot: finalCheck.sanitized,
    warnings: [...(localCheck.warnings || []), ...(finalCheck.warnings || [])]
  };
}

export function createSaveMergeService({ config, repositories, logger } = {}) {
  const signingSecret = config?.authSessionSecret
    || process.env.AUTH_SESSION_SECRET
    || DEFAULT_SIGNING_SECRET;
  const offlineMaxHours = config?.offlineAquariumMaxHours
    || gameCatalog.ECONOMY_CONSTANTS.OFFLINE_AQUARIUM_MAX_HOURS
    || 24;

  function computeAquariumOfflinePreview(saveRow, nowMs = Date.now()) {
    const nowIso = new Date(nowMs).toISOString();
    const aquariumList = Array.isArray(saveRow?.snapshot?.aquarium) ? saveRow.snapshot.aquarium : [];
    const shinyMult = gameCatalog.ECONOMY_CONSTANTS.AQUARIUM_SHINY_INCOME_MULT || 1.5;

    let baseRatePerMin = 0;
    for (const fish of aquariumList) {
      const rarityDef = gameCatalog.RARITIES[fish?.rarity] || gameCatalog.RARITIES.common;
      const baseIncome = Number(rarityDef.aquariumIncome) || 6;
      baseRatePerMin += baseIncome * (fish?.isShiny ? shinyMult : 1.0);
    }

    const levelInfo = gameCatalog.getAquariumLevelInfo(saveRow?.aquariumLevel || saveRow?.snapshot?.aquariumLevel || 1);
    const perMinuteIncome = baseRatePerMin * (levelInfo.incomeMult || 1.0);

    const lastSettledMs = Date.parse(saveRow?.aquariumLastSettledAt || saveRow?.updatedAt || nowIso);
    const maxSec = offlineMaxHours * 3600;
    const elapsedSeconds = Number.isFinite(lastSettledMs)
      ? Math.max(0, Math.min(maxSec, (nowMs - lastSettledMs) / 1000))
      : 0;

    const estimatedCoins = Math.floor((perMinuteIncome / 60) * elapsedSeconds);
    return {
      estimatedCoins,
      perMinuteIncome: +perMinuteIncome.toFixed(2),
      elapsedSeconds: Math.floor(elapsedSeconds),
      cappedHours: offlineMaxHours,
      lastSettledAt: saveRow?.aquariumLastSettledAt || nowIso,
      calculatedAt: nowIso
    };
  }

  function signBundlePayload(canonicalPayload, exportedAt, schemaVersion) {
    return crypto
      .createHmac('sha256', signingSecret)
      .update(`${schemaVersion}:${exportedAt}:${canonicalPayload}`)
      .digest('hex');
  }

  function verifySignatureHex(expectedHex, actualHex) {
    if (typeof expectedHex !== 'string' || typeof actualHex !== 'string') return false;
    if (expectedHex.length !== actualHex.length || expectedHex.length === 0) return false;
    try {
      const a = Buffer.from(expectedHex, 'hex');
      const b = Buffer.from(actualHex, 'hex');
      return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  return {
    /** 使用共享契约对任意前端上传存档做字段清洗与上下界检查 */
    validateClientSnapshot(rawPayload) {
      return saveSchema.sanitizeAndValidateSave(rawPayload, gameCatalog);
    },

    computeAquariumOfflinePreview,

    mergeTwoSnapshots(cloudSnapshot, localSnapshot, options = {}) {
      return mergeSaveSnapshotsPure(cloudSnapshot, localSnapshot, options);
    },

    async getCloudSave({ userId }) {
      const save = await repositories.saves.getSaveByUserId(userId);
      if (!save) {
        throw createDomainError('NOT_FOUND', '未找到玩家云存档', 404);
      }
      return {
        ...save,
        aquariumOfflinePreview: computeAquariumOfflinePreview(save)
      };
    },

    /** 带 baseRevision 乐观锁校验的云存档保存 */
    async putCloudSave({ userId, baseRevision, snapshot }) {
      if (!Number.isInteger(baseRevision) || baseRevision < 1) {
        throw createDomainError('VALIDATION_ERROR', 'baseRevision 必须为正整数', 400);
      }

      const validation = saveSchema.sanitizeAndValidateSave(snapshot, gameCatalog);
      if (!validation.valid) {
        throw createDomainError(
          'VALIDATION_ERROR',
          validation.errors[0] || '存档格式校验失败',
          400,
          { errors: validation.errors, warnings: validation.warnings }
        );
      }

      const nowIso = new Date().toISOString();
      const result = await repositories.saves.putSaveOptimistic({
        userId,
        baseRevision,
        snapshot: validation.sanitized,
        nowIso
      });

      if (result.conflict) {
        if (!result.current) {
          throw createDomainError('NOT_FOUND', '未找到玩家云存档', 404);
        }
        throw createDomainError(
          'SAVE_CONFLICT',
          '云端存档版本已更新，请先拉取合并后再覆盖',
          409,
          {
            serverRevision: result.current.revision,
            serverSnapshot: result.current.snapshot
          }
        );
      }

      return {
        ...result.save,
        warnings: validation.warnings
      };
    },

    /** 本地存档与云端存档冲突合并 */
    async mergeSnapshots({ userId, localSnapshot, strategy = 'safe_union' }) {
      if (strategy !== 'safe_union') {
        throw createDomainError('VALIDATION_ERROR', `不支持的合并策略: ${String(strategy)}`, 400);
      }

      const cloudSave = await repositories.saves.getSaveByUserId(userId);
      if (!cloudSave) {
        throw createDomainError('NOT_FOUND', '未找到玩家云存档', 404);
      }

      const isFreshCloud = isUntouchedDefaultSnapshot(cloudSave.snapshot, cloudSave.revision);
      const { mergedSnapshot, warnings } = mergeSaveSnapshotsPure(
        cloudSave.snapshot,
        localSnapshot,
        { isFreshCloud }
      );

      const nowIso = new Date().toISOString();
      const result = await repositories.saves.mergeSaveAtomic({
        userId,
        baseRevision: cloudSave.revision,
        mergedSnapshot,
        nowIso
      });

      if (result.conflict) {
        const latest = result.current || await repositories.saves.getSaveByUserId(userId);
        if (!latest) {
          throw createDomainError('NOT_FOUND', '未找到玩家云存档', 404);
        }
        const retry = mergeSaveSnapshotsPure(
          latest.snapshot,
          localSnapshot,
          { isFreshCloud: isUntouchedDefaultSnapshot(latest.snapshot, latest.revision) }
        );
        const retryResult = await repositories.saves.mergeSaveAtomic({
          userId,
          mergedSnapshot: retry.mergedSnapshot,
          nowIso: new Date().toISOString()
        });
        return {
          ...retryResult.save,
          strategy,
          warnings: retry.warnings
        };
      }

      logger?.info?.('save_merged', { userId, strategy, revision: result.save.revision });
      return {
        ...result.save,
        strategy,
        warnings
      };
    },

    /** 导出符合隐私合规的 JSON 存档包 */
    async exportSaveBundle({ userId }) {
      const save = await repositories.saves.getSaveByUserId(userId);
      if (!save) {
        throw createDomainError('NOT_FOUND', '未找到玩家云存档', 404);
      }

      const clean = saveSchema.sanitizeAndValidateSave(save.snapshot, gameCatalog).sanitized;
      const exportedAt = new Date().toISOString();
      const canonicalPayload = JSON.stringify(clean);
      const payloadChecksum = computeSaveChecksum(canonicalPayload);
      const signature = signBundlePayload(canonicalPayload, exportedAt, save.schemaVersion);

      return {
        bundleVersion: 1,
        game: 'whispering-waters-fishing',
        schemaVersion: save.schemaVersion,
        exportedAt,
        payloadChecksum,
        signatureAlgorithm: 'HMAC-SHA256',
        signature,
        snapshot: clean
      };
    },

    /** 校验并导入历史导出的存档包 */
    async importSaveBundle({ userId, bundle }) {
      if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
        throw createDomainError('VALIDATION_ERROR', '存档导出包格式无效', 400);
      }
      if (!bundle.snapshot || typeof bundle.snapshot !== 'object' || Array.isArray(bundle.snapshot)) {
        throw createDomainError('VALIDATION_ERROR', '存档导出包缺少 snapshot 字段', 400);
      }
      if (typeof bundle.signature !== 'string' || !bundle.signature.trim() || typeof bundle.exportedAt !== 'string') {
        throw createDomainError('VALIDATION_ERROR', '存档导出包缺少签名或导出时间戳', 400);
      }

      const schemaVersion = Number(bundle.schemaVersion || saveSchema.CURRENT_SAVE_SCHEMA_VERSION);
      const validation = saveSchema.sanitizeAndValidateSave(bundle.snapshot, gameCatalog);
      if (!validation.valid) {
        throw createDomainError(
          'VALIDATION_ERROR',
          validation.errors[0] || '导入存档包内容校验失败',
          400,
          { errors: validation.errors }
        );
      }

      const canonicalSanitized = JSON.stringify(validation.sanitized);
      const canonicalRaw = JSON.stringify(bundle.snapshot);

      const sigSanitized = signBundlePayload(canonicalSanitized, bundle.exportedAt, schemaVersion);
      const sigRaw = signBundlePayload(canonicalRaw, bundle.exportedAt, schemaVersion);
      const sigOk = verifySignatureHex(sigSanitized, bundle.signature) || verifySignatureHex(sigRaw, bundle.signature);
      if (!sigOk) {
        throw createDomainError('VALIDATION_ERROR', '存档导出包签名验签失败，文件可能已被篡改', 400);
      }

      if (bundle.payloadChecksum) {
        const chkSanitized = computeSaveChecksum(canonicalSanitized);
        const chkRaw = computeSaveChecksum(canonicalRaw);
        if (bundle.payloadChecksum !== chkSanitized && bundle.payloadChecksum !== chkRaw) {
          throw createDomainError('VALIDATION_ERROR', '存档导出包校验和不匹配', 400);
        }
      }

      const merged = await this.mergeSnapshots({
        userId,
        localSnapshot: validation.sanitized,
        strategy: 'safe_union'
      });

      return {
        imported: true,
        ...merged
      };
    }
  };
}
