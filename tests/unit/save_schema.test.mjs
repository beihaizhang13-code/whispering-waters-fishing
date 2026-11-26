import test from 'node:test';
import assert from 'node:assert/strict';
import saveSchema from '../../shared/save_schema.js';
import gameCatalog from '../../shared/game_catalog.js';

test('默认玩家存档可通过 Schema v2 校验', () => {
  const def = saveSchema.createDefaultPlayerState();
  const res = saveSchema.sanitizeAndValidateSave(def, gameCatalog);
  assert.equal(res.valid, true);
  assert.deepEqual(res.errors, []);
  assert.equal(res.sanitized.coins, 80);
  assert.equal(res.sanitized.worldX, 760);
  assert.equal(res.sanitized.aquariumLevel, 1);
});

test('非法金币、超上限等级、未知道具 ID 会被拒绝', () => {
  const badSave = {
    coins: -999,
    rodLevel: 99,
    unlockedBoats: ['none', 'nuclear_submarine'],
    equippedHat: 'star_crown'
  };
  const res = saveSchema.sanitizeAndValidateSave(badSave, gameCatalog);
  assert.equal(res.valid, false);
  assert.ok(res.errors.length >= 4);
});

test('未解锁船只却位于深海坐标时自动重置回微风木栈桥并记录 warning', () => {
  const suspicious = {
    ...saveSchema.createDefaultPlayerState(),
    worldX: 2100,
    inBoat: true,
    unlockedBoats: ['none']
  };
  const res = saveSchema.sanitizeAndValidateSave(suspicious, gameCatalog);
  assert.equal(res.valid, true);
  assert.equal(res.sanitized.worldX, 760);
  assert.equal(res.sanitized.inBoat, false);
  assert.ok(res.warnings.length > 0);
});

test('水族箱数量超过当前等级容量时拒绝同步', () => {
  const base = saveSchema.createDefaultPlayerState();
  const fish = {
    uid: 'f1',
    fishId: 'minnow',
    lengthCm: 15,
    weightKg: 0.1,
    value: 10,
    isShiny: false,
    caughtAt: Date.now()
  };
  const overflow = {
    ...base,
    aquariumLevel: 1, // 容量为 4
    aquarium: [fish, fish, fish, fish, fish]
  };
  const res = saveSchema.sanitizeAndValidateSave(overflow, gameCatalog);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some(e => e.includes('aquarium')));
});
