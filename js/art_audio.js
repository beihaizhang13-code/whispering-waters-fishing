/**
 * ============================================================================
 * 《微风垂钓物语 2.0》模块 1：鱼类美术资产与程序化声学系统 (js/art_audio.js)
 * ============================================================================
 * 包含：
 * 1. RARITIES, BAITS, ROD_UPGRADES, REEL_UPGRADES, BOATS, HATS, OUTFITS, AQUARIUM_UPGRADES
 * 2. 20 种跨生态/天气/性格鱼类数据库 (FISH_SPECIES)
 * 3. 动态摆尾与闪光异色 (Shiny) 矢量鱼 SVG 生成器 (createFishSVG)
 * 4. Canvas 2D 动态矢量鱼直接绘制器 (drawCanvasFish，供飞鱼演出与动态水族箱调用)
 * 5. Tone.js 进阶程序化音效合成引擎 (Sound，含棘轮收线音、QTE 和弦、划桨水声等)
 */
(function () {
    'use strict';

    const WWF = window.WWF = window.WWF || {};
    const SharedCatalog = (typeof window !== 'undefined' && window.WWF_SHARED && window.WWF_SHARED.GameCatalog)
        ? window.WWF_SHARED.GameCatalog
        : null;

    // ------------------------------------------------------------------------
    // 1. 稀有度定义（含放生幸运奖励 & 水族箱每分钟门票收益）
    // ------------------------------------------------------------------------
    const DEFAULT_RARITIES = {
        common: {
            name: '普通',
            en: 'COMMON',
            color: '#cbd5e1',
            badgeBg: 'bg-slate-700 text-slate-200',
            cardClass: 'rarity-common',
            glow: '#94a3b8',
            luckReward: 1,
            aquariumIncome: 6
        },
        rare: {
            name: '稀有',
            en: 'RARE',
            color: '#38bdf8',
            badgeBg: 'bg-sky-500/25 text-sky-300 border border-sky-400/40',
            cardClass: 'rarity-rare',
            glow: '#38bdf8',
            luckReward: 2,
            aquariumIncome: 15
        },
        epic: {
            name: '史诗',
            en: 'EPIC',
            color: '#c084fc',
            badgeBg: 'bg-purple-500/25 text-purple-300 border border-purple-400/40',
            cardClass: 'rarity-epic',
            glow: '#a855f7',
            luckReward: 4,
            aquariumIncome: 36
        },
        legendary: {
            name: '传说',
            en: 'LEGENDARY',
            color: '#fbbf24',
            badgeBg: 'bg-amber-500/25 text-amber-300 border border-amber-400/50',
            cardClass: 'rarity-legendary',
            glow: '#f59e0b',
            luckReward: 7,
            aquariumIncome: 85
        },
        mythic: {
            name: '神话',
            en: 'MYTHIC',
            color: '#f472b6',
            badgeBg: 'bg-pink-500/25 text-pink-200 border border-pink-400/60',
            cardClass: 'rarity-mythic',
            glow: '#ec4899',
            luckReward: 12,
            aquariumIncome: 200
        }
    };

    WWF.RARITIES = SharedCatalog
        ? Object.fromEntries(
            Object.entries(DEFAULT_RARITIES).map(([k, uiDef]) => [
                k,
                { ...uiDef, ...(SharedCatalog.RARITIES[k] || {}) }
            ])
        )
        : DEFAULT_RARITIES;

    // ------------------------------------------------------------------------
    // 2. 特制鱼饵配置
    // ------------------------------------------------------------------------
    WWF.BAITS = [
        {
            id: 'dough',
            name: '普通面团',
            icon: '⚪',
            price: 0,
            packSize: 0,
            desc: '免费的基础麦香饵，适合新手熟悉各海域手感。',
            multipliers: { common: 1.0, rare: 1.0, epic: 1.0, legendary: 1.0, mythic: 1.0 }
        },
        {
            id: 'worm',
            name: '活红虫饵',
            icon: '🪱',
            price: 25,
            packSize: 5,
            desc: '鲜活诱人，稀有与史诗鱼上钩概率大幅提高。',
            multipliers: { common: 0.62, rare: 1.55, epic: 1.90, legendary: 1.80, mythic: 1.70 }
        },
        {
            id: 'gold',
            name: '黄金秘制饵',
            icon: '✨',
            price: 90,
            packSize: 5,
            desc: '老船长祖传配方，过滤杂鱼，专攻史诗与传说大物！',
            multipliers: { common: 0.22, rare: 0.95, epic: 2.50, legendary: 3.80, mythic: 4.50 }
        },
        {
            id: 'star',
            name: '星辰幻梦饵',
            icon: '🌟',
            price: 240,
            packSize: 3,
            desc: '散发星辉的奇幻鱼饵，传说与神话鱼概率成倍飙升！',
            multipliers: { common: 0.05, rare: 0.45, epic: 1.60, legendary: 5.50, mythic: 11.50 }
        }
    ];

    // ------------------------------------------------------------------------
    // 3. 钓竿与卷线器升级路线
    // ------------------------------------------------------------------------
    WWF.ROD_UPGRADES = [
        { level: 1, name: '木制钓竿', price: 0, zoneSize: 0.25, maxDistBonus: 0, color: '#a16207', desc: '轻巧的入门竹木竿' },
        { level: 2, name: '玻璃钢钓竿', price: 120, zoneSize: 0.30, maxDistBonus: 0.08, color: '#0284c7', desc: '捕获判定区 +20%，抛投更远' },
        { level: 3, name: '碳纤维轻竿', price: 320, zoneSize: 0.35, maxDistBonus: 0.16, color: '#475569', desc: '捕获判定区 +40%，深水轻松触及' },
        { level: 4, name: '海王合金竿', price: 750, zoneSize: 0.40, maxDistBonus: 0.24, color: '#d97706', desc: '捕获判定区 +60%，对抗传说大鱼利器' },
        { level: 5, name: '星辉大师竿', price: 1600, zoneSize: 0.46, maxDistBonus: 0.32, color: '#e879f9', desc: '顶级大师钓竿，捕获区超宽容' }
    ];

    WWF.REEL_UPGRADES = [
        { level: 1, name: '简易手摇轮', price: 0, fillRate: 0.24, drainRate: 0.14, desc: '基础收线速度' },
        { level: 2, name: '滚珠轴承轮', price: 110, fillRate: 0.29, drainRate: 0.125, desc: '收线进度更快，不易脱钩' },
        { level: 3, name: '高速纺车轮', price: 290, fillRate: 0.34, drainRate: 0.11, desc: '稳定锁死狂躁大鱼的挣扎' },
        { level: 4, name: '磁力刹车轮', price: 680, fillRate: 0.40, drainRate: 0.095, desc: '极速收线，张力控制行云流水' },
        { level: 5, name: '龙吟涡轮卷', price: 1450, fillRate: 0.48, drainRate: 0.08, desc: '传说级卷线器，收线如履平地' }
    ];

    // ------------------------------------------------------------------------
    // 4. 远航船只、角色头饰与服饰换装配置
    // ------------------------------------------------------------------------
    WWF.BOATS = [
        {
            id: 'none',
            name: '徒步岸钓',
            icon: '🥾',
            price: 0,
            speedBonus: 1.0,
            luckBonus: 0,
            hullColor: '#78350f',
            trimColor: '#b45309',
            desc: '在芦苇浅滩与微风木栈桥自由漫步'
        },
        {
            id: 'rowboat',
            name: '橡木轻便小艇',
            icon: '🚣',
            price: 150,
            speedBonus: 1.35,
            luckBonus: 0.08,
            hullColor: '#92400e',
            trimColor: '#f59e0b',
            desc: '解锁外海航行！可前往翡翠湖心岛与星渊沉船湾，移速+35%，稀有幸运+8%'
        },
        {
            id: 'spirit_boat',
            name: '星辉天鹅画舫',
            icon: '🦢',
            price: 580,
            speedBonus: 1.75,
            luckBonus: 0.25,
            hullColor: '#e0f2fe',
            trimColor: '#38bdf8',
            desc: '自带星光诱鱼光环的华丽画舫，移速+75%，高稀有与闪光异色率额外+25%'
        }
    ];

    WWF.HATS = [
        {
            id: 'straw',
            name: '田园草帽',
            icon: '👒',
            price: 0,
            color: '#eab308',
            bandColor: '#ef4444',
            desc: '透气防晒的经典麦秆草帽'
        },
        {
            id: 'captain',
            name: '老船长大檐帽',
            icon: '🧢',
            price: 140,
            color: '#f8fafc',
            bandColor: '#1e3a8a',
            desc: '威风凛凛的黄金锚徽航海船长帽'
        },
        {
            id: 'frog',
            name: '青蛙荷叶兜帽',
            icon: '🐸',
            price: 260,
            color: '#22c55e',
            bandColor: '#dcfce7',
            desc: '雨天垂钓最可爱的幸运蛙蛙头套'
        },
        {
            id: 'star_crown',
            name: '星辰幻梦冠',
            icon: '👑',
            price: 640,
            color: '#fbbf24',
            bandColor: '#f472b6',
            desc: '流转着银河微光的传奇垂钓王者头冠'
        }
    ];

    WWF.OUTFITS = [
        {
            id: 'casual',
            name: '海风亚麻衫',
            icon: '👕',
            price: 0,
            primary: '#1e293b',
            secondary: '#38bdf8',
            desc: '轻便舒适的日常垂钓服'
        },
        {
            id: 'raincoat',
            name: '明黄防风小雨衣',
            icon: '🧥',
            price: 150,
            primary: '#eab308',
            secondary: '#fef08a',
            desc: '在烟雨与雷暴天气中格外醒目可爱'
        },
        {
            id: 'sailor',
            name: '湛蓝水手礼服',
            icon: '⚓',
            price: 320,
            primary: '#1d4ed8',
            secondary: '#f8fafc',
            desc: '经典蓝白条纹领远航水手制服'
        },
        {
            id: 'master_robe',
            name: '绯红龙纹羽织',
            icon: '👘',
            price: 720,
            primary: '#991b1b',
            secondary: '#fbbf24',
            desc: '唯有制霸全海域的垂钓宗师方能驾驭'
        }
    ];

    // ------------------------------------------------------------------------
    // 5. 水族箱扩建等级配置
    // ------------------------------------------------------------------------
    WWF.AQUARIUM_UPGRADES = [
        { level: 1, name: '桌面玻璃生态缸', capacity: 4, incomeMult: 1.0, price: 0, desc: '可容纳 4 条观赏鱼，基础门票收益' },
        { level: 2, name: '全景珊瑚水族箱', capacity: 6, incomeMult: 1.25, price: 180, desc: '容量扩至 6 条，门票收益 +25%' },
        { level: 3, name: '深海琉璃展览馆', capacity: 9, incomeMult: 1.55, price: 420, desc: '容量扩至 9 条，门票收益 +55%' },
        { level: 4, name: '皇家海底观光厅', capacity: 12, incomeMult: 1.90, price: 850, desc: '容量扩至 12 条，门票收益 +90%' },
        { level: 5, name: '星海梦幻水晶宫', capacity: 16, incomeMult: 2.50, price: 1600, desc: '顶级 16 条容量，门票收益 +150%' }
    ];

    // ------------------------------------------------------------------------
    // 6. 20 种跨生态/天气/性格鱼类数据库
    //    skillType: 'steady' (稳健型) | 'dasher' (冲刺跃水型) | 'sinker' (沉底巨物型) | 'illusion' (幻影变速型)
    //    prefBiome: 0=芦苇浅滩, 1=微风木栈桥, 2=翡翠湖心岛, 3=星渊沉船湾
    // ------------------------------------------------------------------------
    WWF.FISH_SPECIES = [
        // --- 普通 Common (4 种) ---
        {
            id: 'minnow', name: '溪流白条', rarity: 'common', baseWeight: 160,
            prefDepth: 0, prefBiome: 0, prefWeather: 'any', skillType: 'steady',
            minLen: 10, maxLen: 22, minKg: 0.05, maxKg: 0.18, baseValue: 10,
            difficulty: 0.22, speed: 0.35, erratic: 0.25,
            shape: 'long', bodyColor: '#cbd5e1', bellyColor: '#f8fafc', finColor: '#94a3b8', pattern: 'none',
            desc: '游动轻快的小型银色淡水鱼，经常成群结队在芦苇浅滩嬉戏。'
        },
        {
            id: 'crucian', name: '金背鲫鱼', rarity: 'common', baseWeight: 150,
            prefDepth: 0, prefBiome: 0, prefWeather: 'any', skillType: 'steady',
            minLen: 16, maxLen: 34, minKg: 0.20, maxKg: 1.10, baseValue: 15,
            difficulty: 0.28, speed: 0.40, erratic: 0.30,
            shape: 'oval', bodyColor: '#d6b47c', bellyColor: '#fef3c7', finColor: '#a88450', pattern: 'scales',
            desc: '垂钓者最熟悉的老朋友，性格温和，炖汤鲜美无比。'
        },
        {
            id: 'perch', name: '条纹河鲈', rarity: 'common', baseWeight: 115,
            prefDepth: 1, prefBiome: 1, prefWeather: 'any', skillType: 'dasher',
            minLen: 20, maxLen: 42, minKg: 0.35, maxKg: 1.80, baseValue: 20,
            difficulty: 0.34, speed: 0.48, erratic: 0.35,
            shape: 'oval', bodyColor: '#65a30d', bellyColor: '#ecfccb', finColor: '#ea580c', pattern: 'stripes',
            desc: '体侧带有醒目暗绿色虎纹，常在木栈桥下巡游，咬钩干脆利落。'
        },
        {
            id: 'loach', name: '花斑泥鳅', rarity: 'common', baseWeight: 95,
            prefDepth: 0, prefBiome: 0, prefWeather: 'rain', skillType: 'illusion',
            minLen: 14, maxLen: 28, minKg: 0.08, maxKg: 0.35, baseValue: 18,
            difficulty: 0.38, speed: 0.52, erratic: 0.50,
            shape: 'long', bodyColor: '#926c48', bellyColor: '#e7d5be', finColor: '#785535', pattern: 'spots',
            desc: '滑溜溜的小家伙，每逢烟雨天气便格外活跃，喜欢在水底扭来扭去。'
        },

        // --- 稀有 Rare (5 种) ---
        {
            id: 'bluegill', name: '蓝鳃太阳鱼', rarity: 'rare', baseWeight: 80,
            prefDepth: 0, prefBiome: 0, prefWeather: 'sunny', skillType: 'steady',
            minLen: 18, maxLen: 32, minKg: 0.30, maxKg: 1.30, baseValue: 34,
            difficulty: 0.44, speed: 0.56, erratic: 0.45,
            shape: 'round', bodyColor: '#0284c7', bellyColor: '#fb923c', finColor: '#38bdf8', pattern: 'stripes',
            desc: '阳光下鳃盖闪烁着宝石般的蓝晕，腹部泛着温暖的橘光。'
        },
        {
            id: 'emerald_puffer', name: '翡翠胖河豚', rarity: 'rare', baseWeight: 70,
            prefDepth: 0, prefBiome: 0, prefWeather: 'any', skillType: 'steady',
            minLen: 15, maxLen: 30, minKg: 0.40, maxKg: 1.60, baseValue: 42,
            difficulty: 0.46, speed: 0.54, erratic: 0.48,
            shape: 'round', bodyColor: '#10b981', bellyColor: '#fef9c3', finColor: '#34d399', pattern: 'spots',
            desc: '受到惊吓就会鼓成圆滚滚的翠绿气球，放入水族箱观赏极具喜感！'
        },
        {
            id: 'trout', name: '星点虹鳟', rarity: 'rare', baseWeight: 72,
            prefDepth: 1, prefBiome: 1, prefWeather: 'rain', skillType: 'dasher',
            minLen: 32, maxLen: 68, minKg: 0.90, maxKg: 4.50, baseValue: 46,
            difficulty: 0.52, speed: 0.65, erratic: 0.52,
            shape: 'long', bodyColor: '#64748b', bellyColor: '#f472b6', finColor: '#94a3b8', pattern: 'spots',
            desc: '体侧贯穿着一道淡粉色虹彩，微雨时分常跃出水面捕食飞虫。'
        },
        {
            id: 'bass', name: '大口黑鲈', rarity: 'rare', baseWeight: 65,
            prefDepth: 1, prefBiome: 1, prefWeather: 'any', skillType: 'dasher',
            minLen: 35, maxLen: 72, minKg: 1.20, maxKg: 6.20, baseValue: 54,
            difficulty: 0.56, speed: 0.72, erratic: 0.60,
            shape: 'oval', bodyColor: '#3f6212', bellyColor: '#d9f99d', finColor: '#4d7c0f', pattern: 'stripeBand',
            desc: '极具爆发力的路亚名鱼，中钩后会猛烈冲刺甚至跃出水面洗鳃！'
        },
        {
            id: 'koi', name: '三色锦鲤', rarity: 'rare', baseWeight: 55,
            prefDepth: 1, prefBiome: 2, prefWeather: 'any', skillType: 'steady',
            minLen: 38, maxLen: 78, minKg: 1.50, maxKg: 7.50, baseValue: 66,
            difficulty: 0.50, speed: 0.62, erratic: 0.48,
            shape: 'koi', bodyColor: '#f8fafc', bellyColor: '#ef4444', finColor: '#fb923c', pattern: 'koiSpots',
            desc: '红白黑三色斑纹宛如水墨画卷，常在翡翠湖心岛畔悠然游弋。'
        },

        // --- 史诗 Epic (5 种) ---
        {
            id: 'golden_carp', name: '黄金锦鲤', rarity: 'epic', baseWeight: 48,
            prefDepth: 1, prefBiome: 1, prefWeather: 'sunny', skillType: 'steady',
            minLen: 48, maxLen: 92, minKg: 3.20, maxKg: 12.50, baseValue: 118,
            difficulty: 0.64, speed: 0.80, erratic: 0.62,
            shape: 'koi', bodyColor: '#facc15', bellyColor: '#fef08a', finColor: '#f59e0b', pattern: 'scales',
            desc: '通体流光溢彩的黄金鱼鳞，在湖面下犹如一块游动的纯金。'
        },
        {
            id: 'coral_seahorse', name: '七彩珊瑚海马', rarity: 'epic', baseWeight: 42,
            prefDepth: 1, prefBiome: 2, prefWeather: 'any', skillType: 'illusion',
            minLen: 24, maxLen: 48, minKg: 0.60, maxKg: 2.40, baseValue: 132,
            difficulty: 0.66, speed: 0.84, erratic: 0.70,
            shape: 'koi', bodyColor: '#f43f5e', bellyColor: '#fde047', finColor: '#38bdf8', pattern: 'stars',
            desc: '栖息在翡翠湖心岛水下珊瑚丛中的奇幻生灵，游动轨迹忽快忽慢。'
        },
        {
            id: 'thunder_eel', name: '雷鸣电鳗', rarity: 'epic', baseWeight: 38,
            prefDepth: 2, prefBiome: 2, prefWeather: 'storm', skillType: 'dasher',
            minLen: 70, maxLen: 145, minKg: 4.50, maxKg: 16.00, baseValue: 148,
            difficulty: 0.72, speed: 0.94, erratic: 0.76,
            shape: 'long', bodyColor: '#0284c7', bellyColor: '#fde047', finColor: '#38bdf8', pattern: 'stripeBand',
            desc: '雷暴天气最活跃的闪电猎手，周身跳跃着金蓝色电弧，冲刺极快！'
        },
        {
            id: 'arowana', name: '银鳞龙鱼', rarity: 'epic', baseWeight: 40,
            prefDepth: 2, prefBiome: 2, prefWeather: 'any', skillType: 'dasher',
            minLen: 55, maxLen: 105, minKg: 2.80, maxKg: 9.80, baseValue: 140,
            difficulty: 0.70, speed: 0.88, erratic: 0.72,
            shape: 'dragon', bodyColor: '#e2e8f0', bellyColor: '#bae6fd', finColor: '#38bdf8', pattern: 'scales',
            desc: '身姿修长飘逸，吻端长有龙须，游动时宛如一条水中白龙。'
        },
        {
            id: 'catfish', name: '深渊巨鲶', rarity: 'epic', baseWeight: 36,
            prefDepth: 2, prefBiome: 3, prefWeather: 'rain', skillType: 'sinker',
            minLen: 80, maxLen: 165, minKg: 8.50, maxKg: 38.00, baseValue: 155,
            difficulty: 0.74, speed: 0.78, erratic: 0.68,
            shape: 'long', bodyColor: '#475569', bellyColor: '#94a3b8', finColor: '#334155', pattern: 'spots',
            desc: '潜伏在沉船湾水底的庞然大物，沉重如巨石般的潜底拉力考验着你的鱼线。'
        },

        // --- 传说 Legendary (3 种) ---
        {
            id: 'sakura_salmon', name: '樱花鲑王', rarity: 'legendary', baseWeight: 30,
            prefDepth: 2, prefBiome: 2, prefWeather: 'any', skillType: 'dasher',
            minLen: 75, maxLen: 130, minKg: 6.50, maxKg: 22.00, baseValue: 265,
            difficulty: 0.82, speed: 1.02, erratic: 0.80,
            shape: 'long', bodyColor: '#f9a8d4', bellyColor: '#fff1f2', finColor: '#f43f5e', pattern: 'spots',
            desc: '沐浴着湖心岛落樱而生的洄游之王，鳞片如晚霞般绚丽，力大无穷。'
        },
        {
            id: 'sunken_angler', name: '幽光灯笼鮟鱇', rarity: 'legendary', baseWeight: 24,
            prefDepth: 2, prefBiome: 3, prefWeather: 'storm', skillType: 'sinker',
            minLen: 65, maxLen: 125, minKg: 9.00, maxKg: 32.00, baseValue: 295,
            difficulty: 0.84, speed: 0.94, erratic: 0.82,
            shape: 'round', bodyColor: '#312e81', bellyColor: '#38bdf8', finColor: '#fde047', pattern: 'stars',
            desc: '盘踞在远古沉船舱底的神秘霸主，额前悬挂着散发幽蓝荧光的诱饵灯笼。'
        },
        {
            id: 'phantom_sturgeon', name: '幽蓝古鲟', rarity: 'legendary', baseWeight: 22,
            prefDepth: 2, prefBiome: 3, prefWeather: 'any', skillType: 'sinker',
            minLen: 120, maxLen: 240, minKg: 24.00, maxKg: 85.00, baseValue: 330,
            difficulty: 0.86, speed: 0.96, erratic: 0.86,
            shape: 'dragon', bodyColor: '#1e3a8a', bellyColor: '#60a5fa', finColor: '#38bdf8', pattern: 'stripeBand',
            desc: '活化石般的远古深水霸主，背甲泛着神秘的幽蓝磷光，擅长沉底角力。'
        },

        // --- 神话 Mythic (3 种) ---
        {
            id: 'moonfish', name: '星辰月光鱼', rarity: 'mythic', baseWeight: 10,
            prefDepth: 2, prefBiome: 2, prefWeather: 'meteor', skillType: 'illusion',
            minLen: 60, maxLen: 118, minKg: 4.50, maxKg: 18.00, baseValue: 560,
            difficulty: 0.92, speed: 1.15, erratic: 0.92,
            shape: 'moon', bodyColor: '#6366f1', bellyColor: '#c4b5fd', finColor: '#f472b6', pattern: 'stars',
            desc: '仿佛将一片微型银河藏于薄纱般的鱼鳍之中，在星陨之夜绽放梦幻光华。'
        },
        {
            id: 'dragon_koi', name: '龙宫赤金龙', rarity: 'mythic', baseWeight: 6,
            prefDepth: 2, prefBiome: 3, prefWeather: 'any', skillType: 'dasher',
            minLen: 110, maxLen: 210, minKg: 15.00, maxKg: 52.00, baseValue: 880,
            difficulty: 0.95, speed: 1.20, erratic: 0.95,
            shape: 'dragon', bodyColor: '#dc2626', bellyColor: '#fde047', finColor: '#fbbf24', pattern: 'stars',
            desc: '传说中跃过龙门的湖泊守护神兽！钓起它便是垂钓界的永恒传奇。'
        },
        {
            id: 'astral_leviathan', name: '星渊幻海龙', rarity: 'mythic', baseWeight: 4,
            prefDepth: 2, prefBiome: 3, prefWeather: 'meteor', skillType: 'illusion',
            minLen: 140, maxLen: 280, minKg: 28.00, maxKg: 98.00, baseValue: 1080,
            difficulty: 0.97, speed: 1.25, erratic: 0.96,
            shape: 'dragon', bodyColor: '#ec4899', bellyColor: '#38bdf8', finColor: '#fde047', pattern: 'stars',
            desc: '栖息于星渊沉船湾最深处的幻梦神龙，沐浴流星极光而生，统御万千鱼群。'
        }
    ];

    if (SharedCatalog) {
        const mergeById = (localList, sharedList) => {
            const byId = Object.fromEntries(localList.map(item => [item.id, item]));
            return sharedList.map(sharedItem => ({ ...(byId[sharedItem.id] || {}), ...sharedItem }));
        };
        const mergeByLevel = (localList, sharedList) => {
            const byLv = Object.fromEntries(localList.map(item => [item.level, item]));
            return sharedList.map(sharedItem => ({ ...(byLv[sharedItem.level] || {}), ...sharedItem }));
        };

        WWF.BAITS = mergeById(WWF.BAITS, SharedCatalog.BAITS);
        WWF.ROD_UPGRADES = mergeByLevel(WWF.ROD_UPGRADES, SharedCatalog.ROD_UPGRADES);
        WWF.REEL_UPGRADES = mergeByLevel(WWF.REEL_UPGRADES, SharedCatalog.REEL_UPGRADES);
        WWF.BOATS = mergeById(WWF.BOATS, SharedCatalog.BOATS);
        WWF.HATS = mergeById(WWF.HATS, SharedCatalog.HATS);
        WWF.OUTFITS = mergeById(WWF.OUTFITS, SharedCatalog.OUTFITS);
        WWF.AQUARIUM_UPGRADES = mergeByLevel(WWF.AQUARIUM_UPGRADES, SharedCatalog.AQUARIUM_UPGRADES);
        WWF.FISH_SPECIES = mergeById(WWF.FISH_SPECIES, SharedCatalog.FISH_SPECIES);
    }

    // ------------------------------------------------------------------------
    // 7. 升级版矢量鱼 SVG 生成器 (带动态摆尾动画与闪光异色鱼特效)
    // ------------------------------------------------------------------------
    WWF.createFishSVG = function (fish, isSilhouette = false, isShiny = false) {
        if (!fish) return '';
        if (typeof WWF.renderModelFishSVG === 'function') {
            const modelSvg = WWF.renderModelFishSVG(fish, !!isSilhouette, !!isShiny);
            if (typeof modelSvg === 'string' && modelSvg.trim().length > 0) {
                return modelSvg;
            }
        }

        const body = isSilhouette ? '#1e293b' : (isShiny ? '#fbbf24' : fish.bodyColor);
        const belly = isSilhouette ? '#1e293b' : (isShiny ? '#f472b6' : fish.bellyColor);
        const fin = isSilhouette ? '#0f172a' : (isShiny ? '#38bdf8' : fish.finColor);
        const stroke = isSilhouette ? '#334155' : (isShiny ? '#fef08a' : 'rgba(15,23,42,0.45)');
        const uid = `fg_${fish.id}_${isSilhouette ? 's' : 'c'}_${isShiny ? 'sh' : 'n'}_${Math.floor(Math.random() * 99999)}`;

        let bodyPath = '';
        let tailPath = '';
        let topFin = '';
        let botFin = '';
        let eyeX = 148, eyeY = 56;
        let extras = '';

        if (fish.shape === 'long') {
            bodyPath = 'M 42,60 Q 105,30 168,58 Q 105,88 42,60 Z';
            tailPath = 'M 46,60 L 14,36 L 26,60 L 14,84 Z';
            topFin = 'M 82,42 Q 106,20 124,42 Z';
            botFin = 'M 88,75 Q 106,92 122,74 Z';
            eyeX = 148; eyeY = 55;
        } else if (fish.shape === 'round') {
            bodyPath = 'M 46,60 Q 106,12 162,60 Q 106,108 46,60 Z';
            tailPath = 'M 50,60 L 18,34 Q 28,60 18,86 Z';
            topFin = 'M 72,30 Q 108,8 136,34 Z';
            botFin = 'M 74,90 Q 108,108 134,86 Z';
            eyeX = 138; eyeY = 54;
            if (!isSilhouette && fish.id === 'sunken_angler') {
                // 鮟鱇鱼发光小灯笼
                extras += `
                    <path d="M 135,34 Q 165,12 174,32" stroke="#fde047" stroke-width="2.5" fill="none"/>
                    <circle cx="174" cy="34" r="5" fill="#fef08a"/>
                    <circle cx="174" cy="34" r="9" fill="rgba(253,224,71,0.35)"/>
                `;
            }
        } else if (fish.shape === 'koi') {
            bodyPath = 'M 44,60 C 78,24 142,26 168,60 C 142,94 78,96 44,60 Z';
            tailPath = 'M 48,60 C 28,32 10,30 18,54 C 24,60 24,60 18,66 C 10,90 28,88 48,60 Z';
            topFin = 'M 76,34 Q 104,12 132,36 Z';
            botFin = 'M 94,85 Q 112,102 128,84 Z';
            eyeX = 148; eyeY = 54;
            if (!isSilhouette) {
                extras += `<path d="M 164,65 Q 176,74 171,82" stroke="${fin}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
            }
        } else if (fish.shape === 'dragon') {
            bodyPath = 'M 36,62 C 74,26 138,34 174,56 C 142,88 76,92 36,62 Z';
            tailPath = 'M 42,62 C 18,22 4,34 20,58 C 6,84 18,98 42,62 Z';
            topFin = 'M 54,44 Q 100,10 144,38 Q 112,34 54,44 Z';
            botFin = 'M 62,78 Q 104,106 142,78 Z';
            eyeX = 154; eyeY = 53;
            if (!isSilhouette) {
                extras += `
                    <path d="M 168,62 Q 186,68 182,82" stroke="${fin}" stroke-width="2.8" fill="none" stroke-linecap="round"/>
                    <path d="M 165,64 Q 178,78 170,88" stroke="${belly}" stroke-width="2" fill="none" stroke-linecap="round"/>
                `;
            }
        } else if (fish.shape === 'moon') {
            bodyPath = 'M 52,60 C 80,14 138,14 162,60 C 138,106 80,106 52,60 Z';
            tailPath = 'M 56,60 C 28,12 6,20 26,60 C 6,100 28,108 56,60 Z';
            topFin = 'M 72,26 C 102,0 132,6 142,32 Z';
            botFin = 'M 72,94 C 102,120 132,114 142,88 Z';
            eyeX = 140; eyeY = 55;
        } else {
            bodyPath = 'M 44,60 Q 104,22 164,60 Q 104,98 44,60 Z';
            tailPath = 'M 48,60 L 16,34 L 28,60 L 16,86 Z';
            topFin = 'M 78,36 Q 105,14 130,38 Z';
            botFin = 'M 86,82 Q 108,98 126,80 Z';
            eyeX = 144; eyeY = 54;
        }

        let patternSvg = '';
        if (!isSilhouette) {
            if (fish.pattern === 'stripes') {
                patternSvg = `<path d="M 82,36 L 78,78 M 100,32 L 96,82 M 118,34 L 114,80 M 134,40 L 131,74" stroke="rgba(15,23,42,0.28)" stroke-width="5" stroke-linecap="round"/>`;
            } else if (fish.pattern === 'spots') {
                patternSvg = `
                    <circle cx="84" cy="52" r="3.2" fill="rgba(15,23,42,0.32)"/>
                    <circle cx="98" cy="46" r="2.6" fill="rgba(15,23,42,0.32)"/>
                    <circle cx="112" cy="54" r="3.5" fill="rgba(15,23,42,0.32)"/>
                    <circle cx="126" cy="48" r="2.5" fill="rgba(15,23,42,0.32)"/>
                    <circle cx="96" cy="64" r="2.4" fill="rgba(255,255,255,0.35)"/>
                `;
            } else if (fish.pattern === 'koiSpots') {
                patternSvg = `
                    <ellipse cx="95" cy="50" rx="18" ry="10" fill="#ef4444" opacity="0.88"/>
                    <ellipse cx="128" cy="56" rx="12" ry="8" fill="#ef4444" opacity="0.85"/>
                    <ellipse cx="76" cy="62" rx="9" ry="6" fill="#1e293b" opacity="0.78"/>
                    <ellipse cx="114" cy="44" rx="7" ry="5" fill="#1e293b" opacity="0.72"/>
                `;
            } else if (fish.pattern === 'stripeBand') {
                patternSvg = `<path d="M 54,60 Q 104,52 148,58" stroke="rgba(255,255,255,0.42)" stroke-width="6" fill="none" stroke-linecap="round"/>`;
            } else if (fish.pattern === 'scales') {
                patternSvg = `<path d="M 86,52 Q 92,58 86,64 M 102,48 Q 108,54 102,60 M 118,52 Q 124,58 118,64 M 102,62 Q 108,68 102,74" stroke="rgba(255,255,255,0.35)" stroke-width="2" fill="none" stroke-linecap="round"/>`;
            } else if (fish.pattern === 'stars') {
                patternSvg = `
                    <circle cx="88" cy="48" r="2.5" fill="#fef08a"/>
                    <circle cx="108" cy="64" r="3" fill="#ffffff"/>
                    <circle cx="122" cy="46" r="2.2" fill="#f9a8d4"/>
                    <circle cx="98" cy="56" r="1.8" fill="#bae6fd"/>
                    <circle cx="74" cy="60" r="2" fill="#fef08a"/>
                `;
            }
        }

        const shinySparkles = (!isSilhouette && isShiny) ? `
            <g fill="#fef08a">
                <path d="M 32,26 L 35,34 L 43,37 L 35,40 L 32,48 L 29,40 L 21,37 L 29,34 Z"/>
                <path d="M 168,18 L 170,24 L 176,26 L 170,28 L 168,34 L 166,28 L 160,26 L 166,24 Z"/>
                <circle cx="110" cy="18" r="2.5" fill="#ffffff"/>
                <circle cx="62" cy="96" r="2.5" fill="#f472b6"/>
            </g>
        ` : '';

        const eyeSvg = isSilhouette
            ? `<circle cx="${eyeX}" cy="${eyeY}" r="4.5" fill="#334155"/>`
            : `<circle cx="${eyeX}" cy="${eyeY}" r="5.5" fill="#ffffff"/>
               <circle cx="${eyeX + 1.5}" cy="${eyeY}" r="3" fill="#0f172a"/>
               <circle cx="${eyeX + 2.4}" cy="${eyeY - 1.2}" r="1.1" fill="#ffffff"/>`;

        return `
            <svg viewBox="0 0 200 120" class="w-full h-full drop-shadow-md ${(!isSilhouette && isShiny) ? 'shiny-glow' : ''}">
                <defs>
                    <linearGradient id="${uid}" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${body}"/>
                        <stop offset="100%" stop-color="${belly}"/>
                    </linearGradient>
                    <clipPath id="${uid}_clip">
                        <path d="${bodyPath}"/>
                    </clipPath>
                </defs>
                <!-- 动态摆动尾鳍 -->
                <g class="svg-fish-tail">
                    <path d="${tailPath}" fill="${fin}" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round"/>
                </g>
                <!-- 背鳍与腹鳍 -->
                <path d="${topFin}" fill="${fin}" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round"/>
                <path d="${botFin}" fill="${fin}" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round"/>
                <!-- 鱼身 -->
                <path d="${bodyPath}" fill="url(#${uid})" stroke="${stroke}" stroke-width="1.8"/>
                <!-- 花纹裁剪在鱼身内 -->
                <g clip-path="url(#${uid}_clip)">
                    ${patternSvg}
                    ${!isSilhouette ? `<path d="M 55,44 Q 108,28 152,48" stroke="rgba(255,255,255,0.28)" stroke-width="4" fill="none" stroke-linecap="round"/>` : ''}
                </g>
                <!-- 侧胸鳍 -->
                <path d="M 118,64 Q 102,78 112,84 Q 126,76 126,66 Z" fill="${fin}" opacity="0.88"/>
                ${extras}
                ${eyeSvg}
                ${shinySparkles}
            </svg>
        `;
    };

    // ------------------------------------------------------------------------
    // 8. Canvas 2D 动态矢量鱼直接绘制器 (供破水飞鱼演出 & 动态水族箱调用)
    // ------------------------------------------------------------------------
    WWF.drawCanvasFish = function (ctx, fish, x, y, size, dir = 1, time = 0, isShiny = false, extraOpts = null) {
        if (!ctx || !fish) return;
        if (typeof WWF.drawModelCanvasFish === 'function') {
            const drawn = WWF.drawModelCanvasFish(ctx, fish, x, y, size, dir, time, isShiny, extraOpts);
            if (drawn === true) return;
        }
        ctx.save();
        ctx.translate(x, y);
        const safeDir = dir >= 0 ? Math.max(0.26, dir) : Math.min(-0.26, dir);
        ctx.scale(safeDir, 1);

        const wag = Math.sin(time * 9 + (x * 0.05)) * 0.22;
        const bodyH = fish.shape === 'round' || fish.shape === 'moon'
            ? size * 0.68
            : (fish.shape === 'long' || fish.shape === 'dragon' ? size * 0.36 : size * 0.48);

        // 闪光异色鱼金色星环
        if (isShiny) {
            ctx.save();
            ctx.shadowColor = '#fde047';
            ctx.shadowBlur = 14;
            ctx.strokeStyle = 'rgba(253, 224, 71, 0.55)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(0, 0, size * 1.15, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        // 1. 动态摆动尾鳍
        ctx.save();
        ctx.translate(-size * 0.78, 0);
        ctx.rotate(wag);
        ctx.fillStyle = isShiny ? '#38bdf8' : fish.finColor;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-size * 0.48, -bodyH * 0.85);
        ctx.lineTo(-size * 0.30, 0);
        ctx.lineTo(-size * 0.48, bodyH * 0.85);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // 2. 背鳍与腹鳍
        ctx.fillStyle = isShiny ? '#38bdf8' : fish.finColor;
        ctx.beginPath();
        ctx.moveTo(-size * 0.25, -bodyH * 0.75);
        ctx.quadraticCurveTo(0, -bodyH * 1.45, size * 0.28, -bodyH * 0.72);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(-size * 0.20, bodyH * 0.75);
        ctx.quadraticCurveTo(0, bodyH * 1.30, size * 0.22, bodyH * 0.70);
        ctx.closePath();
        ctx.fill();

        // 3. 鱼身渐变
        const grad = ctx.createLinearGradient(0, -bodyH, 0, bodyH);
        grad.addColorStop(0, isShiny ? '#fbbf24' : fish.bodyColor);
        grad.addColorStop(1, isShiny ? '#f472b6' : fish.bellyColor);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(0, 0, size * 0.88, bodyH, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = isShiny ? '#fef08a' : 'rgba(15, 23, 42, 0.4)';
        ctx.lineWidth = 1.3;
        ctx.stroke();

        // 4. 背部高光弧线
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
        ctx.lineWidth = Math.max(1.5, size * 0.08);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.65, -Math.PI * 0.75, -Math.PI * 0.25);
        ctx.stroke();

        // 5. 眼睛
        const ex = size * 0.48;
        const ey = -bodyH * 0.18;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(ex, ey, Math.max(2.5, size * 0.13), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(ex + 0.8, ey, Math.max(1.4, size * 0.07), 0, Math.PI * 2);
        ctx.fill();

        // 6. 龙须或鮟鱇灯笼特写
        if (fish.shape === 'dragon') {
            ctx.strokeStyle = isShiny ? '#fef08a' : fish.finColor;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(size * 0.82, bodyH * 0.1);
            ctx.quadraticCurveTo(size * 1.15, bodyH * 0.35, size * 1.05, bodyH * 0.65);
            ctx.stroke();
        } else if (fish.id === 'sunken_angler') {
            ctx.strokeStyle = '#fde047';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(size * 0.35, -bodyH * 0.8);
            ctx.quadraticCurveTo(size * 0.8, -bodyH * 1.4, size * 0.92, -bodyH * 0.7);
            ctx.stroke();
            ctx.fillStyle = '#fef08a';
            ctx.beginPath();
            ctx.arc(size * 0.92, -bodyH * 0.65, Math.max(2.5, size * 0.14), 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    };

    // ------------------------------------------------------------------------
    // 9. Tone.js 进阶程序化声学合成引擎
    // ------------------------------------------------------------------------
    WWF.Sound = {
        ready: false,
        synth: null,
        poly: null,
        noise: null,
        lastTickTime: 0,
        lastTurnTime: 0,

        init() {
            if (this.ready || typeof Tone === 'undefined') return;
            try {
                this.synth = new Tone.Synth({
                    oscillator: { type: 'sine' },
                    envelope: { attack: 0.01, decay: 0.16, sustain: 0.05, release: 0.25 }
                }).toDestination();
                this.synth.volume.value = -10;

                this.poly = new Tone.PolySynth(Tone.Synth, {
                    oscillator: { type: 'triangle' },
                    envelope: { attack: 0.02, decay: 0.25, sustain: 0.12, release: 0.55 }
                }).toDestination();
                this.poly.volume.value = -10;

                const filter = new Tone.Filter(950, 'lowpass').toDestination();
                this.noise = new Tone.NoiseSynth({
                    noise: { type: 'pink' },
                    envelope: { attack: 0.005, decay: 0.15, sustain: 0 }
                }).connect(filter);
                this.noise.volume.value = -12;

                this.ready = true;
            } catch (e) {
                console.warn('音频初始化跳过:', e);
            }
        },

        unlock() {
            if (WWF.player && WWF.player.muted) return;
            try {
                if (!this.ready) this.init();
                if (typeof Tone !== 'undefined' && Tone.context && Tone.context.state !== 'running') {
                    const p = Tone.start();
                    if (p && typeof p.catch === 'function') {
                        p.catch(() => {});
                    }
                }
            } catch (e) {}
        },

        playCast() {
            if ((WWF.player && WWF.player.muted) || !this.ready) return;
            try {
                this.synth.triggerAttackRelease('C5', '16n');
                setTimeout(() => {
                    if (!(WWF.player && WWF.player.muted) && this.ready) {
                        this.synth.triggerAttackRelease('G4', '16n');
                    }
                }, 65);
            } catch (e) {}
        },

        playPlop() {
            if ((WWF.player && WWF.player.muted) || !this.ready) return;
            try {
                this.noise.triggerAttackRelease('16n');
                const now = Tone.now();
                this.synth.triggerAttackRelease('E4', '32n', now);
                this.synth.triggerAttackRelease('A4', '16n', now + 0.05);
            } catch (e) {}
        },

        playNibble() {
            if ((WWF.player && WWF.player.muted) || !this.ready) return;
            try {
                this.synth.triggerAttackRelease('D5', '32n');
            } catch (e) {}
        },

        playBite() {
            if ((WWF.player && WWF.player.muted) || !this.ready) return;
            try {
                this.noise.triggerAttackRelease('8n');
                const now = Tone.now();
                this.poly.triggerAttackRelease(['G5', 'B5'], '16n', now);
                this.poly.triggerAttackRelease(['D6'], '8n', now + 0.085);
            } catch (e) {}
        },

        playReelTick(tension = 0.5, inZone = true) {
            if ((WWF.player && WWF.player.muted) || !this.ready) return;
            const nowMs = performance.now();
            const interval = inZone ? 140 : 220;
            if (nowMs - this.lastTickTime < interval) return;
            this.lastTickTime = nowMs;
            try {
                const note = inZone ? (tension > 0.7 ? 'E5' : 'C5') : 'F4';
                this.synth.triggerAttackRelease(note, '64n');
            } catch (e) {}
        },

        playQTEPrompt() {
            if ((WWF.player && WWF.player.muted) || !this.ready) return;
            try {
                const now = Tone.now();
                this.poly.triggerAttackRelease(['A5', 'E6'], '16n', now);
                this.poly.triggerAttackRelease(['C6', 'A6'], '16n', now + 0.09);
            } catch (e) {}
        },

        playQTESuccess() {
            if ((WWF.player && WWF.player.muted) || !this.ready) return;
            try {
                const now = Tone.now();
                ['C5', 'G5', 'C6', 'E6'].forEach((n, idx) => {
                    this.poly.triggerAttackRelease(n, '16n', now + idx * 0.055);
                });
            } catch (e) {}
        },

        playRow() {
            if ((WWF.player && WWF.player.muted) || !this.ready) return;
            const nowMs = performance.now();
            if (nowMs - this.lastTickTime < 450) return;
            this.lastTickTime = nowMs;
            try {
                this.noise.triggerAttackRelease('32n');
            } catch (e) {}
        },

        playTurn(inBoat = false) {
            if ((WWF.player && WWF.player.muted) || !this.ready) return;
            const nowMs = performance.now();
            if (nowMs - this.lastTurnTime < 220) return;
            this.lastTurnTime = nowMs;
            try {
                if (inBoat) {
                    this.noise.triggerAttackRelease('32n');
                } else {
                    this.noise.triggerAttackRelease('64n');
                }
            } catch (e) {}
        },

        playCatch(rarity) {
            if ((WWF.player && WWF.player.muted) || !this.ready) return;
            try {
                const now = Tone.now();
                if (rarity === 'mythic' || rarity === 'legendary') {
                    const notes = rarity === 'mythic'
                        ? ['C5', 'E5', 'G5', 'B5', 'D6', 'G6']
                        : ['C5', 'E5', 'G5', 'C6', 'E6'];
                    notes.forEach((n, idx) => {
                        this.poly.triggerAttackRelease(n, '8n', now + idx * 0.085);
                    });
                } else if (rarity === 'epic' || rarity === 'rare') {
                    ['C5', 'E5', 'G5', 'C6'].forEach((n, idx) => {
                        this.poly.triggerAttackRelease(n, '8n', now + idx * 0.08);
                    });
                } else {
                    ['C5', 'E5', 'G5'].forEach((n, idx) => {
                        this.poly.triggerAttackRelease(n, '16n', now + idx * 0.08);
                    });
                }
            } catch (e) {}
        },

        playEscape() {
            if ((WWF.player && WWF.player.muted) || !this.ready) return;
            try {
                const now = Tone.now();
                this.synth.triggerAttackRelease('E4', '8n', now);
                this.synth.triggerAttackRelease('C4', '4n', now + 0.14);
            } catch (e) {}
        },

        playCoin() {
            if ((WWF.player && WWF.player.muted) || !this.ready) return;
            try {
                const now = Tone.now();
                this.synth.triggerAttackRelease('B5', '32n', now);
                this.synth.triggerAttackRelease('E6', '16n', now + 0.07);
            } catch (e) {}
        }
    };

})();
