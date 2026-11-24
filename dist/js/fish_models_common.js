/**
 * ============================================================================
 * 《微风垂钓物语 2.0》普通鱼群高精双模渲染库 (js/fish_models_common.js)
 * ============================================================================
 * 注册 4 种普通鱼模型到 window.WWF.FISH_MODELS：
 * - minnow  （溪流白条）：修长银青流线体、通透燕尾叉鳍、虹彩侧线反光、清秀单背鳍
 * - crucian （金背鲫鱼）：高背圆润蜂蜜金背、柔金渐隐鳞纹、流线长背鳍、轻盈透光扇鳍
 * - perch   （条纹河鲈）：深苔藓绿虎斑锥纹、羽化黑斑双背鳍、雕琢掠食颌、透光朱红下鳍
 * - loach   （花斑泥鳅）：水润S形柔韧圆筒体、渐细吻须、云纹水墨花斑、全身波浪游动
 */
(function () {
    'use strict';

    const WWF = window.WWF = window.WWF || {};
    WWF.FISH_MODELS = WWF.FISH_MODELS || {};

    const DEFAULT_ART = {
        clamp(v, min, max) {
            return v < min ? min : (v > max ? max : v);
        },
        shadeHex(hex) {
            return hex || '#94a3b8';
        },
        getPalette(fish, isSilhouette, isShiny) {
            if (isSilhouette) {
                return {
                    body: '#1b283b', bodyLight: '#283952', bodyDark: '#101928',
                    belly: '#152031', bellyWarm: '#223249',
                    fin: '#111b2a', finLight: '#213148', finDark: '#0b131f',
                    stroke: '#364a66', outline: '#364a66', finOutline: '#2a3b52',
                    highlight: 'rgba(148, 163, 184, 0.14)', rimLight: 'rgba(148, 163, 184, 0.16)',
                    shadow: 'rgba(9, 14, 24, 0.45)', glow: 'rgba(51, 65, 85, 0.25)',
                    iris: '#2a3a50'
                };
            }
            if (isShiny) {
                return {
                    body: '#f5b938', bodyLight: '#fef6d2', bodyDark: '#b45309',
                    belly: '#fbcfe8', bellyWarm: '#fff1f2',
                    fin: '#38bdf8', finLight: '#e0f2fe', finDark: '#0369a1',
                    stroke: 'rgba(120, 53, 15, 0.72)', outline: '#78350f', finOutline: '#075985',
                    highlight: 'rgba(255, 250, 230, 0.62)', rimLight: 'rgba(254, 249, 195, 0.72)',
                    shadow: 'rgba(120, 53, 15, 0.28)', glow: '#fde047',
                    iris: '#ec4899'
                };
            }
            const body = (fish && fish.bodyColor) || '#94a3b8';
            const belly = (fish && fish.bellyColor) || '#f8fafc';
            const fin = (fish && fish.finColor) || '#64748b';
            return {
                body, bodyLight: body, bodyDark: body,
                belly, bellyWarm: belly,
                fin, finLight: fin, finDark: fin,
                stroke: 'rgba(12, 22, 38, 0.56)', outline: '#1e293b', finOutline: '#334155',
                highlight: 'rgba(255, 255, 255, 0.38)', rimLight: 'rgba(224, 242, 254, 0.45)',
                shadow: 'rgba(10, 18, 34, 0.26)', glow: fin, iris: fin
            };
        },
        svgEye(cx, cy, r, isSilhouette) {
            if (isSilhouette) {
                return `<circle cx="${cx}" cy="${cy}" r="${(r * 0.88).toFixed(2)}" fill="#26354a" stroke="#3f5473" stroke-width="0.9"/>`;
            }
            return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#f1f5f9"/><circle cx="${cx + 0.8}" cy="${cy}" r="${r * 0.48}" fill="#090d16"/>`;
        },
        svgFinRays() { return ''; },
        svgScalePatch() { return ''; },
        svgShinyOverlay() { return ''; },
        drawCanvasEye(ctx, x, y, r, irisColor) {
            ctx.save();
            ctx.fillStyle = '#f1f5f9';
            ctx.beginPath();
            ctx.arc(x, y, Math.max(1.8, r), 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = irisColor || '#38bdf8';
            ctx.beginPath();
            ctx.arc(x + r * 0.14, y, Math.max(1, r * 0.65), 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#090d16';
            ctx.beginPath();
            ctx.arc(x + r * 0.18, y, Math.max(0.8, r * 0.4), 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    };

    let fallbackUidSeq = 0;

    function resolveSvgContext(ctxInfo, modelMotion) {
        const info = ctxInfo || {};
        const art = info.art || WWF.FishArt || DEFAULT_ART;
        const fish = info.fish || null;
        const isSilhouette = !!info.isSilhouette;
        const isShiny = !isSilhouette && !!info.isShiny;
        const uid = info.uid || `fm_common_${++fallbackUidSeq}`;
        const palette = info.palette || art.getPalette(fish, isSilhouette, isShiny);
        const motion = info.motion || modelMotion;
        return { fish, isSilhouette, isShiny, uid, palette, motion, art };
    }

    function resolveCanvasContext(size, time, opts, modelMotion) {
        const safeOpts = opts || {};
        const art = safeOpts.art || WWF.FishArt || DEFAULT_ART;
        const clamp = typeof art.clamp === 'function' ? art.clamp : DEFAULT_ART.clamp;
        const safeSize = clamp(Number.isFinite(size) ? size : 18, 4, 240);
        const safeTime = Number.isFinite(time) ? time : 0;
        const motion = safeOpts.motion || modelMotion;
        const isShiny = !!safeOpts.isShiny;
        const palette = safeOpts.palette || art.getPalette(safeOpts.fish || null, false, isShiny);
        const speedRatio = clamp(Number.isFinite(safeOpts.speedRatio) ? safeOpts.speedRatio : 1, 0.25, 4.0);
        const bodyBend = clamp(Number.isFinite(safeOpts.bodyBend) ? safeOpts.bodyBend : 0, -1.0, 1.0);
        const phaseOffset = Number.isFinite(safeOpts.phaseOffset) ? safeOpts.phaseOffset : 0;
        const wagPhase = Number.isFinite(safeOpts.wagPhase)
            ? safeOpts.wagPhase
            : safeTime * (motion.tailFreq || 8.5) * (0.72 + speedRatio * 0.42) + phaseOffset;
        const finPhase = Number.isFinite(safeOpts.finPhase)
            ? safeOpts.finPhase
            : safeTime * (motion.pectoralFreq || 5.5) * (0.78 + speedRatio * 0.34) + phaseOffset * 0.7;
        return { art, clamp, size: safeSize, time: safeTime, motion, isShiny, palette, speedRatio, bodyBend, wagPhase, finPhase, phaseOffset };
    }

    function computeSpine(art, headX, tailX, count, bodyBend, wagPhase, waveAmp, waveFreq) {
        if (art && typeof art.buildSpinePoints === 'function') {
            return art.buildSpinePoints(headX, tailX, count, bodyBend, wagPhase, waveAmp, waveFreq);
        }
        const n = Math.max(3, count);
        const pts = [];
        for (let i = 0; i < n; i++) {
            const t = i / (n - 1);
            const x = headX + (tailX - headX) * t;
            const arch = Math.sin(t * Math.PI) * bodyBend * Math.abs(tailX - headX) * 0.28;
            const wave = Math.sin(wagPhase - t * Math.PI * 2 * waveFreq) * waveAmp * (0.1 + t * 0.9);
            pts.push({ x, y: arch + wave });
        }
        return pts;
    }

    function buildEnvelope(art, points, topW, botW) {
        if (art && typeof art.buildAsymEnvelope === 'function') {
            return art.buildAsymEnvelope(points, topW, botW);
        }
        const n = points.length;
        const topPts = [];
        const botPts = [];
        for (let i = 0; i < n; i++) {
            const p = points[i];
            const prev = points[Math.max(0, i - 1)];
            const next = points[Math.min(n - 1, i + 1)];
            const dx = next.x - prev.x;
            const dy = next.y - prev.y;
            const len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len;
            const ny = dx / len;
            topPts.push({ x: p.x + nx * (topW[i] ?? 2), y: p.y + ny * (topW[i] ?? 2) });
            botPts.push({ x: p.x - nx * (botW[i] ?? 2), y: p.y - ny * (botW[i] ?? 2) });
        }
        return { topPts, botPts };
    }

    function traceEnvelope(art, ctx, points, topPts, botPts, noseExtend) {
        if (art && typeof art.traceEnvelopePath === 'function') {
            art.traceEnvelopePath(ctx, points, topPts, botPts, noseExtend);
            return;
        }
        const n = points.length;
        ctx.beginPath();
        ctx.moveTo(topPts[0].x, topPts[0].y);
        for (let i = 1; i < n - 1; i++) {
            ctx.quadraticCurveTo(topPts[i].x, topPts[i].y, (topPts[i].x + topPts[i + 1].x) * 0.5, (topPts[i].y + topPts[i + 1].y) * 0.5);
        }
        ctx.lineTo(topPts[n - 1].x, topPts[n - 1].y);
        ctx.lineTo(botPts[n - 1].x, botPts[n - 1].y);
        for (let i = n - 2; i > 0; i--) {
            ctx.quadraticCurveTo(botPts[i].x, botPts[i].y, (botPts[i].x + botPts[i - 1].x) * 0.5, (botPts[i].y + botPts[i - 1].y) * 0.5);
        }
        ctx.lineTo(botPts[0].x, botPts[0].y);
        ctx.quadraticCurveTo(points[0].x + noseExtend, points[0].y, topPts[0].x, topPts[0].y);
        ctx.closePath();
    }

    function drawRays(art, ctx, rays, strokeColor, lineWidth) {
        if (art && typeof art.drawCanvasFinRays === 'function') {
            art.drawCanvasFinRays(ctx, rays, strokeColor, lineWidth);
            return;
        }
        if (!Array.isArray(rays) || rays.length === 0) return;
        ctx.save();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = Math.max(0.6, lineWidth);
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i < rays.length; i++) {
            const r = rays[i];
            ctx.moveTo(r[0], r[1]);
            if (r.length >= 6) ctx.quadraticCurveTo(r[2], r[3], r[4], r[5]);
            else ctx.lineTo(r[2], r[3]);
        }
        ctx.stroke();
        ctx.restore();
    }

    // ========================================================================
    // 1. 溪流白条 (minnow) — 修长银青梭形 · 虹彩侧线反光 · 通透燕尾 · dart 泳姿
    // ========================================================================
    const MINNOW_MOTION = {
        swimStyle: 'dart',
        tailFreq: 13.5,
        tailAmp: 0.28,
        bodyFlex: 0.22,
        pectoralFreq: 8.2,
        turnAgility: 1.45,
        bobAmp: 2.8,
        tailPivot: '44px 60px'
    };

    const minnowModel = {
        motion: MINNOW_MOTION,

        buildSVGContent(ctxInfo) {
            const { isSilhouette, isShiny, uid, palette, art } = resolveSvgContext(ctxInfo, MINNOW_MOTION);
            const bodyPath = 'M 43,58 C 67,42 110,38 147,44 C 165,47 179,53 185,57 C 180,64 166,72 146,75 C 110,80 68,75 43,62 Z';
            const tailPath = 'M 46,58 C 34,45 21,34 12,29 C 19,43 24,54 28,60 C 24,66 19,77 12,91 C 21,86 34,75 46,62 Z';
            const dorsalPath = 'M 86,43 Q 99,21 117,22 Q 113,34 111,42 Z';
            const analPath = 'M 59,71 Q 63,86 77,86 Q 77,78 75,73 Z';
            const pelvicPath = 'M 95,75 Q 91,89 106,89 Q 108,81 107,75 Z';
            const pecPath = 'M 134,65 Q 123,64 114,72 Q 116,78 128,76 Q 134,71 134,65 Z';

            const dTop = isSilhouette ? palette.bodyDark : (isShiny ? palette.bodyLight : '#4a6988');
            const dMid = isSilhouette ? palette.body : (isShiny ? palette.body : '#9eb6ce');
            const dPearl = isSilhouette ? palette.body : (isShiny ? palette.belly : '#e6eef7');
            const belly = isSilhouette ? palette.belly : palette.bellyWarm;
            const finBase = isSilhouette ? palette.finDark : (isShiny ? palette.fin : '#7896b5');
            const finTip = isSilhouette ? palette.finLight : (isShiny ? palette.finLight : '#e0f2fe');
            const outline = isSilhouette ? palette.stroke : (isShiny ? palette.outline : '#334a63');
            const rayStroke = isShiny ? 'rgba(255,255,255,0.68)' : 'rgba(241,245,249,0.65)';

            return `
                <defs>
                    <linearGradient id="${uid}_body" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${dTop}"/>
                        <stop offset="28%" stop-color="${dMid}"/>
                        <stop offset="62%" stop-color="${dPearl}"/>
                        <stop offset="100%" stop-color="${belly}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_irid" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stop-color="${isShiny ? '#fef08a' : '#38bdf8'}" stop-opacity="0.06"/>
                        <stop offset="45%" stop-color="${isShiny ? '#f472b6' : '#7dd3fc'}" stop-opacity="0.46"/>
                        <stop offset="80%" stop-color="#e0f2fe" stop-opacity="0.34"/>
                        <stop offset="100%" stop-color="#ffffff" stop-opacity="0.06"/>
                    </linearGradient>
                    <linearGradient id="${uid}_fin" x1="0%" y1="100%" x2="0%" y2="0%">
                        <stop offset="0%" stop-color="${finBase}" stop-opacity="0.88"/>
                        <stop offset="100%" stop-color="${finTip}" stop-opacity="${isSilhouette ? 0.9 : 0.48}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_tail" x1="100%" y1="50%" x2="0%" y2="50%">
                        <stop offset="0%" stop-color="${finBase}" stop-opacity="0.92"/>
                        <stop offset="65%" stop-color="${finTip}" stop-opacity="${isSilhouette ? 0.92 : 0.68}"/>
                        <stop offset="100%" stop-color="${finTip}" stop-opacity="${isSilhouette ? 0.88 : 0.42}"/>
                    </linearGradient>
                    <clipPath id="${uid}_clip">
                        <path d="${bodyPath}"/>
                    </clipPath>
                </defs>

                <!-- 通透燕尾叉鳍 -->
                <g class="svg-fish-tail">
                    <path d="${tailPath}" fill="url(#${uid}_tail)" stroke="${outline}" stroke-width="1.2" stroke-linejoin="round"/>
                    ${!isSilhouette ? art.svgFinRays([
                        'M 42,58 Q 27,45 16,33',
                        'M 40,59 Q 29,52 22,49',
                        'M 40,61 Q 29,68 22,71',
                        'M 42,62 Q 27,75 16,87'
                    ], rayStroke, 0.72, 0.95) : ''}
                </g>

                <!-- 腹鳍与臀鳍 -->
                <path d="${analPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.05" stroke-linejoin="round"/>
                <path d="${pelvicPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.05" stroke-linejoin="round"/>

                <!-- 清秀单背鳍 -->
                <path d="${dorsalPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.15" stroke-linejoin="round"/>
                ${!isSilhouette ? art.svgFinRays([
                    'M 92,41 Q 96,31 101,25',
                    'M 99,41 Q 103,31 108,24',
                    'M 106,41 Q 109,32 113,26'
                ], rayStroke, 0.68, 0.9) : ''}

                <!-- 修长银青流线躯体 -->
                <path d="${bodyPath}" fill="url(#${uid}_body)" stroke="${outline}" stroke-width="1.45" stroke-linejoin="round"/>

                <!-- 虹彩银青侧线光带、背部柔光、腹部反光与金属鳃盖 -->
                ${!isSilhouette ? `
                    <g clip-path="url(#${uid}_clip)">
                        <path d="M 46,56 Q 108,43 166,54 L 166,64 Q 108,58 46,62 Z" fill="url(#${uid}_irid)"/>
                        <path d="M 52,46 Q 112,37 166,49" fill="none" stroke="rgba(255,255,255,0.62)" stroke-width="2.4" stroke-linecap="round"/>
                        <path d="M 56,58 Q 108,51 146,57" fill="none" stroke="rgba(255,255,255,0.72)" stroke-width="1.0" stroke-dasharray="3.2 4.4" stroke-linecap="round"/>
                        <path d="M 66,72 Q 114,77 158,68" fill="none" stroke="rgba(224,242,254,0.52)" stroke-width="2.0" stroke-linecap="round"/>
                        <ellipse cx="151" cy="64" rx="5.5" ry="3.2" fill="${isShiny ? 'rgba(244,114,182,0.22)' : 'rgba(244,114,182,0.14)'}"/>
                        <path d="M 145,46 Q 152,58 143,72" fill="none" stroke="${isShiny ? '#b45309' : 'rgba(51,74,99,0.56)'}" stroke-width="1.45" stroke-linecap="round"/>
                        <path d="M 147,48 Q 153.5,58 145,70" fill="none" stroke="rgba(255,255,255,0.52)" stroke-width="1.0" stroke-linecap="round"/>
                    </g>
                    <path d="M 184,57 Q 176,60 170,58" fill="none" stroke="${outline}" stroke-width="1.2" stroke-linecap="round"/>
                ` : ''}

                <!-- 灵动侧胸鳍（严格锚定关节根部） -->
                <g class="svg-fish-pec" style="transform-box: view-box; transform-origin: 134px 66px;">
                    <path d="${pecPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.0" stroke-linejoin="round" opacity="0.92"/>
                    ${!isSilhouette ? art.svgFinRays(['M 132,66 Q 123,68 117,72', 'M 132,68 Q 124,72 120,74'], rayStroke, 0.58, 0.85) : ''}
                </g>

                ${art.svgEye(164, 53, 4.9, isSilhouette, isShiny ? palette.iris : '#0ea5e9', { style: 'natural', uid })}
                ${art.svgShinyOverlay(isSilhouette, isShiny)}
            `;
        },

        drawCanvas(ctx, size, time, opts) {
            const { art, clamp, size: s, isShiny, palette, speedRatio, bodyBend, wagPhase, finPhase } =
                resolveCanvasContext(size, time, opts, MINNOW_MOTION);

            const rush = clamp(speedRatio, 0.4, 2.5);
            const spine = computeSpine(art, s * 1.06, -s * 0.94, 8, bodyBend, wagPhase, s * (0.045 + 0.025 * rush), 0.62);
            const topW = [s * 0.10, s * 0.25, s * 0.34, s * 0.35, s * 0.31, s * 0.24, s * 0.16, s * 0.09];
            const botW = [s * 0.10, s * 0.24, s * 0.33, s * 0.34, s * 0.29, s * 0.22, s * 0.15, s * 0.085];
            const { topPts, botPts } = buildEnvelope(art, spine, topW, botW);

            const tailBase = spine[spine.length - 1];
            const tailPrev = spine[spine.length - 2];
            const tailBaseAng = Math.atan2(tailPrev.y - tailBase.y, tailPrev.x - tailBase.x);
            const tailWag = Math.sin(wagPhase - 0.55) * (0.24 + rush * 0.05) + bodyBend * 0.40;
            const pecAng = Math.sin(finPhase) * 0.24;

            const dTop = isShiny ? palette.bodyLight : '#4a6988';
            const dMid = isShiny ? palette.body : '#9eb6ce';
            const dPearl = isShiny ? palette.belly : '#e6eef7';
            const finBase = isShiny ? palette.fin : '#7896b5';
            const finTip = isShiny ? palette.finLight : '#e0f2fe';
            const outline = isShiny ? palette.outline : '#334a63';

            // 1. 通透燕尾叉鳍
            ctx.save();
            ctx.translate(tailBase.x, tailBase.y);
            ctx.rotate(tailBaseAng + tailWag);
            const tailGrad = ctx.createLinearGradient(0, 0, -s * 0.52, 0);
            tailGrad.addColorStop(0, finBase);
            tailGrad.addColorStop(1, isShiny ? 'rgba(224,242,254,0.58)' : 'rgba(224,242,254,0.48)');
            ctx.fillStyle = tailGrad;
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.75, s * 0.04);
            ctx.beginPath();
            ctx.moveTo(s * 0.04, -s * 0.06);
            ctx.quadraticCurveTo(-s * 0.22, -s * 0.26, -s * 0.52, -s * 0.44);
            ctx.quadraticCurveTo(-s * 0.35, -s * 0.13, -s * 0.26, 0);
            ctx.quadraticCurveTo(-s * 0.35, s * 0.13, -s * 0.52, s * 0.44);
            ctx.quadraticCurveTo(-s * 0.22, s * 0.26, s * 0.04, s * 0.06);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            drawRays(art, ctx, [
                [-s * 0.04, -s * 0.03, -s * 0.26, -s * 0.21, -s * 0.44, -s * 0.36],
                [-s * 0.04, s * 0.03, -s * 0.26, s * 0.21, -s * 0.44, s * 0.36]
            ], 'rgba(255,255,255,0.56)', s * 0.032);
            ctx.restore();

            // 2. 臀鳍、腹鳍与清秀背鳍
            ctx.save();
            const finGrad = ctx.createLinearGradient(0, -s * 0.62, 0, s * 0.60);
            finGrad.addColorStop(0, finTip);
            finGrad.addColorStop(0.5, finBase);
            finGrad.addColorStop(1, finTip);
            ctx.fillStyle = finGrad;
            ctx.globalAlpha = 0.86;
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.65, s * 0.036);

            // 臀鳍
            ctx.beginPath();
            ctx.moveTo(botPts[5].x, botPts[5].y - s * 0.02);
            ctx.quadraticCurveTo(botPts[5].x - s * 0.05, botPts[5].y + s * 0.20, botPts[4].x - s * 0.02, botPts[4].y + s * 0.16);
            ctx.lineTo(botPts[4].x + s * 0.02, botPts[4].y - s * 0.01);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // 腹鳍
            ctx.beginPath();
            ctx.moveTo(botPts[3].x, botPts[3].y - s * 0.02);
            ctx.quadraticCurveTo(botPts[3].x - s * 0.08, botPts[3].y + s * 0.18, botPts[2].x - s * 0.05, botPts[2].y + s * 0.12);
            ctx.lineTo(botPts[2].x, botPts[2].y - s * 0.02);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // 背鳍
            ctx.beginPath();
            ctx.moveTo(topPts[4].x, topPts[4].y + s * 0.03);
            ctx.quadraticCurveTo(topPts[3].x - s * 0.02, topPts[3].y - s * 0.30, topPts[2].x + s * 0.05, topPts[2].y - s * 0.25);
            ctx.quadraticCurveTo(topPts[2].x, topPts[2].y - s * 0.06, topPts[2].x - s * 0.04, topPts[2].y + s * 0.03);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 3. 修长银青梭形躯干
            ctx.save();
            const bodyGrad = ctx.createLinearGradient(0, -s * 0.34, 0, s * 0.34);
            bodyGrad.addColorStop(0, dTop);
            bodyGrad.addColorStop(0.32, dMid);
            bodyGrad.addColorStop(0.68, dPearl);
            bodyGrad.addColorStop(1, palette.bellyWarm);
            traceEnvelope(art, ctx, spine, topPts, botPts, s * 0.07);
            ctx.fillStyle = bodyGrad;
            ctx.fill();
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.85, s * 0.045);
            ctx.stroke();

            ctx.clip();
            // 虹彩青银侧线与高光
            const iridGrad = ctx.createLinearGradient(-s * 0.7, 0, s * 0.8, 0);
            iridGrad.addColorStop(0, 'rgba(56,189,248,0.08)');
            iridGrad.addColorStop(0.5, isShiny ? 'rgba(244,114,182,0.42)' : 'rgba(56,189,248,0.38)');
            iridGrad.addColorStop(1, 'rgba(224,242,254,0.08)');
            ctx.strokeStyle = iridGrad;
            ctx.lineWidth = Math.max(1.5, s * 0.14);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(spine[6].x, spine[6].y - s * 0.02);
            ctx.quadraticCurveTo(spine[3].x, spine[3].y - s * 0.05, spine[1].x, spine[1].y);
            ctx.stroke();

            ctx.strokeStyle = 'rgba(255,255,255,0.68)';
            ctx.lineWidth = Math.max(0.8, s * 0.048);
            ctx.beginPath();
            ctx.moveTo(topPts[5].x, topPts[5].y + s * 0.04);
            ctx.quadraticCurveTo(topPts[3].x, topPts[3].y + s * 0.05, topPts[1].x, topPts[1].y + s * 0.04);
            ctx.stroke();

            // 鳃盖弧线
            ctx.strokeStyle = isShiny ? '#b45309' : 'rgba(51,74,99,0.58)';
            ctx.lineWidth = Math.max(0.75, s * 0.042);
            ctx.beginPath();
            ctx.arc(spine[1].x - s * 0.08, spine[1].y + s * 0.02, s * 0.18, -0.72, 0.88);
            ctx.stroke();
            ctx.restore();

            // 4. 灵动侧胸鳍
            ctx.save();
            ctx.translate(spine[2].x + s * 0.06, spine[2].y + botW[2] * 0.42);
            ctx.rotate(pecAng);
            ctx.fillStyle = finTip;
            ctx.globalAlpha = 0.85;
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.65, s * 0.036);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(-s * 0.16, s * 0.02, -s * 0.23, s * 0.12);
            ctx.quadraticCurveTo(-s * 0.11, s * 0.20, 0, 0);
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 5. 立体明眸
            const headAng = Math.atan2(spine[0].y - spine[1].y, spine[0].x - spine[1].x);
            art.drawCanvasEye(
                ctx,
                spine[0].x - Math.cos(headAng) * s * 0.25,
                spine[0].y - Math.sin(headAng) * s * 0.25 - s * 0.04,
                Math.max(1.85, s * 0.115),
                isShiny ? palette.iris : '#0ea5e9',
                { style: 'natural' }
            );
        }
    };

    // ========================================================================
    // 2. 金背鲫鱼 (crucian) — 蜂蜜金高背 · 流线长背鳍 · 柔金渐隐鳞纹 · glide 泳姿
    // ========================================================================
    const CRUCIAN_MOTION = {
        swimStyle: 'glide',
        tailFreq: 7.2,
        tailAmp: 0.22,
        bodyFlex: 0.14,
        pectoralFreq: 5.0,
        turnAgility: 0.85,
        bobAmp: 3.6,
        tailPivot: '48px 60px'
    };

    const crucianModel = {
        motion: CRUCIAN_MOTION,

        buildSVGContent(ctxInfo) {
            const { isSilhouette, isShiny, uid, palette, art } = resolveSvgContext(ctxInfo, CRUCIAN_MOTION);
            const bodyPath = 'M 46,57 C 63,31 98,23 134,30 C 158,35 174,47 181,59 C 175,74 154,88 124,90 C 89,92 61,81 46,64 Z';
            const tailPath = 'M 49,57 C 37,42 23,33 14,33 C 16,44 21,53 27,60 C 21,67 16,76 14,87 C 23,87 37,78 49,63 Z';
            // 鲫鱼长而舒展流畅的前高后弧长背鳍（消除梯形生硬感）
            const dorsalPath = 'M 63,38 C 72,22 92,15 117,15 C 125,15 128,19 126,30 C 105,28 83,32 63,38 Z';
            const analPath = 'M 56,77 Q 65,94 78,94 Q 80,86 76,81 Z';
            const pelvicPath = 'M 101,85 Q 104,100 118,98 Q 119,89 114,85 Z';
            const pecPath = 'M 135,70 C 127,66 114,70 111,79 C 116,86 128,83 136,75 Z';

            const dorsalGold = isSilhouette ? palette.bodyDark : (isShiny ? palette.bodyLight : '#94621d');
            const midAmber = isSilhouette ? palette.body : (isShiny ? palette.body : '#dfa94c');
            const honeyWarm = isSilhouette ? palette.body : (isShiny ? palette.belly : '#f5d896');
            const bellyCream = isSilhouette ? palette.belly : (isShiny ? palette.bellyWarm : '#fef8e2');
            const finBase = isSilhouette ? palette.finDark : (isShiny ? palette.fin : '#c88c32');
            const finEdge = isSilhouette ? palette.finLight : (isShiny ? palette.finLight : '#fae2a8');
            const outline = isSilhouette ? palette.stroke : (isShiny ? palette.outline : '#5c3c11');
            const rayStroke = isShiny ? 'rgba(255,255,255,0.62)' : 'rgba(254,249,219,0.64)';

            const scalePatchSvg = isSilhouette ? '' : art.svgScalePatch([
                { y: 41, xs: [76, 90, 104, 118, 132], alpha: 0.72 },
                { y: 50, xs: [68, 82, 96, 110, 124, 138], alpha: 0.92 },
                { y: 60, xs: [64, 78, 92, 106, 120, 134], alpha: 0.95 },
                { y: 70, xs: [73, 87, 101, 115, 129], alpha: 0.65 }
            ], {
                rx: 5.0,
                ry: 4.5,
                rimColor: isShiny ? 'rgba(255,255,255,0.52)' : 'rgba(255,250,232,0.44)',
                shadowColor: isShiny ? 'rgba(180,83,9,0.22)' : 'rgba(120,72,18,0.18)',
                rimWidth: 1.05,
                shWidth: 1.15
            });

            return `
                <defs>
                    <linearGradient id="${uid}_body" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${dorsalGold}"/>
                        <stop offset="36%" stop-color="${midAmber}"/>
                        <stop offset="72%" stop-color="${honeyWarm}"/>
                        <stop offset="100%" stop-color="${bellyCream}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_fin" x1="0%" y1="100%" x2="0%" y2="0%">
                        <stop offset="0%" stop-color="${finBase}" stop-opacity="0.90"/>
                        <stop offset="100%" stop-color="${finEdge}" stop-opacity="${isSilhouette ? 0.9 : 0.56}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_tail" x1="100%" y1="50%" x2="0%" y2="50%">
                        <stop offset="0%" stop-color="${finBase}" stop-opacity="0.92"/>
                        <stop offset="70%" stop-color="${finEdge}" stop-opacity="${isSilhouette ? 0.9 : 0.66}"/>
                        <stop offset="100%" stop-color="${finEdge}" stop-opacity="${isSilhouette ? 0.88 : 0.44}"/>
                    </linearGradient>
                    <clipPath id="${uid}_clip">
                        <path d="${bodyPath}"/>
                    </clipPath>
                </defs>

                <!-- 柔和透光尾鳍 -->
                <g class="svg-fish-tail">
                    <path d="${tailPath}" fill="url(#${uid}_tail)" stroke="${outline}" stroke-width="1.25" stroke-linejoin="round"/>
                    ${!isSilhouette ? art.svgFinRays([
                        'M 44,58 Q 29,46 18,38',
                        'M 42,59 Q 30,54 22,51',
                        'M 42,61 Q 30,66 22,69',
                        'M 44,62 Q 29,74 18,82'
                    ], rayStroke, 0.64, 0.95) : ''}
                </g>

                <!-- 臀鳍与腹鳍 -->
                <path d="${analPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.1" stroke-linejoin="round"/>
                <path d="${pelvicPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.1" stroke-linejoin="round"/>

                <!-- 流线弧形长背鳍 -->
                <path d="${dorsalPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.2" stroke-linejoin="round"/>
                ${!isSilhouette ? art.svgFinRays([
                    'M 72,34 Q 75,26 80,22',
                    'M 83,32 Q 86,23 91,18',
                    'M 94,30 Q 98,21 102,17',
                    'M 106,30 Q 109,21 113,17',
                    'M 117,29 Q 120,22 123,18'
                ], rayStroke, 0.65, 0.95) : ''}

                <!-- 丰腴圆润金背躯体 -->
                <path d="${bodyPath}" fill="url(#${uid}_body)" stroke="${outline}" stroke-width="1.5" stroke-linejoin="round"/>

                <!-- 渐隐金鳞网格、背部暖光、柔和鳃盖弧线 -->
                ${!isSilhouette ? `
                    <g clip-path="url(#${uid}_clip)">
                        <path d="M 60,39 Q 108,23 158,43" fill="none" stroke="rgba(255,251,235,0.50)" stroke-width="4.2" stroke-linecap="round"/>
                        ${scalePatchSvg}
                        <path d="M 52,61 Q 102,55 142,59" fill="none" stroke="${isShiny ? 'rgba(254,240,138,0.58)' : 'rgba(180,120,40,0.34)'}" stroke-width="1.2" stroke-linecap="round"/>
                        <ellipse cx="151" cy="67" rx="5.6" ry="3.8" fill="${isShiny ? 'rgba(244,114,182,0.28)' : 'rgba(249,115,22,0.18)'}"/>
                        <path d="M 143,43 Q 152,58 140,76" fill="none" stroke="${outline}" stroke-width="1.55" stroke-linecap="round" opacity="0.65"/>
                        <path d="M 145,45 Q 153.5,58 142.5,74" fill="none" stroke="rgba(255,251,235,0.52)" stroke-width="1.1" stroke-linecap="round"/>
                    </g>
                    <path d="M 180,60 Q 173,63 168,60" fill="none" stroke="${outline}" stroke-width="1.3" stroke-linecap="round"/>
                ` : ''}

                <!-- 轻盈透光扇形胸鳍 -->
                <g class="svg-fish-pec" style="transform-box: view-box; transform-origin: 135px 71px;">
                    <path d="${pecPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.05" stroke-linejoin="round" opacity="0.92"/>
                    ${!isSilhouette ? art.svgFinRays(['M 133,71 Q 123,73 115,77', 'M 132,73 Q 124,77 118,81'], rayStroke, 0.58, 0.85) : ''}
                </g>

                ${art.svgEye(161, 53, 5.2, isSilhouette, isShiny ? palette.iris : '#d97706', { style: 'natural', uid })}
                ${art.svgShinyOverlay(isSilhouette, isShiny)}
            `;
        },

        drawCanvas(ctx, size, time, opts) {
            const { art, clamp, size: s, isShiny, palette, speedRatio, bodyBend, wagPhase, finPhase } =
                resolveCanvasContext(size, time, opts, CRUCIAN_MOTION);

            const rush = clamp(speedRatio, 0.4, 2.4);
            const spine = computeSpine(art, s * 1.00, -s * 0.88, 8, bodyBend, wagPhase, s * (0.042 + 0.02 * rush), 0.52);
            const topW = [s * 0.13, s * 0.37, s * 0.53, s * 0.57, s * 0.52, s * 0.40, s * 0.24, s * 0.13];
            const botW = [s * 0.14, s * 0.35, s * 0.48, s * 0.53, s * 0.47, s * 0.36, s * 0.22, s * 0.12];
            const { topPts, botPts } = buildEnvelope(art, spine, topW, botW);

            const tailBase = spine[spine.length - 1];
            const tailPrev = spine[spine.length - 2];
            const tailBaseAng = Math.atan2(tailPrev.y - tailBase.y, tailPrev.x - tailBase.x);
            const tailWag = Math.sin(wagPhase - 0.5) * (0.21 + rush * 0.04) + bodyBend * 0.34;
            const pecAng = Math.sin(finPhase) * 0.22;

            const dorsalGold = isShiny ? palette.bodyLight : '#94621d';
            const midAmber = isShiny ? palette.body : '#dfa94c';
            const bellyCream = isShiny ? palette.bellyWarm : '#fef8e2';
            const finBase = isShiny ? palette.fin : '#c88c32';
            const finEdge = isShiny ? palette.finLight : '#fae2a8';
            const outline = isShiny ? palette.outline : '#5c3c11';

            // 1. 柔和扇圆尾鳍
            ctx.save();
            ctx.translate(tailBase.x, tailBase.y);
            ctx.rotate(tailBaseAng + tailWag);
            const tailGrad = ctx.createLinearGradient(0, 0, -s * 0.50, 0);
            tailGrad.addColorStop(0, finBase);
            tailGrad.addColorStop(1, isShiny ? 'rgba(224,242,254,0.62)' : 'rgba(250,226,168,0.56)');
            ctx.fillStyle = tailGrad;
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.8, s * 0.042);
            ctx.beginPath();
            ctx.moveTo(s * 0.04, -s * 0.08);
            ctx.quadraticCurveTo(-s * 0.20, -s * 0.36, -s * 0.48, -s * 0.38);
            ctx.quadraticCurveTo(-s * 0.46, -s * 0.16, -s * 0.31, 0);
            ctx.quadraticCurveTo(-s * 0.46, s * 0.16, -s * 0.48, s * 0.38);
            ctx.quadraticCurveTo(-s * 0.20, s * 0.36, s * 0.04, s * 0.08);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            drawRays(art, ctx, [
                [-s * 0.04, -s * 0.04, -s * 0.24, -s * 0.22, -s * 0.42, -s * 0.32],
                [-s * 0.04, s * 0.04, -s * 0.24, s * 0.22, -s * 0.42, s * 0.32]
            ], 'rgba(255,250,232,0.56)', s * 0.032);
            ctx.restore();

            // 2. 臀鳍、腹鳍与流线弧形长背鳍
            ctx.save();
            const finGrad = ctx.createLinearGradient(0, -s * 0.78, 0, s * 0.72);
            finGrad.addColorStop(0, finEdge);
            finGrad.addColorStop(0.5, finBase);
            finGrad.addColorStop(1, finEdge);
            ctx.fillStyle = finGrad;
            ctx.globalAlpha = 0.88;
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.75, s * 0.04);

            ctx.beginPath();
            ctx.moveTo(botPts[5].x, botPts[5].y - s * 0.02);
            ctx.quadraticCurveTo(botPts[5].x - s * 0.05, botPts[5].y + s * 0.22, botPts[4].x, botPts[4].y + s * 0.18);
            ctx.lineTo(botPts[4].x + s * 0.04, botPts[4].y - s * 0.02);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(botPts[3].x, botPts[3].y - s * 0.02);
            ctx.quadraticCurveTo(botPts[3].x - s * 0.06, botPts[3].y + s * 0.21, botPts[2].x - s * 0.02, botPts[2].y + s * 0.14);
            ctx.lineTo(botPts[2].x + s * 0.03, botPts[2].y - s * 0.02);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // 长弧背鳍
            ctx.beginPath();
            ctx.moveTo(topPts[5].x, topPts[5].y + s * 0.04);
            ctx.bezierCurveTo(topPts[4].x, topPts[4].y - s * 0.28, topPts[3].x + s * 0.04, topPts[3].y - s * 0.34, topPts[2].x + s * 0.04, topPts[2].y - s * 0.26);
            ctx.quadraticCurveTo(topPts[2].x + s * 0.06, topPts[2].y - s * 0.06, topPts[2].x, topPts[2].y + s * 0.04);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 3. 高背圆润金背躯体
            ctx.save();
            const bodyGrad = ctx.createLinearGradient(0, -s * 0.55, 0, s * 0.52);
            bodyGrad.addColorStop(0, dorsalGold);
            bodyGrad.addColorStop(0.42, midAmber);
            bodyGrad.addColorStop(1, bellyCream);
            traceEnvelope(art, ctx, spine, topPts, botPts, s * 0.07);
            ctx.fillStyle = bodyGrad;
            ctx.fill();
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.9, s * 0.048);
            ctx.stroke();

            ctx.clip();
            if (typeof art.drawCanvasScaleArcs === 'function') {
                art.drawCanvasScaleArcs(
                    ctx,
                    spine[3].x,
                    spine[3].y,
                    s * 0.72,
                    s * 0.68,
                    4,
                    5,
                    isShiny ? 'rgba(255,255,255,0.44)' : 'rgba(255,250,232,0.42)'
                );
            }
            ctx.strokeStyle = 'rgba(255,251,235,0.48)';
            ctx.lineWidth = Math.max(1.1, s * 0.09);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(topPts[5].x, topPts[5].y + s * 0.06);
            ctx.quadraticCurveTo(topPts[3].x, topPts[3].y + s * 0.08, topPts[1].x, topPts[1].y + s * 0.06);
            ctx.stroke();

            ctx.strokeStyle = isShiny ? '#b45309' : 'rgba(92,60,17,0.52)';
            ctx.lineWidth = Math.max(0.8, s * 0.045);
            ctx.beginPath();
            ctx.arc(spine[1].x - s * 0.12, spine[1].y + s * 0.03, s * 0.24, -0.78, 0.88);
            ctx.stroke();
            ctx.restore();

            // 4. 轻盈扇形胸鳍
            ctx.save();
            ctx.translate(spine[2].x + s * 0.02, spine[2].y + botW[2] * 0.44);
            ctx.rotate(pecAng);
            ctx.fillStyle = finEdge;
            ctx.globalAlpha = 0.86;
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.7, s * 0.038);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(-s * 0.18, -s * 0.04, -s * 0.25, s * 0.10);
            ctx.quadraticCurveTo(-s * 0.14, s * 0.22, 0, 0);
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 5. 立体眼睛
            const headAng = Math.atan2(spine[0].y - spine[1].y, spine[0].x - spine[1].x);
            art.drawCanvasEye(
                ctx,
                spine[0].x - Math.cos(headAng) * s * 0.25,
                spine[0].y - Math.sin(headAng) * s * 0.25 - s * 0.05,
                Math.max(1.9, s * 0.12),
                isShiny ? palette.iris : '#d97706',
                { style: 'natural' }
            );
        }
    };

    // ========================================================================
    // 3. 条纹河鲈 (perch) — 深苔藓虎斑锥纹 · 羽化黑斑双背鳍 · 朱红下鳍 · dart 泳姿
    // ========================================================================
    const PERCH_MOTION = {
        swimStyle: 'dart',
        tailFreq: 10.8,
        tailAmp: 0.25,
        bodyFlex: 0.19,
        pectoralFreq: 6.5,
        turnAgility: 1.25,
        bobAmp: 3.2,
        tailPivot: '44px 60px'
    };

    const perchModel = {
        motion: PERCH_MOTION,

        buildSVGContent(ctxInfo) {
            const { isSilhouette, isShiny, uid, palette, art } = resolveSvgContext(ctxInfo, PERCH_MOTION);
            // 雕琢自然掠食颌线的健美河鲈轮廓（摒弃锯齿三角缺口）
            const bodyPath = 'M 43,58 C 60,39 94,32 130,36 C 152,38 170,45 182,55 C 184,57 183,59 178,60 L 166,61 C 173,62 179,63 180,66 C 174,73 154,82 124,84 C 89,85 60,77 43,62 Z';
            const tailPath = 'M 46,58 C 34,43 21,33 13,31 C 17,44 22,54 26,60 C 22,66 17,76 13,89 C 21,87 34,77 46,62 Z';
            // 标志性帆状前刺背鳍（柔和棘刺边缘） + 后软背鳍
            const dorsal1Path = 'M 80,38 C 82,27 87,19 94,16 L 98,19 L 104,15 L 108,19 L 114,16 L 118,20 L 125,19 C 128,25 129,31 129,36 Z';
            const dorsal2Path = 'M 52,46 C 58,27 68,23 76,26 C 78,32 78,36 77,39 Z';
            const analPath = 'M 56,74 C 58,89 65,98 76,97 C 80,91 80,84 78,80 Z';
            const pelvicPath = 'M 105,83 C 107,96 116,104 126,100 C 129,94 129,87 127,82 Z';
            const pecPath = 'M 134,66 C 127,63 116,66 113,74 C 116,81 126,81 134,74 Z';

            const dorsalMoss = isSilhouette ? palette.bodyDark : (isShiny ? palette.bodyLight : '#325216');
            const flankOlive = isSilhouette ? palette.body : (isShiny ? palette.body : '#7fa432');
            const flankGold = isSilhouette ? palette.body : (isShiny ? palette.belly : '#c9d46a');
            const bellyCream = isSilhouette ? palette.belly : (isShiny ? palette.bellyWarm : '#f5f6db');
            const finBase = isSilhouette ? palette.finDark : (isShiny ? palette.fin : '#ea580c');
            const finTip = isSilhouette ? palette.finLight : (isShiny ? palette.finLight : '#fb7185');
            const d1Top = isSilhouette ? palette.finLight : (isShiny ? palette.finLight : '#9ab04c');
            const d1Bot = isSilhouette ? palette.finDark : (isShiny ? palette.finDark : '#48661d');
            const outline = isSilhouette ? palette.stroke : (isShiny ? palette.outline : '#233b0f');
            const rayStroke = isShiny ? 'rgba(255,255,255,0.62)' : 'rgba(254,226,198,0.62)';

            return `
                <defs>
                    <linearGradient id="${uid}_body" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${dorsalMoss}"/>
                        <stop offset="36%" stop-color="${flankOlive}"/>
                        <stop offset="70%" stop-color="${flankGold}"/>
                        <stop offset="100%" stop-color="${bellyCream}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_d1" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${d1Top}" stop-opacity="0.82"/>
                        <stop offset="100%" stop-color="${d1Bot}" stop-opacity="0.92"/>
                    </linearGradient>
                    <linearGradient id="${uid}_fin" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${finBase}" stop-opacity="0.88"/>
                        <stop offset="100%" stop-color="${finTip}" stop-opacity="${isSilhouette ? 0.9 : 0.72}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_tail" x1="100%" y1="50%" x2="0%" y2="50%">
                        <stop offset="0%" stop-color="${isSilhouette ? palette.fin : (isShiny ? palette.fin : '#849e38')}"/>
                        <stop offset="55%" stop-color="${finBase}" stop-opacity="0.92"/>
                        <stop offset="100%" stop-color="${finTip}" stop-opacity="${isSilhouette ? 0.88 : 0.68}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_bar" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${isShiny ? '#6d28d9' : '#182e0a'}" stop-opacity="0.68"/>
                        <stop offset="65%" stop-color="${isShiny ? '#9333ea' : '#244210'}" stop-opacity="0.46"/>
                        <stop offset="100%" stop-color="${isShiny ? '#9333ea' : '#244210'}" stop-opacity="0"/>
                    </linearGradient>
                    <radialGradient id="${uid}_blotch" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stop-color="#090d16" stop-opacity="0.95"/>
                        <stop offset="55%" stop-color="#111c0c" stop-opacity="0.72"/>
                        <stop offset="100%" stop-color="#1e3112" stop-opacity="0"/>
                    </radialGradient>
                    <clipPath id="${uid}_clip">
                        <path d="${bodyPath}"/>
                    </clipPath>
                </defs>

                <!-- 渐变朱红尾鳍 -->
                <g class="svg-fish-tail">
                    <path d="${tailPath}" fill="url(#${uid}_tail)" stroke="${outline}" stroke-width="1.25" stroke-linejoin="round"/>
                    ${!isSilhouette ? art.svgFinRays([
                        'M 42,58 Q 27,45 16,35',
                        'M 40,59 Q 29,54 22,50',
                        'M 40,61 Q 29,66 22,70',
                        'M 42,62 Q 27,75 16,85'
                    ], rayStroke, 0.62, 0.95) : ''}
                </g>

                <!-- 透光朱红臀鳍与腹鳍 -->
                <path d="${analPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.15" stroke-linejoin="round"/>
                <path d="${pelvicPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.15" stroke-linejoin="round"/>

                <!-- 后软背鳍 -->
                <path d="${dorsal2Path}" fill="url(#${uid}_d1)" stroke="${outline}" stroke-width="1.15" stroke-linejoin="round"/>
                ${!isSilhouette ? art.svgFinRays(['M 59,42 Q 62,33 65,28', 'M 66,40 Q 69,32 71,27', 'M 73,39 Q 74,33 75,28'], rayStroke, 0.55, 0.85) : ''}

                <!-- 帆状前刺背鳍（后端带羽化黑斑） -->
                <path d="${dorsal1Path}" fill="url(#${uid}_d1)" stroke="${outline}" stroke-width="1.2" stroke-linejoin="round"/>
                ${!isSilhouette ? `
                    ${art.svgFinRays([
                        'M 87,37 L 93,18',
                        'M 96,36 L 104,17',
                        'M 105,36 L 113,18',
                        'M 115,35 L 122,20'
                    ], 'rgba(255,255,255,0.48)', 0.6, 0.9)}
                    <ellipse cx="87.5" cy="30.5" rx="6.2" ry="5.6" fill="url(#${uid}_blotch)"/>
                ` : ''}

                <!-- 掠食躯体 -->
                <path d="${bodyPath}" fill="url(#${uid}_body)" stroke="${outline}" stroke-width="1.5" stroke-linejoin="round"/>

                <!-- 6 道深苔藓锥形虎斑、自然口腔颌线与金属鳃盖 -->
                ${!isSilhouette ? `
                    <g clip-path="url(#${uid}_clip)">
                        <path d="M 60,36 L 67,35 Q 68,54 63,72 Q 59,54 60,36 Z" fill="url(#${uid}_bar)"/>
                        <path d="M 74,33 L 83,32 Q 84,54 78,76 Q 73,54 74,33 Z" fill="url(#${uid}_bar)"/>
                        <path d="M 89,31 L 99,31 Q 100,56 93,78 Q 88,56 89,31 Z" fill="url(#${uid}_bar)"/>
                        <path d="M 104,32 L 114,33 Q 116,56 108,77 Q 102,55 104,32 Z" fill="url(#${uid}_bar)"/>
                        <path d="M 119,34 L 128,35 Q 130,55 123,74 Q 118,54 119,34 Z" fill="url(#${uid}_bar)"/>
                        <path d="M 133,36 L 141,38 Q 142,53 136,68 Q 132,52 133,36 Z" fill="url(#${uid}_bar)"/>
                        <path d="M 55,44 Q 108,33 158,47" fill="none" stroke="rgba(255,255,255,0.34)" stroke-width="3.2" stroke-linecap="round"/>
                        <path d="M 145,44 Q 152,54 139,60 Q 149,66 141,77" fill="none" stroke="${outline}" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" opacity="0.65"/>
                        <path d="M 146,47 Q 153,55 142,60" fill="none" stroke="rgba(255,255,255,0.38)" stroke-width="1.0" stroke-linecap="round"/>
                        <path d="M 181,58 Q 170,60 161,63" fill="none" stroke="#0f172a" stroke-width="1.9" stroke-linecap="round"/>
                        <path d="M 180,64 Q 169,64 162,64" fill="none" stroke="${outline}" stroke-width="1.15" stroke-linecap="round"/>
                    </g>
                ` : ''}

                <!-- 朱橙胸鳍 -->
                <g class="svg-fish-pec" style="transform-box: view-box; transform-origin: 134px 67px;">
                    <path d="${pecPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.05" stroke-linejoin="round" opacity="0.92"/>
                    ${!isSilhouette ? art.svgFinRays(['M 132,68 Q 124,70 118,73', 'M 131,71 Q 124,74 120,76'], rayStroke, 0.58, 0.85) : ''}
                </g>

                ${art.svgEye(159, 50, 5.1, isSilhouette, isShiny ? palette.iris : '#f59e0b', { style: 'fierce', uid, browColor: isShiny ? '#78350f' : '#223a0f' })}
                ${art.svgShinyOverlay(isSilhouette, isShiny)}
            `;
        },

        drawCanvas(ctx, size, time, opts) {
            const { art, clamp, size: s, isShiny, palette, speedRatio, bodyBend, wagPhase, finPhase } =
                resolveCanvasContext(size, time, opts, PERCH_MOTION);

            const rush = clamp(speedRatio, 0.4, 2.5);
            const spine = computeSpine(art, s * 1.02, -s * 0.88, 8, bodyBend, wagPhase, s * (0.045 + 0.022 * rush), 0.58);
            const topW = [s * 0.12, s * 0.31, s * 0.44, s * 0.47, s * 0.43, s * 0.33, s * 0.21, s * 0.12];
            const botW = [s * 0.13, s * 0.30, s * 0.42, s * 0.45, s * 0.40, s * 0.30, s * 0.19, s * 0.11];
            const { topPts, botPts } = buildEnvelope(art, spine, topW, botW);

            const tailBase = spine[spine.length - 1];
            const tailPrev = spine[spine.length - 2];
            const tailBaseAng = Math.atan2(tailPrev.y - tailBase.y, tailPrev.x - tailBase.x);
            const tailWag = Math.sin(wagPhase - 0.5) * (0.24 + rush * 0.05) + bodyBend * 0.38;
            const pecAng = Math.sin(finPhase) * 0.24;

            const dorsalMoss = isShiny ? palette.bodyLight : '#325216';
            const flankOlive = isShiny ? palette.body : '#7fa432';
            const flankGold = isShiny ? palette.belly : '#c9d46a';
            const bellyCream = isShiny ? palette.bellyWarm : '#f5f6db';
            const finBase = isShiny ? palette.fin : '#ea580c';
            const finTip = isShiny ? palette.finLight : '#fb7185';
            const dTop = isShiny ? palette.finLight : '#9ab04c';
            const dBot = isShiny ? palette.finDark : '#48661d';
            const outline = isShiny ? palette.outline : '#233b0f';

            // 1. 渐变朱红尾鳍
            ctx.save();
            ctx.translate(tailBase.x, tailBase.y);
            ctx.rotate(tailBaseAng + tailWag);
            const tailGrad = ctx.createLinearGradient(0, 0, -s * 0.50, 0);
            tailGrad.addColorStop(0, isShiny ? palette.fin : '#849e38');
            tailGrad.addColorStop(0.55, finBase);
            tailGrad.addColorStop(1, finTip);
            ctx.fillStyle = tailGrad;
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.8, s * 0.042);
            ctx.beginPath();
            ctx.moveTo(s * 0.04, -s * 0.08);
            ctx.quadraticCurveTo(-s * 0.22, -s * 0.30, -s * 0.48, -s * 0.42);
            ctx.quadraticCurveTo(-s * 0.36, -s * 0.13, -s * 0.27, 0);
            ctx.quadraticCurveTo(-s * 0.36, s * 0.13, -s * 0.48, s * 0.42);
            ctx.quadraticCurveTo(-s * 0.22, s * 0.30, s * 0.04, s * 0.08);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 2. 臀鳍与腹鳍
            ctx.save();
            const vGrad = ctx.createLinearGradient(0, 0, 0, s * 0.72);
            vGrad.addColorStop(0, finBase);
            vGrad.addColorStop(1, finTip);
            ctx.fillStyle = vGrad;
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.75, s * 0.04);

            ctx.beginPath();
            ctx.moveTo(botPts[5].x, botPts[5].y - s * 0.02);
            ctx.quadraticCurveTo(botPts[5].x - s * 0.04, botPts[5].y + s * 0.26, botPts[4].x + s * 0.02, botPts[4].y + s * 0.22);
            ctx.lineTo(botPts[4].x + s * 0.06, botPts[4].y - s * 0.02);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(botPts[3].x - s * 0.02, botPts[3].y - s * 0.02);
            ctx.quadraticCurveTo(botPts[3].x - s * 0.02, botPts[3].y + s * 0.28, botPts[2].x - s * 0.04, botPts[2].y + s * 0.22);
            ctx.lineTo(botPts[2].x + s * 0.04, botPts[2].y - s * 0.02);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 3. 双背鳍（后软 + 前棘刺带羽化黑斑）
            ctx.save();
            const dGrad = ctx.createLinearGradient(0, -s * 0.78, 0, -s * 0.3);
            dGrad.addColorStop(0, dTop);
            dGrad.addColorStop(1, dBot);
            ctx.fillStyle = dGrad;
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.75, s * 0.04);

            ctx.beginPath();
            ctx.moveTo(topPts[6].x, topPts[6].y + s * 0.03);
            ctx.quadraticCurveTo(topPts[5].x - s * 0.03, topPts[5].y - s * 0.26, topPts[4].x - s * 0.08, topPts[4].y - s * 0.22);
            ctx.lineTo(topPts[4].x - s * 0.06, topPts[4].y + s * 0.03);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(topPts[4].x - s * 0.02, topPts[4].y + s * 0.03);
            ctx.lineTo(topPts[4].x + s * 0.04, topPts[4].y - s * 0.24);
            ctx.lineTo(topPts[3].x - s * 0.04, topPts[3].y - s * 0.30);
            ctx.lineTo(topPts[3].x + s * 0.04, topPts[3].y - s * 0.25);
            ctx.lineTo(topPts[2].x - s * 0.06, topPts[2].y - s * 0.30);
            ctx.lineTo(topPts[2].x + s * 0.04, topPts[2].y - s * 0.22);
            ctx.lineTo(topPts[2].x + s * 0.08, topPts[2].y + s * 0.03);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // 羽化黑斑（非黄色圆环）
            const bx = (topPts[4].x + topPts[3].x) * 0.5;
            const by = (topPts[4].y + topPts[3].y) * 0.5 - s * 0.11;
            const blotchGrad = ctx.createRadialGradient(bx, by, 0, bx, by, s * 0.12);
            blotchGrad.addColorStop(0, 'rgba(9,13,22,0.92)');
            blotchGrad.addColorStop(1, 'rgba(9,13,22,0)');
            ctx.fillStyle = blotchGrad;
            ctx.beginPath();
            ctx.arc(bx, by, s * 0.12, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            // 4. 强壮躯体与自然掠食颌线
            ctx.save();
            const bodyGrad = ctx.createLinearGradient(0, -s * 0.45, 0, s * 0.44);
            bodyGrad.addColorStop(0, dorsalMoss);
            bodyGrad.addColorStop(0.38, flankOlive);
            bodyGrad.addColorStop(0.72, flankGold);
            bodyGrad.addColorStop(1, bellyCream);
            traceEnvelope(art, ctx, spine, topPts, botPts, s * 0.08);
            ctx.fillStyle = bodyGrad;
            ctx.fill();
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.9, s * 0.048);
            ctx.stroke();

            ctx.clip();
            // 6 道渐隐锥形虎斑
            for (let i = 1; i <= 6; i++) {
                const idx = Math.min(spine.length - 1, i);
                const px = spine[idx].x + (i === 1 ? -s * 0.14 : 0);
                const py = topPts[idx].y;
                const barH = (topW[idx] + botW[idx]) * 0.85;
                const barW = s * 0.08;
                const bGrad = ctx.createLinearGradient(0, py, 0, py + barH);
                bGrad.addColorStop(0, isShiny ? 'rgba(109,40,217,0.62)' : 'rgba(24,46,10,0.64)');
                bGrad.addColorStop(1, 'rgba(24,46,10,0)');
                ctx.fillStyle = bGrad;
                ctx.beginPath();
                ctx.moveTo(px - barW * 0.65, py);
                ctx.lineTo(px + barW * 0.65, py);
                ctx.quadraticCurveTo(px + barW * 0.25, py + barH * 0.65, px - barW * 0.1, py + barH);
                ctx.quadraticCurveTo(px - barW * 0.45, py + barH * 0.65, px - barW * 0.65, py);
                ctx.closePath();
                ctx.fill();
            }

            // 自然掠食颌线与鳃盖
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = Math.max(0.9, s * 0.048);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(spine[0].x + s * 0.04, spine[0].y + s * 0.03);
            ctx.quadraticCurveTo(spine[0].x - s * 0.08, spine[0].y + s * 0.06, spine[0].x - s * 0.18, spine[0].y + s * 0.09);
            ctx.stroke();

            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.8, s * 0.042);
            ctx.beginPath();
            ctx.arc(spine[1].x - s * 0.10, spine[1].y + s * 0.02, s * 0.20, -0.75, 0.85);
            ctx.stroke();
            ctx.restore();

            // 5. 朱橙胸鳍
            ctx.save();
            ctx.translate(spine[2].x + s * 0.04, spine[2].y + botW[2] * 0.40);
            ctx.rotate(pecAng);
            ctx.fillStyle = finBase;
            ctx.globalAlpha = 0.90;
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.7, s * 0.038);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(-s * 0.18, -s * 0.02, -s * 0.24, s * 0.12);
            ctx.quadraticCurveTo(-s * 0.10, s * 0.21, 0, 0);
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 6. 锐利掠食眼眸
            const headAng = Math.atan2(spine[0].y - spine[1].y, spine[0].x - spine[1].x);
            art.drawCanvasEye(
                ctx,
                spine[0].x - Math.cos(headAng) * s * 0.25,
                spine[0].y - Math.sin(headAng) * s * 0.25 - s * 0.05,
                Math.max(1.9, s * 0.115),
                isShiny ? palette.iris : '#f59e0b',
                { style: 'fierce', browColor: isShiny ? '#78350f' : '#223a0f' }
            );
        }
    };

    // ========================================================================
    // 4. 花斑泥鳅 (loach) — 水润S形圆筒体 · 渐细吻须 · 云纹花斑 · undulate 泳姿
    // ========================================================================
    const LOACH_MOTION = {
        swimStyle: 'undulate',
        tailFreq: 9.6,
        tailAmp: 0.30,
        bodyFlex: 0.34,
        pectoralFreq: 6.2,
        turnAgility: 1.15,
        bobAmp: 2.6,
        tailPivot: '40px 60px'
    };

    const loachModel = {
        motion: LOACH_MOTION,

        buildSVGContent(ctxInfo) {
            const { isSilhouette, isShiny, uid, palette, art } = resolveSvgContext(ctxInfo, LOACH_MOTION);
            const bodyPath = 'M 38,59 C 60,47 92,40 126,44 C 152,47 174,50 181,58 C 181,66 170,71 150,71 C 120,71 90,75 60,72 C 48,71 42,67 38,59 Z';
            const tailPath = 'M 41,59 C 31,44 15,43 14,60 C 15,77 31,76 41,61 Z';
            const dorsalPath = 'M 68,46 Q 76,33 90,34 Q 93,40 89,44 Z';
            const analPath = 'M 54,70 Q 60,82 69,80 Q 71,75 67,71 Z';
            const pelvicPath = 'M 83,72 Q 88,83 96,81 Q 96,76 92,72 Z';
            const pecPath = 'M 143,66 C 138,63 128,67 126,74 C 128,80 137,80 143,72 Z';

            const backBrown = isSilhouette ? palette.bodyDark : (isShiny ? palette.bodyLight : '#5e4124');
            const midBrown = isSilhouette ? palette.body : (isShiny ? palette.body : '#9b7248');
            const bellyCream = isSilhouette ? palette.belly : (isShiny ? palette.bellyWarm : '#f4e6cf');
            const finBase = isSilhouette ? palette.finDark : (isShiny ? palette.fin : '#7d5631');
            const finEdge = isSilhouette ? palette.finLight : (isShiny ? palette.finLight : '#c79f72');
            const spotDark = isShiny ? '#7e22ce' : '#3a2210';
            const spotMid = isShiny ? '#db2777' : '#57341a';
            const outline = isSilhouette ? palette.stroke : (isShiny ? palette.outline : '#382210');
            const barbelFill = isSilhouette ? palette.finLight : (isShiny ? '#fef08a' : '#784e28');
            const rayStroke = isShiny ? 'rgba(255,255,255,0.6)' : 'rgba(247,232,208,0.56)';

            return `
                <defs>
                    <linearGradient id="${uid}_body" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${backBrown}"/>
                        <stop offset="52%" stop-color="${midBrown}"/>
                        <stop offset="100%" stop-color="${bellyCream}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_fin" x1="0%" y1="100%" x2="0%" y2="0%">
                        <stop offset="0%" stop-color="${finBase}" stop-opacity="0.88"/>
                        <stop offset="100%" stop-color="${finEdge}" stop-opacity="${isSilhouette ? 0.9 : 0.56}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_tail" x1="100%" y1="50%" x2="0%" y2="50%">
                        <stop offset="0%" stop-color="${finBase}" stop-opacity="0.92"/>
                        <stop offset="100%" stop-color="${finEdge}" stop-opacity="${isSilhouette ? 0.88 : 0.58}"/>
                    </linearGradient>
                    <clipPath id="${uid}_clip">
                        <path d="${bodyPath}"/>
                    </clipPath>
                </defs>

                <!-- 通透琥珀圆桨尾 -->
                <g class="svg-fish-tail">
                    <path d="${tailPath}" fill="url(#${uid}_tail)" stroke="${outline}" stroke-width="1.2" stroke-linejoin="round"/>
                    ${!isSilhouette ? `
                        ${art.svgFinRays([
                            'M 38,58 Q 27,51 19,51',
                            'M 37,60 L 17,60',
                            'M 38,62 Q 27,69 19,69'
                        ], rayStroke, 0.58, 0.85)}
                        <circle cx="32" cy="57" r="1.4" fill="${spotDark}" opacity="0.65"/>
                        <circle cx="26" cy="63" r="1.3" fill="${spotDark}" opacity="0.62"/>
                    ` : ''}
                </g>

                <!-- 臀鳍、腹鳍与小圆背鳍 -->
                <path d="${analPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.05" stroke-linejoin="round"/>
                <path d="${pelvicPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.05" stroke-linejoin="round"/>
                <path d="${dorsalPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.15" stroke-linejoin="round"/>
                ${!isSilhouette ? `
                    ${art.svgFinRays(['M 75,44 Q 77,39 79,36', 'M 83,43 Q 85,39 87,36'], rayStroke, 0.56, 0.85)}
                    <circle cx="80" cy="40" r="1.4" fill="${spotDark}" opacity="0.68"/>
                ` : ''}

                <!-- 4 根优雅渐细吻端弯须 -->
                <g fill="${barbelFill}" stroke="${outline}" stroke-width="0.55" stroke-linejoin="round">
                    <path d="M 178,61 C 185,62 190,66 190,73 C 188,67 183,64 176,63 Z"/>
                    <path d="M 175,63 C 182,67 184,74 181,80 C 180,74 178,68 172,65 Z"/>
                    <path d="M 171,65 C 176,70 176,76 172,82 C 173,76 172,70 168,66 Z"/>
                    <path d="M 167,66 C 170,71 169,76 165,80 C 166,75 166,71 164,67 Z"/>
                </g>

                <!-- 水润 S 形圆筒躯体 -->
                <path d="${bodyPath}" fill="url(#${uid}_body)" stroke="${outline}" stroke-width="1.45" stroke-linejoin="round"/>

                <!-- 水墨云雾花斑与湿润高光 -->
                ${!isSilhouette ? `
                    <g clip-path="url(#${uid}_clip)">
                        <path d="M 55,54 Q 70,47 84,53 Q 78,60 66,58 Z" fill="${spotMid}" opacity="0.48"/>
                        <path d="M 88,49 Q 104,43 116,50 Q 108,58 95,55 Z" fill="${spotDark}" opacity="0.52"/>
                        <path d="M 120,48 Q 134,45 144,52 Q 135,58 124,55 Z" fill="${spotMid}" opacity="0.50"/>
                        <circle cx="62" cy="61" r="2.6" fill="${spotDark}" opacity="0.56"/>
                        <ellipse cx="78" cy="60" rx="3.4" ry="2.2" fill="${spotDark}" opacity="0.58"/>
                        <circle cx="96" cy="62" r="2.8" fill="${spotMid}" opacity="0.54"/>
                        <ellipse cx="114" cy="59" rx="3.8" ry="2.3" fill="${spotDark}" opacity="0.58"/>
                        <circle cx="132" cy="61" r="2.5" fill="${spotDark}" opacity="0.56"/>
                        <ellipse cx="148" cy="56" rx="3.1" ry="2.0" fill="${spotMid}" opacity="0.56"/>
                        <path d="M 52,53 Q 108,42 162,52" fill="none" stroke="rgba(255,250,240,0.44)" stroke-width="2.8" stroke-linecap="round"/>
                        <path d="M 146,49 Q 153,58 145,68" fill="none" stroke="${outline}" stroke-width="1.35" stroke-linecap="round" opacity="0.56"/>
                    </g>
                    <path d="M 178,63 Q 172,65 167,63" fill="none" stroke="${outline}" stroke-width="1.15" stroke-linecap="round"/>
                ` : ''}

                <!-- 灵动低位圆胸鳍 -->
                <g class="svg-fish-pec" style="transform-box: view-box; transform-origin: 143px 68px;">
                    <path d="${pecPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.0" stroke-linejoin="round" opacity="0.92"/>
                </g>

                <!-- 水灵眼睛正确嵌入头部轮廓内 -->
                ${art.svgEye(165, 56.5, 4.1, isSilhouette, isShiny ? palette.iris : '#d97706', { style: 'cute', uid })}
                ${art.svgShinyOverlay(isSilhouette, isShiny)}
            `;
        },

        drawCanvas(ctx, size, time, opts) {
            const { art, clamp, size: s, isShiny, palette, speedRatio, bodyBend, wagPhase, finPhase } =
                resolveCanvasContext(size, time, opts, LOACH_MOTION);

            const rush = clamp(speedRatio, 0.35, 2.6);
            const pts = computeSpine(art, s * 1.04, -s * 1.00, 10, bodyBend, wagPhase, s * (0.08 + 0.05 * rush), 0.88);
            const n = pts.length;
            const widths = [
                s * 0.16, s * 0.24, s * 0.26, s * 0.26, s * 0.25,
                s * 0.23, s * 0.20, s * 0.17, s * 0.14, s * 0.10
            ];

            const backBrown = isShiny ? palette.bodyLight : '#5e4124';
            const midBrown = isShiny ? palette.body : '#9b7248';
            const bellyCream = isShiny ? palette.bellyWarm : '#f4e6cf';
            const finBase = isShiny ? palette.fin : '#7d5631';
            const finEdge = isShiny ? palette.finLight : '#c79f72';
            const spotDark = isShiny ? '#7e22ce' : '#3a2210';
            const spotMid = isShiny ? '#db2777' : '#57341a';
            const outline = isShiny ? palette.outline : '#382210';

            // 1. 尾端圆桨尾鳍
            const pLast = pts[n - 1];
            const pPrev = pts[Math.max(0, n - 2)];
            const tailAng = Math.atan2(pLast.y - pPrev.y, pLast.x - pPrev.x) + Math.sin(wagPhase - 1.9) * 0.15;

            ctx.save();
            ctx.translate(pLast.x, pLast.y);
            ctx.rotate(tailAng);
            const tailGrad = ctx.createLinearGradient(0, 0, s * 0.34, 0);
            tailGrad.addColorStop(0, finBase);
            tailGrad.addColorStop(1, isShiny ? 'rgba(224,242,254,0.62)' : 'rgba(199,159,114,0.62)');
            ctx.fillStyle = tailGrad;
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.75, s * 0.04);
            ctx.beginPath();
            ctx.moveTo(-s * 0.02, -widths[n - 1] * 0.85);
            ctx.bezierCurveTo(s * 0.15, -s * 0.24, s * 0.35, -s * 0.22, s * 0.35, 0);
            ctx.bezierCurveTo(s * 0.35, s * 0.22, s * 0.15, s * 0.24, -s * 0.02, widths[n - 1] * 0.85);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            drawRays(art, ctx, [
                [s * 0.02, -s * 0.03, s * 0.25, -s * 0.09],
                [s * 0.03, 0, s * 0.28, 0],
                [s * 0.02, s * 0.03, s * 0.25, s * 0.09]
            ], 'rgba(247,232,208,0.52)', s * 0.028);
            ctx.restore();

            // 2. 小圆背鳍与臀鳍
            const dIdx = Math.min(n - 2, Math.floor(n * 0.58));
            const pD = pts[dIdx];
            const pDNext = pts[Math.max(0, dIdx - 1)];
            const dAng = Math.atan2(pDNext.y - pD.y, pDNext.x - pD.x);
            ctx.save();
            ctx.translate(pD.x, pD.y);
            ctx.rotate(dAng);
            ctx.fillStyle = finEdge;
            ctx.globalAlpha = 0.88;
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.7, s * 0.038);
            ctx.beginPath();
            ctx.moveTo(-s * 0.16, -widths[dIdx] * 0.78);
            ctx.quadraticCurveTo(-s * 0.04, -widths[dIdx] - s * 0.18, s * 0.10, -widths[dIdx] * 0.82);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(-s * 0.22, widths[dIdx] * 0.76);
            ctx.quadraticCurveTo(-s * 0.14, widths[dIdx] + s * 0.12, -s * 0.04, widths[dIdx] * 0.8);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 3. 长条柔韧躯干 (drawCanvasSpineRibbon)
            const minY = Math.min(...pts.map((p, i) => p.y - widths[i])) - s * 0.05;
            const maxY = Math.max(...pts.map((p, i) => p.y + widths[i])) + s * 0.05;
            const bodyGrad = ctx.createLinearGradient(0, minY, 0, maxY);
            bodyGrad.addColorStop(0, backBrown);
            bodyGrad.addColorStop(0.54, midBrown);
            bodyGrad.addColorStop(1, bellyCream);

            if (typeof art.drawCanvasSpineRibbon === 'function') {
                art.drawCanvasSpineRibbon(ctx, pts, widths, bodyGrad, outline, Math.max(0.85, s * 0.046));
            }

            // 4. 云纹水墨花斑与湿润高光带
            ctx.save();
            const spotPattern = [
                { idx: 1, offY: -0.22, rx: 0.068, ry: 0.042, dark: false },
                { idx: 2, offY: -0.10, rx: 0.055, ry: 0.048, dark: true },
                { idx: 3, offY: -0.25, rx: 0.075, ry: 0.045, dark: false },
                { idx: 4, offY: 0.12, rx: 0.060, ry: 0.045, dark: true },
                { idx: 5, offY: -0.22, rx: 0.072, ry: 0.045, dark: false },
                { idx: 6, offY: 0.06, rx: 0.058, ry: 0.044, dark: true },
                { idx: 7, offY: -0.16, rx: 0.052, ry: 0.038, dark: false }
            ];
            for (let i = 0; i < spotPattern.length; i++) {
                const sp = spotPattern[i];
                const idx = Math.min(n - 1, sp.idx);
                const pt = pts[idx];
                const w = widths[idx];
                ctx.fillStyle = sp.dark ? spotDark : spotMid;
                ctx.globalAlpha = 0.56;
                ctx.beginPath();
                ctx.ellipse(pt.x, pt.y + w * sp.offY, Math.max(1.0, s * sp.rx), Math.max(0.8, s * sp.ry), 0, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.globalAlpha = 0.42;
            ctx.strokeStyle = '#fffbeb';
            ctx.lineWidth = Math.max(0.85, s * 0.05);
            ctx.lineCap = 'round';
            ctx.beginPath();
            for (let i = 1; i < n - 1; i++) {
                const px = pts[i].x;
                const py = pts[i].y - widths[i] * 0.42;
                if (i === 1) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
            ctx.restore();

            // 5. 头部：渐细弯须、低位胸鳍、嵌入头部的可爱眼
            const p0 = pts[0];
            const p1 = pts[Math.min(n - 1, 1)];
            const headAng = Math.atan2(p0.y - p1.y, p0.x - p1.x);
            const pecAng = Math.sin(finPhase) * 0.24;

            ctx.save();
            ctx.translate(p0.x, p0.y);
            ctx.rotate(headAng);

            // 4 根渐细吻须
            ctx.strokeStyle = isShiny ? '#fef08a' : '#784e28';
            ctx.lineCap = 'round';
            ctx.lineWidth = Math.max(0.75, s * 0.042);
            ctx.beginPath();
            ctx.moveTo(s * 0.05, widths[0] * 0.35);
            ctx.quadraticCurveTo(s * 0.16, widths[0] * 0.55, s * 0.18, widths[0] * 1.15);
            ctx.moveTo(s * 0.01, widths[0] * 0.62);
            ctx.quadraticCurveTo(s * 0.11, widths[0] * 1.05, s * 0.08, widths[0] * 1.52);
            ctx.moveTo(-s * 0.04, widths[0] * 0.72);
            ctx.quadraticCurveTo(s * 0.03, widths[0] * 1.22, -s * 0.02, widths[0] * 1.58);
            ctx.stroke();

            // 鳃盖
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.7, s * 0.038);
            ctx.globalAlpha = 0.56;
            ctx.beginPath();
            ctx.arc(-s * 0.22, 0, s * 0.11, -0.75, 0.85);
            ctx.stroke();
            ctx.globalAlpha = 1;

            // 低位胸鳍
            ctx.save();
            ctx.translate(-s * 0.26, widths[0] * 0.78);
            ctx.rotate(pecAng);
            ctx.fillStyle = finEdge;
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.65, s * 0.036);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(-s * 0.14, s * 0.03, -s * 0.16, s * 0.13);
            ctx.quadraticCurveTo(-s * 0.04, s * 0.17, 0, 0);
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 眼睛嵌在头廓内部
            art.drawCanvasEye(
                ctx,
                -s * 0.07,
                -widths[0] * 0.16,
                Math.max(1.8, s * 0.09),
                isShiny ? palette.iris : '#d97706',
                { style: 'cute' }
            );
            ctx.restore();
        }
    };

    WWF.FISH_MODELS.minnow = minnowModel;
    WWF.FISH_MODELS.crucian = crucianModel;
    WWF.FISH_MODELS.perch = perchModel;
    WWF.FISH_MODELS.loach = loachModel;
})();
