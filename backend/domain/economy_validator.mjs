/**
 * 《微风垂钓物语 2.0》混合权威捕鱼校验与经济账本服务 (backend/domain/economy_validator.mjs)
 * ----------------------------------------------------------------------------
 * 核心风控规则：
 * 1. 钓鱼物理与 60fps 遛鱼博弈在前端完成，上报时必须携带 clientCatchUid 与上下文快照；
 * 2. 服务端校验鱼种/海域可达性（无船禁止报告湖心岛/沉船湾渔获）、体长重量合法范围、
 *    价值重算（防止前端篡改 baseValue 或超高倍率）、单账号频次与消耗鱼饵库存；
 * 3. 商店购买、悬赏交付、鱼饵扣减全部重算价格并写入 economy_ledger，严禁直接信任前端余额。
 */
import crypto from 'node:crypto';
import gameCatalog from '../../shared/game_catalog.js';
import worldClock from '../../shared/world_clock.js';
import { createDomainError } from '../repositories/sqlite/helpers.mjs';

const VALID_DISPOSITIONS = new Set(['sold', 'aquarium', 'basket', 'released']);
const VALID_SHOP_TYPES = new Set(['bait', 'rod', 'reel', 'boat', 'hat', 'outfit']);
const VALID_BOUNTY_SOURCES = new Set(['basket', 'aquarium']);
const BIOME_BY_ID = new Map((gameCatalog.BIOMES || []).map(b => [b.id, b]));
const RARITY_BOUNTY_LUCK = Object.freeze({
  common: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
  mythic: 5
});

function computePayloadDigest(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function createEconomyValidator({ config, repositories, logger }) {
  function requireEconomyRepo() {
    if (!repositories || !repositories.economy) {
      throw createDomainError('SERVICE_UNAVAILABLE', '经济仓储服务暂未就绪', 503);
    }
    return repositories.economy;
  }

  async function readSaveContext(userId) {
    const economyRepo = requireEconomyRepo();
    if (typeof economyRepo.getPlayerSaveAndUser === 'function') {
      return economyRepo.getPlayerSaveAndUser(userId);
    }
    if (repositories.saves && typeof repositories.saves.getByUserId === 'function') {
      const saveRow = await repositories.saves.getByUserId(userId);
      return { saveRow, userRow: null };
    }
    throw createDomainError('SERVICE_UNAVAILABLE', '存档读取接口不可用', 503);
  }

  async function safeRecordAudit(event) {
    const economyRepo = requireEconomyRepo();
    if (typeof economyRepo.recordAuditEvent === 'function') {
      try {
        await economyRepo.recordAuditEvent(event);
      } catch (err) {
        logger?.warn?.('audit_event_write_failed', { error: err?.message, category: event?.eventCategory });
      }
    }
  }

  async function resolveWorldState(nowMs) {
    const nowIso = new Date(nowMs).toISOString();
    let activeSummonedTide = null;
    if (repositories?.worldEvents && typeof repositories.worldEvents.findActiveGoldenTide === 'function') {
      try {
        activeSummonedTide = await repositories.worldEvents.findActiveGoldenTide(nowIso);
      } catch {
        activeSummonedTide = null;
      }
    }
    return worldClock.computeWorldStateAt(nowMs, activeSummonedTide, config?.worldClockSeed || 'wwf-v2-global');
  }

  return {
    async submitCatchAndDisposition({
      userId,
      catchPayload,
      disposition,
      idempotencyKey = null,
      clientIpHash = null,
      requestId = null
    }) {
      if (!userId) {
        throw createDomainError('UNAUTHORIZED', '未登录或会话凭证已失效', 401);
      }
      if (!catchPayload || typeof catchPayload !== 'object' || Array.isArray(catchPayload)) {
        throw createDomainError('VALIDATION_ERROR', '渔获上报载荷格式无效', 400);
      }

      const rawUid = catchPayload.clientCatchUid;
      if (typeof rawUid !== 'string' || !rawUid.trim()) {
        throw createDomainError('VALIDATION_ERROR', 'clientCatchUid 不能为空', 400);
      }
      const clientCatchUid = rawUid.trim().slice(0, 64);

      const fishId = catchPayload.fishId;
      const fish = typeof fishId === 'string' ? gameCatalog.FISH_BY_ID[fishId] : null;
      if (!fish) {
        throw createDomainError('VALIDATION_ERROR', `未知鱼种 ID: ${String(fishId)}`, 400);
      }

      const effectiveDisposition = disposition ?? catchPayload.disposition;
      if (typeof effectiveDisposition !== 'string' || !VALID_DISPOSITIONS.has(effectiveDisposition)) {
        throw createDomainError('VALIDATION_ERROR', `无效的渔获处置方式: ${String(effectiveDisposition)}`, 400);
      }

      const economyRepo = requireEconomyRepo();
      const cleanIdempotencyKey = typeof idempotencyKey === 'string' && idempotencyKey.trim()
        ? idempotencyKey.trim()
        : null;

      // 严格幂等：若该 clientCatchUid 已持久化，直接返回已有记录与存档
      const existingCatch = await economyRepo.findCatchByClientUid(userId, clientCatchUid);
      if (existingCatch) {
        const { saveRow } = await readSaveContext(userId);
        const existingLedger = cleanIdempotencyKey
          ? await economyRepo.findLedgerByIdempotencyKey(userId, cleanIdempotencyKey)
          : null;
        return {
          duplicate: true,
          catchLog: existingCatch,
          computedValue: existingCatch.computedValue,
          disposition: existingCatch.disposition,
          validationStatus: existingCatch.validationStatus,
          save: saveRow,
          ledger: existingLedger
        };
      }

      // 若同一 Idempotency-Key 已被其他渔获或经济事件占用，拦截冲突
      if (cleanIdempotencyKey) {
        const existingLedger = await economyRepo.findLedgerByIdempotencyKey(userId, cleanIdempotencyKey);
        if (existingLedger && existingLedger.referenceId !== clientCatchUid) {
          throw createDomainError('IDEMPOTENCY_CONFLICT', '重复的幂等操作键或参数不一致', 409);
        }
      }

      const biomeId = catchPayload.biomeId;
      const biome = typeof biomeId === 'string' ? BIOME_BY_ID.get(biomeId) : null;
      if (!biome) {
        throw createDomainError('VALIDATION_ERROR', `无效的海域 ID: ${String(biomeId)}`, 400);
      }

      const depthZone = catchPayload.depthZone === undefined || catchPayload.depthZone === null
        ? (fish.prefDepth ?? 0)
        : Number(catchPayload.depthZone);
      if (!Number.isInteger(depthZone) || depthZone < 0 || depthZone > 2) {
        throw createDomainError('VALIDATION_ERROR', 'depthZone 必须为 0 ~ 2 的整数', 400);
      }

      const { saveRow } = await readSaveContext(userId);
      if (!saveRow) {
        throw createDomainError('NOT_FOUND', '玩家云存档不存在', 404);
      }
      const snapshot = structuredClone(saveRow.snapshot);

      // 1. 水域可达性核验（无船禁止报告需船海域渔获）
      const unlockedBoats = Array.isArray(snapshot.unlockedBoats) ? snapshot.unlockedBoats : ['none'];
      const hasRealBoat = unlockedBoats.some(id => id !== 'none');
      if (biome.requiresBoat && !hasRealBoat) {
        await safeRecordAudit({
          userId,
          eventCategory: 'invalid_biome_access',
          severity: 'high',
          ipHash: clientIpHash,
          requestId,
          details: { clientCatchUid, fishId, biomeId, unlockedBoats }
        });
        throw createDomainError('ANTICHEAT_REJECTED', `未解锁船只，无法在【${biome.name}】上报渔获`, 422);
      }

      // 2. 体长与重量物理范围核验
      const rawLength = Number(catchPayload.lengthCm);
      const rawWeight = Number(catchPayload.weightKg);
      const minLenBound = fish.minLen * 0.5;
      const maxLenBound = fish.maxLen * 1.25;
      const minKgBound = fish.minKg * 0.5;
      const maxKgBound = fish.maxKg * 1.25;

      if (
        !Number.isFinite(rawLength) || rawLength < minLenBound || rawLength > maxLenBound ||
        !Number.isFinite(rawWeight) || rawWeight < minKgBound || rawWeight > maxKgBound
      ) {
        await safeRecordAudit({
          userId,
          eventCategory: 'catch_metrics_out_of_bounds',
          severity: 'high',
          ipHash: clientIpHash,
          requestId,
          details: {
            clientCatchUid,
            fishId,
            lengthCm: catchPayload.lengthCm,
            weightKg: catchPayload.weightKg,
            expectedLen: [minLenBound, maxLenBound],
            expectedKg: [minKgBound, maxKgBound]
          }
        });
        throw createDomainError('ANTICHEAT_REJECTED', '渔获体长或重量超出物种合法物理范围', 422);
      }

      const lengthCm = +rawLength.toFixed(1);
      const weightKg = +rawWeight.toFixed(2);

      // 3. 频次风控（最近 60 秒超过 25 条降级为 flagged 并记录告警）
      const nowMs = Date.now();
      const sinceIso = new Date(nowMs - 60 * 1000).toISOString();
      const recentCount = await economyRepo.countRecentCatches(userId, sinceIso);
      const isFlagged = recentCount > 25;
      const validationStatus = isFlagged ? 'flagged' : 'verified';
      const validationReason = isFlagged ? `catch_rate_high:${recentCount}` : null;
      const auditEvent = isFlagged
        ? {
            eventCategory: 'catch_rate_high',
            severity: 'warn',
            ipHash: clientIpHash,
            requestId,
            details: { recentCount, windowSec: 60, clientCatchUid, fishId }
          }
        : null;

      // 4. 鱼饵核验与原子扣减（不足则降级为 dough）
      const requestedBaitId = typeof catchPayload.baitId === 'string' ? catchPayload.baitId : 'dough';
      snapshot.baits = snapshot.baits && typeof snapshot.baits === 'object'
        ? { worm: 0, gold: 0, star: 0, ...snapshot.baits }
        : { worm: 0, gold: 0, star: 0 };

      let effectiveBaitId = 'dough';
      if (requestedBaitId !== 'dough' && gameCatalog.BAIT_BY_ID[requestedBaitId]) {
        const ownedBait = Math.floor(Number(snapshot.baits[requestedBaitId]) || 0);
        if (ownedBait > 0) {
          snapshot.baits[requestedBaitId] = ownedBait - 1;
          effectiveBaitId = requestedBaitId;
        } else {
          effectiveBaitId = 'dough';
        }
      }
      if (snapshot.selectedBait && snapshot.selectedBait !== 'dough' && (Number(snapshot.baits[snapshot.selectedBait]) || 0) <= 0) {
        snapshot.selectedBait = 'dough';
      }

      // 5. 全服世界时钟与黄金鱼潮校验 + 服务端价值重算
      const worldState = await resolveWorldState(nowMs);
      const activeGoldenTide = Boolean(worldState?.goldenTide?.active);
      const weatherId = worldState?.weather?.weatherId || 'sunny';

      let sizeFactor;
      if (catchPayload.sizeFactor !== undefined && catchPayload.sizeFactor !== null && Number.isFinite(Number(catchPayload.sizeFactor))) {
        sizeFactor = Math.max(0, Math.min(1, Number(catchPayload.sizeFactor)));
      } else {
        const span = fish.maxLen - fish.minLen;
        const inferred = span > 0 ? (lengthCm - fish.minLen) / span : 0.5;
        sizeFactor = Math.max(0, Math.min(1, inferred));
      }

      const isShiny = Boolean(catchPayload.isShiny);
      const computedValue = Math.max(
        1,
        Math.round(
          fish.baseValue *
          (0.85 + sizeFactor * 0.65) *
          (isShiny ? 2.2 : 1) *
          (activeGoldenTide ? 1.5 : 1)
        )
      );

      // 6. 更新图鉴、保底计数与按处置方式修改快照
      snapshot.records = snapshot.records && typeof snapshot.records === 'object' ? snapshot.records : {};
      const prevRec = snapshot.records[fishId] || { count: 0, maxKg: 0, maxLen: 0, shinyCount: 0 };
      snapshot.records[fishId] = {
        count: Math.floor(Number(prevRec.count) || 0) + 1,
        maxKg: +Math.max(Number(prevRec.maxKg) || 0, weightKg).toFixed(2),
        maxLen: +Math.max(Number(prevRec.maxLen) || 0, lengthCm).toFixed(1),
        shinyCount: Math.floor(Number(prevRec.shinyCount) || 0) + (isShiny ? 1 : 0)
      };

      if (fish.rarity === 'epic' || fish.rarity === 'legendary' || fish.rarity === 'mythic') {
        snapshot.pityCounter = 0;
      } else {
        snapshot.pityCounter = Math.min(5000, Math.floor(Number(snapshot.pityCounter) || 0) + 1);
      }

      const caughtAtMs = Number.isFinite(Number(catchPayload.caughtAt)) && Number(catchPayload.caughtAt) > 0
        ? Math.floor(Number(catchPayload.caughtAt))
        : nowMs;

      const storedFishObj = {
        uid: clientCatchUid,
        fishId: fish.id,
        name: fish.name,
        rarity: fish.rarity,
        lengthCm,
        weightKg,
        value: computedValue,
        isShiny,
        sizeFactor: +sizeFactor.toFixed(4),
        ruleVersion: gameCatalog.CATALOG_VERSION,
        caughtAt: caughtAtMs
      };

      let ledgerEntry = null;
      const currentCoins = Math.floor(Number(snapshot.coins) || 0);
      const currentLuck = Math.floor(Number(snapshot.luckPoints) || 0);
      const requestDigest = computePayloadDigest({
        action: 'catch_disposition',
        clientCatchUid,
        fishId,
        disposition: effectiveDisposition
      });

      if (effectiveDisposition === 'sold') {
        snapshot.coins = currentCoins + computedValue;
        ledgerEntry = {
          idempotencyKey: cleanIdempotencyKey || `catch:${clientCatchUid}`,
          eventType: 'catch_sell',
          coinsDelta: computedValue,
          luckDelta: 0,
          coinsAfter: snapshot.coins,
          luckAfter: currentLuck,
          referenceId: clientCatchUid,
          metadata: {
            clientCatchUid,
            fishId,
            rarity: fish.rarity,
            isShiny,
            activeGoldenTide,
            computedValue,
            requestDigest
          }
        };
      } else if (effectiveDisposition === 'released') {
        const rarityInfo = gameCatalog.RARITIES[fish.rarity] || { luckReward: 1 };
        const luckGain = (rarityInfo.luckReward || 1) * (isShiny ? 2 : 1);
        snapshot.luckPoints = currentLuck + luckGain;
        ledgerEntry = {
          idempotencyKey: cleanIdempotencyKey || `catch:${clientCatchUid}`,
          eventType: 'catch_release',
          coinsDelta: 0,
          luckDelta: luckGain,
          coinsAfter: currentCoins,
          luckAfter: snapshot.luckPoints,
          referenceId: clientCatchUid,
          metadata: {
            clientCatchUid,
            fishId,
            rarity: fish.rarity,
            isShiny,
            luckGain,
            requestDigest
          }
        };
      } else if (effectiveDisposition === 'aquarium') {
        const aqLevel = Math.max(1, Math.min(5, Math.floor(Number(snapshot.aquariumLevel) || 1)));
        const aqInfo = gameCatalog.getAquariumLevelInfo(aqLevel);
        snapshot.aquarium = Array.isArray(snapshot.aquarium) ? snapshot.aquarium : [];
        if (snapshot.aquarium.length >= aqInfo.capacity) {
          throw createDomainError(
            'VALIDATION_ERROR',
            `水族箱容量已满 (${snapshot.aquarium.length}/${aqInfo.capacity})`,
            400
          );
        }
        snapshot.aquarium.push(storedFishObj);
      } else if (effectiveDisposition === 'basket') {
        const maxBasket = gameCatalog.ECONOMY_CONSTANTS?.MAX_BASKET_SIZE || 200;
        snapshot.basket = Array.isArray(snapshot.basket) ? snapshot.basket : [];
        if (snapshot.basket.length >= maxBasket) {
          throw createDomainError(
            'VALIDATION_ERROR',
            `鱼篓容量已满 (${snapshot.basket.length}/${maxBasket})`,
            400
          );
        }
        snapshot.basket.push(storedFishObj);
      }

      // 7. 构造榜单与成就增量更新
      const speciesUnlockedCount = Object.keys(snapshot.records).length;
      const leaderboardUpdates = [
        {
          boardType: 'species_weight',
          scopeKey: fishId,
          scoreNumeric: weightKg,
          isShiny,
          metadata: { fishId, weightKg, lengthCm, biomeId },
          auditStatus: validationStatus
        },
        {
          boardType: 'species_length',
          scopeKey: fishId,
          scoreNumeric: lengthCm,
          isShiny,
          metadata: { fishId, weightKg, lengthCm, biomeId },
          auditStatus: validationStatus
        },
        {
          boardType: 'encyclopedia',
          scopeKey: 'global',
          scoreNumeric: speciesUnlockedCount,
          metadata: { speciesCount: speciesUnlockedCount },
          auditStatus: validationStatus
        },
        {
          boardType: 'wealth',
          scopeKey: 'global',
          scoreNumeric: Math.floor(Number(snapshot.coins) || 0),
          metadata: { coins: Math.floor(Number(snapshot.coins) || 0) },
          auditStatus: validationStatus
        }
      ];

      const achievementUpdates = [
        { code: 'first_catch', progressValue: 1, mode: 'max' },
        { code: 'encyclopedia_5', progressValue: speciesUnlockedCount, mode: 'max' },
        { code: 'encyclopedia_12', progressValue: speciesUnlockedCount, mode: 'max' },
        { code: 'encyclopedia_20', progressValue: speciesUnlockedCount, mode: 'max' }
      ];
      if (isShiny) {
        achievementUpdates.push({ code: 'first_shiny', progressValue: 1, mode: 'max' });
      }
      if (fish.rarity === 'legendary') {
        achievementUpdates.push({ code: 'first_legendary', progressValue: 1, mode: 'max' });
      }
      if (fish.rarity === 'mythic') {
        achievementUpdates.push({ code: 'first_mythic', progressValue: 1, mode: 'max' });
      }
      if (biomeId === 'abyss') {
        achievementUpdates.push({ code: 'sail_abyss', progressValue: 1, mode: 'max' });
      }
      if (effectiveDisposition === 'released') {
        achievementUpdates.push({ code: 'release_25', progressValue: 1, mode: 'add' });
      }

      const persisted = await economyRepo.recordCatchAtomic({
        userId,
        clientCatchUid,
        idempotencyKey: cleanIdempotencyKey,
        catchLog: {
          fishId,
          rarity: fish.rarity,
          biomeId,
          depthZone,
          baitId: effectiveBaitId,
          weatherId,
          isGoldenTide: activeGoldenTide,
          isShiny,
          lengthCm,
          weightKg,
          computedValue,
          disposition: effectiveDisposition,
          validationStatus,
          validationReason,
          caughtAt: caughtAtMs
        },
        nextSaveObj: snapshot,
        ledgerEntry,
        leaderboardUpdates,
        achievementUpdates,
        auditEvent
      });

      if (persisted.duplicate) {
        return {
          duplicate: true,
          catchLog: persisted.existingCatch,
          computedValue: persisted.existingCatch?.computedValue ?? computedValue,
          disposition: persisted.existingCatch?.disposition ?? effectiveDisposition,
          validationStatus: persisted.existingCatch?.validationStatus ?? validationStatus,
          save: persisted.save,
          ledger: persisted.ledger
        };
      }

      return {
        duplicate: false,
        catchLog: persisted.catchLog,
        computedValue,
        baitUsed: effectiveBaitId,
        activeGoldenTide,
        disposition: effectiveDisposition,
        validationStatus,
        fish: (effectiveDisposition === 'aquarium' || effectiveDisposition === 'basket') ? storedFishObj : null,
        save: persisted.save,
        ledger: persisted.ledger
      };
    },

    async purchaseShopItem({ userId, itemType, itemId, quantity = 1, idempotencyKey }) {
      if (!userId) {
        throw createDomainError('UNAUTHORIZED', '未登录或会话凭证已失效', 401);
      }
      if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
        throw createDomainError('VALIDATION_ERROR', '缺少必要的 Idempotency-Key', 400);
      }
      if (typeof itemType !== 'string' || !VALID_SHOP_TYPES.has(itemType)) {
        throw createDomainError('VALIDATION_ERROR', `无效的商品类型: ${String(itemType)}`, 400);
      }

      const qty = quantity === undefined || quantity === null ? 1 : Number(quantity);
      if (itemType === 'bait') {
        if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
          throw createDomainError('VALIDATION_ERROR', '鱼饵购买数量必须为 1 ~ 99 的整数', 400);
        }
      } else if (!Number.isInteger(qty) || qty !== 1) {
        throw createDomainError('VALIDATION_ERROR', '装备或外观每次仅可购买 1 件', 400);
      }

      const normalizedItemId = itemId !== undefined && itemId !== null ? String(itemId) : '';
      const expectedPayloadHash = computePayloadDigest({
        action: 'shop_purchase',
        itemType,
        itemId: normalizedItemId,
        quantity: qty
      });

      const economyRepo = requireEconomyRepo();
      const result = await economyRepo.runEconomyMutationAtomic({
        userId,
        idempotencyKey: idempotencyKey.trim(),
        expectedPayloadHash,
        mutateFn({ saveRow }) {
          const snapshot = structuredClone(saveRow.snapshot);
          const currentCoins = Math.floor(Number(snapshot.coins) || 0);
          const currentLuck = Math.floor(Number(snapshot.luckPoints) || 0);
          let totalCost = 0;
          let itemName = '';
          let referenceId = `${itemType}:${normalizedItemId}`;
          const extraMeta = {};

          if (itemType === 'bait') {
            const bait = gameCatalog.BAIT_BY_ID[normalizedItemId];
            if (!bait || bait.id === 'dough' || bait.price <= 0) {
              throw createDomainError('VALIDATION_ERROR', `无效的可购买鱼饵 ID: ${normalizedItemId}`, 400);
            }
            const grantCount = (bait.packSize || 1) * qty;
            totalCost = bait.price * qty;
            snapshot.baits = snapshot.baits && typeof snapshot.baits === 'object'
              ? { worm: 0, gold: 0, star: 0, ...snapshot.baits }
              : { worm: 0, gold: 0, star: 0 };
            snapshot.baits[bait.id] = Math.floor(Number(snapshot.baits[bait.id]) || 0) + grantCount;
            snapshot.selectedBait = bait.id;
            itemName = bait.name;
            extraMeta.grantedAmount = grantCount;
          } else if (itemType === 'rod') {
            const currentLevel = Math.floor(Number(snapshot.rodLevel) || 1);
            if (currentLevel >= gameCatalog.ROD_UPGRADES.length) {
              throw createDomainError('VALIDATION_ERROR', '钓竿已升至最高等级', 400);
            }
            const nextRod = gameCatalog.ROD_UPGRADES[currentLevel];
            if (normalizedItemId && Number(normalizedItemId) !== nextRod.level) {
              throw createDomainError('VALIDATION_ERROR', `钓竿必须按顺序升级至 Lv.${nextRod.level}`, 400);
            }
            totalCost = nextRod.price;
            snapshot.rodLevel = nextRod.level;
            itemName = nextRod.name;
            referenceId = `rod:${nextRod.level}`;
            extraMeta.newLevel = nextRod.level;
          } else if (itemType === 'reel') {
            const currentLevel = Math.floor(Number(snapshot.reelLevel) || 1);
            if (currentLevel >= gameCatalog.REEL_UPGRADES.length) {
              throw createDomainError('VALIDATION_ERROR', '卷线器已升至最高等级', 400);
            }
            const nextReel = gameCatalog.REEL_UPGRADES[currentLevel];
            if (normalizedItemId && Number(normalizedItemId) !== nextReel.level) {
              throw createDomainError('VALIDATION_ERROR', `卷线器必须按顺序升级至 Lv.${nextReel.level}`, 400);
            }
            totalCost = nextReel.price;
            snapshot.reelLevel = nextReel.level;
            itemName = nextReel.name;
            referenceId = `reel:${nextReel.level}`;
            extraMeta.newLevel = nextReel.level;
          } else if (itemType === 'boat') {
            const boat = gameCatalog.BOAT_BY_ID[normalizedItemId];
            if (!boat || boat.id === 'none' || boat.price <= 0) {
              throw createDomainError('VALIDATION_ERROR', `无效的船只 ID: ${normalizedItemId}`, 400);
            }
            snapshot.unlockedBoats = Array.isArray(snapshot.unlockedBoats) ? [...snapshot.unlockedBoats] : ['none'];
            if (snapshot.unlockedBoats.includes(boat.id)) {
              throw createDomainError('VALIDATION_ERROR', `船只【${boat.name}】已解锁，不可重复购买`, 400);
            }
            totalCost = boat.price;
            snapshot.unlockedBoats.push(boat.id);
            snapshot.equippedBoat = boat.id;
            snapshot.inBoat = true;
            itemName = boat.name;
            extraMeta.unlockedBoats = snapshot.unlockedBoats;
          } else if (itemType === 'hat') {
            const hat = gameCatalog.HAT_BY_ID[normalizedItemId];
            if (!hat || hat.id === 'straw' || hat.price <= 0) {
              throw createDomainError('VALIDATION_ERROR', `无效的帽子 ID: ${normalizedItemId}`, 400);
            }
            snapshot.unlockedHats = Array.isArray(snapshot.unlockedHats) ? [...snapshot.unlockedHats] : ['straw'];
            if (snapshot.unlockedHats.includes(hat.id)) {
              throw createDomainError('VALIDATION_ERROR', `帽子【${hat.name}】已解锁，不可重复购买`, 400);
            }
            totalCost = hat.price;
            snapshot.unlockedHats.push(hat.id);
            snapshot.equippedHat = hat.id;
            itemName = hat.name;
          } else if (itemType === 'outfit') {
            const outfit = gameCatalog.OUTFIT_BY_ID[normalizedItemId];
            if (!outfit || outfit.id === 'casual' || outfit.price <= 0) {
              throw createDomainError('VALIDATION_ERROR', `无效的服饰 ID: ${normalizedItemId}`, 400);
            }
            snapshot.unlockedOutfits = Array.isArray(snapshot.unlockedOutfits) ? [...snapshot.unlockedOutfits] : ['casual'];
            if (snapshot.unlockedOutfits.includes(outfit.id)) {
              throw createDomainError('VALIDATION_ERROR', `服饰【${outfit.name}】已解锁，不可重复购买`, 400);
            }
            totalCost = outfit.price;
            snapshot.unlockedOutfits.push(outfit.id);
            snapshot.equippedOutfit = outfit.id;
            itemName = outfit.name;
          }

          if (currentCoins < totalCost) {
            throw createDomainError('VALIDATION_ERROR', `金币不足，购买【${itemName}】需要 ${totalCost} 金币`, 400);
          }

          snapshot.coins = currentCoins - totalCost;
          const responseData = {
            itemType,
            itemId: normalizedItemId || String(extraMeta.newLevel || ''),
            itemName,
            quantity: qty,
            totalCost,
            coinsAfter: snapshot.coins,
            ...extraMeta
          };

          return {
            nextSaveObj: snapshot,
            ledgerData: {
              eventType: 'shop_purchase',
              coinsDelta: -totalCost,
              luckDelta: 0,
              coinsAfter: snapshot.coins,
              luckAfter: currentLuck,
              referenceId,
              metadata: {
                itemType,
                itemId: responseData.itemId,
                quantity: qty,
                totalCost,
                ...extraMeta
              }
            },
            leaderboardUpdates: [],
            achievementUpdates: [],
            responseData
          };
        }
      });

      return {
        idempotentReplay: result.idempotentReplay,
        ...(result.responseData || {}),
        save: result.save,
        ledger: result.ledger
      };
    },

    async deliverBountyOrder({ userId, orderId = null, fishUid, source = 'basket', idempotencyKey }) {
      if (!userId) {
        throw createDomainError('UNAUTHORIZED', '未登录或会话凭证已失效', 401);
      }
      if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
        throw createDomainError('VALIDATION_ERROR', '缺少必要的 Idempotency-Key', 400);
      }
      if (typeof fishUid !== 'string' || !fishUid.trim()) {
        throw createDomainError('VALIDATION_ERROR', 'fishUid 不能为空', 400);
      }
      const cleanFishUid = fishUid.trim();
      const effectiveSource = source || 'basket';
      if (!VALID_BOUNTY_SOURCES.has(effectiveSource)) {
        throw createDomainError('VALIDATION_ERROR', `无效的鱼获来源容器: ${String(effectiveSource)}`, 400);
      }
      const cleanOrderId = typeof orderId === 'string' && orderId.trim() ? orderId.trim() : null;

      const expectedPayloadHash = computePayloadDigest({
        action: 'bounty_deliver',
        orderId: cleanOrderId,
        fishUid: cleanFishUid,
        source: effectiveSource
      });

      const economyRepo = requireEconomyRepo();
      const result = await economyRepo.runEconomyMutationAtomic({
        userId,
        idempotencyKey: idempotencyKey.trim(),
        expectedPayloadHash,
        mutateFn({ saveRow }) {
          const snapshot = structuredClone(saveRow.snapshot);
          const container = Array.isArray(snapshot[effectiveSource]) ? [...snapshot[effectiveSource]] : [];
          const fishIdx = container.findIndex(item => item && item.uid === cleanFishUid);
          if (fishIdx === -1) {
            throw createDomainError('NOT_FOUND', `在 ${effectiveSource} 中未找到指定的鱼获 (${cleanFishUid})`, 404);
          }

          const [deliveredFish] = container.splice(fishIdx, 1);
          snapshot[effectiveSource] = container;

          const catalogFish = gameCatalog.FISH_BY_ID[deliveredFish.fishId] || null;
          const rawFishValue = Number(deliveredFish.value);
          const safeBaseValue = Number.isFinite(rawFishValue) && rawFishValue > 0
            ? (catalogFish ? Math.min(catalogFish.baseValue * 10, rawFishValue) : rawFishValue)
            : (catalogFish ? catalogFish.baseValue : 10);

          const payoutCoins = Math.max(1, Math.round(safeBaseValue * 2.4));
          const luckGain = RARITY_BOUNTY_LUCK[deliveredFish.rarity] || 2;

          snapshot.coins = Math.floor(Number(snapshot.coins) || 0) + payoutCoins;
          snapshot.luckPoints = Math.floor(Number(snapshot.luckPoints) || 0) + luckGain;
          snapshot.completedOrdersCount = Math.floor(Number(snapshot.completedOrdersCount) || 0) + 1;

          if (cleanOrderId && Array.isArray(snapshot.bountyOrders)) {
            const ordIdx = snapshot.bountyOrders.findIndex(ord => ord && ord.id === cleanOrderId);
            if (ordIdx !== -1) {
              snapshot.bountyOrders.splice(ordIdx, 1);
            }
          }

          const responseData = {
            orderId: cleanOrderId,
            fishUid: cleanFishUid,
            fishId: deliveredFish.fishId,
            source: effectiveSource,
            payoutCoins,
            luckGain,
            coinsAfter: snapshot.coins,
            luckAfter: snapshot.luckPoints,
            completedOrdersCount: snapshot.completedOrdersCount
          };

          return {
            nextSaveObj: snapshot,
            ledgerData: {
              eventType: 'bounty_deliver',
              coinsDelta: payoutCoins,
              luckDelta: luckGain,
              coinsAfter: snapshot.coins,
              luckAfter: snapshot.luckPoints,
              referenceId: cleanOrderId || cleanFishUid,
              metadata: {
                orderId: cleanOrderId,
                fishUid: cleanFishUid,
                fishId: deliveredFish.fishId,
                source: effectiveSource,
                payoutCoins,
                luckGain
              }
            },
            leaderboardUpdates: [
              {
                boardType: 'bounty_master',
                scopeKey: 'global',
                scoreNumeric: snapshot.completedOrdersCount,
                metadata: { completedOrdersCount: snapshot.completedOrdersCount }
              },
              {
                boardType: 'wealth',
                scopeKey: 'global',
                scoreNumeric: snapshot.coins,
                metadata: { coins: snapshot.coins }
              }
            ],
            achievementUpdates: [
              {
                code: 'bounty_10',
                progressValue: snapshot.completedOrdersCount,
                mode: 'max'
              }
            ],
            responseData
          };
        }
      });

      return {
        idempotentReplay: result.idempotentReplay,
        ...(result.responseData || {}),
        save: result.save,
        ledger: result.ledger
      };
    }
  };
}
