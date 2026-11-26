/**
 * ============================================================================
 * 《微风垂钓物语 2.0》模块 3：核心玩法、物理博弈与概率引擎 (js/gameplay_physics.js)
 * ============================================================================
 * 包含：
 * 1. 7 维动态加权概率引擎 (鱼饵 × 水深 × 海域生态 × 动态天气 × 黄金鱼潮 × 祈福幸运 × 保底机制)
 * 2. 闪光异色鱼 (Shiny) 判定与正态偏向体型/价值生成 (rollFish)
 * 3. 8 阶段垂钓状态机 (IDLE -> CHARGING -> CASTING -> WAITING -> BITING -> REELING -> LEAPING -> RESULT)
 * 4. 性格化遛鱼博弈 2.0 (稳健/冲刺跃水/沉底巨物/幻影变速 + 空中刺鱼 QTE)
 * 5. 破水飞鱼高抛物线过场演出 (LEAPING) 与画布钓鱼覆盖层渲染 (renderFishingOverlays)
 */
(function () {
    'use strict';

    const WWF = window.WWF = window.WWF || {};
    let lastGoldenTideSec = -1;
    let cachedGoldenTideTimeEl = null;

    // ------------------------------------------------------------------------
    // 1. 纯函数七维动态加权概率计算引擎 (可注入显式参数与随机源)
    // ------------------------------------------------------------------------
    WWF.computeProbabilityTable = function (params = {}) {
        const baits = WWF.BAITS || [];
        const species = WWF.FISH_SPECIES || [];
        const biomes = WWF.BIOMES || [];
        const weathers = WWF.WEATHERS || {};
        const boats = WWF.BOATS || [];

        const bait = baits.find(b => b.id === params.baitId) || baits[0] || {
            multipliers: { common: 1, rare: 1, epic: 1, legendary: 1, mythic: 1 }
        };

        const curBiome = (typeof params.biomeIndex === 'number')
            ? (biomes[params.biomeIndex] || (WWF.getCurrentBiome ? WWF.getCurrentBiome() : { index: 1, baseDepthBonus: 1, name: '微风木栈桥' }))
            : (WWF.getCurrentBiome ? WWF.getCurrentBiome() : { index: 1, baseDepthBonus: 1, name: '微风木栈桥' });
        const activeBiomeIdx = curBiome.index;

        const effectiveDepth = (typeof params.depthZone === 'number')
            ? params.depthZone
            : curBiome.baseDepthBonus;

        const curWeatherId = params.weatherId || 'sunny';
        const weather = weathers[curWeatherId] || weathers.sunny;

        const boatObj = boats.find(b => b.id === params.equippedBoat) || { luckBonus: 0 };
        const boatLuck = params.inBoat ? (boatObj.luckBonus || 0) : 0;

        // 祈福幸运值与保底计数对史诗及以上鱼种的增益
        const highTierLuckBoost = 1 + (params.luckPoints || 0) * 0.02 + (params.pityCounter || 0) * 0.055 + boatLuck;
        const goldenTideActive = Boolean(params.goldenTideActive);

        const weights = species.map(fish => {
            // (1) 基础权重 × (2) 鱼饵倍率
            let w = fish.baseWeight * (bait.multipliers[fish.rarity] || 1.0);

            // (3) 深度修正
            if (effectiveDepth === 0) {
                if (fish.prefDepth === 0) w *= 1.38;
                if (fish.prefDepth === 2) w *= 0.42;
            } else if (effectiveDepth === 1) {
                if (fish.prefDepth === 1) w *= 1.28;
                if (fish.prefDepth === 2) w *= 0.92;
            } else if (effectiveDepth >= 2) {
                if (fish.prefDepth === 0) w *= 0.48;
                if (fish.prefDepth === 2) w *= 1.75;
            }

            // (4) 海域生态亲和
            if (typeof fish.prefBiome === 'number') {
                const dist = Math.abs(fish.prefBiome - activeBiomeIdx);
                if (dist === 0) {
                    w *= 2.15;
                } else if (dist === 1) {
                    w *= 0.85;
                } else {
                    w *= 0.32;
                }
            }

            // (5) 动态天气倍率与天气专属鱼觉醒
            if (weather && weather.multipliers) {
                w *= (weather.multipliers[fish.rarity] || 1.0);
            }
            if (fish.prefWeather && fish.prefWeather !== 'any') {
                if (fish.prefWeather === curWeatherId) {
                    w *= 2.65;
                } else {
                    w *= 0.55;
                }
            }

            // (6) 黄金鱼潮狂欢加成
            if (goldenTideActive) {
                if (fish.rarity === 'epic' || fish.rarity === 'legendary' || fish.rarity === 'mythic') {
                    w *= 2.50;
                } else if (fish.rarity === 'common') {
                    w *= 0.45;
                }
            }

            // (7) 祈福幸运值与保底加成
            if (fish.rarity === 'epic' || fish.rarity === 'legendary' || fish.rarity === 'mythic') {
                w *= highTierLuckBoost;
            }

            return { fish, weight: Math.max(0.01, w) };
        });

        const total = weights.reduce((acc, item) => acc + item.weight, 0);
        return weights.map(item => ({
            fish: item.fish,
            weight: item.weight,
            prob: total > 0 ? item.weight / total : 0
        }));
    };

    WWF.calculateProbabilities = function (baitId, depthZone = null, biomeIndex = null, weatherId = null) {
        const player = WWF.player || {};
        const game = WWF.game || {};
        return WWF.computeProbabilityTable({
            baitId,
            depthZone,
            biomeIndex,
            weatherId: weatherId || player.weatherId || 'sunny',
            luckPoints: player.luckPoints || 0,
            pityCounter: player.pityCounter || 0,
            equippedBoat: player.equippedBoat || 'none',
            inBoat: Boolean(player.inBoat),
            goldenTideActive: (game.goldenTideTimer || 0) > 0
        });
    };

    // ------------------------------------------------------------------------
    // 2. 纯函数闪光异色鱼概率与可注入随机源抽鱼生成
    // ------------------------------------------------------------------------
    WWF.computeShinyChance = function (params = {}) {
        const eco = WWF.ECONOMY_CONSTANTS || {};
        const baseShiny = eco.SHINY_BASE_CHANCE || 0.02;
        const maxShiny = eco.SHINY_MAX_CHANCE || 0.40;
        const tideShinyMult = eco.SHINY_GOLDEN_TIDE_MULT || 1.8;

        const weathers = WWF.WEATHERS || {};
        const weather = weathers[params.weatherId || 'sunny'] || weathers.sunny || { shinyBoost: 1.0 };
        const boats = WWF.BOATS || [];
        const boatObj = boats.find(b => b.id === params.equippedBoat) || { luckBonus: 0 };
        const boatLuck = params.inBoat ? (boatObj.luckBonus || 0) : 0;

        let chance = baseShiny * (weather.shinyBoost || 1.0);
        chance += (params.luckPoints || 0) * 0.0035;
        chance += boatLuck * 0.15;
        if (params.goldenTideActive) chance *= tideShinyMult;

        return Math.min(maxShiny, Math.max(0.01, chance));
    };

    WWF.getShinyChance = function () {
        const player = WWF.player || {};
        const game = WWF.game || {};
        return WWF.computeShinyChance({
            weatherId: player.weatherId || 'sunny',
            luckPoints: player.luckPoints || 0,
            equippedBoat: player.equippedBoat || 'none',
            inBoat: Boolean(player.inBoat),
            goldenTideActive: (game.goldenTideTimer || 0) > 0
        });
    };

    WWF.rollFishWithRng = function (params = {}, rng = Math.random) {
        const rand = typeof rng === 'function' ? rng : Math.random;
        const table = WWF.computeProbabilityTable(params);

        let r = rand();
        let chosen = table[table.length - 1];
        for (const entry of table) {
            r -= entry.prob;
            if (r <= 0) {
                chosen = entry;
                break;
            }
        }

        const fish = chosen.fish;
        // 类正态分布体型 + 9% 鱼王暴击
        const sizeFactorRaw = (rand() + rand()) * 0.5 + (rand() < 0.09 ? 0.25 : 0);
        const sizeFactor = +Math.min(1, Math.max(0, sizeFactorRaw)).toFixed(4);
        const lengthCm = +(fish.minLen + (fish.maxLen - fish.minLen) * sizeFactor).toFixed(1);
        const weightKg = +(fish.minKg + (fish.maxKg - fish.minKg) * Math.pow(sizeFactor, 1.35)).toFixed(2);

        const isShiny = rand() < WWF.computeShinyChance(params);
        const shinyMult = isShiny ? 2.2 : 1.0;
        const tideMult = params.goldenTideActive ? 1.5 : 1.0;
        const value = Math.round(fish.baseValue * (0.85 + sizeFactor * 0.65) * shinyMult * tideMult);

        const biomes = WWF.BIOMES || [];
        const landingBiome = biomes[params.biomeIndex] || { index: 1, name: '微风木栈桥' };
        const uidSuffix = Math.floor(rand() * 9999);

        return {
            uid: `fish_${params.nowMs || Date.now()}_${uidSuffix}`,
            fish,
            prob: chosen.prob,
            lengthCm,
            weightKg,
            value,
            sizeFactor,
            isShiny,
            isGoldenTide: Boolean(params.goldenTideActive),
            biomeName: landingBiome.name,
            biomeIndex: landingBiome.index,
            ruleVersion: WWF.CATALOG_VERSION || '2.0.0'
        };
    };

    WWF.rollFish = function (baitId, depthZone, rng = Math.random) {
        const player = WWF.player;
        const game = WWF.game;
        const landingBiome = WWF.getBiomeAtX(game.targetBobberX || player.worldX);
        const rolled = WWF.rollFishWithRng({
            baitId,
            depthZone,
            biomeIndex: landingBiome.index,
            weatherId: player.weatherId || 'sunny',
            luckPoints: player.luckPoints || 0,
            pityCounter: player.pityCounter || 0,
            equippedBoat: player.equippedBoat || 'none',
            inBoat: Boolean(player.inBoat),
            goldenTideActive: (game.goldenTideTimer || 0) > 0,
            nowMs: Date.now()
        }, rng);

        // 更新保底计数
        if (rolled.fish.rarity === 'epic' || rolled.fish.rarity === 'legendary' || rolled.fish.rarity === 'mythic') {
            player.pityCounter = 0;
        } else {
            player.pityCounter = (player.pityCounter || 0) + 1;
        }

        return rolled;
    };

    // ------------------------------------------------------------------------
    // 3. 八阶段垂钓状态机控制函数
    // ------------------------------------------------------------------------
    WWF.startCharging = function () {
        const game = WWF.game;
        const player = WWF.player;
        if (game.state !== 'IDLE') return;
        if (WWF.Sound) WWF.Sound.unlock();

        // 若高级鱼饵用完，自动切回普通面团
        if (player.selectedBait !== 'dough' && (player.baits[player.selectedBait] || 0) <= 0) {
            player.selectedBait = 'dough';
            if (WWF.renderBaitSelector) WWF.renderBaitSelector();
            if (WWF.updateHUD) WWF.updateHUD();
            if (WWF.showToast) WWF.showToast('高级鱼饵已用尽，已自动切换为普通面团', 'info');
        }

        game.moveLeft = false;
        game.moveRight = false;
        game.state = 'CHARGING';
        game.pose = 'charge';
        game.chargePower = 0.08;
        game.chargeDir = 1;
        if (WWF.updateActionUI) WWF.updateActionUI();
    };

    /**
     * 统一计算蓄力抛竿的目标落点世界坐标与有效蓄力比例
     * 在窄屏手机上适度收敛可视抛投距离，确保人物与浮漂同屏可见
     */
    function computeCastTarget(tip, chargePower) {
        const game = WWF.game;
        const player = WWF.player;
        const rodList = WWF.ROD_UPGRADES || [{ maxDistBonus: 0 }];
        const rod = rodList[Math.min(rodList.length - 1, (player.rodLevel || 1) - 1)];
        const waterY = WWF.getWaterSurfaceY ? WWF.getWaterSurfaceY() : 210;
        const cw = WWF.cw || 960;
        const ch = WWF.ch || 420;

        const effectivePower = Math.min(1, chargePower * (0.86 + (rod.maxDistBonus || 0) * 0.45));
        const minThrow = cw < 580 ? 55 : 75;
        const rawMaxThrow = 340 + (rod.maxDistBonus || 0) * 260;
        const maxThrow = cw < 580 ? Math.min(rawMaxThrow, Math.max(165, cw * 0.56)) : rawMaxThrow;
        const throwDist = minThrow + (maxThrow - minThrow) * effectivePower;

        const dir = (game && game.facing) || 1;
        let targetX = tip.tipX + dir * throwDist;
        targetX = Math.max(50, Math.min(WWF.WORLD_WIDTH - 50, targetX));
        const targetY = waterY + 18 + effectivePower * (ch * 0.14);

        return { effectivePower, targetX, targetY };
    }

    function triggerHaptic(pattern) {
        try {
            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                navigator.vibrate(pattern);
            }
        } catch (e) {}
    }

    WWF.releaseCast = function () {
        const game = WWF.game;
        const player = WWF.player;
        if (game.state !== 'CHARGING') return;

        // 消耗 1 份鱼饵
        const activeBait = player.selectedBait;
        if (activeBait !== 'dough' && player.baits[activeBait] > 0) {
            player.baits[activeBait]--;
            if (WWF.saveProgress) WWF.saveProgress();
            if (WWF.renderBaitSelector) WWF.renderBaitSelector();
            if (WWF.updateHUD) WWF.updateHUD();
        }

        const tip = WWF.getRodTip ? WWF.getRodTip() : { tipX: player.worldX + 40, tipY: 180 };
        const { effectivePower, targetX, targetY } = computeCastTarget(tip, game.chargePower);

        game.castStartX = tip.tipX;
        game.castStartY = tip.tipY;
        game.targetBobberX = targetX;
        game.targetBobberY = targetY;

        // 综合蓄力远近与落点海域的基础深度判定深浅水区
        const landingBiome = WWF.getBiomeAtX(targetX);
        let rawZone = effectivePower < 0.36 ? 0 : (effectivePower < 0.70 ? 1 : 2);
        if (landingBiome.baseDepthBonus >= 2) {
            rawZone = Math.max(1, rawZone);
            if (effectivePower >= 0.48) rawZone = 2;
        } else if (landingBiome.baseDepthBonus === 1 && effectivePower >= 0.62) {
            rawZone = 2;
        }
        game.depthZone = rawZone;

        game.castProgress = 0;
        game.state = 'CASTING';
        game.pose = 'cast';
        if (WWF.Sound) WWF.Sound.playCast();
        if (WWF.updateActionUI) WWF.updateActionUI();
    };

    WWF.enterWaiting = function () {
        const game = WWF.game;
        const player = WWF.player;
        game.state = 'WAITING';
        game.pose = 'wait';
        game.bobberX = game.targetBobberX;
        game.bobberY = game.targetBobberY;
        game.bobberDip = 6;

        if (WWF.addRipple) WWF.addRipple(game.bobberX, game.bobberY, 34);
        if (WWF.addSplash) WWF.addSplash(game.bobberX, game.bobberY, 10, 0.9);
        if (WWF.Sound) WWF.Sound.playPlop();

        // 预先按落点海域与天气抽取本次上钩鱼
        game.hookedRoll = WWF.rollFish(player.selectedBait, game.depthZone);

        // 黄金鱼潮下咬钩更快
        const speedMult = game.goldenTideTimer > 0 ? 0.65 : 1.0;
        game.waitTimer = (2.0 + Math.random() * 2.6) * speedMult;
        game.nextNibbleTimer = 0.8 + Math.random() * 1.0;

        const f = game.hookedRoll.fish;
        const shadowLen = (f.rarity === 'mythic' || f.rarity === 'legendary')
            ? 32
            : (f.rarity === 'epic' ? 24 : 16);

        game.approachingFish = {
            x: game.bobberX + (Math.random() < 0.5 ? 110 : -110),
            y: game.bobberY + 24 + Math.random() * 18,
            size: shadowLen,
            alpha: 0,
            isShiny: game.hookedRoll.isShiny
        };

        if (WWF.updateActionUI) WWF.updateActionUI();
    };

    WWF.triggerBite = function () {
        const game = WWF.game;
        const isTouchLike = (WWF.cw && WWF.cw < 640) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
        game.state = 'BITING';
        game.pose = 'bite';
        game.biteTimer = isTouchLike ? 2.50 : 2.00;
        game.bobberDip = 15;
        game.screenShake = 4;

        if (WWF.addRipple) WWF.addRipple(game.bobberX, game.bobberY, 48, 'rgba(253, 224, 71, 0.95)');
        if (WWF.addSplash) WWF.addSplash(game.bobberX, game.bobberY, 16, 1.35);
        if (WWF.Sound) WWF.Sound.playBite();
        triggerHaptic([25, 35, 30]);
        if (WWF.updateActionUI) WWF.updateActionUI();
    };

    WWF.hookFishAndStartReel = function () {
        const game = WWF.game;
        if (game.state !== 'BITING') return;

        game.state = 'REELING';
        game.pose = 'reel';
        game.reelFishPos = 0.45 + Math.random() * 0.15;
        game.reelFishTarget = 0.5;
        game.reelFishTimer = 0.25;
        game.reelZonePos = 0.45;
        game.reelZoneVel = 0;
        game.reelProgress = 0.30;
        game.reelTension = 0.5;

        game.fishSkillState = 'normal';
        game.fishSkillTimer = 2.0 + Math.random() * 1.4;
        game.qteActive = false;
        game.qteTimer = 0;
        hideQTEBanner();

        const r = game.hookedRoll ? game.hookedRoll.fish.rarity : 'common';
        if (r === 'mythic' || r === 'legendary') {
            game.screenShake = 7;
        }

        if (WWF.addSplash) WWF.addSplash(game.bobberX, game.bobberY, 15, 1.25);
        if (WWF.updateActionUI) WWF.updateActionUI();
    };

    function showQTEBanner() {
        const el = document.getElementById('qteBanner');
        if (el) {
            el.classList.remove('hidden');
            el.classList.add('flex');
        }
    }

    function hideQTEBanner() {
        const el = document.getElementById('qteBanner');
        if (el) {
            el.classList.add('hidden');
            el.classList.remove('flex');
        }
    }

    WWF.triggerJumpQTE = function () {
        const game = WWF.game;
        if (game.state !== 'REELING' || game.qteActive) return;

        const isTouchLike = (WWF.cw && WWF.cw < 640) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
        const qteWindow = isTouchLike ? 1.95 : 1.55;
        game.qteActive = true;
        game.qteMaxTime = qteWindow;
        game.qteTimer = qteWindow;
        game.qteWorldX = game.bobberX;
        game.qteWorldY = game.bobberY - 48;
        game.screenShake = 5;

        showQTEBanner();
        if (WWF.addSplash) WWF.addSplash(game.bobberX, game.bobberY, 18, 1.5);
        if (WWF.addRipple) WWF.addRipple(game.bobberX, game.bobberY, 45, 'rgba(244, 63, 94, 0.9)');
        if (WWF.Sound) WWF.Sound.playQTEPrompt();
        if (WWF.updateActionUI) WWF.updateActionUI();
    };

    WWF.resolveJumpQTE = function () {
        const game = WWF.game;
        if (game.state !== 'REELING' || !game.qteActive) return false;

        game.qteActive = false;
        game.qteTimer = 0;
        hideQTEBanner();

        // 刺鱼成功奖励：收线进度直接 +18%，且大鱼进入 1.7 秒眩晕平缓期
        game.reelProgress = Math.min(1, game.reelProgress + 0.18);
        game.fishSkillState = 'stunned';
        game.fishSkillTimer = 1.7;
        game.screenShake = 6;

        if (WWF.Sound) WWF.Sound.playQTESuccess();
        triggerHaptic(22);
        if (WWF.addSplash) WWF.addSplash(game.bobberX, game.bobberY, 20, 1.6);
        if (WWF.showToast) WWF.showToast('⚡ 完美空中刺鱼！进度 +18% 并击晕大鱼！', 'success');
        if (WWF.updateActionUI) WWF.updateActionUI();

        if (game.reelProgress >= 1) {
            WWF.startLeapAnimation();
        }
        return true;
    };

    WWF.startLeapAnimation = function () {
        const game = WWF.game;
        const player = WWF.player;
        const waterY = WWF.getWaterSurfaceY ? WWF.getWaterSurfaceY() : 210;

        game.state = 'LEAPING';
        game.pose = 'celebrate';
        game.isHolding = false;
        game.qteActive = false;
        hideQTEBanner();

        game.leapProgress = 0;
        game.leapStartX = game.bobberX;
        game.leapStartY = game.bobberY;
        game.leapEndX = player.worldX + (game.facing || 1) * 16;
        game.leapEndY = waterY - 46;
        game.leapParticles = [];
        game.screenShake = 8;

        if (WWF.addSplash) WWF.addSplash(game.bobberX, game.bobberY, 26, 1.8);
        if (WWF.addRipple) WWF.addRipple(game.bobberX, game.bobberY, 55, 'rgba(253, 224, 71, 0.9)');
        if (WWF.Sound && game.hookedRoll) {
            WWF.Sound.playCatch(game.hookedRoll.fish.rarity);
        }
        if (WWF.updateActionUI) WWF.updateActionUI();
    };

    WWF.completeCatch = function () {
        const game = WWF.game;
        const player = WWF.player;
        const result = game.hookedRoll;
        if (!result) {
            game.state = 'IDLE';
            game.pose = 'idle';
            if (WWF.updateActionUI) WWF.updateActionUI();
            return;
        }

        game.state = 'RESULT';
        game.pose = 'celebrate';
        game.isHolding = false;
        game.approachingFish = null;
        hideQTEBanner();

        // 更新图鉴记录（含闪光计数），但金币/入箱/入篓/放生交由玩家在弹窗中自主选择！
        const fId = result.fish.id;
        const prev = player.records[fId];
        const isNewSpecies = !prev;
        const isNewRecord = Boolean(prev && (result.weightKg > prev.maxKg));

        if (!prev) {
            player.records[fId] = {
                count: 1,
                maxKg: result.weightKg,
                maxLen: result.lengthCm,
                shinyCount: result.isShiny ? 1 : 0
            };
        } else {
            prev.count += 1;
            if (result.weightKg > prev.maxKg) prev.maxKg = result.weightKg;
            if (result.lengthCm > prev.maxLen) prev.maxLen = result.lengthCm;
            if (result.isShiny) prev.shinyCount = (prev.shinyCount || 0) + 1;
        }

        if (WWF.saveProgress) WWF.saveProgress();
        if (WWF.updateHUD) WWF.updateHUD();
        if (WWF.updateActionUI) WWF.updateActionUI();
        if (WWF.openCatchModal) {
            WWF.openCatchModal(result, isNewSpecies, isNewRecord);
        }
    };

    WWF.cancelFishing = function (reasonMsg = null) {
        const game = WWF.game;
        game.state = 'IDLE';
        game.pose = 'idle';
        game.approachingFish = null;
        game.hookedRoll = null;
        game.isHolding = false;
        game.qteActive = false;
        hideQTEBanner();

        if (reasonMsg) {
            if (WWF.showToast) WWF.showToast(reasonMsg, 'warn');
            if (WWF.Sound) WWF.Sound.playEscape();
        }
        if (WWF.updateActionUI) WWF.updateActionUI();
    };

    WWF.startGoldenTide = function (duration = 60) {
        const game = WWF.game;
        game.goldenTideTimer = Math.max(game.goldenTideTimer, duration);
        lastGoldenTideSec = -1;
        const banner = document.getElementById('goldenTideBanner');
        if (banner) {
            banner.classList.remove('hidden');
            banner.classList.add('flex');
        }
        if (WWF.Sound) WWF.Sound.playCatch('legendary');
        if (WWF.updateHUD) WWF.updateHUD();
        if (WWF.showToast) {
            WWF.showToast('🌊✨ 黄金鱼潮已降临！60 秒内高稀有鱼权重 ×2.5，渔获收益 +50%！', 'success');
        }
    };

    // ------------------------------------------------------------------------
    // 4. 每帧物理与性格化遛鱼 AI 更新 (updateGameplay)
    // ------------------------------------------------------------------------
    WWF.updateGameplay = function (dt) {
        const game = WWF.game;
        const player = WWF.player;

        // 1. 动态天气自然轮换
        game.weatherTimer -= dt;
        if (game.weatherTimer <= 0) {
            game.weatherTimer = 110 + Math.random() * 60;
            const weatherKeys = Object.keys(WWF.WEATHERS);
            const nextW = weatherKeys[Math.floor(Math.random() * weatherKeys.length)];
            if (nextW !== player.weatherId) {
                player.weatherId = nextW;
                if (WWF.updateHUD) WWF.updateHUD();
                if (WWF.showToast) {
                    const wInfo = WWF.WEATHERS[nextW];
                    WWF.showToast(`${wInfo.icon} 天气变化：进入【${wInfo.name}】(${wInfo.desc})`, 'info');
                }
            }
        }

        // 2. 黄金鱼潮倒计时与随机自然触发
        if (game.goldenTideTimer > 0) {
            game.goldenTideTimer -= dt;
            const sec = Math.ceil(game.goldenTideTimer);
            if (sec !== lastGoldenTideSec) {
                lastGoldenTideSec = sec;
                const timeEl = cachedGoldenTideTimeEl || (cachedGoldenTideTimeEl = document.getElementById('goldenTideTime'));
                const nextStr = `${sec}s`;
                if (timeEl && timeEl.textContent !== nextStr) timeEl.textContent = nextStr;
            }
            if (game.goldenTideTimer <= 0) {
                game.goldenTideTimer = 0;
                lastGoldenTideSec = -1;
                const banner = document.getElementById('goldenTideBanner');
                if (banner) {
                    banner.classList.add('hidden');
                    banner.classList.remove('flex');
                }
                if (WWF.updateHUD) WWF.updateHUD();
                if (WWF.showToast) WWF.showToast('黄金鱼潮渐渐退去，海面恢复了平静', 'info');
            }
        } else {
            game.nextTideCooldown -= dt;
            if (game.nextTideCooldown <= 0) {
                game.nextTideCooldown = 140 + Math.random() * 80;
                if (Math.random() < 0.45) {
                    WWF.startGoldenTide(60);
                }
            }
        }

        // 浮漂垂直阻尼恢复
        game.bobberDip += (0 - game.bobberDip) * Math.min(1, dt * 7);

        // 3. 状态机分派
        if (game.state === 'CHARGING') {
            game.chargePower += game.chargeDir * dt * 0.92;
            if (game.chargePower >= 1) {
                game.chargePower = 1;
                game.chargeDir = -1;
            } else if (game.chargePower <= 0.08) {
                game.chargePower = 0.08;
                game.chargeDir = 1;
            }
        } else if (game.state === 'CASTING') {
            game.castProgress += dt * 2.1;
            if (game.castProgress >= 1) {
                game.castProgress = 1;
                WWF.enterWaiting();
            } else {
                const t = game.castProgress;
                game.bobberX = game.castStartX + (game.targetBobberX - game.castStartX) * t;
                const ch = WWF.ch || 420;
                const arcHeight = Math.sin(t * Math.PI) * Math.min(135, ch * 0.32);
                game.bobberY = game.castStartY + (game.targetBobberY - game.castStartY) * t - arcHeight;
            }
        } else if (game.state === 'WAITING') {
            if (game.approachingFish) {
                const af = game.approachingFish;
                af.alpha = Math.min(0.55, af.alpha + dt * 0.28);
                af.x += (game.bobberX - af.x) * dt * 0.9;
                af.y += (game.bobberY + 14 - af.y) * dt * 0.9;
            }

            game.nextNibbleTimer -= dt;
            if (game.nextNibbleTimer <= 0 && game.waitTimer > 0.45) {
                game.bobberDip = 5;
                if (WWF.addRipple) WWF.addRipple(game.bobberX, game.bobberY, 22);
                if (WWF.Sound) WWF.Sound.playNibble();
                game.nextNibbleTimer = 1.0 + Math.random() * 1.1;
            }

            game.waitTimer -= dt;
            if (game.waitTimer <= 0) {
                WWF.triggerBite();
            }
        } else if (game.state === 'BITING') {
            game.biteTimer -= dt;
            if (Math.random() < dt * 9 && WWF.addRipple) {
                WWF.addRipple(game.bobberX, game.bobberY, 30, 'rgba(253, 224, 71, 0.75)');
            }
            if (game.biteTimer <= 0) {
                WWF.cancelFishing('错过提竿时机，鱼儿吃掉鱼饵游走了…');
            }
        } else if (game.state === 'REELING') {
            updateReelingMinigame(dt);
        } else if (game.state === 'LEAPING') {
            game.leapProgress += dt * 1.25;
            const t = Math.min(1, game.leapProgress);
            const curX = game.leapStartX + (game.leapEndX - game.leapStartX) * t;
            const arcH = Math.sin(t * Math.PI) * 145;
            const curY = game.leapStartY + (game.leapEndY - game.leapStartY) * t - arcH;

            // 生成尾迹流光粒子
            const rInfo = game.hookedRoll ? WWF.RARITIES[game.hookedRoll.fish.rarity] : WWF.RARITIES.common;
            if (Math.random() < 0.85) {
                game.leapParticles.push({
                    x: curX + (Math.random() - 0.5) * 14,
                    y: curY + (Math.random() - 0.5) * 14,
                    vx: (Math.random() - 0.5) * 28,
                    vy: 15 + Math.random() * 25,
                    r: 2 + Math.random() * 3.5,
                    color: (game.hookedRoll && game.hookedRoll.isShiny) ? '#fde047' : rInfo.color,
                    life: 1.0
                });
            }
            for (let i = game.leapParticles.length - 1; i >= 0; i--) {
                const p = game.leapParticles[i];
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.life -= dt * 2.2;
                if (p.life <= 0) game.leapParticles.splice(i, 1);
            }

            if (game.leapProgress >= 1) {
                WWF.completeCatch();
            }
        }
    };

    function updateReelingMinigame(dt) {
        const game = WWF.game;
        const player = WWF.player;
        const fish = game.hookedRoll.fish;
        const rod = WWF.ROD_UPGRADES[Math.min(WWF.ROD_UPGRADES.length - 1, (player.rodLevel || 1) - 1)];
        const reel = WWF.REEL_UPGRADES[Math.min(WWF.REEL_UPGRADES.length - 1, (player.reelLevel || 1) - 1)];

        // 1. 跃水 QTE 倒计时
        if (game.qteActive) {
            game.qteTimer -= dt;
            if (game.qteTimer <= 0) {
                game.qteActive = false;
                hideQTEBanner();
                if (WWF. updateActionUI) WWF.updateActionUI();
            }
        }

        // 2. 鱼类性格化技能状态机 ('steady' | 'dasher' | 'sinker' | 'illusion')
        game.fishSkillTimer -= dt;
        if (game.fishSkillTimer <= 0) {
            if (game.fishSkillState !== 'normal') {
                // 技能结束恢复常态
                game.fishSkillState = 'normal';
                game.fishSkillTimer = 2.0 + Math.random() * 1.5;
            } else {
                // 触发该鱼种专属性格技能
                const st = fish.skillType || 'steady';
                if (st === 'dasher') {
                    game.fishSkillState = 'dash';
                    game.fishSkillTimer = 1.4;
                    game.reelFishTarget = game.reelFishPos < 0.5 ? 0.88 : 0.12;
                    if (!game.qteActive && Math.random() < 0.78) {
                        WWF.triggerJumpQTE();
                    }
                } else if (st === 'sinker') {
                    game.fishSkillState = 'sink';
                    game.fishSkillTimer = 1.8;
                    game.screenShake = 3.5;
                    if (!game.qteActive && Math.random() < 0.40) {
                        WWF.triggerJumpQTE();
                    }
                } else if (st === 'illusion') {
                    game.fishSkillState = 'illusion';
                    game.fishSkillTimer = 1.5;
                    if (!game.qteActive && Math.random() < 0.65) {
                        WWF.triggerJumpQTE();
                    }
                } else {
                    // steady 稳健型偶发跃水惊喜
                    game.fishSkillState = 'normal';
                    game.fishSkillTimer = 2.4;
                    if (!game.qteActive && Math.random() < 0.30) {
                        WWF.triggerJumpQTE();
                    }
                }
            }
        }

        // 3. 鱼的目标游动位置更新
        game.reelFishTimer -= dt;
        if (game.reelFishTimer <= 0) {
            if (game.fishSkillState === 'stunned') {
                game.reelFishTarget = game.reelFishPos;
                game.reelFishTimer = 0.4;
            } else {
                const erraticMult = game.fishSkillState === 'illusion' ? 1.35 : 1.0;
                const range = (0.28 + fish.erratic * 0.60) * erraticMult;
                let nextT = game.reelFishPos + (Math.random() * 2 - 1) * range;
                nextT = Math.max(0.06, Math.min(0.94, nextT));
                game.reelFishTarget = nextT;
                game.reelFishTimer = Math.max(0.28, 1.20 - fish.erratic * 0.68 + Math.random() * 0.40);
            }
        }

        let speedMult = 1.0;
        if (game.fishSkillState === 'stunned') speedMult = 0.18;
        else if (game.fishSkillState === 'dash') speedMult = 1.55;
        else if (game.fishSkillState === 'illusion') speedMult = 1.30;

        const fishSpeed = (0.52 + fish.speed * 1.40) * speedMult;
        const diff = game.reelFishTarget - game.reelFishPos;
        game.reelFishPos += Math.sign(diff) * Math.min(Math.abs(diff), fishSpeed * dt);

        // 4. 玩家绿条物理（当鱼处于 'sink' 沉底巨物状态时，水阻稍微变沉）
        const sinkDrag = game.fishSkillState === 'sink' ? 0.76 : 1.0;
        const accel = (game.isHolding ? 2.60 : -2.25) * sinkDrag;
        game.reelZoneVel += accel * dt;
        game.reelZoneVel *= Math.pow(0.08, dt);
        game.reelZonePos += game.reelZoneVel * dt;

        const halfZone = rod.zoneSize * 0.5;
        if (game.reelZonePos < halfZone) {
            game.reelZonePos = halfZone;
            game.reelZoneVel = Math.max(0, game.reelZoneVel * -0.2);
        } else if (game.reelZonePos > 1 - halfZone) {
            game.reelZonePos = 1 - halfZone;
            game.reelZoneVel = Math.min(0, game.reelZoneVel * -0.2);
        }

        // 5. 判定捕获区重合与收线进度
        const touchBonus = (WWF.cw && WWF.cw < 640) ? 0.032 : 0.026;
        const inZone = Math.abs(game.reelFishPos - game.reelZonePos) <= halfZone + touchBonus;
        game.inZone = inZone;

        // 播放棘轮收线音效
        if (WWF.Sound) {
            WWF.Sound.playReelTick(game.reelTension, inZone);
        }

        if (inZone) {
            const speedFactor = 1.10 - fish.difficulty * 0.32;
            game.reelProgress += reel.fillRate * speedFactor * dt;
            game.reelTension = Math.min(1, game.reelTension + dt * 2.0);

            // 把浮漂慢慢朝玩家拉近
            const pullTargetX = player.worldX + (game.facing || 1) * 75;
            game.bobberX += (pullTargetX - game.bobberX) * dt * 0.65;
            if (Math.random() < dt * 7) {
                if (WWF.addSplash) WWF.addSplash(game.bobberX, game.bobberY, 2, 0.75);
                if (WWF.addRipple) WWF.addRipple(game.bobberX, game.bobberY, 22);
            }
        } else {
            const drainMult = game.fishSkillState === 'stunned' ? 0.35 : 1.0;
            game.reelProgress -= reel.drainRate * (0.85 + fish.difficulty * 0.32) * drainMult * dt;
            game.reelTension = Math.max(0.25, game.reelTension - dt * 1.5);
        }

        if (game.reelProgress >= 1) {
            game.reelProgress = 1;
            WWF.startLeapAnimation();
        } else if (game.reelProgress <= 0) {
            game.reelProgress = 0;
            WWF.cancelFishing(`${fish.name} 拼命挣脱鱼线逃跑了！善用空中刺鱼 QTE 或升级钓具再战吧`);
        }
    }

    // ------------------------------------------------------------------------
    // 5. 画布钓鱼覆盖层渲染 (鱼线、浮漂、水下鱼影、飞鱼抛物线、QTE 与遛鱼面板)
    // ------------------------------------------------------------------------
    WWF.renderFishingOverlays = function (ctx, cw, ch, cameraX) {
        const game = WWF.game;
        const player = WWF.player;
        const tip = WWF.getRodTip ? WWF.getRodTip() : { tipX: player.worldX + 40, tipY: 180 };
        const tipScreenX = tip.tipX - cameraX;
        const tipScreenY = tip.tipY;

        // 1. 水下正在靠近浮漂的神秘目标鱼影
        if (game.approachingFish && (game.state === 'WAITING' || game.state === 'BITING')) {
            const af = game.approachingFish;
            const afScreenX = af.x - cameraX;
            const dir = game.bobberX >= af.x ? 1 : -1;
            const hookFish = game.hookedRoll && game.hookedRoll.fish;
            const fishId = hookFish ? hookFish.id : '';
            const tNow = game.time || 0;
            const wag = Math.sin(tNow * 8.5) * af.size * 0.14;
            const fillCol = af.isShiny
                ? `rgba(250, 204, 21, ${(af.alpha * 0.9).toFixed(2)})`
                : `rgba(2, 6, 23, ${af.alpha.toFixed(2)})`;

            ctx.save();
            ctx.translate(afScreenX, af.y);
            ctx.scale(dir, 1);
            if (af.isShiny) {
                ctx.shadowColor = '#fde047';
                ctx.shadowBlur = 12;
            }
            ctx.fillStyle = fillCol;

            if (fishId === 'loach' || fishId === 'thunder_eel' || fishId === 'dragon_koi' || fishId === 'astral_leviathan') {
                // 纤细蛇形摇尾水下剪影
                if (WWF.FishArt && typeof WWF.FishArt.buildSpinePoints === 'function' && typeof WWF.FishArt.drawCanvasSpineRibbon === 'function') {
                    const pts = WWF.FishArt.buildSpinePoints(
                        af.size * 0.95,
                        -af.size * 1.45,
                        8,
                        Math.sin(tNow * 4.2) * 0.14,
                        tNow * 9.5,
                        af.size * 0.16,
                        0.9
                    );
                    const widths = [
                        af.size * 0.16, af.size * 0.23, af.size * 0.24, af.size * 0.21,
                        af.size * 0.17, af.size * 0.13, af.size * 0.08, af.size * 0.04
                    ];
                    WWF.FishArt.drawCanvasSpineRibbon(ctx, pts, widths, fillCol);
                    const tailPt = pts[pts.length - 1];
                    ctx.beginPath();
                    ctx.moveTo(tailPt.x, tailPt.y);
                    ctx.lineTo(tailPt.x - af.size * 0.42, tailPt.y - af.size * 0.24 + wag * 0.6);
                    ctx.lineTo(tailPt.x - af.size * 0.42, tailPt.y + af.size * 0.24 + wag * 0.6);
                    ctx.closePath();
                    ctx.fill();
                } else {
                    ctx.beginPath();
                    ctx.ellipse(0, 0, af.size * 1.25, af.size * 0.22, 0, 0, Math.PI * 2);
                    ctx.fill();
                }
            } else if (fishId === 'emerald_puffer' || fishId === 'bluegill' || fishId === 'moonfish') {
                // 圆胖鱼影 / 新月高身鱼影
                const rx = af.size * (fishId === 'moonfish' ? 0.72 : 0.82);
                const ry = af.size * (fishId === 'moonfish' ? 0.78 : 0.62);
                ctx.beginPath();
                ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
                ctx.fill();

                if (fishId === 'moonfish') {
                    // 飘逸上下长月鳍剪影
                    ctx.beginPath();
                    ctx.moveTo(-rx * 0.2, -ry * 0.75);
                    ctx.quadraticCurveTo(-rx * 0.55, -ry * 1.65, -rx * 0.95, -ry * 1.15);
                    ctx.quadraticCurveTo(-rx * 0.45, -ry * 0.85, -rx * 0.5, -ry * 0.5);
                    ctx.closePath();
                    ctx.fill();
                    ctx.beginPath();
                    ctx.moveTo(-rx * 0.2, ry * 0.75);
                    ctx.quadraticCurveTo(-rx * 0.55, ry * 1.65, -rx * 0.95, ry * 1.15);
                    ctx.quadraticCurveTo(-rx * 0.45, ry * 0.85, -rx * 0.5, ry * 0.5);
                    ctx.closePath();
                    ctx.fill();
                }

                // 可爱摇摆小扇尾
                ctx.beginPath();
                ctx.moveTo(-rx * 0.82, 0);
                ctx.lineTo(-rx * 1.38, -af.size * 0.32 + wag * 0.8);
                ctx.lineTo(-rx * 1.38, af.size * 0.32 + wag * 0.8);
                ctx.closePath();
                ctx.fill();
            } else if (fishId === 'sunken_angler') {
                // 巨颅鮟鱇鱼影 + 前方幽微荧光点预览
                ctx.beginPath();
                ctx.ellipse(af.size * 0.08, 0, af.size * 0.9, af.size * 0.56, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.beginPath();
                ctx.moveTo(-af.size * 0.72, 0);
                ctx.lineTo(-af.size * 1.32, -af.size * 0.34 + wag * 0.75);
                ctx.lineTo(-af.size * 1.32, af.size * 0.34 + wag * 0.75);
                ctx.closePath();
                ctx.fill();

                // 额前钓竿与幽微生物荧光诱饵点
                const lurePulse = 0.62 + 0.38 * Math.sin(tNow * 5.2);
                const lureX = af.size * 1.18;
                const lureY = -af.size * 0.36 + Math.sin(tNow * 3.8) * 1.8;
                const glowR = Math.max(6, af.size * 0.46);
                ctx.strokeStyle = `rgba(103, 232, 249, ${(af.alpha * 0.55).toFixed(2)})`;
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.moveTo(af.size * 0.35, -af.size * 0.44);
                ctx.quadraticCurveTo(af.size * 0.95, -af.size * 0.78, lureX, lureY);
                ctx.stroke();

                const lureGrad = ctx.createRadialGradient(lureX, lureY, 0.5, lureX, lureY, glowR);
                lureGrad.addColorStop(0, `rgba(165, 243, 252, ${(af.alpha * 1.35 * lurePulse).toFixed(2)})`);
                lureGrad.addColorStop(0.45, `rgba(56, 189, 248, ${(af.alpha * 0.65 * lurePulse).toFixed(2)})`);
                lureGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');
                ctx.fillStyle = lureGrad;
                ctx.beginPath();
                ctx.arc(lureX, lureY, glowR, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = `rgba(224, 242, 254, ${Math.min(0.95, af.alpha * 1.5 * lurePulse).toFixed(2)})`;
                ctx.beginPath();
                ctx.arc(lureX, lureY, Math.max(1.8, af.size * 0.11), 0, Math.PI * 2);
                ctx.fill();
            } else {
                // 标准流线鱼影与动态摆尾
                ctx.beginPath();
                ctx.ellipse(0, 0, af.size, af.size * 0.38, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.beginPath();
                ctx.moveTo(-af.size * 0.85, 0);
                ctx.lineTo(-af.size * 1.42, -af.size * 0.36 + wag * 0.85);
                ctx.lineTo(-af.size * 1.42, af.size * 0.36 + wag * 0.85);
                ctx.closePath();
                ctx.fill();
            }
            ctx.restore();
        }

        // 2. 鱼线与浮漂渲染
        if (game.state === 'IDLE' || game.state === 'CHARGING' || game.state === 'RESULT') {
            const swingX = (game.state === 'IDLE' || game.state === 'RESULT')
                ? (game.idleBobberSwingX || 0)
                : (game.idleBobberSwingX || 0) * 0.35;
            const lineLen = 32;
            const bobX = tipScreenX + swingX;
            const bobY = tipScreenY + Math.sqrt(Math.max(144, lineLen * lineLen - swingX * swingX * 0.55));

            ctx.strokeStyle = 'rgba(241, 245, 249, 0.55)';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(tipScreenX, tipScreenY);
            ctx.quadraticCurveTo(tipScreenX + swingX * 0.35, (tipScreenY + bobY) * 0.5 + 2, bobX, bobY);
            ctx.stroke();

            ctx.save();
            ctx.translate(bobX, bobY + 2);
            ctx.rotate(Math.atan2(-swingX, lineLen) * 0.65);

            ctx.fillStyle = '#ef4444';
            ctx.beginPath();
            ctx.arc(0, 0, 4.5, Math.PI, 0);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(0, 0, 4.5, 0, Math.PI);
            ctx.fill();
            ctx.restore();
        } else if (game.state === 'LEAPING') {
            // 破水飞鱼高抛物线演出
            renderLeapingFishArc(ctx, cameraX);
        } else {
            const waveOffset = (game.state === 'WAITING' || game.state === 'BITING')
                ? Math.sin(game.time * 4.5) * 2.5 + game.bobberDip
                : 0;
            const bx = game.bobberX - cameraX;
            const by = game.bobberY + waveOffset;

            ctx.strokeStyle = game.state === 'REELING'
                ? (game.inZone ? 'rgba(110, 231, 183, 0.95)' : 'rgba(252, 165, 165, 0.92)')
                : 'rgba(241, 245, 249, 0.68)';
            ctx.lineWidth = game.state === 'REELING' ? 1.8 : 1.2;

            const sag = game.state === 'REELING' ? 4 : 24;
            ctx.beginPath();
            ctx.moveTo(tipScreenX, tipScreenY);
            ctx.quadraticCurveTo((tipScreenX + bx) * 0.5, (tipScreenY + by) * 0.5 + sag, bx, by);
            ctx.stroke();

            ctx.save();
            ctx.translate(bx, by);
            ctx.fillStyle = '#ef4444';
            ctx.beginPath();
            ctx.arc(0, -2, 6, Math.PI, 0);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(0, -2, 6, 0, Math.PI);
            ctx.fill();
            ctx.strokeStyle = '#fef08a';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, -8);
            ctx.lineTo(0, -14);
            ctx.stroke();
            ctx.restore();
        }

        // 3. 蓄力槽与落点准星预览
        if (game.state === 'CHARGING') {
            renderChargeGaugeAndPreview(ctx, cw, ch, cameraX, tip);
        }

        // 4. 咬钩金色感叹号
        if (game.state === 'BITING') {
            renderBiteAlert(ctx, cameraX);
        }

        // 5. 遛鱼阶段：跃水 QTE 飞鱼瞄准圈 + 遛鱼博弈 2.0 面板
        if (game.state === 'REELING') {
            if (game.qteActive) {
                renderJumpQTEOnCanvas(ctx, cameraX);
            }
            renderReelingMinigame(ctx, cw, ch);
        }

        // 6. 底部居中：2400px 四大海域实时缩略小地图 (Mini-Map Radar)
        renderBiomeMiniMap(ctx, cw, ch);
    };

    function renderBiomeMiniMap(ctx, cw, ch) {
        const player = WWF.player;
        const game = WWF.game;
        if (!player || !game || cw < 280) return;

        const isMobile = cw < 640;
        const mapW = isMobile ? Math.min(240, cw - 36) : Math.min(320, cw * 0.34);
        const mapH = isMobile ? 11 : 18;
        const mx = (cw - mapW) * 0.5;
        const my = ch - (isMobile ? 18 : 28);
        const worldW = WWF.WORLD_WIDTH || 2400;

        ctx.save();
        // 半透明磨砂底框
        ctx.fillStyle = 'rgba(15, 23, 42, 0.76)';
        ctx.beginPath();
        ctx.roundRect(mx - 6, my - 4, mapW + 12, mapH + 8, 10);
        ctx.fill();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // 四大生态区色带
        const biomeColors = [
            'rgba(16, 185, 129, 0.38)',
            'rgba(14, 165, 233, 0.38)',
            'rgba(6, 182, 212, 0.42)',
            'rgba(99, 102, 241, 0.45)'
        ];
        const segW = mapW / 4;
        for (let i = 0; i < 4; i++) {
            ctx.fillStyle = biomeColors[i];
            ctx.beginPath();
            ctx.roundRect(mx + i * segW + 1, my, segW - 2, mapH, 5);
            ctx.fill();
        }

        // 当前相机视野框
        const camRatio = Math.max(0, Math.min(1, (game.cameraX || 0) / worldW));
        const viewW = Math.min(mapW, (cw / worldW) * mapW);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(mx + camRatio * mapW, my, viewW, mapH);

        // 浮漂落点标记 (若已抛竿)
        if (game.state === 'WAITING' || game.state === 'BITING' || game.state === 'REELING') {
            const bobX = mx + Math.max(0, Math.min(1, game.bobberX / worldW)) * mapW;
            ctx.fillStyle = '#ef4444';
            ctx.beginPath();
            ctx.arc(bobX, my + mapH * 0.5, 3.2, 0, Math.PI * 2);
            ctx.fill();
        }

        // 玩家实时坐标标记 (轻量光晕圆替代 shadowBlur)
        const px = mx + Math.max(0, Math.min(1, (player.worldX || 760) / worldW)) * mapW;
        const py = my + mapH * 0.5;
        ctx.fillStyle = 'rgba(245, 158, 11, 0.35)';
        ctx.beginPath();
        ctx.arc(px, py, 7.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fde047';
        ctx.beginPath();
        ctx.arc(px, py, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function renderLeapingFishArc(ctx, cameraX) {
        const game = WWF.game;
        const roll = game.hookedRoll;
        if (!roll) return;

        const t = Math.min(1, game.leapProgress);
        const curWorldX = game.leapStartX + (game.leapEndX - game.leapStartX) * t;
        const arcH = Math.sin(t * Math.PI) * 145;
        const curY = game.leapStartY + (game.leapEndY - game.leapStartY) * t - arcH;
        const curScreenX = curWorldX - cameraX;

        // 绘制流光粒子尾迹
        for (const p of game.leapParticles) {
            ctx.save();
            ctx.globalAlpha = Math.max(0, p.life);
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(p.x - cameraX, p.y, p.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // 绘制破水品质光柱（传说/神话/闪光专属）
        const rInfo = WWF.RARITIES[roll.fish.rarity] || WWF.RARITIES.common;
        if (roll.fish.rarity === 'mythic' || roll.fish.rarity === 'legendary' || roll.isShiny) {
            const startScreenX = game.leapStartX - cameraX;
            const beamGrad = ctx.createLinearGradient(0, game.leapStartY - 180, 0, game.leapStartY + 20);
            beamGrad.addColorStop(0, 'rgba(255,255,255,0)');
            beamGrad.addColorStop(0.7, rInfo.color + '44');
            beamGrad.addColorStop(1, rInfo.color + 'AA');
            ctx.save();
            ctx.globalAlpha = Math.max(0, 1 - t * 0.9);
            ctx.fillStyle = beamGrad;
            ctx.fillRect(startScreenX - 24, game.leapStartY - 180, 48, 200);
            ctx.restore();
        }

        // 绘制旋转跃向空中的动态矢量鱼
        ctx.save();
        ctx.translate(curScreenX, curY);
        const rot = (0.5 - t) * 1.3 * (game.leapEndX < game.leapStartX ? -1 : 1);
        ctx.rotate(rot);
        const dir = game.leapEndX >= game.leapStartX ? 1 : -1;
        if (WWF.drawCanvasFish) {
            const leapBend = Math.sin((game.time || 0) * 18 + t * Math.PI * 2) * 0.38 + (0.5 - t) * 0.22;
            const leapSpeedRatio = 2.0 + Math.sin(t * Math.PI) * 0.75;
            const leapPuff = roll.fish.id === 'emerald_puffer' ? (0.65 + 0.35 * Math.sin(t * Math.PI)) : 0;
            WWF.drawCanvasFish(ctx, roll.fish, 0, 0, 24, dir, game.time * 2.2, roll.isShiny, {
                speedRatio: leapSpeedRatio,
                bodyBend: leapBend,
                puffFactor: leapPuff,
                pitch: 0,
                phaseOffset: t * 3.2
            });
        }
        ctx.restore();
    }

    function renderJumpQTEOnCanvas(ctx, cameraX) {
        const game = WWF.game;
        const roll = game.hookedRoll;
        if (!roll) return;

        const cw = WWF.cw || 960;
        const progress = 1 - (game.qteTimer / (game.qteMaxTime || 1.45));
        const jumpArc = Math.sin(progress * Math.PI) * 52;
        const qx = Math.max(46, Math.min(cw - 46, game.bobberX - cameraX));
        const qy = game.bobberY - 22 - jumpArc;

        ctx.save();
        // 跃出水面的大鱼
        if (WWF.drawCanvasFish) {
            const qteBend = Math.sin((game.time || 0) * 22) * 0.45;
            const qtePitch = Math.cos(progress * Math.PI) * 0.38;
            const qtePuff = roll.fish.id === 'emerald_puffer' ? 0.92 : 0;
            WWF.drawCanvasFish(ctx, roll.fish, qx, qy, 20, -1, game.time * 2, roll.isShiny, {
                speedRatio: 2.65,
                bodyBend: qteBend,
                puffFactor: qtePuff,
                pitch: qtePitch,
                phaseOffset: progress * 4.0
            });
        }

        // 收缩金色瞄准环
        const ringR = 20 + (1 - progress) * 24;
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 3;
        ctx.shadowColor = '#f43f5e';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(qx, qy, ringR, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px "Noto Sans SC", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(cw < 640 ? '⚡ 点击刺鱼!' : '⚡ 刺鱼 [W / ↑]', qx, qy - ringR - 8);
        ctx.restore();
    }

    function renderChargeGaugeAndPreview(ctx, cw, ch, cameraX, tip) {
        const game = WWF.game;
        const player = WWF.player;
        const waterY = WWF.getWaterSurfaceY ? WWF.getWaterSurfaceY() : 210;

        // 预测水面落点光环
        const { targetX: predWorldX, targetY: predY } = computeCastTarget(tip, game.chargePower);
        const predScreenX = predWorldX - cameraX;

        ctx.save();
        ctx.strokeStyle = game.chargePower >= 0.70 ? '#fbbf24' : '#38bdf8';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.ellipse(predScreenX, predY, 18, 7, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // 玩家头顶/侧上方蓄力条
        const barW = cw < 520 ? Math.min(235, cw - 36) : Math.min(220, cw * 0.44);
        const barH = 14;
        const playerScreenX = player.worldX - cameraX;
        const x = Math.max(16, Math.min(cw - barW - 16, playerScreenX - barW * 0.3));
        const y = Math.max(66, waterY - 102);

        ctx.save();
        ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
        ctx.beginPath();
        ctx.roundRect(x - 8, y - 24, barW + 16, barH + 34, 12);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        const landingBiome = WWF.getBiomeAtX(predWorldX);
        const zoneTxt = game.chargePower < 0.36 ? '浅水' : (game.chargePower < 0.70 ? '中水' : '深水 · 稀有加成!');
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 11px "Noto Sans SC", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`蓄力 ${Math.round(game.chargePower * 100)}% · ${landingBiome.name} (${zoneTxt})`, x, y - 8);

        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, 7);
        ctx.fill();

        const fillGrad = ctx.createLinearGradient(x, 0, x + barW, 0);
        fillGrad.addColorStop(0, '#38bdf8');
        fillGrad.addColorStop(0.55, '#34d399');
        fillGrad.addColorStop(1, '#fbbf24');
        ctx.fillStyle = fillGrad;
        ctx.beginPath();
        ctx.roundRect(x, y, Math.max(8, barW * game.chargePower), barH, 7);
        ctx.fill();
        ctx.restore();
    }

    function renderBiteAlert(ctx, cameraX) {
        const game = WWF.game;
        const bx = game.bobberX - cameraX;
        const by = game.bobberY - 46 + Math.sin(game.time * 24) * 4;

        ctx.save();
        ctx.fillStyle = '#f59e0b';
        ctx.shadowColor = 'rgba(251, 191, 36, 0.95)';
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.arc(bx, by, 22, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#fef3c7';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = '900 26px "Fredoka", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', bx, by + 1);

        // 移动端/视觉提示气泡：点击提竿
        const cw = WWF.cw || 960;
        const labelX = Math.max(54, Math.min(cw - 54, bx));
        const labelY = Math.max(24, by - 34);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.beginPath();
        ctx.roundRect(labelX - 42, labelY - 12, 84, 22, 11);
        ctx.fill();
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#fde68a';
        ctx.font = 'bold 11px "Noto Sans SC", sans-serif';
        ctx.fillText('点击提竿!', labelX, labelY);
        ctx.restore();
    }

    function renderReelingMinigame(ctx, cw, ch) {
        const game = WWF.game;
        const player = WWF.player;
        const rod = WWF.ROD_UPGRADES[Math.min(WWF.ROD_UPGRADES.length - 1, (player.rodLevel || 1) - 1)];
        const fish = game.hookedRoll.fish;
        const rarityInfo = WWF.RARITIES[fish.rarity] || WWF.RARITIES.common;

        const isNarrow = cw < 520;
        const panelW = Math.min(460, cw - 20);
        const panelH = isNarrow ? 88 : 96;
        const px = (cw - panelW) * 0.5;
        const py = isNarrow ? Math.max(72, ch * 0.22) : Math.max(54, ch * 0.13);

        ctx.save();
        ctx.fillStyle = 'rgba(15, 23, 42, 0.90)';
        ctx.beginPath();
        ctx.roundRect(px, py, panelW, panelH, 18);
        ctx.fill();
        ctx.strokeStyle = game.inZone ? 'rgba(52, 211, 153, 0.85)' : 'rgba(248, 113, 113, 0.78)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 左侧状态提示
        ctx.font = isNarrow ? 'bold 11px "Noto Sans SC", sans-serif' : 'bold 12px "Noto Sans SC", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = game.inZone ? '#6ee7b7' : '#fca5a5';
        const leftMsg = isNarrow
            ? (game.inZone ? '✨ 稳步收线中' : '⚠️ 按住右移/松开左滑')
            : (game.inZone ? '✨ 稳步收线中！保持绿条包裹小鱼' : '⚠️ 偏离捕获区！按住右移 / 松开左滑');
        ctx.fillText(leftMsg, px + 14, py + 21);

        // 右上角显示鱼的实时性格技能标签与品级气息
        ctx.textAlign = 'right';
        let skillBadge = '🐟 游动博弈中';
        let skillColor = '#94a3b8';
        if (game.fishSkillState === 'stunned') {
            skillBadge = '💫 空中刺鱼击晕中!';
            skillColor = '#34d399';
        } else if (game.fishSkillState === 'dash') {
            skillBadge = '⚡ 猛烈冲刺跃水!';
            skillColor = '#f43f5e';
        } else if (game.fishSkillState === 'sink') {
            skillBadge = '⚓ 巨物沉底角力!';
            skillColor = '#fbbf24';
        } else if (game.fishSkillState === 'illusion') {
            skillBadge = '✨ 幻影迷踪变速!';
            skillColor = '#c084fc';
        } else if (fish.rarity === 'mythic' || fish.rarity === 'legendary') {
            skillBadge = '👑 传说巨物威压!';
            skillColor = rarityInfo.color;
        }
        ctx.fillStyle = skillColor;
        ctx.fillText(skillBadge, px + panelW - 16, py + 22);

        // 轨道 1：遛鱼博弈槽
        const trackX = px + 16;
        const trackY = py + 34;
        const trackW = panelW - 32;
        const trackH = 26;

        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.roundRect(trackX, trackY, trackW, trackH, 13);
        ctx.fill();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // 绿色捕获判定区
        const zoneW = trackW * rod.zoneSize;
        const zoneX = trackX + (game.reelZonePos - rod.zoneSize * 0.5) * trackW;
        ctx.fillStyle = game.inZone ? 'rgba(16, 185, 129, 0.74)' : 'rgba(52, 211, 153, 0.38)';
        ctx.beginPath();
        ctx.roundRect(zoneX, trackY + 2, zoneW, trackH - 4, 10);
        ctx.fill();
        ctx.strokeStyle = game.inZone ? '#a7f3d0' : '#34d399';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 游动的小鱼图标
        const fishX = trackX + game.reelFishPos * trackW;
        const fishY = trackY + trackH * 0.5;
        ctx.fillStyle = game.hookedRoll.isShiny ? '#fde047' : '#ffffff';
        ctx.beginPath();
        ctx.arc(fishX, fishY, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(game.hookedRoll.isShiny ? '✨' : '🐟', fishX, fishY + 1);

        // 轨道 2：收线完成总进度条
        const progY = py + 72;
        const progH = 11;
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.roundRect(trackX, progY, trackW, progH, 5.5);
        ctx.fill();

        const pGrad = ctx.createLinearGradient(trackX, 0, trackX + trackW, 0);
        pGrad.addColorStop(0, '#f59e0b');
        pGrad.addColorStop(0.5, '#38bdf8');
        pGrad.addColorStop(1, '#34d399');
        ctx.fillStyle = pGrad;
        ctx.beginPath();
        ctx.roundRect(trackX, progY, Math.max(6, trackW * game.reelProgress), progH, 5.5);
        ctx.fill();

        ctx.restore();
    }

})();
