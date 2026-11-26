/**
 * 《微风垂钓物语 2.0》全服确定性天气与黄金鱼潮服务 (backend/domain/world_event_service.mjs)
 * ----------------------------------------------------------------------------
 * - 无状态全服时钟查询：结合 shared/world_clock.js 与 world_events 表中的玩家祈愿鱼潮；
 * - 玩家主动召唤黄金鱼潮：校验幸运值/金币余额并原子写入 world_events 与 economy_ledger。
 */
import crypto from 'node:crypto';
import gameCatalog from '../../shared/game_catalog.js';
import worldClock from '../../shared/world_clock.js';
import { createDomainError } from '../repositories/sqlite/helpers.mjs';

const { ECONOMY_CONSTANTS } = gameCatalog;

export function createWorldEventService({ config, repositories, logger }) {
  async function getWorldState(nowMs = Date.now()) {
    const effectiveNowMs = Number.isFinite(Number(nowMs)) ? Math.floor(Number(nowMs)) : Date.now();
    let activeSummonedTide = null;
    if (repositories && repositories.worldEvents && typeof repositories.worldEvents.findActiveGoldenTide === 'function') {
      try {
        activeSummonedTide = await repositories.worldEvents.findActiveGoldenTide(new Date(effectiveNowMs).toISOString());
      } catch {
        activeSummonedTide = null;
      }
    }
    return worldClock.computeWorldStateAt(effectiveNowMs, activeSummonedTide, config.worldClockSeed);
  }

  return {
    getWorldState,

    async summonGoldenTide({ userId, paymentMethod = 'luck', idempotencyKey, nowMs = Date.now() }) {
      if (!userId) {
        throw createDomainError('VALIDATION_ERROR', '缺少 userId', 400);
      }
      const cleanKey = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
      if (!cleanKey) {
        throw createDomainError('VALIDATION_ERROR', '缺少 Idempotency-Key 请求头', 400);
      }

      const method = paymentMethod === undefined ? 'luck' : paymentMethod;
      if (method !== 'luck' && method !== 'coins') {
        throw createDomainError('VALIDATION_ERROR', "paymentMethod 必须为 'luck' 或 'coins'", 400);
      }

      if (
        !repositories
        || !repositories.worldEvents
        || typeof repositories.worldEvents.summonGoldenTideAtomic !== 'function'
      ) {
        throw createDomainError('NOT_IMPLEMENTED', 'WorldEvents.summonGoldenTideAtomic 仓储尚未实现', 501);
      }

      const effectiveNowMs = Number.isFinite(Number(nowMs)) ? Math.floor(Number(nowMs)) : Date.now();
      const durationMs = ECONOMY_CONSTANTS.GOLDEN_TIDE_DURATION_SEC * 1000;

      let baseStartMs = effectiveNowMs;
      if (typeof repositories.worldEvents.findActiveGoldenTide === 'function') {
        try {
          const active = await repositories.worldEvents.findActiveGoldenTide(new Date(effectiveNowMs).toISOString());
          if (active && active.endsAt) {
            const existingEndsMs = Date.parse(active.endsAt);
            if (Number.isFinite(existingEndsMs) && existingEndsMs > baseStartMs) {
              baseStartMs = existingEndsMs;
            }
          }
        } catch {
          // 查询活跃鱼潮异常时退回当前时间起算
        }
      }

      const eventId = `we_${crypto.randomUUID()}`;
      const startsAt = new Date(effectiveNowMs).toISOString();
      const endsAt = new Date(baseStartMs + durationMs).toISOString();
      const requestDigest = crypto
        .createHash('sha256')
        .update(JSON.stringify({ action: 'golden_tide_summon', paymentMethod: method }))
        .digest('hex');

      const txResult = await repositories.worldEvents.summonGoldenTideAtomic({
        userId,
        idempotencyKey: cleanKey,
        requestDigest,
        eventId,
        startsAt,
        endsAt,
        payload: {
          paymentMethod: method,
          durationSec: ECONOMY_CONSTANTS.GOLDEN_TIDE_DURATION_SEC
        },
        mutateSaveFn(saveRow) {
          const snapshot = structuredClone(saveRow.snapshot || {});
          const curCoins = Math.max(0, Math.floor(Number(snapshot.coins ?? saveRow.coins) || 0));
          const curLuck = Math.max(0, Math.floor(Number(snapshot.luckPoints ?? saveRow.luckPoints) || 0));
          let coinsDelta = 0;
          let luckDelta = 0;

          if (method === 'luck') {
            const cost = ECONOMY_CONSTANTS.GOLDEN_TIDE_SUMMON_LUCK;
            if (curLuck < cost) {
              throw createDomainError('VALIDATION_ERROR', `幸运值不足 ${cost} 点，无法召唤全服黄金鱼潮`, 400);
            }
            snapshot.luckPoints = curLuck - cost;
            luckDelta = -cost;
          } else {
            const cost = ECONOMY_CONSTANTS.GOLDEN_TIDE_SUMMON_COINS;
            if (curCoins < cost) {
              throw createDomainError('VALIDATION_ERROR', `金币不足 ${cost} 枚，无法召唤全服黄金鱼潮`, 400);
            }
            snapshot.coins = curCoins - cost;
            coinsDelta = -cost;
          }

          return {
            nextSaveObj: snapshot,
            coinsDelta,
            luckDelta,
            metadata: {
              paymentMethod: method,
              eventId
            }
          };
        }
      });

      const worldState = await getWorldState(effectiveNowMs);

      if (logger && typeof logger.info === 'function') {
        logger.info('golden_tide_summoned', {
          userId,
          paymentMethod: method,
          eventId: txResult.event?.id || eventId,
          replayed: Boolean(txResult.replayed)
        });
      }

      return {
        replayed: Boolean(txResult.replayed),
        paymentMethod: method,
        event: txResult.event,
        ledger: txResult.ledger,
        worldState,
        save: {
          revision: txResult.save.revision,
          coins: txResult.save.coins,
          luckPoints: txResult.save.luckPoints,
          aquariumLevel: txResult.save.aquariumLevel,
          snapshot: txResult.save.snapshot
        }
      };
    }
  };
}
