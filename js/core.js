/**
 * ============================================================================
 * 《微风垂钓物语 2.0》核心数据契约与全局命名空间 (js/core.js)
 * ============================================================================
 * 负责维护 4 大并行模块共享的状态对象：
 * - Module 1 (js/art_audio.js): 鱼类/装备/装扮数据库、动态 SVG/Canvas 鱼渲染、Tone.js 声学系统
 * - Module 2 (js/scene_character.js): 2400px 横向多生态地图、自由移动/划船、动态天气粒子、关节化人物与换装渲染
 * - Module 3 (js/gameplay_physics.js): 动态概率引擎、性格化遛鱼 AI 2.0、跃水 QTE、破水飞鱼演出
 * - Module 4 (js/ui_aquarium.js): 存档、多选渔获结算、鱼篓、互动水族箱、老船长悬赏订单、商店与输入控制
 */
(function () {
    'use strict';

    const WWF = window.WWF = window.WWF || {};

    WWF.SAVE_KEY = 'whispering_waters_fishing_v2';
    WWF.LEGACY_SAVE_KEY = 'whispering_waters_fishing_v1';

    // ------------------------------------------------------------------------
    // 四大横向生态钓点定义 (总世界宽度 2400px)
    // ------------------------------------------------------------------------
    WWF.WORLD_WIDTH = 2400;

    WWF.BIOMES = [
        {
            id: 'reed',
            index: 0,
            name: '芦苇浅滩',
            icon: '🌾',
            minX: 0,
            maxX: 600,
            requiresBoat: false,
            baseDepthBonus: 0,
            desc: '阳光温暖的岸边浅滩，水草丰茂，适合新手垂钓溪流与浅水鱼群。',
            waterTint: 'rgba(16, 185, 129, 0.12)'
        },
        {
            id: 'pier',
            index: 1,
            name: '微风木栈桥',
            icon: '🌉',
            minX: 600,
            maxX: 1200,
            requiresBoat: false,
            baseDepthBonus: 1,
            desc: '延伸入湖的古老木栈桥，水深适中，锦鲤与路亚名鱼常在此巡游。',
            waterTint: 'rgba(14, 165, 233, 0.10)'
        },
        {
            id: 'islet',
            index: 2,
            name: '翡翠湖心岛',
            icon: '🏝️',
            minX: 1200,
            maxX: 1800,
            requiresBoat: true,
            baseDepthBonus: 1,
            desc: '需乘船前往的静谧湖心绿洲，四周环绕深水暗流，珍稀鱼种频出。',
            waterTint: 'rgba(6, 182, 212, 0.16)'
        },
        {
            id: 'abyss',
            index: 3,
            name: '星渊沉船湾',
            icon: '⚓',
            minX: 1800,
            maxX: 2400,
            requiresBoat: true,
            baseDepthBonus: 2,
            desc: '远古沉船静卧的深邃海湾，潜藏着传说巨物与沐浴星辉的神话鱼王。',
            waterTint: 'rgba(99, 102, 241, 0.18)'
        }
    ];

    // ------------------------------------------------------------------------
    // 动态天气系统配置
    // ------------------------------------------------------------------------
    WWF.WEATHERS = {
        sunny: {
            id: 'sunny',
            name: '晴空微风',
            icon: '☀️',
            desc: '风和日丽，各品级鱼群活跃均衡',
            multipliers: { common: 1.0, rare: 1.0, epic: 1.0, legendary: 1.0, mythic: 1.0 },
            shinyBoost: 1.0
        },
        rain: {
            id: 'rain',
            name: '烟雨蒙蒙',
            icon: '🌧️',
            desc: '雨水富含氧气，稀有与史诗鱼活跃度 +35%',
            multipliers: { common: 0.78, rare: 1.35, epic: 1.40, legendary: 1.25, mythic: 1.20 },
            shinyBoost: 1.4
        },
        storm: {
            id: 'storm',
            name: '雷暴狂澜',
            icon: '⛈️',
            desc: '惊雷激荡深水，史诗与传说巨物出没概率飙升！',
            multipliers: { common: 0.50, rare: 1.15, epic: 1.75, legendary: 2.20, mythic: 1.90 },
            shinyBoost: 2.0
        },
        meteor: {
            id: 'meteor',
            name: '星陨极光夜',
            icon: '🌠',
            desc: '流星划破天际，神话鱼与闪光异色鱼概率成倍觉醒！',
            multipliers: { common: 0.40, rare: 0.90, epic: 1.60, legendary: 2.60, mythic: 3.80 },
            shinyBoost: 3.5
        }
    };

    // ------------------------------------------------------------------------
    // 玩家持久化状态对象 (WWF.player)
    // ------------------------------------------------------------------------
    WWF.player = {
        coins: 80,
        luckPoints: 0,          // 放生鱼儿积攒的祈福幸运值（提高闪光与高稀有概率）
        pityCounter: 0,         // 保底计数：连续未出史诗以上鱼时逐渐提高高稀有度权重
        rodLevel: 1,
        reelLevel: 1,
        selectedBait: 'dough',
        baits: {
            dough: Infinity,
            worm: 5,
            gold: 1,
            star: 0
        },
        records: {},            // { fishId: { count, maxKg, maxLen, shinyCount } }
        themeIndex: 0,          // 0: 晨曦, 1: 落日, 2: 星夜
        weatherId: 'sunny',     // sunny | rain | storm | meteor
        muted: false,

        // 自由移动与船只系统
        worldX: 760,            // 初始位于微风木栈桥
        inBoat: false,
        unlockedBoats: ['none'], // 'none', 'rowboat', 'spirit_boat'
        equippedBoat: 'none',

        // 角色纸娃娃装扮系统
        unlockedHats: ['straw'],        // 'straw', 'captain', 'frog', 'star_crown'
        equippedHat: 'straw',
        unlockedOutfits: ['casual'],    // 'casual', 'raincoat', 'sailor', 'master_robe'
        equippedOutfit: 'casual',

        // 鱼篓、水族箱与悬赏订单
        basket: [],             // 存放暂未售出的鱼 [{ uid, fishId, name, rarity, lengthCm, weightKg, value, isShiny, caughtAt }]
        aquarium: [],           // 放入水族箱观赏的鱼 (最多 aquariumCapacity 条)
        aquariumLevel: 1,       // 水族箱等级 (决定容量与每分钟观赏收益)
        aquariumUnclaimedCoins: 0,
        bountyOrders: [],       // 老船长悬赏订单列表
        completedOrdersCount: 0
    };

    // ------------------------------------------------------------------------
    // 运行时垂钓与世界物理状态机 (WWF.game)
    // ------------------------------------------------------------------------
    WWF.game = {
        // 状态机: IDLE | CHARGING | CASTING | WAITING | BITING | REELING | LEAPING | RESULT
        state: 'IDLE',
        time: 0,
        isHolding: false,

        // 角色移动与相机跟随
        moveLeft: false,
        moveRight: false,
        lastMoveDir: 0,         // SOCD 后按优先方向: -1 | 0 | 1
        facing: 1,              // 1: 朝右, -1: 朝左
        visualFacing: 1,        // [-1, 1] 2.5D 角色转身插值
        visualFacingVel: 0,
        boatFacing: 1,          // [-1, 1] 船体水阻慢速转身插值
        boatFacingVel: 0,
        rodFacing: 1,           // [-1.08, 1.08] 鱼竿随动回弹与竿尖延迟
        rodFacingVel: 0,
        boatPitch: 0,           // 船体加减速纵倾与转向摇晃 (rad)
        boatPitchVel: 0,
        bodyLean: 0,            // 连续世界空间躯干前倾/后仰角 (rad)
        turnBounce: 0,          // 0..1 转向垫步微跳衰减
        moveBlend: 0,           // 0..1 步伐/划桨幅度平滑过渡
        idleBobberSwingX: 0,    // 闲置垂挂浮漂摆锤横向偏移
        idleBobberSwingVx: 0,
        vx: 0,
        cameraX: 360,
        cameraLookAhead: 0,
        cameraLookAheadVel: 0,
        facingHoldTime: 0,
        facingTravelDist: 0,
        walkCycle: 0,
        pose: 'idle',           // idle | walk | row | charge | cast | wait | bite | reel | celebrate

        // 动态天气与黄金鱼潮事件
        weatherTimer: 120,      // 自动天气轮换倒计时
        goldenTideTimer: 0,     // > 0 时处于“黄金鱼潮”狂欢（持续 60 秒，稀有鱼权重 & 收益翻倍）
        nextTideCooldown: 75,
        screenShake: 0,         // 镜头震动强度

        // 蓄力与抛竿参数
        chargePower: 0,
        chargeDir: 1,
        castProgress: 0,
        castStartX: 0,
        castStartY: 0,
        bobberX: 880,           // 世界坐标系下的浮漂 X
        bobberY: 260,
        targetBobberX: 880,
        targetBobberY: 260,
        depthZone: 1,           // 0=浅水, 1=中水, 2=深水

        // 等待与咬钩参数
        waitTimer: 0,
        nextNibbleTimer: 0,
        biteTimer: 0,
        bobberDip: 0,
        approachingFish: null,

        // 遛鱼博弈 2.0 (含性格化技能与跃水 QTE)
        hookedRoll: null,       // 当前上钩结果
        reelFishPos: 0.5,
        reelFishTarget: 0.5,
        reelFishTimer: 0,
        reelZonePos: 0.4,
        reelZoneVel: 0,
        reelProgress: 0.30,
        reelTension: 0,
        inZone: false,
        reelSoundTick: 0,

        // 鱼类性格状态: 'normal' | 'dash' (冲刺) | 'sink' (沉底阻尼) | 'illusion' (变速) | 'stunned' (QTE击晕)
        fishSkillState: 'normal',
        fishSkillTimer: 0,
        qteActive: false,       // 是否正在触发跃水 QTE
        qteTimer: 0,
        qteMaxTime: 1.25,
        qteWorldX: 0,
        qteWorldY: 0,

        // 破水飞鱼演出 (LEAPING 阶段)
        leapProgress: 0,
        leapStartX: 0,
        leapStartY: 0,
        leapEndX: 0,
        leapEndY: 0,
        leapParticles: []
    };

    // ------------------------------------------------------------------------
    // 跨模块工具函数：根据世界 X 坐标获取所属生态区
    // ------------------------------------------------------------------------
    WWF.getBiomeAtX = function (worldX) {
        const clamped = Math.max(0, Math.min(WWF.WORLD_WIDTH - 1, worldX));
        for (const b of WWF.BIOMES) {
            if (clamped >= b.minX && clamped < b.maxX) return b;
        }
        return WWF.BIOMES[WWF.BIOMES.length - 1];
    };

    WWF.getCurrentBiome = function () {
        return WWF.getBiomeAtX(WWF.player.worldX);
    };

})();
