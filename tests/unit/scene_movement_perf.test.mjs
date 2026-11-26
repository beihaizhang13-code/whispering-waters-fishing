import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');

function createMockElement(id, attrs = {}) {
  let _text = '';
  let _className = '';
  const _attrs = { ...attrs };
  const stats = { textWrites: 0, classWrites: 0, activeWrites: 0 };

  const dataset = new Proxy({}, {
    get(_target, prop) {
      return _attrs[`data-${String(prop)}`];
    },
    set(_target, prop, value) {
      const attrName = `data-${String(prop)}`;
      const strVal = String(value);
      if (prop === 'active') stats.activeWrites++;
      _attrs[attrName] = strVal;
      return true;
    },
    deleteProperty(_target, prop) {
      delete _attrs[`data-${String(prop)}`];
      return true;
    }
  });

  return {
    id,
    stats,
    dataset,
    get textContent() { return _text; },
    set textContent(v) {
      stats.textWrites++;
      _text = String(v);
    },
    get className() { return _className; },
    set className(v) {
      stats.classWrites++;
      _className = String(v);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(_attrs, name) ? _attrs[name] : null;
    },
    setAttribute(name, value) {
      if (name === 'data-active') stats.activeWrites++;
      _attrs[name] = String(value);
    },
    classList: {
      add() {},
      remove() {},
      contains: () => true
    },
    closest: () => null,
    addEventListener: () => {}
  };
}

function createTrackingCanvas(metrics) {
  const grad = { addColorStop() {} };
  const ctxState = {
    shadowBlur: 0,
    shadowColor: '',
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic'
  };

  const ctx = new Proxy(ctxState, {
    get(target, prop) {
      if (prop === 'createLinearGradient') {
        return () => {
          metrics.linearGradients++;
          return grad;
        };
      }
      if (prop === 'createRadialGradient') {
        return () => grad;
      }
      if (prop === 'measureText') return () => ({ width: 40 });
      if (prop in target) return target[prop];
      return () => {};
    },
    set(target, prop, value) {
      if (prop === 'shadowBlur' && Number(value) > 0) {
        metrics.nonZeroShadowBlur++;
      }
      target[prop] = value;
      return true;
    }
  });

  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx
  };
  return { canvas, ctx };
}

function loadSceneSandbox() {
  const metrics = {
    linearGradients: 0,
    nonZeroShadowBlur: 0,
    resizeRectCalls: 0
  };
  const { canvas } = createTrackingCanvas(metrics);

  const elementsById = {
    fishingCanvas: canvas,
    canvasWrapper: {
      getBoundingClientRect: () => {
        metrics.resizeRectCalls++;
        return { width: 960, height: 480 };
      }
    },
    boatBtnText: createMockElement('boatBtnText'),
    mobileBoatBtnText: createMockElement('mobileBoatBtnText'),
    biomeLabel: createMockElement('biomeLabel')
  };

  const jumpBtns = [0, 1, 2, 3].map(idx =>
    createMockElement(`jump_${idx}`, {
      'data-biome': String(idx),
      ...(idx === 1 ? { 'data-active': 'true' } : {})
    })
  );

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
    devicePixelRatio: 1,
    performance: { now: () => 1000 },
    addEventListener: () => {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = {
    getElementById: (id) => elementsById[id] || null,
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === '.biome-jump-btn' ? jumpBtns : []),
    addEventListener: () => {}
  };
  vm.createContext(sandbox);

  const orderedScripts = [
    'shared/game_catalog.js',
    'js/core.js',
    'js/scene_character.js',
    'js/gameplay_physics.js'
  ];
  for (const rel of orderedScripts) {
    const src = fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8');
    vm.runInContext(src, sandbox, { filename: rel });
  }

  return { WWF: sandbox.window.WWF, elementsById, jumpBtns, metrics };
}

function resetDomWriteCounts(elementsById, jumpBtns) {
  elementsById.boatBtnText.stats.textWrites = 0;
  elementsById.mobileBoatBtnText.stats.textWrites = 0;
  elementsById.biomeLabel.stats.textWrites = 0;
  for (const btn of jumpBtns) {
    btn.stats.classWrites = 0;
    btn.stats.activeWrites = 0;
  }
}

test('同生态持续移动 60 帧不触发多余 DOM textContent 与 className 写入', () => {
  const { WWF, elementsById, jumpBtns } = loadSceneSandbox();
  WWF.initScene();
  resetDomWriteCounts(elementsById, jumpBtns);

  WWF.player.worldX = 760;
  WWF.game.state = 'IDLE';
  WWF.game.moveRight = true;
  WWF.game.lastMoveDir = 1;

  for (let i = 0; i < 60; i++) {
    WWF.game.time += 1 / 60;
    WWF.updateSceneAndMovement(1 / 60);
    // 控制仍在木栈桥生态区间内 (600..1200)
    if (WWF.player.worldX > 1100) WWF.player.worldX = 760;
  }

  assert.equal(elementsById.boatBtnText.stats.textWrites, 0);
  assert.equal(elementsById.mobileBoatBtnText.stats.textWrites, 0);
  assert.equal(elementsById.biomeLabel.stats.textWrites, 0);
  for (const btn of jumpBtns) {
    assert.equal(btn.stats.classWrites, 0);
    assert.equal(btn.stats.activeWrites, 0);
  }
});

test('跨生态边界仅更新一次 biomeLabel 与 data-active，不重写 className', () => {
  const { WWF, elementsById, jumpBtns } = loadSceneSandbox();
  WWF.initScene();
  resetDomWriteCounts(elementsById, jumpBtns);

  WWF.player.worldX = 602;
  WWF.game.state = 'IDLE';
  WWF.game.moveLeft = true;
  WWF.game.lastMoveDir = -1;

  for (let i = 0; i < 40; i++) {
    WWF.game.time += 1 / 60;
    WWF.updateSceneAndMovement(1 / 60);
  }

  assert.ok(WWF.player.worldX < 600, '玩家应跨入芦苇浅滩 (< 600)');
  assert.equal(elementsById.biomeLabel.stats.textWrites, 1);
  assert.ok(elementsById.biomeLabel.textContent.includes('芦苇浅滩'));
  assert.equal(jumpBtns[0].dataset.active, 'true');
  assert.equal(jumpBtns[1].dataset.active, 'false');
  for (const btn of jumpBtns) {
    assert.equal(btn.stats.classWrites, 0);
  }
});

test('尺寸未变化时重复调用 resizeCanvas 不重绘不重置', () => {
  const { WWF, metrics } = loadSceneSandbox();
  WWF.initScene();
  const baseGradients = metrics.linearGradients;

  WWF.resizeCanvas();
  WWF.resizeCanvas();
  assert.equal(metrics.linearGradients, baseGradients);
});

test('正常移动渲染全天气/黄金鱼潮/满级钓竿均不报错且不触发 shadowBlur', () => {
  const { WWF, metrics } = loadSceneSandbox();
  WWF.initScene();
  WWF.player.rodLevel = 5;
  WWF.player.inBoat = true;
  WWF.player.equippedBoat = 'spirit_boat';
  WWF.player.worldX = 1480;
  WWF.game.state = 'IDLE';

  for (const weatherId of ['sunny', 'rain', 'storm', 'meteor']) {
    WWF.player.weatherId = weatherId;
    WWF.game.goldenTideTimer = weatherId === 'meteor' ? 30 : 0;
    WWF.game.time += 0.016;
    WWF.updateSceneAndMovement(0.016);
    WWF.renderScene();
  }

  assert.equal(metrics.nonZeroShadowBlur, 0);
});
