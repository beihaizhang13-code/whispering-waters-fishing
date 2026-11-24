/**
 * ============================================================================
 * 《微风垂钓物语 2.0》高精鱼类建模库 - 稀有鱼群 (js/fish_models_rare.js)
 * ============================================================================
 * 注册稀有鱼群 (Rare, 5 种) 至 window.WWF.FISH_MODELS：
 * 1. bluegill       - 蓝鳃太阳鱼 (圆盘侧扁体、贴合鳃盖后缘宝蓝耳斑、孔雀青颊纹、暖橘胸腹)
 * 2. emerald_puffer - 翡翠胖河豚 (3D玉绿Q弹圆球、纤细珠光小刺、樱桃小嘴、puffFactor鼓胀)
 * 3. trout          - 星点虹鳟   (流线鲑形、羽化珠光粉紫彩虹带、背部/背尾鳍错落星点、脂鳍)
 * 4. bass           - 大口黑鲈   (掠食大下颌越眼后、自然迷彩纵斑、深缺口双背鳍、青铜橄榄肤)
 * 5. koi            - 三色锦鲤   (白瓷绸缎体、书法流形朱红Hi/墨黑Sumi斑、薄纱蝴蝶翼鳍)
 */
(function () {
    'use strict';

    const WWF = window.WWF = window.WWF || {};
    const MODELS = WWF.FISH_MODELS = WWF.FISH_MODELS || {};

    function clamp(v, min, max) {
        return v < min ? min : (v > max ? max : v);
    }

    function safeNum(v, fallback = 0) {
        return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    }

    function parseCanvasOpts(size, time, opts) {
        const o = opts || {};
        const art = o.art || WWF.FishArt;
        const fish = o.fish || null;
        const isShiny = !!o.isShiny;
        const palette = o.palette || (art && typeof art.getPalette === 'function'
            ? art.getPalette(fish, false, isShiny)
            : {
                body: '#38bdf8', bodyLight: '#7dd3fc', bodyDark: '#0369a1',
                belly: '#f8fafc', bellyWarm: '#ffffff',
                fin: '#0284c7', finLight: '#7dd3fc', finDark: '#075985',
                stroke: 'rgba(12, 22, 38, 0.56)', outline: '#1e293b', finOutline: '#075985',
                highlight: 'rgba(255, 255, 255, 0.38)', glow: '#38bdf8', iris: '#0ea5e9'
            });
        const motion = o.motion || {};
        const s = Math.max(6, safeNum(size, 20));
        const t = safeNum(time, 0);
        const speedRatio = clamp(safeNum(o.speedRatio, 1), 0.3, 3.5);
        const bodyBend = clamp(safeNum(o.bodyBend, 0), -0.9, 0.9);
        const puffFactor = clamp(safeNum(o.puffFactor, 0), 0, 1.2);
        const phaseOffset = safeNum(o.phaseOffset, 0);
        const wagPhase = safeNum(o.wagPhase, t * (motion.tailFreq || 8.5) * (0.72 + speedRatio * 0.42) + phaseOffset);
        const finPhase = safeNum(o.finPhase, t * (motion.pectoralFreq || 5.5) * (0.78 + speedRatio * 0.34) + phaseOffset * 0.7);
        return { art, fish, isShiny, palette, motion, s, t, speedRatio, bodyBend, puffFactor, wagPhase, finPhase, phaseOffset };
    }

    function buildAsymmetricEnvelope(art, points, topWidths, botWidths) {
        if (art && typeof art.buildAsymEnvelope === 'function') {
            return art.buildAsymEnvelope(points, topWidths, botWidths);
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
            topPts.push({ x: p.x + nx * (topWidths[i] ?? 2), y: p.y + ny * (topWidths[i] ?? 2) });
            botPts.push({ x: p.x - nx * (botWidths[i] ?? 2), y: p.y - ny * (botWidths[i] ?? 2) });
        }
        return { topPts, botPts };
    }

    function traceEnvelopePath(art, ctx, points, topPts, botPts, noseExtend = 3) {
        if (art && typeof art.traceEnvelopePath === 'function') {
            art.traceEnvelopePath(ctx, points, topPts, botPts, noseExtend);
            return;
        }
        const n = points.length;
        if (n < 2) return;
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

    function getTailBaseAngle(points) {
        const n = points.length;
        if (n < 2) return 0;
        return Math.atan2(points[n - 2].y - points[n - 1].y, points[n - 2].x - points[n - 1].x);
    }

    function getHeadAngle(points) {
        if (points.length < 3) return 0;
        return Math.atan2(points[0].y - points[2].y, points[0].x - points[2].x);
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
            const wave = Math.sin(wagPhase - t * Math.PI * 2 * waveFreq) * waveAmp * (0.12 + t * 0.88);
            pts.push({ x, y: arch + wave });
        }
        return pts;
    }

    function drawFinRaysCanvas(art, ctx, rays, strokeColor, lineWidth = 0.9) {
        if (art && typeof art.drawCanvasFinRays === 'function') {
            art.drawCanvasFinRays(ctx, rays, strokeColor, lineWidth);
            return;
        }
        ctx.save();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i < rays.length; i++) {
            const r = rays[i];
            ctx.moveTo(r[0], r[1]);
            ctx.quadraticCurveTo(r[2], r[3], r[4], r[5]);
        }
        ctx.stroke();
        ctx.restore();
    }

    // ========================================================================
    // 1. 蓝鳃太阳鱼 (bluegill)
    // ========================================================================
    MODELS.bluegill = {
        motion: {
            swimStyle: 'glide',
            tailFreq: 7.4,
            tailAmp: 0.22,
            bodyFlex: 0.14,
            pectoralFreq: 6.2,
            turnAgility: 1.05,
            bobAmp: 3.2,
            tailPivot: '50px 60px'
        },

        buildSVGContent(ctxInfo) {
            const { isSilhouette, isShiny, uid, palette, art } = ctxInfo;

            const bodyPath = 'M 170,57 C 163,42 146,28 118,22 C 88,16 64,29 48,52 C 46,56 46,64 48,68 C 66,91 96,98 132,89 C 151,84 163,74 169,63 L 160,60 Z';
            const dorsalPath = 'M 122,28 C 117,15 112,14 107,18 L 102,13 L 96,18 L 90,13 L 84,19 C 76,12 63,15 59,28 C 57,36 55,43 53,48 L 122,30 Z';
            const analPath = 'M 103,89 C 94,105 72,107 63,94 C 59,87 56,78 55,70 L 103,87 Z';
            const pelvicPath = 'M 134,84 C 124,96 112,102 106,100 C 110,93 118,88 126,83 Z';
            const tailPath = 'M 50,54 C 36,41 22,33 15,34 C 19,46 24,54 28,60 C 24,66 19,74 15,86 C 22,87 36,79 50,66 Z';
            const pecPath = 'M 126,66 C 115,61 98,66 96,76 C 105,80 119,75 127,69 Z';

            const backTop = isSilhouette ? palette.bodyDark : (isShiny ? palette.bodyLight : '#0b4f78');
            const flankMid = isSilhouette ? palette.body : (isShiny ? palette.body : '#0d82bd');
            const lowerBlue = isSilhouette ? palette.belly : (isShiny ? palette.belly : '#3bb2df');
            const throatWarm = isShiny ? '#f472b6' : '#fb923c';
            const throatDeep = isShiny ? '#db2777' : '#d95b16';
            const finBase = isSilhouette ? palette.finDark : (isShiny ? palette.finDark : '#0b6aa1');
            const finTip = isSilhouette ? palette.finLight : (isShiny ? palette.finLight : '#7dd3fc');
            const outline = isSilhouette ? palette.stroke : (isShiny ? palette.outline : '#082f49');
            const rayColor = isSilhouette ? 'rgba(148,163,184,0.18)' : 'rgba(224,242,254,0.60)';
            const cheekTeal = isShiny ? '#fde047' : '#2dd4bf';

            const patternDetails = isSilhouette ? '' : `
                <!-- 温润日落铜橘胸腹渐晕 -->
                <path d="M 168,62 C 150,70 132,66 110,72 C 92,77 79,88 76,97 L 160,97 Z" fill="url(#${uid}_chestGrad)"/>
                <!-- 柔和青蓝弯曲竖纹（顶部深邃、向腹渐隐） -->
                <g fill="none" stroke-linecap="round">
                    <path d="M 111,26 Q 106,54 112,82" stroke="url(#${uid}_barGrad)" stroke-width="4.5"/>
                    <path d="M 99,24 Q 94,55 100,85" stroke="url(#${uid}_barGrad)" stroke-width="4.8"/>
                    <path d="M 87,26 Q 82,56 88,84" stroke="url(#${uid}_barGrad)" stroke-width="4.5"/>
                    <path d="M 75,32 Q 70,57 75,80" stroke="url(#${uid}_barGrad)" stroke-width="4.0"/>
                    <path d="M 64,40 Q 60,58 64,75" stroke="url(#${uid}_barGrad)" stroke-width="3.2"/>
                </g>
                <!-- 体侧精致金属鳞光 -->
                ${art.svgScalePatch([
                    { y: 42, xs: [88, 102, 116], alpha: 0.58 },
                    { y: 52, xs: [82, 96, 110], alpha: 0.72 },
                    { y: 62, xs: [88, 102, 116], alpha: 0.62 }
                ], {
                    rx: 4.5, ry: 4.2,
                    rimColor: isShiny ? 'rgba(255,255,255,0.45)' : 'rgba(186,230,253,0.34)',
                    shadowColor: 'rgba(8,47,73,0.16)'
                })}
                <!-- 孔雀石青放射状鳃颊流纹 -->
                <g fill="none" stroke="${cheekTeal}" stroke-width="1.35" stroke-linecap="round" opacity="0.72">
                    <path d="M 157,61 Q 145,63 135,61"/>
                    <path d="M 155,65 Q 144,68 133,67"/>
                    <path d="M 150,70 Q 140,73 132,73"/>
                </g>
                <!-- 鳃盖边缘刻画（与耳斑严密贴合） -->
                <path d="M 136,41 Q 129,57 134,76" fill="none" stroke="${outline}" stroke-width="1.55" stroke-linecap="round" opacity="0.62"/>
                <path d="M 138,43 Q 132,57 136,74" fill="none" stroke="rgba(186,230,253,0.42)" stroke-width="1.0" stroke-linecap="round"/>
                <!-- 背脊水波高光 -->
                <path d="M 64,43 Q 108,21 150,39" fill="none" stroke="rgba(224,242,254,0.46)" stroke-width="3.0" stroke-linecap="round"/>
                <path d="M 168,58 Q 160,61 155,59" fill="none" stroke="${outline}" stroke-width="1.2" stroke-linecap="round"/>
            `;

            // 标志性深宝蓝绒黑鳃盖耳斑 —— 严密贴合鳃盖后缘缺口处，绝不漂浮在躯干中央
            const earFlap = isSilhouette ? '' : `
                <g class="svg-bluegill-ear">
                    <path d="M 132,50 C 125,49 119,52 119,57 C 119,62 125,64 132,61 Q 134,56 132,50 Z" fill="url(#${uid}_earGrad)" stroke="${isShiny ? '#fef08a' : '#38bdf8'}" stroke-width="1.15" stroke-linejoin="round"/>
                    <ellipse cx="125.5" cy="56.5" rx="3.4" ry="2.2" fill="#090d16" opacity="0.88"/>
                    <path d="M 124,54.5 Q 127,54 129,56" fill="none" stroke="#93c5fd" stroke-width="0.9" stroke-linecap="round" opacity="0.8"/>
                </g>
            `;

            return `
                <defs>
                    <linearGradient id="${uid}_body" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${backTop}"/>
                        <stop offset="52%" stop-color="${flankMid}"/>
                        <stop offset="100%" stop-color="${lowerBlue}"/>
                    </linearGradient>
                    <radialGradient id="${uid}_chestGrad" cx="62%" cy="56%" r="56%">
                        <stop offset="0%" stop-color="${throatWarm}" stop-opacity="0.92"/>
                        <stop offset="58%" stop-color="${throatDeep}" stop-opacity="0.72"/>
                        <stop offset="100%" stop-color="${throatDeep}" stop-opacity="0"/>
                    </radialGradient>
                    <linearGradient id="${uid}_barGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${isShiny ? '#9d174d' : '#082f49'}" stop-opacity="0.52"/>
                        <stop offset="70%" stop-color="${isShiny ? '#be185d' : '#0c4a6e'}" stop-opacity="0.28"/>
                        <stop offset="100%" stop-color="#0c4a6e" stop-opacity="0"/>
                    </linearGradient>
                    <linearGradient id="${uid}_fin" x1="0%" y1="100%" x2="0%" y2="0%">
                        <stop offset="0%" stop-color="${finBase}" stop-opacity="0.90"/>
                        <stop offset="100%" stop-color="${finTip}" stop-opacity="${isSilhouette ? 0.9 : 0.56}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_earGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#1e40af"/>
                        <stop offset="100%" stop-color="#090d16"/>
                    </linearGradient>
                    <clipPath id="${uid}_clip">
                        <path d="${bodyPath}"/>
                    </clipPath>
                </defs>

                <!-- 尾鳍 -->
                <g class="svg-fish-tail">
                    <path d="${tailPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.25" stroke-linejoin="round"/>
                    ${!isSilhouette ? art.svgFinRays([
                        'M 47,57 Q 33,46 19,38',
                        'M 46,59 Q 34,54 24,50',
                        'M 46,61 Q 34,66 24,70',
                        'M 47,63 Q 33,74 19,82'
                    ], rayColor, 0.64, 0.95) : ''}
                </g>

                <!-- 腹鳍 -->
                <path d="${pelvicPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.1" stroke-linejoin="round"/>

                <!-- 背鳍与臀鳍 -->
                <path d="${dorsalPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.2" stroke-linejoin="round"/>
                <path d="${analPath}" fill="url(#${uid}_fin)" stroke="${outline}" stroke-width="1.2" stroke-linejoin="round"/>
                ${!isSilhouette ? art.svgFinRays([
                    'M 115,28 L 116,18',
                    'M 106,27 L 107,16',
                    'M 97,27 L 97,16',
                    'M 88,28 L 88,17',
                    'M 79,31 Q 76,20 74,16',
                    'M 70,36 Q 67,24 65,20',
                    'M 91,85 Q 87,96 84,101',
                    'M 79,81 Q 75,94 72,101',
                    'M 68,76 Q 65,87 64,92'
                ], rayColor, 0.56, 0.9) : ''}

                <!-- 圆盘主体 -->
                <path d="${bodyPath}" fill="url(#${uid}_body)" stroke="${outline}" stroke-width="1.5" stroke-linejoin="round"/>
                <g clip-path="url(#${uid}_clip)">
                    ${patternDetails}
                </g>

                ${earFlap}

                <!-- 半透明飘逸尖胸鳍（轻盈掠过橙胸） -->
                <g class="svg-fish-pec" style="transform-box: view-box; transform-origin: 125px 67px;">
                    <path d="${pecPath}" fill="${isSilhouette ? palette.fin : (isShiny ? palette.finLight : '#bae6fd')}" fill-opacity="${isSilhouette ? 0.92 : 0.62}" stroke="${outline}" stroke-width="1.05" stroke-linejoin="round"/>
                    ${!isSilhouette ? art.svgFinRays([
                        'M 123,67 Q 112,67 102,69',
                        'M 123,68 Q 111,71 100,74',
                        'M 123,69 Q 113,74 105,77'
                    ], rayColor, 0.62, 0.85) : ''}
                </g>

                ${art.svgEye(149, 49, 5.7, isSilhouette, isShiny ? palette.iris : '#f59e0b', { style: 'natural', uid })}
                ${art.svgShinyOverlay(isSilhouette, isShiny)}
            `;
        },

        drawCanvas(ctx, size, time, opts) {
            const { art, isShiny, palette, s, speedRatio, bodyBend, wagPhase, finPhase } = parseCanvasOpts(size, time, opts);
            const spine = computeSpine(art, s * 0.90, -s * 0.78, 8, bodyBend, wagPhase, s * 0.052, 0.55);
            const topW = [s * 0.14, s * 0.42, s * 0.62, s * 0.72, s * 0.66, s * 0.48, s * 0.28, s * 0.14];
            const botW = [s * 0.15, s * 0.40, s * 0.58, s * 0.68, s * 0.62, s * 0.44, s * 0.25, s * 0.14];
            const { topPts, botPts } = buildAsymmetricEnvelope(art, spine, topW, botW);

            const tailBase = spine[spine.length - 1];
            const tailBaseAng = getTailBaseAngle(spine);
            const tailWag = Math.sin(wagPhase - 0.65) * (0.22 + speedRatio * 0.04) + bodyBend * 0.42;
            const outline = isShiny ? palette.outline : '#082f49';

            ctx.save();

            // 1. 尾鳍
            ctx.save();
            ctx.translate(tailBase.x, tailBase.y);
            ctx.rotate(tailBaseAng + tailWag);
            const tailGrad = ctx.createLinearGradient(0, 0, -s * 0.52, 0);
            tailGrad.addColorStop(0, isShiny ? palette.finDark : '#0b6aa1');
            tailGrad.addColorStop(1, isShiny ? palette.finLight : 'rgba(125,211,252,0.65)');
            ctx.fillStyle = tailGrad;
            ctx.strokeStyle = outline;
            ctx.lineWidth = 1.0;
            ctx.beginPath();
            ctx.moveTo(0, -s * 0.12);
            ctx.quadraticCurveTo(-s * 0.34, -s * 0.44, -s * 0.52, -s * 0.40);
            ctx.quadraticCurveTo(-s * 0.38, -s * 0.12, -s * 0.32, 0);
            ctx.quadraticCurveTo(-s * 0.38, s * 0.12, -s * 0.52, s * 0.40);
            ctx.quadraticCurveTo(-s * 0.34, s * 0.44, 0, s * 0.12);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 2. 背鳍、臀鳍与腹鳍
            const finGrad = ctx.createLinearGradient(0, -s * 0.9, 0, s * 0.9);
            finGrad.addColorStop(0, isShiny ? palette.finLight : 'rgba(125,211,252,0.72)');
            finGrad.addColorStop(0.5, isShiny ? palette.finDark : '#0b6aa1');
            finGrad.addColorStop(1, isShiny ? palette.finLight : 'rgba(125,211,252,0.72)');
            ctx.fillStyle = finGrad;
            ctx.strokeStyle = outline;
            ctx.lineWidth = 1.0;

            ctx.beginPath();
            ctx.moveTo(topPts[2].x, topPts[2].y + s * 0.04);
            ctx.lineTo(topPts[2].x - s * 0.05, topPts[2].y - s * 0.18);
            ctx.lineTo(topPts[3].x + s * 0.08, topPts[3].y - s * 0.14);
            ctx.lineTo(topPts[3].x, topPts[3].y - s * 0.22);
            ctx.lineTo(topPts[4].x + s * 0.08, topPts[4].y - s * 0.15);
            ctx.quadraticCurveTo(topPts[5].x, topPts[5].y - s * 0.36, topPts[6].x, topPts[6].y - s * 0.02);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(botPts[3].x, botPts[3].y - s * 0.04);
            ctx.quadraticCurveTo(botPts[5].x, botPts[5].y + s * 0.34, botPts[6].x, botPts[6].y + s * 0.02);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(botPts[2].x, botPts[2].y - s * 0.03);
            ctx.quadraticCurveTo(botPts[3].x - s * 0.05, botPts[3].y + s * 0.24, botPts[3].x - s * 0.14, botPts[3].y + s * 0.18);
            ctx.closePath();
            ctx.fill();

            // 3. 圆盘主体
            const grad = ctx.createLinearGradient(0, -s * 0.72, 0, s * 0.68);
            grad.addColorStop(0, isShiny ? palette.bodyLight : '#0b4f78');
            grad.addColorStop(0.52, isShiny ? palette.body : '#0d82bd');
            grad.addColorStop(1, isShiny ? palette.belly : '#3bb2df');
            traceEnvelopePath(art, ctx, spine, topPts, botPts, s * 0.12);
            ctx.fillStyle = grad;
            ctx.fill();

            ctx.save();
            ctx.clip();

            // 暖橘胸喉渐晕
            const chestGrad = ctx.createRadialGradient(spine[1].x, spine[1].y + s * 0.22, s * 0.05, spine[1].x, spine[1].y + s * 0.24, s * 0.56);
            chestGrad.addColorStop(0, isShiny ? '#f472b6' : '#fb923c');
            chestGrad.addColorStop(0.6, isShiny ? 'rgba(219, 39, 119, 0.58)' : 'rgba(217, 91, 22, 0.55)');
            chestGrad.addColorStop(1, 'rgba(234, 88, 12, 0)');
            ctx.fillStyle = chestGrad;
            ctx.fillRect(-s, -s * 0.15, s * 2.2, s * 1.1);

            // 青蓝弯曲竖纹
            for (let i = 2; i <= 6; i++) {
                const p = spine[i];
                const barGrad = ctx.createLinearGradient(0, topPts[i].y, 0, botPts[i].y);
                barGrad.addColorStop(0, isShiny ? 'rgba(157, 23, 77, 0.45)' : 'rgba(8, 47, 73, 0.48)');
                barGrad.addColorStop(1, 'rgba(8, 47, 73, 0)');
                ctx.strokeStyle = barGrad;
                ctx.lineWidth = Math.max(1.4, s * 0.085);
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(p.x, topPts[i].y + s * 0.04);
                ctx.quadraticCurveTo(p.x - s * 0.04, p.y, p.x, botPts[i].y - s * 0.06);
                ctx.stroke();
            }

            // 孔雀石青颊纹与鳃盖线
            ctx.strokeStyle = isShiny ? '#fde047' : '#2dd4bf';
            ctx.lineWidth = Math.max(0.8, s * 0.04);
            ctx.globalAlpha = 0.72;
            ctx.beginPath();
            ctx.moveTo(spine[0].x - s * 0.08, spine[0].y + s * 0.12);
            ctx.quadraticCurveTo(spine[1].x, spine[1].y + s * 0.16, spine[2].x + s * 0.06, spine[2].y + s * 0.10);
            ctx.moveTo(spine[0].x - s * 0.10, spine[0].y + s * 0.22);
            ctx.quadraticCurveTo(spine[1].x, spine[1].y + s * 0.25, spine[2].x + s * 0.05, spine[2].y + s * 0.20);
            ctx.stroke();
            ctx.globalAlpha = 1;

            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.8, s * 0.045);
            ctx.beginPath();
            ctx.arc(spine[2].x + s * 0.16, spine[2].y, s * 0.28, -0.78, 0.85);
            ctx.stroke();
            ctx.restore();

            traceEnvelopePath(art, ctx, spine, topPts, botPts, s * 0.12);
            ctx.strokeStyle = outline;
            ctx.lineWidth = 1.25;
            ctx.stroke();

            // 4. 贴合鳃盖后缘的宝蓝耳斑
            const headAng = getHeadAngle(spine);
            ctx.save();
            ctx.translate(spine[2].x + s * 0.03, spine[2].y - s * 0.04);
            ctx.rotate(headAng);
            ctx.fillStyle = '#090d16';
            ctx.strokeStyle = isShiny ? '#fef08a' : '#38bdf8';
            ctx.lineWidth = 1.0;
            ctx.beginPath();
            ctx.ellipse(0, 0, s * 0.13, s * 0.085, -0.1, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 5. 半透明尖胸鳍
            const pecWag = Math.sin(finPhase) * 0.24;
            ctx.save();
            ctx.translate(spine[2].x - s * 0.03, spine[2].y + s * 0.14);
            ctx.rotate(headAng + pecWag);
            ctx.fillStyle = isShiny ? palette.finLight : '#bae6fd';
            ctx.globalAlpha = 0.64;
            ctx.strokeStyle = outline;
            ctx.lineWidth = 0.85;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(-s * 0.24, -s * 0.05, -s * 0.34, s * 0.12);
            ctx.quadraticCurveTo(-s * 0.20, s * 0.24, 0, s * 0.05);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 6. 立体眼睛
            if (art && typeof art.drawCanvasEye === 'function') {
                art.drawCanvasEye(ctx, spine[1].x + s * 0.03, spine[1].y - s * 0.16, Math.max(2.2, s * 0.145), isShiny ? palette.iris : '#f59e0b', { style: 'natural' });
            }

            ctx.restore();
        }
    };

    // ========================================================================
    // 2. 翡翠胖河豚 (emerald_puffer)
    // ========================================================================
    MODELS.emerald_puffer = {
        motion: {
            swimStyle: 'puff',
            tailFreq: 12.0,
            tailAmp: 0.28,
            bodyFlex: 0.08,
            pectoralFreq: 14.5,
            turnAgility: 1.15,
            bobAmp: 4.5,
            tailPivot: '54px 60px'
        },

        buildSVGContent(ctxInfo) {
            const { isSilhouette, isShiny, uid, palette, art } = ctxInfo;

            const bodyPath = 'M 157,59 C 154,38 133,26 106,26 C 78,26 57,41 55,58 C 54,61 54,64 55,67 C 59,85 82,95 110,94 C 135,93 153,81 157,63 C 158,61 158,60 157,59 Z';
            const tailPath = 'M 57,56 C 43,47 28,43 22,48 C 20,56 20,64 22,72 C 28,77 43,73 57,64 Z';
            const dorsalPath = 'M 86,28 C 82,19 73,20 70,28 L 76,34 Z';
            const analPath = 'M 88,91 C 83,99 74,98 72,90 L 78,86 Z';
            const pecPath = 'M 118,64 C 107,56 97,62 98,70 C 102,77 113,75 119,68 Z';

            const domeTop = isSilhouette ? palette.bodyLight : (isShiny ? palette.bodyLight : '#5eead4');
            const domeMid = isSilhouette ? palette.body : (isShiny ? palette.body : '#10b981');
            const domeEdge = isSilhouette ? palette.bodyDark : (isShiny ? palette.bodyDark : '#065f46');
            const bellyCream = isSilhouette ? palette.belly : (isShiny ? palette.bellyWarm : '#fefce8');
            const spineColor = isSilhouette ? palette.bodyLight : (isShiny ? '#e0f2fe' : '#a7f3d0');
            const outline = isSilhouette ? palette.stroke : (isShiny ? palette.outline : '#064e3b');
            const spotFill = isShiny ? 'rgba(219, 39, 119, 0.34)' : 'rgba(6, 78, 59, 0.32)';
            const rayColor = isSilhouette ? 'rgba(148,163,184,0.18)' : 'rgba(255,255,255,0.68)';

            // 纤细珠光针刺（替代纸帽子三角）
            const outerSpines = `
                <g fill="${spineColor}" stroke="${outline}" stroke-width="0.75" stroke-linejoin="round">
                    <path d="M 135,30 L 143,21 L 131,28 Z"/>
                    <path d="M 118,26 L 122,16 L 114,25 Z"/>
                    <path d="M 101,26 L 101,15 L 97,26 Z"/>
                    <path d="M 84,29 L 79,19 L 79,30 Z"/>
                    <path d="M 67,38 L 57,30 L 64,41 Z"/>
                    <path d="M 67,82 L 57,89 L 64,79 Z"/>
                    <path d="M 86,91 L 82,102 L 81,90 Z"/>
                    <path d="M 105,94 L 105,104 L 101,94 Z"/>
                    <path d="M 124,91 L 128,101 L 120,92 Z"/>
                    <path d="M 140,84 L 147,91 L 137,86 Z"/>
                </g>
            `;

            const surfaceSpines = isSilhouette ? '' : `
                <g fill="${spineColor}" stroke="${outline}" stroke-width="0.65" stroke-linejoin="round" opacity="0.88">
                    <path d="M 112,38 L 111,31 L 109,38 Z"/>
                    <path d="M 92,38 L 88,31 L 89,39 Z"/>
                    <path d="M 75,49 L 69,44 L 73,52 Z"/>
                    <path d="M 89,79 L 85,86 L 85,79 Z"/>
                    <path d="M 110,83 L 111,91 L 107,83 Z"/>
                </g>
            `;

            const cuteDetails = isSilhouette ? '' : `
                <!-- 软糯奶黄绒腹 -->
                <path d="M 155,64 C 135,58 103,60 58,66 C 63,87 86,95 112,94 C 136,93 151,81 155,64 Z" fill="url(#${uid}_bellyGrad)"/>
                <!-- 自然翡翠水墨斑点 -->
                <ellipse cx="109" cy="39" rx="5.2" ry="3.8" fill="${spotFill}"/>
                <ellipse cx="90" cy="46" rx="5.8" ry="4.4" fill="${spotFill}"/>
                <circle cx="74" cy="54" r="3.8" fill="${spotFill}"/>
                <circle cx="122" cy="48" r="3.2" fill="${spotFill}"/>
                <circle cx="102" cy="54" r="3.0" fill="${spotFill}"/>
                <!-- 3D 玉绿球体顶部柔光 -->
                <ellipse cx="105" cy="34" rx="22" ry="5.5" fill="rgba(255,255,255,0.28)"/>
                <!-- 肚腹轻柔褶皱纹理 -->
                <path d="M 94,76 Q 92,84 95,89 M 108,77 Q 107,85 109,90 M 122,76 Q 123,83 121,88" fill="none" stroke="${isShiny ? 'rgba(219,39,119,0.20)' : 'rgba(180,120,20,0.22)'}" stroke-width="1.35" stroke-linecap="round"/>
            `;

            // 圆润俏皮小嘴自然嵌合在脸颊弧线上（消除突出环与鸭子嘴）
            const faceDetails = isSilhouette ? '' : `
                <ellipse cx="131" cy="63" rx="5.4" ry="3.4" fill="${isShiny ? '#f9a8d4' : '#fda4af'}" opacity="0.62"/>
                <ellipse cx="152.5" cy="61.5" rx="3.0" ry="2.0" fill="${isShiny ? '#fbcfe8' : '#fecdd3'}" opacity="0.72"/>
                <path d="M 155.5,60.2 Q 152.5,63.2 148.5,61.0" fill="none" stroke="${outline}" stroke-width="1.35" stroke-linecap="round"/>
                <circle cx="154.5" cy="60.8" r="1.05" fill="#0f172a" opacity="0.58"/>
            `;

            return `
                <defs>
                    <radialGradient id="${uid}_bodyGrad" cx="40%" cy="32%" r="70%">
                        <stop offset="0%" stop-color="${domeTop}"/>
                        <stop offset="56%" stop-color="${domeMid}"/>
                        <stop offset="100%" stop-color="${domeEdge}"/>
                    </radialGradient>
                    <linearGradient id="${uid}_bellyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${bellyCream}" stop-opacity="0.65"/>
                        <stop offset="100%" stop-color="${bellyCream}" stop-opacity="0.98"/>
                    </linearGradient>
                    <linearGradient id="${uid}_finGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="${isSilhouette ? palette.fin : (isShiny ? palette.finLight : '#a7f3d0')}" stop-opacity="0.88"/>
                        <stop offset="100%" stop-color="${isSilhouette ? palette.finDark : (isShiny ? palette.fin : '#34d399')}" stop-opacity="${isSilhouette ? 0.92 : 0.62}"/>
                    </linearGradient>
                    <clipPath id="${uid}_bodyClip">
                        <path d="${bodyPath}"/>
                    </clipPath>
                </defs>

                <!-- 蝉翼小扇尾 -->
                <g class="svg-fish-tail">
                    <path d="${tailPath}" fill="url(#${uid}_finGrad)" stroke="${outline}" stroke-width="1.15" stroke-linejoin="round"/>
                    ${!isSilhouette ? art.svgFinRays([
                        'M 54,57 L 26,51',
                        'M 54,60 L 24,60',
                        'M 54,63 L 26,69'
                    ], rayColor, 0.7, 0.85) : ''}
                </g>

                <!-- 随 .is-puffed 伸张的纤细小针刺 -->
                <g class="svg-puffer-spines">
                    ${outerSpines}
                </g>

                <!-- 随 .is-puffed 鼓胀的主体玉球 -->
                <g class="svg-puffer-body">
                    <path d="${dorsalPath}" fill="url(#${uid}_finGrad)" stroke="${outline}" stroke-width="1.1" stroke-linejoin="round"/>
                    <path d="${analPath}" fill="url(#${uid}_finGrad)" stroke="${outline}" stroke-width="1.1" stroke-linejoin="round"/>

                    <path d="${bodyPath}" fill="url(#${uid}_bodyGrad)" stroke="${outline}" stroke-width="1.5" stroke-linejoin="round"/>
                    <g clip-path="url(#${uid}_bodyClip)">
                        ${cuteDetails}
                    </g>

                    ${surfaceSpines}
                    ${faceDetails}

                    <!-- 蝉翼小胸鳍 -->
                    <g class="svg-fish-pec" style="transform-box: view-box; transform-origin: 118px 67px;">
                        <path d="${pecPath}" fill="url(#${uid}_finGrad)" fill-opacity="${isSilhouette ? 0.92 : 0.68}" stroke="${outline}" stroke-width="1.05" stroke-linejoin="round"/>
                        ${!isSilhouette ? art.svgFinRays([
                            'M 116,66 L 101,64',
                            'M 116,68 L 101,71'
                        ], rayColor, 0.72, 0.85) : ''}
                    </g>

                    ${art.svgEye(138, 49, 7.3, isSilhouette, isShiny ? palette.iris : '#10b981', { style: 'cute', uid })}
                </g>

                ${art.svgShinyOverlay(isSilhouette, isShiny)}
            `;
        },

        drawCanvas(ctx, size, time, opts) {
            const { art, isShiny, palette, s, speedRatio, bodyBend, puffFactor, wagPhase, finPhase, phaseOffset } = parseCanvasOpts(size, time, opts);
            const puff = clamp(puffFactor, 0, 1.2);
            const breath = Math.sin(finPhase * 0.22 + phaseOffset) * 0.025;
            const rx = s * (0.74 + puff * 0.22 + breath);
            const ry = s * (0.58 + puff * 0.30 + breath * 1.1);
            const tailWag = Math.sin(wagPhase) * (0.26 + speedRatio * 0.05) + bodyBend * 0.38;
            const outline = isShiny ? palette.outline : '#064e3b';
            const spineColor = isShiny ? '#e0f2fe' : '#a7f3d0';

            ctx.save();
            ctx.rotate(bodyBend * 0.18);

            // 1. 蝉翼小扇尾
            ctx.save();
            ctx.translate(-rx * 0.88, 0);
            ctx.rotate(tailWag);
            ctx.fillStyle = isShiny ? palette.finLight : 'rgba(167,243,208,0.78)';
            ctx.strokeStyle = outline;
            ctx.lineWidth = 1.0;
            ctx.beginPath();
            ctx.moveTo(0, -s * 0.10);
            ctx.quadraticCurveTo(-s * 0.34, -s * 0.28, -s * 0.42, -s * 0.14);
            ctx.quadraticCurveTo(-s * 0.44, 0, -s * 0.42, s * 0.14);
            ctx.quadraticCurveTo(-s * 0.34, s * 0.28, 0, s * 0.10);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 2. 纤细珠光小针刺
            const spineLen = s * (0.10 + puff * 0.17);
            const spineBaseHalf = s * (0.036 + puff * 0.01);
            const angles = [-2.45, -2.0, -1.55, -1.12, -0.72, 0.72, 1.18, 1.62, 2.08, 2.52];
            ctx.fillStyle = spineColor;
            ctx.strokeStyle = outline;
            ctx.lineWidth = 0.85;
            for (let i = 0; i < angles.length; i++) {
                const a = angles[i];
                const bx = Math.cos(a) * rx * 0.92;
                const by = Math.sin(a) * ry * 0.92;
                const lean = (1 - Math.min(1, puff)) * (Math.sin(a) < 0 ? -0.35 : 0.35);
                const tipA = a + lean;
                const tx = bx + Math.cos(tipA) * spineLen;
                const ty = by + Math.sin(tipA) * spineLen;
                const px = -Math.sin(a) * spineBaseHalf;
                const py = Math.cos(a) * spineBaseHalf;
                ctx.beginPath();
                ctx.moveTo(bx + px, by + py);
                ctx.lineTo(tx, ty);
                ctx.lineTo(bx - px, by - py);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }

            // 3. 背鳍
            ctx.fillStyle = isShiny ? palette.finLight : 'rgba(167,243,208,0.82)';
            ctx.strokeStyle = outline;
            ctx.lineWidth = 0.95;
            ctx.beginPath();
            ctx.ellipse(-rx * 0.36, -ry * 0.92, s * 0.13, s * 0.09, -0.35, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // 4. 3D 玉绿球体
            const bodyGrad = ctx.createRadialGradient(-rx * 0.18, -ry * 0.36, s * 0.08, 0, 0, Math.max(rx, ry) * 1.12);
            bodyGrad.addColorStop(0, isShiny ? palette.bodyLight : '#5eead4');
            bodyGrad.addColorStop(0.58, isShiny ? palette.body : '#10b981');
            bodyGrad.addColorStop(1, isShiny ? palette.bodyDark : '#065f46');
            ctx.fillStyle = bodyGrad;
            ctx.beginPath();
            ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
            ctx.fill();

            ctx.save();
            ctx.clip();

            const bellyGrad = ctx.createLinearGradient(0, ry * 0.05, 0, ry);
            bellyGrad.addColorStop(0, isShiny ? 'rgba(255, 241, 242, 0.62)' : 'rgba(254, 252, 232, 0.65)');
            bellyGrad.addColorStop(1, isShiny ? palette.bellyWarm : '#fefce8');
            ctx.fillStyle = bellyGrad;
            ctx.beginPath();
            ctx.ellipse(0, ry * 0.56, rx * 1.06, ry * 0.62, 0, 0, Math.PI * 2);
            ctx.fill();

            // 斑点
            ctx.fillStyle = isShiny ? 'rgba(219, 39, 119, 0.32)' : 'rgba(6, 78, 59, 0.32)';
            const spots = [[-0.36, -0.34, 0.085], [-0.08, -0.48, 0.10], [0.18, -0.36, 0.08], [-0.22, -0.18, 0.065]];
            for (let i = 0; i < spots.length; i++) {
                ctx.beginPath();
                ctx.arc(spots[i][0] * rx, spots[i][1] * ry, spots[i][2] * s, 0, Math.PI * 2);
                ctx.fill();
            }

            // 体表立体小刺
            const surfLen = s * (0.055 + puff * 0.09);
            ctx.fillStyle = spineColor;
            const surfSpots = [[-0.25, -0.52], [0.05, -0.55], [-0.46, -0.12], [-0.15, 0.42], [0.16, 0.45]];
            for (let i = 0; i < surfSpots.length; i++) {
                const sx = surfSpots[i][0] * rx;
                const sy = surfSpots[i][1] * ry;
                const dirY = surfSpots[i][1] < 0 ? -1 : 1;
                ctx.beginPath();
                ctx.moveTo(sx - s * 0.025, sy);
                ctx.lineTo(sx - (1 - Math.min(1, puff)) * s * 0.04, sy + dirY * surfLen);
                ctx.lineTo(sx + s * 0.025, sy);
                ctx.closePath();
                ctx.fill();
            }
            ctx.restore();

            ctx.strokeStyle = outline;
            ctx.lineWidth = 1.25;
            ctx.beginPath();
            ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
            ctx.stroke();

            // 5. 软萌腮红与贴合樱桃小嘴
            ctx.fillStyle = isShiny ? 'rgba(249, 168, 212, 0.65)' : 'rgba(253, 164, 175, 0.62)';
            ctx.beginPath();
            ctx.ellipse(rx * 0.48, ry * 0.12, s * 0.09, s * 0.055, 0, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(1.0, s * 0.045);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(rx * 0.95, ry * 0.04);
            ctx.quadraticCurveTo(rx * 0.88, ry * 0.07, rx * 0.80, ry * 0.04);
            ctx.stroke();

            ctx.fillStyle = '#0f172a';
            ctx.beginPath();
            ctx.arc(rx * 0.94, ry * 0.05, Math.max(0.9, s * (0.032 + puff * 0.012)), 0, Math.PI * 2);
            ctx.fill();

            // 6. 高频扑扇蝉翼小胸鳍
            const pecFlap = Math.sin(finPhase) * 0.36;
            ctx.save();
            ctx.translate(rx * 0.16, ry * 0.16);
            ctx.rotate(pecFlap);
            ctx.fillStyle = isShiny ? palette.finLight : 'rgba(167,243,208,0.68)';
            ctx.strokeStyle = outline;
            ctx.lineWidth = 0.85;
            ctx.beginPath();
            ctx.ellipse(-s * 0.14, 0, s * 0.17, s * 0.11, -0.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 7. 晶莹萌眼
            const eyeR = Math.max(2.6, s * (0.185 + puff * 0.03));
            if (art && typeof art.drawCanvasEye === 'function') {
                art.drawCanvasEye(ctx, rx * 0.56, -ry * 0.22, eyeR, isShiny ? palette.iris : '#10b981', { style: 'cute' });
            }

            ctx.restore();
        }
    };

    // ========================================================================
    // 3. 星点虹鳟 (trout)
    // ========================================================================
    MODELS.trout = {
        motion: {
            swimStyle: 'dart',
            tailFreq: 10.6,
            tailAmp: 0.25,
            bodyFlex: 0.22,
            pectoralFreq: 7.2,
            turnAgility: 1.35,
            bobAmp: 2.6,
            tailPivot: '45px 60px'
        },

        buildSVGContent(ctxInfo) {
            const { isSilhouette, isShiny, uid, palette, art } = ctxInfo;

            const bodyPath = 'M 179,57 C 170,45 147,35 117,34 C 87,34 62,43 44,53 L 44,67 C 64,78 93,86 125,83 C 151,80 169,70 177,62 L 163,60 Z';
            const dorsalPath = 'M 116,35 C 109,20 98,16 89,21 C 88,28 87,34 86,38 Z';
            const adiposePath = 'M 68,43 C 64,33 57,33 56,41 C 59,44 64,45 68,43 Z';
            const pelvicPath = 'M 112,82 C 106,96 96,99 93,96 C 96,89 101,84 106,81 Z';
            const analPath = 'M 79,78 C 75,92 65,94 61,90 C 62,84 63,79 65,75 Z';
            const tailPath = 'M 47,53 C 34,42 21,34 14,35 C 17,46 21,54 24,60 C 21,66 17,74 14,85 C 21,86 34,78 47,67 Z';
            const pecPath = 'M 135,70 C 122,74 111,83 114,89 C 123,89 133,80 137,72 Z';

            const backTop = isSilhouette ? palette.bodyDark : (isShiny ? palette.bodyDark : '#354b62');
            const midSilver = isSilhouette ? palette.body : (isShiny ? palette.bodyLight : '#aebfd0');
            const bellyTone = isSilhouette ? palette.belly : (isShiny ? palette.bellyWarm : '#f8fafc');
            const finBase = isSilhouette ? palette.finDark : (isShiny ? palette.fin : '#7d8fa4');
            const finLight = isSilhouette ? palette.finLight : (isShiny ? palette.finLight : '#e2cbd9');
            const outline = isSilhouette ? palette.stroke : (isShiny ? palette.outline : '#26384a');
            const spotDark = isShiny ? '#831843' : '#131f2e';
            const rayColor = isSilhouette ? 'rgba(148,163,184,0.18)' : 'rgba(255,255,255,0.56)';

            const troutSpot = (cx, cy, r, op = 0.68) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${spotDark}" opacity="${op}"/>`;

            const bodyDetails = isSilhouette ? '' : `
                <!-- 羽化多层珠光粉紫彩虹侧带 -->
                <path d="M 44,58 Q 98,53 147,57 L 147,65 Q 98,62 44,63 Z" fill="url(#${uid}_rainbowBand)"/>
                <path d="M 48,58 Q 98,54 143,57" fill="none" stroke="${isShiny ? '#fef08a' : '#fce7f3'}" stroke-width="2.6" stroke-linecap="round" opacity="0.55"/>

                <!-- 背部与上体侧错落细密星点 -->
                <g>
                    ${troutSpot(141, 44, 1.2)} ${troutSpot(133, 41, 1.4)} ${troutSpot(124, 45, 1.3)}
                    ${troutSpot(117, 39, 1.5)} ${troutSpot(109, 43, 1.6)} ${troutSpot(101, 39, 1.3)}
                    ${troutSpot(95, 45, 1.5)} ${troutSpot(87, 42, 1.4)} ${troutSpot(81, 47, 1.6)}
                    ${troutSpot(74, 44, 1.3)} ${troutSpot(67, 49, 1.5)} ${troutSpot(60, 52, 1.3)}
                    ${troutSpot(52, 54, 1.4)} ${troutSpot(129, 50, 1.1)} ${troutSpot(103, 51, 1.2)}
                    ${troutSpot(89, 52, 1.2)} ${troutSpot(72, 55, 1.1)} ${troutSpot(56, 61, 1.2)}
                </g>

                <!-- 鳃盖淡玫瑰虹彩红晕、修长上颌骨线与背部光泽 -->
                <ellipse cx="142" cy="59" rx="5.8" ry="8.5" fill="${isShiny ? '#f472b6' : '#fb7185'}" opacity="0.26"/>
                <path d="M 143,45 Q 134,58 142,73" fill="none" stroke="${outline}" stroke-width="1.45" stroke-linecap="round" opacity="0.62"/>
                <path d="M 145,47 Q 136,58 143.5,71" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="0.95" stroke-linecap="round"/>
                <path d="M 176,59 Q 162,62 151,61" fill="none" stroke="${outline}" stroke-width="1.3" stroke-linecap="round"/>
                <path d="M 60,46 Q 108,35 154,45" fill="none" stroke="rgba(255,255,255,0.40)" stroke-width="2.5" stroke-linecap="round"/>
            `;

            const dorsalSpots = isSilhouette ? '' : `
                <g fill="${spotDark}" opacity="0.62">
                    <circle cx="98" cy="24" r="1.25"/>
                    <circle cx="105" cy="27" r="1.35"/>
                    <circle cx="93" cy="30" r="1.25"/>
                    <circle cx="101" cy="32" r="1.2"/>
                    <circle cx="109" cy="33" r="1.1"/>
                </g>
            `;

            const tailSpots = isSilhouette ? '' : `
                <g fill="${spotDark}" opacity="0.60">
                    <circle cx="34" cy="48" r="1.25"/>
                    <circle cx="24" cy="41" r="1.15"/>
                    <circle cx="29" cy="55" r="1.1"/>
                    <circle cx="37" cy="60" r="1.2"/>
                    <circle cx="26" cy="67" r="1.25"/>
                    <circle cx="35" cy="72" r="1.15"/>
                    <circle cx="21" cy="78" r="1.1"/>
                </g>
            `;

            return `
                <defs>
                    <linearGradient id="${uid}_bodyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${backTop}"/>
                        <stop offset="48%" stop-color="${midSilver}"/>
                        <stop offset="100%" stop-color="${bellyTone}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_rainbowBand" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${isShiny ? '#38bdf8' : '#e879f9'}" stop-opacity="0"/>
                        <stop offset="35%" stop-color="${isShiny ? '#f472b6' : '#f472b6'}" stop-opacity="0.62"/>
                        <stop offset="62%" stop-color="${isShiny ? '#fde047' : '#fb7185'}" stop-opacity="0.72"/>
                        <stop offset="100%" stop-color="${isShiny ? '#f472b6' : '#f472b6'}" stop-opacity="0"/>
                    </linearGradient>
                    <linearGradient id="${uid}_finGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${finBase}" stop-opacity="0.88"/>
                        <stop offset="100%" stop-color="${finLight}" stop-opacity="${isSilhouette ? 0.9 : 0.72}"/>
                    </linearGradient>
                    <clipPath id="${uid}_bodyClip">
                        <path d="${bodyPath}"/>
                    </clipPath>
                </defs>

                <!-- 尾鳍 (含放射星点) -->
                <g class="svg-fish-tail">
                    <path d="${tailPath}" fill="url(#${uid}_finGrad)" stroke="${outline}" stroke-width="1.25" stroke-linejoin="round"/>
                    ${!isSilhouette ? art.svgFinRays([
                        'M 45,56 L 19,40',
                        'M 45,59 L 23,51',
                        'M 45,61 L 23,69',
                        'M 45,64 L 19,80'
                    ], rayColor, 0.58, 0.9) : ''}
                    ${tailSpots}
                </g>

                <!-- 腹鳍与臀鳍 (带浅色前缘) -->
                <path d="${pelvicPath}" fill="${isSilhouette ? palette.fin : (isShiny ? palette.finLight : '#ebd9e4')}" stroke="${outline}" stroke-width="1.1" stroke-linejoin="round"/>
                <path d="${analPath}" fill="url(#${uid}_finGrad)" stroke="${outline}" stroke-width="1.15" stroke-linejoin="round"/>
                ${isSilhouette ? '' : `<path d="M 79,79 L 65,91" fill="none" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" opacity="0.82"/>`}

                <!-- 迷你脂鳍 -->
                <path d="${adiposePath}" fill="${isSilhouette ? palette.fin : (isShiny ? '#f472b6' : '#64748b')}" stroke="${outline}" stroke-width="1.1" stroke-linejoin="round"/>
                ${isSilhouette ? '' : `<path d="M 65,39 Q 60,34 57,38" fill="none" stroke="${isShiny ? '#fef08a' : '#f9a8d4'}" stroke-width="1.1" stroke-linecap="round" opacity="0.72"/>`}

                <!-- 主背鳍 -->
                <path d="${dorsalPath}" fill="url(#${uid}_finGrad)" stroke="${outline}" stroke-width="1.2" stroke-linejoin="round"/>
                ${!isSilhouette ? art.svgFinRays([
                    'M 109,35 L 105,21',
                    'M 101,35 L 97,20',
                    'M 93,36 L 91,23'
                ], rayColor, 0.55, 0.85) : ''}
                ${dorsalSpots}

                <!-- 流线鲑科鱼身 -->
                <path d="${bodyPath}" fill="url(#${uid}_bodyGrad)" stroke="${outline}" stroke-width="1.5" stroke-linejoin="round"/>
                <g clip-path="url(#${uid}_bodyClip)">
                    ${bodyDetails}
                </g>

                <!-- 胸鳍 -->
                <g class="svg-fish-pec" style="transform-box: view-box; transform-origin: 135px 71px;">
                    <path d="${pecPath}" fill="url(#${uid}_finGrad)" fill-opacity="${isSilhouette ? 0.94 : 0.82}" stroke="${outline}" stroke-width="1.1" stroke-linejoin="round"/>
                    ${!isSilhouette ? art.svgFinRays(['M 132,72 L 117,82', 'M 133,73 L 120,85'], rayColor, 0.58, 0.85) : ''}
                </g>

                ${art.svgEye(156, 51, 5.1, isSilhouette, isShiny ? palette.iris : '#eab308', { style: 'natural', uid })}
                ${art.svgShinyOverlay(isSilhouette, isShiny)}
            `;
        },

        drawCanvas(ctx, size, time, opts) {
            const { art, isShiny, palette, s, speedRatio, bodyBend, wagPhase, finPhase } = parseCanvasOpts(size, time, opts);
            const spine = computeSpine(art, s * 1.02, -s * 0.88, 9, bodyBend, wagPhase, s * 0.068, 0.68);
            const topW = [s * 0.10, s * 0.26, s * 0.37, s * 0.42, s * 0.41, s * 0.35, s * 0.26, s * 0.18, s * 0.11];
            const botW = [s * 0.11, s * 0.28, s * 0.39, s * 0.43, s * 0.41, s * 0.34, s * 0.24, s * 0.17, s * 0.11];
            const { topPts, botPts } = buildAsymmetricEnvelope(art, spine, topW, botW);

            const tailBase = spine[spine.length - 1];
            const tailBaseAng = getTailBaseAngle(spine);
            const tailWag = Math.sin(wagPhase - 0.8) * (0.24 + speedRatio * 0.05) + bodyBend * 0.45;
            const outline = isShiny ? palette.outline : '#26384a';

            ctx.save();

            // 1. 尾鳍 (带斑点)
            ctx.save();
            ctx.translate(tailBase.x, tailBase.y);
            ctx.rotate(tailBaseAng + tailWag);
            ctx.fillStyle = isShiny ? palette.fin : '#7d8fa4';
            ctx.strokeStyle = outline;
            ctx.lineWidth = 1.05;
            ctx.beginPath();
            ctx.moveTo(0, -s * 0.09);
            ctx.quadraticCurveTo(-s * 0.28, -s * 0.36, -s * 0.48, -s * 0.38);
            ctx.lineTo(-s * 0.36, 0);
            ctx.lineTo(-s * 0.48, s * 0.38);
            ctx.quadraticCurveTo(-s * 0.28, s * 0.36, 0, s * 0.09);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = isShiny ? '#831843' : '#131f2e';
            const tDots = [[-0.24, -0.15], [-0.34, -0.22], [-0.28, 0], [-0.35, 0.20], [-0.22, 0.16]];
            for (let i = 0; i < tDots.length; i++) {
                ctx.beginPath();
                ctx.arc(tDots[i][0] * s, tDots[i][1] * s, Math.max(0.75, s * 0.028), 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();

            // 2. 迷你脂鳍 + 主背鳍 + 臀鳍/腹鳍
            ctx.fillStyle = isShiny ? '#f472b6' : '#64748b';
            ctx.strokeStyle = outline;
            ctx.lineWidth = 0.95;
            ctx.beginPath();
            ctx.moveTo(topPts[6].x + s * 0.05, topPts[6].y + s * 0.02);
            ctx.quadraticCurveTo(topPts[7].x + s * 0.05, topPts[7].y - s * 0.16, topPts[7].x - s * 0.05, topPts[7].y + s * 0.01);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = isShiny ? palette.fin : '#7d8fa4';
            ctx.beginPath();
            ctx.moveTo(topPts[3].x, topPts[3].y + s * 0.02);
            ctx.quadraticCurveTo(topPts[4].x + s * 0.04, topPts[4].y - s * 0.30, topPts[5].x, topPts[5].y + s * 0.01);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(botPts[5].x, botPts[5].y - s * 0.02);
            ctx.quadraticCurveTo(botPts[6].x, botPts[6].y + s * 0.22, botPts[7].x + s * 0.04, botPts[7].y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = isShiny ? palette.finLight : '#ebd9e4';
            ctx.beginPath();
            ctx.moveTo(botPts[3].x, botPts[3].y - s * 0.02);
            ctx.quadraticCurveTo(botPts[4].x - s * 0.04, botPts[4].y + s * 0.22, botPts[4].x - s * 0.12, botPts[4].y + s * 0.12);
            ctx.closePath();
            ctx.fill();

            // 3. 流线鳟鱼身 + 羽化粉紫彩虹带
            const bodyGrad = ctx.createLinearGradient(0, -s * 0.38, 0, s * 0.38);
            bodyGrad.addColorStop(0, isShiny ? palette.bodyDark : '#354b62');
            bodyGrad.addColorStop(0.5, isShiny ? palette.bodyLight : '#aebfd0');
            bodyGrad.addColorStop(1, isShiny ? palette.bellyWarm : '#f8fafc');
            traceEnvelopePath(art, ctx, spine, topPts, botPts, s * 0.14);
            ctx.fillStyle = bodyGrad;
            ctx.fill();

            ctx.save();
            ctx.clip();

            // 柔和羽化多层虹彩带（外层软光 + 内层粉金）
            ctx.strokeStyle = isShiny ? 'rgba(244, 114, 182, 0.36)' : 'rgba(232, 121, 249, 0.32)';
            ctx.lineWidth = Math.max(3.5, s * 0.25);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(spine[8].x, spine[8].y);
            for (let i = 7; i >= 2; i--) ctx.lineTo(spine[i].x, spine[i].y);
            ctx.stroke();

            const bandGrad = ctx.createLinearGradient(spine[8].x, 0, spine[2].x, 0);
            bandGrad.addColorStop(0, isShiny ? 'rgba(56, 189, 248, 0.65)' : 'rgba(232, 121, 249, 0.56)');
            bandGrad.addColorStop(0.55, isShiny ? 'rgba(244, 114, 182, 0.85)' : 'rgba(244, 114, 182, 0.78)');
            bandGrad.addColorStop(1, isShiny ? 'rgba(253, 224, 71, 0.65)' : 'rgba(251, 113, 133, 0.62)');
            ctx.strokeStyle = bandGrad;
            ctx.lineWidth = Math.max(2.0, s * 0.13);
            ctx.beginPath();
            ctx.moveTo(spine[8].x, spine[8].y);
            for (let i = 7; i >= 2; i--) ctx.lineTo(spine[i].x, spine[i].y);
            ctx.stroke();

            // 背部细密星点
            ctx.fillStyle = isShiny ? 'rgba(131, 24, 67, 0.68)' : 'rgba(19, 31, 46, 0.68)';
            const dotR = Math.max(0.8, s * 0.028);
            for (let i = 2; i <= 7; i++) {
                const p = spine[i];
                ctx.beginPath();
                ctx.arc(p.x + s * 0.04, p.y - topW[i] * 0.56, dotR, 0, Math.PI * 2);
                ctx.arc(p.x - s * 0.05, p.y - topW[i] * 0.36, dotR * 0.85, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();

            traceEnvelopePath(art, ctx, spine, topPts, botPts, s * 0.14);
            ctx.strokeStyle = outline;
            ctx.lineWidth = 1.2;
            ctx.stroke();

            // 4. 胸鳍
            const headAng = getHeadAngle(spine);
            const pecWag = Math.sin(finPhase) * 0.25;
            ctx.save();
            ctx.translate(spine[2].x - s * 0.03, spine[2].y + s * 0.18);
            ctx.rotate(headAng + pecWag);
            ctx.fillStyle = isShiny ? palette.finLight : '#e2cbd9';
            ctx.globalAlpha = 0.84;
            ctx.strokeStyle = outline;
            ctx.lineWidth = 0.85;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(-s * 0.22, s * 0.05, -s * 0.24, s * 0.20);
            ctx.quadraticCurveTo(-s * 0.10, s * 0.22, 0, s * 0.05);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 5. 眼睛
            if (art && typeof art.drawCanvasEye === 'function') {
                art.drawCanvasEye(ctx, spine[1].x + s * 0.04, spine[1].y - s * 0.09, Math.max(2.1, s * 0.125), isShiny ? palette.iris : '#eab308', { style: 'natural' });
            }

            ctx.restore();
        }
    };

    // ========================================================================
    // 4. 大口黑鲈 (bass)
    // ========================================================================
    MODELS.bass = {
        motion: {
            swimStyle: 'dart',
            tailFreq: 9.8,
            tailAmp: 0.25,
            bodyFlex: 0.20,
            pectoralFreq: 6.4,
            turnAgility: 1.30,
            bobAmp: 2.8,
            tailPivot: '45px 60px'
        },

        buildSVGContent(ctxInfo) {
            const { isSilhouette, isShiny, uid, palette, art } = ctxInfo;

            const bodyPath = 'M 176,52 C 165,39 143,31 114,30 C 86,30 62,40 45,51 L 45,69 C 65,81 94,89 126,86 C 149,84 169,75 182,59 L 180,55 L 157,59 Z';
            const spinyDorsalPath = 'M 131,32 L 128,21 L 124,25 L 121,18 L 117,23 L 113,17 L 109,23 L 105,19 L 101,32 Z';
            const softDorsalPath = 'M 100,32 C 94,18 78,16 68,24 C 65,30 64,38 64,43 L 100,34 Z';
            const analPath = 'M 88,83 C 83,101 70,104 64,95 C 62,88 61,80 62,74 Z';
            const pelvicPath = 'M 131,84 C 122,98 112,102 108,98 C 112,90 118,85 125,82 Z';
            const tailPath = 'M 47,51 C 33,40 20,33 14,34 C 18,46 22,54 26,60 C 22,66 18,74 14,86 C 20,87 33,80 47,69 Z';
            const pecPath = 'M 133,68 C 119,66 108,74 110,83 C 118,86 129,80 135,72 Z';

            const backColor = isSilhouette ? palette.bodyDark : (isShiny ? palette.bodyDark : '#2b4714');
            const midOlive = isSilhouette ? palette.body : (isShiny ? palette.body : '#5f8a22');
            const bronzeFlank = isSilhouette ? palette.body : (isShiny ? palette.belly : '#9db858');
            const bellyCream = isSilhouette ? palette.belly : (isShiny ? palette.bellyWarm : '#f2f7dc');
            const finTop = isSilhouette ? palette.finLight : (isShiny ? palette.finLight : '#6a9626');
            const finBot = isSilhouette ? palette.finDark : (isShiny ? palette.finDark : '#2d4713');
            const outline = isSilhouette ? palette.stroke : (isShiny ? palette.outline : '#1d300b');
            const camoFill = isShiny ? 'rgba(131, 24, 67, 0.48)' : 'rgba(18, 36, 9, 0.62)';
            const rayColor = isSilhouette ? 'rgba(148,163,184,0.18)' : 'rgba(236,252,203,0.52)';

            // 彻底移除机械菱形串 ◇◇◇，采用自然迷彩斑块纵带 + 背部迷彩暗纹
            const bodyDetails = isSilhouette ? '' : `
                <g fill="${camoFill}">
                    <path d="M 48,59 C 54,53 64,55 69,60 C 74,64 81,52 90,54 C 98,55 103,64 112,56 C 120,49 129,56 138,57 C 141,62 136,66 129,64 C 121,62 117,70 109,65 C 102,60 95,70 86,65 C 77,61 72,69 63,65 C 55,61 52,66 47,62 Z"/>
                    <path d="M 114,34 C 121,31 128,35 126,41 C 120,44 112,41 114,34 Z" opacity="0.62"/>
                    <path d="M 88,35 C 97,32 104,37 100,44 C 92,46 85,42 88,35 Z" opacity="0.58"/>
                    <path d="M 65,43 C 73,39 80,43 76,49 C 69,52 63,48 65,43 Z" opacity="0.55"/>
                </g>
                <!-- 眼后深色辐射颊纹与金属古铜鳃盖 -->
                <path d="M 146,53 Q 139,57 132,59 M 148,57 Q 141,62 134,67" fill="none" stroke="${camoFill}" stroke-width="2.0" stroke-linecap="round" opacity="0.72"/>
                <path d="M 136,42 Q 129,59 135,77" fill="none" stroke="${outline}" stroke-width="1.55" stroke-linecap="round" opacity="0.62"/>
                <path d="M 138,44 Q 132,59 137,75" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="0.95" stroke-linecap="round"/>
                <path d="M 66,44 Q 108,30 148,40" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="2.8" stroke-linecap="round"/>
            `;

            const jawFeature = isSilhouette ? '' : `
                <path d="M 176,52 L 156,59 L 181,56 Z" fill="#090d16" opacity="0.86"/>
                <path d="M 174,52 L 156,59 L 139,68" fill="none" stroke="#090d16" stroke-width="2.0" stroke-linecap="round" opacity="0.82"/>
                <path d="M 155,60 L 139,69" fill="none" stroke="rgba(255,255,255,0.32)" stroke-width="1.05" stroke-linecap="round"/>
            `;

            return `
                <defs>
                    <linearGradient id="${uid}_bodyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${backColor}"/>
                        <stop offset="40%" stop-color="${midOlive}"/>
                        <stop offset="72%" stop-color="${bronzeFlank}"/>
                        <stop offset="100%" stop-color="${bellyCream}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_finGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${finTop}" stop-opacity="0.86"/>
                        <stop offset="100%" stop-color="${finBot}" stop-opacity="0.92"/>
                    </linearGradient>
                    <clipPath id="${uid}_bodyClip">
                        <path d="${bodyPath}"/>
                    </clipPath>
                </defs>

                <!-- 尾鳍 -->
                <g class="svg-fish-tail">
                    <path d="${tailPath}" fill="url(#${uid}_finGrad)" stroke="${outline}" stroke-width="1.25" stroke-linejoin="round"/>
                    ${!isSilhouette ? art.svgFinRays([
                        'M 45,55 L 18,38',
                        'M 45,59 L 22,52',
                        'M 45,61 L 22,68',
                        'M 45,65 L 18,82'
                    ], rayColor, 0.58, 0.9) : ''}
                </g>

                <!-- 腹鳍与臀鳍 -->
                <path d="${pelvicPath}" fill="url(#${uid}_finGrad)" stroke="${outline}" stroke-width="1.1" stroke-linejoin="round"/>
                <path d="${analPath}" fill="url(#${uid}_finGrad)" stroke="${outline}" stroke-width="1.2" stroke-linejoin="round"/>
                ${!isSilhouette ? art.svgFinRays(['M 81,82 L 77,98', 'M 72,78 L 69,95'], rayColor, 0.52, 0.85) : ''}

                <!-- 前刺后软双背鳍 -->
                <path d="${spinyDorsalPath}" fill="url(#${uid}_finGrad)" stroke="${outline}" stroke-width="1.2" stroke-linejoin="round"/>
                <path d="${softDorsalPath}" fill="url(#${uid}_finGrad)" stroke="${outline}" stroke-width="1.2" stroke-linejoin="round"/>
                ${!isSilhouette ? art.svgFinRays([
                    'M 121,30 L 121,19',
                    'M 113,30 L 113,18',
                    'M 105,30 L 105,20',
                    'M 90,33 L 88,20',
                    'M 80,35 L 78,20',
                    'M 71,38 L 69,25'
                ], rayColor, 0.52, 0.85) : ''}

                <!-- 强壮掠食鱼身 -->
                <path d="${bodyPath}" fill="url(#${uid}_bodyGrad)" stroke="${outline}" stroke-width="1.5" stroke-linejoin="round"/>
                <g clip-path="url(#${uid}_bodyClip)">
                    ${bodyDetails}
                </g>
                ${jawFeature}

                <!-- 胸鳍 -->
                <g class="svg-fish-pec" style="transform-box: view-box; transform-origin: 133px 70px;">
                    <path d="${pecPath}" fill="url(#${uid}_finGrad)" fill-opacity="${isSilhouette ? 0.94 : 0.82}" stroke="${outline}" stroke-width="1.1" stroke-linejoin="round"/>
                    ${!isSilhouette ? art.svgFinRays(['M 131,71 L 113,76', 'M 131,73 L 115,82'], rayColor, 0.54, 0.85) : ''}
                </g>

                ${art.svgEye(151, 48, 5.1, isSilhouette, isShiny ? palette.iris : '#f59e0b', { style: 'fierce', uid, browColor: isShiny ? '#78350f' : '#1d300b' })}
                ${art.svgShinyOverlay(isSilhouette, isShiny)}
            `;
        },

        drawCanvas(ctx, size, time, opts) {
            const { art, isShiny, palette, s, speedRatio, bodyBend, wagPhase, finPhase } = parseCanvasOpts(size, time, opts);
            const spine = computeSpine(art, s * 1.00, -s * 0.88, 9, bodyBend, wagPhase, s * 0.062, 0.65);
            const topW = [s * 0.11, s * 0.33, s * 0.48, s * 0.53, s * 0.50, s * 0.43, s * 0.31, s * 0.21, s * 0.13];
            const botW = [s * 0.14, s * 0.35, s * 0.48, s * 0.53, s * 0.49, s * 0.42, s * 0.30, s * 0.20, s * 0.13];
            const { topPts, botPts } = buildAsymmetricEnvelope(art, spine, topW, botW);

            const tailBase = spine[spine.length - 1];
            const tailBaseAng = getTailBaseAngle(spine);
            const tailWag = Math.sin(wagPhase - 0.75) * (0.24 + speedRatio * 0.05) + bodyBend * 0.44;
            const outline = isShiny ? palette.outline : '#1d300b';

            ctx.save();

            // 1. 尾鳍
            ctx.save();
            ctx.translate(tailBase.x, tailBase.y);
            ctx.rotate(tailBaseAng + tailWag);
            ctx.fillStyle = isShiny ? palette.fin : '#4d7c0f';
            ctx.strokeStyle = outline;
            ctx.lineWidth = 1.05;
            ctx.beginPath();
            ctx.moveTo(0, -s * 0.11);
            ctx.quadraticCurveTo(-s * 0.30, -s * 0.38, -s * 0.48, -s * 0.38);
            ctx.lineTo(-s * 0.33, 0);
            ctx.lineTo(-s * 0.48, s * 0.38);
            ctx.quadraticCurveTo(-s * 0.30, s * 0.38, 0, s * 0.11);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 2. 双背鳍与臀/腹鳍
            ctx.fillStyle = isShiny ? palette.fin : '#4d7c0f';
            ctx.strokeStyle = outline;
            ctx.lineWidth = 1.0;

            ctx.beginPath();
            ctx.moveTo(topPts[2].x - s * 0.02, topPts[2].y + s * 0.02);
            ctx.lineTo(topPts[2].x - s * 0.07, topPts[2].y - s * 0.16);
            ctx.lineTo(topPts[3].x + s * 0.07, topPts[3].y - s * 0.09);
            ctx.lineTo(topPts[3].x, topPts[3].y - s * 0.19);
            ctx.lineTo(topPts[4].x + s * 0.06, topPts[4].y - s * 0.06);
            ctx.lineTo(topPts[4].x + s * 0.02, topPts[4].y + s * 0.02);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(topPts[4].x - s * 0.05, topPts[4].y + s * 0.02);
            ctx.quadraticCurveTo(topPts[5].x, topPts[5].y - s * 0.32, topPts[6].x, topPts[6].y + s * 0.02);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(botPts[4].x - s * 0.04, botPts[4].y - s * 0.02);
            ctx.quadraticCurveTo(botPts[5].x, botPts[5].y + s * 0.28, botPts[6].x, botPts[6].y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(botPts[2].x, botPts[2].y - s * 0.02);
            ctx.quadraticCurveTo(botPts[3].x - s * 0.04, botPts[3].y + s * 0.22, botPts[3].x - s * 0.13, botPts[3].y + s * 0.15);
            ctx.closePath();
            ctx.fill();

            // 3. 青铜橄榄掠食主体 + 有机迷彩纵斑（绝无几何菱形串）
            const bodyGrad = ctx.createLinearGradient(0, -s * 0.48, 0, s * 0.48);
            bodyGrad.addColorStop(0, isShiny ? palette.bodyDark : '#2b4714');
            bodyGrad.addColorStop(0.45, isShiny ? palette.body : '#5f8a22');
            bodyGrad.addColorStop(0.75, isShiny ? palette.belly : '#9db858');
            bodyGrad.addColorStop(1, isShiny ? palette.bellyWarm : '#f2f7dc');
            traceEnvelopePath(art, ctx, spine, topPts, botPts, s * 0.18);
            ctx.fillStyle = bodyGrad;
            ctx.fill();

            ctx.save();
            ctx.clip();

            ctx.fillStyle = isShiny ? 'rgba(131, 24, 67, 0.48)' : 'rgba(18, 36, 9, 0.58)';
            const camoBlotches = [
                { idx: 2, offY: -0.02, rx: 0.13, ry: 0.075, rot: 0.18 },
                { idx: 3, offY: 0.03, rx: 0.14, ry: 0.085, rot: -0.22 },
                { idx: 4, offY: -0.04, rx: 0.15, ry: 0.08, rot: 0.15 },
                { idx: 5, offY: 0.02, rx: 0.13, ry: 0.075, rot: -0.18 },
                { idx: 6, offY: -0.01, rx: 0.12, ry: 0.065, rot: 0.12 },
                { idx: 7, offY: 0.01, rx: 0.10, ry: 0.055, rot: -0.10 },
                { idx: 3, offY: -0.28, rx: 0.14, ry: 0.065, rot: 0.05 },
                { idx: 5, offY: -0.24, rx: 0.13, ry: 0.06, rot: -0.08 }
            ];
            for (let i = 0; i < camoBlotches.length; i++) {
                const b = camoBlotches[i];
                const p = spine[b.idx];
                ctx.beginPath();
                ctx.ellipse(p.x, p.y + s * b.offY, s * b.rx, s * b.ry, b.rot, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();

            traceEnvelopePath(art, ctx, spine, topPts, botPts, s * 0.18);
            ctx.strokeStyle = outline;
            ctx.lineWidth = 1.25;
            ctx.stroke();

            // 4. 深裂铰链大下颌
            const headAng = getHeadAngle(spine);
            ctx.save();
            ctx.translate(spine[0].x, spine[0].y);
            ctx.rotate(headAng);
            ctx.strokeStyle = '#090d16';
            ctx.lineWidth = Math.max(1.3, s * 0.06);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(s * 0.10, -s * 0.02);
            ctx.lineTo(-s * 0.10, s * 0.08);
            ctx.lineTo(-s * 0.34, s * 0.17);
            ctx.stroke();
            ctx.restore();

            // 5. 胸鳍
            const pecWag = Math.sin(finPhase) * 0.24;
            ctx.save();
            ctx.translate(spine[2].x - s * 0.04, spine[2].y + s * 0.16);
            ctx.rotate(headAng + pecWag);
            ctx.fillStyle = isShiny ? palette.finLight : '#6a9626';
            ctx.globalAlpha = 0.85;
            ctx.strokeStyle = outline;
            ctx.lineWidth = 0.85;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(-s * 0.24, -s * 0.04, -s * 0.26, s * 0.14);
            ctx.quadraticCurveTo(-s * 0.12, s * 0.18, 0, s * 0.04);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 6. 眼睛
            if (art && typeof art.drawCanvasEye === 'function') {
                art.drawCanvasEye(ctx, spine[1].x + s * 0.02, spine[1].y - s * 0.12, Math.max(2.2, s * 0.13), isShiny ? palette.iris : '#f59e0b', { style: 'fierce', browColor: isShiny ? '#78350f' : '#1d300b' });
            }

            ctx.restore();
        }
    };

    // ========================================================================
    // 5. 三色锦鲤 / 大正三色 (koi)
    // ========================================================================
    MODELS.koi = {
        motion: {
            swimStyle: 'majestic',
            tailFreq: 5.8,
            tailAmp: 0.28,
            bodyFlex: 0.24,
            pectoralFreq: 4.2,
            turnAgility: 0.85,
            bobAmp: 4.0,
            tailPivot: '48px 60px'
        },

        buildSVGContent(ctxInfo) {
            const { isSilhouette, isShiny, uid, palette, art } = ctxInfo;

            const bodyPath = 'M 172,58 C 165,44 145,32 114,32 C 84,32 61,43 46,54 L 46,66 C 62,78 86,88 118,87 C 146,86 165,74 172,62 C 170,60 170,60 172,58 Z';
            // 华丽薄纱蝴蝶翼尾鳍
            const tailPath = 'M 48,55 C 36,34 22,20 12,24 C 10,33 17,47 26,57 C 20,59 18,60 21,61 C 27,63 17,74 12,86 C 10,96 22,99 36,84 C 43,76 46,68 48,65 Z';
            const dorsalPath = 'M 126,33 C 110,14 86,11 69,21 C 66,28 66,37 69,44 Z';
            const pelvicPath = 'M 124,84 C 112,98 96,107 88,103 C 92,93 104,86 114,83 Z';
            const analPath = 'M 79,79 C 72,95 60,101 54,96 C 56,87 59,80 62,76 Z';
            const pecPath = 'M 134,69 C 118,74 99,89 96,100 C 107,103 125,89 136,74 Z';

            const silkTop = isSilhouette ? palette.bodyLight : (isShiny ? palette.bodyLight : '#ffffff');
            const silkMid = isSilhouette ? palette.body : (isShiny ? palette.body : '#f3f6fa');
            const silkBot = isSilhouette ? palette.belly : (isShiny ? palette.bellyWarm : '#cbd5e1');
            const hiBright = isShiny ? '#f472b6' : '#ef4444';
            const hiDeep = isShiny ? '#be185d' : '#b91c1c';
            const sumiColor = isShiny ? '#1e3a8a' : '#111827';
            const veilRoot = isSilhouette ? palette.fin : (isShiny ? palette.fin : '#fed7aa');
            const veilTip = isSilhouette ? palette.finLight : (isShiny ? palette.finLight : '#fffaf0');
            const outline = isSilhouette ? palette.stroke : (isShiny ? palette.outline : '#475569');
            const finOutline = isSilhouette ? palette.stroke : (isShiny ? 'rgba(120, 53, 15, 0.45)' : 'rgba(71, 85, 105, 0.45)');
            const rayColor = isSilhouette ? 'rgba(148,163,184,0.18)' : (isShiny ? 'rgba(255,255,255,0.68)' : 'rgba(249,115,22,0.42)');

            const sankePattern = isSilhouette ? '' : `
                <!-- 细腻白瓷丝绸鲤鱼鳞光 -->
                ${art.svgScalePatch([
                    { y: 45, xs: [94, 108, 122], alpha: 0.42 },
                    { y: 55, xs: [84, 98, 112, 126], alpha: 0.48 },
                    { y: 65, xs: [76, 90, 104, 118], alpha: 0.40 }
                ], {
                    rx: 4.5, ry: 4.2,
                    rimColor: 'rgba(255,255,255,0.55)',
                    shadowColor: 'rgba(100,116,139,0.20)'
                })}

                <!-- 书法流形朱红 (Hi) 大正色块（缠绕鱼背曲面，告别圆形瓢虫斑） -->
                <path d="M 157,41 C 145,31 128,31 120,38 C 115,44 123,55 135,55 C 145,55 154,50 157,41 Z" fill="url(#${uid}_hiGrad)"/>
                <path d="M 107,31 C 94,30 74,35 69,48 C 72,56 85,54 92,61 C 99,68 109,59 109,46 C 110,38 110,33 107,31 Z" fill="url(#${uid}_hiGrad)"/>
                <path d="M 62,46 C 53,50 48,57 50,65 C 58,66 66,60 66,52 Z" fill="url(#${uid}_hiGrad)" opacity="0.92"/>

                <!-- 水墨浓墨 (Sumi) 点睛墨斑 -->
                <path d="M 122,52 C 115,49 108,56 111,64 C 115,70 125,67 125,58 Z" fill="${sumiColor}" opacity="0.88"/>
                <path d="M 94,39 C 87,36 81,43 85,48 C 90,51 97,46 94,39 Z" fill="${sumiColor}" opacity="0.86"/>
                <path d="M 79,66 C 72,64 68,72 73,78 C 80,79 85,72 79,66 Z" fill="${sumiColor}" opacity="0.84"/>
                <path d="M 134,67 C 130,68 129,74 133,76 C 137,76 138,70 134,67 Z" fill="${sumiColor}" opacity="0.82"/>

                <!-- 白瓷背部柔光与鳃盖弧 -->
                <path d="M 62,45 Q 112,30 158,46" fill="none" stroke="rgba(255,255,255,0.58)" stroke-width="3.4" stroke-linecap="round"/>
                <path d="M 139,44 Q 132,59 138,76" fill="none" stroke="rgba(100,116,139,0.40)" stroke-width="1.45" stroke-linecap="round"/>
            `;

            return `
                <defs>
                    <linearGradient id="${uid}_bodyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${silkTop}"/>
                        <stop offset="58%" stop-color="${silkMid}"/>
                        <stop offset="100%" stop-color="${silkBot}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_hiGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="${hiBright}"/>
                        <stop offset="100%" stop-color="${hiDeep}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_veilGrad" x1="100%" y1="50%" x2="0%" y2="50%">
                        <stop offset="0%" stop-color="${veilRoot}" stop-opacity="${isSilhouette ? 0.94 : 0.88}"/>
                        <stop offset="60%" stop-color="${veilTip}" stop-opacity="${isSilhouette ? 0.90 : 0.72}"/>
                        <stop offset="100%" stop-color="${veilTip}" stop-opacity="${isSilhouette ? 0.85 : 0.44}"/>
                    </linearGradient>
                    <clipPath id="${uid}_bodyClip">
                        <path d="${bodyPath}"/>
                    </clipPath>
                </defs>

                <!-- 飘逸薄纱蝴蝶尾 -->
                <g class="svg-fish-tail">
                    <path d="${tailPath}" fill="url(#${uid}_veilGrad)" stroke="${finOutline}" stroke-width="1.05" stroke-linejoin="round"/>
                    ${!isSilhouette ? art.svgFinRays([
                        'M 46,56 C 33,40 21,28 13,26',
                        'M 46,58 C 32,49 21,42 15,39',
                        'M 46,62 C 32,71 21,78 15,81',
                        'M 46,64 C 33,80 21,92 13,94'
                    ], rayColor, 0.72, 0.95) : ''}
                </g>

                <!-- 纱质腹鳍与臀鳍 -->
                <g class="svg-fish-veil">
                    <path d="${pelvicPath}" fill="url(#${uid}_veilGrad)" stroke="${finOutline}" stroke-width="0.95" stroke-linejoin="round"/>
                    <path d="${analPath}" fill="url(#${uid}_veilGrad)" stroke="${finOutline}" stroke-width="0.95" stroke-linejoin="round"/>
                    <path d="${dorsalPath}" fill="url(#${uid}_veilGrad)" stroke="${finOutline}" stroke-width="1.05" stroke-linejoin="round"/>
                    ${!isSilhouette ? art.svgFinRays([
                        'M 116,33 Q 108,20 100,16',
                        'M 103,33 Q 95,19 87,17',
                        'M 90,36 Q 81,21 74,21'
                    ], rayColor, 0.65, 0.9) : ''}
                </g>

                <!-- 白瓷绸缎身躯 -->
                <path d="${bodyPath}" fill="url(#${uid}_bodyGrad)" stroke="${outline}" stroke-width="1.5" stroke-linejoin="round"/>
                <g clip-path="url(#${uid}_bodyClip)">
                    ${sankePattern}
                </g>

                <!-- 渐细优雅双对锦鲤口须 -->
                <g fill="${isSilhouette ? palette.finLight : (isShiny ? '#fef08a' : '#fb923c')}" stroke="${outline}" stroke-width="0.5">
                    <path d="M 167,63 C 176,66 183,72 183,81 C 180,73 174,68 165,65 Z"/>
                    <path d="M 170,60 C 179,61 185,66 186,73 C 183,67 177,63 169,62 Z"/>
                </g>

                <!-- 薄纱蝴蝶长胸鳍 -->
                <g class="svg-fish-pec" style="transform-box: view-box; transform-origin: 134px 70px;">
                    <path d="${pecPath}" fill="url(#${uid}_veilGrad)" stroke="${finOutline}" stroke-width="1.0" stroke-linejoin="round"/>
                    ${!isSilhouette ? art.svgFinRays([
                        'M 132,71 Q 114,83 102,97',
                        'M 133,73 Q 119,88 109,97'
                    ], rayColor, 0.72, 0.9) : ''}
                </g>

                ${art.svgEye(153, 51, 5.1, isSilhouette, isShiny ? palette.iris : '#f97316', { style: 'natural', uid })}
                ${art.svgShinyOverlay(isSilhouette, isShiny)}
            `;
        },

        drawCanvas(ctx, size, time, opts) {
            const { art, isShiny, palette, s, speedRatio, bodyBend, wagPhase, finPhase } = parseCanvasOpts(size, time, opts);
            const spine = computeSpine(art, s * 1.00, -s * 0.86, 9, bodyBend, wagPhase, s * 0.075, 0.62);
            const topW = [s * 0.12, s * 0.32, s * 0.46, s * 0.51, s * 0.46, s * 0.37, s * 0.25, s * 0.16, s * 0.11];
            const botW = [s * 0.13, s * 0.33, s * 0.46, s * 0.50, s * 0.45, s * 0.36, s * 0.24, s * 0.15, s * 0.11];
            const { topPts, botPts } = buildAsymmetricEnvelope(art, spine, topW, botW);

            const tailBase = spine[spine.length - 1];
            const tailBaseAng = getTailBaseAngle(spine);
            const tailWag1 = Math.sin(wagPhase - 0.7) * (0.26 + speedRatio * 0.05) + bodyBend * 0.46;
            const tailWag2 = Math.sin(wagPhase - 1.35) * (0.34 + speedRatio * 0.06) + bodyBend * 0.52;
            const outline = isShiny ? palette.outline : '#475569';
            const finOutline = isShiny ? 'rgba(120, 53, 15, 0.45)' : 'rgba(71, 85, 105, 0.45)';

            ctx.save();

            // 1. 飘逸薄纱蝴蝶尾
            ctx.save();
            ctx.translate(tailBase.x, tailBase.y);
            ctx.rotate(tailBaseAng + tailWag1);
            const veilGrad = ctx.createLinearGradient(0, 0, -s * 0.76, 0);
            veilGrad.addColorStop(0, isShiny ? palette.fin : 'rgba(254, 215, 170, 0.88)');
            veilGrad.addColorStop(0.65, isShiny ? palette.finLight : 'rgba(255, 250, 240, 0.72)');
            veilGrad.addColorStop(1, isShiny ? 'rgba(224,242,254,0.45)' : 'rgba(255, 250, 240, 0.44)');
            ctx.fillStyle = veilGrad;
            ctx.strokeStyle = finOutline;
            ctx.lineWidth = 1.0;

            const tipOffset = Math.sin(tailWag2 - tailWag1) * s * 0.22;
            ctx.beginPath();
            ctx.moveTo(0, -s * 0.09);
            ctx.quadraticCurveTo(-s * 0.36, -s * 0.54 + tipOffset * 0.5, -s * 0.74, -s * 0.52 + tipOffset);
            ctx.quadraticCurveTo(-s * 0.48, -s * 0.11 + tipOffset * 0.4, -s * 0.36, tipOffset * 0.2);
            ctx.quadraticCurveTo(-s * 0.48, s * 0.11 + tipOffset * 0.4, -s * 0.74, s * 0.52 + tipOffset);
            ctx.quadraticCurveTo(-s * 0.36, s * 0.54 + tipOffset * 0.5, 0, s * 0.09);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            drawFinRaysCanvas(art, ctx, [
                [0, -s * 0.05, -s * 0.32, -s * 0.28 + tipOffset * 0.4, -s * 0.66, -s * 0.41 + tipOffset],
                [0, s * 0.05, -s * 0.32, s * 0.28 + tipOffset * 0.4, -s * 0.66, s * 0.41 + tipOffset]
            ], isShiny ? 'rgba(255,255,255,0.62)' : 'rgba(249,115,22,0.42)', 0.9);
            ctx.restore();

            // 2. 帆状薄纱背鳍与腹/臀鳍
            const finVeilGrad = ctx.createLinearGradient(0, -s * 0.72, 0, s * 0.68);
            finVeilGrad.addColorStop(0, isShiny ? palette.finLight : 'rgba(255, 250, 240, 0.56)');
            finVeilGrad.addColorStop(0.5, isShiny ? palette.fin : 'rgba(254, 215, 170, 0.88)');
            finVeilGrad.addColorStop(1, isShiny ? palette.finLight : 'rgba(255, 250, 240, 0.56)');
            ctx.fillStyle = finVeilGrad;
            ctx.strokeStyle = finOutline;
            ctx.lineWidth = 0.95;

            ctx.beginPath();
            ctx.moveTo(topPts[2].x - s * 0.04, topPts[2].y + s * 0.02);
            ctx.quadraticCurveTo(topPts[4].x + s * 0.06, topPts[4].y - s * 0.35, topPts[6].x + s * 0.04, topPts[6].y + s * 0.02);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(botPts[3].x, botPts[3].y - s * 0.02);
            ctx.quadraticCurveTo(botPts[4].x - s * 0.05, botPts[4].y + s * 0.28, botPts[4].x - s * 0.22, botPts[4].y + s * 0.22);
            ctx.closePath();
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(botPts[5].x, botPts[5].y - s * 0.02);
            ctx.quadraticCurveTo(botPts[6].x - s * 0.04, botPts[6].y + s * 0.24, botPts[7].x, botPts[7].y + s * 0.02);
            ctx.closePath();
            ctx.fill();

            // 3. 白瓷绸缎躯干 + 书法朱红(Hi)/墨黑(Sumi)斑
            const bodyGrad = ctx.createLinearGradient(0, -s * 0.46, 0, s * 0.46);
            bodyGrad.addColorStop(0, isShiny ? palette.bodyLight : '#ffffff');
            bodyGrad.addColorStop(0.62, isShiny ? palette.body : '#f3f6fa');
            bodyGrad.addColorStop(1, isShiny ? palette.bellyWarm : '#cbd5e1');
            traceEnvelopePath(art, ctx, spine, topPts, botPts, s * 0.15);
            ctx.fillStyle = bodyGrad;
            ctx.fill();

            ctx.save();
            ctx.clip();

            ctx.fillStyle = isShiny ? '#f472b6' : '#dc2626';
            ctx.beginPath();
            ctx.moveTo(spine[1].x + s * 0.05, topPts[1].y);
            ctx.quadraticCurveTo(spine[2].x + s * 0.05, spine[2].y - s * 0.02, spine[3].x + s * 0.08, topPts[3].y);
            ctx.closePath();
            ctx.fill();

            ctx.beginPath();
            ctx.ellipse(spine[5].x, spine[5].y - s * 0.13, s * 0.23, s * 0.15, 0.15, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(spine[7].x, spine[7].y - s * 0.04, s * 0.12, s * 0.10, 0, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = isShiny ? '#1e3a8a' : '#111827';
            ctx.beginPath();
            ctx.ellipse(spine[3].x - s * 0.02, spine[3].y + s * 0.06, s * 0.11, s * 0.08, 0.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(spine[4].x + s * 0.04, spine[4].y - s * 0.23, s * 0.09, s * 0.06, -0.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(spine[6].x, spine[6].y + s * 0.11, s * 0.085, s * 0.065, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            traceEnvelopePath(art, ctx, spine, topPts, botPts, s * 0.15);
            ctx.strokeStyle = outline;
            ctx.lineWidth = 1.2;
            ctx.stroke();

            // 4. 渐细口须
            const headAng = getHeadAngle(spine);
            ctx.save();
            ctx.translate(spine[0].x + s * 0.06, spine[0].y + s * 0.05);
            ctx.rotate(headAng);
            ctx.lineCap = 'round';
            ctx.strokeStyle = isShiny ? '#fef08a' : '#fb923c';
            ctx.lineWidth = Math.max(1.1, s * 0.048);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(s * 0.15, s * 0.08, s * 0.16, s * 0.23);
            ctx.stroke();
            ctx.strokeStyle = isShiny ? '#f472b6' : '#f8fafc';
            ctx.lineWidth = Math.max(0.85, s * 0.036);
            ctx.beginPath();
            ctx.moveTo(s * 0.03, -s * 0.02);
            ctx.quadraticCurveTo(s * 0.17, s * 0.02, s * 0.18, s * 0.14);
            ctx.stroke();
            ctx.restore();

            // 5. 薄纱蝴蝶胸鳍
            const pecWag = Math.sin(finPhase) * 0.24;
            ctx.save();
            ctx.translate(spine[2].x - s * 0.02, spine[2].y + s * 0.17);
            ctx.rotate(headAng + pecWag);
            const pecVeilGrad = ctx.createLinearGradient(0, 0, -s * 0.44, s * 0.36);
            pecVeilGrad.addColorStop(0, isShiny ? palette.fin : 'rgba(254, 215, 170, 0.90)');
            pecVeilGrad.addColorStop(1, isShiny ? palette.finLight : 'rgba(255, 250, 240, 0.56)');
            ctx.fillStyle = pecVeilGrad;
            ctx.strokeStyle = finOutline;
            ctx.lineWidth = 0.9;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(-s * 0.24, s * 0.12, -s * 0.44, s * 0.35);
            ctx.quadraticCurveTo(-s * 0.22, s * 0.39, -s * 0.02, s * 0.08);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 6. 眼睛
            if (art && typeof art.drawCanvasEye === 'function') {
                art.drawCanvasEye(ctx, spine[1].x + s * 0.04, spine[1].y - s * 0.12, Math.max(2.1, s * 0.13), isShiny ? palette.iris : '#f97316', { style: 'natural' });
            }

            ctx.restore();
        }
    };

})();
