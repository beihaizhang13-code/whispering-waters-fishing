/**
 * 《微风垂钓物语 2.0》水族箱离线门票结算与成长服务 (backend/domain/aquarium_service.mjs)
 * ----------------------------------------------------------------------------
 * 结算公式（与 shared/game_catalog.js 保持 1:1 一致）：
 * - 单鱼基础每分钟门票 = RARITIES[fish.rarity].aquariumIncome * (fish.isShiny ? AQUARIUM_SHINY_INCOME_MULT : 1.0)
 * - 水族箱总每分钟收益 = sum(单鱼收益) * AQUARIUM_UPGRADES[level - 1].incomeMult
 * - 离线有效时长 = clamp(now - aquarium_last_settled_at, 0, OFFLINE_AQUARIUM_MAX_HOURS * 3600s)
 * - 全部以服务端 UTC 时钟为准，防止客户端调快系统时间刷取收益。
 */
import crypto from 'node:crypto';
import gameCatalog from '../../shared/game_catalog.js';
import { createDomainError } from '../repositories/sqlite/helpers.mjs';

const { ECONOMY_CONSTANTS, RARITIES, AQUARIUM_UPGRADES, getFishById, getAquariumLevelInfo } = gameCatalog;

function buildRequestDigest(parts) {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function assertIdempotencyKey(idempotencyKey) {
  const key = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
  if (!key) {
    throw createDomainError('VALIDATION_ERROR', '缺少 Idempotency-Key 请求头', 400);
  }
  return key;
}

function assertAquariumRepo(repositories) {
  if (!repositories || !repositories.aquariumHelpers || typeof repositories.aquariumHelpers.runAquariumTx !== 'function') {
    throw createDomainError('NOT_IMPLEMENTED', 'AquariumService 依赖的 aquariumHelpers 仓储尚未就绪', 501);
  }
  return repositories.aquariumHelpers;
}

function computePerMinuteIncome(aquarium, level) {
  let baseRate = 0;
  for (const fish of aquarium) {
    if (!fish || typeof fish !== 'object') continue;
    const spec = getFishById(fish.fishId);
    const rarityKey = (spec && spec.rarity) || fish.rarity || 'common';
    const rarityDef = RARITIES[rarityKey] || RARITIES.common;
    const shinyMult = fish.isShiny ? ECONOMY_CONSTANTS.AQUARIUM_SHINY_INCOME_MULT : 1.0;
    baseRate += rarityDef.aquariumIncome * shinyMult;
  }
  const upgradeInfo = getAquariumLevelInfo(level);
  return baseRate * upgradeInfo.incomeMult;
}

export function createAquariumService({ config, repositories, logger }) {
  return {
    async claimOfflineIncome({ userId, idempotencyKey, nowMs = Date.now() }) {
      const cleanKey = assertIdempotencyKey(idempotencyKey);
      if (!userId) {
        throw createDomainError('VALIDATION_ERROR', '缺少 userId', 400);
      }
      const aquariumRepo = assertAquariumRepo(repositories);
      const effectiveNowMs = Number.isFinite(Number(nowMs)) ? Math.floor(Number(nowMs)) : Date.now();
      const nowIso = new Date(effectiveNowMs).toISOString();
      const maxHours = Number(config?.offlineAquariumMaxHours) || ECONOMY_CONSTANTS.OFFLINE_AQUARIUM_MAX_HOURS || 24;
      const maxSec = maxHours * 3600;
      const requestDigest = buildRequestDigest({ action: 'aquarium_offline_claim' });

      const txResult = await aquariumRepo.runAquariumTx({
        userId,
        idempotencyKey: cleanKey,
        requestDigest,
        handlerFn({ saveRow }) {
          const snapshot = structuredClone(saveRow.snapshot || {});
          const aquarium = Array.isArray(snapshot.aquarium) ? snapshot.aquarium : [];
          const level = Math.max(1, Math.min(5, Math.floor(Number(snapshot.aquariumLevel ?? saveRow.aquariumLevel) || 1)));
          const parsedSettled = saveRow.aquariumLastSettledAt ? Date.parse(saveRow.aquariumLastSettledAt) : effectiveNowMs;
          const settledMs = Number.isFinite(parsedSettled) ? parsedSettled : effectiveNowMs;

          const elapsedSec = Math.min(maxSec, Math.max(0, (effectiveNowMs - settledMs) / 1000));
          const perMinuteIncome = computePerMinuteIncome(aquarium, level);
          const earnedCoins = Math.floor((perMinuteIncome * elapsedSec) / 60);

          let nextSaveObj = null;
          let aquariumLastSettledAt = null;
          let leaderboard = null;
          const settledAt = earnedCoins > 0 ? nowIso : (saveRow.aquariumLastSettledAt || nowIso);

          if (earnedCoins > 0) {
            const curCoins = Math.max(0, Math.floor(Number(snapshot.coins ?? saveRow.coins) || 0));
            snapshot.coins = curCoins + earnedCoins;
            snapshot.aquariumUnclaimedCoins = 0;
            nextSaveObj = snapshot;
            aquariumLastSettledAt = nowIso;
            leaderboard = {
              boardType: 'wealth',
              scopeKey: 'global',
              scoreNumeric: snapshot.coins,
              metadata: { source: 'aquarium_offline_claim' },
              nowIso
            };
          }

          return {
            eventType: 'aquarium_offline_claim',
            coinsDelta: earnedCoins,
            luckDelta: 0,
            nextSaveObj,
            aquariumLastSettledAt,
            nowIso,
            leaderboard,
            metadata: {
              elapsedSec: +elapsedSec.toFixed(2),
              perMinuteIncome: +perMinuteIncome.toFixed(2),
              aquariumCount: aquarium.length,
              aquariumLevel: level
            },
            result: {
              earnedCoins,
              elapsedSec: +elapsedSec.toFixed(2),
              perMinuteIncome: +perMinuteIncome.toFixed(2),
              aquariumCount: aquarium.length,
              aquariumLevel: level,
              settledAt
            }
          };
        }
      });

      if (logger && typeof logger.info === 'function') {
        logger.info('aquarium_offline_claimed', {
          userId,
          earnedCoins: txResult.result?.earnedCoins ?? 0,
          replayed: txResult.replayed
        });
      }

      return {
        ...(txResult.result || {}),
        replayed: Boolean(txResult.replayed),
        coins: txResult.save.coins,
        luckPoints: txResult.save.luckPoints,
        revision: txResult.save.revision,
        aquariumLastSettledAt: txResult.save.aquariumLastSettledAt,
        save: txResult.save,
        ledger: txResult.ledger
      };
    },

    async feedAquarium({ userId, idempotencyKey }) {
      const cleanKey = assertIdempotencyKey(idempotencyKey);
      if (!userId) {
        throw createDomainError('VALIDATION_ERROR', '缺少 userId', 400);
      }
      const aquariumRepo = assertAquariumRepo(repositories);
      const cost = ECONOMY_CONSTANTS.AQUARIUM_FEED_COST;
      const growthMult = ECONOMY_CONSTANTS.AQUARIUM_FEED_GROWTH_MULT;
      const requestDigest = buildRequestDigest({ action: 'aquarium_feed', cost, growthMult });

      const txResult = await aquariumRepo.runAquariumTx({
        userId,
        idempotencyKey: cleanKey,
        requestDigest,
        handlerFn({ saveRow }) {
          const snapshot = structuredClone(saveRow.snapshot || {});
          const aquarium = Array.isArray(snapshot.aquarium) ? snapshot.aquarium : [];
          if (aquarium.length === 0) {
            throw createDomainError('VALIDATION_ERROR', '水族箱中还没有观赏鱼，请先放入鱼儿再投喂', 400);
          }

          const curCoins = Math.max(0, Math.floor(Number(snapshot.coins ?? saveRow.coins) || 0));
          if (curCoins < cost) {
            throw createDomainError('VALIDATION_ERROR', `金币不足 ${cost}，无法购买高级营养鱼食`, 400);
          }

          const nextAquarium = aquarium.map(fish => {
            const copy = { ...fish };
            const fishSpec = getFishById(copy.fishId);
            const curWeight = Number(copy.weightKg) || (fishSpec ? fishSpec.minKg : 0.1);
            const curValue = Number(copy.value) || (fishSpec ? fishSpec.baseValue : 10);

            if (fishSpec) {
              const maxWeight = +(fishSpec.maxKg * 1.5).toFixed(2);
              const grownWeight = +(curWeight * growthMult).toFixed(2);
              copy.weightKg = Math.min(maxWeight, Math.max(curWeight, grownWeight));

              const maxValue = Math.round(fishSpec.baseValue * 2.5 * (copy.isShiny ? 2.2 : 1.0));
              const grownValue = Math.max(curValue + 1, Math.round(curValue * growthMult));
              copy.value = Math.min(maxValue, Math.max(curValue, grownValue));
            } else {
              copy.weightKg = +(curWeight * growthMult).toFixed(2);
              copy.value = Math.max(curValue + 1, Math.round(curValue * growthMult));
            }
            return copy;
          });

          snapshot.coins = curCoins - cost;
          snapshot.aquarium = nextAquarium;
          const nowIso = new Date().toISOString();

          return {
            eventType: 'aquarium_feed',
            coinsDelta: -cost,
            luckDelta: 0,
            nextSaveObj: snapshot,
            nowIso,
            metadata: {
              fedCount: nextAquarium.length,
              growthMult
            },
            result: {
              cost,
              fedCount: nextAquarium.length,
              growthMultiplier: growthMult,
              aquarium: nextAquarium
            }
          };
        }
      });

      if (logger && typeof logger.info === 'function') {
        logger.info('aquarium_fed', {
          userId,
          fedCount: txResult.result?.fedCount ?? 0,
          replayed: txResult.replayed
        });
      }

      return {
        ...(txResult.result || {}),
        replayed: Boolean(txResult.replayed),
        coins: txResult.save.coins,
        luckPoints: txResult.save.luckPoints,
        revision: txResult.save.revision,
        aquarium: txResult.save.snapshot?.aquarium || txResult.result?.aquarium || [],
        save: txResult.save,
        ledger: txResult.ledger
      };
    },

    async upgradeAquarium({ userId, targetLevel, idempotencyKey }) {
      const cleanKey = assertIdempotencyKey(idempotencyKey);
      if (!userId) {
        throw createDomainError('VALIDATION_ERROR', '缺少 userId', 400);
      }
      const parsedTarget = Number(targetLevel);
      if (!Number.isInteger(parsedTarget) || parsedTarget < 2 || parsedTarget > AQUARIUM_UPGRADES.length) {
        throw createDomainError('VALIDATION_ERROR', '目标水族箱等级必须为 2 到 5 的整数', 400);
      }

      const aquariumRepo = assertAquariumRepo(repositories);
      const requestDigest = buildRequestDigest({ action: 'aquarium_upgrade', targetLevel: parsedTarget });

      const txResult = await aquariumRepo.runAquariumTx({
        userId,
        idempotencyKey: cleanKey,
        requestDigest,
        handlerFn({ saveRow }) {
          const snapshot = structuredClone(saveRow.snapshot || {});
          const curLevel = Math.max(1, Math.min(5, Math.floor(Number(snapshot.aquariumLevel ?? saveRow.aquariumLevel) || 1)));
          if (curLevel >= AQUARIUM_UPGRADES.length) {
            throw createDomainError('VALIDATION_ERROR', '水族箱已达最高等级 (Lv.5)', 400);
          }
          if (parsedTarget !== curLevel + 1) {
            throw createDomainError(
              'VALIDATION_ERROR',
              `水族箱必须逐级升级：当前 Lv.${curLevel}，目标等级应为 Lv.${curLevel + 1}`,
              400
            );
          }

          const targetUpgrade = AQUARIUM_UPGRADES[parsedTarget - 1];
          const price = targetUpgrade.price;
          const curCoins = Math.max(0, Math.floor(Number(snapshot.coins ?? saveRow.coins) || 0));
          if (curCoins < price) {
            throw createDomainError('VALIDATION_ERROR', `金币不足 ${price}，无法扩建水族箱`, 400);
          }

          snapshot.coins = curCoins - price;
          snapshot.aquariumLevel = parsedTarget;
          const nowIso = new Date().toISOString();

          const achievements = parsedTarget >= 3
            ? [{ code: 'aquarium_lv3', progressValue: parsedTarget, unlockedAt: nowIso, mode: 'max' }]
            : [];

          return {
            eventType: 'aquarium_upgrade',
            coinsDelta: -price,
            luckDelta: 0,
            nextSaveObj: snapshot,
            nowIso,
            achievements,
            metadata: {
              previousLevel: curLevel,
              targetLevel: parsedTarget,
              price
            },
            result: {
              previousLevel: curLevel,
              aquariumLevel: parsedTarget,
              name: targetUpgrade.name,
              capacity: targetUpgrade.capacity,
              incomeMult: targetUpgrade.incomeMult,
              cost: price,
              unlockedAchievement: parsedTarget >= 3 ? 'aquarium_lv3' : null
            }
          };
        }
      });

      if (logger && typeof logger.info === 'function') {
        logger.info('aquarium_upgraded', {
          userId,
          aquariumLevel: txResult.save.aquariumLevel,
          replayed: txResult.replayed
        });
      }

      return {
        ...(txResult.result || {}),
        replayed: Boolean(txResult.replayed),
        coins: txResult.save.coins,
        luckPoints: txResult.save.luckPoints,
        revision: txResult.save.revision,
        save: txResult.save,
        ledger: txResult.ledger
      };
    }
  };
}
