/**
 * 《微风垂钓物语 2.0》前后端单一事实源：核心游戏目录 (shared/game_catalog.js)
 * ----------------------------------------------------------------------------
 * 本文件同时支持浏览器挂载 (globalThis.WWF_SHARED.GameCatalog) 与 Node.js 导入。
 * 数值与 js/core.js、js/art_audio.js 保持严格 1:1 一致，并由 tests/unit/catalog_consistency.test.mjs 守护。
 */
(function (root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  }
  const target = root || (typeof globalThis !== 'undefined' ? globalThis : {});
  target.WWF_SHARED = target.WWF_SHARED || {};
  target.WWF_SHARED.GameCatalog = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CATALOG_VERSION = '2.0.0';
  const WORLD_WIDTH = 2400;

  const ECONOMY_CONSTANTS = Object.freeze({
    AQUARIUM_FEED_COST: 15,
    AQUARIUM_FEED_GROWTH_MULT: 1.08,
    AQUARIUM_SHINY_INCOME_MULT: 1.5,
    SHINY_BASE_CHANCE: 0.02,
    SHINY_MAX_CHANCE: 0.40,
    SHINY_GOLDEN_TIDE_MULT: 1.8,
    GOLDEN_TIDE_SUMMON_LUCK: 8,
    GOLDEN_TIDE_SUMMON_COINS: 180,
    GOLDEN_TIDE_DURATION_SEC: 60,
    OFFLINE_AQUARIUM_MAX_HOURS: 24,
    MAX_BASKET_SIZE: 200
  });

  const BIOMES = [
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

  const WEATHERS = {
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

  const RARITIES = {
    common: {
      name: '普通',
      en: 'COMMON',
      color: '#cbd5e1',
      glow: '#94a3b8',
      luckReward: 1,
      aquariumIncome: 6
    },
    rare: {
      name: '稀有',
      en: 'RARE',
      color: '#38bdf8',
      glow: '#38bdf8',
      luckReward: 2,
      aquariumIncome: 15
    },
    epic: {
      name: '史诗',
      en: 'EPIC',
      color: '#c084fc',
      glow: '#a855f7',
      luckReward: 4,
      aquariumIncome: 36
    },
    legendary: {
      name: '传说',
      en: 'LEGENDARY',
      color: '#fbbf24',
      glow: '#f59e0b',
      luckReward: 7,
      aquariumIncome: 85
    },
    mythic: {
      name: '神话',
      en: 'MYTHIC',
      color: '#f472b6',
      glow: '#ec4899',
      luckReward: 12,
      aquariumIncome: 200
    }
  };

  const BAITS = [
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

  const ROD_UPGRADES = [
    { level: 1, name: '木制钓竿', price: 0, zoneSize: 0.25, maxDistBonus: 0, color: '#a16207', desc: '轻巧的入门竹木竿' },
    { level: 2, name: '玻璃钢钓竿', price: 120, zoneSize: 0.30, maxDistBonus: 0.08, color: '#0284c7', desc: '捕获判定区 +20%，抛投更远' },
    { level: 3, name: '碳纤维轻竿', price: 320, zoneSize: 0.35, maxDistBonus: 0.16, color: '#475569', desc: '捕获判定区 +40%，深水轻松触及' },
    { level: 4, name: '海王合金竿', price: 750, zoneSize: 0.40, maxDistBonus: 0.24, color: '#d97706', desc: '捕获判定区 +60%，对抗传说大鱼利器' },
    { level: 5, name: '星辉大师竿', price: 1600, zoneSize: 0.46, maxDistBonus: 0.32, color: '#e879f9', desc: '顶级大师钓竿，捕获区超宽容' }
  ];

  const REEL_UPGRADES = [
    { level: 1, name: '简易手摇轮', price: 0, fillRate: 0.24, drainRate: 0.14, desc: '基础收线速度' },
    { level: 2, name: '滚珠轴承轮', price: 110, fillRate: 0.29, drainRate: 0.125, desc: '收线进度更快，不易脱钩' },
    { level: 3, name: '高速纺车轮', price: 290, fillRate: 0.34, drainRate: 0.11, desc: '稳定锁死狂躁大鱼的挣扎' },
    { level: 4, name: '磁力刹车轮', price: 680, fillRate: 0.40, drainRate: 0.095, desc: '极速收线，张力控制行云流水' },
    { level: 5, name: '龙吟涡轮卷', price: 1450, fillRate: 0.48, drainRate: 0.08, desc: '传说级卷线器，收线如履平地' }
  ];

  const BOATS = [
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

  const HATS = [
    { id: 'straw', name: '田园草帽', icon: '👒', price: 0, color: '#eab308', bandColor: '#ef4444', desc: '透气防晒的经典麦秆草帽' },
    { id: 'captain', name: '老船长大檐帽', icon: '🧢', price: 140, color: '#f8fafc', bandColor: '#1e3a8a', desc: '威风凛凛的黄金锚徽航海船长帽' },
    { id: 'frog', name: '青蛙荷叶兜帽', icon: '🐸', price: 260, color: '#22c55e', bandColor: '#dcfce7', desc: '雨天垂钓最可爱的幸运蛙蛙头套' },
    { id: 'star_crown', name: '星辰幻梦冠', icon: '👑', price: 640, color: '#fbbf24', bandColor: '#f472b6', desc: '流转着银河微光的传奇垂钓王者头冠' }
  ];

  const OUTFITS = [
    { id: 'casual', name: '海风亚麻衫', icon: '👕', price: 0, primary: '#1e293b', secondary: '#38bdf8', desc: '轻便舒适的日常垂钓服' },
    { id: 'raincoat', name: '明黄防风小雨衣', icon: '🧥', price: 150, primary: '#eab308', secondary: '#fef08a', desc: '在烟雨与雷暴天气中格外醒目可爱' },
    { id: 'sailor', name: '湛蓝水手礼服', icon: '⚓', price: 320, primary: '#1d4ed8', secondary: '#f8fafc', desc: '经典蓝白条纹领远航水手制服' },
    { id: 'master_robe', name: '绯红龙纹羽织', icon: '👘', price: 720, primary: '#991b1b', secondary: '#fbbf24', desc: '唯有制霸全海域的垂钓宗师方能驾驭' }
  ];

  const AQUARIUM_UPGRADES = [
    { level: 1, name: '桌面玻璃生态缸', capacity: 4, incomeMult: 1.0, price: 0, desc: '可容纳 4 条观赏鱼，基础门票收益' },
    { level: 2, name: '全景珊瑚水族箱', capacity: 6, incomeMult: 1.25, price: 180, desc: '容量扩至 6 条，门票收益 +25%' },
    { level: 3, name: '深海琉璃展览馆', capacity: 9, incomeMult: 1.55, price: 420, desc: '容量扩至 9 条，门票收益 +55%' },
    { level: 4, name: '皇家海底观光厅', capacity: 12, incomeMult: 1.90, price: 850, desc: '容量扩至 12 条，门票收益 +90%' },
    { level: 5, name: '星海梦幻水晶宫', capacity: 16, incomeMult: 2.50, price: 1600, desc: '顶级 16 条容量，门票收益 +150%' }
  ];

  const FISH_SPECIES = [
    // --- 普通 Common (4 种) ---
    {
      id: 'minnow', name: '溪流白条', rarity: 'common', baseWeight: 160,
      prefDepth: 0, prefBiome: 0, prefWeather: 'any', skillType: 'steady',
      minLen: 10, maxLen: 22, minKg: 0.05, maxKg: 0.18, baseValue: 10,
      difficulty: 0.22, speed: 0.35, erratic: 0.25, shape: 'long'
    },
    {
      id: 'crucian', name: '金背鲫鱼', rarity: 'common', baseWeight: 150,
      prefDepth: 0, prefBiome: 0, prefWeather: 'any', skillType: 'steady',
      minLen: 16, maxLen: 34, minKg: 0.20, maxKg: 1.10, baseValue: 15,
      difficulty: 0.28, speed: 0.40, erratic: 0.30, shape: 'oval'
    },
    {
      id: 'perch', name: '条纹河鲈', rarity: 'common', baseWeight: 115,
      prefDepth: 1, prefBiome: 1, prefWeather: 'any', skillType: 'dasher',
      minLen: 20, maxLen: 42, minKg: 0.35, maxKg: 1.80, baseValue: 20,
      difficulty: 0.34, speed: 0.48, erratic: 0.35, shape: 'oval'
    },
    {
      id: 'loach', name: '花斑泥鳅', rarity: 'common', baseWeight: 95,
      prefDepth: 0, prefBiome: 0, prefWeather: 'rain', skillType: 'illusion',
      minLen: 14, maxLen: 28, minKg: 0.08, maxKg: 0.35, baseValue: 18,
      difficulty: 0.38, speed: 0.52, erratic: 0.50, shape: 'long'
    },

    // --- 稀有 Rare (5 种) ---
    {
      id: 'bluegill', name: '蓝鳃太阳鱼', rarity: 'rare', baseWeight: 80,
      prefDepth: 0, prefBiome: 0, prefWeather: 'sunny', skillType: 'steady',
      minLen: 18, maxLen: 32, minKg: 0.30, maxKg: 1.30, baseValue: 34,
      difficulty: 0.44, speed: 0.56, erratic: 0.45, shape: 'round'
    },
    {
      id: 'emerald_puffer', name: '翡翠胖河豚', rarity: 'rare', baseWeight: 70,
      prefDepth: 0, prefBiome: 0, prefWeather: 'any', skillType: 'steady',
      minLen: 15, maxLen: 30, minKg: 0.40, maxKg: 1.60, baseValue: 42,
      difficulty: 0.46, speed: 0.54, erratic: 0.48, shape: 'round'
    },
    {
      id: 'trout', name: '星点虹鳟', rarity: 'rare', baseWeight: 72,
      prefDepth: 1, prefBiome: 1, prefWeather: 'rain', skillType: 'dasher',
      minLen: 32, maxLen: 68, minKg: 0.90, maxKg: 4.50, baseValue: 46,
      difficulty: 0.52, speed: 0.65, erratic: 0.52, shape: 'long'
    },
    {
      id: 'bass', name: '大口黑鲈', rarity: 'rare', baseWeight: 65,
      prefDepth: 1, prefBiome: 1, prefWeather: 'any', skillType: 'dasher',
      minLen: 35, maxLen: 72, minKg: 1.20, maxKg: 6.20, baseValue: 54,
      difficulty: 0.56, speed: 0.72, erratic: 0.60, shape: 'oval'
    },
    {
      id: 'koi', name: '三色锦鲤', rarity: 'rare', baseWeight: 55,
      prefDepth: 1, prefBiome: 2, prefWeather: 'any', skillType: 'steady',
      minLen: 38, maxLen: 78, minKg: 1.50, maxKg: 7.50, baseValue: 66,
      difficulty: 0.50, speed: 0.62, erratic: 0.48, shape: 'koi'
    },

    // --- 史诗 Epic (5 种) ---
    {
      id: 'golden_carp', name: '黄金锦鲤', rarity: 'epic', baseWeight: 48,
      prefDepth: 1, prefBiome: 1, prefWeather: 'sunny', skillType: 'steady',
      minLen: 48, maxLen: 92, minKg: 3.20, maxKg: 12.50, baseValue: 118,
      difficulty: 0.64, speed: 0.80, erratic: 0.62, shape: 'koi'
    },
    {
      id: 'coral_seahorse', name: '七彩珊瑚海马', rarity: 'epic', baseWeight: 42,
      prefDepth: 1, prefBiome: 2, prefWeather: 'any', skillType: 'illusion',
      minLen: 24, maxLen: 48, minKg: 0.60, maxKg: 2.40, baseValue: 132,
      difficulty: 0.66, speed: 0.84, erratic: 0.70, shape: 'koi'
    },
    {
      id: 'thunder_eel', name: '雷鸣电鳗', rarity: 'epic', baseWeight: 38,
      prefDepth: 2, prefBiome: 2, prefWeather: 'storm', skillType: 'dasher',
      minLen: 70, maxLen: 145, minKg: 4.50, maxKg: 16.00, baseValue: 148,
      difficulty: 0.72, speed: 0.94, erratic: 0.76, shape: 'long'
    },
    {
      id: 'arowana', name: '银鳞龙鱼', rarity: 'epic', baseWeight: 40,
      prefDepth: 2, prefBiome: 2, prefWeather: 'any', skillType: 'dasher',
      minLen: 55, maxLen: 105, minKg: 2.80, maxKg: 9.80, baseValue: 140,
      difficulty: 0.70, speed: 0.88, erratic: 0.72, shape: 'dragon'
    },
    {
      id: 'catfish', name: '深渊巨鲶', rarity: 'epic', baseWeight: 36,
      prefDepth: 2, prefBiome: 3, prefWeather: 'rain', skillType: 'sinker',
      minLen: 80, maxLen: 165, minKg: 8.50, maxKg: 38.00, baseValue: 155,
      difficulty: 0.74, speed: 0.78, erratic: 0.68, shape: 'long'
    },

    // --- 传说 Legendary (3 种) ---
    {
      id: 'sakura_salmon', name: '樱花鲑王', rarity: 'legendary', baseWeight: 30,
      prefDepth: 2, prefBiome: 2, prefWeather: 'any', skillType: 'dasher',
      minLen: 75, maxLen: 130, minKg: 6.50, maxKg: 22.00, baseValue: 265,
      difficulty: 0.82, speed: 1.02, erratic: 0.80, shape: 'long'
    },
    {
      id: 'sunken_angler', name: '幽光灯笼鮟鱇', rarity: 'legendary', baseWeight: 24,
      prefDepth: 2, prefBiome: 3, prefWeather: 'storm', skillType: 'sinker',
      minLen: 65, maxLen: 125, minKg: 9.00, maxKg: 32.00, baseValue: 295,
      difficulty: 0.84, speed: 0.94, erratic: 0.82, shape: 'round'
    },
    {
      id: 'phantom_sturgeon', name: '幽蓝古鲟', rarity: 'legendary', baseWeight: 22,
      prefDepth: 2, prefBiome: 3, prefWeather: 'any', skillType: 'sinker',
      minLen: 120, maxLen: 240, minKg: 24.00, maxKg: 85.00, baseValue: 330,
      difficulty: 0.86, speed: 0.96, erratic: 0.86, shape: 'dragon'
    },

    // --- 神话 Mythic (3 种) ---
    {
      id: 'moonfish', name: '星辰月光鱼', rarity: 'mythic', baseWeight: 10,
      prefDepth: 2, prefBiome: 2, prefWeather: 'meteor', skillType: 'illusion',
      minLen: 60, maxLen: 118, minKg: 4.50, maxKg: 18.00, baseValue: 560,
      difficulty: 0.92, speed: 1.15, erratic: 0.92, shape: 'moon'
    },
    {
      id: 'dragon_koi', name: '龙宫赤金龙', rarity: 'mythic', baseWeight: 6,
      prefDepth: 2, prefBiome: 3, prefWeather: 'any', skillType: 'dasher',
      minLen: 110, maxLen: 210, minKg: 15.00, maxKg: 52.00, baseValue: 880,
      difficulty: 0.95, speed: 1.20, erratic: 0.95, shape: 'dragon'
    },
    {
      id: 'astral_leviathan', name: '星渊幻海龙', rarity: 'mythic', baseWeight: 4,
      prefDepth: 2, prefBiome: 3, prefWeather: 'meteor', skillType: 'illusion',
      minLen: 140, maxLen: 280, minKg: 28.00, maxKg: 98.00, baseValue: 1080,
      difficulty: 0.97, speed: 1.25, erratic: 0.96, shape: 'dragon'
    }
  ];

  const ACHIEVEMENTS = [
    { code: 'first_catch', title: '初试锋芒', desc: '成功钓起人生第 1 条鱼', category: 'fishing', rewardCoins: 40, rewardLuck: 2, target: 1 },
    { code: 'encyclopedia_5', title: '浅水观察家', desc: '解锁 5 种不同鱼类图鉴', category: 'collection', rewardCoins: 80, rewardLuck: 2, target: 5 },
    { code: 'encyclopedia_12', title: '微风博物学者', desc: '解锁 12 种不同鱼类图鉴', category: 'collection', rewardCoins: 220, rewardLuck: 5, target: 12 },
    { code: 'encyclopedia_20', title: '全生态宗师', desc: '集齐全部 20 种生态鱼类图鉴', category: 'collection', rewardCoins: 800, rewardLuck: 15, target: 20 },
    { code: 'first_shiny', title: '异色星光', desc: '首次捕获闪光异色 (Shiny) 鱼类', category: 'rarity', rewardCoins: 150, rewardLuck: 4, target: 1 },
    { code: 'first_legendary', title: '传说邂逅', desc: '首次捕获传说品级大鱼', category: 'rarity', rewardCoins: 260, rewardLuck: 6, target: 1 },
    { code: 'first_mythic', title: '神话降临', desc: '首次捕获神话品级鱼王', category: 'rarity', rewardCoins: 600, rewardLuck: 12, target: 1 },
    { code: 'sail_abyss', title: '深海远航者', desc: '购置船只并航行至星渊沉船湾', category: 'explore', rewardCoins: 120, rewardLuck: 3, target: 1 },
    { code: 'aquarium_lv3', title: '生态馆主', desc: '将观赏水族箱扩建至 3 级或以上', category: 'aquarium', rewardCoins: 200, rewardLuck: 4, target: 3 },
    { code: 'aquarium_share', title: '海洋名片', desc: '生成并分享 1 次个人水族箱展示链接', category: 'social', rewardCoins: 100, rewardLuck: 3, target: 1 },
    { code: 'bounty_10', title: '老船长的挚友', desc: '累计完成 10 次码头悬赏订单', category: 'orders', rewardCoins: 300, rewardLuck: 8, target: 10 },
    { code: 'release_25', title: '碧波祈福者', desc: '累计放生 25 条鱼积累祈福幸运', category: 'karma', rewardCoins: 180, rewardLuck: 10, target: 25 }
  ];

  const FISH_BY_ID = Object.freeze(Object.fromEntries(FISH_SPECIES.map(f => [f.id, f])));
  const BAIT_BY_ID = Object.freeze(Object.fromEntries(BAITS.map(b => [b.id, b])));
  const BOAT_BY_ID = Object.freeze(Object.fromEntries(BOATS.map(b => [b.id, b])));
  const HAT_BY_ID = Object.freeze(Object.fromEntries(HATS.map(h => [h.id, h])));
  const OUTFIT_BY_ID = Object.freeze(Object.fromEntries(OUTFITS.map(o => [o.id, o])));

  function getFishById(id) {
    return FISH_BY_ID[id] || null;
  }

  function getBaitById(id) {
    return BAIT_BY_ID[id] || null;
  }

  function getAquariumLevelInfo(level) {
    const idx = Math.max(0, Math.min(AQUARIUM_UPGRADES.length - 1, (Number(level) || 1) - 1));
    return AQUARIUM_UPGRADES[idx];
  }

  return {
    CATALOG_VERSION,
    WORLD_WIDTH,
    ECONOMY_CONSTANTS,
    BIOMES,
    WEATHERS,
    RARITIES,
    BAITS,
    ROD_UPGRADES,
    REEL_UPGRADES,
    BOATS,
    HATS,
    OUTFITS,
    AQUARIUM_UPGRADES,
    FISH_SPECIES,
    ACHIEVEMENTS,
    FISH_BY_ID,
    BAIT_BY_ID,
    BOAT_BY_ID,
    HAT_BY_ID,
    OUTFIT_BY_ID,
    getFishById,
    getBaitById,
    getAquariumLevelInfo
  };
});
