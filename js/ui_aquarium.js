/**
 * ============================================================================
 * 《微风垂钓物语 2.0》模块 4：经济闭环、动态水族箱与 UI 交互系统 (js/ui_aquarium.js)
 * ============================================================================
 * 负责维护：
 * 1. 持久化存档系统 (WWF.loadProgress / WWF.saveProgress，兼容旧版存档迁移)
 * 2. HUD、鱼饵快捷栏、状态栏与 Toast 浮动通知 (WWF.updateHUD / WWF.updateActionUI / WWF.renderBaitSelector / WWF.showToast)
 * 3. 渔获结算弹窗 2.0 (WWF.openCatchModal / WWF.closeCatchModal：出售/放入水族箱/留存鱼篓/放生祈福)
 * 4. 动态观赏水族箱 & 随身鱼篓系统 (WWF.openAquariumModal / WWF.updateAquarium / WWF.renderAquariumCanvas)
 * 5. 老船长每日悬赏订单 & 黄金鱼潮召唤 (WWF.openOrdersModal / WWF.generateBountyOrders)
 * 6. 鱼类生态图鉴 & 多维实时概率矩阵 (WWF.openBookModal)
 * 7. 老船长渔具铺、远航船坞 & 角色纸娃娃换装工坊 (WWF.openShopModal / WWF.renderShopContent)
 * 8. 全局键盘/触屏/鼠标输入控制与主游戏循环启动 (window.onload)
 */
(function () {
    'use strict';

    const WWF = window.WWF = window.WWF || {};

    // 当前待处置的渔获结算对象
    let currentCatchResult = null;
    // 图鉴当前选中的海域筛选 ('all' | 0 | 1 | 2 | 3)
    let currentBookBiomeFilter = 'all';

    // ------------------------------------------------------------------------
    // 内部工具函数：查找鱼种、稀有度、鱼饵与概率计算兜底
    // ------------------------------------------------------------------------
    function getFishList() {
        return WWF.FISH_SPECIES || WWF.FISH_DB || [];
    }

    function getFishById(fishId) {
        const list = getFishList();
        return list.find(f => f.id === fishId) || list[0] || {
            id: fishId || 'minnow',
            name: '神秘鱼类',
            rarity: 'common',
            shape: 'oval',
            bodyColor: '#94a3b8',
            bellyColor: '#e2e8f0',
            finColor: '#64748b',
            pattern: 'none',
            baseValue: 15,
            prefBiome: 0,
            prefDepth: 0,
            prefWeather: 'any',
            skillType: 'steady',
            desc: '生活在微风湖泊中的神秘鱼儿。'
        };
    }

    function getBaitById(baitId) {
        const list = WWF.BAITS || [];
        return list.find(b => b.id === baitId) || list[0] || {
            id: 'dough',
            name: '普通面团',
            icon: '⚪',
            price: 0,
            packSize: 0,
            desc: '免费的基础麦香饵',
            multipliers: { common: 1, rare: 1, epic: 1, legendary: 1, mythic: 1 }
        };
    }

    function getAquariumUpgradeInfo(level) {
        const list = WWF.AQUARIUM_UPGRADES || [
            { level: 1, name: '桌面玻璃生态缸', capacity: 4, incomeMult: 1.0, price: 0 },
            { level: 2, name: '全景珊瑚水族箱', capacity: 6, incomeMult: 1.25, price: 180 },
            { level: 3, name: '深海琉璃展览馆', capacity: 9, incomeMult: 1.55, price: 420 },
            { level: 4, name: '皇家海底观光厅', capacity: 12, incomeMult: 1.90, price: 850 },
            { level: 5, name: '星海梦幻水晶宫', capacity: 16, incomeMult: 2.50, price: 1600 }
        ];
        const idx = Math.max(0, Math.min(list.length - 1, (level || 1) - 1));
        return list[idx];
    }

    function getBoatBonusInfo() {
        const p = WWF.player;
        if (!p || !p.inBoat) return { speedBonus: 1.0, luckBonus: 0 };
        const boatList = WWF.BOATS || [];
        const found = boatList.find(b => b.id === p.equippedBoat);
        return found || { speedBonus: 1.0, luckBonus: 0 };
    }

    /**
     * 安全调用 WWF.calculateProbabilities 并归一化返回结构：
     * { items: [{ fish, prob, weight }], tierProbs: { common, rare, epic, legendary, mythic }, shinyChance }
     */
    function getNormalizedProbabilities(baitId, depthZone, biomeFilter) {
        const p = WWF.player || {};
        const g = WWF.game || {};
        const bId = baitId || p.selectedBait || 'dough';
        const currentBiome = WWF.getCurrentBiome ? WWF.getCurrentBiome() : { index: 1, id: 'pier', baseDepthBonus: 1 };
        const targetBiomeIdx = (biomeFilter !== undefined && biomeFilter !== null && biomeFilter !== 'all')
            ? Number(biomeFilter)
            : currentBiome.index;
        const targetBiomeObj = (WWF.BIOMES && WWF.BIOMES[targetBiomeIdx]) || currentBiome;
        const dZone = typeof depthZone === 'number'
            ? depthZone
            : (typeof targetBiomeObj.baseDepthBonus === 'number' ? targetBiomeObj.baseDepthBonus : 1);

        if (typeof WWF.calculateProbabilities === 'function') {
            try {
                const raw = WWF.calculateProbabilities(bId, dZone, targetBiomeIdx, p.weatherId || 'sunny');
                if (raw) {
                    const tierProbs = raw.tierProbs || { common: 0, rare: 0, epic: 0, legendary: 0, mythic: 0 };
                    let items = raw.items || raw.fishProbs || raw.list || (Array.isArray(raw) ? raw : []);
                    const normalizedItems = items.map(entry => ({
                        fish: entry.fish || getFishById(entry.id || entry.fishId),
                        prob: typeof entry.prob === 'number' ? entry.prob : (entry.probability || 0)
                    }));
                    // 若 raw 未直接提供 tierProbs，则按 items 汇总
                    if (!raw.tierProbs && normalizedItems.length > 0) {
                        normalizedItems.forEach(it => {
                            if (it.fish && tierProbs[it.fish.rarity] !== undefined) {
                                tierProbs[it.fish.rarity] += it.prob;
                            }
                        });
                    }
                    const shinyChance = typeof raw.shinyChance === 'number'
                        ? raw.shinyChance
                        : (typeof raw.shinyProb === 'number'
                            ? raw.shinyProb
                            : (typeof WWF.getShinyChance === 'function' ? WWF.getShinyChance() : computeFallbackShinyChance()));
                    return { items: normalizedItems, tierProbs, shinyChance };
                }
            } catch (err) {
                console.warn('调用 calculateProbabilities 回退至内置计算:', err);
            }
        }

        // 内置兜底概率矩阵计算
        const fishList = getFishList();
        const bait = getBaitById(bId);
        const weather = (WWF.WEATHERS && WWF.WEATHERS[p.weatherId]) || {
            multipliers: { common: 1, rare: 1, epic: 1, legendary: 1, mythic: 1 },
            shinyBoost: 1
        };
        const boatLuck = getBoatBonusInfo().luckBonus || 0;
        const luckFactor = 1 + Math.min(1.5, (p.luckPoints || 0) * 0.018) + boatLuck;
        const goldenActive = (g.goldenTideTimer || 0) > 0;

        let totalW = 0;
        const temp = fishList.map(fish => {
            const bMult = (bait.multipliers && bait.multipliers[fish.rarity]) || 1;
            const wMult = (weather.multipliers && weather.multipliers[fish.rarity]) || 1;
            const biomeMatch = fish.prefBiome === targetBiomeIdx ? 1.85 : (Math.abs((fish.prefBiome || 0) - targetBiomeIdx) === 1 ? 0.85 : 0.35);
            const depthMatch = fish.prefDepth === dZone ? 1.35 : 0.85;
            const weatherPref = (fish.prefWeather === 'any' || fish.prefWeather === p.weatherId) ? 1.35 : 0.9;
            const highTierBoost = (fish.rarity !== 'common')
                ? luckFactor * (goldenActive && (fish.rarity === 'epic' || fish.rarity === 'legendary' || fish.rarity === 'mythic') ? 2.5 : 1)
                : 1;
            const w = Math.max(0.01, (fish.baseWeight || 10) * bMult * wMult * biomeMatch * depthMatch * weatherPref * highTierBoost);
            totalW += w;
            return { fish, weight: w };
        });

        const tierProbs = { common: 0, rare: 0, epic: 0, legendary: 0, mythic: 0 };
        const items = temp.map(it => {
            const prob = totalW > 0 ? it.weight / totalW : 0;
            if (tierProbs[it.fish.rarity] !== undefined) {
                tierProbs[it.fish.rarity] += prob;
            }
            return { fish: it.fish, prob };
        });

        return {
            items,
            tierProbs,
            shinyChance: computeFallbackShinyChance()
        };
    }

    function computeFallbackShinyChance() {
        if (typeof WWF.getShinyChance === 'function') return WWF.getShinyChance();
        const p = WWF.player || {};
        const g = WWF.game || {};
        const eco = WWF.ECONOMY_CONSTANTS || {};
        const weather = (WWF.WEATHERS && WWF.WEATHERS[p.weatherId]) || { shinyBoost: 1 };
        const boatLuck = p.inBoat ? (getBoatBonusInfo().luckBonus || 0) : 0;
        let chance = (eco.SHINY_BASE_CHANCE || 0.02) * (weather.shinyBoost || 1);
        chance += (p.luckPoints || 0) * 0.0035;
        chance += boatLuck * 0.15;
        if ((g.goldenTideTimer || 0) > 0) chance *= (eco.SHINY_GOLDEN_TIDE_MULT || 1.8);
        return Math.min(eco.SHINY_MAX_CHANCE || 0.40, Math.max(0.01, chance));
    }

    // ------------------------------------------------------------------------
    // 1. 持久化存档系统 (WWF.loadProgress, WWF.saveProgress)
    // ------------------------------------------------------------------------
    WWF.saveProgress = function () {
        const p = WWF.player;
        if (!p) return;
        try {
            const payload = {
                coins: Math.floor(Number(p.coins) || 0),
                luckPoints: Math.floor(Number(p.luckPoints) || 0),
                pityCounter: Math.floor(Number(p.pityCounter) || 0),
                rodLevel: Number(p.rodLevel) || 1,
                reelLevel: Number(p.reelLevel) || 1,
                selectedBait: p.selectedBait || 'dough',
                baits: {
                    worm: Number(p.baits && p.baits.worm) || 0,
                    gold: Number(p.baits && p.baits.gold) || 0,
                    star: Number(p.baits && p.baits.star) || 0
                },
                records: p.records || {},
                themeIndex: Number(p.themeIndex) || 0,
                weatherId: p.weatherId || 'sunny',
                muted: !!p.muted,
                worldX: Number(p.worldX) || 760,
                inBoat: !!p.inBoat,
                unlockedBoats: Array.isArray(p.unlockedBoats) ? p.unlockedBoats : ['none'],
                equippedBoat: p.equippedBoat || 'none',
                unlockedHats: Array.isArray(p.unlockedHats) ? p.unlockedHats : ['straw'],
                equippedHat: p.equippedHat || 'straw',
                unlockedOutfits: Array.isArray(p.unlockedOutfits) ? p.unlockedOutfits : ['casual'],
                equippedOutfit: p.equippedOutfit || 'casual',
                basket: Array.isArray(p.basket) ? p.basket : [],
                aquarium: Array.isArray(p.aquarium) ? p.aquarium : [],
                aquariumLevel: Number(p.aquariumLevel) || 1,
                aquariumUnclaimedCoins: Number(p.aquariumUnclaimedCoins) || 0,
                bountyOrders: Array.isArray(p.bountyOrders) ? p.bountyOrders : [],
                completedOrdersCount: Number(p.completedOrdersCount) || 0
            };
            localStorage.setItem(WWF.SAVE_KEY, JSON.stringify(payload));
        } catch (e) {
            console.warn('保存存档失败:', e);
        }
    };

    // 兼容其他模块可能调用的 WWF.saveGame 别名
    WWF.saveGame = WWF.saveProgress;

    WWF.loadProgress = function () {
        const p = WWF.player;
        if (!p) return;

        let parsed = null;
        let migratedFromLegacy = false;

        try {
            const raw = localStorage.getItem(WWF.SAVE_KEY);
            if (raw) {
                parsed = JSON.parse(raw);
            } else if (WWF.LEGACY_SAVE_KEY) {
                const legacyRaw = localStorage.getItem(WWF.LEGACY_SAVE_KEY);
                if (legacyRaw) {
                    parsed = JSON.parse(legacyRaw);
                    migratedFromLegacy = true;
                }
            }
        } catch (e) {
            console.warn('读取存档失败，使用默认初始存档:', e);
        }

        if (parsed && typeof parsed === 'object') {
            if (typeof parsed.coins === 'number' && !isNaN(parsed.coins)) p.coins = Math.max(0, Math.floor(parsed.coins));
            if (typeof parsed.luckPoints === 'number' && !isNaN(parsed.luckPoints)) p.luckPoints = Math.max(0, Math.floor(parsed.luckPoints));
            if (typeof parsed.pityCounter === 'number' && !isNaN(parsed.pityCounter)) p.pityCounter = Math.max(0, Math.floor(parsed.pityCounter));
            if (typeof parsed.rodLevel === 'number' && !isNaN(parsed.rodLevel)) p.rodLevel = Math.max(1, Math.min(5, Math.floor(parsed.rodLevel)));
            if (typeof parsed.reelLevel === 'number' && !isNaN(parsed.reelLevel)) p.reelLevel = Math.max(1, Math.min(5, Math.floor(parsed.reelLevel)));
            if (typeof parsed.selectedBait === 'string') p.selectedBait = parsed.selectedBait;

            if (parsed.baits && typeof parsed.baits === 'object') {
                p.baits = {
                    dough: Infinity,
                    worm: Math.max(0, Number(parsed.baits.worm ?? 5)),
                    gold: Math.max(0, Number(parsed.baits.gold ?? 1)),
                    star: Math.max(0, Number(parsed.baits.star ?? 0))
                };
            } else {
                p.baits.dough = Infinity;
            }

            if (p.selectedBait !== 'dough' && (!p.baits[p.selectedBait] || p.baits[p.selectedBait] <= 0)) {
                p.selectedBait = 'dough';
            }

            if (parsed.records && typeof parsed.records === 'object') {
                p.records = parsed.records;
            }
            if (typeof parsed.themeIndex === 'number' && !isNaN(parsed.themeIndex)) {
                p.themeIndex = Math.max(0, Math.min(2, Math.floor(parsed.themeIndex)));
            }
            if (typeof parsed.weatherId === 'string' && WWF.WEATHERS && WWF.WEATHERS[parsed.weatherId]) {
                p.weatherId = parsed.weatherId;
            }
            if (typeof parsed.muted === 'boolean') {
                p.muted = parsed.muted;
            }
            if (typeof parsed.worldX === 'number' && !isNaN(parsed.worldX)) {
                p.worldX = Math.max(48, Math.min((WWF.WORLD_WIDTH || 2400) - 55, parsed.worldX));
            }
            if (typeof parsed.inBoat === 'boolean') {
                p.inBoat = parsed.inBoat;
            }
            if (Array.isArray(parsed.unlockedBoats)) {
                p.unlockedBoats = Array.from(new Set(['none', ...parsed.unlockedBoats]));
            }
            if (typeof parsed.equippedBoat === 'string') {
                p.equippedBoat = parsed.equippedBoat;
            }
            if (Array.isArray(parsed.unlockedHats)) {
                p.unlockedHats = Array.from(new Set(['straw', ...parsed.unlockedHats]));
            }
            if (typeof parsed.equippedHat === 'string' && p.unlockedHats.includes(parsed.equippedHat)) {
                p.equippedHat = parsed.equippedHat;
            }
            if (Array.isArray(parsed.unlockedOutfits)) {
                p.unlockedOutfits = Array.from(new Set(['casual', ...parsed.unlockedOutfits]));
            }
            if (typeof parsed.equippedOutfit === 'string' && p.unlockedOutfits.includes(parsed.equippedOutfit)) {
                p.equippedOutfit = parsed.equippedOutfit;
            }
            if (Array.isArray(parsed.basket)) {
                p.basket = parsed.basket;
            }
            if (Array.isArray(parsed.aquarium)) {
                p.aquarium = parsed.aquarium;
            }
            if (typeof parsed.aquariumLevel === 'number' && !isNaN(parsed.aquariumLevel)) {
                p.aquariumLevel = Math.max(1, Math.min(5, Math.floor(parsed.aquariumLevel)));
            }
            if (typeof parsed.aquariumUnclaimedCoins === 'number' && !isNaN(parsed.aquariumUnclaimedCoins)) {
                p.aquariumUnclaimedCoins = Math.max(0, parsed.aquariumUnclaimedCoins);
            }
            if (Array.isArray(parsed.bountyOrders)) {
                p.bountyOrders = parsed.bountyOrders;
            }
            if (typeof parsed.completedOrdersCount === 'number' && !isNaN(parsed.completedOrdersCount)) {
                p.completedOrdersCount = Math.max(0, Math.floor(parsed.completedOrdersCount));
            }
        }

        // 校验深水区船只合法性
        const hasBoat = p.unlockedBoats && p.unlockedBoats.some(id => id !== 'none');
        if (p.worldX > 1160) {
            if (hasBoat) {
                p.inBoat = true;
                if (!p.equippedBoat || p.equippedBoat === 'none') {
                    p.equippedBoat = p.unlockedBoats.find(id => id !== 'none') || 'rowboat';
                }
            } else {
                p.worldX = 760;
                p.inBoat = false;
            }
        }

        // 若悬赏订单为空则初始化生成 3 个悬赏订单
        if (!Array.isArray(p.bountyOrders) || p.bountyOrders.length === 0) {
            WWF.generateBountyOrders(true);
        }

        if (migratedFromLegacy) {
            WWF.saveProgress();
        }
    };

    WWF.loadGame = WWF.loadProgress;

    // ------------------------------------------------------------------------
    // 2. HUD、鱼饵栏与 Toast 提示
    //    (WWF.updateHUD, WWF.updateActionUI, WWF.renderBaitSelector, WWF.showToast)
    // ------------------------------------------------------------------------
    WWF.updateOddsPreview = function () {
        const p = WWF.player;
        const g = WWF.game;
        if (!p || !g) return;

        const hudWeatherName = document.getElementById('hudWeatherName');
        const weather = (WWF.WEATHERS && WWF.WEATHERS[p.weatherId]) || { icon: '☀️', name: '晴空微风' };
        if (hudWeatherName) {
            hudWeatherName.textContent = `${weather.icon} ${weather.name}`;
        }

        const hudBaitName = document.getElementById('hudBaitName');
        const bait = getBaitById(p.selectedBait);
        const bCount = p.baits ? p.baits[p.selectedBait] : Infinity;
        if (hudBaitName) {
            hudBaitName.textContent = `${bait.name} (${bCount === Infinity ? '∞' : bCount})`;
        }

        const hudOddsPreview = document.getElementById('hudOddsPreview');
        const mobileEnvPill = document.getElementById('mobileEnvPill');
        if (hudOddsPreview || mobileEnvPill) {
            const probData = getNormalizedProbabilities(p.selectedBait, g.depthZone, null);
            const tp = probData.tierProbs || {};
            const rarePlus = (((tp.rare || 0) + (tp.epic || 0) + (tp.legendary || 0) + (tp.mythic || 0)) * 100).toFixed(1);
            const mythicPct = ((tp.mythic || 0) * 100).toFixed(2);
            const shinyPct = ((probData.shinyChance || 0.02) * 100).toFixed(1);
            if (hudOddsPreview) {
                hudOddsPreview.textContent = `稀有以上: ${rarePlus}% · 神话: ${mythicPct}% · 闪光率: ${shinyPct}%`;
            }
            if (mobileEnvPill) {
                mobileEnvPill.textContent = `${weather.icon} ${bait.icon}${bait.name} · 稀有↑${rarePlus}%`;
            }
        }
    };

    WWF.updateHUD = function () {
        const p = WWF.player;
        const g = WWF.game;
        if (!p) return;

        // 1. 顶部金币与商店弹窗金币
        const coinsStr = String(Math.floor(p.coins || 0));
        const hudCoins = document.getElementById('hudCoins');
        if (hudCoins) hudCoins.textContent = coinsStr;
        const hudCoinsMobile = document.getElementById('hudCoinsMobile');
        if (hudCoinsMobile) hudCoinsMobile.textContent = coinsStr;
        const shopCoins = document.getElementById('shopCoins');
        if (shopCoins) shopCoins.textContent = coinsStr;

        // 2. 钓竿等级
        const hudRodLevel = document.getElementById('hudRodLevel');
        if (hudRodLevel) {
            const rods = WWF.ROD_UPGRADES || [];
            const curRod = rods.find(r => r.level === p.rodLevel) || rods[p.rodLevel - 1] || { name: '木制钓竿' };
            hudRodLevel.textContent = `${curRod.name} Lv.${p.rodLevel || 1}`;
        }

        // 3. 图鉴进度 (X / 20)
        const hudCollectionCount = document.getElementById('hudCollectionCount');
        if (hudCollectionCount) {
            const fishList = getFishList();
            const totalSpecies = fishList.length || 20;
            const unlockedCount = fishList.filter(f => p.records && p.records[f.id] && p.records[f.id].count > 0).length;
            hudCollectionCount.textContent = `图鉴: ${unlockedCount} / ${totalSpecies}`;
        }

        // 4. 祈福幸运值
        const hudLuckPoints = document.getElementById('hudLuckPoints');
        if (hudLuckPoints) {
            hudLuckPoints.textContent = `🍀 幸运: ${Math.floor(p.luckPoints || 0)}`;
        }

        // 5. 水族箱 & 鱼篓总数徽章
        const hudAquariumCount = document.getElementById('hudAquariumCount');
        if (hudAquariumCount) {
            const totalFishHeld = (Array.isArray(p.aquarium) ? p.aquarium.length : 0) + (Array.isArray(p.basket) ? p.basket.length : 0);
            hudAquariumCount.textContent = String(totalFishHeld);
        }

        // 6. 可交付悬赏订单徽章
        const hudOrdersBadge = document.getElementById('hudOrdersBadge');
        if (hudOrdersBadge) {
            const orders = Array.isArray(p.bountyOrders) ? p.bountyOrders : [];
            let deliverableCount = 0;
            orders.forEach(ord => {
                if (findMatchingFishForOrder(ord)) deliverableCount++;
            });
            if (deliverableCount > 0) {
                hudOrdersBadge.textContent = window.innerWidth < 640 ? `✓${deliverableCount}` : `可交${deliverableCount}`;
                hudOrdersBadge.className = 'px-1 sm:px-1.5 py-0.2 bg-emerald-400 text-slate-950 font-extrabold rounded-full text-[9px] sm:text-[10px] animate-pulse whitespace-nowrap';
            } else {
                hudOrdersBadge.textContent = String(orders.length || 3);
                hudOrdersBadge.className = 'px-1 sm:px-1.5 py-0.2 bg-amber-300 text-slate-950 font-bold rounded-full text-[9px] sm:text-[10px] whitespace-nowrap';
            }
        }

        // 7. 顶部天气/天色/音效按钮图标 (同步桌面端与移动端按钮)
        const weather = (WWF.WEATHERS && WWF.WEATHERS[p.weatherId]) || { icon: '☀️', name: '晴空微风' };
        ['btnWeather', 'btnWeatherMobile'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.textContent = weather.icon;
                btn.title = `当前天气：${weather.name} (点击切换天气)`;
            }
        });

        const themes = WWF.THEMES || [
            { icon: '🌤️', name: '晨曦微光' },
            { icon: '🌅', name: '橘霞落日' },
            { icon: '🌙', name: '星夜流萤' }
        ];
        const th = themes[p.themeIndex % themes.length] || themes[0];
        ['btnTheme', 'btnThemeMobile'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.textContent = th.icon;
                btn.title = `当前天色：${th.name} (点击切换昼夜氛围)`;
            }
        });

        ['btnAudio', 'btnAudioMobile'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.textContent = p.muted ? '🔇' : '🔊';
            }
        });

        // 8. 左上角当前所在生态海域与左下角乘船按钮、四大生态快捷按钮高亮
        const biome = WWF.getCurrentBiome ? WWF.getCurrentBiome() : (WWF.BIOMES ? WWF.BIOMES[1] : { index: 1, name: '微风木栈桥', baseDepthBonus: 1 });
        const biomeLabel = document.getElementById('biomeLabel');
        if (biomeLabel && biome) {
            const depthText = biome.baseDepthBonus === 0 ? '浅水草滩' : (biome.baseDepthBonus === 1 ? '水深适中' : '远古深渊');
            biomeLabel.textContent = `${biome.name} (${p.inBoat ? '🚣 乘船探索' : depthText})`;
        }

        const boatBtnText = document.getElementById('boatBtnText');
        const nextDesktopBoat = p.inBoat ? '靠岸下船' : '乘船探索';
        if (boatBtnText && boatBtnText.textContent !== nextDesktopBoat) {
            boatBtnText.textContent = nextDesktopBoat;
        }
        const mobileBoatBtnText = document.getElementById('mobileBoatBtnText');
        const nextMobileBoat = p.inBoat ? '靠岸' : '乘船';
        if (mobileBoatBtnText && mobileBoatBtnText.textContent !== nextMobileBoat) {
            mobileBoatBtnText.textContent = nextMobileBoat;
        }

        const jumpBtns = document.querySelectorAll('.biome-jump-btn');
        jumpBtns.forEach(btn => {
            const idx = Number(btn.getAttribute('data-biome'));
            const activeVal = (biome && idx === biome.index) ? 'true' : 'false';
            if (btn.dataset) {
                if (btn.dataset.active !== activeVal) btn.dataset.active = activeVal;
            } else if (typeof btn.setAttribute === 'function') {
                btn.setAttribute('data-active', activeVal);
            }
        });

        // 9. 黄金鱼潮倒计时横幅
        const tideBanner = document.getElementById('goldenTideBanner');
        const tideTime = document.getElementById('goldenTideTime');
        if (tideBanner && g) {
            if (g.goldenTideTimer > 0) {
                tideBanner.classList.remove('hidden');
                tideBanner.classList.add('flex');
                if (tideTime) tideTime.textContent = `${Math.ceil(g.goldenTideTimer)}s`;
            } else {
                tideBanner.classList.add('hidden');
                tideBanner.classList.remove('flex');
            }
        }

        // 10. 右上角天气、鱼饵与实时概率摘要
        WWF.updateOddsPreview();
    };

    WWF.updateActionUI = function () {
        const g = WWF.game;
        if (!g) return;

        const btn = document.getElementById('mainActionBtn');
        const icon = document.getElementById('actionIcon');
        const label = document.getElementById('actionLabel');
        const statusDot = document.getElementById('statusDot');
        const statusText = document.getElementById('statusText');
        const depthHint = document.getElementById('depthHint');
        const depthLabel = document.getElementById('depthLabel');
        const qteBanner = document.getElementById('qteBanner');

        if (!btn || !icon || !label) return;

        // 水深浮标显示
        const depthNames = ['浅水区', '中水区', '深水区'];
        if (depthHint && depthLabel) {
            if (g.state === 'WAITING' || g.state === 'BITING' || g.state === 'REELING') {
                depthHint.classList.remove('hidden');
                depthLabel.textContent = depthNames[g.depthZone] || '中水区';
            } else {
                depthHint.classList.add('hidden');
            }
        }

        // QTE 跃水刺鱼横幅控制
        if (qteBanner) {
            if (g.state === 'REELING' && g.qteActive) {
                qteBanner.classList.remove('hidden');
            } else {
                qteBanner.classList.add('hidden');
            }
        }

        // 清理按钮状态类
        btn.classList.remove('btn-cast', 'btn-bite', 'btn-reel', 'btn-qte', 'btn-cancel', 'is-pressed');
        const isTouchUI = window.innerWidth < 640 || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

        switch (g.state) {
            case 'IDLE':
                btn.classList.add('btn-cast');
                icon.textContent = '🎣';
                label.textContent = '按住蓄力抛竿';
                if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-emerald-400 shrink-0';
                if (statusText) statusText.textContent = isTouchUI
                    ? '左右按钮探索 · 长按画布或按钮蓄力抛竿'
                    : 'A/D 自由移动探索 · 长按空格或按钮蓄力抛竿';
                break;

            case 'CHARGING': {
                btn.classList.add('btn-cast', 'is-pressed');
                const pct = Math.round((g.chargePower || 0) * 100);
                icon.textContent = '⚡';
                label.textContent = `松开抛竿 (蓄力 ${pct}%)`;
                if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-sky-400 animate-ping shrink-0';
                if (statusText) statusText.textContent = `正在蓄力 (${pct}%)... 瞄准远方深水区松开抛竿！`;
                break;
            }

            case 'CASTING':
                btn.classList.add('btn-cancel');
                icon.textContent = '🌊';
                label.textContent = '鱼漂飞出中...';
                if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-sky-300 shrink-0';
                if (statusText) statusText.textContent = '鱼线划出优美弧线，即将落入水面...';
                break;

            case 'WAITING':
                btn.classList.add('btn-cancel');
                icon.textContent = '⏳';
                label.textContent = '静候咬钩 (点击收竿)';
                if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-amber-300 animate-pulse shrink-0';
                if (statusText) statusText.textContent = '静候鱼儿试探浮漂... 浮漂猛沉时立即提竿！';
                break;

            case 'BITING':
                btn.classList.add('btn-bite');
                icon.textContent = '❗';
                label.textContent = '大鱼咬钩！立即提竿！';
                if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-rose-500 animate-ping shrink-0';
                if (statusText) statusText.textContent = isTouchUI
                    ? '❗ 浮漂猛沉！点击画面或按钮立即提竿！'
                    : '❗ 浮漂猛沉！快按【空格】或点击按钮刺鱼提竿！';
                break;

            case 'REELING':
                if (g.qteActive) {
                    btn.classList.add('btn-qte');
                    icon.textContent = '⚡';
                    label.textContent = isTouchUI ? '点击画面或此处空中刺鱼！' : '按 W / ↑ 或点击空中刺鱼！';
                    if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-rose-400 animate-ping shrink-0';
                    if (statusText) statusText.textContent = isTouchUI
                        ? '⚡ 大鱼跃水！快点击画面或按钮刺鱼 (+18%进度)！'
                        : '⚡ 大鱼跃水洗鳃！快按 [W / ↑] 或点击触发空中刺鱼 (+18%进度)！';
                } else {
                    btn.classList.add('btn-reel');
                    if (g.isHolding) btn.classList.add('is-pressed');
                    icon.textContent = '💪';
                    label.textContent = g.isHolding ? '拉升绿条中 (松开下潜)' : '按住拉升绿条 · 追踪大鱼';
                    if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0';
                    const skillHintMap = {
                        dash: '⚡ 大鱼正在狂暴冲刺！紧跟绿条！',
                        sink: '🪨 巨物沉底角力中！保持按住拉升！',
                        illusion: '🌀 幻影变速游动中！注意预判位置！',
                        stunned: '💫 空中刺鱼成功！大鱼眩晕中，加速收线！'
                    };
                    if (statusText) {
                        statusText.textContent = skillHintMap[g.fishSkillState] || '遛鱼博弈中：保持绿色捕获区覆盖鱼图标，满格即可起鱼！';
                    }
                }
                break;

            case 'LEAPING':
                btn.classList.add('btn-reel');
                icon.textContent = '✨';
                label.textContent = '破水飞鱼入怀中...';
                if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-amber-300 shrink-0';
                if (statusText) statusText.textContent = '✨ 完美起竿！大鱼破水飞跃而出！';
                break;

            case 'RESULT':
                btn.classList.add('btn-cast');
                icon.textContent = '🎉';
                label.textContent = '请选择渔获处置方式';
                if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-emerald-400 shrink-0';
                if (statusText) statusText.textContent = '捕获成功！可出售、放入水族箱、留存鱼篓交订单或放生祈福';
                break;
        }
    };

    WWF.renderBaitSelector = function () {
        const container = document.getElementById('baitSelector');
        const p = WWF.player;
        if (!container || !p) return;

        const baits = WWF.BAITS || [];
        container.innerHTML = baits.map((b, idx) => {
            const count = b.id === 'dough' ? Infinity : (p.baits && typeof p.baits[b.id] === 'number' ? p.baits[b.id] : 0);
            const isSelected = p.selectedBait === b.id;
            const countLabel = count === Infinity ? '∞' : count;
            const activeCls = isSelected
                ? 'bg-gradient-to-br from-sky-500/30 to-amber-500/20 border-amber-400 text-white shadow-lg ring-1 ring-amber-300/50'
                : 'bg-slate-800/80 hover:bg-slate-800 border-slate-700 text-slate-300';
            const emptyCls = (count !== Infinity && count <= 0) ? 'opacity-60' : '';

            const shortNames = { dough: '面团', worm: '红蚯蚓', gold: '黄金饵', star: '星辰饵' };
            return `
                <button data-bait-id="${b.id}" class="bait-slot-btn game-btn border rounded-xl px-1.5 py-1.5 sm:px-2.5 sm:py-2 text-left transition flex flex-col sm:flex-row items-center justify-between gap-0.5 sm:gap-2 ${activeCls} ${emptyCls}">
                    <div class="flex flex-col sm:flex-row items-center gap-0.5 sm:gap-2 min-w-0 w-full sm:w-auto">
                        <span class="text-base sm:text-lg shrink-0 leading-none">${b.icon}</span>
                        <div class="min-w-0 text-center sm:text-left w-full">
                            <div class="text-[11px] sm:text-xs font-bold truncate flex items-center justify-center sm:justify-start gap-1">
                                <span class="sm:hidden">${shortNames[b.id] || b.name}</span>
                                <span class="hidden sm:inline">${b.name}</span>
                                <span class="hidden sm:inline text-[10px] font-mono text-slate-400">[${idx + 1}]</span>
                            </div>
                            <div class="hidden sm:block text-[10px] text-slate-400 truncate">${b.id === 'dough' ? '全品级均衡' : (b.id === 'worm' ? '稀有/史诗↑' : (b.id === 'gold' ? '史诗/传说↑↑' : '传说/神话↑↑↑'))}</div>
                        </div>
                    </div>
                    <span class="px-1.5 py-0.2 sm:py-0.5 rounded-md text-[10px] sm:text-[11px] font-mono font-bold ${isSelected ? 'bg-amber-400 text-slate-950' : 'bg-slate-900 text-sky-300'}">
                        ${countLabel}
                    </span>
                </button>
            `;
        }).join('');

        container.querySelectorAll('.bait-slot-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const baitId = btn.getAttribute('data-bait-id');
                WWF.selectBait(baitId);
            });
        });
    };

    WWF.selectBait = function (baitId) {
        const p = WWF.player;
        if (!p) return;
        if (WWF.Sound && WWF.Sound.unlock) WWF.Sound.unlock();

        const bait = getBaitById(baitId);
        const count = bait.id === 'dough' ? Infinity : (p.baits[bait.id] || 0);
        if (count !== Infinity && count <= 0) {
            WWF.showToast(`🪱 【${bait.name}】已用完，可在老船长商店补充！`, 'warn');
            WWF.openShopModal();
            return;
        }
        p.selectedBait = bait.id;
        WWF.renderBaitSelector();
        WWF.updateHUD();
        WWF.saveProgress();
        WWF.showToast(`${bait.icon} 已切换鱼饵：${bait.name}`, 'info');
    };

    WWF.showToast = function (msg, type = 'info') {
        const container = document.getElementById('toastContainer');
        if (!container || !msg) return;

        while (container.children.length >= 4) {
            container.removeChild(container.firstChild);
        }

        const styleMap = {
            info: 'bg-slate-900/90 border-sky-400/50 text-sky-100',
            success: 'bg-emerald-950/90 border-emerald-400/60 text-emerald-100',
            warn: 'bg-amber-950/90 border-amber-400/60 text-amber-100',
            error: 'bg-rose-950/90 border-rose-400/60 text-rose-100',
            gold: 'bg-gradient-to-r from-amber-900/95 to-yellow-900/95 border-yellow-300 text-yellow-100',
            shiny: 'bg-gradient-to-r from-fuchsia-950/95 to-indigo-950/95 border-pink-400 text-pink-100'
        };

        const toast = document.createElement('div');
        toast.className = `modal-animate backdrop-blur-md border px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium shadow-xl transition-opacity duration-300 ${styleMap[type] || styleMap.info}`;
        toast.textContent = msg;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                if (toast.parentNode === container) {
                    container.removeChild(toast);
                }
            }, 300);
        }, 2500);
    };

    // ------------------------------------------------------------------------
    // 3. 渔获结算弹窗 2.0 (WWF.openCatchModal, WWF.closeCatchModal)
    // ------------------------------------------------------------------------
    WWF.openCatchModal = function (result, isNewSpecies, isNewRecord) {
        if (!result || !result.fish) return;
        const p = WWF.player;
        const fish = result.fish;
        currentCatchResult = result;

        if (WWF.game) {
            WWF.game.state = 'RESULT';
        }

        // 确保图鉴记录被同步（若 gameplay_physics 尚未写入则在此保底写入）
        if (p && p.records) {
            if (!p.records[fish.id]) {
                p.records[fish.id] = {
                    count: 1,
                    maxKg: result.weightKg,
                    maxLen: result.lengthCm,
                    shinyCount: result.isShiny ? 1 : 0
                };
                if (isNewSpecies === undefined) isNewSpecies = true;
            }
        }

        const rarityInfo = (WWF.RARITIES && WWF.RARITIES[fish.rarity]) || WWF.RARITIES.common;
        const modal = document.getElementById('catchModal');
        const card = document.getElementById('catchCard');
        const badgesEl = document.getElementById('catchBadges');
        const rarityTag = document.getElementById('catchRarityTag');
        const fishNameEl = document.getElementById('catchFishName');
        const probInfoEl = document.getElementById('catchProbInfo');
        const glowBg = document.getElementById('catchGlowBg');
        const svgContainer = document.getElementById('catchFishSvg');
        const lenEl = document.getElementById('catchLength');
        const weightEl = document.getElementById('catchWeight');
        const valueEl = document.getElementById('catchValue');
        const descEl = document.getElementById('catchDesc');
        const sellText = document.getElementById('btnCatchSellText');
        const releaseText = document.getElementById('btnCatchReleaseText');

        // 1. 卡片稀有度样式
        if (card) {
            card.className = `modal-animate relative w-full max-w-md rounded-3xl border-2 p-5 sm:p-6 text-center shadow-2xl ${rarityInfo.cardClass || 'rarity-common'}`;
        }

        // 2. 顶部徽章 (新物种 / 刷新纪录 / 闪光异色鱼 / 黄金鱼潮加成)
        if (badgesEl) {
            const badges = [];
            if (isNewSpecies) {
                badges.push(`<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/25 text-emerald-200 border border-emerald-400/50">🆕 新物种解锁！</span>`);
            }
            if (isNewRecord) {
                badges.push(`<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-500/25 text-sky-200 border border-sky-400/50">🏆 刷新最大纪录！</span>`);
            }
            if (result.isShiny) {
                badges.push(`<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-gradient-to-r from-amber-500/35 to-pink-500/35 text-yellow-200 border border-yellow-300/70 animate-pulse">✨ 闪光异色鱼 (价值×2.2!)</span>`);
            }
            if (result.goldenTideBonus || (WWF.game && WWF.game.goldenTideTimer > 0)) {
                badges.push(`<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/30 text-amber-200 border border-amber-300/60">🌊 黄金鱼潮加成 (+50%!)</span>`);
            }
            badgesEl.innerHTML = badges.join('');
        }

        // 3. 稀有度与名称
        if (rarityTag) {
            rarityTag.className = `inline-block px-3 py-0.5 rounded-full text-xs font-bold tracking-wider uppercase mb-1.5 ${rarityInfo.badgeBg || ''}`;
            rarityTag.textContent = `${rarityInfo.name} ${rarityInfo.en}`;
        }
        if (fishNameEl) {
            fishNameEl.textContent = `${result.isShiny ? '✨ ' : ''}${fish.name}`;
        }

        // 4. 综合概率
        if (probInfoEl) {
            let probPct = typeof result.prob === 'number' ? result.prob * 100 : null;
            if (probPct === null) {
                const probData = getNormalizedProbabilities(p.selectedBait, WWF.game ? WWF.game.depthZone : 1, null);
                const found = probData.items.find(it => it.fish && it.fish.id === fish.id);
                probPct = found ? found.prob * 100 : 5.0;
            }
            probInfoEl.textContent = `本次海域·天气·鱼饵综合概率：${probPct.toFixed(2)}%`;
        }

        // 5. 动态摆尾矢量鱼 SVG
        if (glowBg) {
            glowBg.style.background = `radial-gradient(circle, ${result.isShiny ? '#f472b6' : rarityInfo.glow} 0%, transparent 70%)`;
        }
        if (svgContainer && typeof WWF.createFishSVG === 'function') {
            svgContainer.innerHTML = WWF.createFishSVG(fish, false, !!result.isShiny);
            if (typeof WWF.bindFishShowcaseFeel === 'function') {
                WWF.bindFishShowcaseFeel(svgContainer, fish, {
                    enableTilt: true,
                    enablePoke: true,
                    isShiny: !!result.isShiny
                });
            }
        }

        // 6. 身长、体重、价值与描述
        if (lenEl) lenEl.textContent = `${Number(result.lengthCm).toFixed(1)} cm`;
        if (weightEl) weightEl.textContent = `${Number(result.weightKg).toFixed(2)} kg`;
        if (valueEl) valueEl.textContent = `+${result.value} 🪙`;
        if (descEl) descEl.textContent = fish.desc || '';

        // 7. 按钮文案更新
        if (sellText) {
            sellText.textContent = `立即出售 (+${result.value})`;
        }
        const baseLuck = rarityInfo.luckReward || 1;
        const luckGain = result.isShiny ? baseLuck * 2 : baseLuck;
        if (releaseText) {
            releaseText.textContent = `放生祈福 (+${luckGain}🍀)`;
        }

        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }

        WWF.updateHUD();
        WWF.updateActionUI();
        WWF.saveProgress();
    };

    WWF.closeCatchModal = function () {
        const svgContainer = document.getElementById('catchFishSvg');
        if (svgContainer && typeof svgContainer._wwfFeelCleanup === 'function') {
            svgContainer._wwfFeelCleanup();
            svgContainer._wwfFeelCleanup = null;
        }
        const modal = document.getElementById('catchModal');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
        currentCatchResult = null;
        if (WWF.game) {
            WWF.game.state = 'IDLE';
            WWF.game.pose = 'idle';
            WWF.game.hookedRoll = null;
            WWF.game.isHolding = false;
        }
        WWF.updateHUD();
        WWF.updateActionUI();
        WWF.saveProgress();
    };

    function createStoredFishObject(result) {
        return {
            uid: result.uid || ('fish_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
            fishId: result.fish.id,
            name: result.fish.name,
            rarity: result.fish.rarity,
            lengthCm: Number(result.lengthCm),
            weightKg: Number(result.weightKg),
            value: Number(result.value),
            isShiny: !!result.isShiny,
            ...(typeof result.sizeFactor === 'number' ? { sizeFactor: +result.sizeFactor.toFixed(4) } : {}),
            ...(result.ruleVersion ? { ruleVersion: result.ruleVersion } : {}),
            caughtAt: Date.now()
        };
    }

    function handleCatchSell() {
        if (!currentCatchResult) return;
        const res = currentCatchResult;
        WWF.player.coins += Number(res.value) || 0;
        if (WWF.Sound && WWF.Sound.playCoin) WWF.Sound.playCoin();
        WWF.showToast(`🪙 出售【${res.isShiny ? '✨闪光·' : ''}${res.fish.name}】获得 +${res.value} 金币！`, 'gold');
        WWF.closeCatchModal();
    }

    function handleCatchToAquarium() {
        if (!currentCatchResult) return;
        const p = WWF.player;
        const upg = getAquariumUpgradeInfo(p.aquariumLevel);
        if (p.aquarium.length >= upg.capacity) {
            WWF.showToast(`⚠️ 水族箱容量已满 (${p.aquarium.length}/${upg.capacity})！请先留存鱼篓或扩建水族箱`, 'warn');
            return;
        }
        const fishObj = createStoredFishObject(currentCatchResult);
        p.aquarium.push(fishObj);
        syncAquariumSwimmers();
        if (WWF.Sound && WWF.Sound.playPlop) WWF.Sound.playPlop();
        WWF.showToast(`🐠 已将【${fishObj.isShiny ? '✨' : ''}${fishObj.name}】放入生态水族箱观赏！`, 'success');
        WWF.closeCatchModal();
    }

    function handleCatchToBasket() {
        if (!currentCatchResult) return;
        const fishObj = createStoredFishObject(currentCatchResult);
        WWF.player.basket.push(fishObj);
        if (WWF.Sound && WWF.Sound.playPlop) WWF.Sound.playPlop();
        WWF.showToast(`🧺 已将【${fishObj.isShiny ? '✨' : ''}${fishObj.name}】存入鱼篓（可交付老船长悬赏订单）！`, 'info');
        WWF.closeCatchModal();
    }

    function handleCatchRelease() {
        if (!currentCatchResult) return;
        const res = currentCatchResult;
        const rarityInfo = (WWF.RARITIES && WWF.RARITIES[res.fish.rarity]) || { luckReward: 1 };
        const baseLuck = rarityInfo.luckReward || 1;
        const gain = res.isShiny ? baseLuck * 2 : baseLuck;
        WWF.player.luckPoints = (WWF.player.luckPoints || 0) + gain;
        if (WWF.Sound && WWF.Sound.playQTESuccess) WWF.Sound.playQTESuccess();
        WWF.showToast(`🙏 放生【${res.isShiny ? '✨' : ''}${res.fish.name}】祈福成功！获得 +${gain} 🍀 幸运值！`, 'success');
        WWF.closeCatchModal();
    }

    // ------------------------------------------------------------------------
    // 4. 动态观赏水族箱 & 随身鱼篓系统
    //    (WWF.openAquariumModal, WWF.closeAquariumModal, WWF.updateAquarium, WWF.renderAquariumCanvas)
    // ------------------------------------------------------------------------
    const aqVisual = {
        isOpen: false,
        cw: 860,
        ch: 250,
        dpr: 1,
        time: 0,
        swimmers: [],
        pellets: [],
        bubbles: [],
        wakeBubbles: [],
        ripples: [],
        pokeBubbles: [],
        hearts: [],
        seaweeds: [],
        corals: [],
        pointer: { active: false, x: 0, y: 0, vx: 0, vy: 0, speed: 0, lastTs: 0 },
        initialized: false,
        lastDisplayedUnclaimed: -1
    };

    // 20 种鱼类的生态泳姿、偏爱水深区间、群游与警觉配置
    const AQUARIUM_SPECIES_PROFILES = {
        minnow:           { gait: 'burst_glide',     depthMin: 0.14, depthMax: 0.44, speedMult: 1.18, schooling: 0.85, shyness: 0.72, hoverChance: 0.16 },
        crucian:          { gait: 'gentle_cruise',   depthMin: 0.34, depthMax: 0.72, speedMult: 0.88, schooling: 0.42, shyness: 0.35, hoverChance: 0.28 },
        perch:            { gait: 'burst_glide',     depthMin: 0.36, depthMax: 0.76, speedMult: 1.05, schooling: 0.25, shyness: 0.25, hoverChance: 0.24 },
        loach:            { gait: 'serpentine',      depthMin: 0.72, depthMax: 0.94, speedMult: 0.96, schooling: 0.18, shyness: 0.62, hoverChance: 0.15 },
        bluegill:         { gait: 'gentle_cruise',   depthMin: 0.28, depthMax: 0.66, speedMult: 0.92, schooling: 0.45, shyness: 0.32, hoverChance: 0.32 },
        emerald_puffer:   { gait: 'puff_scoot',      depthMin: 0.25, depthMax: 0.68, speedMult: 0.78, schooling: 0.08, shyness: 0.18, hoverChance: 0.48 },
        trout:            { gait: 'burst_glide',     depthMin: 0.20, depthMax: 0.56, speedMult: 1.14, schooling: 0.30, shyness: 0.55, hoverChance: 0.18 },
        bass:             { gait: 'burst_glide',     depthMin: 0.34, depthMax: 0.72, speedMult: 1.06, schooling: 0.12, shyness: 0.22, hoverChance: 0.26 },
        koi:              { gait: 'majestic_cruise', depthMin: 0.22, depthMax: 0.62, speedMult: 0.86, schooling: 0.52, shyness: 0.10, hoverChance: 0.30 },
        golden_carp:      { gait: 'majestic_cruise', depthMin: 0.24, depthMax: 0.64, speedMult: 0.84, schooling: 0.48, shyness: 0.10, hoverChance: 0.30 },
        coral_seahorse:   { gait: 'hover_bob',       depthMin: 0.38, depthMax: 0.82, speedMult: 0.52, schooling: 0.10, shyness: 0.28, hoverChance: 0.65 },
        thunder_eel:      { gait: 'serpentine',      depthMin: 0.42, depthMax: 0.88, speedMult: 1.12, schooling: 0.05, shyness: 0.20, hoverChance: 0.14 },
        arowana:          { gait: 'majestic_cruise', depthMin: 0.14, depthMax: 0.46, speedMult: 0.96, schooling: 0.10, shyness: 0.15, hoverChance: 0.20 },
        catfish:          { gait: 'serpentine',      depthMin: 0.74, depthMax: 0.95, speedMult: 0.74, schooling: 0.05, shyness: 0.15, hoverChance: 0.38 },
        sakura_salmon:    { gait: 'burst_glide',     depthMin: 0.22, depthMax: 0.62, speedMult: 1.10, schooling: 0.28, shyness: 0.30, hoverChance: 0.18 },
        sunken_angler:    { gait: 'hover_bob',       depthMin: 0.58, depthMax: 0.90, speedMult: 0.64, schooling: 0.00, shyness: 0.10, hoverChance: 0.56 },
        phantom_sturgeon: { gait: 'majestic_cruise', depthMin: 0.64, depthMax: 0.94, speedMult: 0.82, schooling: 0.00, shyness: 0.10, hoverChance: 0.22 },
        moonfish:         { gait: 'hover_bob',       depthMin: 0.16, depthMax: 0.54, speedMult: 0.76, schooling: 0.15, shyness: 0.12, hoverChance: 0.46 },
        dragon_koi:       { gait: 'majestic_cruise', depthMin: 0.22, depthMax: 0.68, speedMult: 0.94, schooling: 0.20, shyness: 0.08, hoverChance: 0.24 },
        astral_leviathan: { gait: 'serpentine',      depthMin: 0.26, depthMax: 0.74, speedMult: 0.92, schooling: 0.08, shyness: 0.08, hoverChance: 0.20 }
    };

    function getAquariumSwimProfile(fish, motion) {
        const id = fish && fish.id;
        if (id && AQUARIUM_SPECIES_PROFILES[id]) {
            return AQUARIUM_SPECIES_PROFILES[id];
        }
        const style = (motion && motion.swimStyle) || 'glide';
        const gaitMap = {
            dart: 'burst_glide',
            undulate: 'serpentine',
            majestic: 'majestic_cruise',
            hover: 'hover_bob',
            puff: 'puff_scoot'
        };
        return {
            gait: gaitMap[style] || 'gentle_cruise',
            depthMin: 0.22,
            depthMax: 0.76,
            speedMult: 0.92,
            schooling: 0.2,
            shyness: 0.25,
            hoverChance: 0.24
        };
    }

    function getAquariumVerticalBounds(size, ch) {
        const floorY = ch - 26;
        const minY = Math.min(28, Math.max(16, ch * 0.14));
        const maxY = Math.max(minY + 28, floorY - (size || 22) * 0.56 - 8);
        return { floorY, minY, maxY };
    }

    function getAquariumSwimMargins(size, cw, ch) {
        const { floorY, minY, maxY } = getAquariumVerticalBounds(size, ch);
        const safeSize = size || 22;
        const hardMarginX = Math.min(cw * 0.16, Math.max(22, safeSize * 0.72 + 10));
        const softMarginX = Math.min(cw * 0.22, Math.max(36, safeSize * 1.05 + 22));
        const waypointMarginX = Math.min(cw * 0.34, softMarginX + 14);
        const softMarginY = Math.min(14, Math.max(8, (maxY - minY) * 0.12));
        const waypointMinY = Math.min(maxY - 6, minY + softMarginY + 4);
        const waypointMaxY = Math.max(waypointMinY + 6, maxY - softMarginY - 4);
        return {
            floorY,
            minY,
            maxY,
            hardMarginX,
            softMarginX,
            waypointMarginX,
            softMarginY,
            waypointMinY,
            waypointMaxY
        };
    }

    function spawnAquariumWakeBubble(x, y, vx, vy, r, isShiny) {
        if (aqVisual.wakeBubbles.length >= 64) {
            aqVisual.wakeBubbles.shift();
        }
        aqVisual.wakeBubbles.push({
            x,
            y,
            vx: vx || 0,
            vy: vy || (-16 - Math.random() * 14),
            r: r || (1.1 + Math.random() * 1.3),
            alpha: 0.72,
            isShiny: !!isShiny
        });
    }

    function spawnAquariumRipple(x, y, maxR, color) {
        if (aqVisual.ripples.length >= 24) {
            aqVisual.ripples.shift();
        }
        aqVisual.ripples.push({
            x,
            y,
            r: 4,
            maxR: maxR || 22,
            alpha: 0.72,
            color: color || 'rgba(125, 211, 252, 0.45)'
        });
    }

    function pickAquariumWaypoint(s, profile, cw, minY, maxY, preferOppositeX = false, margins = null) {
        const m = margins || getAquariumSwimMargins(s.size, cw, aqVisual.ch);
        const minX = m.waypointMarginX;
        const maxX = Math.max(minX + 12, cw - m.waypointMarginX);
        let goalX;

        if (s.fish && s.fish.id === 'coral_seahorse' && aqVisual.corals.length > 0 && Math.random() < 0.55) {
            const c = aqVisual.corals[Math.floor(Math.random() * aqVisual.corals.length)];
            goalX = clampNum(c.xRatio * cw + (Math.random() - 0.5) * 52, minX, maxX);
        } else if (preferOppositeX) {
            const goRight = s.x < cw * 0.5;
            const lo = goRight ? Math.max(minX, cw * 0.48) : minX;
            const hi = goRight ? maxX : Math.min(maxX, cw * 0.52);
            goalX = lo + Math.random() * Math.max(8, hi - lo);
        } else {
            goalX = minX + Math.random() * (maxX - minX);
        }

        const spanY = Math.max(8, m.waypointMaxY - m.waypointMinY);
        const wanderPad = 0.06;
        const d0 = clampNum(profile.depthMin - (Math.random() < 0.2 ? wanderPad : 0), 0.04, 0.90);
        const d1 = clampNum(profile.depthMax + (Math.random() < 0.2 ? wanderPad : 0), d0 + 0.08, 0.96);
        const goalY = clampNum(m.waypointMinY + spanY * (d0 + Math.random() * (d1 - d0)), m.waypointMinY, m.waypointMaxY);
        const goalZ = clampNum((Math.random() * 2 - 1) * 0.72, -0.78, 0.78);

        return { goalX, goalY, goalZ };
    }

    function clampSwimmersToAquariumBounds() {
        const cw = aqVisual.cw;
        const ch = aqVisual.ch;
        for (const s of aqVisual.swimmers) {
            const m = getAquariumSwimMargins(s.size, cw, ch);
            const maxXHard = Math.max(m.hardMarginX, cw - m.hardMarginX);
            const maxXWp = Math.max(m.waypointMarginX + 12, cw - m.waypointMarginX);
            s.x = clampNum(s.x, m.hardMarginX, maxXHard);
            s.y = clampNum(s.y, m.minY, m.maxY);
            if (typeof s.goalX === 'number') {
                s.goalX = clampNum(s.goalX, m.waypointMarginX, maxXWp);
            }
            if (typeof s.goalY === 'number') {
                s.goalY = clampNum(s.goalY, m.waypointMinY, m.waypointMaxY);
            }
        }
    }

    function clampNum(v, min, max) {
        return v < min ? min : (v > max ? max : v);
    }

    function stepAquariumSpring(val, vel, target, k, c, dt) {
        const totalDt = Math.max(0, dt || 0);
        if (totalDt <= 0) return { val, vel };
        const steps = Math.min(4, Math.max(1, Math.ceil(totalDt / 0.014)));
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

    function spawnAquariumPokeParticles(x, y, size, dir, isShiny, isPuffer) {
        const safeSize = size || 22;
        const safeDir = dir || 1;
        aqVisual.hearts.push({
            x: x + safeDir * (safeSize * 0.35),
            y: y - safeSize * 0.55,
            vy: -28,
            alpha: 1.0,
            text: isShiny ? '✨💖' : (isPuffer ? '🐡💚' : '💖')
        });
        const bubbleCount = 5;
        for (let i = 0; i < bubbleCount; i++) {
            aqVisual.pokeBubbles.push({
                x: x + (Math.random() - 0.5) * safeSize * 0.9,
                y: y + (Math.random() - 0.5) * safeSize * 0.5,
                vx: (Math.random() - 0.5) * 26 - safeDir * 12,
                vy: -24 - Math.random() * 26,
                r: 2.0 + Math.random() * 2.8,
                alpha: 0.95,
                isShiny: !!isShiny
            });
        }
    }

    function initAquariumDecorations() {
        if (aqVisual.initialized) return;
        aqVisual.initialized = true;

        aqVisual.seaweeds = [];
        for (let i = 0; i < 14; i++) {
            aqVisual.seaweeds.push({
                xRatio: 0.04 + (i / 14) * 0.92 + (Math.random() - 0.5) * 0.03,
                segments: 5 + Math.floor(Math.random() * 3),
                segLen: 10 + Math.random() * 6,
                phase: Math.random() * Math.PI * 2,
                color: i % 3 === 0 ? '#10b981' : (i % 2 === 0 ? '#059669' : '#0d9488'),
                layer: (i % 4 === 1) ? 1 : 0,
                bend: 0,
                bendVel: 0
            });
        }

        aqVisual.corals = [
            { xRatio: 0.16, color: '#f43f5e', size: 22, branches: 4 },
            { xRatio: 0.38, color: '#a855f7', size: 18, branches: 3 },
            { xRatio: 0.64, color: '#fb923c', size: 24, branches: 5 },
            { xRatio: 0.85, color: '#ec4899', size: 20, branches: 4 }
        ];

        aqVisual.bubbles = [];
        for (let i = 0; i < 24; i++) {
            aqVisual.bubbles.push({
                x: Math.random() * aqVisual.cw,
                y: Math.random() * aqVisual.ch,
                r: 1.5 + Math.random() * 3.2,
                vy: 18 + Math.random() * 28,
                phase: Math.random() * Math.PI * 2
            });
        }
    }

    function resizeAquariumCanvas() {
        const canvas = document.getElementById('aquariumCanvas');
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const cssW = canvas.clientWidth || rect.width;
        const cssH = canvas.clientHeight || rect.height;
        if (cssW < 10 || cssH < 10) return;

        aqVisual.dpr = Math.min(window.devicePixelRatio || 1, 2);
        aqVisual.cw = Math.floor(cssW);
        aqVisual.ch = Math.floor(cssH);
        canvas.width = Math.floor(aqVisual.cw * aqVisual.dpr);
        canvas.height = Math.floor(aqVisual.ch * aqVisual.dpr);
        clampSwimmersToAquariumBounds();
    }

    function syncAquariumSwimmers() {
        const p = WWF.player;
        if (!p || !Array.isArray(p.aquarium)) return;
        initAquariumDecorations();

        const existingMap = new Map();
        aqVisual.swimmers.forEach(s => existingMap.set(s.uid, s));

        aqVisual.swimmers = p.aquarium.map((entry, idx) => {
            const fish = getFishById(entry.fishId);
            const motion = (WWF.FishArt && typeof WWF.FishArt.getMotion === 'function')
                ? WWF.FishArt.getMotion(fish)
                : { swimStyle: 'glide', tailFreq: 8.5, bodyFlex: 0.18, turnAgility: 1.0, bobAmp: 3.5 };
            const profile = getAquariumSwimProfile(fish, motion);

            if (existingMap.has(entry.uid)) {
                const s = existingMap.get(entry.uid);
                s.entry = entry;
                s.fish = fish;
                if (typeof s.pitch !== 'number') s.pitch = 0;
                if (typeof s.bodyBend !== 'number') s.bodyBend = 0;
                if (typeof s.bodyBendVel !== 'number') s.bodyBendVel = 0;
                if (typeof s.speedRatio !== 'number') s.speedRatio = 1;
                if (typeof s.puffFactor !== 'number') s.puffFactor = 0;
                if (typeof s.puffHoldTimer !== 'number') s.puffHoldTimer = 0;
                if (typeof s.pokeTimer !== 'number') s.pokeTimer = 0;
                if (typeof s.z !== 'number') s.z = ((idx * 0.6180339887) % 1) * 1.5 - 0.75;
                if (typeof s.vz !== 'number') s.vz = 0;
                if (typeof s.goalZ !== 'number') s.goalZ = s.z;
                if (typeof s.yaw !== 'number') s.yaw = s.dir >= 0 ? 0 : Math.PI;
                if (typeof s.visualDir !== 'number') s.visualDir = Math.cos(s.yaw);
                if (typeof s.turnArcY !== 'number') s.turnArcY = 0;
                if (typeof s.turnArcZ !== 'number') s.turnArcZ = 0;
                if (typeof s.turnLock !== 'number') s.turnLock = 0;
                if (typeof s.turnExitBoost !== 'number') s.turnExitBoost = 0;
                if (typeof s.wagPhase !== 'number') s.wagPhase = s.phase || Math.random() * Math.PI * 2;
                if (typeof s.finPhase !== 'number') s.finPhase = (s.phase || 0) * 0.7 + Math.random() * Math.PI;
                if (typeof s.squashX !== 'number') s.squashX = 1;
                if (typeof s.squashY !== 'number') s.squashY = 1;
                if (typeof s.squashVelX !== 'number') s.squashVelX = 0;
                if (typeof s.squashVelY !== 'number') s.squashVelY = 0;
                if (typeof s.aiState !== 'string') s.aiState = 'cruise';
                if (typeof s.stateTimer !== 'number') s.stateTimer = 1.8 + Math.random() * 2.5;
                if (typeof s.goalX !== 'number' || typeof s.goalY !== 'number') {
                    const m = getAquariumSwimMargins(s.size, aqVisual.cw, aqVisual.ch);
                    const wp = pickAquariumWaypoint(s, profile, aqVisual.cw, m.minY, m.maxY, false, m);
                    s.goalX = wp.goalX;
                    s.goalY = wp.goalY;
                    s.goalZ = wp.goalZ;
                }
                if (typeof s.gaitTimer !== 'number') s.gaitTimer = 0.6 + Math.random() * 1.8;
                if (typeof s.gaitKick !== 'number') s.gaitKick = 0;
                if (typeof s.finEffort !== 'number') s.finEffort = 1;
                if (typeof s.eatHappyTimer !== 'number') s.eatHappyTimer = 0;
                if (typeof s.wakeCooldown !== 'number') s.wakeCooldown = 0;
                if (typeof s.prevVy !== 'number') s.prevVy = s.vy || 0;
                if (typeof s.smoothAy !== 'number') s.smoothAy = 0;
                return s;
            }

            const raritySizeMap = { common: 18, rare: 22, epic: 26, legendary: 30, mythic: 34 };
            const size = raritySizeMap[entry.rarity] || 22;
            const dir = idx % 2 === 0 ? 1 : -1;
            const phase = Math.random() * Math.PI * 2;
            const m = getAquariumSwimMargins(size, aqVisual.cw, aqVisual.ch);
            const initMinX = m.waypointMarginX;
            const initMaxX = Math.max(initMinX + 12, aqVisual.cw - m.waypointMarginX);
            const initX = clampNum(
                initMinX + Math.random() * (initMaxX - initMinX),
                initMinX,
                initMaxX
            );
            const spanY = Math.max(8, m.waypointMaxY - m.waypointMinY);
            const initY = clampNum(
                m.waypointMinY + spanY * (profile.depthMin + Math.random() * Math.max(0.08, profile.depthMax - profile.depthMin)),
                m.waypointMinY,
                m.waypointMaxY
            );
            const initZ = clampNum(((idx * 0.6180339887) % 1) * 1.5 - 0.75, -0.78, 0.78);
            const baseSpeed = 28 + Math.random() * 20;
            const swimmer = {
                uid: entry.uid,
                entry: entry,
                fish: fish,
                x: initX,
                y: initY,
                z: initZ,
                vx: dir * baseSpeed * profile.speedMult * 0.75,
                vy: (Math.random() - 0.5) * 8,
                vz: 0,
                baseSpeed: baseSpeed,
                dir: dir,
                yaw: dir >= 0 ? 0 : Math.PI,
                visualDir: dir,
                size: size,
                phase: phase,
                wagPhase: phase,
                finPhase: phase * 0.7 + Math.random() * Math.PI,
                heartTimer: 0,
                pitch: 0,
                bodyBend: 0,
                bodyBendVel: 0,
                speedRatio: 1,
                puffFactor: 0,
                puffHoldTimer: 0,
                pokeTimer: 0,
                turnLock: 0,
                turnArcY: 0,
                turnArcZ: 0,
                turnExitBoost: 0,
                squashX: 1,
                squashY: 1,
                squashVelX: 0,
                squashVelY: 0,
                aiState: 'cruise',
                stateTimer: 1.6 + Math.random() * 2.8,
                goalX: initX,
                goalY: initY,
                goalZ: initZ,
                gaitTimer: 0.6 + Math.random() * 1.8,
                gaitKick: 0,
                finEffort: 1,
                eatHappyTimer: 0,
                wakeCooldown: 0,
                prevVy: 0,
                smoothAy: 0
            };
            const wp = pickAquariumWaypoint(swimmer, profile, aqVisual.cw, m.minY, m.maxY, false, m);
            swimmer.goalX = wp.goalX;
            swimmer.goalY = wp.goalY;
            swimmer.goalZ = wp.goalZ;
            return swimmer;
        });
    }

    /**
     * 计算水族箱当前每分钟总门票收益
     */
    function calculateAquariumIncomePerMinute() {
        const p = WWF.player;
        if (!p || !Array.isArray(p.aquarium) || p.aquarium.length === 0) return 0;
        const upg = getAquariumUpgradeInfo(p.aquariumLevel);
        let sum = 0;
        const shinyIncomeMult = (WWF.ECONOMY_CONSTANTS && WWF.ECONOMY_CONSTANTS.AQUARIUM_SHINY_INCOME_MULT) || 1.5;
        for (const item of p.aquarium) {
            const rInfo = (WWF.RARITIES && WWF.RARITIES[item.rarity]) || { aquariumIncome: 6 };
            const baseIncome = rInfo.aquariumIncome || 6;
            const shinyMult = item.isShiny ? shinyIncomeMult : 1.0;
            sum += baseIncome * shinyMult;
        }
        return Math.round(sum * (upg.incomeMult || 1.0));
    }

    WWF.updateAquarium = function (dt) {
        const p = WWF.player;
        if (!p) return;
        const safeDt = Math.min(dt || 0.016, 0.1);
        aqVisual.time += safeDt;

        // 1. 每秒自动累积门票被动收益至 player.aquariumUnclaimedCoins
        const perMin = calculateAquariumIncomePerMinute();
        if (perMin > 0) {
            p.aquariumUnclaimedCoins = (p.aquariumUnclaimedCoins || 0) + (perMin / 60) * safeDt;
        }

        // 若水族箱弹窗未打开则无需更新 Canvas 动画
        if (!aqVisual.isOpen) return;

        const unclaimedFloor = Math.floor(p.aquariumUnclaimedCoins || 0);
        if (unclaimedFloor !== aqVisual.lastDisplayedUnclaimed) {
            aqVisual.lastDisplayedUnclaimed = unclaimedFloor;
            const unclaimedEl = document.getElementById('aquariumUnclaimed');
            if (unclaimedEl) unclaimedEl.textContent = String(unclaimedFloor);
        }

        const cw = aqVisual.cw;
        const ch = aqVisual.ch;
        const floorY = ch - 26;

        // 衰减指针移动速度避免陈旧挥动误惊吓鱼群
        if (aqVisual.pointer) {
            const pDecay = Math.exp(-safeDt * 8);
            aqVisual.pointer.vx *= pDecay;
            aqVisual.pointer.vy *= pDecay;
            aqVisual.pointer.speed *= pDecay;
        }

        // 2. 更新上升气泡、水波涟漪与尾部微气泡
        for (const b of aqVisual.bubbles) {
            b.y -= b.vy * safeDt;
            b.phase += safeDt * 3;
            b.x += Math.sin(b.phase) * 10 * safeDt;
            if (b.y < -8) {
                b.y = floorY - 4;
                b.x = 20 + Math.random() * Math.max(20, cw - 40);
            }
        }
        for (let i = aqVisual.ripples.length - 1; i >= 0; i--) {
            const rp = aqVisual.ripples[i];
            rp.r += (rp.maxR - rp.r + 12) * Math.min(1, safeDt * 4.2);
            rp.alpha -= safeDt * 1.35;
            if (rp.alpha <= 0 || rp.r >= rp.maxR) {
                aqVisual.ripples.splice(i, 1);
            }
        }
        for (let i = aqVisual.wakeBubbles.length - 1; i >= 0; i--) {
            const wb = aqVisual.wakeBubbles[i];
            wb.x += wb.vx * safeDt;
            wb.y += wb.vy * safeDt;
            wb.vx *= Math.exp(-safeDt * 2.5);
            wb.vy -= 12 * safeDt;
            wb.alpha -= safeDt * 0.92;
            if (wb.alpha <= 0 || wb.y < 4) {
                aqVisual.wakeBubbles.splice(i, 1);
            }
        }

        // 3. 更新飘落与沙面停留的鱼食颗粒
        for (let i = aqVisual.pellets.length - 1; i >= 0; i--) {
            const pel = aqVisual.pellets[i];
            if (pel.eaten) {
                aqVisual.pellets.splice(i, 1);
                continue;
            }
            if (!pel.settled) {
                const targetVy = typeof pel.targetVy === 'number' ? pel.targetVy : 18;
                pel.vy += (targetVy - pel.vy) * Math.min(1, safeDt * 3.8);
                pel.y += pel.vy * safeDt;
                pel.phase += safeDt * 3.6;
                const pelDriftMinX = Math.min(cw * 0.14, 34);
                pel.x = clampNum(pel.x + Math.sin(pel.phase) * 12 * safeDt, pelDriftMinX, Math.max(pelDriftMinX, cw - pelDriftMinX));
                if (pel.y >= floorY - 3) {
                    pel.y = floorY - 3;
                    pel.vy = 0;
                    pel.settled = true;
                    pel.restTimer = typeof pel.restTimer === 'number' ? pel.restTimer : 2.6;
                }
            } else {
                pel.restTimer -= safeDt;
                if (pel.restTimer <= 0) {
                    aqVisual.pellets.splice(i, 1);
                }
            }
        }

        // 3.5 水草被鱼游过尾流轻拂的弹簧响应
        for (const sw of aqVisual.seaweeds) {
            const swX = sw.xRatio * cw;
            const swTopY = floorY - sw.segments * sw.segLen;
            for (const s of aqVisual.swimmers) {
                if (Math.abs(s.x - swX) < s.size + 18 && s.y > swTopY - 12) {
                    sw.bendVel = clampNum((sw.bendVel || 0) + clampNum(s.vx * 0.015, -2.8, 2.8) * safeDt * 22, -45, 45);
                }
            }
            const swRes = stepAquariumSpring(sw.bend || 0, sw.bendVel || 0, 0, 38, 5.2, safeDt);
            sw.bend = clampNum(swRes.val, -18, 18);
            sw.bendVel = swRes.vel;
        }

        const flipSwimmerDir = (s, newDir, minY, maxY, lockDuration = 0.90, force = false) => {
            if (s.dir === newDir) return false;
            const curYaw = typeof s.yaw === 'number' ? s.yaw : (s.dir >= 0 ? 0 : Math.PI);
            if (!force && Math.sin(curYaw) > 0.28) {
                return false;
            }
            s.dir = newDir;
            s.turnLock = Math.max(s.turnLock || 0, lockDuration);
            const span = Math.max(10, maxY - minY);
            const arcSign = s.y < minY + span * 0.28
                ? 1
                : (s.y > maxY - span * 0.28 ? -1 : (Math.random() < 0.5 ? -1 : 1));
            s.turnArcY = arcSign * (10 + Math.random() * 10);
            s.turnArcZ = (s.z > 0.35 ? -1 : (s.z < -0.35 ? 1 : (Math.random() < 0.5 ? -1 : 1))) * (0.35 + Math.random() * 0.28);
            return true;
        };

        // 4. 预先统计同缸鱼群分离与群游向量 + 鱼食分流分配
        const swimmers = aqVisual.swimmers;
        const nSwimmers = swimmers.length;
        const sepX = new Float64Array(nSwimmers);
        const sepY = new Float64Array(nSwimmers);
        const sepZ = new Float64Array(nSwimmers);
        const schoolVx = new Float64Array(nSwimmers);
        const schoolVy = new Float64Array(nSwimmers);
        const schoolWeight = new Float64Array(nSwimmers);

        for (let i = 0; i < nSwimmers; i++) {
            const a = swimmers[i];
            const profA = getAquariumSwimProfile(a.fish);
            for (let j = i + 1; j < nSwimmers; j++) {
                const b = swimmers[j];
                const dx = a.x - b.x;
                const dy = a.y - b.y;
                const dz = (a.z - b.z) * 42;
                const dist = Math.hypot(dx, dy, dz);
                const minSep = (a.size + b.size) * 1.15;

                if (dist > 0.001 && dist < minSep && a.pokeTimer <= 0.5 && b.pokeTimer <= 0.5) {
                    const overlap = 1 - dist / minSep;
                    const force = overlap * 56;
                    const nx = dx / dist;
                    const ny = dy / dist;
                    const nz = dz / dist;
                    sepX[i] += nx * force;
                    sepY[i] += ny * force;
                    sepZ[i] += nz * overlap * 1.8;
                    sepX[j] -= nx * force;
                    sepY[j] -= ny * force;
                    sepZ[j] -= nz * overlap * 1.8;
                    if (Math.abs(a.z - b.z) < 0.18 && dist < minSep * 0.72) {
                        const zNudge = (i % 2 === 0 ? 1 : -1) * overlap * 0.9;
                        sepZ[i] += zNudge;
                        sepZ[j] -= zNudge;
                    }
                }

                // 群游倾向（同类鱼群或均具备群游天性的鱼在附近温和对齐方向）
                const profB = getAquariumSwimProfile(b.fish);
                if (dist < 145 && profA.schooling > 0.25 && profB.schooling > 0.25) {
                    const sameSpecies = (a.fish && b.fish && a.fish.id === b.fish.id) ? 1.5 : 0.7;
                    const w = (1 - dist / 145) * sameSpecies;
                    schoolVx[i] += b.vx * w;
                    schoolVy[i] += ((b.y - a.y) * 0.65 + b.vy * 0.45) * w;
                    schoolWeight[i] += w;
                    schoolVx[j] += a.vx * w;
                    schoolVy[j] += ((a.y - b.y) * 0.65 + a.vy * 0.45) * w;
                    schoolWeight[j] += w;
                }
            }
        }

        const pelletClaims = aqVisual.pellets.length > 0 ? new Map() : null;

        // 4.5 更新每条观赏鱼水动力学游姿、转向编舞、生态节律与互动响应
        for (let idx = 0; idx < nSwimmers; idx++) {
            const s = swimmers[idx];
            const motion = (WWF.FishArt && typeof WWF.FishArt.getMotion === 'function')
                ? WWF.FishArt.getMotion(s.fish)
                : { swimStyle: 'glide', tailFreq: 8.5, bodyFlex: 0.18, turnAgility: 1.0, bobAmp: 3.5 };
            const profile = getAquariumSwimProfile(s.fish, motion);
            const isSeahorse = Boolean(s.fish && s.fish.id === 'coral_seahorse');
            const isPuffer = Boolean(s.fish && s.fish.id === 'emerald_puffer');
            const turnAgility = clampNum(motion.turnAgility || 1.0, 0.45, 2.2);
            const bodyFlex = clampNum(motion.bodyFlex || 0.18, 0.08, 0.52);
            const margins = getAquariumSwimMargins(s.size, cw, ch);
            const { minY, maxY } = margins;
            const curVisDir = typeof s.visualDir === 'number' ? s.visualDir : s.dir;
            const edgeProxX = clampNum(
                Math.max((margins.softMarginX - s.x) / 28, (s.x - (cw - margins.softMarginX)) / 28, 0),
                0,
                1
            );
            const sepSteerX = clampNum(sepX[idx] * 0.55, -26, 26) * (1 - edgeProxX * 0.78);
            const sepSteerY = clampNum(sepY[idx] * 0.45, -18, 18);
            const sepSteerZ = clampNum(sepZ[idx], -1.6, 1.6);

            const phaseRate = profile.gait === 'serpentine'
                ? 2.85
                : (profile.gait === 'majestic_cruise' ? 1.75 : (isSeahorse ? 2.0 : 2.35));
            s.phase += safeDt * phaseRate;

            if (s.heartTimer > 0) s.heartTimer = Math.max(0, s.heartTimer - safeDt);
            if (s.pokeTimer > 0) s.pokeTimer = Math.max(0, s.pokeTimer - safeDt);
            if (s.puffHoldTimer > 0) s.puffHoldTimer = Math.max(0, s.puffHoldTimer - safeDt);
            if (s.turnLock > 0) s.turnLock = Math.max(0, s.turnLock - safeDt);
            if (s.turnExitBoost > 0) s.turnExitBoost = Math.max(0, s.turnExitBoost - safeDt);
            if (s.eatHappyTimer > 0) s.eatHappyTimer = Math.max(0, s.eatHappyTimer - safeDt);
            if (s.wakeCooldown > 0) s.wakeCooldown = Math.max(0, s.wakeCooldown - safeDt);

            if (s.gaitKick > 0) {
                s.gaitKick = Math.max(0, s.gaitKick - safeDt * 1.85);
            } else if (profile.gait === 'burst_glide') {
                s.gaitTimer = (s.gaitTimer || 0) - safeDt;
                if (s.gaitTimer <= 0) {
                    s.gaitKick = 1.0;
                    s.gaitTimer = 1.15 + Math.random() * 1.45;
                }
            }

            // 寻找最近的鱼食颗粒（附带竞争分流，多颗鱼食时分散觅食）
            let nearestPellet = null;
            let minScore = 360;
            if (pelletClaims) {
                for (const pel of aqVisual.pellets) {
                    if (pel.eaten) continue;
                    const dx = pel.x - s.x;
                    const dy = pel.y - s.y;
                    const dist = Math.hypot(dx, dy);
                    const claims = pelletClaims.get(pel) || 0;
                    const score = dist + claims * 65;
                    if (dist < 320 && score < minScore) {
                        minScore = score;
                        nearestPellet = pel;
                    }
                }
                if (nearestPellet) {
                    pelletClaims.set(nearestPellet, (pelletClaims.get(nearestPellet) || 0) + 1);
                }
            }

            // 指针轻晃好奇 / 快速挥动惊吓检测
            let pointerCurious = false;
            let pointerDist = Infinity;
            let pdx = 0;
            let pdy = 0;
            if (!nearestPellet && aqVisual.pointer && aqVisual.pointer.active) {
                pdx = aqVisual.pointer.x - s.x;
                pdy = aqVisual.pointer.y - s.y;
                pointerDist = Math.hypot(pdx, pdy);
                if (pointerDist < 120 && aqVisual.pointer.speed > 420 && profile.shyness > 0.45 && s.pokeTimer <= 0) {
                    let dodgeDir = Math.abs(pdx) > 4 ? (s.x >= aqVisual.pointer.x ? 1 : -1) : -(s.dir || 1);
                    if (s.x < cw * 0.22) dodgeDir = 1;
                    else if (s.x > cw * 0.78) dodgeDir = -1;
                    flipSwimmerDir(s, dodgeDir, minY, maxY, 0.88, true);
                    s.pokeTimer = 0.74;
                    s.aiState = 'startled';
                    s.vx = dodgeDir * Math.max(Math.abs(s.vx), s.baseSpeed * 2.15);
                    s.vy = clampNum(-pdy * 0.45, -38, 38);
                    s.bodyBendVel = clampNum((s.bodyBendVel || 0) + dodgeDir * 2.0, -2.2, 2.2);
                } else if (pointerDist < 165) {
                    pointerCurious = true;
                }
            }

            const baseCruise = s.baseSpeed * profile.speedMult;
            const turnSpeedScale = 0.28 + 0.72 * Math.abs(curVisDir);
            let targetFinEffort = 1.0;
            let targetTailEffort = 1.0;
            let useTargetVelocity = true;
            let desiredVx = 0;
            let desiredVy = 0;
            let steerRateX = 3.2;
            let steerRateY = 3.8;
            let feedingNearWall = false;

            if (s.pokeTimer > 0.58) {
                // C-start 惊跃冲刺：中性浮力水阻衰减，绝不生硬下坠
                s.aiState = 'startled';
                useTargetVelocity = false;
                const drag = Math.exp(-safeDt * 1.45);
                s.vx = s.vx * drag + sepSteerX * safeDt * 1.4;
                s.vy = s.vy * Math.exp(-safeDt * 2.6) + sepSteerY * safeDt * 1.2;
                if (s.x < margins.softMarginX && s.vx < 0) {
                    s.vx *= Math.exp(-safeDt * 5.0);
                } else if (s.x > cw - margins.softMarginX && s.vx > 0) {
                    s.vx *= Math.exp(-safeDt * 5.0);
                }
                if ((s.y < minY + margins.softMarginY && s.vy < 0) || (s.y > maxY - margins.softMarginY && s.vy > 0)) {
                    s.vy *= Math.exp(-safeDt * 5.0);
                }
                targetFinEffort = 1.5;
                targetTailEffort = 1.65;
                if (s.wakeCooldown <= 0) {
                    s.wakeCooldown = 0.14;
                    spawnAquariumWakeBubble(
                        s.x - (s.visualDir || s.dir) * s.size * 0.72,
                        s.y + (Math.random() - 0.5) * s.size * 0.25,
                        -s.vx * 0.18,
                        -20 - Math.random() * 14,
                        1.2 + Math.random() * 1.0,
                        !!(s.entry && s.entry.isShiny)
                    );
                }
            } else if (nearestPellet) {
                // 发现鱼食颗粒：微抬前视提前量追击
                s.aiState = 'feed';
                feedingNearWall = true;
                const aimMinX = margins.hardMarginX + 4;
                const aimMaxX = Math.max(aimMinX, cw - margins.hardMarginX - 4);
                const aimX = clampNum(nearestPellet.x, aimMinX, aimMaxX);
                const aimY = clampNum(nearestPellet.y + (nearestPellet.vy || 0) * 0.16, minY, maxY);
                const dx = aimX - s.x;
                const dy = aimY - s.y;
                const dist = Math.max(1, Math.hypot(dx, dy));
                const chaseSpeed = baseCruise * (isSeahorse ? 1.55 : (profile.gait === 'burst_glide' ? 2.15 : 1.92));
                const approachScale = clampNum(dist / (s.size * 1.4), 0.45, 1.0);
                if (Math.abs(dx) > Math.max(18, s.size * 0.72) && s.turnLock <= 0) {
                    flipSwimmerDir(s, dx >= 0 ? 1 : -1, minY, maxY, 0.88, false);
                }
                desiredVx = (dx / dist) * chaseSpeed * approachScale * turnSpeedScale;
                desiredVy = (dy / dist) * chaseSpeed * approachScale;
                steerRateX = 6.2;
                steerRateY = 6.2;
                s.vz += ((0.15 - s.z) * 1.6 - s.vz) * Math.min(1, safeDt * 3.0);
                targetFinEffort = 1.35;
                targetTailEffort = 1.45;

                // 吃到鱼食颗粒：咬食果冻弹性动画 + 冒泡 + 爱心 ❤️
                if (Math.hypot(nearestPellet.x - s.x, nearestPellet.y - s.y) < s.size * 0.85 + 8) {
                    nearestPellet.eaten = true;
                    s.heartTimer = 1.8;
                    s.eatHappyTimer = 0.65;
                    s.squashX = 1.15;
                    s.squashY = 0.86;
                    s.bodyBendVel = clampNum((s.bodyBendVel || 0) + (s.dir || 1) * 1.15, -2.2, 2.2);
                    if (isPuffer) {
                        s.puffHoldTimer = Math.max(s.puffHoldTimer || 0, 1.45);
                    }
                    aqVisual.hearts.push({
                        x: s.x + s.dir * (s.size * 0.4),
                        y: s.y - s.size * 0.5,
                        vy: -26,
                        alpha: 1.0,
                        text: nearestPellet.premium ? '❤️+8%' : '❤️'
                    });
                    for (let b = 0; b < 2; b++) {
                        spawnAquariumWakeBubble(
                            s.x + (s.visualDir || s.dir) * s.size * 0.7,
                            s.y - s.size * 0.1,
                            (Math.random() - 0.5) * 14,
                            -22 - Math.random() * 14,
                            1.2 + Math.random() * 0.9,
                            !!(s.entry && s.entry.isShiny)
                        );
                    }
                    if (WWF.Sound && WWF.Sound.playNibble) WWF.Sound.playNibble();
                }
            } else if (pointerCurious) {
                // 指针轻晃好奇：目标点限制在舒适安全区内，杜绝贴边反复折返
                s.aiState = 'curious';
                const minTargetX = margins.softMarginX + 12;
                const maxTargetX = Math.max(minTargetX, cw - minTargetX);
                const targetX = clampNum(aqVisual.pointer.x, minTargetX, maxTargetX);
                const targetY = clampNum(aqVisual.pointer.y, margins.waypointMinY, margins.waypointMaxY);
                const tdx = targetX - s.x;
                const tdy = targetY - s.y;
                const tDist = Math.hypot(tdx, tdy);
                if (Math.abs(tdx) > Math.max(40, s.size * 1.55) && s.turnLock <= 0) {
                    flipSwimmerDir(s, tdx >= 0 ? 1 : -1, minY, maxY, 0.92, false);
                }
                const orbitDist = s.size * 2.1 + 18;
                s.goalZ = 0.55;
                if (tDist > orbitDist) {
                    const safeTDist = Math.max(1, tDist);
                    const curiousSpeed = baseCruise * (isSeahorse ? 1.05 : 1.32);
                    desiredVx = (tdx / safeTDist) * curiousSpeed * turnSpeedScale;
                    desiredVy = (tdy / safeTDist) * curiousSpeed * 0.72;
                    steerRateX = 4.4;
                    steerRateY = 4.4;
                    targetFinEffort = 1.25;
                    targetTailEffort = 1.15;
                } else {
                    desiredVx = Math.abs(tdx) > 12
                        ? clampNum(tdx * 0.42, -baseCruise * 0.24, baseCruise * 0.24) * turnSpeedScale
                        : 0;
                    desiredVy = clampNum(tdy * 0.45, -14, 14) + Math.sin(s.phase * 1.25) * 6;
                    steerRateX = 3.8;
                    steerRateY = 4.0;
                    targetFinEffort = 1.48;
                    targetTailEffort = 0.76;
                }
                s.vz += ((s.goalZ - s.z) * 1.8 - s.vz) * Math.min(1, safeDt * 3.2);
            } else {
                // 自由生态状态机：cruise (巡游向目标航点) <-> hover (轻扇胸鳍悬浮打望)
                const nearLeftSoft = s.x < margins.softMarginX;
                const nearRightSoft = s.x > cw - margins.softMarginX;
                const nearTopSoft = s.y < minY + margins.softMarginY;
                const nearBotSoft = s.y > maxY - margins.softMarginY;
                const nearAnySoft = nearLeftSoft || nearRightSoft || nearTopSoft || nearBotSoft;

                s.stateTimer = (s.stateTimer || 0) - safeDt;
                const distToGoal = Math.hypot((s.goalX || s.x) - s.x, (s.goalY || s.y) - s.y);

                if (s.aiState === 'startled' || s.aiState === 'feed' || s.aiState === 'curious') {
                    s.aiState = 'cruise';
                    const wp = pickAquariumWaypoint(s, profile, cw, minY, maxY, nearLeftSoft || nearRightSoft, margins);
                    s.goalX = wp.goalX;
                    s.goalY = wp.goalY;
                    s.goalZ = wp.goalZ;
                    s.stateTimer = 2.4 + Math.random() * 2.6;
                } else if (s.aiState === 'hover') {
                    if (s.stateTimer <= 0 || nearAnySoft) {
                        s.aiState = 'cruise';
                        const wp = pickAquariumWaypoint(s, profile, cw, minY, maxY, nearLeftSoft || nearRightSoft, margins);
                        s.goalX = wp.goalX;
                        s.goalY = wp.goalY;
                        s.goalZ = wp.goalZ;
                        s.stateTimer = 2.6 + Math.random() * 2.4;
                    }
                } else if (distToGoal < Math.max(24, s.size * 1.1) || s.stateTimer <= 0) {
                    if (!nearAnySoft && Math.random() < profile.hoverChance) {
                        s.aiState = 'hover';
                        s.stateTimer = isSeahorse ? (1.8 + Math.random() * 2.2) : (0.9 + Math.random() * 1.4);
                    } else {
                        const wp = pickAquariumWaypoint(s, profile, cw, minY, maxY, nearLeftSoft || nearRightSoft, margins);
                        s.goalX = wp.goalX;
                        s.goalY = wp.goalY;
                        s.goalZ = wp.goalZ;
                        s.stateTimer = 2.6 + Math.random() * 3.0;
                    }
                }

                if (s.aiState === 'hover') {
                    desiredVx = s.dir * baseCruise * 0.14 * turnSpeedScale;
                    desiredVy = Math.sin(s.phase * 1.2) * (isSeahorse ? 7.0 : 5.0);
                    steerRateX = 3.2;
                    steerRateY = 3.5;
                    s.vz += ((s.goalZ - s.z) * 1.1 - s.vz) * Math.min(1, safeDt * 2.2);
                    targetFinEffort = 1.45;
                    targetTailEffort = 0.68;
                } else {
                    if (nearLeftSoft && s.dir < 0) {
                        const forceTurn = s.x < margins.hardMarginX + 8;
                        if (flipSwimmerDir(s, 1, minY, maxY, 0.95, forceTurn) || forceTurn) {
                            const wp = pickAquariumWaypoint(s, profile, cw, minY, maxY, true, margins);
                            s.goalX = wp.goalX;
                            s.goalY = wp.goalY;
                            s.goalZ = wp.goalZ;
                            s.stateTimer = Math.max(s.stateTimer || 0, 2.4);
                        }
                    } else if (nearRightSoft && s.dir > 0) {
                        const forceTurn = s.x > cw - margins.hardMarginX - 8;
                        if (flipSwimmerDir(s, -1, minY, maxY, 0.95, forceTurn) || forceTurn) {
                            const wp = pickAquariumWaypoint(s, profile, cw, minY, maxY, true, margins);
                            s.goalX = wp.goalX;
                            s.goalY = wp.goalY;
                            s.goalZ = wp.goalZ;
                            s.stateTimer = Math.max(s.stateTimer || 0, 2.4);
                        }
                    } else if (Math.abs((s.goalX || s.x) - s.x) > Math.max(28, s.size * 1.15) && s.turnLock <= 0) {
                        flipSwimmerDir(s, (s.goalX || s.x) >= s.x ? 1 : -1, minY, maxY, 0.90, false);
                    }

                    const dx = (s.goalX || s.x) - s.x;
                    const dy = (s.goalY || s.y) - s.y;
                    const dist = Math.max(1, Math.hypot(dx, dy));

                    // 依据物种步态调节巡游推进力
                    let gaitMult = 1.0;
                    let bobAmp = 6.5;
                    if (profile.gait === 'burst_glide') {
                        gaitMult = s.gaitKick > 0 ? (0.85 + s.gaitKick * 0.85) : 0.62;
                        targetTailEffort = s.gaitKick > 0 ? 1.48 : 0.74;
                        bobAmp = 5.5;
                    } else if (profile.gait === 'serpentine') {
                        gaitMult = 0.94 + Math.sin(s.phase * 1.5) * 0.14;
                        bobAmp = 9.0;
                    } else if (profile.gait === 'majestic_cruise') {
                        gaitMult = 0.86 + Math.sin(s.phase * 0.7) * 0.10;
                        bobAmp = 5.0;
                    } else if (profile.gait === 'hover_bob') {
                        gaitMult = 0.76 + Math.sin(s.phase * 0.9) * 0.12;
                        bobAmp = 8.5;
                        targetFinEffort = 1.38;
                    } else if (profile.gait === 'puff_scoot') {
                        const puffDrag = 1 - clampNum(s.puffFactor || 0, 0, 1) * 0.35;
                        gaitMult = (0.82 + 0.22 * Math.max(0, Math.sin(s.phase * 1.3))) * puffDrag;
                        bobAmp = 7.0;
                        targetFinEffort = 1.42;
                    }

                    const cruiseSpd = baseCruise * gaitMult * (1 + s.turnExitBoost * 0.75);
                    desiredVx = (dx / dist) * cruiseSpd * turnSpeedScale;
                    desiredVy = (dy / dist) * cruiseSpd * 0.72 + Math.sin(s.phase * 1.05) * bobAmp;

                    // 融合温和群游伴随向量
                    if (schoolWeight[idx] > 0) {
                        const avgVx = schoolVx[idx] / schoolWeight[idx];
                        const avgVy = schoolVy[idx] / schoolWeight[idx];
                        const alignMix = clampNum(profile.schooling * 0.34, 0, 0.32);
                        desiredVx = desiredVx * (1 - alignMix) + avgVx * alignMix * turnSpeedScale;
                        desiredVy = desiredVy * (1 - alignMix * 0.7) + avgVy * alignMix * 0.7;
                    }

                    steerRateX = profile.gait === 'burst_glide' ? 4.4 : 3.1;
                    steerRateY = 3.8;
                    s.vz += ((s.goalZ - s.z) * 1.4 - s.vz) * Math.min(1, safeDt * 2.5);
                }
            }

            // 统一融合作用于目标速度：邻居分离 + 玻璃缸壁柔软减速与回中引导
            if (useTargetVelocity) {
                desiredVx += sepSteerX;
                desiredVy += sepSteerY;

                const pelletOnLeftWall = feedingNearWall && nearestPellet && nearestPellet.x < s.x;
                const pelletOnRightWall = feedingNearWall && nearestPellet && nearestPellet.x > s.x;

                if (s.x < margins.softMarginX) {
                    const tEdge = clampNum((margins.softMarginX - s.x) / Math.max(10, margins.softMarginX - margins.hardMarginX), 0, 1);
                    if (pelletOnLeftWall) {
                        const hardRatio = clampNum((s.x - margins.hardMarginX) / 14, 0, 1);
                        if (desiredVx < 0) desiredVx *= hardRatio;
                    } else {
                        if (desiredVx < 0) desiredVx *= (1 - tEdge);
                        if (curVisDir > -0.15) {
                            desiredVx = Math.max(desiredVx, 12 + tEdge * 22);
                        }
                    }
                } else if (s.x > cw - margins.softMarginX) {
                    const tEdge = clampNum((s.x - (cw - margins.softMarginX)) / Math.max(10, margins.softMarginX - margins.hardMarginX), 0, 1);
                    if (pelletOnRightWall) {
                        const hardRatio = clampNum(((cw - margins.hardMarginX) - s.x) / 14, 0, 1);
                        if (desiredVx > 0) desiredVx *= hardRatio;
                    } else {
                        if (desiredVx > 0) desiredVx *= (1 - tEdge);
                        if (curVisDir < 0.15) {
                            desiredVx = Math.min(desiredVx, -(12 + tEdge * 22));
                        }
                    }
                }

                if (s.y < minY + margins.softMarginY) {
                    const tTop = clampNum((minY + margins.softMarginY - s.y) / Math.max(6, margins.softMarginY), 0, 1);
                    if (desiredVy < 0) desiredVy *= (1 - tTop);
                    desiredVy = Math.max(desiredVy, 8 + tTop * 18);
                } else if (s.y > maxY - margins.softMarginY) {
                    const tBot = clampNum((s.y - (maxY - margins.softMarginY)) / Math.max(6, margins.softMarginY), 0, 1);
                    if (desiredVy > 0) desiredVy *= (1 - tBot);
                    desiredVy = Math.min(desiredVy, -(8 + tBot * 18));
                }

                s.vx += (desiredVx - s.vx) * (1 - Math.exp(-safeDt * steerRateX));
                s.vy += (desiredVy - s.vy) * (1 - Math.exp(-safeDt * steerRateY));
            }
            s.vz += sepSteerZ * safeDt * 1.8;

            // 防倒退滑步（Anti-moonwalk）：仅抑制非预期明显倒退漂移，避免与转向缓冲对抗
            if (s.vx * curVisDir < -6 && Math.abs(curVisDir) > 0.26 && s.pokeTimer <= 0) {
                s.vx *= Math.exp(-safeDt * 4.2);
            }

            // 连续 2.5D 偏航角 yaw（限制单帧最大角速度，杜绝中段瞬切）
            const targetYaw = s.dir >= 0 ? 0 : Math.PI;
            const curYaw = typeof s.yaw === 'number' ? s.yaw : targetYaw;
            const prevVisualDir = curVisDir;
            const turnDiff = targetYaw - curYaw;
            const baseTurnRate = 3.2 + turnAgility * 1.45;
            const rawYawStep = turnDiff * (1 - Math.exp(-safeDt * baseTurnRate));
            const maxYawStep = (3.4 + turnAgility * 1.15) * safeDt;
            s.yaw = clampNum(curYaw + clampNum(rawYawStep, -maxYawStep, maxYawStep), 0, Math.PI);
            s.visualDir = Math.cos(s.yaw);
            const turnMid = Math.sin(s.yaw);

            if (Math.abs(prevVisualDir) < 0.68 && Math.abs(s.visualDir) >= 0.68 && s.visualDir * s.dir > 0) {
                s.turnExitBoost = 0.28;
                spawnAquariumWakeBubble(
                    s.x - s.visualDir * (s.size * 0.65),
                    s.y + (Math.random() - 0.5) * s.size * 0.2,
                    -s.visualDir * 8,
                    -18 - Math.random() * 12,
                    1.1 + Math.random() * 0.9,
                    !!(s.entry && s.entry.isShiny)
                );
            }

            // 转向中段融入柔和上下/纵深立体弧线
            if (turnMid > 0.08) {
                s.vy += ((s.turnArcY || 0) * turnMid - s.vy * 0.12) * Math.min(1, safeDt * 2.0);
                s.vz += (s.turnArcZ || 0) * turnMid * safeDt * 3.2;
            }

            // 更新空间位置
            s.x += s.vx * safeDt;
            s.y += s.vy * safeDt;
            s.z = clampNum((s.z || 0) + s.vz * safeDt, -0.85, 0.85);
            s.vz *= Math.exp(-safeDt * 2.4);

            // 极端缩放安全夹紧兜底
            if (s.x < margins.hardMarginX) {
                s.x = margins.hardMarginX;
                s.vx = Math.max(0, s.vx);
                if (!feedingNearWall) {
                    flipSwimmerDir(s, 1, minY, maxY, 0.95, true);
                    const wp = pickAquariumWaypoint(s, profile, cw, minY, maxY, true, margins);
                    s.goalX = wp.goalX;
                    s.goalY = wp.goalY;
                    s.goalZ = wp.goalZ;
                }
            } else if (s.x > cw - margins.hardMarginX) {
                s.x = Math.max(margins.hardMarginX, cw - margins.hardMarginX);
                s.vx = Math.min(0, s.vx);
                if (!feedingNearWall) {
                    flipSwimmerDir(s, -1, minY, maxY, 0.95, true);
                    const wp = pickAquariumWaypoint(s, profile, cw, minY, maxY, true, margins);
                    s.goalX = wp.goalX;
                    s.goalY = wp.goalY;
                    s.goalZ = wp.goalZ;
                }
            }
            if (s.y < minY) {
                s.y = minY;
                s.vy = Math.max(0, s.vy);
            } else if (s.y > maxY) {
                s.y = maxY;
                s.vy = Math.min(0, s.vy);
            }

            // 河豚鼓胀与回落平滑更新
            const targetPuff = (isPuffer && s.puffHoldTimer > 0) ? 1.0 : 0;
            const puffLerpSpeed = targetPuff > (s.puffFactor || 0) ? 6.8 : 1.45;
            s.puffFactor = clampNum(
                (s.puffFactor || 0) + (targetPuff - (s.puffFactor || 0)) * Math.min(1, safeDt * puffLerpSpeed),
                0,
                1.15
            );

            // 速度倍率与尾鳍/胸鳍推进力单调积分（杜绝相位跳变）
            const curSpeed = Math.hypot(s.vx, s.vy);
            let targetSpeedRatio = clampNum(curSpeed / Math.max(16, s.baseSpeed), 0.32, 2.8);
            if (s.pokeTimer > 0) {
                targetSpeedRatio = Math.max(targetSpeedRatio, 1.85 + s.pokeTimer * 0.75);
            } else if (s.eatHappyTimer > 0) {
                targetSpeedRatio = Math.max(targetSpeedRatio, 1.55);
            } else if (pointerCurious) {
                targetSpeedRatio = Math.max(targetSpeedRatio, 1.15);
            }
            targetSpeedRatio = clampNum(targetSpeedRatio * (1 + s.turnExitBoost * 0.65), 0.30, 3.0);
            s.speedRatio = (s.speedRatio || 1) + (targetSpeedRatio - (s.speedRatio || 1)) * Math.min(1, safeDt * 7.2);
            s.finEffort = (s.finEffort || 1) + (targetFinEffort - (s.finEffort || 1)) * Math.min(1, safeDt * 6.0);

            const tailBaseFreq = clampNum(motion.tailFreq || 8.5, 4.0, 16.0);
            const tailRate = tailBaseFreq * (0.52 + s.speedRatio * 0.56) * (0.72 + 0.28 * targetTailEffort);
            s.wagPhase = (s.wagPhase || 0) + safeDt * tailRate;

            const pecBaseFreq = clampNum(motion.pectoralFreq || 5.5, 3.0, 18.0);
            const finRate = pecBaseFreq * (0.68 + s.speedRatio * 0.26) * clampNum(s.finEffort, 0.6, 1.8);
            s.finPhase = (s.finPhase || 0) + safeDt * finRate;

            // 低通滤波垂向加速度 + 临界阻尼二阶弹簧更新身体弯曲角 bodyBend
            const flexScale = clampNum(bodyFlex / 0.20, 0.55, 2.0);
            const rawAy = clampNum((s.vy - (s.prevVy || 0)) / Math.max(0.012, safeDt), -140, 140);
            s.prevVy = s.vy;
            s.smoothAy = (s.smoothAy || 0) + (rawAy - (s.smoothAy || 0)) * (1 - Math.exp(-safeDt * 6.5));
            const diveBend = clampNum(s.smoothAy * 0.0011 * flexScale * s.visualDir, -0.18, 0.18);
            const turnArcSign = (s.turnArcY || 0) >= 0 ? 1 : -1;
            const turnBend = clampNum((s.dir - s.visualDir) * 0.13 * flexScale * turnArcSign, -0.30, 0.30);
            const chaseBend = nearestPellet
                ? clampNum(((nearestPellet.y - s.y) / 160) * 0.18 * flexScale * s.visualDir, -0.24, 0.24)
                : 0;
            const gaitWaveAmp = profile.gait === 'serpentine'
                ? 0.24
                : (profile.gait === 'majestic_cruise' ? 0.13 : (isSeahorse ? 0.09 : 0.05));
            const waveBend = Math.sin(s.wagPhase * 0.5) * gaitWaveAmp;
            const targetBend = clampNum(turnBend + diveBend + chaseBend + waveBend, -0.78, 0.78);
            const bendRes = stepAquariumSpring(s.bodyBend || 0, s.bodyBendVel || 0, targetBend, 54, 13.8, safeDt);
            s.bodyBend = clampNum(bendRes.val, -0.82, 0.82);
            s.bodyBendVel = bendRes.vel;

            // 随垂直速度平滑倾仰 pitch（转弯正对镜头时柔和回正，直立海马保持微倾）
            let targetPitch = 0;
            if (isSeahorse) {
                targetPitch = clampNum(s.vx * 0.0020 + Math.sin(s.wagPhase * 0.35) * 0.04, -0.20, 0.20);
            } else {
                const speedMag = Math.max(46, curSpeed);
                const turnPitchFade = clampNum(Math.abs(s.visualDir) * 1.4, 0, 1);
                targetPitch = clampNum((s.vy / speedMag) * 0.45 * s.visualDir * turnPitchFade, -0.46, 0.46);
            }
            s.pitch = (s.pitch || 0) + (targetPitch - (s.pitch || 0)) * (1 - Math.exp(-safeDt * 5.8));

            // 弹性挤压拉伸弹簧（转身体积守恒 + 吃食/轻戳果冻回弹）
            const targetSquashX = 1 - 0.045 * turnMid;
            const targetSquashY = 1 + 0.055 * turnMid;
            const sqXRes = stepAquariumSpring(s.squashX || 1, s.squashVelX || 0, targetSquashX, 140, 18.5, safeDt);
            const sqYRes = stepAquariumSpring(s.squashY || 1, s.squashVelY || 0, targetSquashY, 140, 18.5, safeDt);
            s.squashX = clampNum(sqXRes.val, 0.76, 1.28);
            s.squashVelX = sqXRes.vel;
            s.squashY = clampNum(sqYRes.val, 0.76, 1.28);
            s.squashVelY = sqYRes.vel;
        }

        // 5. 更新漂浮爱心粒子与轻戳水泡
        for (let i = aqVisual.hearts.length - 1; i >= 0; i--) {
            const h = aqVisual.hearts[i];
            h.y += h.vy * safeDt;
            h.alpha -= safeDt * 0.65;
            if (h.alpha <= 0) {
                aqVisual.hearts.splice(i, 1);
            }
        }
        for (let i = aqVisual.pokeBubbles.length - 1; i >= 0; i--) {
            const pb = aqVisual.pokeBubbles[i];
            pb.x += pb.vx * safeDt;
            pb.y += pb.vy * safeDt;
            pb.vy -= 18 * safeDt;
            pb.alpha -= safeDt * 1.15;
            if (pb.alpha <= 0) {
                aqVisual.pokeBubbles.splice(i, 1);
            }
        }

        WWF.renderAquariumCanvas();
    };

    WWF.renderAquariumCanvas = function () {
        const canvas = document.getElementById('aquariumCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const cw = aqVisual.cw;
        const ch = aqVisual.ch;
        const t = aqVisual.time;

        ctx.save();
        ctx.setTransform(aqVisual.dpr, 0, 0, aqVisual.dpr, 0, 0);
        ctx.clearRect(0, 0, cw, ch);

        // 1. 深海玻璃水箱渐变背景
        const bgGrad = ctx.createLinearGradient(0, 0, 0, ch);
        bgGrad.addColorStop(0, '#072a40');
        bgGrad.addColorStop(0.45, '#061c2e');
        bgGrad.addColorStop(1, '#030d18');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, cw, ch);

        // 2. 顶部折射阳光光柱
        ctx.save();
        for (let i = 0; i < 5; i++) {
            const rayX = cw * (0.12 + i * 0.2) + Math.sin(t * 0.7 + i) * 18;
            const rayGrad = ctx.createLinearGradient(rayX, 0, rayX + 55, ch * 0.88);
            rayGrad.addColorStop(0, 'rgba(125, 211, 252, 0.16)');
            rayGrad.addColorStop(1, 'rgba(125, 211, 252, 0.0)');
            ctx.fillStyle = rayGrad;
            ctx.beginPath();
            ctx.moveTo(rayX - 22, 0);
            ctx.lineTo(rayX + 26, 0);
            ctx.lineTo(rayX + 95, ch * 0.9);
            ctx.lineTo(rayX + 10, ch * 0.9);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();

        // 3. 水箱底部細沙与珊瑚礁
        const floorY = ch - 22;
        const sandGrad = ctx.createLinearGradient(0, floorY - 8, 0, ch);
        sandGrad.addColorStop(0, '#1e3a5f');
        sandGrad.addColorStop(1, '#0f172a');
        ctx.fillStyle = sandGrad;
        ctx.beginPath();
        ctx.moveTo(0, floorY);
        for (let x = 0; x <= cw; x += 40) {
            ctx.lineTo(x, floorY + Math.sin(x * 0.03) * 4);
        }
        ctx.lineTo(cw, ch);
        ctx.lineTo(0, ch);
        ctx.closePath();
        ctx.fill();

        // 珊瑚礁
        for (const c of aqVisual.corals) {
            const cx = c.xRatio * cw;
            const cy = floorY + 2;
            ctx.save();
            ctx.strokeStyle = c.color;
            ctx.lineCap = 'round';
            ctx.lineWidth = 5;
            for (let b = 0; b < c.branches; b++) {
                const angle = -Math.PI * 0.78 + (b / (c.branches - 1 || 1)) * Math.PI * 0.56;
                const sway = Math.sin(t * 1.6 + b) * 2;
                const tx = cx + Math.cos(angle) * c.size + sway;
                const ty = cy + Math.sin(angle) * c.size;
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.quadraticCurveTo(cx + (tx - cx) * 0.5, cy - c.size * 0.3, tx, ty);
                ctx.stroke();
            }
            ctx.restore();
        }

        // 4. 摇曳水草分层绘制助手（支持尾流摆动与 2.5D 前后遮挡交错）
        const drawSeaweedLayer = (targetLayer) => {
            for (const sw of aqVisual.seaweeds) {
                if ((sw.layer || 0) !== targetLayer) continue;
                const baseX = sw.xRatio * cw;
                let px = baseX;
                let py = floorY + 4;
                ctx.save();
                ctx.strokeStyle = sw.color;
                ctx.lineWidth = targetLayer === 1 ? 4.0 : 3.4;
                ctx.globalAlpha = targetLayer === 1 ? 0.90 : 0.78;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(px, py);
                for (let seg = 1; seg <= sw.segments; seg++) {
                    const frac = seg / sw.segments;
                    const sway = Math.sin(t * 2.1 + sw.phase + seg * 0.45) * (seg * 2.1) + (sw.bend || 0) * frac;
                    px = baseX + sway;
                    py -= sw.segLen;
                    ctx.lineTo(px, py);
                }
                ctx.stroke();
                ctx.restore();
            }
        };

        // 4a. 背景水草层 (layer 0)
        drawSeaweedLayer(0);

        // 5. 上升气泡与入水涟漪
        ctx.save();
        for (const b of aqVisual.bubbles) {
            ctx.strokeStyle = 'rgba(186, 230, 253, 0.45)';
            ctx.fillStyle = 'rgba(224, 242, 254, 0.15)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        for (const rp of aqVisual.ripples) {
            ctx.globalAlpha = Math.max(0, rp.alpha);
            ctx.strokeStyle = rp.color || 'rgba(125, 211, 252, 0.45)';
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.ellipse(rp.x, rp.y, rp.r, rp.r * 0.42, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();

        // 6. 飘落与沙底停留的鱼食颗粒（使用轻量光晕圆替代 shadowBlur）
        ctx.save();
        for (const pel of aqVisual.pellets) {
            if (pel.eaten) continue;
            if (pel.premium) {
                ctx.fillStyle = 'rgba(253, 224, 71, 0.28)';
                ctx.beginPath();
                ctx.arc(pel.x, pel.y, 6.2, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.fillStyle = pel.premium ? '#fde047' : '#f59e0b';
            ctx.beginPath();
            ctx.arc(pel.x, pel.y, pel.premium ? 3.5 : 2.6, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();

        // 7. 2.5D 景深排序游动观赏鱼与沙底软投影 (前景水草夹层穿插)
        if (aqVisual.swimmers.length === 0) {
            drawSeaweedLayer(1);
            ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
            ctx.font = '500 13px "Noto Sans SC", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('水族箱暂无观赏鱼 · 钓鱼结算时或从右侧【随身鱼篓】移入即可展示并产出门票！', cw * 0.5, ch * 0.5);
        } else {
            const sortedSwimmers = aqVisual.swimmers.slice().sort((a, b) => (a.z || 0) - (b.z || 0));

            // 7a. 沙底柔和椭圆投影
            for (const s of sortedSwimmers) {
                const zVal = typeof s.z === 'number' ? s.z : 0;
                const drawSize = s.size * (0.86 + (zVal + 1) * 0.11);
                const altRatio = clampNum((floorY - s.y) / Math.max(40, floorY), 0, 1);
                const shadowAlpha = clampNum(0.26 * (1 - altRatio * 0.72) * (0.75 + (zVal + 1) * 0.14), 0.04, 0.28);
                const shadowRx = drawSize * (0.82 + altRatio * 0.35) * (0.38 + 0.62 * Math.abs(typeof s.visualDir === 'number' ? s.visualDir : 1));
                const shadowRy = Math.max(2.2, drawSize * 0.14);
                ctx.save();
                ctx.fillStyle = `rgba(2, 6, 23, ${shadowAlpha.toFixed(3)})`;
                ctx.beginPath();
                ctx.ellipse(s.x, floorY + 2 + zVal * 2.5, shadowRx, shadowRy, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }

            let fgSeaweedDrawn = false;
            const drawSwimmerItem = (s) => {
                const zVal = typeof s.z === 'number' ? s.z : 0;
                const drawSize = s.size * (0.86 + (zVal + 1) * 0.11);
                if (typeof WWF.drawCanvasFish === 'function') {
                    const drawDir = typeof s.visualDir === 'number' ? s.visualDir : s.dir;
                    WWF.drawCanvasFish(ctx, s.fish, s.x, s.y, drawSize, drawDir, t, !!s.entry.isShiny, {
                        speedRatio: typeof s.speedRatio === 'number' ? s.speedRatio : 1,
                        bodyBend: typeof s.bodyBend === 'number' ? s.bodyBend : 0,
                        puffFactor: typeof s.puffFactor === 'number' ? s.puffFactor : 0,
                        pitch: typeof s.pitch === 'number' ? s.pitch : 0,
                        phaseOffset: s.phase,
                        wagPhase: typeof s.wagPhase === 'number' ? s.wagPhase : undefined,
                        finPhase: typeof s.finPhase === 'number' ? s.finPhase : undefined,
                        squashX: typeof s.squashX === 'number' ? s.squashX : 1,
                        squashY: typeof s.squashY === 'number' ? s.squashY : 1
                    });
                }
                // 鱼名字与闪光小标签（随景深柔化透明度）
                const labelAlpha = clampNum(0.60 + (zVal + 1) * 0.18, 0.45, 0.94);
                const labelY = Math.min(ch - 5, s.y + drawSize * 0.78 + 11);
                ctx.save();
                ctx.globalAlpha = labelAlpha;
                ctx.font = '600 10px "Noto Sans SC", sans-serif';
                ctx.textAlign = 'center';
                ctx.fillStyle = s.entry.isShiny ? '#fef08a' : '#e2e8f0';
                ctx.fillText(`${s.entry.isShiny ? '✨' : ''}${s.entry.name}`, s.x, labelY);
                ctx.restore();
            };

            for (const s of sortedSwimmers) {
                if (!fgSeaweedDrawn && (s.z || 0) >= 0.25) {
                    drawSeaweedLayer(1);
                    fgSeaweedDrawn = true;
                }
                drawSwimmerItem(s);
            }
            if (!fgSeaweedDrawn) {
                drawSeaweedLayer(1);
            }
        }

        // 8. 尾部推进微气泡、轻戳水泡与觅食爱心粒子 ❤️
        ctx.save();
        for (const wb of aqVisual.wakeBubbles) {
            ctx.globalAlpha = Math.max(0, wb.alpha);
            ctx.fillStyle = wb.isShiny ? 'rgba(254, 240, 138, 0.32)' : 'rgba(186, 230, 253, 0.28)';
            ctx.strokeStyle = wb.isShiny ? 'rgba(244, 114, 182, 0.65)' : 'rgba(224, 242, 254, 0.65)';
            ctx.lineWidth = 0.85;
            ctx.beginPath();
            ctx.arc(wb.x, wb.y, wb.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        for (const pb of aqVisual.pokeBubbles) {
            ctx.globalAlpha = Math.max(0, pb.alpha);
            ctx.fillStyle = pb.isShiny ? 'rgba(254, 240, 138, 0.5)' : 'rgba(186, 230, 253, 0.45)';
            ctx.strokeStyle = pb.isShiny ? 'rgba(244, 114, 182, 0.85)' : 'rgba(224, 242, 254, 0.85)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(pb.x, pb.y, pb.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        ctx.restore();

        ctx.save();
        ctx.font = 'bold 13px "Noto Sans SC", sans-serif';
        ctx.textAlign = 'center';
        for (const h of aqVisual.hearts) {
            ctx.globalAlpha = Math.max(0, h.alpha);
            ctx.fillStyle = '#fda4af';
            ctx.fillText(h.text || '❤️', h.x, h.y);
        }
        ctx.restore();

        ctx.restore();
    };

    function spawnAquariumFood(canvasX, canvasY, count = 6, isPremium = false) {
        const pelletMarginX = Math.min(aqVisual.cw * 0.18, 44);
        const minPelletX = pelletMarginX;
        const maxPelletX = Math.max(minPelletX, aqVisual.cw - pelletMarginX);
        const minPelletY = 14;
        const maxPelletY = Math.max(24, aqVisual.ch - 40);
        spawnAquariumRipple(
            clampNum(canvasX, minPelletX, maxPelletX),
            clampNum(canvasY, minPelletY, maxPelletY),
            isPremium ? 26 : 18,
            isPremium ? 'rgba(253, 224, 71, 0.45)' : 'rgba(125, 211, 252, 0.42)'
        );
        for (let i = 0; i < count; i++) {
            aqVisual.pellets.push({
                x: clampNum(canvasX + (Math.random() - 0.5) * 48, minPelletX, maxPelletX),
                y: clampNum(canvasY + (Math.random() - 0.5) * 16, minPelletY, maxPelletY),
                vy: 38 + Math.random() * 14,
                targetVy: 16 + Math.random() * 10,
                phase: Math.random() * Math.PI * 2,
                premium: isPremium,
                eaten: false,
                settled: false,
                restTimer: 2.6
            });
        }
    }

    function renderAquariumModalLists() {
        const p = WWF.player;
        if (!p) return;

        const upg = getAquariumUpgradeInfo(p.aquariumLevel);
        const nextUpg = (WWF.AQUARIUM_UPGRADES || [])[p.aquariumLevel]; // 下一级 (0-based index === current level)

        const capLabel = document.getElementById('aquariumCapacityLabel');
        if (capLabel) {
            capLabel.textContent = `${upg.name} Lv.${p.aquariumLevel} · 容量: ${p.aquarium.length} / ${upg.capacity} 条`;
        }

        const rateLabel = document.getElementById('aquariumIncomeRate');
        if (rateLabel) {
            rateLabel.textContent = `门票收益: +${calculateAquariumIncomePerMinute()} 🪙/分钟 (×${upg.incomeMult})`;
        }

        const unclaimedEl = document.getElementById('aquariumUnclaimed');
        if (unclaimedEl) {
            unclaimedEl.textContent = String(Math.floor(p.aquariumUnclaimedCoins || 0));
        }

        const btnUpgrade = document.getElementById('btnUpgradeAquarium');
        if (btnUpgrade) {
            if (nextUpg) {
                btnUpgrade.disabled = false;
                btnUpgrade.textContent = `⬆️ 扩建至 Lv.${nextUpg.level} (${nextUpg.price} 🪙 · ${nextUpg.capacity}条)`;
            } else {
                btnUpgrade.disabled = true;
                btnUpgrade.textContent = `👑 已达最高等级 Lv.${p.aquariumLevel}`;
            }
        }

        const fmtNum = (n) => {
            const v = Number(n) || 0;
            if (v >= 1e8) return (v / 1e8).toFixed(1) + '亿';
            if (v >= 1e4) return (v / 1e4).toFixed(1) + '万';
            return Number.isInteger(v) ? String(v) : v.toFixed(2);
        };

        // 1. 渲染左侧水族箱鱼列表 (#aquariumFishList)
        const aqListEl = document.getElementById('aquariumFishList');
        if (aqListEl) {
            if (p.aquarium.length === 0) {
                aqListEl.innerHTML = `<div class="text-xs text-slate-500 text-center py-8 border border-dashed border-slate-800 rounded-xl">水箱空空如也，从右侧鱼篓或钓鱼结算时放入观赏鱼吧！</div>`;
            } else {
                aqListEl.innerHTML = p.aquarium.map(item => {
                    const fish = getFishById(item.fishId);
                    const rInfo = (WWF.RARITIES && WWF.RARITIES[item.rarity]) || WWF.RARITIES.common;
                    const inc = Math.round((rInfo.aquariumIncome || 6) * (item.isShiny ? 1.8 : 1) * (upg.incomeMult || 1));
                    const svgHtml = typeof WWF.createFishSVG === 'function' ? WWF.createFishSVG(fish, false, !!item.isShiny) : '';
                    return `
                        <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div class="flex items-center gap-2.5 min-w-0">
                                <div class="w-12 h-8 rounded-lg bg-slate-950 border border-slate-800 p-0.5 shrink-0 flex items-center justify-center">
                                    ${svgHtml}
                                </div>
                                <div class="min-w-0 flex-1">
                                    <div class="text-xs font-bold text-white flex flex-wrap items-center gap-1">
                                        <span class="truncate">${item.isShiny ? '✨' : ''}${item.name}</span>
                                        <span class="px-1.5 py-0.2 rounded text-[10px] shrink-0 ${rInfo.badgeBg}">${rInfo.name}</span>
                                    </div>
                                    <div class="text-[11px] text-slate-400 truncate">
                                        ${fmtNum(item.weightKg)} kg · <span class="text-cyan-300">+${inc}🪙/分</span> · 估价 <span class="text-amber-300">${fmtNum(item.value)}🪙</span>
                                    </div>
                                </div>
                            </div>
                            <div class="grid grid-cols-2 sm:flex items-center gap-1.5 shrink-0">
                                <button data-aq-to-basket="${item.uid}" class="game-btn bg-slate-800 hover:bg-slate-700 text-slate-200 px-2 py-1.5 sm:py-1 rounded-lg text-[11px] whitespace-nowrap">
                                    🧺 移回鱼篓
                                </button>
                                <button data-aq-sell="${item.uid}" class="game-btn bg-amber-600/90 hover:bg-amber-500 text-white px-2 py-1.5 sm:py-1 rounded-lg text-[11px] font-bold whitespace-nowrap">
                                    🪙 出售(${fmtNum(item.value)})
                                </button>
                            </div>
                        </div>
                    `;
                }).join('');

                aqListEl.querySelectorAll('[data-aq-to-basket]').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const uid = btn.getAttribute('data-aq-to-basket');
                        const idx = p.aquarium.findIndex(f => f.uid === uid);
                        if (idx !== -1) {
                            const [moved] = p.aquarium.splice(idx, 1);
                            p.basket.push(moved);
                            syncAquariumSwimmers();
                            renderAquariumModalLists();
                            WWF.updateHUD();
                            WWF.saveProgress();
                            WWF.showToast(`🧺 已将【${moved.name}】移回随身鱼篓`, 'info');
                        }
                    });
                });

                aqListEl.querySelectorAll('[data-aq-sell]').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const uid = btn.getAttribute('data-aq-sell');
                        const idx = p.aquarium.findIndex(f => f.uid === uid);
                        if (idx !== -1) {
                            const [sold] = p.aquarium.splice(idx, 1);
                            p.coins += Number(sold.value) || 0;
                            if (WWF.Sound && WWF.Sound.playCoin) WWF.Sound.playCoin();
                            syncAquariumSwimmers();
                            renderAquariumModalLists();
                            WWF.updateHUD();
                            WWF.saveProgress();
                            WWF.showToast(`🪙 出售【${sold.name}】获得 +${sold.value} 金币！`, 'gold');
                        }
                    });
                });
            }
        }

        // 2. 渲染右侧随身鱼篓列表 (#basketFishList)
        const basketListEl = document.getElementById('basketFishList');
        if (basketListEl) {
            if (p.basket.length === 0) {
                basketListEl.innerHTML = `<div class="text-xs text-slate-500 text-center py-8 border border-dashed border-slate-800 rounded-xl">鱼篓暂无存鱼 · 钓鱼结算时选择【留存鱼篓】可用来交付高倍悬赏订单！</div>`;
            } else {
                basketListEl.innerHTML = p.basket.map(item => {
                    const fish = getFishById(item.fishId);
                    const rInfo = (WWF.RARITIES && WWF.RARITIES[item.rarity]) || WWF.RARITIES.common;
                    const svgHtml = typeof WWF.createFishSVG === 'function' ? WWF.createFishSVG(fish, false, !!item.isShiny) : '';
                    const matchesOrder = (p.bountyOrders || []).some(ord => doesFishMatchOrder(item, ord));
                    return `
                        <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div class="flex items-center gap-2.5 min-w-0">
                                <div class="w-12 h-8 rounded-lg bg-slate-950 border border-slate-800 p-0.5 shrink-0 flex items-center justify-center">
                                    ${svgHtml}
                                </div>
                                <div class="min-w-0 flex-1">
                                    <div class="text-xs font-bold text-white flex flex-wrap items-center gap-1">
                                        <span class="truncate">${item.isShiny ? '✨' : ''}${item.name}</span>
                                        <span class="px-1.5 py-0.2 rounded text-[10px] shrink-0 ${rInfo.badgeBg}">${rInfo.name}</span>
                                        ${matchesOrder ? `<span class="px-1.5 py-0.2 rounded bg-rose-500/30 border border-rose-400/50 text-rose-200 text-[10px] shrink-0">📜可交悬赏</span>` : ''}
                                    </div>
                                    <div class="text-[11px] text-slate-400 truncate">
                                        ${fmtNum(item.weightKg)} kg · ${Number(item.lengthCm).toFixed(1)} cm · 价值 <span class="text-amber-300">${fmtNum(item.value)}🪙</span>
                                    </div>
                                </div>
                            </div>
                            <div class="grid grid-cols-2 sm:flex items-center gap-1.5 shrink-0">
                                <button data-basket-to-aq="${item.uid}" class="game-btn bg-cyan-600/90 hover:bg-cyan-500 text-white px-2 py-1.5 sm:py-1 rounded-lg text-[11px] font-bold whitespace-nowrap">
                                    🐠 放入水箱
                                </button>
                                <button data-basket-sell="${item.uid}" class="game-btn bg-amber-600/90 hover:bg-amber-500 text-white px-2 py-1.5 sm:py-1 rounded-lg text-[11px] font-bold whitespace-nowrap">
                                    🪙 出售(${fmtNum(item.value)})
                                </button>
                            </div>
                        </div>
                    `;
                }).join('');

                basketListEl.querySelectorAll('[data-basket-to-aq]').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const uid = btn.getAttribute('data-basket-to-aq');
                        if (p.aquarium.length >= upg.capacity) {
                            WWF.showToast(`⚠️ 水族箱容量已满 (${p.aquarium.length}/${upg.capacity})！请先扩建水族箱`, 'warn');
                            return;
                        }
                        const idx = p.basket.findIndex(f => f.uid === uid);
                        if (idx !== -1) {
                            const [moved] = p.basket.splice(idx, 1);
                            p.aquarium.push(moved);
                            syncAquariumSwimmers();
                            renderAquariumModalLists();
                            WWF.updateHUD();
                            WWF.saveProgress();
                            WWF.showToast(`🐠 已将【${moved.name}】放入观赏水族箱！`, 'success');
                        }
                    });
                });

                basketListEl.querySelectorAll('[data-basket-sell]').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const uid = btn.getAttribute('data-basket-sell');
                        const idx = p.basket.findIndex(f => f.uid === uid);
                        if (idx !== -1) {
                            const [sold] = p.basket.splice(idx, 1);
                            p.coins += Number(sold.value) || 0;
                            if (WWF.Sound && WWF.Sound.playCoin) WWF.Sound.playCoin();
                            renderAquariumModalLists();
                            WWF.updateHUD();
                            WWF.saveProgress();
                            WWF.showToast(`🪙 出售【${sold.name}】获得 +${sold.value} 金币！`, 'gold');
                        }
                    });
                });
            }
        }
    }

    WWF.openAquariumModal = function () {
        const modal = document.getElementById('aquariumModal');
        if (!modal) return;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        aqVisual.isOpen = true;

        resizeAquariumCanvas();
        syncAquariumSwimmers();
        renderAquariumModalLists();
        WWF.renderAquariumCanvas();
    };

    WWF.closeAquariumModal = function () {
        const modal = document.getElementById('aquariumModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        aqVisual.isOpen = false;
        if (aqVisual.pointer) aqVisual.pointer.active = false;
    };

    // ------------------------------------------------------------------------
    // 5. 老船长每日悬赏订单 & 黄金鱼潮召唤
    //    (WWF.openOrdersModal, WWF.closeOrdersModal, WWF.generateBountyOrders)
    // ------------------------------------------------------------------------
    function doesFishMatchOrder(fishEntry, order) {
        if (!fishEntry || !order) return false;
        const species = getFishById(fishEntry.fishId);
        if (order.type === 'biome') {
            return species.prefBiome === order.targetBiome;
        }
        if (order.type === 'rarity') {
            const rank = { common: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };
            const minR = rank[order.targetRarity] || 2;
            const curR = rank[fishEntry.rarity] || 1;
            if (order.minWeightKg && fishEntry.weightKg < order.minWeightKg) return false;
            return curR >= minR;
        }
        if (order.type === 'species') {
            return fishEntry.fishId === order.targetFishId;
        }
        return false;
    }

    function findMatchingFishForOrder(order) {
        const p = WWF.player;
        if (!p || !order) return null;
        // 优先从随身鱼篓查找
        if (Array.isArray(p.basket)) {
            for (let i = 0; i < p.basket.length; i++) {
                if (doesFishMatchOrder(p.basket[i], order)) {
                    return { source: 'basket', index: i, fish: p.basket[i] };
                }
            }
        }
        // 其次从水族箱查找
        if (Array.isArray(p.aquarium)) {
            for (let i = 0; i < p.aquarium.length; i++) {
                if (doesFishMatchOrder(p.aquarium[i], order)) {
                    return { source: 'aquarium', index: i, fish: p.aquarium[i] };
                }
            }
        }
        return null;
    }

    function buildSingleBountyOrder(slotType) {
        const p = WWF.player || {};
        const fishList = getFishList();
        const hasBoat = Array.isArray(p.unlockedBoats) && p.unlockedBoats.some(id => id !== 'none');
        const maxBiome = hasBoat ? 3 : 1;
        const uid = 'ord_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

        if (slotType === 0) {
            // ① 指定海域生态鱼类
            const biomeIdx = Math.floor(Math.random() * (maxBiome + 1));
            const biome = (WWF.BIOMES && WWF.BIOMES[biomeIdx]) || { index: 0, name: '芦苇浅滩', icon: '🌾' };
            const mult = +(2.2 + Math.random() * 0.25).toFixed(2);
            const luck = 2 + Math.floor(Math.random() * 2);
            return {
                id: uid,
                type: 'biome',
                title: `${biome.icon} 【生态采集】${biome.name}特产`,
                client: '生态学者·林恩',
                targetBiome: biome.index,
                desc: `交付任意 1 条栖息于【${biome.name}】海域的生态鱼类`,
                rewardMult: mult,
                minCoins: 45 + biome.index * 35,
                luckReward: luck
            };
        } else if (slotType === 1) {
            // ② 指定稀有度或重量达标大鱼
            const isEpicQuest = hasBoat && Math.random() < 0.45;
            const targetRarity = isEpicQuest ? 'epic' : 'rare';
            const rName = isEpicQuest ? '史诗 (EPIC)' : '稀有 (RARE)';
            const mult = +(2.4 + Math.random() * 0.25).toFixed(2);
            const luck = isEpicQuest ? 5 : 3;
            return {
                id: uid,
                type: 'rarity',
                title: `🏆 【名鱼悬赏】${isEpicQuest ? '史诗巨物挑战' : '稀有品质鉴赏'}`,
                client: '星港主厨·戈登',
                targetRarity: targetRarity,
                desc: `交付任意 1 条达到【${rName}】或更高品级的珍稀鱼获`,
                rewardMult: mult,
                minCoins: isEpicQuest ? 240 : 95,
                luckReward: luck
            };
        } else {
            // ③ 指定某一种特定鱼类
            const candidates = fishList.filter(f => (f.prefBiome || 0) <= maxBiome && f.rarity !== 'mythic');
            const pool = candidates.length > 0 ? candidates : fishList;
            const targetFish = pool[Math.floor(Math.random() * pool.length)] || getFishById('crucian');
            const biome = (WWF.BIOMES && WWF.BIOMES[targetFish.prefBiome || 0]) || { name: '微风木栈桥' };
            const mult = +(2.6 + Math.random() * 0.2).toFixed(2);
            const luck = targetFish.rarity === 'legendary' ? 6 : (targetFish.rarity === 'epic' ? 5 : 4);
            return {
                id: uid,
                type: 'species',
                title: `🎯 【指定专供】急需「${targetFish.name}」`,
                client: '老船长·巴博萨',
                targetFishId: targetFish.id,
                desc: `老船长指名收购 1 条【${targetFish.name}】（常出没于${biome.name}）`,
                rewardMult: mult,
                minCoins: Math.round((targetFish.baseValue || 25) * mult),
                luckReward: luck
            };
        }
    }

    WWF.generateBountyOrders = function (silent = false) {
        if (!WWF.player) return;
        WWF.player.bountyOrders = [
            buildSingleBountyOrder(0),
            buildSingleBountyOrder(1),
            buildSingleBountyOrder(2)
        ];
        WWF.saveProgress();
        WWF.updateHUD();
        if (!silent) {
            renderOrdersList();
            WWF.showToast('📜 老船长已换上一批全新的码头悬赏委托！', 'info');
        }
    };

    function renderOrdersList() {
        const p = WWF.player;
        if (!p) return;

        const completedEl = document.getElementById('ordersCompletedCount');
        if (completedEl) {
            completedEl.textContent = String(p.completedOrdersCount || 0);
        }

        const listEl = document.getElementById('ordersList');
        if (!listEl) return;

        if (!Array.isArray(p.bountyOrders) || p.bountyOrders.length === 0) {
            WWF.generateBountyOrders(true);
        }

        listEl.innerHTML = p.bountyOrders.map((ord, idx) => {
            const match = findMatchingFishForOrder(ord);
            const payoutCoins = match
                ? Math.max(ord.minCoins || 50, Math.round((match.fish.value || 20) * (ord.rewardMult || 2.5)))
                : (ord.minCoins || 60);
            const sourceText = match ? (match.source === 'basket' ? '鱼篓' : '水族箱') : '';

            return `
                <div class="rounded-2xl border ${match ? 'border-emerald-400/70 bg-gradient-to-b from-emerald-950/50 to-slate-900 shadow-lg shadow-emerald-500/10' : 'border-slate-700/80 bg-slate-950/70'} p-4 flex flex-col justify-between gap-3">
                    <div>
                        <div class="flex items-center justify-between gap-1 mb-1.5">
                            <span class="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">${ord.client}</span>
                            <span class="text-xs font-extrabold text-amber-300">赏金 ×${ord.rewardMult.toFixed(1)}倍</span>
                        </div>
                        <h3 class="text-sm font-bold text-white mb-1">${ord.title}</h3>
                        <p class="text-xs text-slate-300 leading-relaxed">${ord.desc}</p>
                    </div>

                    <div class="space-y-2 pt-2 border-t border-slate-800/80">
                        <div class="flex items-center justify-between text-xs">
                            <span class="text-slate-400">保底/预计赏金:</span>
                            <span class="font-bold text-amber-300">+${payoutCoins} 🪙 · +${ord.luckReward} 🍀</span>
                        </div>
                        ${match ? `
                            <div class="text-[11px] text-emerald-300 bg-emerald-950/80 border border-emerald-500/30 rounded-lg px-2.5 py-1 truncate">
                                ✅ 可交 (${sourceText})：${match.fish.isShiny ? '✨' : ''}${match.fish.name} (${Number(match.fish.weightKg).toFixed(2)}kg)
                            </div>
                            <button data-deliver-order="${idx}" class="game-btn w-full py-2 px-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 border border-emerald-300 text-white font-extrabold text-xs shadow-lg animate-pulse">
                                ✨ 立即交付领赏 (+${payoutCoins}🪙 +${ord.luckReward}🍀)
                            </button>
                        ` : `
                            <div class="text-[11px] text-slate-500 bg-slate-900/80 border border-slate-800 rounded-lg px-2.5 py-1">
                                ⏳ 鱼篓与水族箱中暂无符合条件的鱼
                            </div>
                            <button disabled class="game-btn w-full py-2 px-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-500 font-bold text-xs">
                                尚未备齐目标渔获
                            </button>
                        `}
                    </div>
                </div>
            `;
        }).join('');

        listEl.querySelectorAll('[data-deliver-order]').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.getAttribute('data-deliver-order'));
                const ord = p.bountyOrders[idx];
                if (!ord) return;
                const match = findMatchingFishForOrder(ord);
                if (!match) {
                    WWF.showToast('⚠️ 未找到符合要求的鱼获！', 'warn');
                    return;
                }

                const payoutCoins = Math.max(ord.minCoins || 50, Math.round((match.fish.value || 20) * (ord.rewardMult || 2.5)));
                const luckGain = ord.luckReward || 3;

                // 从对应容器移除该鱼
                if (match.source === 'basket') {
                    p.basket.splice(match.index, 1);
                } else {
                    p.aquarium.splice(match.index, 1);
                    syncAquariumSwimmers();
                }

                p.coins += payoutCoins;
                p.luckPoints = (p.luckPoints || 0) + luckGain;
                p.completedOrdersCount = (p.completedOrdersCount || 0) + 1;

                // 补充一张新的同槽位悬赏订单
                p.bountyOrders[idx] = buildSingleBountyOrder(idx % 3);

                if (WWF.Sound && WWF.Sound.playCoin) WWF.Sound.playCoin();
                WWF.showToast(`📜 悬赏交付成功！获得 +${payoutCoins} 🪙 赏金与 +${luckGain} 🍀 幸运值！`, 'gold');
                WWF.saveProgress();
                WWF.updateHUD();
                renderOrdersList();
            });
        });
    }

    WWF.openOrdersModal = function () {
        const modal = document.getElementById('ordersModal');
        if (!modal) return;
        renderOrdersList();
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    };

    WWF.closeOrdersModal = function () {
        const modal = document.getElementById('ordersModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    };

    // ------------------------------------------------------------------------
    // 6. 鱼类图鉴 & 实时概率矩阵 (WWF.openBookModal, WWF.closeBookModal)
    // ------------------------------------------------------------------------
    function cleanupBookShowcaseFeels() {
        const grid = document.getElementById('bookGrid');
        if (!grid) return;
        grid.querySelectorAll('.book-fish-preview').forEach(el => {
            if (typeof el._wwfFeelCleanup === 'function') {
                el._wwfFeelCleanup();
                el._wwfFeelCleanup = null;
            }
        });
    }

    function renderBookContent() {
        const p = WWF.player;
        const g = WWF.game;
        if (!p) return;

        const filterBar = document.getElementById('bookBiomeFilter');
        const tierBar = document.getElementById('tierSummaryBar');
        const grid = document.getElementById('bookGrid');
        if (!grid) return;

        cleanupBookShowcaseFeels();

        const filterTabs = [
            { id: 'all', label: '🌊 全部海域' },
            { id: 0, label: '🌾 芦苇浅滩' },
            { id: 1, label: '🌉 微风木栈桥' },
            { id: 2, label: '🏝️ 翡翠湖心岛' },
            { id: 3, label: '⚓ 星渊沉船湾' }
        ];

        if (filterBar) {
            filterBar.innerHTML = filterTabs.map(tab => {
                const active = String(currentBookBiomeFilter) === String(tab.id);
                return `
                    <button data-book-biome="${tab.id}" class="px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${active ? 'bg-indigo-500 text-white shadow' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}">
                        ${tab.label}
                    </button>
                `;
            }).join('');

            filterBar.querySelectorAll('[data-book-biome]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const val = btn.getAttribute('data-book-biome');
                    currentBookBiomeFilter = val === 'all' ? 'all' : Number(val);
                    renderBookContent();
                });
            });
        }

        // 计算对应生态区或当前所在海域的实时概率
        const targetBiomeIdx = currentBookBiomeFilter === 'all'
            ? (WWF.getCurrentBiome ? WWF.getCurrentBiome().index : 1)
            : Number(currentBookBiomeFilter);
        const probData = getNormalizedProbabilities(p.selectedBait, g ? g.depthZone : 1, targetBiomeIdx);
        const probMap = new Map();
        probData.items.forEach(it => {
            if (it.fish) probMap.set(it.fish.id, it.prob);
        });

        // 渲染稀有度汇总条
        if (tierBar) {
            const tp = probData.tierProbs || {};
            const tiers = ['common', 'rare', 'epic', 'legendary', 'mythic'];
            const tierBadges = tiers.map(rKey => {
                const rInfo = (WWF.RARITIES && WWF.RARITIES[rKey]) || { name: rKey, badgeBg: 'bg-slate-800' };
                const pct = ((tp[rKey] || 0) * 100).toFixed(1);
                return `<span class="px-2 py-0.5 rounded-md text-[11px] font-bold ${rInfo.badgeBg}">${rInfo.name}: ${pct}%</span>`;
            });
            tierBadges.push(`<span class="px-2 py-0.5 rounded-md text-[11px] font-bold bg-yellow-500/20 text-yellow-200 border border-yellow-400/40">✨ 闪光率: ${((probData.shinyChance || 0.02) * 100).toFixed(1)}%</span>`);
            tierBar.innerHTML = tierBadges.join('');
        }

        const skillTagMap = {
            steady: { label: '⚖️ 稳健型', cls: 'bg-emerald-950 text-emerald-300 border-emerald-500/30' },
            dasher: { label: '⚡ 冲刺型', cls: 'bg-amber-950 text-amber-300 border-amber-500/30' },
            sinker: { label: '🪨 沉底型', cls: 'bg-sky-950 text-sky-300 border-sky-500/30' },
            illusion: { label: '🌀 幻影型', cls: 'bg-fuchsia-950 text-fuchsia-300 border-fuchsia-500/30' }
        };
        const weatherNameMap = {
            any: '🌤️ 全天候',
            sunny: '☀️ 晴空偏好',
            rain: '🌧️ 烟雨偏好',
            storm: '⛈️ 雷暴偏好',
            meteor: '🌠 星陨偏好'
        };

        const allFish = getFishList();
        const filteredFish = currentBookBiomeFilter === 'all'
            ? allFish
            : allFish.filter(f => f.prefBiome === Number(currentBookBiomeFilter));

        grid.innerHTML = filteredFish.map(fish => {
            const rec = p.records && p.records[fish.id];
            const unlocked = !!(rec && rec.count > 0);
            const hasShiny = !!(rec && rec.shinyCount > 0);
            const rInfo = (WWF.RARITIES && WWF.RARITIES[fish.rarity]) || WWF.RARITIES.common;
            const biome = (WWF.BIOMES && WWF.BIOMES[fish.prefBiome || 0]) || { name: '未知海域', icon: '🌊' };
            const skill = skillTagMap[fish.skillType] || skillTagMap.steady;
            const weatherLabel = weatherNameMap[fish.prefWeather || 'any'] || '🌤️ 全天候';
            const exactProb = ((probMap.get(fish.id) || 0) * 100).toFixed(2);
            const svgHtml = typeof WWF.createFishSVG === 'function' ? WWF.createFishSVG(fish, !unlocked, hasShiny) : '';

            return `
                <div class="rounded-2xl border p-3.5 flex flex-col justify-between gap-2.5 transition ${unlocked ? 'bg-slate-950/75 border-slate-700/90' : 'bg-slate-950/40 border-slate-800/70 opacity-85'}">
                    <div class="flex items-start justify-between gap-2">
                        <div>
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <span class="px-2 py-0.5 rounded text-[10px] font-bold ${rInfo.badgeBg}">${rInfo.name}</span>
                                <span class="px-1.5 py-0.5 rounded border text-[10px] ${skill.cls}">${skill.label}</span>
                                ${hasShiny ? `<span class="px-1.5 py-0.5 rounded bg-yellow-500/25 border border-yellow-300/60 text-yellow-200 text-[10px] font-bold">✨ 闪光×${rec.shinyCount}</span>` : ''}
                            </div>
                            <h3 class="text-sm font-extrabold text-white mt-1">${unlocked ? fish.name : `??? (${fish.name})`}</h3>
                        </div>
                        <div class="text-right shrink-0">
                            <div class="text-[10px] text-slate-400">当前概率</div>
                            <div class="text-xs font-mono font-bold text-sky-300">${exactProb}%</div>
                        </div>
                    </div>

                    <div class="book-fish-preview relative w-full h-24 rounded-xl bg-slate-900/90 border border-slate-800/80 flex items-center justify-center p-2 overflow-hidden" data-fish-id="${fish.id}" data-unlocked="${unlocked ? '1' : '0'}" data-shiny="${hasShiny ? '1' : '0'}">
                        <div class="w-36 h-20 flex items-center justify-center pointer-events-none">
                            ${svgHtml}
                        </div>
                    </div>

                    <div class="space-y-1 text-[11px]">
                        <div class="flex items-center justify-between text-slate-300">
                            <span>栖息: <b>${biome.icon} ${biome.name}</b></span>
                            <span>${weatherLabel}</span>
                        </div>
                        ${unlocked ? `
                            <div class="flex items-center justify-between text-emerald-300 font-medium">
                                <span>已捕获: ${rec.count} 条</span>
                                <span>最大纪录: ${Number(rec.maxKg).toFixed(2)} kg (${Number(rec.maxLen).toFixed(1)}cm)</span>
                            </div>
                            <p class="text-[11px] text-slate-400 leading-snug pt-0.5">${fish.desc}</p>
                        ` : `
                            <div class="text-slate-500">尚未捕获 · 前往【${biome.name}】垂钓解锁图鉴详情</div>
                        `}
                    </div>
                </div>
            `;
        }).join('');

        grid.querySelectorAll('.book-fish-preview').forEach(previewEl => {
            const fishId = previewEl.getAttribute('data-fish-id');
            const isUnlocked = previewEl.getAttribute('data-unlocked') === '1';
            const hasShiny = previewEl.getAttribute('data-shiny') === '1';
            const fish = getFishById(fishId);

            if (typeof WWF.bindFishShowcaseFeel === 'function') {
                WWF.bindFishShowcaseFeel(previewEl, fish, {
                    enableTilt: true,
                    enablePoke: isUnlocked,
                    compact: true,
                    isShiny: isUnlocked ? hasShiny : false
                });
            }

            if (!isUnlocked) {
                const baseCleanup = previewEl._wwfFeelCleanup;
                let jiggleTimer = null;
                const onSilhouetteClick = () => {
                    const svg = previewEl.querySelector('.fish-model-svg');
                    if (!svg) return;
                    svg.classList.remove('fish-silhouette-jiggle');
                    void svg.offsetWidth;
                    svg.classList.add('fish-silhouette-jiggle');
                    if (jiggleTimer) clearTimeout(jiggleTimer);
                    jiggleTimer = setTimeout(() => {
                        svg.classList.remove('fish-silhouette-jiggle');
                    }, 340);
                };
                previewEl.addEventListener('pointerdown', onSilhouetteClick);
                previewEl._wwfFeelCleanup = () => {
                    if (jiggleTimer) clearTimeout(jiggleTimer);
                    previewEl.removeEventListener('pointerdown', onSilhouetteClick);
                    if (typeof baseCleanup === 'function') baseCleanup();
                };
            }
        });
    }

    WWF.openBookModal = function () {
        const modal = document.getElementById('bookModal');
        if (!modal) return;
        renderBookContent();
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    };

    WWF.closeBookModal = function () {
        cleanupBookShowcaseFeels();
        const modal = document.getElementById('bookModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    };

    // ------------------------------------------------------------------------
    // 7. 老船长商店、船坞与角色换装工坊
    //    (WWF.openShopModal, WWF.closeShopModal, WWF.renderShopContent)
    // ------------------------------------------------------------------------
    WWF.renderShopContent = function () {
        const p = WWF.player;
        if (!p) return;

        const shopCoins = document.getElementById('shopCoins');
        if (shopCoins) shopCoins.textContent = String(Math.floor(p.coins || 0));

        // 1. 特制鱼饵区 (#shopBaitList)
        const baitListEl = document.getElementById('shopBaitList');
        if (baitListEl) {
            const purchasableBaits = (WWF.BAITS || []).filter(b => b.id !== 'dough');
            baitListEl.innerHTML = purchasableBaits.map(b => {
                const owned = (p.baits && p.baits[b.id]) || 0;
                const canAfford = p.coins >= b.price;
                return `
                    <div class="bg-slate-950/75 border border-slate-800 rounded-2xl p-3.5 flex flex-col justify-between gap-3">
                        <div>
                            <div class="flex items-center justify-between">
                                <span class="text-2xl">${b.icon}</span>
                                <span class="px-2 py-0.5 rounded-full bg-slate-800 text-sky-300 text-xs font-mono">库存: ${owned}</span>
                            </div>
                            <h4 class="text-sm font-bold text-white mt-1.5">${b.name} <span class="text-xs text-amber-300 font-normal">(+${b.packSize}份)</span></h4>
                            <p class="text-xs text-slate-400 mt-1 leading-relaxed">${b.desc}</p>
                        </div>
                        <button data-buy-bait="${b.id}" class="game-btn w-full py-2 px-3 rounded-xl font-bold text-xs ${canAfford ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white' : 'bg-slate-800 text-slate-500'}">
                            🪙 ${b.price} 金币购买 (+${b.packSize}份)
                        </button>
                    </div>
                `;
            }).join('');

            baitListEl.querySelectorAll('[data-buy-bait]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const bId = btn.getAttribute('data-buy-bait');
                    const bait = getBaitById(bId);
                    if (p.coins < bait.price) {
                        WWF.showToast(`⚠️ 金币不足 ${bait.price} 🪙，无法购买【${bait.name}】！`, 'warn');
                        return;
                    }
                    p.coins -= bait.price;
                    p.baits[bId] = (p.baits[bId] || 0) + (bait.packSize || 5);
                    p.selectedBait = bId;
                    if (WWF.Sound && WWF.Sound.playCoin) WWF.Sound.playCoin();
                    WWF.showToast(`${bait.icon} 购买成功！【${bait.name}】+${bait.packSize}，已自动装备`, 'success');
                    WWF.saveProgress();
                    WWF.renderBaitSelector();
                    WWF.updateHUD();
                    WWF.renderShopContent();
                });
            });
        }

        // 2. 钓竿与卷线器升级区 (#shopGearList)
        const gearListEl = document.getElementById('shopGearList');
        if (gearListEl) {
            const rods = WWF.ROD_UPGRADES || [];
            const reels = WWF.REEL_UPGRADES || [];
            const curRod = rods[p.rodLevel - 1] || rods[0];
            const nextRod = rods[p.rodLevel];
            const curReel = reels[p.reelLevel - 1] || reels[0];
            const nextReel = reels[p.reelLevel];

            gearListEl.innerHTML = `
                <!-- 钓竿升级卡 -->
                <div class="bg-slate-950/75 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between gap-3">
                    <div>
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-bold text-sky-400 uppercase">🎣 钓竿强化 (当前 Lv.${p.rodLevel})</span>
                            <span class="text-xs text-slate-400">${curRod ? curRod.name : ''}</span>
                        </div>
                        <h4 class="text-base font-extrabold text-white mt-1">${nextRod ? `下一阶：${nextRod.name} (Lv.${nextRod.level})` : `👑 已达满级：${curRod ? curRod.name : ''}`}</h4>
                        <p class="text-xs text-slate-300 mt-1">${nextRod ? nextRod.desc : '你已拥有微风湖最高规格的星辉大师钓竿！'}</p>
                    </div>
                    ${nextRod ? `
                        <button id="btnBuyRodUpgrade" class="game-btn w-full py-2.5 px-4 rounded-xl font-bold text-xs ${p.coins >= nextRod.price ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white' : 'bg-slate-800 text-slate-500'}">
                            ⬆️ 升级钓竿 (${nextRod.price} 🪙)
                        </button>
                    ` : `
                        <button disabled class="game-btn w-full py-2.5 px-4 rounded-xl bg-slate-800 text-emerald-300 font-bold text-xs">
                            ✅ 已升至最高等级
                        </button>
                    `}
                </div>

                <!-- 卷线器升级卡 -->
                <div class="bg-slate-950/75 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between gap-3">
                    <div>
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-bold text-emerald-400 uppercase">⚙️ 卷线器强化 (当前 Lv.${p.reelLevel})</span>
                            <span class="text-xs text-slate-400">${curReel ? curReel.name : ''}</span>
                        </div>
                        <h4 class="text-base font-extrabold text-white mt-1">${nextReel ? `下一阶：${nextReel.name} (Lv.${nextReel.level})` : `👑 已达满级：${curReel ? curReel.name : ''}`}</h4>
                        <p class="text-xs text-slate-300 mt-1">${nextReel ? nextReel.desc : '你已拥有微风湖最高规格的龙吟涡轮卷线器！'}</p>
                    </div>
                    ${nextReel ? `
                        <button id="btnBuyReelUpgrade" class="game-btn w-full py-2.5 px-4 rounded-xl font-bold text-xs ${p.coins >= nextReel.price ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white' : 'bg-slate-800 text-slate-500'}">
                            ⬆️ 升级卷线器 (${nextReel.price} 🪙)
                        </button>
                    ` : `
                        <button disabled class="game-btn w-full py-2.5 px-4 rounded-xl bg-slate-800 text-emerald-300 font-bold text-xs">
                            ✅ 已升至最高等级
                        </button>
                    `}
                </div>
            `;

            const btnRod = document.getElementById('btnBuyRodUpgrade');
            if (btnRod && nextRod) {
                btnRod.addEventListener('click', () => {
                    if (p.coins < nextRod.price) {
                        WWF.showToast(`⚠️ 金币不足 ${nextRod.price} 🪙，无法升级钓竿！`, 'warn');
                        return;
                    }
                    p.coins -= nextRod.price;
                    p.rodLevel = nextRod.level;
                    if (WWF.Sound && WWF.Sound.playQTESuccess) WWF.Sound.playQTESuccess();
                    WWF.showToast(`🎣 钓竿已升级至 Lv.${nextRod.level}【${nextRod.name}】！`, 'success');
                    WWF.saveProgress();
                    WWF.updateHUD();
                    WWF.renderShopContent();
                });
            }

            const btnReel = document.getElementById('btnBuyReelUpgrade');
            if (btnReel && nextReel) {
                btnReel.addEventListener('click', () => {
                    if (p.coins < nextReel.price) {
                        WWF.showToast(`⚠️ 金币不足 ${nextReel.price} 🪙，无法升级卷线器！`, 'warn');
                        return;
                    }
                    p.coins -= nextReel.price;
                    p.reelLevel = nextReel.level;
                    if (WWF.Sound && WWF.Sound.playQTESuccess) WWF.Sound.playQTESuccess();
                    WWF.showToast(`⚙️ 卷线器已升级至 Lv.${nextReel.level}【${nextReel.name}】！`, 'success');
                    WWF.saveProgress();
                    WWF.updateHUD();
                    WWF.renderShopContent();
                });
            }
        }

        // 3. 远航船坞区 (#shopBoatList)
        const boatListEl = document.getElementById('shopBoatList');
        if (boatListEl) {
            const boats = (WWF.BOATS || []).filter(b => b.id !== 'none');
            boatListEl.innerHTML = boats.map(b => {
                const unlocked = Array.isArray(p.unlockedBoats) && p.unlockedBoats.includes(b.id);
                const equipped = unlocked && p.equippedBoat === b.id;
                return `
                    <div class="bg-slate-950/75 border ${equipped ? 'border-cyan-400/70' : 'border-slate-800'} rounded-2xl p-4 flex flex-col justify-between gap-3">
                        <div>
                            <div class="flex items-center justify-between">
                                <span class="text-2xl">${b.icon}</span>
                                <span class="text-xs px-2 py-0.5 rounded-full ${unlocked ? 'bg-cyan-500/20 text-cyan-300' : 'bg-slate-800 text-amber-300'}">
                                    ${unlocked ? (equipped ? '✅ 当前使用中' : '已解锁') : `🪙 ${b.price}`}
                                </span>
                            </div>
                            <h4 class="text-sm font-bold text-white mt-1.5">${b.name}</h4>
                            <p class="text-xs text-slate-400 mt-1 leading-relaxed">${b.desc}</p>
                        </div>
                        ${!unlocked ? `
                            <button data-boat-action="${b.id}" class="game-btn w-full py-2 px-3 rounded-xl font-bold text-xs ${p.coins >= b.price ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white' : 'bg-slate-800 text-slate-500'}">
                                🪙 解锁船只 (${b.price} 金币)
                            </button>
                        ` : `
                            <button data-boat-action="${b.id}" class="game-btn w-full py-2 px-3 rounded-xl font-bold text-xs ${equipped ? 'bg-emerald-600/40 border border-emerald-400/50 text-emerald-200' : 'bg-cyan-600 hover:bg-cyan-500 text-white'}">
                                ${equipped ? '🚣 已装备 (点击直接登船出航)' : '🚣 装备此船只'}
                            </button>
                        `}
                    </div>
                `;
            }).join('');

            boatListEl.querySelectorAll('[data-boat-action]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const boatId = btn.getAttribute('data-boat-action');
                    const boat = (WWF.BOATS || []).find(b => b.id === boatId);
                    if (!boat) return;

                    const unlocked = p.unlockedBoats.includes(boatId);
                    if (!unlocked) {
                        if (p.coins < boat.price) {
                            WWF.showToast(`⚠️ 金币不足 ${boat.price} 🪙，无法解锁【${boat.name}】！`, 'warn');
                            return;
                        }
                        p.coins -= boat.price;
                        p.unlockedBoats.push(boatId);
                        p.equippedBoat = boatId;
                        p.inBoat = true;
                        if (p.worldX < 120) p.worldX = 120;
                        if (WWF.Sound && WWF.Sound.playQTESuccess) WWF.Sound.playQTESuccess();
                        WWF.showToast(`${boat.icon} 成功解锁并登上【${boat.name}】！现在可前往湖心岛与沉船湾！`, 'success');
                    } else {
                        p.equippedBoat = boatId;
                        p.inBoat = true;
                        if (p.worldX < 120) p.worldX = 120;
                        if (WWF.Sound && WWF.Sound.playPlop) WWF.Sound.playPlop();
                        WWF.showToast(`${boat.icon} 已切换并登上【${boat.name}】！`, 'info');
                    }
                    WWF.saveProgress();
                    WWF.updateHUD();
                    WWF.renderShopContent();
                });
            });
        }

        // 4. 角色纸娃娃换装区 (#shopOutfitList：4 款帽子 + 4 款服装)
        const outfitListEl = document.getElementById('shopOutfitList');
        if (outfitListEl) {
            const hats = (WWF.HATS || []).map(h => ({ ...h, category: 'hat', catLabel: '🎩 头饰' }));
            const outfits = (WWF.OUTFITS || []).map(o => ({ ...o, category: 'outfit', catLabel: '👘 服饰' }));
            const items = [...hats, ...outfits];

            outfitListEl.innerHTML = items.map(item => {
                const isHat = item.category === 'hat';
                const unlockedList = isHat ? (p.unlockedHats || ['straw']) : (p.unlockedOutfits || ['casual']);
                const unlocked = unlockedList.includes(item.id);
                const equipped = isHat ? (p.equippedHat === item.id) : (p.equippedOutfit === item.id);
                const swatchA = isHat ? item.color : item.primary;
                const swatchB = isHat ? item.bandColor : item.secondary;

                return `
                    <div class="bg-slate-950/75 border ${equipped ? 'border-pink-400/70' : 'border-slate-800'} rounded-2xl p-3.5 flex flex-col justify-between gap-2.5">
                        <div>
                            <div class="flex items-center justify-between">
                                <span class="text-[11px] px-2 py-0.5 rounded-md bg-slate-800 text-pink-300 font-bold">${item.catLabel}</span>
                                <div class="flex items-center gap-1">
                                    <span class="w-3.5 h-3.5 rounded-full border border-white/30" style="background:${swatchA}"></span>
                                    <span class="w-3.5 h-3.5 rounded-full border border-white/30" style="background:${swatchB}"></span>
                                </div>
                            </div>
                            <h4 class="text-sm font-bold text-white mt-2 flex items-center gap-1.5">
                                <span>${item.icon}</span>
                                <span>${item.name}</span>
                            </h4>
                            <p class="text-xs text-slate-400 mt-1">${item.desc}</p>
                        </div>
                        ${!unlocked ? `
                            <button data-wardrobe-cat="${item.category}" data-wardrobe-id="${item.id}" class="game-btn w-full py-2 px-3 rounded-xl font-bold text-xs ${p.coins >= item.price ? 'bg-gradient-to-r from-pink-500 to-rose-600 text-white' : 'bg-slate-800 text-slate-500'}">
                                🪙 解锁装扮 (${item.price} 金币)
                            </button>
                        ` : (equipped ? `
                            <button disabled class="game-btn w-full py-2 px-3 rounded-xl bg-pink-500/25 border border-pink-400/50 text-pink-200 font-bold text-xs">
                                ✅ 穿戴中
                            </button>
                        ` : `
                            <button data-wardrobe-cat="${item.category}" data-wardrobe-id="${item.id}" class="game-btn w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white font-bold text-xs">
                                ✨ 立即穿戴
                            </button>
                        `)}
                    </div>
                `;
            }).join('');

            outfitListEl.querySelectorAll('[data-wardrobe-id]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const cat = btn.getAttribute('data-wardrobe-cat');
                    const id = btn.getAttribute('data-wardrobe-id');
                    const isHat = cat === 'hat';
                    const sourceArr = isHat ? (WWF.HATS || []) : (WWF.OUTFITS || []);
                    const item = sourceArr.find(x => x.id === id);
                    if (!item) return;

                    const unlockedArr = isHat ? p.unlockedHats : p.unlockedOutfits;
                    if (!unlockedArr.includes(id)) {
                        if (p.coins < item.price) {
                            WWF.showToast(`⚠️ 金币不足 ${item.price} 🪙，无法解锁【${item.name}】！`, 'warn');
                            return;
                        }
                        p.coins -= item.price;
                        unlockedArr.push(id);
                        if (WWF.Sound && WWF.Sound.playCoin) WWF.Sound.playCoin();
                    }

                    if (isHat) {
                        p.equippedHat = id;
                    } else {
                        p.equippedOutfit = id;
                    }

                    WWF.showToast(`${item.icon} 已换上【${item.name}】！画布角色外观已实时更新`, 'success');
                    WWF.saveProgress();
                    WWF.updateHUD();
                    WWF.renderShopContent();
                });
            });
        }
    };

    WWF.openShopModal = function () {
        const modal = document.getElementById('shopModal');
        if (!modal) return;
        WWF.renderShopContent();
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    };

    WWF.closeShopModal = function () {
        const modal = document.getElementById('shopModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    };

    // ------------------------------------------------------------------------
    // 8. 全局输入控制与主循环启动 (window.onload)
    // ------------------------------------------------------------------------
    function isAnyPopupOpen() {
        const ids = ['catchModal', 'aquariumModal', 'ordersModal', 'bookModal', 'shopModal'];
        return ids.some(id => {
            const el = document.getElementById(id);
            return el && !el.classList.contains('hidden');
        });
    }

    function triggerGameplayPressStart(source = 'button') {
        if (WWF.Sound && WWF.Sound.unlock) WWF.Sound.unlock();
        const g = WWF.game;
        if (!g) return;

        // 静候咬钩阶段误触画布不中断垂钓，避免手机误触浪费鱼饵；仅主按钮或空格键主动收竿
        if (g.state === 'WAITING' && source === 'canvas') {
            if (WWF.addRipple && g.bobberX) {
                WWF.addRipple(g.bobberX, g.bobberY, 20, 'rgba(186, 230, 253, 0.55)');
            }
            return;
        }

        g.isHolding = true;
        const btn = document.getElementById('mainActionBtn');
        if (btn) btn.classList.add('is-pressed');

        if (g.state === 'IDLE') {
            if (typeof WWF.startCharging === 'function') WWF.startCharging();
        } else if (g.state === 'WAITING') {
            if (typeof WWF.cancelFishing === 'function') WWF.cancelFishing('已收回鱼竿，准备重新抛投');
        } else if (g.state === 'BITING') {
            if (typeof WWF.hookFishAndStartReel === 'function') WWF.hookFishAndStartReel();
        } else if (g.state === 'REELING' && g.qteActive) {
            if (typeof WWF.resolveJumpQTE === 'function') {
                WWF.resolveJumpQTE();
            }
        }
    }

    function triggerGameplayPressEnd() {
        const g = WWF.game;
        if (!g) return;
        const btn = document.getElementById('mainActionBtn');
        if (btn) btn.classList.remove('is-pressed');

        const wasHolding = g.isHolding;
        g.isHolding = false;

        if (wasHolding && g.state === 'CHARGING') {
            if (typeof WWF.releaseCast === 'function') WWF.releaseCast();
        }
    }

    function bindAllUIEvents() {
        // 1. 顶部功能栏按钮
        const btnOpenAquarium = document.getElementById('btnOpenAquarium');
        if (btnOpenAquarium) btnOpenAquarium.addEventListener('click', WWF.openAquariumModal);
        const btnCloseAquarium = document.getElementById('btnCloseAquarium');
        if (btnCloseAquarium) btnCloseAquarium.addEventListener('click', WWF.closeAquariumModal);

        const btnOpenOrders = document.getElementById('btnOpenOrders');
        if (btnOpenOrders) btnOpenOrders.addEventListener('click', WWF.openOrdersModal);
        const btnCloseOrders = document.getElementById('btnCloseOrders');
        if (btnCloseOrders) btnCloseOrders.addEventListener('click', WWF.closeOrdersModal);

        const btnOpenBook = document.getElementById('btnOpenBook');
        if (btnOpenBook) btnOpenBook.addEventListener('click', WWF.openBookModal);
        const btnCloseBook = document.getElementById('btnCloseBook');
        if (btnCloseBook) btnCloseBook.addEventListener('click', WWF.closeBookModal);

        const btnOpenShop = document.getElementById('btnOpenShop');
        if (btnOpenShop) btnOpenShop.addEventListener('click', WWF.openShopModal);
        const btnCloseShop = document.getElementById('btnCloseShop');
        if (btnCloseShop) btnCloseShop.addEventListener('click', WWF.closeShopModal);

        // 点击遮罩空白处关闭菜单类弹窗 (渔获结算弹窗不误关)
        [
            ['aquariumModal', WWF.closeAquariumModal],
            ['ordersModal', WWF.closeOrdersModal],
            ['bookModal', WWF.closeBookModal],
            ['shopModal', WWF.closeShopModal]
        ].forEach(([modalId, closeFn]) => {
            const modalEl = document.getElementById(modalId);
            if (modalEl && typeof closeFn === 'function') {
                modalEl.addEventListener('click', (e) => {
                    if (e.target === modalEl) closeFn();
                });
            }
        });

        // 天气切换按钮 (桌面端 + 移动端)
        const cycleWeather = () => {
            if (WWF.Sound && WWF.Sound.unlock) WWF.Sound.unlock();
            const order = ['sunny', 'rain', 'storm', 'meteor'];
            const curIdx = order.indexOf(WWF.player.weatherId);
            const nextId = order[(curIdx + 1) % order.length];
            WWF.player.weatherId = nextId;
            const w = WWF.WEATHERS && WWF.WEATHERS[nextId];
            if (w) {
                WWF.showToast(`${w.icon} 天气已切换为【${w.name}】：${w.desc}`, 'info');
            }
            WWF.updateHUD();
            WWF.saveProgress();
        };
        ['btnWeather', 'btnWeatherMobile'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', cycleWeather);
        });

        // 昼夜天色切换按钮 (桌面端 + 移动端)
        const cycleTheme = () => {
            WWF.player.themeIndex = ((WWF.player.themeIndex || 0) + 1) % 3;
            const themes = WWF.THEMES || [
                { icon: '🌤️', name: '晨曦微光' },
                { icon: '🌅', name: '橘霞落日' },
                { icon: '🌙', name: '星夜流萤' }
            ];
            const th = themes[WWF.player.themeIndex] || themes[0];
            WWF.showToast(`${th.icon} 昼夜氛围已切换为【${th.name}】`, 'info');
            WWF.updateHUD();
            WWF.saveProgress();
        };
        ['btnTheme', 'btnThemeMobile'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', cycleTheme);
        });

        // 音效开关按钮 (桌面端 + 移动端)
        const toggleAudio = () => {
            WWF.player.muted = !WWF.player.muted;
            if (!WWF.player.muted && WWF.Sound && WWF.Sound.unlock) {
                WWF.Sound.unlock();
            }
            WWF.showToast(WWF.player.muted ? '🔇 已关闭游戏音效' : '🔊 已开启游戏音效', 'info');
            WWF.updateHUD();
            WWF.saveProgress();
        };
        ['btnAudio', 'btnAudioMobile'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', toggleAudio);
        });

        // 移动端首次触摸/点击保底解锁 WebAudio
        document.addEventListener('pointerdown', () => {
            if (WWF.Sound && WWF.Sound.unlock) WWF.Sound.unlock();
        }, { passive: true });

        // 2. 渔获结算弹窗 4 个处置按钮
        const btnCatchSell = document.getElementById('btnCatchSell');
        if (btnCatchSell) btnCatchSell.addEventListener('click', handleCatchSell);
        const btnCatchAquarium = document.getElementById('btnCatchAquarium');
        if (btnCatchAquarium) btnCatchAquarium.addEventListener('click', handleCatchToAquarium);
        const btnCatchBasket = document.getElementById('btnCatchBasket');
        if (btnCatchBasket) btnCatchBasket.addEventListener('click', handleCatchToBasket);
        const btnCatchRelease = document.getElementById('btnCatchRelease');
        if (btnCatchRelease) btnCatchRelease.addEventListener('click', handleCatchRelease);

        // 3. 水族箱弹窗功能按钮与画布轻晃好奇/轻戳惊喜/点击喂食交互
        const aqCanvas = document.getElementById('aquariumCanvas');
        if (aqCanvas) {
            const getAqPos = (e) => {
                const rect = aqCanvas.getBoundingClientRect();
                const sx = rect.width > 0 ? aqVisual.cw / rect.width : 1;
                const sy = rect.height > 0 ? aqVisual.ch / rect.height : 1;
                return {
                    x: (e.clientX - rect.left) * sx,
                    y: (e.clientY - rect.top) * sy
                };
            };
            const findHitSwimmer = (px, py) => {
                const sortedByFront = aqVisual.swimmers.slice().sort((a, b) => (b.z || 0) - (a.z || 0));
                for (let i = 0; i < sortedByFront.length; i++) {
                    const s = sortedByFront[i];
                    const zVal = typeof s.z === 'number' ? s.z : 0;
                    const drawSize = s.size * (0.86 + (zVal + 1) * 0.11);
                    const d = Math.hypot(px - s.x, py - s.y);
                    if (d <= drawSize * 1.15) {
                        return s;
                    }
                }
                return null;
            };

            aqCanvas.addEventListener('pointermove', (e) => {
                const pos = getAqPos(e);
                const now = performance.now();
                const prevTs = aqVisual.pointer.lastTs || now;
                const pDt = Math.max(0.008, (now - prevTs) / 1000);
                if (aqVisual.pointer.active && aqVisual.pointer.lastTs > 0) {
                    const instVx = (pos.x - aqVisual.pointer.x) / pDt;
                    const instVy = (pos.y - aqVisual.pointer.y) / pDt;
                    aqVisual.pointer.vx = aqVisual.pointer.vx * 0.45 + instVx * 0.55;
                    aqVisual.pointer.vy = aqVisual.pointer.vy * 0.45 + instVy * 0.55;
                    aqVisual.pointer.speed = Math.hypot(aqVisual.pointer.vx, aqVisual.pointer.vy);
                } else {
                    aqVisual.pointer.vx = 0;
                    aqVisual.pointer.vy = 0;
                    aqVisual.pointer.speed = 0;
                }
                aqVisual.pointer.lastTs = now;
                aqVisual.pointer.active = true;
                aqVisual.pointer.x = pos.x;
                aqVisual.pointer.y = pos.y;
                aqCanvas.style.cursor = findHitSwimmer(pos.x, pos.y) ? 'pointer' : 'crosshair';
            });

            const clearAqPointer = () => {
                aqVisual.pointer.active = false;
                aqVisual.pointer.vx = 0;
                aqVisual.pointer.vy = 0;
                aqVisual.pointer.speed = 0;
                aqVisual.pointer.lastTs = 0;
                aqCanvas.style.cursor = '';
            };
            aqCanvas.addEventListener('pointerleave', clearAqPointer);
            aqCanvas.addEventListener('pointercancel', clearAqPointer);
            aqCanvas.addEventListener('pointerup', (e) => {
                if (e.pointerType !== 'mouse') {
                    aqVisual.pointer.active = false;
                }
            });

            aqCanvas.addEventListener('pointerdown', (e) => {
                if (WWF.Sound && WWF.Sound.unlock) WWF.Sound.unlock();
                const pos = getAqPos(e);
                if (e.pointerType === 'mouse') {
                    aqVisual.pointer.active = true;
                    aqVisual.pointer.x = pos.x;
                    aqVisual.pointer.y = pos.y;
                }
                const hitFish = findHitSwimmer(pos.x, pos.y);
                if (hitFish) {
                    let burstDir = Math.abs(pos.x - hitFish.x) > 4
                        ? (hitFish.x >= pos.x ? 1 : -1)
                        : -(hitFish.dir || 1);
                    // 靠近玻璃侧壁时自动朝水箱中央逃逸，避免迎头撞墙
                    if (hitFish.x < aqVisual.cw * 0.24) burstDir = 1;
                    else if (hitFish.x > aqVisual.cw * 0.76) burstDir = -1;

                    hitFish.dir = burstDir;
                    hitFish.turnLock = 0.88;
                    hitFish.pokeTimer = 1.0;
                    hitFish.aiState = 'startled';
                    hitFish.vx = burstDir * Math.max(Math.abs(hitFish.vx) * 0.8, hitFish.baseSpeed * 2.5);
                    if (hitFish.y < aqVisual.ch * 0.35) {
                        hitFish.vy = 18 + Math.random() * 18;
                    } else if (hitFish.y > aqVisual.ch * 0.65) {
                        hitFish.vy = -26 - Math.random() * 18;
                    } else {
                        hitFish.vy = -22 + (Math.random() - 0.5) * 28;
                    }
                    hitFish.bodyBendVel = clampNum((hitFish.bodyBendVel || 0) + burstDir * 2.2, -2.2, 2.2);
                    hitFish.squashX = 1.18;
                    hitFish.squashY = 0.84;

                    const m = getAquariumSwimMargins(hitFish.size, aqVisual.cw, aqVisual.ch);
                    const profile = getAquariumSwimProfile(hitFish.fish);
                    const wp = pickAquariumWaypoint(hitFish, profile, aqVisual.cw, m.minY, m.maxY, true, m);
                    hitFish.goalX = wp.goalX;
                    hitFish.goalY = wp.goalY;
                    hitFish.goalZ = wp.goalZ;

                    const isPuffer = Boolean(hitFish.fish && hitFish.fish.id === 'emerald_puffer');
                    if (isPuffer) {
                        hitFish.puffHoldTimer = 1.7;
                    }
                    spawnAquariumRipple(hitFish.x, hitFish.y, hitFish.size * 1.4, 'rgba(186, 230, 253, 0.5)');
                    spawnAquariumWakeBubble(
                        hitFish.x - burstDir * hitFish.size * 0.6,
                        hitFish.y,
                        -burstDir * 14,
                        -24,
                        1.8,
                        !!(hitFish.entry && hitFish.entry.isShiny)
                    );
                    spawnAquariumPokeParticles(
                        hitFish.x,
                        hitFish.y,
                        hitFish.size,
                        burstDir,
                        !!(hitFish.entry && hitFish.entry.isShiny),
                        isPuffer
                    );
                    if (WWF.Sound && WWF.Sound.playNibble) WWF.Sound.playNibble();
                } else {
                    spawnAquariumFood(pos.x, pos.y, 6, false);
                    if (WWF.Sound && WWF.Sound.playPlop) WWF.Sound.playPlop();
                }
            });
        }

        const btnFeedAquarium = document.getElementById('btnFeedAquarium');
        if (btnFeedAquarium) {
            btnFeedAquarium.addEventListener('click', () => {
                const p = WWF.player;
                if (!p.aquarium || p.aquarium.length === 0) {
                    WWF.showToast('⚠️ 水族箱中还没有观赏鱼，请先放入鱼儿再投喂！', 'warn');
                    return;
                }
                if (p.coins < 15) {
                    WWF.showToast('⚠️ 金币不足 15 🪙，无法购买高级营养鱼食！', 'warn');
                    return;
                }
                p.coins -= 15;
                p.aquarium.forEach(fish => {
                    fish.weightKg = +(Number(fish.weightKg) * 1.08).toFixed(2);
                    fish.value = Math.max(fish.value + 1, Math.round(Number(fish.value) * 1.08));
                });
                spawnAquariumFood(aqVisual.cw * 0.3, 24, 7, true);
                spawnAquariumFood(aqVisual.cw * 0.7, 24, 7, true);
                aqVisual.swimmers.forEach(s => {
                    aqVisual.hearts.push({
                        x: s.x,
                        y: s.y - s.size * 0.6,
                        vy: -24,
                        alpha: 1.0,
                        text: '❤️+8%'
                    });
                });
                if (WWF.Sound && WWF.Sound.playQTESuccess) WWF.Sound.playQTESuccess();
                WWF.showToast('🍞 已投放高级营养鱼食！水族箱全员体重与售价永久 +8%！', 'success');
                renderAquariumModalLists();
                WWF.updateHUD();
                WWF.saveProgress();
            });
        }

        const btnClaimAquarium = document.getElementById('btnClaimAquarium');
        if (btnClaimAquarium) {
            btnClaimAquarium.addEventListener('click', () => {
                const p = WWF.player;
                const claim = Math.floor(p.aquariumUnclaimedCoins || 0);
                if (claim <= 0) {
                    WWF.showToast('⏳ 门票金币仍在累积中，稍后再来领取吧！', 'info');
                    return;
                }
                p.coins += claim;
                p.aquariumUnclaimedCoins = Math.max(0, (p.aquariumUnclaimedCoins || 0) - claim);
                if (WWF.Sound && WWF.Sound.playCoin) WWF.Sound.playCoin();
                WWF.showToast(`🪙 成功领取水族箱观赏门票收益 +${claim} 金币！`, 'gold');
                renderAquariumModalLists();
                WWF.updateHUD();
                WWF.saveProgress();
            });
        }

        const btnUpgradeAquarium = document.getElementById('btnUpgradeAquarium');
        if (btnUpgradeAquarium) {
            btnUpgradeAquarium.addEventListener('click', () => {
                const p = WWF.player;
                const nextUpg = (WWF.AQUARIUM_UPGRADES || [])[p.aquariumLevel];
                if (!nextUpg) {
                    WWF.showToast('👑 水族箱已达最高等级！', 'info');
                    return;
                }
                if (p.coins < nextUpg.price) {
                    WWF.showToast(`⚠️ 金币不足 ${nextUpg.price} 🪙，无法扩建水族箱！`, 'warn');
                    return;
                }
                p.coins -= nextUpg.price;
                p.aquariumLevel = nextUpg.level;
                if (WWF.Sound && WWF.Sound.playQTESuccess) WWF.Sound.playQTESuccess();
                WWF.showToast(`🎉 水族箱已扩建至 Lv.${nextUpg.level}【${nextUpg.name}】（容量 ${nextUpg.capacity} 条，收益 ×${nextUpg.incomeMult}）！`, 'success');
                renderAquariumModalLists();
                WWF.updateHUD();
                WWF.saveProgress();
            });
        }

        const btnSellAllBasket = document.getElementById('btnSellAllBasket');
        if (btnSellAllBasket) {
            btnSellAllBasket.addEventListener('click', () => {
                const p = WWF.player;
                if (!p.basket || p.basket.length === 0) {
                    WWF.showToast('🧺 随身鱼篓目前是空的！', 'info');
                    return;
                }
                const count = p.basket.length;
                const totalCoins = p.basket.reduce((acc, f) => acc + (Number(f.value) || 0), 0);
                p.coins += totalCoins;
                p.basket = [];
                if (WWF.Sound && WWF.Sound.playCoin) WWF.Sound.playCoin();
                WWF.showToast(`🪙 一键售出鱼篓内 ${count} 条鱼获，共获得 +${totalCoins} 金币！`, 'gold');
                renderAquariumModalLists();
                WWF.updateHUD();
                WWF.saveProgress();
            });
        }

        // 4. 悬赏订单刷新 & 黄金鱼潮召唤按钮
        const btnRefreshOrders = document.getElementById('btnRefreshOrders');
        if (btnRefreshOrders) {
            btnRefreshOrders.addEventListener('click', () => {
                WWF.generateBountyOrders(false);
            });
        }

        const btnTriggerGoldenTide = document.getElementById('btnTriggerGoldenTide');
        if (btnTriggerGoldenTide) {
            btnTriggerGoldenTide.addEventListener('click', () => {
                const p = WWF.player;
                if (p.luckPoints >= 8) {
                    p.luckPoints -= 8;
                    WWF.showToast('🌊✨ 消耗 8 🍀 祈福幸运值，成功召唤 60 秒【黄金鱼潮】！', 'gold');
                } else if (p.coins >= 180) {
                    p.coins -= 180;
                    WWF.showToast('🌊✨ 消耗 180 🪙 金币，成功召唤 60 秒【黄金鱼潮】！', 'gold');
                } else {
                    WWF.showToast('⚠️ 祈福幸运值不足 8 🍀 且金币不足 180 🪙！放生鱼儿或完成订单可快速获取', 'warn');
                    return;
                }

                if (typeof WWF.startGoldenTide === 'function') {
                    WWF.startGoldenTide(60);
                } else if (WWF.game) {
                    WWF.game.goldenTideTimer = 60;
                }
                if (WWF.Sound && WWF.Sound.playCatch) WWF.Sound.playCatch('legendary');
                WWF.closeOrdersModal();
                WWF.updateHUD();
                WWF.saveProgress();
            });
        }

        // 5. 左下角/移动端导航条：移动按钮、乘船切换与四大生态快捷传送 (Pointer Events 多指隔离)
        const btnMoveLeftEl = document.getElementById('btnMoveLeft');
        const btnMoveRightEl = document.getElementById('btnMoveRight');
        const mobileBtnMoveLeftEl = document.getElementById('mobileBtnMoveLeft');
        const mobileBtnMoveRightEl = document.getElementById('mobileBtnMoveRight');
        const moveBtnEls = [btnMoveLeftEl, btnMoveRightEl, mobileBtnMoveLeftEl, mobileBtnMoveRightEl];

        const bindHoldMove = (el, prop, dirVal) => {
            if (!el) return;
            let activePointerId = null;
            const start = (e) => {
                if (e.button !== undefined && e.button !== 0) return;
                e.preventDefault();
                activePointerId = e.pointerId;
                try { el.setPointerCapture(e.pointerId); } catch (err) {}
                if (WWF.Sound && WWF.Sound.unlock) WWF.Sound.unlock();
                if (WWF.game) {
                    WWF.game[prop] = true;
                    if (dirVal) WWF.game.lastMoveDir = dirVal;
                }
                if (el.dataset) el.dataset.pressed = 'true';
            };
            const end = (e) => {
                if (activePointerId !== null && e.pointerId !== activePointerId) return;
                activePointerId = null;
                if (WWF.game) WWF.game[prop] = false;
                if (el.dataset) delete el.dataset.pressed;
            };
            el.addEventListener('pointerdown', start);
            el.addEventListener('pointerup', end);
            el.addEventListener('pointercancel', end);
        };
        bindHoldMove(btnMoveLeftEl, 'moveLeft', -1);
        bindHoldMove(mobileBtnMoveLeftEl, 'moveLeft', -1);
        bindHoldMove(btnMoveRightEl, 'moveRight', 1);
        bindHoldMove(mobileBtnMoveRightEl, 'moveRight', 1);

        ['btnToggleBoat', 'mobileBtnToggleBoat'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('click', () => {
                    if (typeof WWF.toggleBoat === 'function') {
                        WWF.toggleBoat();
                    }
                });
            }
        });

        document.querySelectorAll('.biome-jump-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.getAttribute('data-biome'));
                if (typeof WWF.jumpToBiome === 'function') {
                    WWF.jumpToBiome(idx);
                }
            });
        });

        // 6. QTE 跃水刺鱼横幅点击与主操作按钮/画布按住交互 (Pointer Events 精准释放)
        const qteBanner = document.getElementById('qteBanner');
        if (qteBanner) {
            qteBanner.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (typeof WWF.resolveJumpQTE === 'function') {
                    WWF.resolveJumpQTE();
                }
            });
        }

        const mainActionBtn = document.getElementById('mainActionBtn');
        const fishingCanvas = document.getElementById('fishingCanvas');
        const heldActionPointers = new Set();
        [
            [mainActionBtn, 'button'],
            [fishingCanvas, 'canvas']
        ].forEach(([el, source]) => {
            if (!el) return;
            el.addEventListener('pointerdown', (e) => {
                if (e.button !== undefined && e.button !== 0) return;
                e.preventDefault();
                // 静候咬钩时点击画布不加入 hold 集合，只水波反馈；QTE 期间另一手指点击画布触发刺鱼也不影响主按钮按住
                if (WWF.game && WWF.game.state === 'WAITING' && source === 'canvas') {
                    triggerGameplayPressStart('canvas');
                    return;
                }
                if (WWF.game && WWF.game.state === 'REELING' && WWF.game.qteActive && source === 'canvas' && heldActionPointers.size > 0) {
                    if (typeof WWF.resolveJumpQTE === 'function') WWF.resolveJumpQTE();
                    return;
                }
                heldActionPointers.add(e.pointerId);
                try { el.setPointerCapture(e.pointerId); } catch (err) {}
                triggerGameplayPressStart(source);
            });
            const releasePointer = (e) => {
                if (!heldActionPointers.has(e.pointerId)) return;
                heldActionPointers.delete(e.pointerId);
                if (heldActionPointers.size === 0 && WWF.game && WWF.game.isHolding) {
                    triggerGameplayPressEnd();
                }
            };
            el.addEventListener('pointerup', releasePointer);
            el.addEventListener('pointercancel', releasePointer);
        });

        const resetAllHoldStates = () => {
            heldActionPointers.clear();
            if (WWF.game) {
                WWF.game.moveLeft = false;
                WWF.game.moveRight = false;
                WWF.game.lastMoveDir = 0;
                if (WWF.game.isHolding) triggerGameplayPressEnd();
            }
            for (let i = 0; i < moveBtnEls.length; i++) {
                const el = moveBtnEls[i];
                if (el && el.dataset) delete el.dataset.pressed;
            }
        };
        window.addEventListener('blur', resetAllHoldStates);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) resetAllHoldStates();
        });

        // 7. 全局键盘监听
        window.addEventListener('keydown', (e) => {
            // Esc 关闭任意已打开弹窗
            if (e.code === 'Escape') {
                if (currentCatchResult) {
                    handleCatchSell();
                }
                WWF.closeAquariumModal();
                WWF.closeOrdersModal();
                WWF.closeBookModal();
                WWF.closeShopModal();
                return;
            }

            // 结算弹窗开启时按空格键默认立即出售并继续垂钓
            const catchModal = document.getElementById('catchModal');
            if (catchModal && !catchModal.classList.contains('hidden')) {
                if (e.code === 'Space') {
                    e.preventDefault();
                    handleCatchSell();
                }
                return;
            }

            if (isAnyPopupOpen()) return;

            // 左移 (A / ArrowLeft)
            if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
                if (e.code === 'ArrowLeft') e.preventDefault();
                if (e.repeat) return;
                if (WWF.game) {
                    WWF.game.moveLeft = true;
                    WWF.game.lastMoveDir = -1;
                }
                if (btnMoveLeftEl && btnMoveLeftEl.dataset) btnMoveLeftEl.dataset.pressed = 'true';
            }
            // 右移 (D / ArrowRight)
            else if (e.code === 'KeyD' || e.code === 'ArrowRight') {
                if (e.code === 'ArrowRight') e.preventDefault();
                if (e.repeat) return;
                if (WWF.game) {
                    WWF.game.moveRight = true;
                    WWF.game.lastMoveDir = 1;
                }
                if (btnMoveRightEl && btnMoveRightEl.dataset) btnMoveRightEl.dataset.pressed = 'true';
            }
            // 登船/上岸 (E)
            else if (e.code === 'KeyE' && !e.repeat) {
                if (typeof WWF.toggleBoat === 'function') WWF.toggleBoat();
            }
            // 跃水刺鱼 QTE (W / ArrowUp)
            else if ((e.code === 'KeyW' || e.code === 'ArrowUp') && !e.repeat) {
                if (WWF.game && WWF.game.state === 'REELING' && WWF.game.qteActive) {
                    e.preventDefault();
                    if (typeof WWF.resolveJumpQTE === 'function') WWF.resolveJumpQTE();
                }
            }
            // 蓄力抛竿/提竿/遛鱼 (Space)
            else if (e.code === 'Space') {
                e.preventDefault();
                if (!e.repeat) {
                    triggerGameplayPressStart();
                }
            }
            // 数字键 1~4 快速切换鱼饵
            else if (!e.repeat && ['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) {
                const idx = Number(e.code.replace('Digit', '')) - 1;
                const baits = WWF.BAITS || [];
                if (baits[idx]) {
                    WWF.selectBait(baits[idx].id);
                }
            }
        });

        window.addEventListener('keyup', (e) => {
            if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
                if (WWF.game) WWF.game.moveLeft = false;
                if (btnMoveLeftEl && btnMoveLeftEl.dataset) delete btnMoveLeftEl.dataset.pressed;
            } else if (e.code === 'KeyD' || e.code === 'ArrowRight') {
                if (WWF.game) WWF.game.moveRight = false;
                if (btnMoveRightEl && btnMoveRightEl.dataset) delete btnMoveRightEl.dataset.pressed;
            } else if (e.code === 'Space') {
                e.preventDefault();
                triggerGameplayPressEnd();
            }
        });

        window.addEventListener('resize', () => {
            if (typeof WWF.updateActionUI === 'function') WWF.updateActionUI();
            if (typeof WWF.updateHUD === 'function') WWF.updateHUD();
            if (aqVisual.isOpen) {
                resizeAquariumCanvas();
                WWF.renderAquariumCanvas();
            }
        });
    }

    // ------------------------------------------------------------------------
    // 启动入口与 requestAnimationFrame 主循环
    // ------------------------------------------------------------------------
    window.addEventListener('load', () => {
        WWF.loadProgress();
        if (typeof WWF.initScene === 'function') WWF.initScene();
        if (typeof WWF.resizeCanvas === 'function') WWF.resizeCanvas();
        bindAllUIEvents();
        WWF.renderBaitSelector();
        WWF.updateHUD();
        WWF.updateActionUI();

        let lastTime = 0;
        function gameLoop(now) {
            if (!lastTime) lastTime = now;
            const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
            lastTime = now;

            if (WWF.game) {
                WWF.game.time = (WWF.game.time || 0) + dt;
            }

            if (typeof WWF.updateSceneAndMovement === 'function') {
                WWF.updateSceneAndMovement(dt);
            }
            if (typeof WWF.updateGameplay === 'function') {
                WWF.updateGameplay(dt);
            }
            WWF.updateAquarium(dt);
            if (typeof WWF.renderScene === 'function') {
                WWF.renderScene();
            }

            requestAnimationFrame(gameLoop);
        }

        requestAnimationFrame(gameLoop);
    });

})();
