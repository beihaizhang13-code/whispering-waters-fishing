import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');

function createMockCanvas2dContext() {
  const grad = { addColorStop() {} };
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => grad;
      if (prop === 'measureText') return () => ({ width: 40 });
      return () => {};
    }
  });
}

function loadFrontendInSandbox() {
  const sandbox = {
    console,
    Math,
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    JSON,
    Set,
    Map,
    setTimeout,
    clearTimeout,
    performance: { now: () => 1000 }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {}
  };
  vm.createContext(sandbox);

  const orderedScripts = [
    'shared/game_catalog.js',
    'js/core.js',
    'js/fish_renderer.js',
    'js/fish_models_common.js',
    'js/fish_models_rare.js',
    'js/fish_models_epic.js',
    'js/fish_models_mythic.js',
    'js/art_audio.js',
    'js/gameplay_physics.js'
  ];

  for (const rel of orderedScripts) {
    const src = fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8');
    vm.runInContext(src, sandbox, { filename: rel });
  }

  return sandbox.window.WWF;
}

function makeSeededRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

test('全部 20 种鱼类模型的 SVG 与 Canvas 双端渲染冒烟通过', () => {
  const WWF = loadFrontendInSandbox();
  assert.equal(WWF.FISH_SPECIES.length, 20);
  const ctx = createMockCanvas2dContext();

  for (const fish of WWF.FISH_SPECIES) {
    for (const [isSil, isShiny] of [[false, false], [true, false], [false, true]]) {
      const svg = WWF.createFishSVG(fish, isSil, isShiny);
      assert.ok(typeof svg === 'string' && svg.includes('<svg') && svg.includes('</svg>'), `${fish.id} SVG 渲染异常`);
      assert.ok(svg.includes(`data-fish-id="${fish.id}"`), `${fish.id} 应命中独立物种模型`);
    }

    const drawnNormal = WWF.drawModelCanvasFish(ctx, fish, 100, 80, 24, 1, 1.5, false, { speedRatio: 1.2 });
    const drawnTurn = WWF.drawModelCanvasFish(ctx, fish, 100, 80, 24, -0.5, 2.0, true, { bodyBend: 0.25 });
    assert.equal(drawnNormal, true, `${fish.id} Canvas 正向绘制应返回 true`);
    assert.equal(drawnTurn, true, `${fish.id} Canvas 转向/闪光绘制应返回 true`);
  }
});

test('纯函数概率引擎与固定种子抽鱼具备完全可复现性', () => {
  const WWF = loadFrontendInSandbox();
  const scenarios = [
    { name: '新手浅滩', params: { baitId: 'dough', depthZone: 0, biomeIndex: 0, weatherId: 'sunny', luckPoints: 0, pityCounter: 0, equippedBoat: 'none', inBoat: false, goldenTideActive: false, nowMs: 1700000000000 } },
    { name: '深渊黄金鱼潮', params: { baitId: 'star', depthZone: 2, biomeIndex: 3, weatherId: 'meteor', luckPoints: 20, pityCounter: 10, equippedBoat: 'spirit_boat', inBoat: true, goldenTideActive: true, nowMs: 1700000000000 } }
  ];

  for (const sc of scenarios) {
    const table = WWF.computeProbabilityTable(sc.params);
    const totalProb = table.reduce((sum, entry) => sum + entry.prob, 0);
    assert.ok(Math.abs(totalProb - 1.0) < 1e-9, `${sc.name} 归一化概率之和应为 1`);

    const r1 = WWF.rollFishWithRng(sc.params, makeSeededRng(42));
    const r2 = WWF.rollFishWithRng(sc.params, makeSeededRng(42));
    assert.equal(r1.fish.id, r2.fish.id);
    assert.equal(r1.sizeFactor, r2.sizeFactor);
    assert.equal(r1.lengthCm, r2.lengthCm);
    assert.equal(r1.weightKg, r2.weightKg);
    assert.equal(r1.value, r2.value);
    assert.equal(r1.isShiny, r2.isShiny);
    assert.equal(r1.ruleVersion, '2.0.0');
    assert.ok(r1.sizeFactor >= 0 && r1.sizeFactor <= 1);
  }
});

test('共享经济常数与水族箱闪光倍率保持一致 (1.5x)', () => {
  const WWF = loadFrontendInSandbox();
  assert.equal(WWF.ECONOMY_CONSTANTS.AQUARIUM_SHINY_INCOME_MULT, 1.5);
  assert.equal(WWF.ECONOMY_CONSTANTS.SHINY_BASE_CHANCE, 0.02);
  assert.equal(WWF.ECONOMY_CONSTANTS.SHINY_MAX_CHANCE, 0.40);
});
