import test from 'node:test';
import assert from 'node:assert/strict';
import worldClock from '../../shared/world_clock.js';

test('全服天气在相同时间戳与种子下完全确定且可重复', () => {
  const fixedTs = Date.UTC(2026, 10, 26, 4, 22, 10);
  const s1 = worldClock.computeWorldStateAt(fixedTs, null, 'wwf-v2-global');
  const s2 = worldClock.computeWorldStateAt(fixedTs, null, 'wwf-v2-global');
  assert.deepEqual(s1, s2);
  assert.ok(['sunny', 'rain', 'storm', 'meteor'].includes(s1.weather.weatherId));
  assert.ok(s1.weather.remainingSec > 0 && s1.weather.remainingSec <= 900);
});

test('同一天气周期内任意两个时间点天气相同', () => {
  const cycleStart = Date.UTC(2026, 10, 26, 6, 0, 0);
  const a = worldClock.computeWorldStateAt(cycleStart + 1000, null, 'wwf-v2-global');
  const b = worldClock.computeWorldStateAt(cycleStart + 14 * 60 * 1000, null, 'wwf-v2-global');
  assert.equal(a.weather.cycleIndex, b.weather.cycleIndex);
  assert.equal(a.weather.weatherId, b.weather.weatherId);
});

test('祈愿黄金鱼潮可正确覆盖并延长黄金鱼潮状态', () => {
  const fixedTs = Date.UTC(2026, 10, 26, 8, 0, 5);
  const summonedEnd = new Date(fixedTs + 60000).toISOString();
  const state = worldClock.computeWorldStateAt(fixedTs, {
    endsAt: summonedEnd,
    triggeredBy: 'usr_captain'
  });
  assert.equal(state.goldenTide.active, true);
  assert.equal(state.goldenTide.source, 'summoned');
  assert.equal(state.goldenTide.remainingSec, 60);
  assert.equal(state.goldenTide.summonedBy, 'usr_captain');
});
