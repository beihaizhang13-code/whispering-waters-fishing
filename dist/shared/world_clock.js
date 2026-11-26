/**
 * 《微风垂钓物语 2.0》前后端单一事实源：全服确定性天气与鱼潮时钟 (shared/world_clock.js)
 * ----------------------------------------------------------------------------
 * 设计目标：
 * - 不依赖常驻内存定时器或 WebSocket，任意 Serverless 函数实例与客户端在相同 UTC 时间戳
 *   与种子下，都会算出完全一致的全服天气周期与自然黄金鱼潮状态。
 * - 若数据库中存在玩家祈愿开启的黄金鱼潮 (activeSummonedTide)，取最晚到期时间叠加生效。
 */
(function (root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  }
  const target = root || (typeof globalThis !== 'undefined' ? globalThis : {});
  target.WWF_SHARED = target.WWF_SHARED || {};
  target.WWF_SHARED.WorldClock = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const WEATHER_CYCLE_MS = 15 * 60 * 1000; // 15 分钟轮换一次全服天气
  const NATURAL_TIDE_PERIOD_MS = 60 * 60 * 1000; // 每 60 分钟出现一次自然鱼潮窗口
  const NATURAL_TIDE_DURATION_MS = 3 * 60 * 1000; // 每次自然黄金鱼潮持续 3 分钟

  function hashStringUInt32(input) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function pickWeatherByCycle(cycleIndex, seed) {
    const hash = hashStringUInt32(`${seed}:weather:${cycleIndex}`);
    const bucket = (hash % 10000) / 10000;
    // 权重分布: sunny 45%, rain 27%, storm 16%, meteor 12%
    if (bucket < 0.45) return 'sunny';
    if (bucket < 0.72) return 'rain';
    if (bucket < 0.88) return 'storm';
    return 'meteor';
  }

  function computeNaturalGoldenTide(nowMs, seed) {
    const hourIndex = Math.floor(nowMs / NATURAL_TIDE_PERIOD_MS);
    const offsetHash = hashStringUInt32(`${seed}:tide:${hourIndex}`);
    const maxOffsetMs = NATURAL_TIDE_PERIOD_MS - NATURAL_TIDE_DURATION_MS - 60 * 1000;
    const offsetMs = 60 * 1000 + (offsetHash % maxOffsetMs);
    const startsAtMs = hourIndex * NATURAL_TIDE_PERIOD_MS + offsetMs;
    const endsAtMs = startsAtMs + NATURAL_TIDE_DURATION_MS;
    const active = nowMs >= startsAtMs && nowMs < endsAtMs;
    return {
      active,
      startsAtMs,
      endsAtMs,
      remainingSec: active ? Math.ceil((endsAtMs - nowMs) / 1000) : 0,
      nextStartsAtMs: active
        ? endsAtMs + (NATURAL_TIDE_PERIOD_MS - offsetMs - NATURAL_TIDE_DURATION_MS)
        : (nowMs < startsAtMs ? startsAtMs : (hourIndex + 1) * NATURAL_TIDE_PERIOD_MS + 60 * 1000 + (hashStringUInt32(`${seed}:tide:${hourIndex + 1}`) % maxOffsetMs))
    };
  }

  function computeWorldStateAt(timestampMs = Date.now(), activeSummonedTide = null, seed = 'wwf-v2-global') {
    const nowMs = Number.isFinite(Number(timestampMs)) ? Math.floor(Number(timestampMs)) : Date.now();
    const cycleIndex = Math.floor(nowMs / WEATHER_CYCLE_MS);
    const cycleStartsAtMs = cycleIndex * WEATHER_CYCLE_MS;
    const cycleEndsAtMs = cycleStartsAtMs + WEATHER_CYCLE_MS;

    const weatherId = pickWeatherByCycle(cycleIndex, seed);
    const nextWeatherId = pickWeatherByCycle(cycleIndex + 1, seed);
    const naturalTide = computeNaturalGoldenTide(nowMs, seed);

    let summonedEndsAtMs = 0;
    let summonedBy = null;
    if (activeSummonedTide && activeSummonedTide.endsAt) {
      const parsedEnd = typeof activeSummonedTide.endsAt === 'number'
        ? activeSummonedTide.endsAt
        : Date.parse(activeSummonedTide.endsAt);
      if (Number.isFinite(parsedEnd) && parsedEnd > nowMs) {
        summonedEndsAtMs = parsedEnd;
        summonedBy = activeSummonedTide.triggeredBy || null;
      }
    }

    const naturalEndsAtMs = naturalTide.active ? naturalTide.endsAtMs : 0;
    const goldenTideEndsAtMs = Math.max(naturalEndsAtMs, summonedEndsAtMs);
    const goldenTideActive = goldenTideEndsAtMs > nowMs;

    return {
      serverTime: new Date(nowMs).toISOString(),
      timestampMs: nowMs,
      seed,
      weather: {
        weatherId,
        nextWeatherId,
        cycleIndex,
        startsAt: new Date(cycleStartsAtMs).toISOString(),
        endsAt: new Date(cycleEndsAtMs).toISOString(),
        remainingSec: Math.max(0, Math.ceil((cycleEndsAtMs - nowMs) / 1000))
      },
      goldenTide: {
        active: goldenTideActive,
        source: summonedEndsAtMs >= naturalEndsAtMs && summonedEndsAtMs > nowMs
          ? 'summoned'
          : (naturalTide.active ? 'natural' : 'none'),
        endsAt: goldenTideActive ? new Date(goldenTideEndsAtMs).toISOString() : null,
        remainingSec: goldenTideActive ? Math.ceil((goldenTideEndsAtMs - nowMs) / 1000) : 0,
        summonedBy,
        nextNaturalStartsAt: new Date(naturalTide.nextStartsAtMs).toISOString()
      }
    };
  }

  return {
    WEATHER_CYCLE_MS,
    NATURAL_TIDE_PERIOD_MS,
    NATURAL_TIDE_DURATION_MS,
    computeWorldStateAt
  };
});
