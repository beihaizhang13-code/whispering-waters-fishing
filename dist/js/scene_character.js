/**
 * ============================================================================
 * 《微风垂钓物语 2.0》场景、自由移动与关节化人物模型 (js/scene_character.js)
 * ============================================================================
 * 负责维护：
 * 1. 三种昼夜天色 (晨曦 / 落日 / 星夜) 与自适应 DPR 画布管理
 * 2. 2400px 横向四生态大地图 (芦苇浅滩 / 微风木栈桥 / 翡翠湖心岛 / 星渊沉船湾)
 * 3. 角色自由移动、自动/手动乘船切换、平滑相机跟随、生态区快速传送
 * 4. 4 层视差风景渲染、动态天气粒子 (晴空/烟雨/雷暴闪电/流星极光/黄金鱼潮)
 * 5. 关节化 2D 垂钓者模型、4 套服饰 + 4 款头饰纸娃娃换装、双船只与五阶进化鱼竿
 */
(function () {
    'use strict';

    const WWF = window.WWF = window.WWF || {};

    // ------------------------------------------------------------------------
    // 1. 三种昼夜天色主题配置 (WWF.THEMES) & 画布状态
    // ------------------------------------------------------------------------
    WWF.THEMES = [
        {
            id: 'dawn',
            name: '晨曦微光',
            icon: '🌤️',
            skyTop: '#0f2942',
            skyMid: '#38bdf8',
            skyBottom: '#fde68a',
            sunColor: '#fffbeb',
            sunGlow: 'rgba(253, 224, 71, 0.38)',
            sunYRatio: 0.22,
            mountainFar: '#335c81',
            mountainMid: '#1e3f5a',
            mountainNear: '#132a3e',
            waterTop: '#0284c7',
            waterMid: '#0369a1',
            waterDeep: '#082f49',
            reflection: 'rgba(254, 240, 138, 0.28)',
            cloudColor: 'rgba(255, 255, 255, 0.72)',
            isNight: false
        },
        {
            id: 'sunset',
            name: '橘霞落日',
            icon: '🌅',
            skyTop: '#1e1b4b',
            skyMid: '#c2410c',
            skyBottom: '#fbbf24',
            sunColor: '#fef08a',
            sunGlow: 'rgba(251, 146, 60, 0.45)',
            sunYRatio: 0.34,
            mountainFar: '#4c1d95',
            mountainMid: '#311042',
            mountainNear: '#1f092b',
            waterTop: '#9a3412',
            waterMid: '#431407',
            waterDeep: '#0f172a',
            reflection: 'rgba(251, 191, 36, 0.35)',
            cloudColor: 'rgba(254, 215, 170, 0.65)',
            isNight: false
        },
        {
            id: 'night',
            name: '星夜流萤',
            icon: '🌙',
            skyTop: '#020617',
            skyMid: '#0f172a',
            skyBottom: '#1e293b',
            sunColor: '#f8fafc',
            sunGlow: 'rgba(148, 163, 184, 0.26)',
            sunYRatio: 0.18,
            mountainFar: '#1e293b',
            mountainMid: '#0f172a',
            mountainNear: '#020617',
            waterTop: '#0f172a',
            waterMid: '#091024',
            waterDeep: '#020617',
            reflection: 'rgba(125, 211, 252, 0.22)',
            cloudColor: 'rgba(148, 163, 184, 0.24)',
            isNight: true
        }
    ];

    WWF.cw = 960;
    WWF.ch = 500;
    WWF.dpr = 1;
    WWF.canvas = null;
    WWF.ctx = null;

    // ------------------------------------------------------------------------
    // 内部场景粒子池与环境对象
    // ------------------------------------------------------------------------
    const scenePool = {
        clouds: [],
        stars: [],
        ambientFishes: [],
        ripples: [],
        splashes: [],
        raindrops: [],
        meteors: [],
        goldenBubbles: [],
        fireflies: [],
        petals: [],
        lightningAlpha: 0,
        lightningBolt: null,
        nextLightningTimer: 4.5,
        nextMeteorTimer: 0.6,
        boatRippleTimer: 0,
        rainRippleTimer: 0,
        goldenBubbleTimer: 0,
        boundaryWarnCooldown: 0,
        lastBiomeId: null,
        lastInBoat: null,
        domCache: null,
        renderCache: {
            key: '',
            skyGrad: null,
            waterKey: '',
            waterGrad: null,
            terrainWaterY: -1,
            sandGrad: null,
            grassGrad: null
        },
        dustPuffs: [],
        lastRodTipX: null
    };

    function clamp(v, min, max) {
        return v < min ? min : (v > max ? max : v);
    }

    function expSmoothFactor(rate, dt) {
        return 1 - Math.exp(-rate * Math.max(0, dt || 0));
    }

    /**
     * 子步进二阶弹簧积分器，确保高刚度弹簧在任意帧率下稳定收敛
     */
    function stepSpring(val, vel, target, k, c, dt) {
        const totalDt = Math.max(0, dt || 0);
        if (totalDt <= 0) return { val, vel };
        const steps = Math.min(5, Math.max(1, Math.ceil(totalDt / 0.012)));
        const h = totalDt / steps;
        let x = val;
        let v = vel;
        for (let i = 0; i < steps; i++) {
            const acc = (target - x) * k - v * c;
            v += acc * h;
            x += v * h;
        }
        return { val: x, vel: v };
    }

    /**
     * 急停/转身时在脚下生成轻盈的沙尘或木屑微粒
     */
    function addTurnDust(worldX, y, pushDir, onPier) {
        const count = 4;
        const baseColor = onPier ? 'rgba(254, 243, 199, 0.72)' : 'rgba(226, 232, 240, 0.65)';
        for (let i = 0; i < count; i++) {
            const spread = (Math.random() - 0.5) * 8;
            scenePool.dustPuffs.push({
                worldX: worldX + spread,
                y: y - Math.random() * 3,
                vx: pushDir * (22 + Math.random() * 32) + (Math.random() - 0.5) * 14,
                vy: -(16 + Math.random() * 26),
                r: 2.0 + Math.random() * 2.2,
                alpha: 0.78,
                color: onPier && i === 0 ? 'rgba(251, 191, 36, 0.65)' : baseColor
            });
        }
    }

    // 鱼竿外观配色表 (随 player.rodLevel 1~5+ 进化)
    const ROD_VISUALS = [
        { shaft: '#a16207', tip: '#eab308', handle: '#451a03', glow: null },                 // Lv.1 原木钓竿
        { shaft: '#15803d', tip: '#4ade80', handle: '#14532d', glow: null },                 // Lv.2 翠竹韧竿
        { shaft: '#0284c7', tip: '#38bdf8', handle: '#0f172a', glow: 'rgba(56,189,248,0.3)' }, // Lv.3 碳纤流光竿
        { shaft: '#7c3aed', tip: '#c084fc', handle: '#1e1b4b', glow: 'rgba(192,132,252,0.4)' }, // Lv.4 钛金深渊竿
        { shaft: '#f59e0b', tip: '#fef08a', handle: '#451a03', glow: 'rgba(250,204,21,0.55)' }  // Lv.5 星辰宗师竿
    ];

    // ------------------------------------------------------------------------
    // 2. 场景辅助与粒子接口
    // ------------------------------------------------------------------------

    /**
     * 返回当前画布水面 Y 坐标
     */
    WWF.getWaterSurfaceY = function () {
        return WWF.ch * 0.50;
    };

    /**
     * 计算角色在给定世界 X 坐标处的脚底基准 Y 坐标
     */
    function getCharacterFootY(worldX, inBoat) {
        const waterY = WWF.getWaterSurfaceY();
        const t = (WWF.game && WWF.game.time) || 0;
        if (inBoat) {
            const bob = Math.sin(t * 2.6 + worldX * 0.02) * 2.5;
            return waterY + 3 + bob;
        }
        // 0..460 为倾斜暖沙草坡，460..1185 平滑衔接至木栈桥桥面 (waterY - 18)
        if (worldX < 460) {
            const ratio = Math.max(0, Math.min(1, worldX / 460));
            return (waterY - 26) + ratio * 8;
        }
        return waterY - 18;
    }

    /**
     * 获取当前已装备船只的移速加成
     */
    function getEquippedBoatSpeedBonus() {
        const player = WWF.player;
        if (!player || !player.inBoat) return 1.0;
        const boatId = player.equippedBoat || 'rowboat';
        if (WWF.BOATS) {
            if (Array.isArray(WWF.BOATS)) {
                const found = WWF.BOATS.find(b => b.id === boatId);
                if (found && found.speedBonus) return found.speedBonus;
            } else if (WWF.BOATS[boatId] && WWF.BOATS[boatId].speedBonus) {
                return WWF.BOATS[boatId].speedBonus;
            }
        }
        if (boatId === 'spirit_boat') return 1.45;
        if (boatId === 'rowboat') return 1.18;
        return 1.0;
    }

    /**
     * 自适应高分屏 DPR 并更新画布尺寸
     */
    WWF.resizeCanvas = function () {
        const canvas = WWF.canvas || document.getElementById('fishingCanvas');
        const wrapper = document.getElementById('canvasWrapper');
        if (!canvas || !wrapper) return;

        const rect = wrapper.getBoundingClientRect();
        const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
        const nextCw = Math.max(320, Math.floor(rect.width || 960));
        const nextCh = Math.max(260, Math.floor(rect.height || 480));
        const nextW = Math.floor(nextCw * nextDpr);
        const nextH = Math.floor(nextCh * nextDpr);

        if (
            WWF.canvas === canvas &&
            WWF.ctx &&
            canvas.width === nextW &&
            canvas.height === nextH &&
            WWF.cw === nextCw &&
            WWF.ch === nextCh &&
            WWF.dpr === nextDpr
        ) {
            return;
        }

        WWF.canvas = canvas;
        WWF.ctx = canvas.getContext('2d');
        WWF.dpr = nextDpr;
        WWF.cw = nextCw;
        WWF.ch = nextCh;

        canvas.width = nextW;
        canvas.height = nextH;
        WWF.ctx.setTransform(WWF.dpr, 0, 0, WWF.dpr, 0, 0);

        scenePool.renderCache.key = '';
        scenePool.renderCache.waterKey = '';
        scenePool.renderCache.terrainWaterY = -1;

        // 约束相机在合法范围内
        if (WWF.game) {
            const maxCam = Math.max(0, WWF.WORLD_WIDTH - WWF.cw);
            WWF.game.cameraX = Math.max(0, Math.min(maxCam, WWF.game.cameraX || 0));
        }
        if (typeof WWF.renderScene === 'function') {
            WWF.renderScene();
        }
    };

    /**
     * 初始化场景粒子池与监听事件
     */
    WWF.initScene = function () {
        WWF.canvas = document.getElementById('fishingCanvas');
        if (!WWF.canvas) return;
        WWF.ctx = WWF.canvas.getContext('2d');

        WWF.resizeCanvas();
        window.addEventListener('resize', WWF.resizeCanvas);
        window.addEventListener('orientationchange', () => {
            setTimeout(WWF.resizeCanvas, 120);
        });
        const wrapper = document.getElementById('canvasWrapper');
        if (wrapper && typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(() => WWF.resizeCanvas());
            ro.observe(wrapper);
        }

        // 1. 初始化云朵 (分布在视差世界宽度内)
        scenePool.clouds = [];
        for (let i = 0; i < 12; i++) {
            scenePool.clouds.push({
                x: Math.random() * 1800,
                yRatio: 0.06 + Math.random() * 0.24,
                w: 68 + Math.random() * 85,
                h: 20 + Math.random() * 16,
                speed: 7 + Math.random() * 12,
                opacity: 0.35 + Math.random() * 0.4
            });
        }

        // 2. 初始化夜空繁星
        scenePool.stars = [];
        for (let i = 0; i < 95; i++) {
            scenePool.stars.push({
                xRatio: Math.random(),
                yRatio: 0.02 + Math.random() * 0.42,
                r: 0.7 + Math.random() * 1.7,
                phase: Math.random() * Math.PI * 2,
                speed: 1.5 + Math.random() * 2.5
            });
        }

        // 3. 初始化水下环境鱼影 (分布在 0..2400 四大生态区)
        scenePool.ambientFishes = [];
        const colorsByBiome = [
            'rgba(16, 185, 129, 0.22)',
            'rgba(14, 165, 233, 0.22)',
            'rgba(34, 211, 238, 0.24)',
            'rgba(129, 140, 248, 0.26)'
        ];
        for (let i = 0; i < 24; i++) {
            const worldX = 60 + Math.random() * (WWF.WORLD_WIDTH - 120);
            const biomeIdx = Math.min(3, Math.floor(worldX / 600));
            const speed = (14 + Math.random() * 24) * (Math.random() < 0.5 ? 1 : -1);
            scenePool.ambientFishes.push({
                worldX: worldX,
                depthRatio: 0.14 + Math.random() * 0.74,
                size: 9 + Math.random() * 14 + biomeIdx * 2.5,
                speed: speed,
                visualDir: speed >= 0 ? 1 : -1,
                phase: Math.random() * Math.PI * 2,
                biomeIndex: biomeIdx,
                tint: colorsByBiome[biomeIdx]
            });
        }

        // 4. 初始化雨滴粒子池
        scenePool.raindrops = [];
        for (let i = 0; i < 110; i++) {
            scenePool.raindrops.push({
                x: Math.random() * (WWF.cw + 200),
                y: Math.random() * WWF.ch,
                len: 12 + Math.random() * 14,
                speed: 420 + Math.random() * 240,
                alpha: 0.25 + Math.random() * 0.45
            });
        }

        // 5. 初始化萤火虫与湖心岛樱花瓣
        scenePool.fireflies = [];
        for (let i = 0; i < 28; i++) {
            scenePool.fireflies.push({
                worldX: Math.random() * WWF.WORLD_WIDTH,
                yOffset: -60 + Math.random() * 75,
                phase: Math.random() * Math.PI * 2,
                speedX: -8 + Math.random() * 16,
                color: i % 3 === 0 ? '#38bdf8' : '#fde047'
            });
        }

        scenePool.petals = [];
        for (let i = 0; i < 22; i++) {
            scenePool.petals.push({
                worldX: 1320 + Math.random() * 420,
                yOffset: -110 + Math.random() * 120,
                vx: -14 - Math.random() * 18,
                vy: 15 + Math.random() * 18,
                phase: Math.random() * Math.PI * 2,
                size: 2.5 + Math.random() * 2.2
            });
        }

        // 初始化相机对准玩家
        if (WWF.player && WWF.game) {
            const game = WWF.game;
            game.facing = 1;
            game.visualFacing = 1;
            game.visualFacingVel = 0;
            game.boatFacing = 1;
            game.boatFacingVel = 0;
            game.rodFacing = 1;
            game.rodFacingVel = 0;
            game.boatPitch = 0;
            game.boatPitchVel = 0;
            game.bodyLean = 0;
            game.turnBounce = 0;
            game.moveBlend = 0;
            game.idleBobberSwingX = 0;
            game.idleBobberSwingVx = 0;
            scenePool.lastRodTipX = null;

            const initAhead = WWF.cw * (WWF.cw < 580 ? 0.10 : 0.085);
            game.cameraLookAhead = initAhead;
            game.cameraLookAheadVel = 0;
            game.facingHoldTime = 1;
            game.facingTravelDist = 100;
            const maxCam = Math.max(0, WWF.WORLD_WIDTH - WWF.cw);
            game.cameraX = Math.max(0, Math.min(maxCam, WWF.player.worldX + initAhead - WWF.cw * 0.5));
        }

        syncBiomeBadgeUI(true);
    };

    /**
     * 在世界坐标 worldX 处添加水面涟漪
     */
    WWF.addRipple = function (worldX, y, maxR, color) {
        const waterY = typeof y === 'number' ? y : WWF.getWaterSurfaceY() + 6;
        scenePool.ripples.push({
            worldX: worldX,
            y: waterY,
            r: 2,
            maxR: maxR || 28,
            alpha: 0.82,
            color: color || '255, 255, 255'
        });
    };

    /**
     * 在世界坐标 worldX 处添加水花飞溅粒子
     */
    WWF.addSplash = function (worldX, y, count, power) {
        const waterY = typeof y === 'number' ? y : WWF.getWaterSurfaceY();
        const num = count || 12;
        const p = power || 1;
        for (let i = 0; i < num; i++) {
            const angle = -Math.PI * (0.15 + Math.random() * 0.70);
            const speed = (65 + Math.random() * 145) * p;
            scenePool.splashes.push({
                worldX: worldX + (Math.random() - 0.5) * 10,
                y: waterY,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                r: 1.6 + Math.random() * 2.4,
                alpha: 1,
                color: (WWF.game && WWF.game.goldenTideTimer > 0 && Math.random() < 0.45)
                    ? '#fde047'
                    : '#e0f2fe'
            });
        }
    };

    /**
     * 计算并返回鱼竿握把与竿尖的世界坐标 { baseX, baseY, tipX, tipY }
     */
    WWF.getRodTip = function () {
        const player = WWF.player || { worldX: 760, inBoat: false };
        const game = WWF.game || { state: 'IDLE', facing: 1, time: 0, chargePower: 0 };
        const dir = game.facing === -1 ? -1 : 1;
        const vf = clamp(typeof game.visualFacing === 'number' ? game.visualFacing : dir, -1, 1);
        const rf = clamp(typeof game.rodFacing === 'number' ? game.rodFacing : dir, -1.08, 1.08);
        const rfClamped = clamp(rf, -1, 1);
        const turnArch = 1 - Math.abs(rfClamped);

        const turnBouncePx = !player.inBoat ? Math.sin((game.turnBounce || 0) * Math.PI) * 3.0 : 0;
        const boatTurnBob = player.inBoat ? (1 - Math.abs(typeof game.boatFacing === 'number' ? game.boatFacing : dir)) * 1.5 : 0;
        const footY = getCharacterFootY(player.worldX, player.inBoat) - turnBouncePx + boatTurnBob;

        const leanSin = Math.sin(game.bodyLean || 0);
        const pitchShiftX = player.inBoat ? Math.sin((game.boatPitch || 0) * 0.65) * 30 : 0;

        // 握把世界坐标
        const baseX = player.worldX + vf * 11 + leanSin * 14 + pitchShiftX;
        const baseY = footY - 31 + Math.abs(leanSin) * 1.5;

        // 根据垂钓状态决定鱼竿仰角与长度
        let angleOffset = -0.58; // 默认自然前倾持竿 (相对于水平方向向上)
        const rodLen = 68;

        if (game.state === 'CHARGING') {
            // 向后仰蓄力
            angleOffset = -1.22 - (game.chargePower || 0) * 0.62;
        } else if (game.state === 'CASTING') {
            // 向前挥竿
            angleOffset = -0.32;
        } else if (game.state === 'WAITING') {
            // 静候浮漂微幅呼吸
            angleOffset = -0.48 + Math.sin((game.time || 0) * 2.2) * 0.025;
        } else if (game.state === 'BITING') {
            // 咬钩抖动下压
            angleOffset = -0.34 + Math.sin((game.time || 0) * 32) * 0.07;
        } else if (game.state === 'REELING') {
            // 遛鱼高举弯曲博弈
            const pull = game.isHolding ? 0.20 : -0.05;
            const skillShake = game.fishSkillState === 'dash' ? Math.sin((game.time || 0) * 40) * 0.06 : 0;
            angleOffset = -0.82 - pull + skillShake;
        } else if (game.state === 'LEAPING' || game.state === 'RESULT') {
            // 起鱼高举庆祝
            angleOffset = -1.05;
        } else if (game.pose === 'row') {
            // 划船时鱼竿斜靠肩后
            angleOffset = -0.75;
        }

        const liftAngle = -Math.PI * 0.5;
        const archedAngle = angleOffset + (liftAngle - angleOffset) * (turnArch * 0.68);
        const rodTipFlex = (rf - rfClamped) * 16;
        const tipX = baseX + rfClamped * Math.cos(archedAngle) * rodLen + rodTipFlex;
        let tipY = baseY + Math.sin(archedAngle) * rodLen - turnArch * 6;

        // 遛鱼或咬钩时受鱼线拉力产生竿尖下弯
        if (game.state === 'REELING') {
            tipY += 9 + (game.reelTension || 0) * 13;
        } else if (game.state === 'BITING') {
            tipY += 8;
        }

        return { baseX, baseY, tipX, tipY };
    };

    // ------------------------------------------------------------------------
    // 3. 自由移动、乘船边界、相机跟随与动态天气更新
    // ------------------------------------------------------------------------

    /**
     * 同步左上角生态区徽章、乘船按钮文案与生态传送按钮高亮
     */
    function syncBiomeBadgeUI(force) {
        if (!WWF.player || !WWF.getCurrentBiome) return;
        const biome = WWF.getCurrentBiome();
        if (force || !scenePool.domCache) {
            scenePool.domCache = {
                boatBtnText: document.getElementById('boatBtnText'),
                mobileBoatBtnText: document.getElementById('mobileBoatBtnText'),
                biomeLabel: document.getElementById('biomeLabel'),
                jumpBtns: Array.from(document.querySelectorAll('.biome-jump-btn'))
            };
        }
        const dom = scenePool.domCache;
        const inBoat = Boolean(WWF.player.inBoat);

        if (force || scenePool.lastInBoat !== inBoat) {
            scenePool.lastInBoat = inBoat;
            const desktopBoatStr = inBoat ? '靠岸下船' : '乘船探索';
            if (dom.boatBtnText && dom.boatBtnText.textContent !== desktopBoatStr) {
                dom.boatBtnText.textContent = desktopBoatStr;
            }
            const mobileBoatStr = inBoat ? '靠岸' : '乘船';
            if (dom.mobileBoatBtnText && dom.mobileBoatBtnText.textContent !== mobileBoatStr) {
                dom.mobileBoatBtnText.textContent = mobileBoatStr;
            }
        }

        if (!biome) return;
        if (!force && scenePool.lastBiomeId === biome.id) return;
        scenePool.lastBiomeId = biome.id;

        if (dom.biomeLabel) {
            const depthDesc = biome.baseDepthBonus === 0
                ? '浅水草滩'
                : (biome.baseDepthBonus === 1 ? '水深适中' : '远古深渊');
            const labelStr = `${biome.name} (${depthDesc})`;
            if (dom.biomeLabel.textContent !== labelStr) {
                dom.biomeLabel.textContent = labelStr;
            }
        }

        const btns = dom.jumpBtns;
        for (let i = 0; i < btns.length; i++) {
            const btn = btns[i];
            const idx = Number(btn.getAttribute('data-biome'));
            const activeVal = idx === biome.index ? 'true' : 'false';
            if (btn.dataset) {
                if (btn.dataset.active !== activeVal) btn.dataset.active = activeVal;
            } else if (typeof btn.setAttribute === 'function') {
                btn.setAttribute('data-active', activeVal);
            }
        }

        if (WWF.updateOddsPreview) {
            WWF.updateOddsPreview();
        }
    }

    /**
     * 判断玩家是否已解锁任意船只
     */
    function hasUnlockedAnyBoat() {
        const p = WWF.player;
        if (!p || !Array.isArray(p.unlockedBoats)) return false;
        return p.unlockedBoats.some(id => id && id !== 'none');
    }

    /**
     * 确保装备一艘已解锁的船只
     */
    function ensureEquippedBoat() {
        const p = WWF.player;
        if (!p || !Array.isArray(p.unlockedBoats)) return;
        if (!p.equippedBoat || p.equippedBoat === 'none' || !p.unlockedBoats.includes(p.equippedBoat)) {
            if (p.unlockedBoats.includes('spirit_boat')) {
                p.equippedBoat = 'spirit_boat';
            } else if (p.unlockedBoats.includes('rowboat')) {
                p.equippedBoat = 'rowboat';
            } else {
                const valid = p.unlockedBoats.find(b => b !== 'none');
                if (valid) p.equippedBoat = valid;
            }
        }
    }

    /**
     * 每帧更新：角色移动、乘船过渡、平滑相机、天气与环境粒子
     */
    WWF.updateSceneAndMovement = function (dt) {
        const player = WWF.player;
        const game = WWF.game;
        if (!player || !game) return;

        const safeDt = Math.min(dt || 0.016, 0.1);
        const waterY = WWF.getWaterSurfaceY();
        const prevFacing = game.facing === -1 ? -1 : 1;
        const prevVx = game.vx || 0;
        const speedBonus = getEquippedBoatSpeedBonus();
        const maxSpeed = 185 * speedBonus;

        if (scenePool.boundaryWarnCooldown > 0) {
            scenePool.boundaryWarnCooldown = Math.max(0, scenePool.boundaryWarnCooldown - safeDt);
        }

        // 1. 自由移动、SOCD 转向制动、加减速惯性与陆地/深水海域边界处理
        if (game.state === 'IDLE') {
            let moveDir = 0;
            if (game.moveLeft && game.moveRight) {
                moveDir = game.lastMoveDir || 0;
            } else if (game.moveLeft) {
                moveDir = -1;
            } else if (game.moveRight) {
                moveDir = 1;
            }

            const targetVx = moveDir * maxSpeed;
            const isReversing = moveDir !== 0 && prevVx * moveDir < -14;
            let rate;
            if (player.inBoat) {
                rate = moveDir === 0
                    ? 390 * speedBonus
                    : (isReversing ? 860 * speedBonus : 540 * speedBonus);
            } else {
                rate = moveDir === 0
                    ? 1850
                    : (isReversing ? 2700 : 1700);
            }

            if (game.vx < targetVx) {
                game.vx = Math.min(targetVx, game.vx + rate * safeDt);
            } else if (game.vx > targetVx) {
                game.vx = Math.max(targetVx, game.vx - rate * safeDt);
            }

            if (moveDir !== 0) {
                game.facing = moveDir;
                game.pose = player.inBoat ? 'row' : 'walk';
            } else {
                game.pose = Math.abs(game.vx) > 22 ? (player.inBoat ? 'row' : 'walk') : 'idle';
            }

            const speedRatio = clamp(Math.abs(game.vx) / Math.max(1, maxSpeed), 0, 1);
            if (Math.abs(game.vx) > 0.5) {
                const oldX = player.worldX;
                let nextX = oldX + game.vx * safeDt;

                // 左边界约束 (若在船上，浅滩最左到 120；步行最左到 48)
                const minWorldX = player.inBoat ? 120 : 48;
                const maxWorldX = WWF.WORLD_WIDTH - 55;
                if (nextX <= minWorldX) {
                    nextX = minWorldX;
                    if (game.vx < 0) game.vx = 0;
                } else if (nextX >= maxWorldX) {
                    nextX = maxWorldX;
                    if (game.vx > 0) game.vx = 0;
                }

                // 陆地与外海深水区边界 (x > 1160 为深水外海)
                if (!player.inBoat && nextX > 1160) {
                    if (hasUnlockedAnyBoat()) {
                        player.inBoat = true;
                        ensureEquippedBoat();
                        game.boatFacing = typeof game.visualFacing === 'number' ? game.visualFacing : game.facing;
                        game.boatFacingVel = 0;
                        game.pose = 'row';
                        WWF.addSplash(nextX, waterY + 4, 10, 0.85);
                        WWF.addRipple(nextX, waterY + 5, 36, '125, 211, 252');
                        if (WWF.Sound && WWF.Sound.playPlop) WWF.Sound.playPlop();
                        if (WWF.showToast) WWF.showToast('🚣 已登船驶向外海！', 'info');
                        syncBiomeBadgeUI(true);
                    } else {
                        nextX = 1160;
                        if (game.vx > 0) game.vx = 0;
                        if (scenePool.boundaryWarnCooldown <= 0) {
                            scenePool.boundaryWarnCooldown = 2.4;
                            if (WWF.showToast) {
                                WWF.showToast('⚓ 前方是深水外海，请先在【商店&换装】解锁橡木小艇！', 'warn');
                            }
                        }
                    }
                }

                player.worldX = nextX;
                const movedDist = Math.abs(nextX - oldX);
                if (player.inBoat) {
                    game.walkCycle += safeDt * (moveDir !== 0 ? 6.8 * speedBonus : 2.2 * speedRatio);
                } else {
                    game.walkCycle += movedDist * 0.052;
                }

                // 划船时船尾生成水波尾迹与轻柔桨声
                scenePool.boatRippleTimer -= safeDt;
                if (player.inBoat && Math.abs(game.vx) > 28 && scenePool.boatRippleTimer <= 0) {
                    scenePool.boatRippleTimer = 0.22;
                    const sternSign = (typeof game.boatFacing === 'number' ? game.boatFacing : game.facing) >= 0 ? -1 : 1;
                    WWF.addRipple(player.worldX + sternSign * 24, waterY + 6, 26, '186, 230, 253');
                }
                if (player.inBoat && moveDir !== 0 && WWF.Sound && WWF.Sound.playRow) {
                    WWF.Sound.playRow();
                }
            } else {
                game.vx = 0;
            }

            const targetBlend = clamp(Math.abs(game.vx) / Math.max(1, maxSpeed * 0.72), 0, 1);
            game.moveBlend = (game.moveBlend || 0) + (targetBlend - (game.moveBlend || 0)) * expSmoothFactor(12, safeDt);
        } else {
            game.vx = 0;
            game.moveBlend = Math.max(0, (game.moveBlend || 0) - safeDt * 10);
            const poseMap = {
                CHARGING: 'charge',
                CASTING: 'cast',
                WAITING: 'wait',
                BITING: 'bite',
                REELING: 'reel',
                LEAPING: 'celebrate',
                RESULT: 'celebrate'
            };
            game.pose = poseMap[game.state] || 'idle';
        }

        // 1.5 转向瞬间触发手感反馈 (微跳/船体倾侧/转弯浪花/脚底微尘/柔和音效)
        if (prevFacing !== game.facing) {
            game.facingHoldTime = 0;
            game.facingTravelDist = 0;
            game.turnBounce = 1.0;

            if (player.inBoat) {
                game.boatPitchVel = (game.boatPitchVel || 0) + game.facing * (0.42 + Math.min(0.45, Math.abs(prevVx) / 280));
                WWF.addRipple(player.worldX + game.facing * 18, waterY + 6, 30, '186, 230, 253');
                WWF.addSplash(player.worldX + game.facing * 20, waterY + 4, 4, 0.45);
                if (WWF.Sound && WWF.Sound.playTurn) WWF.Sound.playTurn(true);
            } else if (Math.abs(prevVx) > 75) {
                const footY = getCharacterFootY(player.worldX, false);
                addTurnDust(player.worldX, footY - 1, prevFacing, player.worldX >= 575);
                if (WWF.Sound && WWF.Sound.playTurn) WWF.Sound.playTurn(false);
            }
        }

        // 1.6 2.5D 转身弹簧、船体纵倾、身体连续前倾角 & 闲置浮漂摆锤更新
        game.turnBounce = Math.max(0, (game.turnBounce || 0) - safeDt * 5.2);

        const vfStiff = game.state !== 'IDLE' ? 420 : (player.inBoat ? 175 : 230);
        const vfDamp = game.state !== 'IDLE' ? 41 : (player.inBoat ? 26.4 : 30.3);
        const vfRes = stepSpring(
            typeof game.visualFacing === 'number' ? game.visualFacing : game.facing,
            game.visualFacingVel || 0,
            game.facing,
            vfStiff,
            vfDamp,
            safeDt
        );
        game.visualFacing = clamp(vfRes.val, -1, 1);
        game.visualFacingVel = vfRes.vel;

        if (player.inBoat) {
            const bfStiff = game.state !== 'IDLE' ? 180 : 68;
            const bfDamp = game.state !== 'IDLE' ? 26.8 : 15.8;
            const bfRes = stepSpring(
                typeof game.boatFacing === 'number' ? game.boatFacing : game.facing,
                game.boatFacingVel || 0,
                game.facing,
                bfStiff,
                bfDamp,
                safeDt
            );
            game.boatFacing = clamp(bfRes.val, -1, 1);
            game.boatFacingVel = bfRes.vel;
        } else {
            game.boatFacing = game.visualFacing;
            game.boatFacingVel = 0;
        }

        const rfStiff = game.state !== 'IDLE' ? 420 : 135;
        const rfDamp = game.state !== 'IDLE' ? 41 : 19.5;
        const rfRes = stepSpring(
            typeof game.rodFacing === 'number' ? game.rodFacing : game.facing,
            game.rodFacingVel || 0,
            game.facing,
            rfStiff,
            rfDamp,
            safeDt
        );
        game.rodFacing = clamp(rfRes.val, -1.08, 1.08);
        game.rodFacingVel = rfRes.vel;

        if (player.inBoat) {
            const bfDir = (game.boatFacing || game.facing) >= 0 ? 1 : -1;
            const waveRock = Math.cos((game.time || 0) * 2.6 + player.worldX * 0.02) * 0.024;
            const bowLift = -bfDir * (Math.abs(game.vx || 0) / Math.max(1, maxSpeed)) * 0.032;
            const pitchRes = stepSpring(
                game.boatPitch || 0,
                game.boatPitchVel || 0,
                waveRock + bowLift,
                42,
                7.2,
                safeDt
            );
            game.boatPitch = clamp(pitchRes.val, -0.14, 0.14);
            game.boatPitchVel = pitchRes.vel;
        } else {
            game.boatPitch = 0;
            game.boatPitchVel = 0;
        }

        const vfVal = game.visualFacing;
        let targetLean = 0;
        if (game.state === 'CHARGING') {
            targetLean = -vfVal * (0.18 + (game.chargePower || 0) * 0.16);
        } else if (game.state === 'REELING') {
            targetLean = -vfVal * (game.isHolding ? 0.22 : 0.08);
        } else if (game.state === 'CASTING') {
            targetLean = vfVal * 0.14;
        } else if (game.state === 'IDLE') {
            if (player.inBoat) {
                targetLean = vfVal * Math.sin(game.walkCycle) * 0.10 * (game.moveBlend || 0);
            } else {
                const moveDirNow = (game.moveLeft && game.moveRight)
                    ? (game.lastMoveDir || 0)
                    : (game.moveRight ? 1 : (game.moveLeft ? -1 : 0));
                const reversingNow = moveDirNow !== 0 && (game.vx || 0) * moveDirNow < -14;
                targetLean = ((game.vx || 0) / Math.max(1, maxSpeed)) * 0.075 + (reversingNow ? moveDirNow * 0.065 : 0);
            }
        }
        game.bodyLean = (game.bodyLean || 0) + (targetLean - (game.bodyLean || 0)) * expSmoothFactor(12, safeDt);

        if (typeof WWF.getRodTip === 'function') {
            const tip = WWF.getRodTip();
            if (scenePool.lastRodTipX !== null && Math.abs(tip.tipX - scenePool.lastRodTipX) < 120) {
                game.idleBobberSwingX = (game.idleBobberSwingX || 0) - (tip.tipX - scenePool.lastRodTipX) * 0.72;
            }
            scenePool.lastRodTipX = tip.tipX;
        }
        const bobRes = stepSpring(
            game.idleBobberSwingX || 0,
            game.idleBobberSwingVx || 0,
            0,
            58,
            6.2,
            safeDt
        );
        game.idleBobberSwingX = clamp(bobRes.val, -26, 26);
        game.idleBobberSwingVx = bobRes.vel;

        // 实时同步生态区 UI
        syncBiomeBadgeUI(false);

        // 2. 平滑无甩尾前瞻相机跟随 (轻点转身死区抑制 + 速度上限前瞻平滑)
        const maxCameraX = Math.max(0, WWF.WORLD_WIDTH - WWF.cw);
        const isNarrow = WWF.cw < 580;
        const idleAheadMag = WWF.cw * (isNarrow ? 0.10 : 0.085);
        const chargeAheadMag = WWF.cw * (isNarrow ? 0.22 : 0.165);

        if (game.state === 'IDLE') {
            game.facingHoldTime = (game.facingHoldTime || 0) + safeDt;
            if ((game.vx || 0) * game.facing > 12) {
                game.facingTravelDist = (game.facingTravelDist || 0) + Math.abs(game.vx) * safeDt;
            }
        }

        let targetLookAhead = game.facing * idleAheadMag;
        if (game.state === 'CHARGING') {
            targetLookAhead = game.facing * chargeAheadMag;
        } else if (game.state === 'IDLE') {
            if ((game.facingTravelDist || 0) < 22 && (game.facingHoldTime || 0) < 0.22) {
                targetLookAhead = typeof game.cameraLookAhead === 'number' ? game.cameraLookAhead : game.facing * idleAheadMag;
            } else {
                targetLookAhead = game.facing * idleAheadMag;
            }
        }

        let maxLookSpeed;
        let lookGain;
        if (game.state === 'CHARGING') {
            maxLookSpeed = Math.max(260, WWF.cw * 0.42);
            lookGain = 4.8;
        } else if (game.state === 'IDLE' && Math.abs(game.vx || 0) > 25) {
            maxLookSpeed = Math.min(Math.abs(game.vx) * 0.68 + 38, WWF.cw * 0.24);
            lookGain = 2.6;
        } else {
            maxLookSpeed = Math.min(130, WWF.cw * 0.18);
            lookGain = 2.6;
        }

        const rawLookVel = clamp((targetLookAhead - (game.cameraLookAhead || 0)) * lookGain, -maxLookSpeed, maxLookSpeed);
        game.cameraLookAheadVel = (game.cameraLookAheadVel || 0) + (rawLookVel - (game.cameraLookAheadVel || 0)) * expSmoothFactor(7.0, safeDt);
        game.cameraLookAhead = (game.cameraLookAhead || 0) + game.cameraLookAheadVel * safeDt;

        let targetCameraX;
        if (game.state === 'WAITING' || game.state === 'BITING' || game.state === 'REELING' || game.state === 'LEAPING') {
            const midFocusX = player.worldX * 0.48 + (game.bobberX || player.worldX) * 0.52;
            targetCameraX = midFocusX - WWF.cw * (isNarrow ? 0.48 : 0.42);
        } else {
            targetCameraX = player.worldX + game.cameraLookAhead - WWF.cw * 0.5;
        }
        targetCameraX = Math.max(0, Math.min(maxCameraX, targetCameraX));
        game.cameraX += (targetCameraX - game.cameraX) * expSmoothFactor(game.state === 'IDLE' ? 10.0 : 6.5, safeDt);

        // 3. 镜头震动衰减
        game.screenShake = Math.max(0, (game.screenShake || 0) - safeDt * 15);

        // 4. 更新背景云朵
        const windMultiplier = player.weatherId === 'storm' ? 2.6 : (player.weatherId === 'rain' ? 1.5 : 1.0);
        for (const c of scenePool.clouds) {
            c.x += c.speed * windMultiplier * safeDt;
            if (c.x - c.w > 1900) {
                c.x = -c.w - 40;
            }
        }

        // 5. 更新水下环境鱼影
        const waterDepth = Math.max(80, WWF.ch - waterY);
        for (const f of scenePool.ambientFishes) {
            f.worldX += f.speed * safeDt;
            f.phase += safeDt * 5.2;
            const minX = f.biomeIndex * 600 + 35;
            const maxX = (f.biomeIndex + 1) * 600 - 35;
            if (f.speed > 0 && f.worldX > maxX) {
                f.worldX = maxX;
                f.speed = -Math.abs(f.speed);
            } else if (f.speed < 0 && f.worldX < minX) {
                f.worldX = minX;
                f.speed = Math.abs(f.speed);
            }
            const targetFishDir = f.speed >= 0 ? 1 : -1;
            if (typeof f.visualDir !== 'number') f.visualDir = targetFishDir;
            f.visualDir += (targetFishDir - f.visualDir) * expSmoothFactor(6.5, safeDt);
            f.y = waterY + 22 + f.depthRatio * (waterDepth - 36);
        }

        // 6. 更新湖心岛飘落樱花瓣与萤火虫
        for (const p of scenePool.petals) {
            p.worldX += p.vx * safeDt;
            p.yOffset += p.vy * safeDt;
            p.phase += safeDt * 3;
            if (p.yOffset > 8 || p.worldX < 1260) {
                p.worldX = 1420 + Math.random() * 240;
                p.yOffset = -95 - Math.random() * 35;
            }
        }

        for (const ff of scenePool.fireflies) {
            ff.worldX += ff.speedX * safeDt;
            ff.phase += safeDt * 2.8;
            if (ff.worldX < 20) ff.worldX = WWF.WORLD_WIDTH - 20;
            if (ff.worldX > WWF.WORLD_WIDTH - 20) ff.worldX = 20;
        }

        // 7. 更新水面涟漪与水花粒子
        for (let i = scenePool.ripples.length - 1; i >= 0; i--) {
            const rp = scenePool.ripples[i];
            rp.r += safeDt * 30;
            rp.alpha -= safeDt * 0.72;
            if (rp.alpha <= 0 || rp.r >= rp.maxR) {
                scenePool.ripples.splice(i, 1);
            }
        }

        for (let i = scenePool.splashes.length - 1; i >= 0; i--) {
            const sp = scenePool.splashes[i];
            sp.worldX += sp.vx * safeDt;
            sp.y += sp.vy * safeDt;
            sp.vy += 390 * safeDt;
            sp.alpha -= safeDt * 1.45;
            if (sp.alpha <= 0 || sp.y > waterY + 24) {
                scenePool.splashes.splice(i, 1);
            }
        }

        for (let i = scenePool.dustPuffs.length - 1; i >= 0; i--) {
            const dp = scenePool.dustPuffs[i];
            dp.worldX += dp.vx * safeDt;
            dp.y += dp.vy * safeDt;
            dp.vy += 85 * safeDt;
            dp.vx *= Math.max(0, 1 - safeDt * 3.5);
            dp.r += safeDt * 3.2;
            dp.alpha -= safeDt * 1.9;
            if (dp.alpha <= 0) {
                scenePool.dustPuffs.splice(i, 1);
            }
        }

        // 8. 动态天气粒子更新 (rain / storm / meteor / goldenTide)
        const weatherId = player.weatherId || 'sunny';

        // 雨天 & 雷暴
        if (weatherId === 'rain' || weatherId === 'storm') {
            const isStorm = weatherId === 'storm';
            const speedMul = isStorm ? 1.45 : 1.0;
            const windSlant = isStorm ? -145 : -75;

            for (const drop of scenePool.raindrops) {
                drop.x += windSlant * safeDt;
                drop.y += drop.speed * speedMul * safeDt;
                if (drop.y > WWF.ch) {
                    drop.y = -20;
                    drop.x = Math.random() * (WWF.cw + 220);
                }
                if (drop.x < -60) {
                    drop.x = WWF.cw + 120;
                }
            }

            // 雨滴激起水面小涟漪
            scenePool.rainRippleTimer -= safeDt;
            const rippleInterval = isStorm ? 0.06 : 0.14;
            if (scenePool.rainRippleTimer <= 0) {
                scenePool.rainRippleTimer = rippleInterval;
                const rx = game.cameraX + Math.random() * WWF.cw;
                const ry = waterY + 4 + Math.random() * (WWF.ch - waterY - 16);
                WWF.addRipple(rx, ry, isStorm ? 18 : 12, '186, 230, 253');
            }

            // 雷暴偶发闪电白光
            if (isStorm) {
                scenePool.nextLightningTimer -= safeDt;
                if (scenePool.nextLightningTimer <= 0) {
                    scenePool.nextLightningTimer = 4.5 + Math.random() * 6.5;
                    scenePool.lightningAlpha = 0.78;
                    game.screenShake = Math.max(game.screenShake || 0, 5.5);
                    // 生成树枝状闪电折线
                    const startX = WWF.cw * (0.18 + Math.random() * 0.64);
                    const pts = [{ x: startX, y: 0 }];
                    let cx = startX;
                    let cy = 0;
                    while (cy < waterY * 0.92) {
                        cx += (Math.random() - 0.5) * 58;
                        cy += 24 + Math.random() * 32;
                        pts.push({ x: cx, y: cy });
                    }
                    scenePool.lightningBolt = pts;
                }
            }
        }

        if (scenePool.lightningAlpha > 0) {
            scenePool.lightningAlpha = Math.max(0, scenePool.lightningAlpha - safeDt * 2.4);
        }

        // 流星极光夜 (或星夜偶发流星)
        const theme = WWF.THEMES[player.themeIndex || 0] || WWF.THEMES[0];
        if (weatherId === 'meteor' || theme.isNight) {
            scenePool.nextMeteorTimer -= safeDt;
            const interval = weatherId === 'meteor' ? (0.35 + Math.random() * 0.65) : (2.8 + Math.random() * 3.5);
            if (scenePool.nextMeteorTimer <= 0) {
                scenePool.nextMeteorTimer = interval;
                scenePool.meteors.push({
                    x: Math.random() * WWF.cw * 1.15,
                    y: Math.random() * (waterY * 0.45),
                    vx: -320 - Math.random() * 220,
                    vy: 140 + Math.random() * 110,
                    len: 55 + Math.random() * 55,
                    alpha: 1,
                    color: Math.random() < 0.45 ? '#fde047' : '#7dd3fc'
                });
            }
        }

        for (let i = scenePool.meteors.length - 1; i >= 0; i--) {
            const m = scenePool.meteors[i];
            m.x += m.vx * safeDt;
            m.y += m.vy * safeDt;
            m.alpha -= safeDt * 1.15;
            if (m.alpha <= 0 || m.y > waterY) {
                scenePool.meteors.splice(i, 1);
            }
        }

        // 黄金鱼潮水面升起金色星光气泡
        if (game.goldenTideTimer > 0) {
            scenePool.goldenBubbleTimer -= safeDt;
            if (scenePool.goldenBubbleTimer <= 0) {
                scenePool.goldenBubbleTimer = 0.07;
                scenePool.goldenBubbles.push({
                    worldX: game.cameraX + Math.random() * WWF.cw,
                    y: waterY + 20 + Math.random() * (WWF.ch - waterY - 25),
                    vy: -28 - Math.random() * 36,
                    r: 1.5 + Math.random() * 2.8,
                    alpha: 0.95,
                    phase: Math.random() * Math.PI * 2
                });
            }
        }

        for (let i = scenePool.goldenBubbles.length - 1; i >= 0; i--) {
            const gb = scenePool.goldenBubbles[i];
            gb.y += gb.vy * safeDt;
            gb.phase += safeDt * 5;
            gb.worldX += Math.sin(gb.phase) * 14 * safeDt;
            gb.alpha -= safeDt * 0.48;
            if (gb.alpha <= 0 || gb.y < waterY - 28) {
                scenePool.goldenBubbles.splice(i, 1);
            }
        }
    };

    // ------------------------------------------------------------------------
    // 4. 登船切换与生态区快速传送
    // ------------------------------------------------------------------------

    /**
     * 切换登船 / 上岸状态
     */
    WWF.toggleBoat = function () {
        const player = WWF.player;
        const game = WWF.game;
        if (!player || !game) return;

        if (game.state !== 'IDLE') {
            if (WWF.showToast) WWF.showToast('🎣 请先完成当前垂钓再切换船只状态！', 'warn');
            return;
        }

        if (!hasUnlockedAnyBoat()) {
            if (WWF.showToast) WWF.showToast('🚣 请先在【商店&换装】船坞解锁橡木小艇！', 'warn');
            if (WWF.openShopModal) WWF.openShopModal();
            return;
        }

        const waterY = WWF.getWaterSurfaceY();
        if (player.inBoat) {
            // 若在 x > 1180 外海深水区，需先回到木栈桥左端才能上岸
            if (player.worldX > 1180) {
                if (WWF.showToast) WWF.showToast('⚓ 当前处于外海深水区，请先回到木栈桥左端才能上岸！', 'warn');
                return;
            }
            player.inBoat = false;
            game.boatPitch = 0;
            game.boatPitchVel = 0;
            WWF.addRipple(player.worldX, waterY + 5, 28, '255, 255, 255');
            if (WWF.showToast) WWF.showToast('已靠岸下船，可自由步行探索。', 'info');
        } else {
            player.inBoat = true;
            ensureEquippedBoat();
            game.boatFacing = typeof game.visualFacing === 'number' ? game.visualFacing : (game.facing || 1);
            game.boatFacingVel = 0;
            game.boatPitch = 0;
            game.boatPitchVel = 0;
            if (player.worldX < 120) player.worldX = 120;
            WWF.addSplash(player.worldX, waterY + 4, 10, 0.85);
            WWF.addRipple(player.worldX, waterY + 5, 36, '125, 211, 252');
            if (WWF.Sound && WWF.Sound.playPlop) WWF.Sound.playPlop();
            if (WWF.showToast) WWF.showToast('🚣 已登船！现在可驶向翡翠湖心岛与星渊沉船湾。', 'info');
        }

        syncBiomeBadgeUI(true);
        if (WWF.updateHUD) WWF.updateHUD();
        if (WWF.saveGame) WWF.saveGame();
    };

    /**
     * 快速前往四大生态区代表坐标 (0 -> 320, 1 -> 780, 2 -> 1480, 3 -> 2060)
     */
    WWF.jumpToBiome = function (biomeIndex) {
        const player = WWF.player;
        const game = WWF.game;
        if (!player || !game) return false;

        if (game.state !== 'IDLE') {
            if (WWF.showToast) WWF.showToast('🎣 垂钓过程中无法传送海域，请先收竿！', 'warn');
            return false;
        }

        const idx = Number(biomeIndex);
        const biome = WWF.BIOMES[idx];
        if (!biome) return false;

        const targetCoords = [320, 780, 1480, 2060];
        const targetX = targetCoords[idx] !== undefined ? targetCoords[idx] : 780;

        if (biome.requiresBoat) {
            if (!hasUnlockedAnyBoat()) {
                if (WWF.showToast) {
                    WWF.showToast(`⚓ 前往【${biome.name}】需乘船，请先在商店船坞解锁小艇！`, 'warn');
                }
                if (WWF.openShopModal) WWF.openShopModal();
                return false;
            }
            player.inBoat = true;
            ensureEquippedBoat();
        } else {
            // 传送回浅滩或木栈桥时默认站在岸边/栈桥上
            player.inBoat = false;
        }

        player.worldX = targetX;
        game.facing = 1;
        game.visualFacing = 1;
        game.visualFacingVel = 0;
        game.boatFacing = 1;
        game.boatFacingVel = 0;
        game.rodFacing = 1;
        game.rodFacingVel = 0;
        game.boatPitch = 0;
        game.boatPitchVel = 0;
        game.bodyLean = 0;
        game.turnBounce = 0;
        game.vx = 0;
        game.moveBlend = 0;
        game.idleBobberSwingX = 0;
        game.idleBobberSwingVx = 0;
        scenePool.lastRodTipX = null;

        const initAhead = WWF.cw * (WWF.cw < 580 ? 0.10 : 0.085);
        game.cameraLookAhead = initAhead;
        game.cameraLookAheadVel = 0;
        game.facingHoldTime = 1;
        game.facingTravelDist = 100;
        const maxCam = Math.max(0, WWF.WORLD_WIDTH - WWF.cw);
        game.cameraX = Math.max(0, Math.min(maxCam, targetX + initAhead - WWF.cw * 0.5));

        const waterY = WWF.getWaterSurfaceY();
        WWF.addRipple(targetX, waterY + 6, 36, '125, 211, 252');
        if (player.inBoat) {
            WWF.addSplash(targetX, waterY + 4, 8, 0.7);
        }

        syncBiomeBadgeUI(true);
        if (WWF.showToast) WWF.showToast(`${biome.icon} 已抵达【${biome.name}】！`, 'info');
        if (WWF.updateHUD) WWF.updateHUD();
        if (WWF.saveGame) WWF.saveGame();
        return true;
    };

    // ------------------------------------------------------------------------
    // 5. 4 层视差生态世界与关节化角色模型渲染 (WWF.renderScene)
    // ------------------------------------------------------------------------

    /**
     * 主场景渲染入口
     */
    WWF.renderScene = function () {
        const ctx = WWF.ctx;
        if (!ctx) return;

        const cw = WWF.cw;
        const ch = WWF.ch;
        const waterY = WWF.getWaterSurfaceY();
        const player = WWF.player || { themeIndex: 0, weatherId: 'sunny', worldX: 760 };
        const game = WWF.game || { time: 0, cameraX: 360, screenShake: 0 };
        const theme = WWF.THEMES[player.themeIndex || 0] || WWF.THEMES[0];
        const camX = game.cameraX || 0;
        const t = game.time || 0;

        ctx.save();
        ctx.clearRect(0, 0, cw, ch);

        // 应用镜头震动偏移
        if (game.screenShake > 0.05) {
            const sx = (Math.random() - 0.5) * game.screenShake * 1.6;
            const sy = (Math.random() - 0.5) * game.screenShake * 1.6;
            ctx.translate(sx, sy);
        }

        // ==================== 第 1 层：天空、日月星辰、流星雨、雷暴闪电 ====================
        renderSkyAndCelestials(ctx, cw, ch, waterY, theme, player.weatherId, t);

        // ==================== 第 2 层：远景连绵山峦 (0.25x) & 中景林木岛屿剪影 (0.55x) ====================
        renderParallaxMountains(ctx, cw, waterY, theme, camX);

        // ==================== 第 3 层：湖面水体渐变、四大生态区水底过渡、波光与环境鱼影 ====================
        renderWaterAndUnderwater(ctx, cw, ch, waterY, theme, camX, t, game);

        // ==================== 第 4 层：2400px 世界坐标下的四大标志性地貌景观 ====================
        renderBiomeLandmarks(ctx, cw, ch, waterY, theme, camX, t);

        // 水面涟漪与水花粒子
        renderRipplesAndSplashes(ctx, camX);

        // ==================== 关节化角色模型、纸娃娃穿搭与船只 ====================
        renderCharacterAndBoat(ctx, waterY, camX, t);

        // ==================== 鱼线、浮漂、飞鱼抛物线、蓄力条、QTE 与遛鱼面板 ====================
        if (WWF.renderFishingOverlays) {
            WWF.renderFishingOverlays(ctx, cw, ch, camX);
        }

        // ==================== 最上层：前景雨丝粒子与黄金鱼潮水雾光效 ====================
        renderForegroundWeatherAndGoldenTide(ctx, cw, ch, waterY, player.weatherId, camX, t, game);

        ctx.restore();
    };

    /**
     * 第 1 层：天空渐变、星辰极光、日月、视差云朵、流星雨与雷暴闪电
     */
    function renderSkyAndCelestials(ctx, cw, ch, waterY, theme, weatherId, t) {
        const isMeteor = weatherId === 'meteor';
        const isStorm = weatherId === 'storm';
        const isRain = weatherId === 'rain';

        // 天空三段渐变 (缓存静态渐变对象)
        const skyKey = `${waterY}|${theme.id}|${weatherId || 'sunny'}`;
        if (scenePool.renderCache.key !== skyKey || !scenePool.renderCache.skyGrad) {
            const skyGrad = ctx.createLinearGradient(0, 0, 0, waterY);
            if (isMeteor) {
                skyGrad.addColorStop(0, '#020617');
                skyGrad.addColorStop(0.55, '#1e1b4b');
                skyGrad.addColorStop(1, '#0f172a');
            } else if (isStorm) {
                skyGrad.addColorStop(0, '#090d16');
                skyGrad.addColorStop(0.55, '#1e293b');
                skyGrad.addColorStop(1, '#334155');
            } else if (isRain) {
                skyGrad.addColorStop(0, '#1e293b');
                skyGrad.addColorStop(0.6, '#475569');
                skyGrad.addColorStop(1, '#64748b');
            } else {
                skyGrad.addColorStop(0, theme.skyTop);
                skyGrad.addColorStop(0.55, theme.skyMid);
                skyGrad.addColorStop(1, theme.skyBottom);
            }
            scenePool.renderCache.key = skyKey;
            scenePool.renderCache.skyGrad = skyGrad;
        }
        ctx.fillStyle = scenePool.renderCache.skyGrad;
        ctx.fillRect(0, 0, cw, waterY + 2);

        // 星夜或星陨极光夜：绘制闪烁星辰与极光彩带
        if (theme.isNight || isMeteor) {
            if (isMeteor) {
                ctx.save();
                const auroraGrad = ctx.createLinearGradient(0, waterY * 0.08, cw, waterY * 0.55);
                auroraGrad.addColorStop(0, 'rgba(16, 185, 129, 0.0)');
                auroraGrad.addColorStop(0.3, 'rgba(52, 211, 153, 0.16)');
                auroraGrad.addColorStop(0.65, 'rgba(168, 85, 247, 0.18)');
                auroraGrad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
                ctx.fillStyle = auroraGrad;
                ctx.beginPath();
                ctx.moveTo(0, waterY * 0.35);
                for (let x = 0; x <= cw; x += 40) {
                    const y = waterY * 0.24 + Math.sin(x * 0.012 + t * 0.8) * 18;
                    ctx.lineTo(x, y);
                }
                ctx.lineTo(cw, 0);
                ctx.lineTo(0, 0);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }

            const starAlphas = [0.45, 0.65, 0.82, 0.96];
            const starBuckets = [[], [], [], []];
            for (const s of scenePool.stars) {
                const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
                const bIdx = Math.min(3, Math.max(0, Math.floor((twinkle - 0.35) / 0.1625)));
                starBuckets[bIdx].push(s);
            }
            ctx.save();
            ctx.fillStyle = '#f8fafc';
            for (let b = 0; b < 4; b++) {
                const bucket = starBuckets[b];
                if (bucket.length === 0) continue;
                ctx.globalAlpha = starAlphas[b];
                ctx.beginPath();
                for (let i = 0; i < bucket.length; i++) {
                    const s = bucket[i];
                    const sx = s.xRatio * cw;
                    const sy = s.yRatio * waterY * 2;
                    ctx.moveTo(sx + s.r, sy);
                    ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
                }
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            ctx.restore();
        }

        // 日月与柔和光晕 (雷暴时被乌云遮蔽减弱)
        if (!isStorm) {
            const sunX = cw * 0.76 - (WWF.game ? WWF.game.cameraX * 0.05 : 0);
            const sunY = waterY * theme.sunYRatio * 2;
            const glowGrad = ctx.createRadialGradient(sunX, sunY, 6, sunX, sunY, 76);
            glowGrad.addColorStop(0, theme.sunGlow);
            glowGrad.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = glowGrad;
            ctx.beginPath();
            ctx.arc(sunX, sunY, 76, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = theme.sunColor;
            ctx.beginPath();
            ctx.arc(sunX, sunY, theme.isNight || isMeteor ? 18 : 24, 0, Math.PI * 2);
            ctx.fill();

            // 星夜新月遮罩塑造弯月
            if (theme.isNight || isMeteor) {
                ctx.fillStyle = isMeteor ? '#0a0f26' : theme.skyTop;
                ctx.beginPath();
                ctx.arc(sunX - 7, sunY - 4, 15, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // 流星雨绘制
        if (scenePool.meteors.length > 0) {
            ctx.save();
            for (const m of scenePool.meteors) {
                const norm = Math.hypot(m.vx, m.vy) || 1;
                const tx = m.x - (m.vx / norm) * m.len;
                const ty = m.y - (m.vy / norm) * m.len;
                const mGrad = ctx.createLinearGradient(m.x, m.y, tx, ty);
                mGrad.addColorStop(0, m.color);
                mGrad.addColorStop(1, 'rgba(255,255,255,0)');
                ctx.strokeStyle = mGrad;
                ctx.globalAlpha = Math.max(0, m.alpha);
                ctx.lineWidth = 2.4;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(m.x, m.y);
                ctx.lineTo(tx, ty);
                ctx.stroke();

                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(m.x, m.y, 2.2, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        // 视差云朵 (0.16x)
        const camOffset = (WWF.game ? WWF.game.cameraX : 0) * 0.16;
        ctx.save();
        for (const c of scenePool.clouds) {
            const screenX = ((c.x - camOffset) % (cw + 260) + (cw + 260)) % (cw + 260) - 130;
            const screenY = c.yRatio * waterY * 1.7;
            ctx.fillStyle = isStorm
                ? `rgba(30, 41, 59, ${Math.min(0.88, c.opacity + 0.25)})`
                : (isRain ? `rgba(100, 116, 139, ${c.opacity})` : theme.cloudColor);
            ctx.beginPath();
            ctx.roundRect(screenX, screenY, c.w, c.h, c.h * 0.5);
            ctx.arc(screenX + c.w * 0.32, screenY, c.h * 0.58, 0, Math.PI * 2);
            ctx.arc(screenX + c.w * 0.66, screenY - 2, c.h * 0.48, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();

        // 雷暴闪电树枝与瞬时白光
        if (scenePool.lightningAlpha > 0) {
            ctx.save();
            ctx.fillStyle = `rgba(224, 242, 254, ${scenePool.lightningAlpha * 0.35})`;
            ctx.fillRect(0, 0, cw, ch);
            if (scenePool.lightningBolt && scenePool.lightningBolt.length > 1) {
                ctx.strokeStyle = `rgba(255, 255, 255, ${scenePool.lightningAlpha})`;
                ctx.shadowColor = '#38bdf8';
                ctx.shadowBlur = 16;
                ctx.lineWidth = 2.8;
                ctx.beginPath();
                ctx.moveTo(scenePool.lightningBolt[0].x, scenePool.lightningBolt[0].y);
                for (let i = 1; i < scenePool.lightningBolt.length; i++) {
                    ctx.lineTo(scenePool.lightningBolt[i].x, scenePool.lightningBolt[i].y);
                }
                ctx.stroke();
            }
            ctx.restore();
        }
    }

    /**
     * 第 2 层：远景连绵山峦 (0.25x 视差) & 中景林木岛屿剪影 (0.55x 视差)
     */
    function renderParallaxMountains(ctx, cw, waterY, theme, camX) {
        // 2.1 远景连绵雪顶/云雾群山 (0.25x 视差，世界网格采样避免边缘抖动)
        const farOffset = camX * 0.25;
        const farStep = 16;
        const startFarWx = Math.floor((farOffset - 20) / farStep) * farStep;
        const endFarWx = farOffset + cw + 20 + farStep;
        ctx.fillStyle = theme.mountainFar;
        ctx.beginPath();
        ctx.moveTo(startFarWx - farOffset, waterY);
        for (let wx = startFarWx; wx <= endFarWx; wx += farStep) {
            const sx = wx - farOffset;
            const h = Math.sin(wx * 0.0045) * 42 + Math.cos(wx * 0.011) * 24 + 58;
            ctx.lineTo(sx, waterY - h);
        }
        ctx.lineTo(endFarWx - farOffset, waterY);
        ctx.closePath();
        ctx.fill();

        // 2.2 中景林木丘陵与远方海湾岛屿剪影 (0.55x 视差，世界网格采样)
        const midOffset = camX * 0.55;
        const midStep = 12;
        const startMidWx = Math.floor((midOffset - 20) / midStep) * midStep;
        const endMidWx = midOffset + cw + 20 + midStep;
        ctx.fillStyle = theme.mountainMid;
        ctx.beginPath();
        ctx.moveTo(startMidWx - midOffset, waterY);
        for (let wx = startMidWx; wx <= endMidWx; wx += midStep) {
            const sx = wx - midOffset;
            const h = Math.sin(wx * 0.008 + 1.4) * 26 + Math.cos(wx * 0.021) * 14 + 30;
            ctx.lineTo(sx, waterY - h);
        }
        ctx.lineTo(endMidWx - midOffset, waterY);
        ctx.closePath();
        ctx.fill();

        // 中景松林尖顶剪影装饰 (合批单次 fill)
        ctx.fillStyle = theme.mountainNear;
        ctx.beginPath();
        for (let wx = 40; wx < 1700; wx += 55) {
            const sx = wx - midOffset;
            if (sx < -40 || sx > cw + 40) continue;
            const baseH = Math.sin(wx * 0.008 + 1.4) * 20 + 22;
            const treeH = 18 + (wx % 3) * 6;
            const ty = waterY - baseH;
            ctx.moveTo(sx, ty - treeH);
            ctx.lineTo(sx - 9, ty + 4);
            ctx.lineTo(sx + 9, ty + 4);
            ctx.closePath();
        }
        ctx.fill();
    }

    /**
     * 第 3 层：湖面水体渐变、波光倒影、四大生态区水底色调过渡、水下环境鱼影
     */
    function renderWaterAndUnderwater(ctx, cw, ch, waterY, theme, camX, t, game) {
        const waterH = ch - waterY;

        // 3.1 基础水体垂直渐变 (缓存静态渐变对象)
        const waterKey = `${waterY}|${ch}|${theme.id}`;
        if (scenePool.renderCache.waterKey !== waterKey || !scenePool.renderCache.waterGrad) {
            const waterGrad = ctx.createLinearGradient(0, waterY, 0, ch);
            waterGrad.addColorStop(0, theme.waterTop);
            waterGrad.addColorStop(0.45, theme.waterMid);
            waterGrad.addColorStop(1, theme.waterDeep);
            scenePool.renderCache.waterKey = waterKey;
            scenePool.renderCache.waterGrad = waterGrad;
        }
        ctx.fillStyle = scenePool.renderCache.waterGrad;
        ctx.fillRect(0, waterY, cw, waterH);

        // 3.2 四大生态区水底色调平滑过渡 (0..600 翠绿, 600..1200 蔚蓝, 1200..1800 翡翠青, 1800..2400 星渊紫)
        for (const b of WWF.BIOMES) {
            const sx = b.minX - camX;
            const sw = b.maxX - b.minX;
            if (sx + sw < -100 || sx > cw + 100) continue;
            const biomeGrad = ctx.createLinearGradient(sx, waterY, sx + sw, waterY);
            biomeGrad.addColorStop(0, 'rgba(0,0,0,0)');
            biomeGrad.addColorStop(0.2, b.waterTint);
            biomeGrad.addColorStop(0.8, b.waterTint);
            biomeGrad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = biomeGrad;
            ctx.fillRect(Math.max(0, sx - 60), waterY, sw + 120, waterH);
        }

        // 黄金鱼潮水体流光加持
        if (game.goldenTideTimer > 0) {
            const pulse = 0.14 + 0.06 * Math.sin(t * 4);
            const goldGrad = ctx.createLinearGradient(0, waterY, 0, ch);
            goldGrad.addColorStop(0, `rgba(250, 204, 21, ${pulse})`);
            goldGrad.addColorStop(0.6, `rgba(245, 158, 11, ${pulse * 0.7})`);
            goldGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = goldGrad;
            ctx.fillRect(0, waterY, cw, waterH);
        }

        // 3.3 水下阳光丁达尔光束
        ctx.save();
        for (let i = 0; i < 6; i++) {
            const rayWorldX = 220 + i * 380 + Math.sin(t * 0.6 + i) * 25;
            const rx = rayWorldX - camX;
            if (rx < -150 || rx > cw + 150) continue;
            const rayGrad = ctx.createLinearGradient(rx, waterY, rx + 70, ch);
            rayGrad.addColorStop(0, theme.reflection);
            rayGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = rayGrad;
            ctx.beginPath();
            ctx.moveTo(rx - 22, waterY);
            ctx.lineTo(rx + 28, waterY);
            ctx.lineTo(rx + 105, ch);
            ctx.lineTo(rx + 20, ch);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();

        // 3.4 水面动态波光倒影线条 (全屏幕合批单次 stroke)
        ctx.save();
        ctx.strokeStyle = theme.reflection;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (let row = 0; row < 16; row++) {
            const ry = waterY + 6 + row * (waterH / 17);
            const waveLen = 26 + row * 4;
            for (let wx = 40; wx < WWF.WORLD_WIDTH; wx += 145) {
                const sx = wx - camX + Math.sin(t * 1.8 + row + wx * 0.01) * 14;
                if (sx < -60 || sx > cw + 60) continue;
                ctx.moveTo(sx, ry);
                ctx.lineTo(sx + waveLen, ry);
            }
        }
        ctx.stroke();
        ctx.restore();

        // 3.5 水下环境鱼影游动
        ctx.save();
        for (const f of scenePool.ambientFishes) {
            const sx = f.worldX - camX;
            if (sx < -50 || sx > cw + 50) continue;
            const sy = f.y || (waterY + 50);
            const rawDir = typeof f.visualDir === 'number' ? f.visualDir : (f.speed >= 0 ? 1 : -1);
            const dir = rawDir >= 0 ? Math.max(0.25, rawDir) : Math.min(-0.25, rawDir);
            const wag = Math.sin(f.phase) * 3.5;

            ctx.save();
            ctx.translate(sx, sy);
            ctx.scale(dir, 1);
            ctx.fillStyle = game.goldenTideTimer > 0 ? 'rgba(253, 224, 71, 0.26)' : f.tint;

            // 鱼身
            ctx.beginPath();
            ctx.ellipse(0, 0, f.size, f.size * 0.42, 0, 0, Math.PI * 2);
            ctx.fill();

            // 摆动鱼尾
            ctx.beginPath();
            ctx.moveTo(-f.size * 0.85, 0);
            ctx.lineTo(-f.size * 1.45, -f.size * 0.42 + wag);
            ctx.lineTo(-f.size * 1.45, f.size * 0.42 + wag);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
        ctx.restore();

        // 水面交界高光亮线
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, waterY);
        ctx.lineTo(cw, waterY);
        ctx.stroke();
    }

    /**
     * 第 4 层：2400px 世界坐标下的四大标志性地貌景观
     */
    function renderBiomeLandmarks(ctx, cw, ch, waterY, theme, camX, t) {
        // --------------------------------------------------------------------
        // 生态 0：芦苇浅滩 (0..600) —— 暖沙草坡河岸、摇曳高大蒲草芦苇、漂浮荷叶睡莲
        // --------------------------------------------------------------------
        if (camX < 720) {
            // 水下浅滩鹅卵石与嫩绿水草 (合批绘制)
            ctx.save();
            ctx.strokeStyle = 'rgba(16, 185, 129, 0.38)';
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.beginPath();
            for (let wx = 40; wx < 580; wx += 48) {
                const sx = wx - camX;
                if (sx < -40 || sx > cw + 40) continue;
                const sway = Math.sin(t * 2.2 + wx * 0.05) * 7;
                ctx.moveTo(sx, ch);
                ctx.quadraticCurveTo(sx + sway, ch - 38, sx + sway * 1.3, ch - 72 - (wx % 25));
            }
            ctx.stroke();
            ctx.restore();

            // 倾斜的暖沙与翠绿草坡河岸 (0..600，缓存静态渐变)
            ctx.save();
            if (scenePool.renderCache.terrainWaterY !== waterY || !scenePool.renderCache.sandGrad || !scenePool.renderCache.grassGrad) {
                const sandGrad = ctx.createLinearGradient(0, waterY - 26, 0, waterY + 32);
                sandGrad.addColorStop(0, '#d97706');
                sandGrad.addColorStop(0.5, '#b45309');
                sandGrad.addColorStop(1, '#78350f');
                const grassGrad = ctx.createLinearGradient(0, waterY - 36, 0, waterY - 8);
                grassGrad.addColorStop(0, '#22c55e');
                grassGrad.addColorStop(1, '#15803d');
                scenePool.renderCache.terrainWaterY = waterY;
                scenePool.renderCache.sandGrad = sandGrad;
                scenePool.renderCache.grassGrad = grassGrad;
            }

            // 下层暖沙河床护坡
            ctx.fillStyle = scenePool.renderCache.sandGrad;
            ctx.beginPath();
            ctx.moveTo(-camX, waterY - 26);
            ctx.lineTo(460 - camX, waterY - 18);
            ctx.lineTo(610 - camX, waterY + 18);
            ctx.lineTo(-camX, waterY + 28);
            ctx.closePath();
            ctx.fill();

            // 上层丰茂草坡表面
            ctx.fillStyle = scenePool.renderCache.grassGrad;
            ctx.beginPath();
            ctx.moveTo(-camX, waterY - 28);
            ctx.lineTo(460 - camX, waterY - 18);
            ctx.lineTo(595 - camX, waterY - 12);
            ctx.lineTo(595 - camX, waterY - 2);
            ctx.lineTo(455 - camX, waterY - 6);
            ctx.lineTo(-camX, waterY - 12);
            ctx.closePath();
            ctx.fill();

            // 成簇随风摇曳的高大蒲草与芦苇
            const reedPositions = [35, 75, 125, 165, 220, 265, 360, 410, 495, 535];
            for (let i = 0; i < reedPositions.length; i++) {
                const rx = reedPositions[i] - camX;
                if (rx < -40 || rx > cw + 40) continue;
                const baseY = getCharacterFootY(reedPositions[i], false) + 2;
                const h = 42 + (i % 3) * 12;
                const sway = Math.sin(t * 2.1 + i * 0.9) * 8;

                // 芦苇叶与茎秆
                ctx.strokeStyle = '#16a34a';
                ctx.lineWidth = 2.2;
                ctx.beginPath();
                ctx.moveTo(rx, baseY);
                ctx.quadraticCurveTo(rx + sway * 0.5, baseY - h * 0.5, rx + sway, baseY - h);
                ctx.stroke();

                // 侧边草叶
                ctx.strokeStyle = '#4ade80';
                ctx.lineWidth = 1.6;
                ctx.beginPath();
                ctx.moveTo(rx, baseY);
                ctx.quadraticCurveTo(rx - 8 + sway * 0.4, baseY - h * 0.4, rx - 12 + sway * 0.7, baseY - h * 0.65);
                ctx.stroke();

                // 棕色蒲棒
                if (i % 2 === 0) {
                    ctx.strokeStyle = '#78350f';
                    ctx.lineWidth = 5.5;
                    ctx.lineCap = 'round';
                    ctx.beginPath();
                    ctx.moveTo(rx + sway * 0.72, baseY - h * 0.72);
                    ctx.lineTo(rx + sway * 0.92, baseY - h * 0.92);
                    ctx.stroke();
                }
            }

            // 漂浮荷叶与盛开睡莲
            const lilies = [190, 285, 445, 560, 625];
            for (let i = 0; i < lilies.length; i++) {
                const lx = lilies[i] - camX;
                if (lx < -40 || lx > cw + 40) continue;
                const ly = waterY + 5 + (i % 2) * 5 + Math.sin(t * 2 + i) * 1.5;

                // 碧绿荷叶
                ctx.fillStyle = '#16a34a';
                ctx.beginPath();
                ctx.ellipse(lx, ly, 16, 5.5, 0, 0.2, Math.PI * 1.95);
                ctx.lineTo(lx, ly);
                ctx.closePath();
                ctx.fill();

                // 粉白睡莲花朵
                if (i % 2 === 0) {
                    ctx.fillStyle = '#fbcfe8';
                    for (let p = -1; p <= 1; p++) {
                        ctx.beginPath();
                        ctx.ellipse(lx + p * 3.5, ly - 3, 3.2, 5.5, p * 0.35, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    ctx.fillStyle = '#fde047';
                    ctx.beginPath();
                    ctx.arc(lx, ly - 2, 2, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            ctx.restore();
        }

        // --------------------------------------------------------------------
        // 生态 1：微风木栈桥 (600..1200) —— 木桩与长栈桥、暖光风灯、渔具木箱与救生圈
        // --------------------------------------------------------------------
        if (camX > -cw && camX < 1350) {
            ctx.save();
            const pierStart = 575;
            const pierEnd = 1188;
            const deckY = waterY - 18;

            // 水下与水上支撑粗木桩
            for (let px = 600; px <= 1170; px += 95) {
                const sx = px - camX;
                if (sx < -30 || sx > cw + 30) continue;

                // 水下木桩暗影
                ctx.fillStyle = 'rgba(41, 27, 18, 0.45)';
                ctx.fillRect(sx - 6, waterY, 12, 48);

                // 水上木桩
                const postGrad = ctx.createLinearGradient(sx - 6, deckY - 26, sx + 6, waterY);
                postGrad.addColorStop(0, '#92400e');
                postGrad.addColorStop(1, '#451a03');
                ctx.fillStyle = postGrad;
                ctx.fillRect(sx - 6, deckY - 24, 12, waterY - deckY + 26);

                // 桩顶金属箍与绳结
                ctx.fillStyle = '#d97706';
                ctx.fillRect(sx - 7, deckY - 26, 14, 4);
            }

            // 护栏下垂麻绳 (合批绘制)
            ctx.strokeStyle = 'rgba(217, 119, 6, 0.65)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let px = 600; px < 1170; px += 95) {
                const sx1 = px - camX;
                const sx2 = px + 95 - camX;
                if (sx2 < -20 || sx1 > cw + 20) continue;
                ctx.moveTo(sx1, deckY - 18);
                ctx.quadraticCurveTo((sx1 + sx2) * 0.5, deckY - 6, sx2, deckY - 18);
            }
            ctx.stroke();

            // 栈桥横梁主甲板
            const sxStart = pierStart - camX;
            const pierW = pierEnd - pierStart;
            ctx.fillStyle = '#78350f';
            ctx.fillRect(sxStart, deckY, pierW, 11);
            ctx.fillStyle = '#b45309';
            ctx.fillRect(sxStart, deckY - 3, pierW, 4);

            // 木板接缝细节
            ctx.fillStyle = '#451a03';
            for (let bx = pierStart + 12; bx < pierEnd; bx += 18) {
                const sbx = bx - camX;
                if (sbx >= -10 && sbx <= cw + 10) {
                    ctx.fillRect(sbx, deckY - 3, 2, 13);
                }
            }

            // 渔具木箱与备用鱼篓装饰 (x = 655)
            const crateX = 655 - camX;
            if (crateX > -50 && crateX < cw + 50) {
                ctx.fillStyle = '#92400e';
                ctx.fillRect(crateX, deckY - 20, 26, 17);
                ctx.strokeStyle = '#451a03';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(crateX, deckY - 20, 26, 17);
                ctx.beginPath();
                ctx.moveTo(crateX, deckY - 20);
                ctx.lineTo(crateX + 26, deckY - 3);
                ctx.stroke();
            }

            // 栈桥木桩上的红白救生圈 (x = 980)
            const ringX = 980 - camX;
            if (ringX > -40 && ringX < cw + 40) {
                ctx.lineWidth = 4.5;
                ctx.strokeStyle = '#f8fafc';
                ctx.beginPath();
                ctx.arc(ringX, deckY - 9, 8.5, 0, Math.PI * 2);
                ctx.stroke();

                ctx.strokeStyle = '#ef4444';
                for (let a = 0; a < 4; a++) {
                    ctx.beginPath();
                    ctx.arc(ringX, deckY - 9, 8.5, a * Math.PI * 0.5 - 0.25, a * Math.PI * 0.5 + 0.25);
                    ctx.stroke();
                }
            }

            // 挂着暖光风灯的高木灯柱 (x = 710 与 x = 1150)
            const lanternPosts = [710, 1150];
            for (const lpx of lanternPosts) {
                const lx = lpx - camX;
                if (lx < -80 || lx > cw + 80) continue;
                const swing = Math.sin(t * 2.4 + lpx) * 2.5;

                // 竖直灯杆与横臂
                ctx.fillStyle = '#451a03';
                ctx.fillRect(lx - 3, deckY - 72, 6, 70);
                ctx.fillRect(lx - 3, deckY - 72, 20, 4);

                // 风灯暖光光晕
                const lanX = lx + 15 + swing;
                const lanY = deckY - 58;
                const glowR = theme.isNight ? 48 : 28;
                const lanGlow = ctx.createRadialGradient(lanX, lanY, 2, lanX, lanY, glowR);
                lanGlow.addColorStop(0, 'rgba(253, 224, 71, 0.75)');
                lanGlow.addColorStop(0.5, 'rgba(251, 146, 60, 0.28)');
                lanGlow.addColorStop(1, 'rgba(251, 146, 60, 0)');
                ctx.fillStyle = lanGlow;
                ctx.beginPath();
                ctx.arc(lanX, lanY, glowR, 0, Math.PI * 2);
                ctx.fill();

                // 挂绳与风灯本体
                ctx.strokeStyle = '#78350f';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(lx + 15, deckY - 68);
                ctx.lineTo(lanX, lanY - 6);
                ctx.stroke();

                ctx.fillStyle = '#fef08a';
                ctx.beginPath();
                ctx.roundRect(lanX - 5, lanY - 6, 10, 13, 3);
                ctx.fill();
                ctx.strokeStyle = '#451a03';
                ctx.strokeRect(lanX - 5, lanY - 6, 10, 13);
            }
            ctx.restore();
        }

        // --------------------------------------------------------------------
        // 生态 2：翡翠湖心岛 (1200..1800) —— 湖心奇石岛、盛开樱花树、日式石灯笼、翡翠水草
        // --------------------------------------------------------------------
        if (camX + cw > 1150 && camX < 1850) {
            ctx.save();

            // 水下摇曳翡翠色高水草 (合批绘制)
            ctx.strokeStyle = 'rgba(6, 182, 212, 0.42)';
            ctx.lineWidth = 3.5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            for (let wx = 1230; wx <= 1780; wx += 44) {
                const sx = wx - camX;
                if (sx < -40 || sx > cw + 40) continue;
                const sway = Math.sin(t * 1.9 + wx * 0.04) * 10;
                ctx.moveTo(sx, ch);
                ctx.quadraticCurveTo(sx - sway, ch - 55, sx + sway, ch - 110 - (wx % 35));
            }
            ctx.stroke();

            // 湖心奇石绿洲小岛 (位于水面后侧背景 x = 1360..1670，船只可从前方水面划过)
            const islandX = 1515 - camX;
            const islandBaseY = waterY - 2;

            // 水中岛屿翡翠倒影
            ctx.fillStyle = 'rgba(6, 95, 70, 0.32)';
            ctx.beginPath();
            ctx.ellipse(islandX, waterY + 8, 155, 16, 0, 0, Math.PI * 2);
            ctx.fill();

            // 奇石底座与青苔岩层
            const rockGrad = ctx.createLinearGradient(islandX, islandBaseY - 48, islandX, islandBaseY);
            rockGrad.addColorStop(0, '#047857');
            rockGrad.addColorStop(0.35, '#334155');
            rockGrad.addColorStop(1, '#1e293b');
            ctx.fillStyle = rockGrad;
            ctx.beginPath();
            ctx.moveTo(islandX - 150, islandBaseY);
            ctx.quadraticCurveTo(islandX - 115, islandBaseY - 42, islandX - 35, islandBaseY - 46);
            ctx.quadraticCurveTo(islandX + 40, islandBaseY - 54, islandX + 110, islandBaseY - 34);
            ctx.quadraticCurveTo(islandX + 145, islandBaseY - 18, islandX + 155, islandBaseY);
            ctx.closePath();
            ctx.fill();

            // 岛顶翡翠草坪
            ctx.fillStyle = '#10b981';
            ctx.beginPath();
            ctx.ellipse(islandX - 10, islandBaseY - 40, 108, 12, -0.03, 0, Math.PI * 2);
            ctx.fill();

            // 岛上盛开的古樱花树 (x = 1485)
            const treeX = islandX - 25;
            const treeY = islandBaseY - 44;
            ctx.strokeStyle = '#451a03';
            ctx.lineWidth = 9;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(treeX, treeY);
            ctx.quadraticCurveTo(treeX - 12, treeY - 34, treeX - 28, treeY - 62);
            ctx.moveTo(treeX - 8, treeY - 26);
            ctx.quadraticCurveTo(treeX + 18, treeY - 48, treeX + 36, treeY - 58);
            ctx.stroke();

            // 浪漫粉樱树冠云团
            const canopies = [
                { dx: -32, dy: -66, r: 28, c: '#f472b6' },
                { dx: 0, dy: -74, r: 32, c: '#f9a8d4' },
                { dx: 34, dy: -62, r: 26, c: '#fbcfe8' },
                { dx: -14, dy: -54, r: 24, c: '#fbcfe8' }
            ];
            for (const cp of canopies) {
                ctx.fillStyle = cp.c;
                ctx.beginPath();
                ctx.arc(treeX + cp.dx, treeY + cp.dy, cp.r, 0, Math.PI * 2);
                ctx.fill();
            }

            // 随风飘落的樱花瓣 (视野裁剪)
            ctx.fillStyle = '#fbcfe8';
            for (const pt of scenePool.petals) {
                const px = pt.worldX - camX;
                if (px < -20 || px > cw + 20) continue;
                const py = waterY + pt.yOffset;
                ctx.beginPath();
                ctx.ellipse(px, py, pt.size, pt.size * 0.6, pt.phase, 0, Math.PI * 2);
                ctx.fill();
            }

            // 岛上发光日式石灯笼 (x = 1585)
            const lanternX = islandX + 72;
            const lanternY = islandBaseY - 38;
            ctx.fillStyle = '#64748b';
            ctx.fillRect(lanternX - 8, lanternY - 4, 16, 5);
            ctx.fillRect(lanternX - 4, lanternY - 22, 8, 18);
            ctx.beginPath();
            ctx.moveTo(lanternX - 13, lanternY - 22);
            ctx.lineTo(lanternX, lanternY - 31);
            ctx.lineTo(lanternX + 13, lanternY - 22);
            ctx.closePath();
            ctx.fill();

            // 石灯笼暖光窗
            const sGlow = ctx.createRadialGradient(lanternX, lanternY - 16, 2, lanternX, lanternY - 16, 26);
            sGlow.addColorStop(0, 'rgba(253, 224, 71, 0.85)');
            sGlow.addColorStop(1, 'rgba(253, 224, 71, 0)');
            ctx.fillStyle = sGlow;
            ctx.beginPath();
            ctx.arc(lanternX, lanternY - 16, 26, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fef08a';
            ctx.fillRect(lanternX - 2.5, lanternY - 19, 5, 6);

            ctx.restore();
        }

        // --------------------------------------------------------------------
        // 生态 3：星渊沉船湾 (1800..2400) —— 远古幽灵沉船、折断桅杆、发光水晶浮标、水底幽光
        // --------------------------------------------------------------------
        if (camX + cw > 1750) {
            ctx.save();

            // 水底星渊神秘紫蓝幽光与晶簇
            const abyssCenterX = 2130 - camX;
            const abyssGlow = ctx.createRadialGradient(abyssCenterX, ch - 20, 15, abyssCenterX, ch - 20, 240);
            abyssGlow.addColorStop(0, 'rgba(139, 92, 246, 0.36)');
            abyssGlow.addColorStop(0.5, 'rgba(56, 189, 248, 0.16)');
            abyssGlow.addColorStop(1, 'rgba(15, 23, 42, 0)');
            ctx.fillStyle = abyssGlow;
            ctx.beginPath();
            ctx.arc(abyssCenterX, ch - 20, 240, 0, Math.PI * 2);
            ctx.fill();

            // 远古幽灵沉船斜插海面 (位于 x = 2120 中后景，船只可从前方水面划过)
            const shipX = 2120 - camX;
            const shipY = waterY - 2;

            ctx.save();
            ctx.translate(shipX, shipY);
            ctx.rotate(-0.22); // 沉船倾斜角

            // 破损木质船体剪影
            const hullGrad = ctx.createLinearGradient(-130, -65, 120, 20);
            hullGrad.addColorStop(0, '#1e1b4b');
            hullGrad.addColorStop(0.5, '#312e81');
            hullGrad.addColorStop(1, '#0f172a');
            ctx.fillStyle = hullGrad;
            ctx.beginPath();
            ctx.moveTo(-135, 18);
            ctx.lineTo(-155, -38); // 高耸船尾楼
            ctx.lineTo(-95, -42);
            ctx.lineTo(-75, -24);
            ctx.lineTo(85, -26);
            ctx.lineTo(155, -52);  // 尖锐船首斜杠
            ctx.lineTo(115, 18);
            ctx.closePath();
            ctx.fill();

            // 船体肋骨与幽灵发光舷窗
            ctx.strokeStyle = 'rgba(129, 140, 248, 0.35)';
            ctx.lineWidth = 2;
            for (let rx = -80; rx <= 60; rx += 28) {
                ctx.beginPath();
                ctx.moveTo(rx, -24);
                ctx.lineTo(rx - 6, 12);
                ctx.stroke();
            }

            for (let wx = -125; wx <= -100; wx += 14) {
                ctx.fillStyle = 'rgba(56, 189, 248, 0.75)';
                ctx.beginPath();
                ctx.arc(wx, -26, 3, 0, Math.PI * 2);
                ctx.fill();
            }

            // 折断高耸主桅杆与残破风帆
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 7;
            ctx.beginPath();
            ctx.moveTo(-10, -22);
            ctx.lineTo(-18, -135);
            ctx.stroke();

            // 横帆桁与残破幽灵帆
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(-68, -105);
            ctx.lineTo(42, -95);
            ctx.stroke();

            const sailSway = Math.sin(t * 1.8) * 6;
            ctx.fillStyle = 'rgba(148, 163, 184, 0.24)';
            ctx.beginPath();
            ctx.moveTo(-62, -104);
            ctx.lineTo(36, -95);
            ctx.quadraticCurveTo(22 + sailSway, -55, 5 + sailSway, -42);
            ctx.lineTo(-22, -68);
            ctx.lineTo(-48 + sailSway, -38);
            ctx.closePath();
            ctx.fill();

            // 船尾破损船舵剪影
            ctx.strokeStyle = '#6366f1';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(-115, -48, 10, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();

            // 环绕沉船湾的发光紫蓝色水晶浮标
            const crystals = [1865, 1985, 2265, 2345];
            for (let i = 0; i < crystals.length; i++) {
                const cx = crystals[i] - camX;
                if (cx < -50 || cx > cw + 50) continue;
                const cy = waterY - 2 + Math.sin(t * 2.4 + i * 1.3) * 4;

                // 水晶光晕
                const cGlow = ctx.createRadialGradient(cx, cy - 10, 2, cx, cy - 10, 32);
                cGlow.addColorStop(0, i % 2 === 0 ? 'rgba(56, 189, 248, 0.65)' : 'rgba(168, 85, 247, 0.65)');
                cGlow.addColorStop(1, 'rgba(56, 189, 248, 0)');
                ctx.fillStyle = cGlow;
                ctx.beginPath();
                ctx.arc(cx, cy - 10, 32, 0, Math.PI * 2);
                ctx.fill();

                // 菱形发光水晶本体
                ctx.fillStyle = i % 2 === 0 ? '#38bdf8' : '#c084fc';
                ctx.beginPath();
                ctx.moveTo(cx, cy - 24);
                ctx.lineTo(cx + 8, cy - 10);
                ctx.lineTo(cx, cy + 2);
                ctx.lineTo(cx - 8, cy - 10);
                ctx.closePath();
                ctx.fill();
            }

            ctx.restore();
        }

        // 环境萤火虫/星尘微光粒子
        ctx.save();
        for (const ff of scenePool.fireflies) {
            const fx = ff.worldX - camX;
            if (fx < -20 || fx > cw + 20) continue;
            const fy = waterY + ff.yOffset + Math.sin(t * 2.2 + ff.phase) * 8;
            const alpha = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(t * 3.5 + ff.phase));
            ctx.fillStyle = ff.color;
            ctx.globalAlpha = alpha;
            ctx.beginPath();
            ctx.arc(fx, fy, 2.2, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    /**
     * 渲染水面涟漪与飞溅水花粒子
     */
    function renderRipplesAndSplashes(ctx, camX) {
        const cw = WWF.cw || 960;
        ctx.save();
        for (const rp of scenePool.ripples) {
            const sx = rp.worldX - camX;
            if (sx < -60 || sx > cw + 60) continue;
            const c = String(rp.color || '255, 255, 255');
            if (c.startsWith('rgb') || c.startsWith('#')) {
                ctx.strokeStyle = c;
                ctx.globalAlpha = Math.max(0, rp.alpha);
            } else {
                ctx.strokeStyle = `rgba(${c}, ${Math.max(0, rp.alpha)})`;
                ctx.globalAlpha = 1;
            }
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.ellipse(sx, rp.y, rp.r, rp.r * 0.32, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;

        for (const sp of scenePool.splashes) {
            const sx = sp.worldX - camX;
            if (sx < -60 || sx > cw + 60) continue;
            ctx.fillStyle = sp.color;
            ctx.globalAlpha = Math.max(0, sp.alpha);
            ctx.beginPath();
            ctx.arc(sx, sp.y, sp.r, 0, Math.PI * 2);
            ctx.fill();
        }

        for (const dp of scenePool.dustPuffs) {
            const sx = dp.worldX - camX;
            if (sx < -60 || sx > cw + 60) continue;
            ctx.fillStyle = dp.color;
            ctx.globalAlpha = Math.max(0, dp.alpha);
            ctx.beginPath();
            ctx.arc(sx, dp.y, dp.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    /**
     * 绘制船只、2.5D 立体转向关节化角色模型、纸娃娃服饰与头饰、五阶进化鱼竿
     */
    function renderCharacterAndBoat(ctx, waterY, camX, t) {
        const player = WWF.player || {
            worldX: 760,
            inBoat: false,
            equippedBoat: 'rowboat',
            equippedHat: 'straw',
            equippedOutfit: 'casual',
            rodLevel: 1
        };
        const game = WWF.game || { state: 'IDLE', facing: 1, walkCycle: 0, pose: 'idle' };

        const charScreenX = player.worldX - camX;
        const dir = game.facing === -1 ? -1 : 1;
        const vf = clamp(typeof game.visualFacing === 'number' ? game.visualFacing : dir, -1, 1);
        const absVf = Math.abs(vf);
        const frontView = 1 - absVf;
        const bf = clamp(typeof game.boatFacing === 'number' ? game.boatFacing : dir, -1, 1);
        const moveBlend = clamp(typeof game.moveBlend === 'number' ? game.moveBlend : ((game.pose === 'walk' || game.pose === 'row') ? 1 : 0), 0, 1);

        const turnBouncePx = !player.inBoat ? Math.sin((game.turnBounce || 0) * Math.PI) * 3.0 : 0;
        const boatTurnBob = player.inBoat ? (1 - Math.abs(bf)) * 1.5 : 0;
        const footY = getCharacterFootY(player.worldX, player.inBoat) - turnBouncePx + boatTurnBob;
        const boatType = (player.equippedBoat && player.equippedBoat !== 'none') ? player.equippedBoat : 'rowboat';

        // 1. 若在船上：先绘制 2.5D 船体后半部
        if (player.inBoat) {
            renderBoatHull(ctx, charScreenX, footY, bf, boatType, game, t);
        }

        // 2. 绘制 2.5D 关节化角色身体、四肢、服饰与立体转头表情 (不使用硬翻转 scale(dir, 1))
        ctx.save();
        ctx.translate(charScreenX, footY);
        if (player.inBoat && game.boatPitch) {
            ctx.rotate(game.boatPitch * 0.65);
        }

        // 连续世界空间身体姿态倾斜角
        const bodyLean = typeof game.bodyLean === 'number' ? game.bodyLean : 0;

        // 呼吸上下起伏
        const breathe = (game.pose === 'idle' || game.pose === 'wait') ? Math.sin(t * 3.2) * 1.4 : 0;

        // 2.1 双腿关节动画 (正面过渡期自动拉开站距，迈步随 moveBlend 平滑收放)
        const walkSwing = !player.inBoat ? Math.sin(game.walkCycle) * 8 * moveBlend : 0;
        const strideScale = 0.35 + 0.65 * absVf;
        const stepLiftFront = !player.inBoat ? Math.max(0, -Math.cos(game.walkCycle)) * 2.4 * moveBlend : 0;
        const stepLiftBack = !player.inBoat ? Math.max(0, Math.cos(game.walkCycle)) * 2.4 * moveBlend : 0;
        const legSep = 2.0 * absVf + 3.2 * frontView;

        const backFootX = player.inBoat ? (vf * 3 - legSep * 0.45) : (-legSep - walkSwing * strideScale);
        const frontFootX = player.inBoat ? (vf * 6 + legSep * 0.45) : (legSep + walkSwing * strideScale);
        const backFootY = player.inBoat ? -3 : (-1 - stepLiftBack);
        const frontFootY = player.inBoat ? -3 : (-1 - stepLiftFront);

        ctx.lineCap = 'round';
        ctx.lineWidth = 5.5;
        ctx.strokeStyle = '#1e293b';

        // 后腿
        ctx.beginPath();
        ctx.moveTo(-legSep, -16 + breathe);
        ctx.lineTo(backFootX, backFootY);
        ctx.stroke();

        // 前腿
        ctx.beginPath();
        ctx.moveTo(legSep, -16 + breathe);
        ctx.lineTo(frontFootX, frontFootY);
        ctx.stroke();

        // 鞋子 (随朝向平滑转正鞋尖)
        ctx.fillStyle = player.equippedOutfit === 'raincoat' ? '#facc15' : '#451a03';
        if (!player.inBoat) {
            const shoeW = 3.2 + 1.3 * absVf;
            const toeShift = vf * 2.0;
            ctx.beginPath();
            ctx.ellipse(backFootX + toeShift, backFootY, shoeW, 2.5, 0, 0, Math.PI * 2);
            ctx.ellipse(frontFootX + toeShift, frontFootY, shoeW, 2.5, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        // 2.2 躯干与服饰 (应用连续世界空间 bodyLean)
        ctx.save();
        ctx.translate(0, -16 + breathe);
        ctx.rotate(bodyLean);

        renderCharacterOutfit(ctx, player.equippedOutfit || 'casual', t, vf, game.visualFacingVel || 0);

        // 2.3 头部与球面投影 2.5D 转头表情 (正脸可见双眼双腮，侧脸平滑隐去背面五官)
        ctx.save();
        ctx.translate(0, -24);
        // 脸庞
        ctx.fillStyle = '#fed7aa';
        ctx.beginPath();
        ctx.arc(0, 0, 9.5, 0, Math.PI * 2);
        ctx.fill();

        const yaw = vf * Math.PI * 0.44;
        const cheekOffsets = [-0.62, 0.62];
        for (const offset of cheekOffsets) {
            const ang = yaw + offset;
            const cosA = Math.cos(ang);
            if (cosA <= 0.15) continue;
            const cx = Math.sin(ang) * 6.5;
            const visScale = Math.max(0.45, cosA);
            ctx.fillStyle = 'rgba(244, 63, 94, 0.35)';
            ctx.beginPath();
            ctx.ellipse(cx, 2.2, 2.2 * visScale, 2.0, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        // 眼神 (随状态变化 + 球面透视)
        const eyeOffsets = [-0.42, 0.42];
        const isBlinking = (Math.sin(t * 1.7) > 0.96);
        for (const offset of eyeOffsets) {
            const ang = yaw + offset;
            const cosA = Math.cos(ang);
            if (cosA <= 0.15) continue;
            const ex = Math.sin(ang) * 6.0;
            const visScale = Math.max(0.45, cosA);
            const toNose = -Math.sign(offset);

            ctx.fillStyle = '#0f172a';
            if (game.state === 'REELING' || game.state === 'CHARGING') {
                // 专注坚毅眼神 + 剑眉
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#0f172a';
                ctx.beginPath();
                ctx.moveTo(ex - toNose * 2.0 * visScale, -2.6);
                ctx.lineTo(ex + toNose * 1.7 * visScale, -1.2);
                ctx.stroke();
                ctx.beginPath();
                ctx.ellipse(ex, -0.5, 1.6 * visScale, 1.6, 0, 0, Math.PI * 2);
                ctx.fill();
            } else if (game.state === 'BITING' || game.state === 'LEAPING') {
                // 惊喜大眼
                ctx.beginPath();
                ctx.ellipse(ex, -1.2, 2.3 * visScale, 2.3, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(ex + toNose * 0.45 * visScale, -1.8, 0.8 * Math.max(0.6, visScale), 0, Math.PI * 2);
                ctx.fill();
            } else {
                // 悠闲微笑眼神 (含周期眨眼)
                if (isBlinking) {
                    ctx.strokeStyle = '#0f172a';
                    ctx.lineWidth = 1.6;
                    ctx.beginPath();
                    ctx.moveTo(ex - 1.7 * visScale, -1);
                    ctx.lineTo(ex + 1.7 * visScale, -1);
                    ctx.stroke();
                } else {
                    ctx.beginPath();
                    ctx.ellipse(ex, -1.2, 1.8 * visScale, 1.8, 0, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        // 2.4 纸娃娃头饰 (straw / captain / frog / star_crown)
        renderCharacterHat(ctx, player.equippedHat || 'straw', t, vf);

        ctx.restore(); // 结束头部

        // 2.5 手臂动作 (持竿或划桨)
        ctx.strokeStyle = '#fed7aa';
        ctx.lineWidth = 4.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        if (game.pose === 'row') {
            const rowHandX = vf * (8 + Math.cos(game.walkCycle) * 5 * moveBlend);
            const rowHandY = -10 + Math.sin(game.walkCycle) * 3 * moveBlend;
            ctx.moveTo(0, -16);
            ctx.lineTo(rowHandX, rowHandY);
        } else {
            ctx.moveTo(0, -16);
            ctx.lineTo(vf * 11, -14);
        }
        ctx.stroke();

        ctx.restore(); // 结束躯干倾斜
        ctx.restore(); // 结束角色局部坐标系

        // 3. 若在船上：绘制前景 2.5D 船桨/船舷光效
        if (player.inBoat) {
            renderBoatForeground(ctx, charScreenX, footY, bf, boatType, game, t);
        }

        // 4. 绘制带物理弯曲的五阶进化鱼竿 (与 WWF.getRodTip 严格对齐)
        renderFishingRod(ctx, camX, player, game);
    }

    /**
     * 绘制 4 套角色服饰 (casual / raincoat / sailor / master_robe，支持 2.5D 转身不坍缩)
     */
    function renderCharacterOutfit(ctx, outfitId, t, vf = 1, turnVel = 0) {
        const safeVf = clamp(vf, -1, 1);
        const absVf = Math.abs(safeVf);
        const torsoW = 0.86 + 0.14 * absVf;

        if (outfitId === 'raincoat') {
            // 明黄防风雨衣
            ctx.fillStyle = '#facc15';
            ctx.beginPath();
            ctx.moveTo(-7 * torsoW, -19);
            ctx.lineTo(7 * torsoW, -19);
            ctx.lineTo(9.5 * torsoW, 2);
            ctx.lineTo(-9.5 * torsoW, 2);
            ctx.closePath();
            ctx.fill();
            // 反光银白条纹与门襟纽扣
            ctx.fillStyle = '#f8fafc';
            ctx.fillRect(-8.5 * torsoW, -4, 17 * torsoW, 2.5);
            ctx.fillStyle = '#ca8a04';
            ctx.fillRect(safeVf * 3 - 1, -16, 2, 14);
        } else if (outfitId === 'sailor') {
            // 水手条纹礼服
            ctx.fillStyle = '#f8fafc';
            ctx.beginPath();
            ctx.roundRect(-7.5 * torsoW, -19, 15 * torsoW, 20, 4);
            ctx.fill();
            // 藏青海魂横条纹
            ctx.fillStyle = '#1d4ed8';
            for (let sy = -15; sy < 0; sy += 5) {
                ctx.fillRect(-7 * torsoW, sy, 14 * torsoW, 2.2);
            }
            // 水手海军蓝披肩领与红领结
            ctx.fillStyle = '#1e3a8a';
            ctx.beginPath();
            ctx.moveTo(-7.5 * torsoW, -19);
            ctx.lineTo(7.5 * torsoW, -19);
            ctx.lineTo(4.5 * torsoW + safeVf * 0.5, -11);
            ctx.lineTo(-4.5 * torsoW + safeVf * 0.5, -11);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#ef4444';
            ctx.beginPath();
            ctx.arc(safeVf * 3.5, -13, 2.4, 0, Math.PI * 2);
            ctx.fill();
        } else if (outfitId === 'master_robe') {
            // 绯红龙纹宗师羽织
            ctx.fillStyle = '#1e1b4b';
            ctx.beginPath();
            ctx.roundRect(-7.5 * torsoW, -19, 15 * torsoW, 21, 4);
            ctx.fill();

            // 飘逸绯红羽织外袍 (转身时衣摆随角速度与背向飘动)
            const capeSway = Math.sin(t * 3.5) * 2;
            const turnSwirl = clamp(-turnVel * 0.9, -6, 6);
            const backExtend = -safeVf * (3.5 + capeSway * 0.8) + turnSwirl;
            const rightHemX = Math.max(7.5 * torsoW, 8 * torsoW + Math.max(0, backExtend));
            const leftHemX = Math.min(-7.5 * torsoW, -8 * torsoW + Math.min(0, backExtend));
            const rightHemY = 2 + Math.max(0, -safeVf);
            const leftHemY = 2 + Math.max(0, safeVf);

            ctx.fillStyle = '#dc2626';
            ctx.beginPath();
            ctx.moveTo(-7 * torsoW, -19);
            ctx.lineTo(7 * torsoW, -19);
            ctx.lineTo(rightHemX, rightHemY);
            ctx.lineTo(leftHemX, leftHemY);
            ctx.closePath();
            ctx.fill();

            // 金色龙纹滚边与腰带
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(safeVf * 4, -19);
            ctx.lineTo(safeVf * 5, 2);
            ctx.moveTo(leftHemX + 1.5, -2);
            ctx.lineTo(rightHemX - 1.5, -2);
            ctx.stroke();
        } else {
            // 默认 casual：海风亚麻衫 + 棕色背带/皮带
            ctx.fillStyle = '#0ea5e9';
            ctx.beginPath();
            ctx.roundRect(-7.5 * torsoW, -19, 15 * torsoW, 20, 4);
            ctx.fill();
            ctx.fillStyle = '#e0f2fe';
            ctx.fillRect(safeVf * 0.5 - 3.5 * torsoW, -19, 7 * torsoW, 6);
            ctx.fillStyle = '#78350f';
            ctx.fillRect(-7.5 * torsoW, -3, 15 * torsoW, 3);
        }
    }

    /**
     * 绘制 4 款个性头饰 (straw / captain / frog / star_crown，支持 2.5D 转头透视)
     */
    function renderCharacterHat(ctx, hatId, t, vf = 1) {
        const safeVf = clamp(vf, -1, 1);
        const absVf = Math.abs(safeVf);

        if (hatId === 'captain') {
            // 老船长帽：白色高顶 + 藏青帽檐 + 金色船锚徽章
            ctx.fillStyle = '#f8fafc';
            ctx.beginPath();
            ctx.moveTo(-9, -7);
            ctx.lineTo(-11, -16);
            ctx.quadraticCurveTo(safeVf * 1.0, -20, 11, -16);
            ctx.lineTo(9, -7);
            ctx.closePath();
            ctx.fill();

            // 藏青帽墙与前帽舌
            ctx.fillStyle = '#0f172a';
            ctx.fillRect(-9, -10, 18, 3.5);
            ctx.beginPath();
            ctx.ellipse(safeVf * 5, -7, 6.2 + 2.8 * absVf, 2.5, safeVf * 0.12, 0, Math.PI * 2);
            ctx.fill();

            // 金色徽章
            ctx.fillStyle = '#fbbf24';
            ctx.beginPath();
            ctx.arc(safeVf * 3, -12, 2.5, 0, Math.PI * 2);
            ctx.fill();
        } else if (hatId === 'frog') {
            // 可爱青蛙荷叶帽 (带两只圆溜溜大蛙眼，眼神随朝向转动)
            ctx.fillStyle = '#22c55e';
            ctx.beginPath();
            ctx.arc(0, -5, 10.5, Math.PI, 0);
            ctx.ellipse(0, -5, 13, 3, 0, 0, Math.PI * 2);
            ctx.fill();

            // 两只凸起的大蛙眼
            const eyeCenters = [-4.0, 4.0];
            for (const ex of eyeCenters) {
                ctx.fillStyle = '#22c55e';
                ctx.beginPath();
                ctx.arc(ex, -15, 4.4, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(ex + safeVf * 0.6, -15, 2.8, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#0f172a';
                ctx.beginPath();
                ctx.arc(ex + safeVf * 1.2, -15, 1.5, 0, Math.PI * 2);
                ctx.fill();
            }
        } else if (hatId === 'star_crown') {
            // 星辰幻梦冠 (带浮动星芒光环)
            const floatY = Math.sin(t * 4) * 1.8;
            ctx.save();
            ctx.translate(0, floatY);

            // 星冠光晕
            const cGlow = ctx.createRadialGradient(0, -14, 2, 0, -14, 18);
            cGlow.addColorStop(0, 'rgba(250, 204, 21, 0.55)');
            cGlow.addColorStop(1, 'rgba(250, 204, 21, 0)');
            ctx.fillStyle = cGlow;
            ctx.beginPath();
            ctx.arc(0, -14, 18, 0, Math.PI * 2);
            ctx.fill();

            // 鎏金皇冠主体
            ctx.fillStyle = '#facc15';
            ctx.beginPath();
            ctx.moveTo(-8, -8);
            ctx.lineTo(-9, -17);
            ctx.lineTo(-4, -12);
            ctx.lineTo(0, -19);
            ctx.lineTo(4, -12);
            ctx.lineTo(9, -17);
            ctx.lineTo(8, -8);
            ctx.closePath();
            ctx.fill();

            // 镶嵌星钻
            ctx.fillStyle = '#38bdf8';
            ctx.beginPath();
            ctx.arc(safeVf * 1.2, -12, 2, 0, Math.PI * 2);
            ctx.fill();

            // 环绕浮动星芒
            for (let i = 0; i < 3; i++) {
                const ang = t * 2.6 + i * (Math.PI * 2 / 3) + safeVf * 0.6;
                const sx = Math.cos(ang) * 13;
                const sy = -13 + Math.sin(ang) * 3.5;
                ctx.fillStyle = i === 0 ? '#fde047' : '#7dd3fc';
                ctx.beginPath();
                ctx.arc(sx, sy, 1.7, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        } else {
            // 默认 straw：田园草帽 + 红丝带
            ctx.fillStyle = '#facc15';
            ctx.beginPath();
            ctx.arc(0, -7, 9.5, Math.PI, 0);
            ctx.fill();
            ctx.fillStyle = '#ef4444';
            ctx.fillRect(-9.2, -9.5, 18.4, 2.8);
            ctx.fillStyle = '#eab308';
            ctx.beginPath();
            ctx.ellipse(0, -7, 15.5, 3.2, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /**
     * 绘制 2.5D 船体 (rowboat 橡木小艇 / spirit_boat 星辉天鹅画舫)
     */
    function renderBoatHull(ctx, screenX, footY, bf, boatType, game, t) {
        const safeBf = clamp(bf, -1, 1);
        const absBf = Math.abs(safeBf);
        const frontView = 1 - absBf;
        const hullSpan = 0.40 + 0.60 * absBf;
        const pitch = game.boatPitch || 0;

        ctx.save();
        ctx.translate(screenX, footY);
        ctx.rotate(pitch);

        // 船底水影
        ctx.fillStyle = 'rgba(2, 6, 23, 0.22)';
        ctx.beginPath();
        ctx.ellipse(0, 8 + frontView * 1.5, 38 * hullSpan + 6, 4.5, 0, 0, Math.PI * 2);
        ctx.fill();

        if (boatType === 'spirit_boat') {
            // 星辉天鹅画舫：梦幻星蓝光晕 + 船尾星灯 + 流线白金船身 + 发光天鹅羽翼船首
            const aura = ctx.createRadialGradient(0, 2, 8, 0, 2, 54);
            aura.addColorStop(0, 'rgba(56, 189, 248, 0.35)');
            aura.addColorStop(1, 'rgba(56, 189, 248, 0)');
            ctx.fillStyle = aura;
            ctx.beginPath();
            ctx.arc(0, 2, 54, 0, Math.PI * 2);
            ctx.fill();

            // 船尾悬浮星灯 (随 safeBf 平滑摆动至船尾)
            const sternBaseX = -36 * safeBf;
            const sternMidX = -45 * safeBf;
            const sternTipX = -34 * safeBf;
            const lanternY = -28 + frontView * 3;
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(sternBaseX, -6);
            ctx.quadraticCurveTo(sternMidX, -24, sternTipX, lanternY);
            ctx.stroke();
            ctx.fillStyle = '#fde047';
            ctx.beginPath();
            ctx.arc(sternTipX, lanternY + 3, 3.5, 0, Math.PI * 2);
            ctx.fill();

            // 流线型白金/星蓝船身 (保留 >= 40% 最小船宽)
            const halfW = 40 * hullSpan;
            const keelW = 30 * hullSpan;
            const keelDrop = frontView * 2.5;
            const hullGrad = ctx.createLinearGradient(-halfW, -10, halfW + 6 * absBf, 10);
            hullGrad.addColorStop(0, '#e0f2fe');
            hullGrad.addColorStop(0.5, '#f8fafc');
            hullGrad.addColorStop(1, '#bae6fd');
            ctx.fillStyle = hullGrad;
            ctx.beginPath();
            ctx.moveTo(-halfW, -8);
            ctx.lineTo(halfW, -8);
            ctx.quadraticCurveTo(halfW + 6 * absBf, 2 + keelDrop, keelW, 8 + keelDrop);
            ctx.lineTo(-keelW, 8 + keelDrop);
            ctx.quadraticCurveTo(-halfW - 2 * absBf, 2 + keelDrop, -halfW, -8);
            ctx.closePath();
            ctx.fill();

            // 优雅天鹅颈船首 (平滑横扫至朝向前端)
            const neckBaseX = 30 * safeBf;
            const neckTopX = 42 * safeBf;
            const neckOuterX = 48 * safeBf;
            const neckY = -26 + frontView * 3.8;
            ctx.fillStyle = '#f8fafc';
            ctx.beginPath();
            ctx.moveTo(neckBaseX - 6 * safeBf, -8);
            ctx.lineTo(neckBaseX + 4 * safeBf, -8);
            ctx.quadraticCurveTo(neckOuterX, -22 + frontView * 2.5, neckTopX, neckY);
            ctx.quadraticCurveTo(neckOuterX - 4 * safeBf, -10 + frontView * 2, neckBaseX - safeBf, 4 + keelDrop * 0.5);
            ctx.closePath();
            ctx.fill();

            // 金色羽翼雕花纹饰
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(-28 * safeBf, -2);
            ctx.quadraticCurveTo(0, 3 + keelDrop * 0.4, 28 * safeBf, -4);
            ctx.stroke();
        } else {
            // 经典橡木小艇 (rowboat)
            const halfW = 36 * hullSpan;
            const keelW = 25 * hullSpan;
            const keelDrop = frontView * 2.2;
            const bowSign = safeBf >= 0 ? 1 : -1;
            const prowShift = safeBf * 6;
            const leftTopX = -halfW + (safeBf < 0 ? prowShift : 0);
            const rightTopX = halfW + (safeBf > 0 ? prowShift : 0);
            const leftTopY = safeBf < 0 ? -8 - 4 * absBf : -8;
            const rightTopY = safeBf > 0 ? -8 - 4 * absBf : -8;

            const woodGrad = ctx.createLinearGradient(0, -10, 0, 10 + keelDrop);
            woodGrad.addColorStop(0, '#b45309');
            woodGrad.addColorStop(0.55, '#92400e');
            woodGrad.addColorStop(1, '#451a03');
            ctx.fillStyle = woodGrad;
            ctx.beginPath();
            ctx.moveTo(leftTopX, leftTopY);
            ctx.lineTo(rightTopX, rightTopY);
            ctx.quadraticCurveTo(rightTopX - bowSign * 2, 7 + keelDrop, keelW, 8 + keelDrop);
            ctx.lineTo(-keelW, 8 + keelDrop);
            ctx.quadraticCurveTo(leftTopX + bowSign * 2, 7 + keelDrop, leftTopX, leftTopY);
            ctx.closePath();
            ctx.fill();

            // 船舱内沿椭圆立体感
            ctx.fillStyle = 'rgba(69, 26, 3, 0.45)';
            ctx.beginPath();
            ctx.ellipse(0, -7.5, halfW * 0.78, 2.2 + frontView * 1.2, 0, 0, Math.PI * 2);
            ctx.fill();

            // 正面转身时船首龙骨脊线高光
            if (frontView > 0.1) {
                ctx.strokeStyle = `rgba(217, 119, 6, ${(frontView * 0.65).toFixed(2)})`;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(safeBf * 14, -8);
                ctx.lineTo(safeBf * 12, 8 + keelDrop);
                ctx.stroke();
            }

            // 船舷亮木条与铜环
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.moveTo(leftTopX + 1, leftTopY + 1);
            ctx.lineTo(rightTopX - 1, rightTopY + 1);
            ctx.stroke();
        }

        ctx.restore();
    }

    /**
     * 绘制 2.5D 船桨与船边星尘前景
     */
    function renderBoatForeground(ctx, screenX, footY, bf, boatType, game, t) {
        const safeBf = clamp(bf, -1, 1);
        const absBf = Math.abs(safeBf);
        const frontView = 1 - absBf;
        const moveBlend = clamp(typeof game.moveBlend === 'number' ? game.moveBlend : (game.pose === 'row' ? 1 : 0), 0, 1);
        const pitch = game.boatPitch || 0;

        ctx.save();
        ctx.translate(screenX, footY);
        ctx.rotate(pitch);

        const strokeAngle = Math.sin(game.walkCycle) * 0.48 * moveBlend + 0.25 * (1 - moveBlend);
        const rudderAngle = clamp(-(game.boatFacingVel || 0) * 0.14, -0.42, 0.42);
        const oarAngle = strokeAngle + rudderAngle;

        ctx.save();
        ctx.translate(4 * safeBf, -6 + frontView * 2);

        const projSign = safeBf >= 0 ? 1 : -1;
        const reachScale = projSign * (0.28 + 0.72 * absBf);
        const rotAngle = oarAngle * (0.55 + 0.45 * absBf);
        const cosA = Math.cos(rotAngle);
        const sinA = Math.sin(rotAngle);
        const mapX = (lx, ly) => (lx * cosA - ly * sinA) * reachScale;
        const mapY = (lx, ly) => lx * sinA + ly * cosA;

        const hX = mapX(-4, -8);
        const hY = mapY(-4, -8);
        const tipX = mapX(12, 12);
        const tipY = mapY(12, 12);

        ctx.strokeStyle = boatType === 'spirit_boat' ? '#38bdf8' : '#d97706';
        ctx.lineWidth = 2.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(hX, hY);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();

        // 桨叶
        const bladeX = mapX(13, 13);
        const bladeY = mapY(13, 13);
        ctx.fillStyle = boatType === 'spirit_boat' ? '#bae6fd' : '#92400e';
        ctx.beginPath();
        ctx.ellipse(bladeX, bladeY, 2.2 + 2.8 * absBf, 2.6, (0.75 + rotAngle) * reachScale, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // 星辉画舫四周漂浮的星尘光点
        if (boatType === 'spirit_boat') {
            for (let i = 0; i < 4; i++) {
                const px = (-26 + i * 16) * (0.45 + 0.55 * absBf) + Math.sin(t * 3 + i) * 4;
                const py = 2 + Math.cos(t * 2.5 + i) * 3;
                ctx.fillStyle = i % 2 === 0 ? '#fde047' : '#38bdf8';
                ctx.beginPath();
                ctx.arc(px, py, 1.6, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        ctx.restore();
    }

    /**
     * 绘制五阶进化物理弯曲鱼竿 (与 WWF.getRodTip 世界坐标严格一致)
     */
    function renderFishingRod(ctx, camX, player, game) {
        const rod = WWF.getRodTip();
        const bx = rod.baseX - camX;
        const by = rod.baseY;
        const tx = rod.tipX - camX;
        const ty = rod.tipY;

        const lvlIdx = Math.max(0, Math.min(ROD_VISUALS.length - 1, (player.rodLevel || 1) - 1));
        const style = ROD_VISUALS[lvlIdx];

        ctx.save();

        // 鱼竿握把
        ctx.strokeStyle = style.handle;
        ctx.lineWidth = 4.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + (tx - bx) * 0.16, by + (ty - by) * 0.16);
        ctx.stroke();

        // 鱼竿主竿身 (二次贝塞尔曲线体现韧性弯曲 + 转身甩竿柔性弯曲)
        const turnWhip = clamp(-(game.rodFacingVel || 0) * 1.6, -14, 14);
        const ctrlX = (bx + tx) * 0.5 + turnWhip;
        let ctrlY = Math.min(by, ty) - 10;
        if (game.state === 'REELING') {
            ctrlY -= 12 + (game.reelTension || 0) * 8;
        }

        if (style.glow) {
            ctx.strokeStyle = style.glow;
            ctx.lineWidth = 6.5;
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.quadraticCurveTo(ctrlX, ctrlY, tx, ty);
            ctx.stroke();
        }

        const rodGrad = ctx.createLinearGradient(bx, by, tx, ty);
        rodGrad.addColorStop(0, style.shaft);
        rodGrad.addColorStop(1, style.tip);
        ctx.strokeStyle = rodGrad;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(ctrlX, ctrlY, tx, ty);
        ctx.stroke();

        // 竿尖发光导环点
        ctx.fillStyle = style.tip;
        ctx.beginPath();
        ctx.arc(tx, ty, 2.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    /**
     * 最上层：渲染前景雨丝粒子与黄金鱼潮水雾光效
     */
    function renderForegroundWeatherAndGoldenTide(ctx, cw, ch, waterY, weatherId, camX, t, game) {
        // 1. 黄金鱼潮星光气泡与水面金雾 (轻量光晕圆替代 shadowBlur)
        if (game.goldenTideTimer > 0 || scenePool.goldenBubbles.length > 0) {
            ctx.save();
            for (const gb of scenePool.goldenBubbles) {
                const sx = gb.worldX - camX;
                if (sx < -20 || sx > cw + 20) continue;
                ctx.globalAlpha = Math.max(0, gb.alpha);
                ctx.fillStyle = 'rgba(245, 158, 11, 0.28)';
                ctx.beginPath();
                ctx.arc(sx, gb.y, gb.r * 2.1, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#fde047';
                ctx.beginPath();
                ctx.arc(sx, gb.y, gb.r, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        // 2. 前景斜落雨丝 (rain / storm，分 3 透明度桶合批绘制)
        if (weatherId === 'rain' || weatherId === 'storm') {
            const isStorm = weatherId === 'storm';
            const slantX = isStorm ? -9 : -5;
            const bucketAlphas = [0.32, 0.48, 0.66];
            const buckets = [[], [], []];
            for (let i = 0; i < scenePool.raindrops.length; i++) {
                const drop = scenePool.raindrops[i];
                const bIdx = drop.alpha < 0.4 ? 0 : (drop.alpha < 0.56 ? 1 : 2);
                buckets[bIdx].push(drop);
            }
            ctx.save();
            ctx.strokeStyle = isStorm ? 'rgb(186, 230, 253)' : 'rgb(224, 242, 254)';
            ctx.lineWidth = isStorm ? 1.6 : 1.2;
            ctx.lineCap = 'round';
            for (let b = 0; b < 3; b++) {
                const bucket = buckets[b];
                if (bucket.length === 0) continue;
                ctx.globalAlpha = bucketAlphas[b] * (isStorm ? 1.0 : 0.85);
                ctx.beginPath();
                for (let i = 0; i < bucket.length; i++) {
                    const drop = bucket[i];
                    ctx.moveTo(drop.x, drop.y);
                    ctx.lineTo(drop.x + slantX, drop.y + drop.len);
                }
                ctx.stroke();
            }
            ctx.restore();
        }
    }

})();
