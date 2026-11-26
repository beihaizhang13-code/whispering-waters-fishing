/**
 * 《微风垂钓物语 2.0》前后端单一事实源：存档结构与校验契约 (shared/save_schema.js)
 * ----------------------------------------------------------------------------
 * 负责定义玩家持久化存档的 Schema v2、默认值工厂，以及前后端通用的清洗与上下界校验。
 */
(function (root, factory) {
  let catalog = null;
  if (typeof module === 'object' && module.exports) {
    catalog = require('./game_catalog.js');
  } else if (root && root.WWF_SHARED && root.WWF_SHARED.GameCatalog) {
    catalog = root.WWF_SHARED.GameCatalog;
  }
  const exported = factory(catalog);
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  }
  const target = root || (typeof globalThis !== 'undefined' ? globalThis : {});
  target.WWF_SHARED = target.WWF_SHARED || {};
  target.WWF_SHARED.SaveSchema = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (defaultCatalog) {
  'use strict';

  const CURRENT_SAVE_SCHEMA_VERSION = 2;

  function createDefaultPlayerState() {
    return {
      schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
      coins: 80,
      luckPoints: 0,
      pityCounter: 0,
      rodLevel: 1,
      reelLevel: 1,
      selectedBait: 'dough',
      baits: {
        worm: 5,
        gold: 1,
        star: 0
      },
      records: {},
      themeIndex: 0,
      weatherId: 'sunny',
      muted: false,
      worldX: 760,
      inBoat: false,
      unlockedBoats: ['none'],
      equippedBoat: 'none',
      unlockedHats: ['straw'],
      equippedHat: 'straw',
      unlockedOutfits: ['casual'],
      equippedOutfit: 'casual',
      basket: [],
      aquarium: [],
      aquariumLevel: 1,
      aquariumUnclaimedCoins: 0,
      bountyOrders: [],
      completedOrdersCount: 0
    };
  }

  function isFiniteNonNegativeInt(val, max = 1e9) {
    return typeof val === 'number' && Number.isFinite(val) && val >= 0 && val <= max;
  }

  function sanitizeFishInstance(item, catalog, warnings, label) {
    if (!item || typeof item !== 'object') {
      warnings.push(`${label}: 非法鱼获对象已忽略`);
      return null;
    }
    const fish = catalog.getFishById ? catalog.getFishById(item.fishId) : null;
    if (!fish) {
      warnings.push(`${label}: 未知鱼种 ${String(item.fishId)} 已忽略`);
      return null;
    }
    const rawLen = Number(item.lengthCm);
    const rawKg = Number(item.weightKg);
    const rawVal = Number(item.value);
    const maxAllowedLen = fish.maxLen * 1.5;
    const maxAllowedKg = fish.maxKg * 2.0;
    const maxAllowedVal = fish.baseValue * 20;

    if (!Number.isFinite(rawLen) || rawLen <= 0 || rawLen > maxAllowedLen) {
      warnings.push(`${label}: 体长越界 (${item.lengthCm}) 已修正`);
    }
    if (!Number.isFinite(rawKg) || rawKg <= 0 || rawKg > maxAllowedKg) {
      warnings.push(`${label}: 重量越界 (${item.weightKg}) 已修正`);
    }

    const lengthCm = Number.isFinite(rawLen)
      ? Math.max(fish.minLen * 0.5, Math.min(maxAllowedLen, +rawLen.toFixed(1)))
      : fish.minLen;
    const weightKg = Number.isFinite(rawKg)
      ? Math.max(fish.minKg * 0.5, Math.min(maxAllowedKg, +rawKg.toFixed(2)))
      : fish.minKg;
    const value = Number.isFinite(rawVal) && rawVal >= 1
      ? Math.min(maxAllowedVal, Math.round(rawVal))
      : fish.baseValue;

    const rawSizeFactor = Number(item.sizeFactor);
    const sizeFactor = Number.isFinite(rawSizeFactor)
      ? Math.max(0, Math.min(1, +rawSizeFactor.toFixed(4)))
      : undefined;
    const ruleVersion = typeof item.ruleVersion === 'string' && item.ruleVersion.length > 0
      ? item.ruleVersion.slice(0, 24)
      : undefined;

    return {
      uid: typeof item.uid === 'string' && item.uid.length > 0 ? item.uid.slice(0, 64) : `fish_${fish.id}_migrated`,
      fishId: fish.id,
      name: fish.name,
      rarity: fish.rarity,
      lengthCm,
      weightKg,
      value,
      isShiny: Boolean(item.isShiny),
      ...(sizeFactor !== undefined ? { sizeFactor } : {}),
      ...(ruleVersion !== undefined ? { ruleVersion } : {}),
      caughtAt: isFiniteNonNegativeInt(Number(item.caughtAt), 9e15) ? Number(item.caughtAt) : Date.now()
    };
  }

  /**
   * 清洗并校验玩家存档载荷。
   * 关键不可信数值越界时记入 errors (valid = false)，轻度格式差异记入 warnings 并归一化。
   */
  function sanitizeAndValidateSave(rawPayload, catalogArg) {
    const catalog = catalogArg || defaultCatalog;
    const errors = [];
    const warnings = [];
    const out = createDefaultPlayerState();

    if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
      return {
        valid: false,
        errors: ['存档载荷必须为 JSON 对象'],
        warnings,
        sanitized: out
      };
    }

    // 1. 货币与积分边界校验
    if (rawPayload.coins !== undefined) {
      if (typeof rawPayload.coins !== 'number' || !Number.isFinite(rawPayload.coins) || rawPayload.coins < 0 || rawPayload.coins > 100000000) {
        errors.push('coins 必须为 0 ~ 100,000,000 之间的合法数值');
      } else {
        out.coins = Math.floor(rawPayload.coins);
      }
    }

    if (rawPayload.luckPoints !== undefined) {
      if (typeof rawPayload.luckPoints !== 'number' || !Number.isFinite(rawPayload.luckPoints) || rawPayload.luckPoints < 0 || rawPayload.luckPoints > 1000000) {
        errors.push('luckPoints 必须为 0 ~ 1,000,000 之间的合法数值');
      } else {
        out.luckPoints = Math.floor(rawPayload.luckPoints);
      }
    }

    if (rawPayload.pityCounter !== undefined) {
      const pity = Number(rawPayload.pityCounter);
      if (!Number.isFinite(pity) || pity < 0 || pity > 5000) {
        errors.push('pityCounter 超出合法范围');
      } else {
        out.pityCounter = Math.floor(pity);
      }
    }

    // 2. 装备等级校验 (1..5)
    for (const [key, maxLv] of [['rodLevel', 5], ['reelLevel', 5], ['aquariumLevel', 5]]) {
      if (rawPayload[key] !== undefined) {
        const lv = Number(rawPayload[key]);
        if (!Number.isInteger(lv) || lv < 1 || lv > maxLv) {
          errors.push(`${key} 必须为 1 到 ${maxLv} 的整数`);
        } else {
          out[key] = lv;
        }
      }
    }

    // 3. 鱼饵背包校验
    if (rawPayload.baits !== undefined) {
      if (!rawPayload.baits || typeof rawPayload.baits !== 'object' || Array.isArray(rawPayload.baits)) {
        errors.push('baits 字段格式无效');
      } else {
        for (const baitKey of ['worm', 'gold', 'star']) {
          if (rawPayload.baits[baitKey] !== undefined) {
            const count = Number(rawPayload.baits[baitKey]);
            if (!Number.isFinite(count) || count < 0 || count > 100000) {
              errors.push(`baits.${baitKey} 数量非法`);
            } else {
              out.baits[baitKey] = Math.floor(count);
            }
          }
        }
      }
    }

    if (typeof rawPayload.selectedBait === 'string') {
      if (catalog && catalog.BAIT_BY_ID && catalog.BAIT_BY_ID[rawPayload.selectedBait]) {
        const chosen = rawPayload.selectedBait;
        out.selectedBait = (chosen === 'dough' || (out.baits[chosen] || 0) > 0) ? chosen : 'dough';
        if (out.selectedBait !== chosen) {
          warnings.push(`所选鱼饵 ${chosen} 余量为 0，已回退为 dough`);
        }
      } else {
        errors.push(`未知鱼饵 ID: ${rawPayload.selectedBait}`);
      }
    }

    // 4. 环境与坐标状态
    if (rawPayload.themeIndex !== undefined) {
      const t = Number(rawPayload.themeIndex);
      out.themeIndex = Number.isInteger(t) ? Math.max(0, Math.min(2, t)) : 0;
    }

    if (typeof rawPayload.weatherId === 'string') {
      if (catalog && catalog.WEATHERS && catalog.WEATHERS[rawPayload.weatherId]) {
        out.weatherId = rawPayload.weatherId;
      } else {
        warnings.push(`未知天气 ${rawPayload.weatherId}，已回退为 sunny`);
      }
    }

    out.muted = Boolean(rawPayload.muted);

    if (rawPayload.worldX !== undefined) {
      const wx = Number(rawPayload.worldX);
      const maxW = (catalog && catalog.WORLD_WIDTH) || 2400;
      if (!Number.isFinite(wx) || wx < 0 || wx > maxW) {
        errors.push('worldX 超出世界边界');
      } else {
        out.worldX = Math.max(48, Math.min(maxW - 55, wx));
      }
    }

    // 5. 船只、帽子、服饰解锁集合与装备合法性
    function validateUnlockAndEquip(unlockField, equipField, dict, baseDefault) {
      const rawUnlocked = rawPayload[unlockField];
      const set = new Set([baseDefault]);
      if (Array.isArray(rawUnlocked)) {
        for (const id of rawUnlocked) {
          if (typeof id !== 'string' || (dict && !dict[id])) {
            errors.push(`${unlockField} 包含未定义道具 ID: ${String(id)}`);
          } else {
            set.add(id);
          }
        }
      }
      out[unlockField] = Array.from(set);

      if (typeof rawPayload[equipField] === 'string') {
        if (!set.has(rawPayload[equipField])) {
          errors.push(`${equipField} (${rawPayload[equipField]}) 尚未解锁或不存在`);
        } else {
          out[equipField] = rawPayload[equipField];
        }
      }
    }

    validateUnlockAndEquip('unlockedBoats', 'equippedBoat', catalog && catalog.BOAT_BY_ID, 'none');
    validateUnlockAndEquip('unlockedHats', 'equippedHat', catalog && catalog.HAT_BY_ID, 'straw');
    validateUnlockAndEquip('unlockedOutfits', 'equippedOutfit', catalog && catalog.OUTFIT_BY_ID, 'casual');

    const hasRealBoat = out.unlockedBoats.some(id => id !== 'none');
    out.inBoat = Boolean(rawPayload.inBoat) && hasRealBoat;
    if (out.worldX > 1160 && !hasRealBoat) {
      warnings.push('未解锁船只却位于深水海域，坐标已重置到微风木栈桥');
      out.worldX = 760;
      out.inBoat = false;
    }

    // 6. 图鉴记录校验
    if (rawPayload.records && typeof rawPayload.records === 'object' && !Array.isArray(rawPayload.records)) {
      const cleanRecords = {};
      for (const [fishId, rec] of Object.entries(rawPayload.records)) {
        if (catalog && catalog.FISH_BY_ID && !catalog.FISH_BY_ID[fishId]) {
          warnings.push(`records 中包含未知鱼种 ${fishId}，已忽略`);
          continue;
        }
        if (!rec || typeof rec !== 'object') continue;
        cleanRecords[fishId] = {
          count: Math.max(0, Math.floor(Number(rec.count) || 0)),
          maxKg: Math.max(0, +(Number(rec.maxKg) || 0).toFixed(2)),
          maxLen: Math.max(0, +(Number(rec.maxLen) || 0).toFixed(1)),
          shinyCount: Math.max(0, Math.floor(Number(rec.shinyCount) || 0))
        };
      }
      out.records = cleanRecords;
    }

    // 7. 鱼篓与水族箱校验
    const maxBasket = (catalog && catalog.ECONOMY_CONSTANTS && catalog.ECONOMY_CONSTANTS.MAX_BASKET_SIZE) || 200;
    if (Array.isArray(rawPayload.basket)) {
      if (rawPayload.basket.length > maxBasket) {
        errors.push(`basket 数量超出上限 (${maxBasket})`);
      } else {
        out.basket = rawPayload.basket
          .map((item, idx) => sanitizeFishInstance(item, catalog, warnings, `basket[${idx}]`))
          .filter(Boolean);
      }
    }

    const aqCap = catalog && catalog.getAquariumLevelInfo
      ? catalog.getAquariumLevelInfo(out.aquariumLevel).capacity
      : 16;
    if (Array.isArray(rawPayload.aquarium)) {
      if (rawPayload.aquarium.length > aqCap) {
        errors.push(`aquarium 鱼数量 (${rawPayload.aquarium.length}) 超出当前等级容量 (${aqCap})`);
      } else {
        out.aquarium = rawPayload.aquarium
          .map((item, idx) => sanitizeFishInstance(item, catalog, warnings, `aquarium[${idx}]`))
          .filter(Boolean);
      }
    }

    if (rawPayload.aquariumUnclaimedCoins !== undefined) {
      const unclaimed = Number(rawPayload.aquariumUnclaimedCoins);
      if (!Number.isFinite(unclaimed) || unclaimed < 0 || unclaimed > 5000000) {
        errors.push('aquariumUnclaimedCoins 数值非法');
      } else {
        out.aquariumUnclaimedCoins = +unclaimed.toFixed(2);
      }
    }

    if (Array.isArray(rawPayload.bountyOrders)) {
      out.bountyOrders = rawPayload.bountyOrders.slice(0, 6);
    }

    if (rawPayload.completedOrdersCount !== undefined) {
      const completed = Number(rawPayload.completedOrdersCount);
      if (!Number.isFinite(completed) || completed < 0 || completed > 1000000) {
        errors.push('completedOrdersCount 数值非法');
      } else {
        out.completedOrdersCount = Math.floor(completed);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      sanitized: out
    };
  }

  return {
    CURRENT_SAVE_SCHEMA_VERSION,
    createDefaultPlayerState,
    sanitizeAndValidateSave
  };
});
