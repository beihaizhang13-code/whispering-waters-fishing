import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import gameCatalog from '../../shared/game_catalog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');

function loadFrontendCatalogInSandbox() {
  const sandbox = {
    console,
    Math,
    Date,
    setTimeout,
    clearTimeout
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const coreSrc = fs.readFileSync(path.join(ROOT_DIR, 'js', 'core.js'), 'utf8');
  const artSrc = fs.readFileSync(path.join(ROOT_DIR, 'js', 'art_audio.js'), 'utf8');
  vm.runInContext(coreSrc, sandbox, { filename: 'js/core.js' });
  vm.runInContext(artSrc, sandbox, { filename: 'js/art_audio.js' });

  // 将 vm 沙箱跨 realm 对象归一化到当前主 realm，避免 deepStrictEqual 原型链不一致误报
  const wwf = sandbox.window.WWF;
  return JSON.parse(JSON.stringify({
    WORLD_WIDTH: wwf.WORLD_WIDTH,
    BIOMES: wwf.BIOMES,
    WEATHERS: wwf.WEATHERS,
    RARITIES: wwf.RARITIES,
    BAITS: wwf.BAITS,
    ROD_UPGRADES: wwf.ROD_UPGRADES,
    REEL_UPGRADES: wwf.REEL_UPGRADES,
    BOATS: wwf.BOATS,
    HATS: wwf.HATS,
    OUTFITS: wwf.OUTFITS,
    AQUARIUM_UPGRADES: wwf.AQUARIUM_UPGRADES,
    FISH_SPECIES: wwf.FISH_SPECIES
  }));
}

test('shared/game_catalog.js 与前端 js/core.js & js/art_audio.js 数据完全一致', () => {
  const frontend = loadFrontendCatalogInSandbox();

  assert.equal(gameCatalog.WORLD_WIDTH, frontend.WORLD_WIDTH);
  assert.equal(gameCatalog.BIOMES.length, frontend.BIOMES.length);
  assert.deepEqual(
    gameCatalog.BIOMES.map(b => ({ id: b.id, index: b.index, minX: b.minX, maxX: b.maxX, requiresBoat: b.requiresBoat, baseDepthBonus: b.baseDepthBonus })),
    frontend.BIOMES.map(b => ({ id: b.id, index: b.index, minX: b.minX, maxX: b.maxX, requiresBoat: b.requiresBoat, baseDepthBonus: b.baseDepthBonus }))
  );

  assert.deepEqual(Object.keys(gameCatalog.WEATHERS), Object.keys(frontend.WEATHERS));
  for (const wKey of Object.keys(frontend.WEATHERS)) {
    assert.deepEqual(gameCatalog.WEATHERS[wKey].multipliers, frontend.WEATHERS[wKey].multipliers);
    assert.equal(gameCatalog.WEATHERS[wKey].shinyBoost, frontend.WEATHERS[wKey].shinyBoost);
  }

  assert.deepEqual(Object.keys(gameCatalog.RARITIES), Object.keys(frontend.RARITIES));
  for (const rKey of Object.keys(frontend.RARITIES)) {
    assert.equal(gameCatalog.RARITIES[rKey].luckReward, frontend.RARITIES[rKey].luckReward);
    assert.equal(gameCatalog.RARITIES[rKey].aquariumIncome, frontend.RARITIES[rKey].aquariumIncome);
  }

  assert.deepEqual(
    gameCatalog.BAITS.map(b => ({ id: b.id, price: b.price, packSize: b.packSize, multipliers: b.multipliers })),
    frontend.BAITS.map(b => ({ id: b.id, price: b.price, packSize: b.packSize, multipliers: b.multipliers }))
  );

  assert.deepEqual(
    gameCatalog.ROD_UPGRADES.map(r => ({ level: r.level, price: r.price, zoneSize: r.zoneSize, maxDistBonus: r.maxDistBonus })),
    frontend.ROD_UPGRADES.map(r => ({ level: r.level, price: r.price, zoneSize: r.zoneSize, maxDistBonus: r.maxDistBonus }))
  );

  assert.deepEqual(
    gameCatalog.REEL_UPGRADES.map(r => ({ level: r.level, price: r.price, fillRate: r.fillRate, drainRate: r.drainRate })),
    frontend.REEL_UPGRADES.map(r => ({ level: r.level, price: r.price, fillRate: r.fillRate, drainRate: r.drainRate }))
  );

  assert.deepEqual(
    gameCatalog.BOATS.map(b => ({ id: b.id, price: b.price, speedBonus: b.speedBonus, luckBonus: b.luckBonus })),
    frontend.BOATS.map(b => ({ id: b.id, price: b.price, speedBonus: b.speedBonus, luckBonus: b.luckBonus }))
  );

  assert.deepEqual(
    gameCatalog.HATS.map(h => ({ id: h.id, price: h.price })),
    frontend.HATS.map(h => ({ id: h.id, price: h.price }))
  );

  assert.deepEqual(
    gameCatalog.OUTFITS.map(o => ({ id: o.id, price: o.price })),
    frontend.OUTFITS.map(o => ({ id: o.id, price: o.price }))
  );

  assert.deepEqual(
    gameCatalog.AQUARIUM_UPGRADES.map(a => ({ level: a.level, capacity: a.capacity, incomeMult: a.incomeMult, price: a.price })),
    frontend.AQUARIUM_UPGRADES.map(a => ({ level: a.level, capacity: a.capacity, incomeMult: a.incomeMult, price: a.price }))
  );

  assert.equal(gameCatalog.FISH_SPECIES.length, 20);
  assert.equal(frontend.FISH_SPECIES.length, 20);

  const sharedFishMap = Object.fromEntries(gameCatalog.FISH_SPECIES.map(f => [f.id, f]));
  for (const ff of frontend.FISH_SPECIES) {
    const sf = sharedFishMap[ff.id];
    assert.ok(sf, `shared 目录缺失鱼种: ${ff.id}`);
    for (const field of ['name', 'rarity', 'baseWeight', 'prefDepth', 'prefBiome', 'prefWeather', 'skillType', 'minLen', 'maxLen', 'minKg', 'maxKg', 'baseValue', 'difficulty']) {
      assert.equal(sf[field], ff[field], `鱼种 ${ff.id} 字段 ${field} 不一致`);
    }
  }
});
