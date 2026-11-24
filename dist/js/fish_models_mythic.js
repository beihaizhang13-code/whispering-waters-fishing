/**
 * ============================================================================
 * 《微风垂钓物语 2.0》传说与神话级鱼王建模库 (js/fish_models_mythic.js)
 * ============================================================================
 * 注册 6 种传说与神话级鱼王至 window.WWF.FISH_MODELS：
 * - sakura_salmon    (樱花鲑王 / Legendary)
 * - sunken_angler    (幽光灯笼鮟鱇 / Legendary)
 * - phantom_sturgeon (幽蓝古鲟 / Legendary)
 * - moonfish         (星辰月光鱼 / Mythic)
 * - dragon_koi       (龙宫赤金龙 / Mythic)
 * - astral_leviathan (星渊幻海龙 / Mythic)
 */
(function () {
    'use strict';

    const WWF = window.WWF = window.WWF || {};
    WWF.FISH_MODELS = WWF.FISH_MODELS || {};

    function safeNum(val, fallback = 0) {
        return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
    }

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function drawSoftGlowCanvas(art, ctx, x, y, r, innerColor, midColor = null, outerColor = 'rgba(0,0,0,0)') {
        if (art && typeof art.drawCanvasSoftGlow === 'function') {
            art.drawCanvasSoftGlow(ctx, x, y, r, innerColor, midColor, outerColor);
            return;
        }
        const safeR = Math.max(1, r);
        const grad = ctx.createRadialGradient(x, y, safeR * 0.08, x, y, safeR);
        grad.addColorStop(0, innerColor);
        if (midColor) grad.addColorStop(0.45, midColor);
        grad.addColorStop(1, outerColor);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, safeR, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawStarSparkCanvas(ctx, x, y, r, color, alpha = 1) {
        if (alpha <= 0.02 || r <= 0.4) return;
        ctx.save();
        ctx.translate(x, y);
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r * 0.28, -r * 0.28);
        ctx.lineTo(r, 0);
        ctx.lineTo(r * 0.28, r * 0.28);
        ctx.lineTo(0, r);
        ctx.lineTo(-r * 0.28, r * 0.28);
        ctx.lineTo(-r, 0);
        ctx.lineTo(-r * 0.28, -r * 0.28);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    function drawPetalCanvas(ctx, x, y, rx, ry, rot, fill, alpha = 0.78) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.moveTo(0, -ry);
        ctx.bezierCurveTo(rx, -ry * 0.4, rx, ry * 0.6, 0, ry);
        ctx.bezierCurveTo(-rx, ry * 0.6, -rx, -ry * 0.4, 0, -ry);
        ctx.fill();
        ctx.restore();
    }

    function getSpineFrame(pts, idx) {
        const n = pts.length;
        const prev = pts[Math.max(0, idx - 1)];
        const next = pts[Math.min(n - 1, idx + 1)];
        const tx = prev.x - next.x;
        const ty = prev.y - next.y;
        const len = Math.max(0.001, Math.hypot(tx, ty));
        const ux = tx / len;
        const uy = ty / len;
        const nx = uy;
        const ny = -ux;
        return { x: pts[idx].x, y: pts[idx].y, ux, uy, nx, ny, ang: Math.atan2(uy, ux) };
    }

    // ========================================================================
    // 1. 樱花鲑王 (sakura_salmon) - 传说 Legendary
    // ========================================================================
    WWF.FISH_MODELS.sakura_salmon = {
        motion: {
            swimStyle: 'dart',
            tailFreq: 10.2,
            tailAmp: 0.28,
            bodyFlex: 0.24,
            pectoralFreq: 6.4,
            turnAgility: 1.25,
            bobAmp: 2.8,
            tailPivot: '48px 60px'
        },

        buildSVGContent({ isSilhouette, isShiny, uid, palette, art }) {
            // 雕塑感贵族钩吻 (Kype) 洄游鲑王轮廓（摒弃锯齿拉链嘴）
            const bodyPath =
                'M 48,59 C 66,39 112,31 154,44 C 168,48 181,51 180,58 C 176,61 169,56 157,58 ' +
                'L 168,62 C 175,62 178,59 179,63 C 178,69 164,74 150,76 C 112,86 68,80 48,62 Z';
            const tailPath = 'M 50,58 L 16,28 Q 29,48 31,60 Q 29,72 16,92 L 50,63 Z';
            const dorsalPath = 'M 84,38 Q 92,16 119,23 Q 116,33 114,39 Z';
            const adiposePath = 'M 57,48 Q 62,36 71,46 Z';
            const pelvicPath = 'M 90,78 Q 84,94 102,93 Q 108,85 104,78 Z';
            const analPath = 'M 58,72 Q 62,89 77,88 Q 79,78 73,72 Z';
            const pecPath = 'M 130,68 Q 108,79 114,90 Q 130,85 136,70 Z';

            const topRose = isSilhouette ? palette.bodyDark : (isShiny ? palette.bodyDark : '#9f1239');
            const midSakura = isSilhouette ? palette.body : (isShiny ? palette.body : '#f472b6');
            const blushSilk = isSilhouette ? palette.bodyLight : (isShiny ? palette.bodyLight : '#fbcfe8');
            const bellyPearl = isSilhouette ? palette.belly : (isShiny ? palette.bellyWarm : '#fff1f2');
            const finBase = isSilhouette ? palette.finDark : (isShiny ? palette.fin : '#fda4af');
            const finTip = isSilhouette ? palette.finLight : (isShiny ? palette.finLight : '#be123c');
            const outline = isSilhouette ? palette.stroke : (isShiny ? palette.outline : '#881337');
            const petalColor = isShiny ? '#fef08a' : '#fff1f2';

            // 水彩半透明樱花瓣漂洗纹饰（融于体侧光泽，告别死板五圆贴纸）
            const watercolorPetals = isSilhouette ? '' : `
                <g opacity="0.34" fill="${petalColor}">
                    <path d="M 86,54 C 92,48 101,49 102,55 C 96,60 88,59 86,54 Z"/>
                    <path d="M 96,60 C 102,55 110,58 109,64 C 103,67 96,64 96,60 Z"/>
                    <path d="M 73,61 C 79,57 86,59 85,65 C 79,68 73,65 73,61 Z"/>
                    <path d="M 114,50 C 120,46 127,49 125,55 C 119,57 113,54 114,50 Z"/>
                </g>
            `;

            const markings = isSilhouette ? '' : `
                <g clip-path="url(#${uid}_clip)">
                    <path d="M 52,58 Q 106,49 156,57" stroke="${isShiny ? '#fef08a' : '#ffe4e6'}" stroke-width="7.5" fill="none" opacity="0.42" stroke-linecap="round"/>
                    <path d="M 56,43 Q 108,29 156,46" stroke="rgba(255,255,255,0.52)" stroke-width="3.2" fill="none" stroke-linecap="round"/>
                    ${art.svgScalePatch([
                        { y: 45, xs: [74, 88, 102, 116, 130], alpha: 0.56 },
                        { y: 55, xs: [68, 82, 96, 110, 124], alpha: 0.65 },
                        { y: 65, xs: [76, 90, 104, 118], alpha: 0.45 }
                    ], {
                        rx: 4.4, ry: 4.0,
                        rimColor: 'rgba(255,241,242,0.48)',
                        shadowColor: 'rgba(159,18,57,0.18)'
                    })}
                    ${watercolorPetals}
                    <circle cx="84" cy="43" r="1.6" fill="${outline}" opacity="0.48"/>
                    <circle cx="96" cy="40" r="1.8" fill="${outline}" opacity="0.48"/>
                    <circle cx="110" cy="42" r="1.5" fill="${outline}" opacity="0.48"/>
                    <circle cx="124" cy="44" r="1.7" fill="${outline}" opacity="0.46"/>
                    <path d="M 139,47 Q 146,58 138,72" fill="none" stroke="${outline}" stroke-width="1.65" opacity="0.62" stroke-linecap="round"/>
                    <path d="M 142,49 Q 149,58 142,70" fill="none" stroke="rgba(255,255,255,0.62)" stroke-width="1.15" stroke-linecap="round"/>
                    <path d="M 178,59 Q 167,61 156,59" fill="none" stroke="${outline}" stroke-width="1.35" stroke-linecap="round"/>
                </g>
            `;

            const floatingPetals = isSilhouette ? '' : `
                <g class="svg-fish-float-aura" opacity="0.86">
                    <path d="M 41,33 C 45,30 49,32 47,36 C 43,38 40,36 41,33 Z" fill="${petalColor}"/>
                    <path d="M 28,74 C 31,71 35,73 33,77 C 30,78 27,76 28,74 Z" fill="${petalColor}"/>
                    <path d="M 134,23 C 138,20 142,22 140,26 C 136,27 133,25 134,23 Z" fill="${petalColor}"/>
                </g>
            `;

            return `
                <defs>
                    <linearGradient id="${uid}_body" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${topRose}"/>
                        <stop offset="34%" stop-color="${midSakura}"/>
                        <stop offset="68%" stop-color="${blushSilk}"/>
                        <stop offset="100%" stop-color="${bellyPearl}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_tail" x1="100%" y1="50%" x2="0%" y2="50%">
                        <stop offset="0%" stop-color="${finBase}" stop-opacity="0.85"/>
                        <stop offset="65%" stop-color="${finTip}" stop-opacity="0.90"/>
                        <stop offset="100%" stop-color="${finTip}" stop-opacity="${isSilhouette ? 0.9 : 0.72}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_fin" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${finTip}" stop-opacity="0.88"/>
                        <stop offset="100%" stop-color="${finBase}" stop-opacity="${isSilhouette ? 0.9 : 0.62}"/>
                    </linearGradient>
                    <clipPath id="${uid}_clip">
                        <path d="${bodyPath}"/>
                    </clipPath>
                </defs>

                <g class="svg-fish-tail">
                    <path d="${tailPath}" fill="url(#${uid}_tail)" stroke="${outline}" stroke-width="1.35" stroke-linejoin="round"/>
                    ${!isSilhouette ? art.svgFinRays(['M 45,58 L 22,35', 'M 43,60 L 28,50', 'M 43,60 L 28,70', 'M 45,62 L 22,85'], 'rgba(255,241,242,0.62)', 0.72, 0.95) : ''}
                </g>
                <path d="${adiposePath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.1" stroke-linejoin="round"/>
                <path d="${dorsalPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.25" stroke-linejoin="round"/>
                ${!isSilhouette ? art.svgFinRays(['M 91,38 L 94,22', 'M 99,37 L 104,23', 'M 107,38 L 112,26'], 'rgba(255,241,242,0.58)', 0.65, 0.9) : ''}
                <path d="${pelvicPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.15" stroke-linejoin="round"/>
                <path d="${analPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.15" stroke-linejoin="round"/>
                ${isSilhouette ? '' : '<path d="M 157,58 Q 169,56 179,58 L 178,62.5 Q 170,63.5 157,58 Z" fill="#4c0519" opacity="0.88"/>'}
                <path d="${bodyPath}" fill="url(#${uid}_body)" stroke="${outline}" stroke-width="1.5" stroke-linejoin="round"/>
                ${markings}
                <g class="svg-fish-pec" style="transform-box: view-box; transform-origin: 130px 69px;">
                    <path d="${pecPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.15" stroke-linejoin="round" opacity="0.92"/>
                    ${!isSilhouette ? art.svgFinRays(['M 129,70 L 117,84', 'M 131,71 L 122,85'], 'rgba(255,241,242,0.55)', 0.6, 0.85) : ''}
                </g>
                ${floatingPetals}
                ${art.svgEye(154, 52, 5.1, isSilhouette, isShiny ? palette.iris : '#e11d48', { style: 'natural', uid })}
                ${art.svgShinyOverlay(isSilhouette, isShiny)}
            `;
        },

        drawCanvas(ctx, size, time, opts) {
            const s = Math.max(8, safeNum(size, 26));
            const palette = opts.palette;
            const art = opts.art;
            const wagPhase = safeNum(opts.wagPhase, time * 10);
            const finPhase = safeNum(opts.finPhase, time * 6.4);
            const phaseOffset = safeNum(opts.phaseOffset, 0);
            const bodyBend = safeNum(opts.bodyBend, 0);
            const speedRatio = safeNum(opts.speedRatio, 1);
            const wag = Math.sin(wagPhase) * (0.24 + speedRatio * 0.05) + bodyBend * 0.45;
            const bendY = (t) => Math.sin(t * Math.PI) * bodyBend * s * 0.36 + Math.sin(wagPhase - t * 2.4) * s * 0.045 * t;
            const outline = opts.isShiny ? palette.outline : '#881337';
            const finBase = opts.isShiny ? palette.fin : '#fda4af';
            const finTip = opts.isShiny ? palette.finLight : '#be123c';

            ctx.save();
            ctx.scale(1.08, 1.08);

            // 1. 樱瓣渐变尾鳍
            const tailBaseX = -s * 0.84;
            const tailBaseY = bendY(1);
            ctx.save();
            ctx.translate(tailBaseX, tailBaseY);
            ctx.rotate(wag);
            const tailGrad = ctx.createLinearGradient(0, 0, -s * 0.56, 0);
            tailGrad.addColorStop(0, finBase);
            tailGrad.addColorStop(0.65, finTip);
            tailGrad.addColorStop(1, opts.isShiny ? palette.finLight : 'rgba(190,18,60,0.72)');
            ctx.fillStyle = tailGrad;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-s * 0.54, -s * 0.48);
            ctx.quadraticCurveTo(-s * 0.32, 0, -s * 0.54, s * 0.48);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(1.0, s * 0.042);
            ctx.stroke();
            ctx.restore();

            // 2. 脂鳍、背鳍与腹鳍
            const dorsalY = bendY(0.42);
            const finGrad = ctx.createLinearGradient(0, -s * 0.72, 0, s * 0.65);
            finGrad.addColorStop(0, finTip);
            finGrad.addColorStop(0.5, finBase);
            finGrad.addColorStop(1, finTip);
            ctx.fillStyle = finGrad;
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.85, s * 0.038);

            ctx.beginPath();
            ctx.moveTo(-s * 0.50, bendY(0.76) - s * 0.20);
            ctx.quadraticCurveTo(-s * 0.43, bendY(0.76) - s * 0.37, -s * 0.35, bendY(0.76) - s * 0.24);
            ctx.closePath();
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(-s * 0.14, dorsalY - s * 0.33);
            ctx.quadraticCurveTo(-s * 0.04, dorsalY - s * 0.68, s * 0.22, dorsalY - s * 0.56);
            ctx.lineTo(s * 0.18, dorsalY - s * 0.32);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(-s * 0.14, dorsalY + s * 0.32);
            ctx.quadraticCurveTo(-s * 0.20, dorsalY + s * 0.52, -s * 0.02, dorsalY + s * 0.50);
            ctx.closePath();
            ctx.fill();

            // 3. 丝绸樱霞鲑王躯干（优雅勾吻 + 内口腔深红阴影）
            const headY = bendY(0);
            const midY = bendY(0.45);
            ctx.fillStyle = '#4c0519';
            ctx.beginPath();
            ctx.moveTo(s * 0.72, headY + s * 0.01);
            ctx.quadraticCurveTo(s * 0.84, headY - s * 0.02, s * 0.93, headY);
            ctx.lineTo(s * 0.92, headY + s * 0.10);
            ctx.quadraticCurveTo(s * 0.82, headY + s * 0.11, s * 0.72, headY + s * 0.02);
            ctx.closePath();
            ctx.fill();

            const bodyGrad = ctx.createLinearGradient(0, -s * 0.45, 0, s * 0.45);
            bodyGrad.addColorStop(0, opts.isShiny ? palette.bodyDark : '#9f1239');
            bodyGrad.addColorStop(0.36, opts.isShiny ? palette.body : '#f472b6');
            bodyGrad.addColorStop(0.70, opts.isShiny ? palette.bodyLight : '#fbcfe8');
            bodyGrad.addColorStop(1, opts.isShiny ? palette.bellyWarm : '#fff1f2');

            ctx.fillStyle = bodyGrad;
            ctx.beginPath();
            ctx.moveTo(tailBaseX, tailBaseY);
            ctx.quadraticCurveTo(-s * 0.18, midY - s * 0.48, s * 0.66, headY - s * 0.26);
            ctx.quadraticCurveTo(s * 0.96, headY - s * 0.18, s * 0.94, headY - s * 0.02);
            ctx.quadraticCurveTo(s * 0.84, headY + s * 0.04, s * 0.72, headY + s * 0.02);
            ctx.lineTo(s * 0.86, headY + s * 0.09);
            ctx.quadraticCurveTo(s * 0.95, headY + s * 0.04, s * 0.94, headY + s * 0.14);
            ctx.quadraticCurveTo(s * 0.84, headY + s * 0.24, s * 0.60, headY + s * 0.26);
            ctx.quadraticCurveTo(-s * 0.16, midY + s * 0.44, tailBaseX, tailBaseY);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(1.0, s * 0.044);
            ctx.stroke();

            // 4. 体侧樱霞光带 + 水彩樱瓣肌理（非大圆贴花）
            ctx.strokeStyle = opts.isShiny ? 'rgba(254,240,138,0.48)' : 'rgba(255,241,242,0.52)';
            ctx.lineWidth = Math.max(1.5, s * 0.085);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(-s * 0.68, tailBaseY);
            ctx.quadraticCurveTo(0, midY - s * 0.08, s * 0.60, headY - s * 0.02);
            ctx.stroke();

            const petalC = opts.isShiny ? '#fef08a' : '#fff1f2';
            drawPetalCanvas(ctx, -s * 0.14, midY + s * 0.02, s * 0.09, s * 0.045, 0.4, petalC, 0.38);
            drawPetalCanvas(ctx, s * 0.18, midY - s * 0.04, s * 0.08, s * 0.04, -0.5, petalC, 0.36);

            const drift = ((time * 0.7 + phaseOffset * 0.1) % 1 + 1) % 1;
            drawPetalCanvas(ctx, -s * (0.45 + drift * 0.55), midY - s * (0.28 - drift * 0.18), s * 0.06, s * 0.032, drift * 2, petalC, 0.72 * (1 - drift * 0.5));

            // 5. 鳃盖与摆动胸鳍
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.9, s * 0.036);
            ctx.beginPath();
            ctx.arc(s * 0.40, headY + s * 0.02, s * 0.18, -0.8, 0.9);
            ctx.stroke();

            const pecFlap = Math.sin(finPhase) * 0.26;
            ctx.save();
            ctx.translate(s * 0.32, headY + s * 0.15);
            ctx.rotate(pecFlap);
            ctx.fillStyle = finTip;
            ctx.globalAlpha = 0.84;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(-s * 0.24, s * 0.12, -s * 0.16, s * 0.26);
            ctx.quadraticCurveTo(-s * 0.02, s * 0.18, 0, 0);
            ctx.fill();
            ctx.restore();

            // 6. 眼眸
            art.drawCanvasEye(ctx, s * 0.62, headY - s * 0.08, Math.max(2.2, s * 0.095), opts.isShiny ? palette.iris : '#e11d48', { style: 'natural' });

            ctx.restore();
        }
    };

    // ========================================================================
    // 2. 幽光灯笼鮟鱇 (sunken_angler) - 传说 Legendary
    // ========================================================================
    WWF.FISH_MODELS.sunken_angler = {
        motion: {
            swimStyle: 'hover',
            tailFreq: 6.2,
            tailAmp: 0.20,
            bodyFlex: 0.14,
            pectoralFreq: 4.8,
            turnAgility: 0.72,
            bobAmp: 4.8,
            tailPivot: '50px 64px'
        },

        buildSVGContent({ isSilhouette, isShiny, uid, palette, art }) {
            const bodyPath =
                'M 49,64 C 54,38 89,27 130,37 C 147,41 156,50 159,58 L 136,62 ' +
                'L 167,71 C 168,85 148,97 113,97 C 81,97 56,83 49,64 Z';
            const jawCavity = 'M 129,57 C 145,56 156,57 159,59 L 166,71 C 154,79 135,77 127,65 Z';
            const tailPath = 'M 51,64 L 22,42 L 29,52 L 15,58 L 28,64 L 16,74 L 29,76 L 23,86 Z';
            const dorsalPath = 'M 64,43 L 71,32 L 77,39 L 85,29 L 91,37 L 98,31 L 103,37 Z';
            const analPath = 'M 59,78 L 63,94 L 72,88 L 78,94 L 82,85 Z';
            const pecPath = 'M 95,69 Q 81,76 80,86 L 88,83 L 92,90 L 99,83 L 106,89 Q 112,78 106,69 Z';
            const rodPath = 'M 124,36 Q 148,11 172,33';

            const topIndigo = isSilhouette ? palette.bodyDark : (isShiny ? palette.bodyDark : '#1e1b4b');
            const midViolet = isSilhouette ? palette.body : (isShiny ? palette.body : '#3b2d7a');
            const deepAbyss = isSilhouette ? palette.bodyDark : (isShiny ? palette.bodyDark : '#0f172a');
            const lureCore = isSilhouette ? palette.fin : (isShiny ? '#f472b6' : '#67e8f9');
            const lureMid = isSilhouette ? palette.stroke : (isShiny ? '#fef08a' : '#38bdf8');
            const outline = isSilhouette ? palette.stroke : (isShiny ? palette.outline : '#090d1e');
            const fangFill = isSilhouette ? '#1e293b' : (isShiny ? 'rgba(254,249,195,0.88)' : 'rgba(224,242,254,0.88)');

            // 错落弯曲的半透明水晶针状尖牙（彻底消除白色栅栏与外描边）
            const fangs = isSilhouette ? `
                <path d="M 164,70 L 160,62 L 158,70 M 154,70 L 150,61 L 148,70 M 144,69 L 142,61 L 140,68" fill="${palette.body}" stroke="${palette.stroke}" stroke-width="0.9"/>
            ` : `
                <g fill="${fangFill}" stroke="none">
                    <path d="M 156,58 Q 154,64 151,67 Q 153,62 152,58 Z"/>
                    <path d="M 149,59 Q 146,66 144,69 Q 145,63 144,59 Z"/>
                    <path d="M 140,60 Q 138,65 136,68 Q 137,63 136,60 Z"/>
                    <path d="M 165,71 Q 162,62 158,56 Q 160,63 159,71 Z"/>
                    <path d="M 157,72 Q 154,63 151,58 Q 152,65 151,72 Z"/>
                    <path d="M 149,72 Q 146,65 143,61 Q 145,67 143,71 Z"/>
                    <path d="M 140,70 Q 138,65 136,62 Q 137,66 135,69 Z"/>
                </g>
                <g fill="none" stroke="#ffffff" stroke-width="0.45" stroke-linecap="round" opacity="0.58">
                    <path d="M 162,67 Q 160.5,61.5 158.8,57.5"/>
                    <path d="M 154.5,68 Q 153,63 151.5,59"/>
                    <path d="M 146.5,68.5 Q 145,64.5 143.5,62"/>
                </g>
            `;

            const skinDetail = isSilhouette ? '' : `
                <g clip-path="url(#${uid}_clip)">
                    <!-- 提灯上方照映在额头背脊上的柔和青金反光 -->
                    <path d="M 88,36 Q 124,29 154,47" fill="none" stroke="${lureCore}" stroke-width="3.4" opacity="0.42" stroke-linecap="round"/>
                    <path d="M 60,72 Q 95,94 152,86" fill="none" stroke="${lureMid}" stroke-width="5.5" opacity="0.24" stroke-linecap="round"/>
                    <path d="M 108,45 Q 116,58 109,75" fill="none" stroke="${outline}" stroke-width="2.0" opacity="0.65" stroke-linecap="round"/>
                    <circle cx="80" cy="54" r="1.5" fill="${lureCore}" opacity="0.78"/>
                    <circle cx="92" cy="51" r="1.8" fill="${lureCore}" opacity="0.82"/>
                    <circle cx="105" cy="54" r="1.4" fill="${lureCore}" opacity="0.75"/>
                    <circle cx="118" cy="76" r="1.7" fill="${lureCore}" opacity="0.72"/>
                    <circle cx="132" cy="82" r="2.0" fill="${lureCore}" opacity="0.85"/>
                    <circle cx="147" cy="83" r="1.6" fill="${lureCore}" opacity="0.8"/>
                </g>
            `;

            const lureGroup = isSilhouette ? `
                <g class="svg-fish-lure" style="transform-box: view-box; transform-origin: 124px 36px;">
                    <path d="${rodPath}" fill="none" stroke="${palette.stroke}" stroke-width="2.4" stroke-linecap="round"/>
                    <ellipse cx="173" cy="39" rx="5.2" ry="6.8" fill="${palette.body}" stroke="${palette.stroke}" stroke-width="1.2"/>
                </g>
            ` : `
                <g class="svg-fish-lure" style="transform-box: view-box; transform-origin: 124px 36px;">
                    <path d="${rodPath}" fill="none" stroke="${lureMid}" stroke-width="2.4" stroke-linecap="round"/>
                    <circle cx="173" cy="40" r="16" fill="url(#${uid}_lure_glow)"/>
                    <path d="M 173,46 Q 170,52 168,55 M 173,46 Q 174,53 176,56 M 171,45 Q 168,49 167,51" stroke="${lureCore}" stroke-width="1.0" fill="none" opacity="0.82" stroke-linecap="round"/>
                    <ellipse cx="173" cy="39" rx="5.0" ry="6.6" fill="${lureCore}" stroke="#ffffff" stroke-width="0.9"/>
                    <circle cx="173" cy="38" r="2.5" fill="#ffffff"/>
                </g>
            `;

            return `
                <defs>
                    <radialGradient id="${uid}_body" cx="62%" cy="38%" r="68%">
                        <stop offset="0%" stop-color="${midViolet}"/>
                        <stop offset="56%" stop-color="${topIndigo}"/>
                        <stop offset="100%" stop-color="${deepAbyss}"/>
                    </radialGradient>
                    ${isSilhouette ? '' : `
                    <radialGradient id="${uid}_lure_glow" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.96"/>
                        <stop offset="32%" stop-color="${lureCore}" stop-opacity="0.72"/>
                        <stop offset="68%" stop-color="${lureMid}" stop-opacity="0.28"/>
                        <stop offset="100%" stop-color="${lureMid}" stop-opacity="0"/>
                    </radialGradient>
                    `}
                    <linearGradient id="${uid}_fin" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="${topIndigo}" stop-opacity="0.92"/>
                        <stop offset="100%" stop-color="${isSilhouette ? palette.fin : lureMid}" stop-opacity="${isSilhouette ? 0.9 : 0.45}"/>
                    </linearGradient>
                    <clipPath id="${uid}_clip">
                        <path d="${bodyPath}"/>
                    </clipPath>
                </defs>

                <g class="svg-fish-tail">
                    <path d="${tailPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.3" stroke-linejoin="round"/>
                    ${!isSilhouette ? art.svgFinRays(['M 47,62 L 26,48', 'M 47,64 L 22,61', 'M 47,66 L 26,80'], lureCore, 0.56, 0.9) : ''}
                </g>
                <path d="${dorsalPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.2" stroke-linejoin="round"/>
                <path d="${analPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.2" stroke-linejoin="round"/>
                <path d="${bodyPath}" fill="url(#${uid}_body)" stroke="${outline}" stroke-width="1.55" stroke-linejoin="round"/>
                ${isSilhouette ? '' : `<path d="${jawCavity}" fill="#050814"/>`}
                ${skinDetail}
                ${fangs}
                <g class="svg-fish-pec" style="transform-box: view-box; transform-origin: 103px 71px;">
                    <path d="${pecPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.15" stroke-linejoin="round" opacity="0.92"/>
                    ${!isSilhouette ? art.svgFinRays(['M 99,72 L 85,84', 'M 101,73 L 94,87', 'M 103,72 L 103,85'], lureCore, 0.56, 0.85) : ''}
                </g>
                ${lureGroup}
                ${isSilhouette ? '' : `<path d="M 131,42 Q 140,40 147,45" fill="none" stroke="${outline}" stroke-width="2.2" stroke-linecap="round"/>`}
                ${art.svgEye(138, 48, 4.6, isSilhouette, isShiny ? '#f472b6' : '#67e8f9', { style: 'glow', uid })}
                ${art.svgShinyOverlay(isSilhouette, isShiny)}
            `;
        },

        drawCanvas(ctx, size, time, opts) {
            const s = Math.max(8, safeNum(size, 26));
            const palette = opts.palette;
            const art = opts.art;
            const wagPhase = safeNum(opts.wagPhase, time * 6.2);
            const finPhase = safeNum(opts.finPhase, time * 4.8);
            const phaseOffset = safeNum(opts.phaseOffset, 0);
            const bodyBend = safeNum(opts.bodyBend, 0);
            const wag = Math.sin(wagPhase) * 0.22 + bodyBend * 0.35;
            const bob = Math.sin(time * 2.3 + phaseOffset) * s * 0.05;
            const pulse = 0.72 + 0.28 * Math.sin(time * 4.6 + phaseOffset * 0.7);

            const lureColor = opts.isShiny ? '#f472b6' : '#38bdf8';
            const lureCore = opts.isShiny ? '#fef08a' : '#a5f3fc';
            const outline = opts.isShiny ? palette.outline : '#090d1e';

            ctx.save();
            ctx.translate(0, bob);
            ctx.scale(1.10, 1.10);

            // 1. 深海尾鳍
            ctx.save();
            ctx.translate(-s * 0.66, s * 0.04);
            ctx.rotate(wag);
            ctx.fillStyle = opts.isShiny ? palette.finDark : '#1e1b4b';
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.95, s * 0.042);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-s * 0.44, -s * 0.36);
            ctx.lineTo(-s * 0.30, -s * 0.14);
            ctx.lineTo(-s * 0.48, -s * 0.02);
            ctx.lineTo(-s * 0.32, s * 0.14);
            ctx.lineTo(-s * 0.42, s * 0.34);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 2. 背脊棘刺
            ctx.fillStyle = opts.isShiny ? palette.finDark : '#1e1b4b';
            ctx.beginPath();
            ctx.moveTo(-s * 0.46, -s * 0.24);
            ctx.lineTo(-s * 0.34, -s * 0.46);
            ctx.lineTo(-s * 0.22, -s * 0.32);
            ctx.lineTo(-s * 0.10, -s * 0.50);
            ctx.lineTo(0, -s * 0.36);
            ctx.closePath();
            ctx.fill();

            // 3. 庞大圆钝体躯 + 地包天大口 + 顶部提灯冷光映射
            const bodyGrad = ctx.createRadialGradient(s * 0.24, -s * 0.10, s * 0.08, 0, 0, s * 0.96);
            bodyGrad.addColorStop(0, opts.isShiny ? palette.bodyLight : '#4c3d99');
            bodyGrad.addColorStop(0.55, opts.isShiny ? palette.body : '#1e1b4b');
            bodyGrad.addColorStop(1, opts.isShiny ? palette.bodyDark : '#0f172a');
            ctx.fillStyle = bodyGrad;
            ctx.beginPath();
            ctx.moveTo(-s * 0.66, s * 0.04);
            ctx.bezierCurveTo(-s * 0.52, -s * 0.48, s * 0.22, -s * 0.64, s * 0.64, -s * 0.16);
            ctx.lineTo(s * 0.34, -s * 0.02);
            ctx.lineTo(s * 0.80, s * 0.10);
            ctx.bezierCurveTo(s * 0.76, s * 0.46, s * 0.24, s * 0.64, -s * 0.16, s * 0.56);
            ctx.quadraticCurveTo(-s * 0.48, s * 0.46, -s * 0.66, s * 0.04);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(1.1, s * 0.048);
            ctx.stroke();

            // 提灯映照在头背的高光边
            ctx.strokeStyle = lureCore;
            ctx.globalAlpha = 0.36;
            ctx.lineWidth = Math.max(1.0, s * 0.05);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(-s * 0.18, -s * 0.40);
            ctx.quadraticCurveTo(s * 0.22, -s * 0.48, s * 0.52, -s * 0.22);
            ctx.stroke();
            ctx.globalAlpha = 1;

            // 血盆大口腔
            ctx.fillStyle = '#050814';
            ctx.beginPath();
            ctx.moveTo(s * 0.34, -s * 0.02);
            ctx.lineTo(s * 0.62, -s * 0.14);
            ctx.lineTo(s * 0.77, s * 0.10);
            ctx.quadraticCurveTo(s * 0.50, s * 0.24, s * 0.34, -s * 0.02);
            ctx.closePath();
            ctx.fill();

            // 4. 错落纤细水晶针牙
            ctx.fillStyle = opts.isShiny ? 'rgba(254, 240, 138, 0.82)' : 'rgba(207, 250, 254, 0.82)';
            const lowerFangs = [0.74, 0.62, 0.50];
            for (let i = 0; i < lowerFangs.length; i++) {
                const fx = s * lowerFangs[i];
                ctx.beginPath();
                ctx.moveTo(fx + s * 0.028, s * 0.11);
                ctx.quadraticCurveTo(fx, -s * 0.02, fx - s * 0.015, -s * (0.11 - i * 0.022));
                ctx.quadraticCurveTo(fx - s * 0.01, 0, fx - s * 0.025, s * 0.10);
                ctx.closePath();
                ctx.fill();
            }
            const upperFangs = [0.58, 0.46];
            for (let i = 0; i < upperFangs.length; i++) {
                const fx = s * upperFangs[i];
                ctx.beginPath();
                ctx.moveTo(fx + s * 0.022, -s * 0.10);
                ctx.lineTo(fx, s * 0.045);
                ctx.lineTo(fx - s * 0.024, -s * 0.08);
                ctx.closePath();
                ctx.fill();
            }

            // 5. 拱形背棘钓竿与水母晶灯
            const sway = Math.sin(time * 2.8 + phaseOffset) * s * 0.04 + bodyBend * s * 0.14;
            const lureX = s * 0.88 + sway;
            const lureY = -s * 0.30;
            ctx.strokeStyle = lureColor;
            ctx.lineWidth = Math.max(1.3, s * 0.06);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(s * 0.18, -s * 0.42);
            ctx.quadraticCurveTo(s * 0.58, -s * 0.84, lureX, lureY);
            ctx.stroke();

            drawSoftGlowCanvas(
                art, ctx,
                lureX, lureY + s * 0.06,
                s * (0.36 * pulse),
                opts.isShiny ? 'rgba(244, 114, 182, 0.72)' : 'rgba(103, 232, 249, 0.72)',
                opts.isShiny ? 'rgba(254, 240, 138, 0.2)' : 'rgba(56, 189, 248, 0.2)'
            );
            ctx.fillStyle = lureCore;
            ctx.beginPath();
            ctx.ellipse(lureX, lureY + s * 0.06, Math.max(2.0, s * 0.09), Math.max(2.4, s * 0.115), 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(lureX, lureY + s * 0.05, Math.max(1.0, s * 0.045), 0, Math.PI * 2);
            ctx.fill();

            // 6. 幽微生物发光器点缀
            ctx.fillStyle = lureCore;
            for (let i = 0; i < 4; i++) {
                ctx.globalAlpha = 0.55 + 0.3 * Math.sin(time * 3 + i);
                ctx.beginPath();
                ctx.arc(-s * (0.25 - i * 0.16), s * (0.14 + (i % 2) * 0.08), Math.max(1, s * 0.03), 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;

            // 7. 深海胸鳍
            const pecFlap = Math.sin(finPhase) * 0.25;
            ctx.save();
            ctx.translate(-s * 0.04, s * 0.16);
            ctx.rotate(pecFlap);
            ctx.fillStyle = opts.isShiny ? palette.finDark : '#1e1b4b';
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-s * 0.24, s * 0.16);
            ctx.lineTo(-s * 0.16, s * 0.24);
            ctx.lineTo(-s * 0.22, s * 0.30);
            ctx.lineTo(-s * 0.04, s * 0.24);
            ctx.closePath();
            ctx.fill();
            ctx.restore();

            // 8. 幽光凶目
            art.drawCanvasEye(ctx, s * 0.36, -s * 0.22, Math.max(2.1, s * 0.092), lureColor, { style: 'glow' });

            ctx.restore();
        }
    };

    // ========================================================================
    // 3. 幽蓝古鲟 (phantom_sturgeon) - 传说 Legendary
    // ========================================================================
    WWF.FISH_MODELS.phantom_sturgeon = {
        motion: {
            swimStyle: 'majestic',
            tailFreq: 6.8,
            tailAmp: 0.22,
            bodyFlex: 0.22,
            pectoralFreq: 4.5,
            turnAgility: 0.75,
            bobAmp: 2.2,
            tailPivot: '54px 62px'
        },

        buildSVGContent({ isSilhouette, isShiny, uid, palette, art }) {
            const bodyPath =
                'M 54,62 L 62,54 Q 96,42 142,46 Q 166,49 187,57 Q 188,60 176,63 ' +
                'Q 164,65 152,65 Q 154,69 144,72 Q 112,77 72,72 L 54,66 Z';
            const tailPath = 'M 56,64 L 14,20 Q 27,44 35,62 L 42,66 L 29,85 L 48,68 Z';
            const dorsalPath = 'M 63,53 Q 66,34 83,39 Q 81,47 78,49 Z';
            const analPath = 'M 64,71 Q 67,87 80,85 Q 81,76 76,72 Z';
            const pelvicPath = 'M 91,73 Q 88,88 103,87 Q 108,79 102,73 Z';
            const pecPath = 'M 129,69 Q 111,87 122,94 Q 139,87 142,70 Z';

            const topNavy = isSilhouette ? palette.bodyDark : (isShiny ? palette.bodyDark : '#0a1938');
            const midRoyal = isSilhouette ? palette.body : (isShiny ? palette.body : '#1d4ed8');
            const bellyIce = isSilhouette ? palette.belly : (isShiny ? palette.bellyWarm : '#bfdbfe');
            const scuteLight = isSilhouette ? palette.bodyLight : (isShiny ? '#fef08a' : '#93c5fd');
            const scuteShade = isSilhouette ? palette.bodyDark : (isShiny ? '#db2777' : '#1e40af');
            const outline = isSilhouette ? palette.stroke : (isShiny ? palette.outline : '#071330');
            const barbColor = isSilhouette ? palette.stroke : (isShiny ? '#fef08a' : '#bae6fd');

            // 3D 双切面渐变大小骨甲（由头至尾自然收小，绝非等大灰三角）
            const dorsalScuteSpecs = [
                [141, 46, 4.8], [129, 45, 5.0], [117, 44, 4.7],
                [105, 44, 4.3], [94, 46, 3.8], [84, 48, 3.2]
            ];
            const dorsalScutes = dorsalScuteSpecs.map(([sx, sy, sh]) => `
                <polygon points="${sx - sh},${sy + 1} ${sx + 0.5},${sy - sh} ${sx + 0.5},${sy + 1}" fill="${isSilhouette ? palette.body : scuteLight}" stroke="${outline}" stroke-width="0.65"/>
                <polygon points="${sx + 0.5},${sy + 1} ${sx + 0.5},${sy - sh} ${sx + sh * 1.05},${sy + 1}" fill="${isSilhouette ? palette.bodyDark : scuteShade}" stroke="${outline}" stroke-width="0.65"/>
            `).join('');

            let lateralScutes = '';
            if (!isSilhouette) {
                const latSpecs = [
                    [144, 59, 4.0], [134, 58.5, 4.2], [123, 58, 4.3],
                    [112, 58, 4.1], [101, 58.5, 3.8], [90, 59, 3.5],
                    [80, 60, 3.1], [70, 61, 2.7]
                ];
                lateralScutes += `<path d="M 64,62 Q 108,56 150,59" fill="none" stroke="${scuteLight}" stroke-width="1.0" opacity="0.48"/>`;
                latSpecs.forEach(([lx, ly, lr]) => {
                    lateralScutes += `
                        <polygon points="${lx - lr},${ly} ${lx},${ly - lr * 0.72} ${lx + lr},${ly} ${lx},${ly + 0.4}" fill="${scuteLight}" opacity="0.86"/>
                        <polygon points="${lx - lr},${ly} ${lx},${ly + 0.4} ${lx + lr},${ly} ${lx},${ly + lr * 0.72}" fill="${scuteShade}" stroke="${scuteLight}" stroke-width="0.45" opacity="0.82"/>
                    `;
                });
            }

            const barbels = `
                <g fill="none" stroke="${barbColor}" stroke-width="1.35" stroke-linecap="round">
                    <path d="M 173,63 Q 171,72 165,77"/>
                    <path d="M 169,63 Q 167,71 162,75"/>
                    <path d="M 164,64 Q 161,72 156,77"/>
                    <path d="M 160,64 Q 157,70 153,73"/>
                </g>
            `;

            return `
                <defs>
                    <linearGradient id="${uid}_body" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${topNavy}"/>
                        <stop offset="48%" stop-color="${midRoyal}"/>
                        <stop offset="86%" stop-color="${bellyIce}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_tail" x1="100%" y1="50%" x2="0%" y2="0%">
                        <stop offset="0%" stop-color="${midRoyal}"/>
                        <stop offset="55%" stop-color="${isSilhouette ? palette.fin : (isShiny ? palette.fin : '#38bdf8')}"/>
                        <stop offset="100%" stop-color="${isSilhouette ? palette.finLight : (isShiny ? palette.finLight : '#e0f2fe')}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_fin" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${isSilhouette ? palette.fin : (isShiny ? palette.fin : '#2563eb')}" stop-opacity="0.90"/>
                        <stop offset="100%" stop-color="${isSilhouette ? palette.finLight : (isShiny ? palette.finLight : '#bae6fd')}" stop-opacity="${isSilhouette ? 0.88 : 0.56}"/>
                    </linearGradient>
                    <clipPath id="${uid}_clip">
                        <path d="${bodyPath}"/>
                    </clipPath>
                </defs>

                <g class="svg-fish-tail">
                    <path d="${tailPath}" fill="url(#${uid}_tail)" stroke="${outline}" stroke-width="1.35" stroke-linejoin="round"/>
                    ${isSilhouette ? '' : `<path d="M 55,63 L 19,24" fill="none" stroke="${scuteLight}" stroke-width="1.6" opacity="0.72" stroke-linecap="round"/>`}
                    ${!isSilhouette ? art.svgFinRays(['M 48,58 L 24,33', 'M 46,62 L 32,48', 'M 47,65 L 33,77'], 'rgba(224,242,254,0.6)', 0.68, 0.9) : ''}
                </g>
                <path d="${dorsalPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.15" stroke-linejoin="round"/>
                <path d="${analPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.15" stroke-linejoin="round"/>
                <path d="${pelvicPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.1" stroke-linejoin="round"/>
                ${dorsalScutes}
                <path d="${bodyPath}" fill="url(#${uid}_body)" stroke="${outline}" stroke-width="1.5" stroke-linejoin="round"/>
                <g clip-path="url(#${uid}_clip)">
                    ${isSilhouette ? '' : `<path d="M 62,51 Q 112,43 176,56" fill="none" stroke="rgba(224,242,254,0.45)" stroke-width="2.6" stroke-linecap="round"/>`}
                    ${lateralScutes}
                </g>
                ${barbels}
                <g class="svg-fish-pec" style="transform-box: view-box; transform-origin: 136px 70px;">
                    <path d="${pecPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.15" stroke-linejoin="round" opacity="0.94"/>
                    ${!isSilhouette ? art.svgFinRays(['M 131,72 L 122,88', 'M 134,72 L 129,87'], 'rgba(224,242,254,0.56)', 0.62, 0.85) : ''}
                </g>
                ${art.svgEye(158, 55, 3.9, isSilhouette, isShiny ? palette.iris : '#7dd3fc', { style: 'glow', uid })}
                ${art.svgShinyOverlay(isSilhouette, isShiny)}
            `;
        },

        drawCanvas(ctx, size, time, opts) {
            const s = Math.max(8, safeNum(size, 26));
            const palette = opts.palette;
            const art = opts.art;
            const wagPhase = safeNum(opts.wagPhase, time * 6.8);
            const finPhase = safeNum(opts.finPhase, time * 4.5);
            const phaseOffset = safeNum(opts.phaseOffset, 0);
            const bodyBend = safeNum(opts.bodyBend, 0);
            const speedRatio = safeNum(opts.speedRatio, 1);

            const pts = art.buildSpinePoints(
                s * 1.18,
                -s * 0.86,
                8,
                bodyBend,
                wagPhase,
                s * 0.065 * (0.7 + speedRatio * 0.3),
                0.75
            );
            const widths = [s * 0.045, s * 0.155, s * 0.265, s * 0.275, s * 0.255, s * 0.21, s * 0.155, s * 0.09];
            const outline = opts.isShiny ? palette.outline : '#071330';
            const scuteLight = opts.isShiny ? '#fef08a' : '#93c5fd';
            const scuteShade = opts.isShiny ? '#db2777' : '#1e40af';

            ctx.save();

            // 1. 歪型高上叶鲨尾
            const tailF = getSpineFrame(pts, pts.length - 1);
            const tailWag = Math.sin(wagPhase - 1.4) * 0.25 + bodyBend * 0.45;
            ctx.save();
            ctx.translate(tailF.x, tailF.y);
            ctx.rotate(tailF.ang * 0.6 + tailWag);
            const tailGrad = ctx.createLinearGradient(0, 0, -s * 0.56, -s * 0.62);
            tailGrad.addColorStop(0, opts.isShiny ? palette.body : '#1d4ed8');
            tailGrad.addColorStop(0.6, opts.isShiny ? palette.fin : '#38bdf8');
            tailGrad.addColorStop(1, opts.isShiny ? palette.finLight : '#e0f2fe');
            ctx.fillStyle = tailGrad;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-s * 0.58, -s * 0.62);
            ctx.quadraticCurveTo(-s * 0.36, -s * 0.12, -s * 0.22, s * 0.06);
            ctx.lineTo(-s * 0.34, s * 0.30);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.9, s * 0.036);
            ctx.stroke();
            ctx.restore();

            // 2. 后置背鳍与臀鳍
            const rearF = getSpineFrame(pts, 6);
            ctx.fillStyle = opts.isShiny ? palette.fin : '#2563eb';
            ctx.beginPath();
            ctx.moveTo(rearF.x + s * 0.08, rearF.y - s * 0.12);
            ctx.quadraticCurveTo(rearF.x - s * 0.04, rearF.y - s * 0.42, rearF.x - s * 0.18, rearF.y - s * 0.28);
            ctx.lineTo(rearF.x - s * 0.06, rearF.y - s * 0.10);
            ctx.closePath();
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(rearF.x + s * 0.04, rearF.y + s * 0.12);
            ctx.lineTo(rearF.x - s * 0.12, rearF.y + s * 0.34);
            ctx.lineTo(rearF.x - s * 0.06, rearF.y + s * 0.11);
            ctx.closePath();
            ctx.fill();

            // 3. 铠甲躯干 + 犁状尖吻
            const bodyGrad = ctx.createLinearGradient(0, -s * 0.32, 0, s * 0.32);
            bodyGrad.addColorStop(0, opts.isShiny ? palette.bodyDark : '#0a1938');
            bodyGrad.addColorStop(0.5, opts.isShiny ? palette.body : '#1d4ed8');
            bodyGrad.addColorStop(1, opts.isShiny ? palette.bellyWarm : '#bfdbfe');
            art.drawCanvasSpineRibbon(ctx, pts, widths, bodyGrad, outline, Math.max(1.0, s * 0.042));

            const headF = getSpineFrame(pts, 0);
            const neckF = getSpineFrame(pts, 1);
            ctx.fillStyle = bodyGrad;
            ctx.beginPath();
            ctx.moveTo(neckF.x, neckF.y - widths[1]);
            ctx.lineTo(headF.x + s * 0.18, headF.y);
            ctx.lineTo(neckF.x, neckF.y + widths[1] * 0.85);
            ctx.closePath();
            ctx.fill();

            // 背脊寒冰高光脉线
            ctx.save();
            ctx.strokeStyle = opts.isShiny ? 'rgba(254, 240, 138, 0.48)' : 'rgba(224, 242, 254, 0.48)';
            ctx.lineWidth = Math.max(0.9, s * 0.04);
            ctx.lineCap = 'round';
            ctx.beginPath();
            for (let i = 1; i <= 6; i++) {
                const vx = pts[i].x;
                const vy = pts[i].y - widths[i] * 0.65;
                if (i === 1) ctx.moveTo(vx, vy);
                else ctx.lineTo(vx, vy);
            }
            ctx.stroke();
            ctx.restore();

            // 4. 4 根渐细吻须
            ctx.strokeStyle = opts.isShiny ? '#fef08a' : '#bae6fd';
            ctx.lineWidth = Math.max(0.9, s * 0.034);
            ctx.lineCap = 'round';
            for (let b = 0; b < 4; b++) {
                const bx = lerp(headF.x + s * 0.06, neckF.x + s * 0.04, b / 3);
                const by = lerp(headF.y + s * 0.03, neckF.y + s * 0.11, b / 3);
                const sway = Math.sin(time * 5 + b + phaseOffset) * s * 0.03;
                ctx.beginPath();
                ctx.moveTo(bx, by);
                ctx.quadraticCurveTo(bx - s * 0.04, by + s * 0.12, bx - s * 0.12 + sway, by + s * 0.19);
                ctx.stroke();
            }

            // 5. 渐变立体双面骨甲
            for (let i = 2; i <= 6; i++) {
                const f = getSpineFrame(pts, i);
                const w = widths[i];
                const scaleFactor = 1 - (i - 2) * 0.10;
                const sh = s * 0.12 * scaleFactor;

                ctx.fillStyle = scuteLight;
                ctx.beginPath();
                ctx.moveTo(f.x - s * 0.055 * scaleFactor, f.y - w * 0.88);
                ctx.lineTo(f.x, f.y - w * 0.88 - sh);
                ctx.lineTo(f.x, f.y - w * 0.88);
                ctx.closePath();
                ctx.fill();

                ctx.fillStyle = scuteShade;
                ctx.beginPath();
                ctx.moveTo(f.x, f.y - w * 0.88);
                ctx.lineTo(f.x, f.y - w * 0.88 - sh);
                ctx.lineTo(f.x + s * 0.055 * scaleFactor, f.y - w * 0.88);
                ctx.closePath();
                ctx.fill();

                // 侧线双面菱盾骨板
                ctx.fillStyle = scuteLight;
                ctx.beginPath();
                ctx.moveTo(f.x - s * 0.06 * scaleFactor, f.y);
                ctx.lineTo(f.x, f.y - s * 0.045 * scaleFactor);
                ctx.lineTo(f.x + s * 0.06 * scaleFactor, f.y);
                ctx.closePath();
                ctx.fill();

                ctx.fillStyle = scuteShade;
                ctx.beginPath();
                ctx.moveTo(f.x - s * 0.06 * scaleFactor, f.y);
                ctx.lineTo(f.x + s * 0.06 * scaleFactor, f.y);
                ctx.lineTo(f.x, f.y + s * 0.045 * scaleFactor);
                ctx.closePath();
                ctx.fill();
            }

            // 6. 宽翼胸鳍
            const pecF = getSpineFrame(pts, 2);
            const pecFlap = Math.sin(finPhase) * 0.22;
            ctx.save();
            ctx.translate(pecF.x, pecF.y + widths[2] * 0.72);
            ctx.rotate(pecFlap);
            ctx.fillStyle = opts.isShiny ? palette.fin : '#38bdf8';
            ctx.globalAlpha = 0.84;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(-s * 0.26, s * 0.24, -s * 0.12, s * 0.36);
            ctx.quadraticCurveTo(s * 0.06, s * 0.24, s * 0.08, 0);
            ctx.closePath();
            ctx.fill();
            ctx.restore();

            // 7. 寒冰古兽眼
            art.drawCanvasEye(ctx, lerp(headF.x, neckF.x, 0.65), lerp(headF.y, neckF.y, 0.65) - s * 0.04, Math.max(1.9, s * 0.075), scuteLight, { style: 'glow' });

            ctx.restore();
        }
    };

    // ========================================================================
    // 4. 星辰月光鱼 (moonfish) - 神话 Mythic (银河流纱仙灵鱼)
    // ========================================================================
    WWF.FISH_MODELS.moonfish = {
        motion: {
            swimStyle: 'hover',
            tailFreq: 5.8,
            tailAmp: 0.18,
            bodyFlex: 0.12,
            pectoralFreq: 5.0,
            turnAgility: 0.90,
            bobAmp: 4.5,
            tailPivot: '58px 60px'
        },

        buildSVGContent({ isSilhouette, isShiny, uid, palette, art }) {
            // 新月神仙轮廓 + 极光超长流纱翼鳍与双飘带燕尾
            const bodyPath =
                'M 58,60 C 64,34 89,22 117,25 C 139,28 150,44 153,55 ' +
                'Q 157,60 153,65 C 150,76 139,92 117,95 C 89,98 64,86 58,60 Z';
            const dorsalVeil =
                'M 96,25 C 78,6 44,4 18,12 C 42,16 62,25 70,40 Q 86,33 108,26 Z';
            const analVeil =
                'M 96,95 C 78,114 44,116 18,108 C 42,104 62,95 70,80 Q 86,87 108,94 Z';
            const tailPath =
                'M 60,57 C 46,35 28,22 12,26 C 24,41 34,53 38,60 C 34,67 24,79 12,94 C 28,98 46,85 60,63 Z';
            const pecPath =
                'M 118,62 C 106,61 102,71 109,75 C 116,76 122,69 120,63 Z';

            const nebCore = isSilhouette ? palette.body : (isShiny ? '#f5b938' : '#6366f1');
            const nebEdge = isSilhouette ? palette.bodyDark : (isShiny ? '#9a3412' : '#1e1b4b');
            const veilPink = isSilhouette ? palette.fin : (isShiny ? palette.fin : '#f472b6');
            const veilCyan = isSilhouette ? palette.finLight : (isShiny ? palette.finLight : '#bae6fd');
            const starGold = isSilhouette ? palette.fin : (isShiny ? '#ffffff' : '#fef08a');
            const outline = isSilhouette ? palette.stroke : (isShiny ? palette.outline : '#312e81');
            const veilOutline = isSilhouette ? palette.stroke : (isShiny ? 'rgba(254, 240, 138, 0.55)' : 'rgba(196, 181, 253, 0.48)');

            const floatAura = isSilhouette ? '' : `
                <g class="svg-fish-float-aura">
                    <circle cx="105" cy="60" r="46" fill="url(#${uid}_aura_grad)"/>
                    <path d="M 142,18 A 45,45 0 1,0 142,102 A 40,43 0 1,1 142,18 Z" fill="${starGold}" opacity="0.24"/>
                    <path d="M 46,24 L 47.6,28.5 L 52,30 L 47.6,31.5 L 46,36 L 44.4,31.5 L 40,30 L 44.4,28.5 Z" fill="${starGold}" opacity="0.9"/>
                    <path d="M 157,82 L 158.3,85.5 L 162,86.8 L 158.3,88.1 L 157,91.6 L 155.7,88.1 L 152,86.8 L 155.7,85.5 Z" fill="${veilCyan}" opacity="0.88"/>
                    <circle cx="155" cy="30" r="1.5" fill="#f9a8d4" opacity="0.88"/>
                    <circle cx="24" cy="24" r="1.2" fill="${starGold}" opacity="0.8"/>
                    <circle cx="24" cy="96" r="1.2" fill="${veilCyan}" opacity="0.8"/>
                </g>
            `;

            const nebulaInside = isSilhouette ? '' : `
                <g clip-path="url(#${uid}_clip)">
                    <path d="M 64,74 Q 95,46 138,44" fill="none" stroke="${veilCyan}" stroke-width="10" opacity="0.24" stroke-linecap="round"/>
                    <path d="M 70,42 Q 108,68 144,74" fill="none" stroke="${veilPink}" stroke-width="8" opacity="0.22" stroke-linecap="round"/>
                    <!-- 黄金新月与星座微连线 -->
                    <path d="M 96,46 A 11,11 0 1,0 96,68 A 8.5,10 0 1,1 96,46 Z" fill="${starGold}" opacity="0.78"/>
                    <path d="M 78,48 L 114,47 L 122,72 L 104,79 L 78,69" fill="none" stroke="${starGold}" stroke-width="0.7" opacity="0.48"/>
                    <path d="M 114,42 L 115.6,46 L 119.6,47.6 L 115.6,49.2 L 114,53.2 L 112.4,49.2 L 108.4,47.6 L 112.4,46 Z" fill="#ffffff" opacity="0.92"/>
                    <path d="M 122,68 L 123.2,71 L 126.2,72.2 L 123.2,73.4 L 122,76.4 L 120.8,73.4 L 117.8,72.2 L 120.8,71 Z" fill="${starGold}" opacity="0.85"/>
                    <circle cx="78" cy="48" r="1.4" fill="#ffffff" opacity="0.88"/>
                    <circle cx="78" cy="69" r="1.3" fill="${veilCyan}" opacity="0.85"/>
                    <circle cx="104" cy="79" r="1.6" fill="#f9a8d4" opacity="0.85"/>
                </g>
            `;

            return `
                <defs>
                    <radialGradient id="${uid}_nebula" cx="56%" cy="44%" r="64%">
                        <stop offset="0%" stop-color="${isSilhouette ? palette.bodyLight : (isShiny ? '#f472b6' : '#a78bfa')}"/>
                        <stop offset="52%" stop-color="${nebCore}"/>
                        <stop offset="100%" stop-color="${nebEdge}"/>
                    </radialGradient>
                    <linearGradient id="${uid}_veil" x1="100%" y1="50%" x2="0%" y2="50%">
                        <stop offset="0%" stop-color="${veilPink}" stop-opacity="${isSilhouette ? 0.94 : 0.88}"/>
                        <stop offset="56%" stop-color="${starGold}" stop-opacity="${isSilhouette ? 0.88 : 0.62}"/>
                        <stop offset="100%" stop-color="${veilCyan}" stop-opacity="${isSilhouette ? 0.84 : 0.34}"/>
                    </linearGradient>
                    ${isSilhouette ? '' : `
                    <radialGradient id="${uid}_aura_grad" cx="50%" cy="50%" r="50%">
                        <stop offset="45%" stop-color="#c4b5fd" stop-opacity="0.22"/>
                        <stop offset="80%" stop-color="${veilPink}" stop-opacity="0.10"/>
                        <stop offset="100%" stop-color="${veilPink}" stop-opacity="0"/>
                    </radialGradient>
                    `}
                    <clipPath id="${uid}_clip">
                        <path d="${bodyPath}"/>
                    </clipPath>
                </defs>

                ${floatAura}

                <!-- 竖琴双飘带薄纱尾翼 -->
                <g class="svg-fish-tail">
                    <path d="${tailPath}" fill="url(#${uid}_veil)" stroke="${veilOutline}" stroke-width="1.0" stroke-linejoin="round"/>
                    ${!isSilhouette ? art.svgFinRays([
                        'M 55,58 Q 34,40 16,28',
                        'M 55,62 Q 34,80 16,92'
                    ], 'rgba(254,240,138,0.68)', 0.68, 0.9) : ''}
                </g>

                <!-- 极光长羽纱背鳍与臀鳍 -->
                <g class="svg-fish-veil">
                    <path d="${dorsalVeil}" fill="url(#${uid}_veil)" stroke="${veilOutline}" stroke-width="1.0" stroke-linejoin="round"/>
                    <path d="${analVeil}" fill="url(#${uid}_veil)" stroke="${veilOutline}" stroke-width="1.0" stroke-linejoin="round"/>
                    ${!isSilhouette ? art.svgFinRays([
                        'M 86,27 Q 58,12 24,13',
                        'M 86,93 Q 58,108 24,107'
                    ], 'rgba(254,240,138,0.62)', 0.62, 0.85) : ''}
                </g>

                <path d="${bodyPath}" fill="url(#${uid}_nebula)" stroke="${outline}" stroke-width="1.5" stroke-linejoin="round"/>
                ${nebulaInside}

                <!-- 胸鳍（锚定关节根部，移离黄金新月不遮挡） -->
                <g class="svg-fish-pec" style="transform-box: view-box; transform-origin: 118px 64px;">
                    <path d="${pecPath}" fill="${isSilhouette ? palette.fin : (isShiny ? 'rgba(254,249,195,0.56)' : 'rgba(224,242,254,0.58)')}" stroke="${veilOutline}" stroke-width="0.95"/>
                </g>

                ${art.svgEye(132, 52, 5.2, isSilhouette, isShiny ? '#fef08a' : '#c4b5fd', { style: 'celestial', uid })}
                ${art.svgShinyOverlay(isSilhouette, isShiny)}
            `;
        },

        drawCanvas(ctx, size, time, opts) {
            const s = Math.max(8, safeNum(size, 30));
            const palette = opts.palette;
            const art = opts.art;
            const wagPhase = safeNum(opts.wagPhase, time * 5.8);
            const finPhase = safeNum(opts.finPhase, time * 5.0);
            const phaseOffset = safeNum(opts.phaseOffset, 0);
            const bodyBend = safeNum(opts.bodyBend, 0);
            const bob = Math.sin(time * 2.4 + phaseOffset) * s * 0.06;
            const finWave = Math.sin(wagPhase * 0.75) * s * 0.14 + bodyBend * s * 0.25;
            const outline = opts.isShiny ? palette.outline : '#312e81';
            const veilOutline = opts.isShiny ? 'rgba(254,240,138,0.55)' : 'rgba(196,181,253,0.48)';
            const veilPink = opts.isShiny ? palette.fin : '#f472b6';
            const veilCyan = opts.isShiny ? palette.finLight : '#bae6fd';
            const starGold = '#fef08a';

            ctx.save();
            ctx.translate(0, bob);

            // 1. 柔和新月光环与星尘
            drawSoftGlowCanvas(
                art, ctx, 0, 0, s * 1.18,
                opts.isShiny ? 'rgba(254, 240, 138, 0.26)' : 'rgba(196, 181, 253, 0.24)',
                'rgba(99, 102, 241, 0.08)'
            );
            ctx.strokeStyle = opts.isShiny ? 'rgba(254,240,138,0.48)' : 'rgba(196,181,253,0.44)';
            ctx.lineWidth = Math.max(0.9, s * 0.036);
            ctx.beginPath();
            ctx.arc(-s * 0.05, 0, s * 0.94, -Math.PI * 0.62, Math.PI * 0.62);
            ctx.stroke();

            // 2. 超长极光流纱上下羽翼（顺滑渐细尖端）
            const veilGrad = ctx.createLinearGradient(s * 0.2, 0, -s * 1.18, 0);
            veilGrad.addColorStop(0, veilPink);
            veilGrad.addColorStop(0.55, starGold);
            veilGrad.addColorStop(1, opts.isShiny ? 'rgba(56,189,248,0.28)' : 'rgba(186,230,253,0.28)');

            ctx.fillStyle = veilGrad;
            ctx.strokeStyle = veilOutline;
            ctx.lineWidth = Math.max(0.75, s * 0.032);

            ctx.beginPath();
            ctx.moveTo(s * 0.12, -s * 0.62);
            ctx.bezierCurveTo(-s * 0.34, -s * 1.14 + finWave * 0.4, -s * 0.85, -s * 1.08 + finWave * 0.7, -s * 1.18, -s * 0.86 + finWave);
            ctx.quadraticCurveTo(-s * 0.78, -s * 0.80 + finWave * 0.4, -s * 0.34, -s * 0.40);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(s * 0.12, s * 0.62);
            ctx.bezierCurveTo(-s * 0.34, s * 1.14 + finWave * 0.4, -s * 0.85, s * 1.08 + finWave * 0.7, -s * 1.18, s * 0.86 + finWave);
            ctx.quadraticCurveTo(-s * 0.78, s * 0.80 + finWave * 0.4, -s * 0.34, s * 0.40);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // 3. 竖琴双飘带燕尾
            ctx.save();
            ctx.translate(-s * 0.56, 0);
            ctx.rotate(Math.sin(wagPhase) * 0.2 + bodyBend * 0.35);
            ctx.fillStyle = veilGrad;
            ctx.beginPath();
            ctx.moveTo(0, -s * 0.08);
            ctx.quadraticCurveTo(-s * 0.34, -s * 0.52, -s * 0.66, -s * 0.48);
            ctx.quadraticCurveTo(-s * 0.32, -s * 0.06, -s * 0.24, 0);
            ctx.quadraticCurveTo(-s * 0.32, s * 0.06, -s * 0.66, s * 0.48);
            ctx.quadraticCurveTo(-s * 0.34, s * 0.52, 0, s * 0.08);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 4. 修长新月星云体腔
            const nebGrad = ctx.createRadialGradient(s * 0.12, -s * 0.1, s * 0.08, 0, 0, s * 0.78);
            nebGrad.addColorStop(0, opts.isShiny ? '#f472b6' : '#a78bfa');
            nebGrad.addColorStop(0.55, opts.isShiny ? '#f5b938' : '#4338ca');
            nebGrad.addColorStop(1, opts.isShiny ? '#9a3412' : '#1e1b4b');
            ctx.fillStyle = nebGrad;
            ctx.beginPath();
            ctx.ellipse(0, 0, s * 0.64, s * 0.72, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(1.0, s * 0.042);
            ctx.stroke();

            // 5. 体内金色新月、星座连线与星火花
            ctx.save();
            ctx.fillStyle = starGold;
            ctx.globalAlpha = 0.75;
            ctx.beginPath();
            ctx.arc(-s * 0.14, -s * 0.02, s * 0.18, Math.PI * 0.32, Math.PI * 1.68, false);
            ctx.bezierCurveTo(-s * 0.18, -s * 0.10, -s * 0.18, s * 0.06, -s * 0.05, s * 0.13);
            ctx.closePath();
            ctx.fill();
            ctx.restore();

            ctx.strokeStyle = 'rgba(254,240,138,0.48)';
            ctx.lineWidth = Math.max(0.7, s * 0.025);
            ctx.beginPath();
            ctx.moveTo(-s * 0.22, -s * 0.24);
            ctx.lineTo(s * 0.06, -s * 0.32);
            ctx.lineTo(s * 0.16, s * 0.20);
            ctx.lineTo(-s * 0.18, s * 0.22);
            ctx.stroke();

            const starNodes = [[-s * 0.22, -s * 0.24, 0.10], [s * 0.06, -s * 0.32, 0.12], [s * 0.16, s * 0.20, 0.11], [-s * 0.18, s * 0.22, 0.09]];
            for (let i = 0; i < starNodes.length; i++) {
                const [sx, sy, sr] = starNodes[i];
                const tw = 0.55 + 0.45 * Math.sin(time * 3.8 + i * 1.7);
                drawStarSparkCanvas(ctx, sx, sy, s * sr, i % 2 === 0 ? '#ffffff' : starGold, tw);
            }

            // 6. 翼状胸鳍与星空星芒眼
            const pecFlap = Math.sin(finPhase) * 0.32;
            ctx.save();
            ctx.translate(s * 0.14, s * 0.10);
            ctx.rotate(pecFlap);
            ctx.fillStyle = opts.isShiny ? 'rgba(254,249,195,0.68)' : 'rgba(224,242,254,0.68)';
            ctx.beginPath();
            ctx.ellipse(-s * 0.10, s * 0.06, s * 0.14, s * 0.08, -0.35, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            art.drawCanvasEye(ctx, s * 0.36, -s * 0.12, Math.max(2.3, s * 0.10), opts.isShiny ? '#fef08a' : '#c4b5fd', { style: 'celestial' });

            ctx.restore();
        }
    };

    // ========================================================================
    // 5. 龙宫赤金龙 (dragon_koi) - 神话 Mythic (对称双龙角 + 流焰丝绸背鳍)
    // ========================================================================
    WWF.FISH_MODELS.dragon_koi = {
        motion: {
            swimStyle: 'majestic',
            tailFreq: 7.4,
            tailAmp: 0.25,
            bodyFlex: 0.26,
            pectoralFreq: 5.2,
            turnAgility: 0.95,
            bobAmp: 3.4,
            tailPivot: '50px 62px'
        },

        buildSVGContent({ isSilhouette, isShiny, uid, palette, art }) {
            const bodyPath =
                'M 50,62 C 74,40 116,38 154,44 C 168,47 177,53 177,60 ' +
                'C 175,66 164,72 148,75 C 114,82 74,80 50,62 Z';
            const tailPath =
                'M 52,61 C 36,33 19,17 12,27 C 23,41 29,51 31,58 L 15,60 L 31,64 ' +
                'C 28,72 22,82 13,95 C 21,103 38,88 52,63 Z';
            // 流动烈焰丝绸背鳍（流畅无凹陷）
            const dorsalPath =
                'M 62,50 C 69,27 92,16 116,18 C 125,19 131,26 133,37 C 108,38 83,42 62,50 Z';
            const manePath = 'M 145,43 C 134,34 123,35 117,40 C 127,42 135,45 142,46 Z';
            const pelvicPath = 'M 88,76 Q 74,94 94,97 Q 104,88 100,77 Z';
            const pecPath = 'M 132,68 Q 108,82 114,97 Q 134,91 140,71 Z';

            const crimsonDark = isSilhouette ? palette.bodyDark : (isShiny ? '#9a3412' : '#991b1b');
            const crimsonMid = isSilhouette ? palette.body : (isShiny ? palette.body : '#dc2626');
            const flameGold = isSilhouette ? palette.fin : (isShiny ? palette.fin : '#f59e0b');
            const scaleGold = isSilhouette ? palette.bodyLight : '#fde047';
            const outline = isSilhouette ? palette.stroke : (isShiny ? palette.outline : '#6b1111');
            const finOutline = isSilhouette ? palette.stroke : (isShiny ? 'rgba(120, 53, 15, 0.45)' : 'rgba(107, 17, 17, 0.45)');

            const dragonScales = isSilhouette ? '' : art.svgScalePatch([
                { y: 49, xs: [74, 86, 98, 110, 122, 134], alpha: 0.72 },
                { y: 57, xs: [68, 80, 92, 104, 116, 128], alpha: 0.90 },
                { y: 65, xs: [74, 86, 98, 110, 122, 134], alpha: 0.74 }
            ], {
                rx: 4.5, ry: 4.0,
                rimColor: scaleGold,
                shadowColor: 'rgba(127,29,29,0.28)',
                rimWidth: 1.15
            });

            // 对称分叉玉金珊瑚双龙角（近侧亮金 + 远侧深琥珀，告别单根火柴棍）
            const antlers = `
                <g fill="none" stroke-linecap="round" stroke-linejoin="round">
                    <!-- 远侧龙角 -->
                    <path d="M 157,44 Q 148,26 135,14 M 148,29 Q 144,20 146,13" stroke="${isSilhouette ? palette.bodyDark : '#d97706'}" stroke-width="2.1" opacity="0.88"/>
                    <!-- 近侧主龙角 -->
                    <path d="M 149,43 Q 138,25 121,13 M 139,27 Q 135,17 137,10 M 132,21 Q 124,19 119,21" stroke="${isSilhouette ? palette.stroke : scaleGold}" stroke-width="2.5"/>
                </g>
            `;

            // 两条如红金丝带般向后飘拂的流光长龙须（与胸翼清晰分离）
            const whiskers = `
                <g fill="${isSilhouette ? palette.finLight : scaleGold}" stroke="${finOutline}" stroke-width="0.45">
                    <path d="M 173,61 C 185,61 190,68 182,75 C 172,82 155,82 139,77 C 154,79 170,79 179,73 C 186,67 183,63 171,63 Z"/>
                    <path d="M 168,65 C 179,70 181,81 171,90 C 161,97 148,98 136,94 C 148,95 160,94 168,87 C 176,80 175,71 166,67 Z"/>
                </g>
            `;

            // 祥云金雾点缀
            const cloudAura = isSilhouette ? '' : `
                <g class="svg-fish-float-aura" opacity="0.72">
                    <path d="M 42,32 Q 48,27 54,32 Q 58,31 59,35 Q 50,36 42,32 Z" fill="${scaleGold}" opacity="0.48"/>
                    <circle cx="176" cy="40" r="2.2" fill="#fef08a"/>
                    <circle cx="176" cy="40" r="4.8" fill="#fbbf24" opacity="0.32"/>
                </g>
            `;

            return `
                <defs>
                    <linearGradient id="${uid}_body" x1="0%" y1="0%" x2="8%" y2="100%">
                        <stop offset="0%" stop-color="${crimsonDark}"/>
                        <stop offset="46%" stop-color="${crimsonMid}"/>
                        <stop offset="80%" stop-color="${flameGold}"/>
                        <stop offset="100%" stop-color="${isSilhouette ? palette.belly : '#fef3c7'}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_tail" x1="100%" y1="50%" x2="0%" y2="50%">
                        <stop offset="0%" stop-color="${crimsonMid}"/>
                        <stop offset="52%" stop-color="${flameGold}"/>
                        <stop offset="100%" stop-color="${isSilhouette ? palette.finLight : '#fef9c3'}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_flame" x1="0%" y1="100%" x2="0%" y2="0%">
                        <stop offset="0%" stop-color="${crimsonMid}"/>
                        <stop offset="60%" stop-color="${flameGold}"/>
                        <stop offset="100%" stop-color="${isSilhouette ? palette.belly : '#fef08a'}"/>
                    </linearGradient>
                    <clipPath id="${uid}_clip">
                        <path d="${bodyPath}"/>
                    </clipPath>
                </defs>

                ${cloudAura}

                <g class="svg-fish-tail">
                    <path d="${tailPath}" fill="url(#${uid}_tail)" stroke="${finOutline}" stroke-width="1.15" stroke-linejoin="round"/>
                    ${!isSilhouette ? art.svgFinRays(['M 48,60 L 20,30', 'M 46,61 L 21,60', 'M 48,64 L 20,92'], 'rgba(254,240,138,0.72)', 0.72, 0.95) : ''}
                </g>

                <g class="svg-fish-veil">
                    <path d="${dorsalPath}" fill="url(#${uid}_flame)" stroke="${finOutline}" stroke-width="1.05" stroke-linejoin="round"/>
                    ${!isSilhouette ? art.svgFinRays(['M 76,44 Q 82,31 89,26', 'M 94,41 Q 100,27 107,22', 'M 112,39 Q 117,28 123,25'], 'rgba(254,249,195,0.68)', 0.68, 0.9) : ''}
                    <path d="${pelvicPath}" fill="url(#${uid}_flame)" stroke="${finOutline}" stroke-width="1.05" stroke-linejoin="round"/>
                </g>

                ${antlers}
                <path d="${manePath}" fill="${isSilhouette ? palette.fin : flameGold}" stroke="${outline}" stroke-width="1.0"/>

                <path d="${bodyPath}" fill="url(#${uid}_body)" stroke="${outline}" stroke-width="1.5" stroke-linejoin="round"/>
                <g clip-path="url(#${uid}_clip)">
                    ${dragonScales}
                    ${isSilhouette ? '' : `
                        <path d="M 60,72 Q 108,82 152,71" fill="none" stroke="${scaleGold}" stroke-width="4.5" opacity="0.45" stroke-linecap="round"/>
                        <path d="M 143,45 Q 135,58 143,72" fill="none" stroke="${outline}" stroke-width="1.6" opacity="0.58" stroke-linecap="round"/>
                    `}
                </g>

                <g class="svg-fish-pec" style="transform-box: view-box; transform-origin: 132px 69px;">
                    <path d="${pecPath}" fill="url(#${uid}_flame)" stroke="${finOutline}" stroke-width="1.05" stroke-linejoin="round" opacity="0.94"/>
                    ${!isSilhouette ? art.svgFinRays(['M 131,72 L 118,90', 'M 133,73 L 125,91'], 'rgba(254,240,138,0.65)', 0.65, 0.85) : ''}
                </g>

                ${whiskers}
                ${art.svgEye(154, 52, 4.9, isSilhouette, isShiny ? '#f472b6' : '#fbbf24', { style: 'dragon', uid, browColor: outline })}
                ${art.svgShinyOverlay(isSilhouette, isShiny)}
            `;
        },

        drawCanvas(ctx, size, time, opts) {
            const s = Math.max(8, safeNum(size, 32));
            const palette = opts.palette;
            const art = opts.art;
            const wagPhase = safeNum(opts.wagPhase, time * 7.4);
            const finPhase = safeNum(opts.finPhase, time * 5.2);
            const phaseOffset = safeNum(opts.phaseOffset, 0);
            const bodyBend = safeNum(opts.bodyBend, 0);
            const speedRatio = safeNum(opts.speedRatio, 1);

            const pts = art.buildSpinePoints(
                s * 0.99,
                -s * 0.88,
                8,
                bodyBend * 1.05,
                wagPhase,
                s * 0.085 * (0.75 + speedRatio * 0.3),
                0.78
            );
            const widths = [0.18, 0.33, 0.40, 0.37, 0.31, 0.23, 0.15, 0.09].map(w => w * s);
            const outline = opts.isShiny ? palette.outline : '#6b1111';
            const finOutline = opts.isShiny ? 'rgba(120, 53, 15, 0.45)' : 'rgba(107, 17, 17, 0.45)';
            const crimsonMid = opts.isShiny ? palette.body : '#dc2626';
            const flameGold = opts.isShiny ? palette.fin : '#f59e0b';
            const goldC = '#fde047';

            ctx.save();

            // 1. 凤凰流焰长纱尾
            const tailF = getSpineFrame(pts, pts.length - 1);
            const tailWag = Math.sin(wagPhase - 1.5) * 0.3 + bodyBend * 0.48;
            ctx.save();
            ctx.translate(tailF.x, tailF.y);
            ctx.rotate(tailF.ang * 0.65 + tailWag);
            const tailGrad = ctx.createLinearGradient(0, 0, -s * 0.72, 0);
            tailGrad.addColorStop(0, crimsonMid);
            tailGrad.addColorStop(0.55, flameGold);
            tailGrad.addColorStop(1, 'rgba(254, 240, 138, 0.56)');
            ctx.fillStyle = tailGrad;
            ctx.strokeStyle = finOutline;
            ctx.lineWidth = Math.max(0.8, s * 0.036);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.bezierCurveTo(-s * 0.25, -s * 0.56, -s * 0.64, -s * 0.72, -s * 0.74, -s * 0.48);
            ctx.quadraticCurveTo(-s * 0.42, -s * 0.12, -s * 0.62, 0);
            ctx.quadraticCurveTo(-s * 0.42, s * 0.12, -s * 0.74, s * 0.48);
            ctx.bezierCurveTo(-s * 0.64, s * 0.72, -s * 0.25, s * 0.56, 0, 0);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 2. 流焰丝绸背鳍（彻底删除剑龙三角刺，改为流畅丝绸火焰脊帆）
            const dStart = getSpineFrame(pts, 2);
            const dMid = getSpineFrame(pts, 4);
            const dEnd = getSpineFrame(pts, 6);
            const dGrad = ctx.createLinearGradient(0, -s * 0.8, 0, -s * 0.2);
            dGrad.addColorStop(0, 'rgba(254,240,138,0.88)');
            dGrad.addColorStop(1, flameGold);
            ctx.fillStyle = dGrad;
            ctx.strokeStyle = finOutline;
            ctx.lineWidth = Math.max(0.75, s * 0.034);
            ctx.beginPath();
            ctx.moveTo(dStart.x, dStart.y - widths[2] * 0.85);
            ctx.bezierCurveTo(
                dStart.x - s * 0.08, dStart.y - widths[2] - s * 0.36,
                dMid.x, dMid.y - widths[4] - s * 0.40,
                dEnd.x - s * 0.12, dEnd.y - widths[6] - s * 0.16
            );
            ctx.lineTo(dEnd.x, dEnd.y - widths[6] * 0.85);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // 3. 赤金龙躯干
            const bodyGrad = ctx.createLinearGradient(0, -s * 0.42, 0, s * 0.42);
            bodyGrad.addColorStop(0, opts.isShiny ? '#9a3412' : '#991b1b');
            bodyGrad.addColorStop(0.48, crimsonMid);
            bodyGrad.addColorStop(0.84, flameGold);
            bodyGrad.addColorStop(1, '#fef3c7');
            art.drawCanvasSpineRibbon(ctx, pts, widths, bodyGrad, outline, Math.max(1.0, s * 0.044));

            // 4. 金边龙鳞纹
            ctx.save();
            ctx.strokeStyle = 'rgba(253, 224, 71, 0.65)';
            ctx.lineWidth = Math.max(0.85, s * 0.032);
            ctx.lineCap = 'round';
            const scaleR = Math.max(2, s * 0.092);
            for (let i = 1; i <= 5; i++) {
                const f = getSpineFrame(pts, i);
                const w = widths[i];
                for (let row = -1; row <= 1; row++) {
                    const stagger = ((i + row) % 2) * s * 0.04;
                    ctx.beginPath();
                    ctx.arc(f.x + stagger, f.y + row * w * 0.42, scaleR, -Math.PI * 0.40, Math.PI * 0.40);
                    ctx.stroke();
                }
            }
            ctx.restore();

            // 5. 成对分叉玉金双龙角 & 向后飘飞流光长须
            const headF = getSpineFrame(pts, 0);
            ctx.strokeStyle = '#d97706';
            ctx.lineWidth = Math.max(1.1, s * 0.046);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(headF.x + s * 0.02, headF.y - widths[0] * 0.82);
            ctx.quadraticCurveTo(headF.x - s * 0.16, headF.y - s * 0.36, headF.x - s * 0.32, headF.y - s * 0.50);
            ctx.stroke();

            ctx.strokeStyle = goldC;
            ctx.lineWidth = Math.max(1.3, s * 0.055);
            ctx.beginPath();
            ctx.moveTo(headF.x - s * 0.08, headF.y - widths[0] * 0.85);
            ctx.quadraticCurveTo(headF.x - s * 0.28, headF.y - s * 0.42, headF.x - s * 0.46, headF.y - s * 0.56);
            ctx.moveTo(headF.x - s * 0.26, headF.y - s * 0.36);
            ctx.lineTo(headF.x - s * 0.28, headF.y - s * 0.54);
            ctx.stroke();

            // 双条向后悠然飘曳的流光龙须
            const wWave = Math.sin(time * 4.5 + phaseOffset) * s * 0.06;
            ctx.lineWidth = Math.max(1.0, s * 0.04);
            ctx.beginPath();
            ctx.moveTo(headF.x + s * 0.05, headF.y + s * 0.04);
            ctx.bezierCurveTo(headF.x + s * 0.24, headF.y + s * 0.10, headF.x + s * 0.06, headF.y + s * 0.32 + wWave, headF.x - s * 0.42, headF.y + s * 0.34 + wWave);
            ctx.stroke();

            ctx.strokeStyle = opts.isShiny ? '#fef08a' : flameGold;
            ctx.lineWidth = Math.max(0.85, s * 0.032);
            ctx.beginPath();
            ctx.moveTo(headF.x + s * 0.01, headF.y + s * 0.09);
            ctx.bezierCurveTo(headF.x + s * 0.20, headF.y + s * 0.18, headF.x + s * 0.02, headF.y + s * 0.42 + wWave * 0.85, headF.x - s * 0.46, headF.y + s * 0.44 + wWave * 0.85);
            ctx.stroke();

            // 6. 飘逸龙翼胸鳍
            const pecF = getSpineFrame(pts, 2);
            const pecFlap = Math.sin(finPhase) * 0.28;
            ctx.save();
            ctx.translate(pecF.x, pecF.y + widths[2] * 0.72);
            ctx.rotate(pecFlap);
            ctx.fillStyle = flameGold;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(-s * 0.28, s * 0.20, -s * 0.20, s * 0.38);
            ctx.quadraticCurveTo(s * 0.04, s * 0.24, s * 0.06, 0);
            ctx.closePath();
            ctx.fill();
            ctx.restore();

            // 7. 威严龙眼
            art.drawCanvasEye(ctx, headF.x - s * 0.06, headF.y - s * 0.04, Math.max(2.2, s * 0.095), opts.isShiny ? '#f472b6' : '#fbbf24', { style: 'dragon', browColor: outline });

            ctx.restore();
        }
    };

    // ========================================================================
    // 6. 星渊幻海龙 (astral_leviathan) - 神话 Mythic (终极星渊宇宙海龙)
    // ========================================================================
    WWF.FISH_MODELS.astral_leviathan = {
        motion: {
            swimStyle: 'majestic',
            tailFreq: 6.4,
            tailAmp: 0.24,
            bodyFlex: 0.34,
            pectoralFreq: 4.6,
            turnAgility: 0.85,
            bobAmp: 3.8,
            tailPivot: '45px 66px'
        },

        buildSVGContent({ isSilhouette, isShiny, uid, palette, art }) {
            // 雄伟盘旋的深渊海龙长躯（从龙首 x=184 盘曲至尾柄 x=44，充满力与美）
            const bodyPath =
                'M 45,65 C 63,39 90,34 111,51 C 125,63 141,62 153,45 ' +
                'C 162,33 176,34 185,43 C 185,50 175,55 162,56 ' +
                'C 148,74 123,81 103,65 C 86,52 67,55 45,65 Z';
            // 盛大双叉极光星河龙尾
            const tailPath =
                'M 46,64 C 31,42 17,31 11,42 C 22,51 28,58 33,64 ' +
                'C 26,74 17,88 12,99 C 24,96 37,83 46,66 Z';
            // 连绵极光背帆（随S形龙躯自然起落，丝滑承接弧谷）
            const dorsalSailPath =
                'M 54,53 C 68,24 94,18 115,34 C 128,43 139,40 153,31 ' +
                'C 145,48 128,58 111,48 C 93,37 72,41 54,53 Z';
            // 舒展极光羽翼长胸鳍 & 腹翼鳍
            const pecPath = 'M 145,62 C 130,83 114,98 124,102 C 138,96 150,78 151,60 Z';
            const ventralPath = 'M 95,60 C 80,79 67,92 77,97 C 90,90 100,74 103,62 Z';

            const cMagenta = isSilhouette ? palette.body : (isShiny ? '#fbbf24' : '#db2777');
            const cIndigo = isSilhouette ? palette.bodyDark : (isShiny ? '#f472b6' : '#4f46e5');
            const cAurora = isSilhouette ? palette.finLight : (isShiny ? '#fef08a' : '#38bdf8');
            const cCrystal = isSilhouette ? palette.finLight : (isShiny ? '#fef08a' : '#bae6fd');
            const starGold = isSilhouette ? palette.fin : (isShiny ? '#ffffff' : '#fef08a');
            const outline = isSilhouette ? palette.stroke : (isShiny ? palette.outline : '#1e1b4b');
            const veilOutline = isSilhouette ? palette.stroke : (isShiny ? 'rgba(254, 240, 138, 0.50)' : 'rgba(186, 230, 253, 0.48)');

            // 成对星晶双龙角（远近景深立体角）
            const dragonHorns = `
                <g fill="none" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M 169,37 Q 159,23 145,16" stroke="${isSilhouette ? palette.bodyDark : cAurora}" stroke-width="1.9" opacity="0.82"/>
                    <path d="M 162,38 Q 149,21 133,15 M 149,25 Q 144,18 142,13" stroke="${isSilhouette ? palette.stroke : cCrystal}" stroke-width="2.3"/>
                </g>
            `;

            // 星晶脊棘（镶嵌在极光背帆脊柱之上）
            const spineCrystals = [
                [150, 39, 10, -0.4], [107, 45, 11, -0.25], [91, 38, 12, -0.1], [75, 40, 10, -0.1]
            ].map(([x, y, h, tilt]) => {
                const tx = x + Math.sin(tilt) * h;
                const ty = y - Math.cos(tilt) * h;
                return `
                    <polygon points="${x - 2.8},${y + 1} ${tx},${ty} ${x},${y + 1}" fill="${cCrystal}" stroke="${outline}" stroke-width="0.65"/>
                    <polygon points="${x},${y + 1} ${tx},${ty} ${x + 3.0},${y + 1.5}" fill="${cAurora}" stroke="${outline}" stroke-width="0.65"/>
                `;
            }).join('');

            // 双轨倾斜星辰光环 & 四角星芒
            const stardustAura = isSilhouette ? '' : `
                <g class="svg-fish-float-aura">
                    <circle cx="106" cy="59" r="46" fill="url(#${uid}_orbit_glow)"/>
                    <ellipse cx="106" cy="59" rx="70" ry="26" transform="rotate(-14 106 59)" fill="none" stroke="${cCrystal}" stroke-width="1.05" stroke-dasharray="5 4" opacity="0.55"/>
                    <ellipse cx="104" cy="60" rx="58" ry="20" transform="rotate(11 104 60)" fill="none" stroke="${cMagenta}" stroke-width="0.85" stroke-dasharray="3 5" opacity="0.45"/>
                    <path d="M 48,25 L 49.5,29 L 53.5,30.5 L 49.5,32 L 48,36 L 46.5,32 L 42.5,30.5 L 46.5,29 Z" fill="${starGold}" opacity="0.92"/>
                    <path d="M 151,85 L 152.3,88.5 L 155.8,89.8 L 152.3,91.1 L 151,94.6 L 149.7,91.1 L 146.2,89.8 L 149.7,88.5 Z" fill="${cCrystal}" opacity="0.9"/>
                    <circle cx="122" cy="23" r="1.5" fill="${starGold}" opacity="0.88"/>
                    <circle cx="56" cy="93" r="1.7" fill="${cAurora}" opacity="0.82"/>
                </g>
            `;

            const constellation = isSilhouette ? '' : `
                <g clip-path="url(#${uid}_clip)">
                    <path d="M 58,57 L 76,49 L 94,52 L 116,64 L 136,64 L 154,51" fill="none" stroke="${starGold}" stroke-width="1.15" opacity="0.82"/>
                    <circle cx="58" cy="57" r="1.9" fill="#ffffff"/>
                    <circle cx="76" cy="49" r="2.1" fill="${starGold}"/>
                    <circle cx="94" cy="52" r="1.8" fill="#ffffff"/>
                    <circle cx="116" cy="64" r="2.2" fill="${cCrystal}"/>
                    <circle cx="136" cy="64" r="1.9" fill="#ffffff"/>
                    <circle cx="154" cy="51" r="2.1" fill="${starGold}"/>
                </g>
            `;

            // 飘逸如极光绸带的星光长龙须（向外向后流畅挥洒，绝不压胸鳍）
            const whiskers = `
                <g fill="${isSilhouette ? palette.finLight : cCrystal}" stroke="${veilOutline}" stroke-width="0.45">
                    <path d="M 180,48 C 191,50 194,61 186,71 C 179,79 167,83 156,80 C 166,80 177,76 183,68 C 189,60 187,52 178,50 Z"/>
                    <path d="M 176,51 C 185,57 185,68 176,78 C 169,86 159,90 150,88 C 159,87 167,83 173,75 C 180,67 180,58 174,53 Z"/>
                </g>
            `;

            return `
                <defs>
                    <linearGradient id="${uid}_body" x1="100%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${cMagenta}"/>
                        <stop offset="48%" stop-color="${cIndigo}"/>
                        <stop offset="82%" stop-color="${cAurora}"/>
                        <stop offset="100%" stop-color="${isSilhouette ? palette.belly : '#fef08a'}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_aurora" x1="100%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${cMagenta}" stop-opacity="${isSilhouette ? 0.94 : 0.85}"/>
                        <stop offset="55%" stop-color="${cAurora}" stop-opacity="${isSilhouette ? 0.88 : 0.65}"/>
                        <stop offset="100%" stop-color="${cCrystal}" stop-opacity="${isSilhouette ? 0.84 : 0.34}"/>
                    </linearGradient>
                    ${isSilhouette ? '' : `
                    <radialGradient id="${uid}_orbit_glow" cx="50%" cy="50%" r="50%">
                        <stop offset="55%" stop-color="${cAurora}" stop-opacity="0.18"/>
                        <stop offset="100%" stop-color="${cAurora}" stop-opacity="0"/>
                    </radialGradient>
                    `}
                    <clipPath id="${uid}_clip">
                        <path d="${bodyPath}"/>
                    </clipPath>
                </defs>

                ${stardustAura}

                <!-- 连绵极光羽纱背帆 -->
                <g class="svg-fish-veil">
                    <path d="${dorsalSailPath}" fill="url(#${uid}_aurora)" stroke="${veilOutline}" stroke-width="0.95" stroke-linejoin="round"/>
                </g>
                ${spineCrystals}

                <!-- 双叉星河长纱龙尾 -->
                <g class="svg-fish-tail">
                    <path d="${tailPath}" fill="url(#${uid}_aurora)" stroke="${veilOutline}" stroke-width="1.05" stroke-linejoin="round"/>
                    ${!isSilhouette ? art.svgFinRays(['M 43,64 L 17,44', 'M 43,67 L 19,92'], 'rgba(255,255,255,0.62)', 0.68, 0.9) : ''}
                </g>

                <path d="${ventralPath}" fill="url(#${uid}_aurora)" stroke="${veilOutline}" stroke-width="1.0" opacity="0.9"/>

                <!-- 星渊海龙长躯 -->
                <path d="${bodyPath}" fill="url(#${uid}_body)" stroke="${outline}" stroke-width="1.5" stroke-linejoin="round"/>
                ${constellation}

                <!-- 星翼胸鳍（锚定关节根部） -->
                <g class="svg-fish-pec" style="transform-box: view-box; transform-origin: 146px 64px;">
                    <path d="${pecPath}" fill="url(#${uid}_aurora)" stroke="${veilOutline}" stroke-width="1.0" opacity="0.94"/>
                    ${!isSilhouette ? art.svgFinRays(['M 143,66 L 125,94'], 'rgba(255,255,255,0.58)', 0.62, 0.85) : ''}
                </g>

                ${dragonHorns}
                ${whiskers}
                ${art.svgEye(168, 45.5, 4.4, isSilhouette, isShiny ? '#fef08a' : '#fbbf24', { style: 'dragon', uid, browColor: outline })}
                ${art.svgShinyOverlay(isSilhouette, isShiny)}
            `;
        },

        drawCanvas(ctx, size, time, opts) {
            const s = Math.max(8, safeNum(size, 34));
            const palette = opts.palette;
            const art = opts.art;
            const wagPhase = safeNum(opts.wagPhase, time * 6.4);
            const finPhase = safeNum(opts.finPhase, time * 4.6);
            const phaseOffset = safeNum(opts.phaseOffset, 0);
            const bodyBend = safeNum(opts.bodyBend, 0);
            const speedRatio = safeNum(opts.speedRatio, 1);

            const pts = art.buildSpinePoints(
                s * 1.10,
                -s * 1.08,
                12,
                bodyBend * 1.15,
                wagPhase,
                s * 0.165 * (0.72 + speedRatio * 0.3),
                0.88
            );
            const widths = [0.135, 0.225, 0.28, 0.27, 0.245, 0.225, 0.19, 0.17, 0.135, 0.10, 0.068, 0.044].map(w => w * s);

            const crystalMain = opts.isShiny ? '#fef08a' : '#bae6fd';
            const starColor = '#fef08a';
            const cMagenta = opts.isShiny ? '#fbbf24' : '#db2777';
            const cAurora = opts.isShiny ? '#f472b6' : '#38bdf8';
            const outline = opts.isShiny ? palette.outline : '#1e1b4b';
            const veilOutline = opts.isShiny ? 'rgba(254,240,138,0.50)' : 'rgba(186,230,253,0.48)';

            ctx.save();

            // 1. 双轨倾斜星辰光环与星芒（柔和虚线）
            ctx.save();
            ctx.rotate(-0.22);
            ctx.strokeStyle = opts.isShiny ? 'rgba(254,240,138,0.34)' : 'rgba(186,230,253,0.34)';
            ctx.lineWidth = Math.max(0.95, s * 0.032);
            ctx.setLineDash([s * 0.16, s * 0.12]);
            ctx.beginPath();
            ctx.ellipse(0, 0, s * 1.18, s * 0.42, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();

            for (let i = 0; i < 4; i++) {
                const ang = time * 1.3 + i * (Math.PI * 0.5);
                const sx = Math.cos(ang) * s * 1.12;
                const sy = Math.sin(ang) * s * 0.46;
                drawStarSparkCanvas(ctx, sx, sy, s * 0.088, i % 2 === 0 ? starColor : crystalMain, 0.88);
            }

            // 2. 连绵极光薄纱背帆（贴合第 1..9 节背脊起伏流淌）
            const auroraGrad = ctx.createLinearGradient(0, -s * 0.55, 0, s * 0.45);
            auroraGrad.addColorStop(0, cMagenta);
            auroraGrad.addColorStop(0.55, cAurora);
            auroraGrad.addColorStop(1, 'rgba(186, 230, 253, 0.25)');

            ctx.save();
            ctx.fillStyle = auroraGrad;
            ctx.globalAlpha = 0.72;
            ctx.strokeStyle = veilOutline;
            ctx.lineWidth = Math.max(0.7, s * 0.028);
            ctx.beginPath();
            ctx.moveTo(pts[1].x, pts[1].y - widths[1] * 0.8);
            for (let i = 2; i <= 9; i++) {
                const p = pts[i];
                const sailH = s * (0.28 * Math.sin(((i - 1) / 8) * Math.PI) + 0.06);
                ctx.lineTo(p.x, p.y - widths[i] - sailH);
            }
            for (let i = 9; i >= 1; i--) {
                ctx.lineTo(pts[i].x, pts[i].y - widths[i] * 0.7);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 3. 双叉极光彗星龙尾
            const tailF = getSpineFrame(pts, pts.length - 1);
            const tailWag = Math.sin(wagPhase - 2.2) * 0.34 + bodyBend * 0.52;
            ctx.save();
            ctx.translate(tailF.x, tailF.y);
            ctx.rotate(tailF.ang * 0.65 + tailWag);
            const tailGrad = ctx.createLinearGradient(0, 0, -s * 0.65, 0);
            tailGrad.addColorStop(0, cMagenta);
            tailGrad.addColorStop(0.5, cAurora);
            tailGrad.addColorStop(1, 'rgba(186, 230, 253, 0.20)');
            ctx.fillStyle = tailGrad;
            ctx.strokeStyle = veilOutline;
            ctx.lineWidth = Math.max(0.75, s * 0.032);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(-s * 0.30, -s * 0.48, -s * 0.64, -s * 0.36);
            ctx.quadraticCurveTo(-s * 0.28, 0, -s * 0.64, s * 0.36);
            ctx.quadraticCurveTo(-s * 0.30, s * 0.48, 0, 0);
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 4. 极光星翼胸鳍与腹鳍
            const pecF = getSpineFrame(pts, 2);
            const ventF = getSpineFrame(pts, 6);
            const finFlap = Math.sin(finPhase) * 0.28;
            ctx.save();
            ctx.translate(pecF.x, pecF.y + widths[2] * 0.65);
            ctx.rotate(finFlap);
            ctx.fillStyle = tailGrad;
            ctx.strokeStyle = veilOutline;
            ctx.lineWidth = Math.max(0.7, s * 0.03);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(-s * 0.34, s * 0.28, -s * 0.48, s * 0.54);
            ctx.quadraticCurveTo(-s * 0.06, s * 0.36, s * 0.04, 0);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            ctx.save();
            ctx.translate(ventF.x, ventF.y + widths[6] * 0.7);
            ctx.rotate(-finFlap * 0.7);
            ctx.fillStyle = tailGrad;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(-s * 0.24, s * 0.22, -s * 0.34, s * 0.40);
            ctx.quadraticCurveTo(-s * 0.04, s * 0.26, s * 0.02, 0);
            ctx.closePath();
            ctx.fill();
            ctx.restore();

            // 5. 星渊海龙长躯
            const bodyGrad = ctx.createLinearGradient(pts[0].x, -s * 0.35, pts[pts.length - 1].x, s * 0.35);
            bodyGrad.addColorStop(0, cMagenta);
            bodyGrad.addColorStop(0.5, opts.isShiny ? '#f472b6' : '#4f46e5');
            bodyGrad.addColorStop(1, cAurora);
            art.drawCanvasSpineRibbon(ctx, pts, widths, bodyGrad, outline, Math.max(1.0, s * 0.042));

            // 6. 镶嵌式发光星晶背棘
            for (let i = 2; i <= 8; i += 2) {
                const f = getSpineFrame(pts, i);
                const h = s * (0.20 - i * 0.01);
                const bx = f.x + f.nx * widths[i] * 0.85;
                const by = f.y + f.ny * widths[i] * 0.85;
                ctx.fillStyle = crystalMain;
                ctx.beginPath();
                ctx.moveTo(bx - f.ux * s * 0.05, by - f.uy * s * 0.05);
                ctx.lineTo(bx + (f.nx - f.ux * 0.4) * h, by + (f.ny - f.uy * 0.4) * h);
                ctx.lineTo(bx + f.ux * s * 0.05, by + f.uy * s * 0.05);
                ctx.closePath();
                ctx.fill();
            }

            // 7. 发光星座脊柱连线
            ctx.strokeStyle = starColor;
            ctx.lineWidth = Math.max(0.85, s * 0.028);
            ctx.beginPath();
            for (let i = 2; i <= 9; i++) {
                const p = pts[i];
                if (i === 2) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            for (let i = 2; i <= 9; i += 2) {
                ctx.beginPath();
                ctx.arc(pts[i].x, pts[i].y, Math.max(1.1, s * 0.04), 0, Math.PI * 2);
                ctx.fill();
            }

            // 8. 龙头星晶双角、极光流苏长须与星空龙眼
            const headF = getSpineFrame(pts, 0);
            ctx.strokeStyle = cAurora;
            ctx.lineWidth = Math.max(1.0, s * 0.04);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(headF.x + s * 0.02, headF.y - widths[0] * 0.78);
            ctx.quadraticCurveTo(headF.x - s * 0.14, headF.y - s * 0.26, headF.x - s * 0.24, headF.y - s * 0.34);
            ctx.stroke();

            ctx.strokeStyle = crystalMain;
            ctx.lineWidth = Math.max(1.2, s * 0.048);
            ctx.beginPath();
            ctx.moveTo(headF.x - s * 0.05, headF.y - widths[0] * 0.8);
            ctx.quadraticCurveTo(headF.x - s * 0.20, headF.y - s * 0.28, headF.x - s * 0.34, headF.y - s * 0.40);
            ctx.stroke();

            const wWave = Math.sin(time * 4.2 + phaseOffset) * s * 0.045;
            ctx.lineWidth = Math.max(0.95, s * 0.036);
            ctx.beginPath();
            ctx.moveTo(headF.x + s * 0.06, headF.y + s * 0.04);
            ctx.quadraticCurveTo(headF.x + s * 0.18, headF.y + s * 0.22 + wWave, headF.x - s * 0.26, headF.y + s * 0.30 + wWave);
            ctx.stroke();

            ctx.strokeStyle = cAurora;
            ctx.lineWidth = Math.max(0.8, s * 0.03);
            ctx.beginPath();
            ctx.moveTo(headF.x + s * 0.02, headF.y + s * 0.09);
            ctx.quadraticCurveTo(headF.x + s * 0.14, headF.y + s * 0.29 + wWave * 0.85, headF.x - s * 0.30, headF.y + s * 0.38 + wWave * 0.85);
            ctx.stroke();

            art.drawCanvasEye(ctx, headF.x - s * 0.04, headF.y - s * 0.04, Math.max(2.1, s * 0.095), opts.isShiny ? '#fef08a' : '#fbbf24', { style: 'dragon', browColor: outline });

            ctx.restore();
        }
    };
})();
