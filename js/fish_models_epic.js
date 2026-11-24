/**
 * ============================================================================
 * 《微风垂钓物语 2.0》史诗级鱼群高精度模型库 (js/fish_models_epic.js)
 * ============================================================================
 * 注册 5 种史诗 (Epic) 鱼类的分层矢量 SVG 与关节级 Canvas 2D 动态模型：
 * 1. golden_carp    - 黄金锦鲤（24K液态熔金体、丝绸蝶尾背鳍、对称渐细流金双须）
 * 2. coral_seahorse - 七彩珊瑚海马（珍珠母贝幻彩、珊瑚枝头冠、立体骨甲环、直立悬停）
 * 3. thunder_eel    - 雷鸣电鳗（等离子连续腹鳍、晶体生物电节点、贴躯细碎分支电弧）
 * 4. arowana        - 银鳞龙鱼（铂金月银平直背脊、吊桥巨颌、盾形大鳞、剑翼长鳍）
 * 5. catfish        - 深渊巨鲶（冷月青轮廓背光、清晰梳理三对渐细触须、长波浪臀鳍）
 */
(function () {
    'use strict';

    const WWF = window.WWF = window.WWF || {};
    WWF.FISH_MODELS = WWF.FISH_MODELS || {};

    function finite(v, fallback = 0) {
        return Number.isFinite(v) ? v : fallback;
    }

    function clamp(v, min, max) {
        const n = finite(v, min);
        return n < min ? min : (n > max ? max : n);
    }

    function resolveDrawContext(opts, defaultTailFreq = 7.5) {
        const safeOpts = opts || {};
        const art = safeOpts.art || WWF.FishArt;
        const isShiny = !!safeOpts.isShiny;
        const palette = safeOpts.palette || (art && typeof art.getPalette === 'function'
            ? art.getPalette(safeOpts.fish, false, isShiny)
            : {
                body: '#fbbf24', bodyLight: '#fef08a', bodyDark: '#b45309',
                belly: '#fef9c3', bellyWarm: '#fde047',
                fin: '#f59e0b', finLight: '#fde68a', finDark: '#b45309',
                stroke: 'rgba(12, 22, 38, 0.56)', outline: '#78350f', finOutline: '#92400e',
                highlight: 'rgba(255,255,255,0.4)', glow: '#fde047', iris: '#d97706'
            });
        const speedRatio = clamp(finite(safeOpts.speedRatio, 1), 0.35, 3.2);
        const bodyBend = clamp(finite(safeOpts.bodyBend, 0), -0.85, 0.85);
        const phaseOffset = finite(safeOpts.phaseOffset, 0);
        const wagPhase = finite(safeOpts.wagPhase, defaultTailFreq + phaseOffset);
        const finPhase = finite(safeOpts.finPhase, wagPhase * 0.72);
        return { art, palette, isShiny, speedRatio, bodyBend, wagPhase, finPhase, phaseOffset };
    }

    function computeSpineOffsetCurve(points, offsets, sideSign = 1) {
        const n = points.length;
        const out = [];
        for (let i = 0; i < n; i++) {
            const p = points[i];
            const prev = points[Math.max(0, i - 1)];
            const next = points[Math.min(n - 1, i + 1)];
            const ang = Math.atan2(next.y - prev.y, next.x - prev.x);
            const perp = ang + Math.PI * 0.5;
            const d = finite(offsets[i], 0) * sideSign;
            out.push({
                x: p.x - Math.cos(perp) * d,
                y: p.y - Math.sin(perp) * d
            });
        }
        return out;
    }

    function drawCanvasTaperedBarbel(ctx, x0, y0, cx, cy, x1, y1, color, baseWidth) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(0.85, baseWidth);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(cx, cy, x1, y1);
        ctx.stroke();

        ctx.lineWidth = Math.max(0.55, baseWidth * 0.5);
        ctx.beginPath();
        ctx.moveTo((x0 + cx) * 0.5, (y0 + cy) * 0.5);
        ctx.quadraticCurveTo(cx, cy, x1, y1);
        ctx.stroke();
        ctx.restore();
    }

    function drawCanvasRays(art, ctx, rays, strokeColor, lineWidth = 1) {
        if (art && typeof art.drawCanvasFinRays === 'function') {
            art.drawCanvasFinRays(ctx, rays, strokeColor, lineWidth);
            return;
        }
        if (!rays || rays.length === 0) return;
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

    function drawSoftGlowDot(art, ctx, x, y, r, outerColor, coreColor) {
        if (art && typeof art.drawCanvasSoftGlow === 'function') {
            art.drawCanvasSoftGlow(ctx, x, y, Math.max(1.2, r) * 2.2, outerColor, outerColor);
        }
        ctx.save();
        ctx.fillStyle = coreColor;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.0, r), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // ========================================================================
    // 1. 黄金锦鲤 (golden_carp) — 皇家山吹黄金鲤
    // ========================================================================
    WWF.FISH_MODELS.golden_carp = {
        motion: {
            swimStyle: 'majestic',
            tailFreq: 5.6,
            tailAmp: 0.22,
            bodyFlex: 0.16,
            pectoralFreq: 4.0,
            turnAgility: 0.82,
            bobAmp: 2.8,
            tailPivot: '56px 60px'
        },

        buildSVGContent({ isSilhouette, isShiny, uid, palette, art }) {
            const cRidge = isSilhouette ? palette.bodyDark : (isShiny ? palette.bodyDark : '#a16207');
            const cGold = isSilhouette ? palette.body : (isShiny ? palette.body : '#eab308');
            const cBright = isSilhouette ? palette.bodyLight : (isShiny ? palette.bodyLight : '#fef08a');
            const cBelly = isSilhouette ? palette.belly : (isShiny ? palette.bellyWarm : '#fffbeb');
            const cFinRoot = isSilhouette ? palette.finDark : (isShiny ? palette.fin : '#f59e0b');
            const cFinTip = isSilhouette ? palette.finLight : (isShiny ? palette.finLight : '#fef9c3');
            const outline = isSilhouette ? palette.stroke : (isShiny ? palette.outline : '#713f12');
            const finOutline = isSilhouette ? palette.stroke : (isShiny ? 'rgba(120, 53, 15, 0.45)' : 'rgba(113, 63, 18, 0.45)');
            const rayColor = isShiny ? 'rgba(255,255,255,0.68)' : 'rgba(255,251,235,0.72)';

            const bodyPath = 'M 54,54 C 71,32 104,24 138,30 C 157,34 170,46 173,58 C 170,73 153,86 126,89 C 95,92 68,82 54,66 Z';
            const tailPath = 'M 57,55 C 44,31 24,18 13,26 C 17,41 25,52 33,58 C 23,64 17,76 13,94 C 24,102 44,89 57,65 Z';
            // 单片舒展皇家金纱背鳍（彻底移除多余小角）
            const dorsalPath = 'M 63,39 C 72,19 95,12 126,16 C 132,18 134,24 132,31 C 109,28 84,32 63,39 Z';
            const pecPath = 'M 135,68 C 122,72 103,85 101,96 C 109,102 128,94 139,74 Z';

            const scalesSvg = isSilhouette ? '' : art.svgScalePatch([
                { y: 40, xs: [82, 95, 108, 121, 134], alpha: 0.65 },
                { y: 49, xs: [74, 87, 100, 113, 126, 139], alpha: 0.88 },
                { y: 59, xs: [70, 83, 96, 109, 122, 135], alpha: 0.92 },
                { y: 69, xs: [78, 91, 104, 117, 130], alpha: 0.62 }
            ], {
                rx: 4.8, ry: 4.4,
                rimColor: isShiny ? 'rgba(255,255,255,0.58)' : 'rgba(255,253,240,0.56)',
                shadowColor: isShiny ? 'rgba(180,83,9,0.22)' : 'rgba(161,98,7,0.22)'
            });

            // 轻盈对称流金胡须（绝无厚钩）
            const barbels = `
                <g fill="${isSilhouette ? palette.finLight : cFinRoot}" stroke="${outline}" stroke-width="0.45">
                    <path d="M 169,62 C 178,64 185,71 185,79 C 182,72 176,66 167,64 Z"/>
                    <path d="M 171,59 C 180,59 187,64 188,71 C 185,65 178,61 170,61 Z"/>
                </g>
            `;

            return `
                <defs>
                    <linearGradient id="${uid}_gc_body" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${cRidge}"/>
                        <stop offset="28%" stop-color="${cGold}"/>
                        <stop offset="56%" stop-color="${cBright}"/>
                        <stop offset="100%" stop-color="${cBelly}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_gc_veil" x1="100%" y1="50%" x2="0%" y2="50%">
                        <stop offset="0%" stop-color="${cFinRoot}" stop-opacity="${isSilhouette ? 0.94 : 0.88}"/>
                        <stop offset="58%" stop-color="${cFinTip}" stop-opacity="${isSilhouette ? 0.90 : 0.72}"/>
                        <stop offset="100%" stop-color="${cFinTip}" stop-opacity="${isSilhouette ? 0.86 : 0.44}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_gc_dorsal" x1="0%" y1="100%" x2="0%" y2="0%">
                        <stop offset="0%" stop-color="${cFinRoot}" stop-opacity="0.90"/>
                        <stop offset="100%" stop-color="${cFinTip}" stop-opacity="${isSilhouette ? 0.88 : 0.56}"/>
                    </linearGradient>
                    <clipPath id="${uid}_gc_clip">
                        <path d="${bodyPath}"/>
                    </clipPath>
                </defs>

                <!-- 纱翼腹鳍与臀鳍 -->
                <g class="svg-fish-veil">
                    <path d="M 73,77 Q 62,97 46,95 Q 55,83 65,72 Z" fill="url(#${uid}_gc_veil)" stroke="${finOutline}" stroke-width="1.0" stroke-linejoin="round"/>
                    <path d="M 114,85 Q 99,105 82,102 Q 92,90 105,84 Z" fill="url(#${uid}_gc_veil)" stroke="${finOutline}" stroke-width="1.0" stroke-linejoin="round"/>
                </g>

                <!-- 飘逸金丝蝴蝶纱尾 -->
                <g class="svg-fish-tail">
                    <path d="${tailPath}" fill="url(#${uid}_gc_veil)" stroke="${finOutline}" stroke-width="1.15" stroke-linejoin="round"/>
                    ${!isSilhouette ? `<path d="M 55,58 C 41,45 27,39 18,45 C 27,54 29,66 18,75 C 27,81 41,75 55,62 Z" fill="${cFinTip}" opacity="0.34"/>` : ''}
                    ${!isSilhouette ? art.svgFinRays([
                        'M 54,56 Q 35,36 17,29',
                        'M 54,58 Q 34,47 16,46',
                        'M 54,62 Q 34,73 16,74',
                        'M 54,64 Q 35,84 17,91'
                    ], rayColor, 0.72, 0.95) : ''}
                </g>

                <!-- 飘逸皇家金纱长背鳍 -->
                <g class="svg-fish-veil">
                    <path d="${dorsalPath}" fill="url(#${uid}_gc_dorsal)" stroke="${finOutline}" stroke-width="1.05" stroke-linejoin="round"/>
                    ${!isSilhouette ? art.svgFinRays([
                        'M 75,35 Q 78,24 83,20',
                        'M 89,32 Q 92,20 97,16',
                        'M 103,30 Q 107,19 112,16',
                        'M 118,30 Q 121,21 125,18'
                    ], rayColor, 0.68, 0.9) : ''}
                </g>

                <!-- 24K 液态黄金主体 -->
                <path d="${bodyPath}" fill="url(#${uid}_gc_body)" stroke="${outline}" stroke-width="1.5" stroke-linejoin="round"/>
                <g clip-path="url(#${uid}_gc_clip)">
                    ${scalesSvg}
                    ${isSilhouette ? '' : `
                        <path d="M 66,40 Q 108,26 150,38" fill="none" stroke="rgba(255,255,255,0.68)" stroke-width="3.2" stroke-linecap="round"/>
                        <path d="M 142,37 Q 134,58 144,81" fill="none" stroke="${outline}" stroke-width="1.65" stroke-linecap="round" opacity="0.58"/>
                        <path d="M 144,39 Q 137,58 146,79" fill="none" stroke="rgba(255,255,255,0.52)" stroke-width="1.1" stroke-linecap="round"/>
                    `}
                </g>

                ${barbels}

                <!-- 薄纱大胸鳍（严格锚定关节根部） -->
                <g class="svg-fish-pec" style="transform-box: view-box; transform-origin: 135px 69px;">
                    <path d="${pecPath}" fill="url(#${uid}_gc_veil)" stroke="${finOutline}" stroke-width="1.0" stroke-linejoin="round"/>
                    ${!isSilhouette ? art.svgFinRays([
                        'M 133,69 Q 119,79 106,90',
                        'M 134,72 Q 123,83 113,94',
                        'M 136,74 Q 128,85 121,94'
                    ], rayColor, 0.68, 0.9) : ''}
                </g>

                ${art.svgEye(154, 51, 5.2, isSilhouette, isShiny ? palette.iris : '#d97706', { style: 'natural', uid })}
                ${art.svgShinyOverlay(isSilhouette, isShiny)}
            `;
        },

        drawCanvas(ctx, size, time, opts) {
            const s = Math.max(8, finite(size, 26));
            const { art, palette, isShiny, speedRatio, bodyBend, wagPhase, finPhase } = resolveDrawContext(opts, 5.6);

            const pts = art.buildSpinePoints(
                s * 1.00,
                -s * 0.88,
                9,
                bodyBend * 0.72,
                wagPhase,
                s * 0.08 * Math.min(1.4, 0.78 + speedRatio * 0.28),
                0.46
            );
            const widths = [0.18, 0.38, 0.48, 0.50, 0.46, 0.36, 0.25, 0.15, 0.10].map(w => w * s);
            const outline = isShiny ? palette.outline : '#713f12';
            const finOutline = isShiny ? 'rgba(120, 53, 15, 0.45)' : 'rgba(113, 63, 18, 0.45)';
            const cRidge = isShiny ? palette.bodyDark : '#a16207';
            const cGold = isShiny ? palette.body : '#eab308';
            const cBright = isShiny ? palette.bodyLight : '#fef08a';
            const cFinRoot = isShiny ? palette.fin : '#f59e0b';
            const cFinTip = isShiny ? palette.finLight : 'rgba(254, 249, 195, 0.80)';

            // 1. 飘逸双叶金丝纱尾
            const tailBase = pts[8];
            const tailPrev = pts[7];
            const tailAng = Math.atan2(tailPrev.y - tailBase.y, tailPrev.x - tailBase.x);
            const tailFlick = Math.sin(wagPhase - 1.4) * 0.24;

            ctx.save();
            ctx.translate(tailBase.x, tailBase.y);
            ctx.rotate(tailAng + tailFlick);
            const tailGrad = ctx.createLinearGradient(0, 0, -s * 0.68, 0);
            tailGrad.addColorStop(0, cFinRoot);
            tailGrad.addColorStop(0.6, cFinTip);
            tailGrad.addColorStop(1, isShiny ? 'rgba(224,242,254,0.48)' : 'rgba(254,249,195,0.46)');
            ctx.fillStyle = tailGrad;
            ctx.strokeStyle = finOutline;
            ctx.lineWidth = Math.max(0.8, s * 0.038);
            ctx.beginPath();
            ctx.moveTo(0, -s * 0.08);
            ctx.bezierCurveTo(-s * 0.24, -s * 0.48, -s * 0.52, -s * 0.58, -s * 0.66, -s * 0.38);
            ctx.quadraticCurveTo(-s * 0.45, -s * 0.08, -s * 0.33, 0);
            ctx.quadraticCurveTo(-s * 0.45, s * 0.08, -s * 0.66, s * 0.38);
            ctx.bezierCurveTo(-s * 0.52, s * 0.58, -s * 0.24, s * 0.48, 0, s * 0.08);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            drawCanvasRays(art, ctx, [
                [0, -s * 0.03, -s * 0.56, -s * 0.34],
                [0, 0, -s * 0.46, -s * 0.14],
                [0, 0, -s * 0.46, s * 0.14],
                [0, s * 0.03, -s * 0.56, s * 0.34]
            ], 'rgba(255, 255, 255, 0.54)', s * 0.03);
            ctx.restore();

            // 2. 皇家金纱长背鳍
            const dorsalA = pts[2];
            const dorsalB = pts[6];
            ctx.save();
            const dGrad = ctx.createLinearGradient(0, -s * 0.85, 0, -s * 0.3);
            dGrad.addColorStop(0, cFinTip);
            dGrad.addColorStop(1, cFinRoot);
            ctx.fillStyle = dGrad;
            ctx.strokeStyle = finOutline;
            ctx.lineWidth = Math.max(0.7, s * 0.034);
            ctx.beginPath();
            ctx.moveTo(dorsalA.x, dorsalA.y - widths[2] * 0.85);
            ctx.bezierCurveTo(
                dorsalA.x - s * 0.16, dorsalA.y - s * 0.72,
                dorsalB.x + s * 0.06, dorsalB.y - s * 0.66,
                dorsalB.x - s * 0.10, dorsalB.y - widths[6] * 0.72
            );
            ctx.lineTo(dorsalB.x, dorsalB.y - widths[6] * 0.75);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 3. 24K 液态黄金主体
            const bodyGrad = ctx.createLinearGradient(0, -s * 0.48, 0, s * 0.48);
            bodyGrad.addColorStop(0, cRidge);
            bodyGrad.addColorStop(0.35, cGold);
            bodyGrad.addColorStop(0.65, cBright);
            bodyGrad.addColorStop(1, isShiny ? palette.bellyWarm : '#fffbeb');
            art.drawCanvasSpineRibbon(ctx, pts, widths, bodyGrad, outline, Math.max(0.9, s * 0.046));

            // 4. 立体金鳞与背脊反光
            art.drawCanvasScaleArcs(
                ctx,
                (pts[3].x + pts[5].x) * 0.5,
                (pts[3].y + pts[5].y) * 0.5,
                s * 0.52,
                s * 0.42,
                3,
                4,
                isShiny ? 'rgba(255,255,255,0.48)' : 'rgba(255,253,240,0.48)'
            );

            ctx.save();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
            ctx.lineWidth = Math.max(1.1, s * 0.062);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(pts[1].x, pts[1].y - widths[1] * 0.62);
            for (let i = 2; i <= 6; i++) ctx.lineTo(pts[i].x, pts[i].y - widths[i] * 0.64);
            ctx.stroke();
            ctx.restore();

            // 5. 薄纱大胸鳍
            const pecWave = Math.sin(finPhase) * 0.18;
            const pecBase = pts[2];
            ctx.save();
            ctx.translate(pecBase.x - s * 0.04, pecBase.y + widths[2] * 0.46);
            ctx.rotate(pecWave);
            ctx.fillStyle = cFinTip;
            ctx.strokeStyle = finOutline;
            ctx.lineWidth = Math.max(0.7, s * 0.032);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.bezierCurveTo(-s * 0.18, s * 0.14, -s * 0.36, s * 0.36, -s * 0.25, s * 0.46);
            ctx.bezierCurveTo(-s * 0.10, s * 0.40, s * 0.04, s * 0.20, s * 0.06, s * 0.03);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 6. 轻盈对称流金胡须与立体眼睛
            const snout = pts[0];
            const sway = Math.sin(wagPhase * 0.8) * s * 0.04;
            drawCanvasTaperedBarbel(ctx, snout.x + s * 0.02, snout.y + s * 0.02, snout.x + s * 0.18, snout.y + s * 0.05 + sway, snout.x + s * 0.20, snout.y + s * 0.22 + sway, cFinRoot, s * 0.042);
            drawCanvasTaperedBarbel(ctx, snout.x - s * 0.02, snout.y + s * 0.07, snout.x + s * 0.12, snout.y + s * 0.16 - sway * 0.6, snout.x + s * 0.08, snout.y + s * 0.30 - sway * 0.6, cBright, s * 0.045);

            art.drawCanvasEye(ctx, pts[1].x + s * 0.03, pts[1].y - widths[1] * 0.24, Math.max(2.1, s * 0.12), isShiny ? palette.iris : '#d97706', { style: 'natural' });
        }
    };

    // ========================================================================
    // 2. 七彩珊瑚海马 (coral_seahorse) — 珍珠母贝幻彩 + 珊瑚枝冠 + 直立悬停
    // ========================================================================
    function buildSeahorseArmorSVG(isSilhouette, ringHighlight, ringShadow, pearlColor) {
        if (isSilhouette) return '';
        const rings = [
            'M 87,35 Q 97,38 106,36',
            'M 84,41 Q 96,45 109,43',
            'M 82,48 Q 97,53 114,50',
            'M 81,55 Q 98,61 118,57',
            'M 82,62 Q 98,68 117,64',
            'M 84,69 Q 97,74 114,70',
            'M 87,76 Q 96,80 108,77',
            'M 90,82 Q 96,85 102,83'
        ];
        const shadowArcs = rings.map(d => `<path d="${d}" fill="none" stroke="${ringShadow}" stroke-width="2.1" stroke-linecap="round" opacity="0.28"/>`).join('');
        const lightArcs = rings.map(d => `<path d="${d}" fill="none" stroke="${ringHighlight}" stroke-width="1.25" stroke-linecap="round" opacity="0.62"/>`).join('');

        const pearls = [
            [102, 49, 1.7], [107, 56, 2.0], [105, 64, 1.8],
            [97, 59, 1.4], [96, 71, 1.5], [94, 43, 1.3]
        ].map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${pearlColor}" opacity="0.58"/>`).join('');

        return `<g class="svg-sh-armor">${shadowArcs}${lightArcs}${pearls}</g>`;
    }

    WWF.FISH_MODELS.coral_seahorse = {
        motion: {
            swimStyle: 'hover',
            tailFreq: 6.2,
            tailAmp: 0.16,
            bodyFlex: 0.12,
            pectoralFreq: 18.0,
            turnAgility: 0.95,
            bobAmp: 4.5,
            tailPivot: '96px 86px'
        },

        buildSVGContent({ isSilhouette, isShiny, uid, palette, art }) {
            const cRose = isSilhouette ? palette.bodyLight : (isShiny ? '#f472b6' : '#fb7185');
            const cPeach = isSilhouette ? palette.body : (isShiny ? palette.body : '#fdba74');
            const cMint = isSilhouette ? palette.body : (isShiny ? palette.fin : '#5eead4');
            const cIris = isSilhouette ? palette.bodyDark : (isShiny ? palette.bodyDark : '#818cf8');
            const cFin1 = isSilhouette ? palette.finLight : (isShiny ? palette.finLight : '#e0f2fe');
            const cFin2 = isSilhouette ? palette.finDark : (isShiny ? '#f472b6' : '#fda4af');
            const outline = isSilhouette ? palette.stroke : (isShiny ? palette.outline : '#4c1d95');

            // 圆润珊瑚枝冠 + 优雅长管吻 + 挺拔 S 形躯干
            const trunkPath =
                'M 89,25 ' +
                'C 85,20 84,15 88,14 C 91,13 92,16 93,18 ' +
                'C 94,12 97,8 100,10 C 103,11 102,16 102,18 ' +
                'C 105,12 109,11 111,14 C 113,17 110,20 109,22 ' +
                'C 113,22 117,22 116,25 ' +
                'C 120,27 127,27 142,25 C 145,24 147,25 147,28 C 147,31 145,32 141,31 ' +
                'C 124,30 117,32 112,35 C 107,38 106,41 110,45 ' +
                'C 119,53 121,65 111,75 C 105,80 102,83 101.5,85 ' +
                'L 90.5,85 C 89,78 83,70 81,59 C 79,48 83,39 87,34 C 89,30 89,27 89,25 Z';

            const spiralTailPath =
                'M 90.5,83 ' +
                'C 90,99 97,110 108,110 C 119,110 124,104 124,97 C 124,91 119,88 114,88 C 110,88 108,92 109,95 ' +
                'C 110,97 112,96 112,94 C 112,92 114,91 116,92 C 118,93 119,95 118,97 ' +
                'C 117,100 113,102 108,102 C 102,102 101,94 101.5,83 Z';

            const dorsalFinRays = isSilhouette ? '' : art.svgFinRays([
                'M 81,46 Q 71,44 63,46',
                'M 81,51 Q 70,51 61,52',
                'M 81,56 Q 71,57 63,58',
                'M 81,60 Q 73,62 67,63'
            ], 'rgba(255,255,255,0.72)', 0.72, 0.85);

            const tailRings = isSilhouette ? '' : `
                <path d="M 91,91 Q 96,91 101,89 M 93,99 Q 99,98 102,94 M 101,107 Q 105,103 107,101 M 112,109 Q 112,104 111,101 M 122,102 Q 119,99 117,98" fill="none" stroke="rgba(255,255,255,0.48)" stroke-width="1.15" stroke-linecap="round"/>
            `;

            // 背脊飘逸透明珊瑚叶须
            const coralFronds = isSilhouette ? '' : `
                <g fill="${cRose}" opacity="0.72">
                    <path d="M 85,36 C 78,34 75,37 79,40 Z"/>
                    <path d="M 81,47 C 74,45 72,49 77,51 Z"/>
                    <path d="M 80,58 C 73,57 73,61 78,63 Z"/>
                    <path d="M 83,69 C 76,69 77,73 82,74 Z"/>
                </g>
            `;

            return `
                <defs>
                    <linearGradient id="${uid}_sh_grad" x1="12%" y1="0%" x2="88%" y2="100%">
                        <stop offset="0%" stop-color="${cRose}"/>
                        <stop offset="38%" stop-color="${cPeach}"/>
                        <stop offset="70%" stop-color="${cMint}"/>
                        <stop offset="100%" stop-color="${cIris}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_sh_sheen" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.45"/>
                        <stop offset="50%" stop-color="#fef08a" stop-opacity="0.18"/>
                        <stop offset="100%" stop-color="#e0f2fe" stop-opacity="0.38"/>
                    </linearGradient>
                    <linearGradient id="${uid}_sh_tail" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="${cMint}"/>
                        <stop offset="55%" stop-color="${cIris}"/>
                        <stop offset="100%" stop-color="${cRose}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_sh_fin" x1="100%" y1="50%" x2="0%" y2="50%">
                        <stop offset="0%" stop-color="${cFin2}" stop-opacity="${isSilhouette ? 0.92 : 0.80}"/>
                        <stop offset="100%" stop-color="${cFin1}" stop-opacity="${isSilhouette ? 0.85 : 0.45}"/>
                    </linearGradient>
                    <clipPath id="${uid}_sh_clip">
                        <path d="${trunkPath}"/>
                    </clipPath>
                </defs>

                <!-- 背面高频煽动薄纱背鳍 (锚定背鳍根部) -->
                <g class="svg-fish-pec" style="transform-box: view-box; transform-origin: 82px 52px;">
                    <path d="M 82,42 C 67,37 58,45 60,54 C 59,62 69,68 82,63 Z" fill="url(#${uid}_sh_fin)" stroke="${outline}" stroke-width="1.05" stroke-linejoin="round"/>
                    ${dorsalFinRays}
                </g>

                <!-- 底部紧卷螺旋尾 -->
                <g class="svg-fish-tail">
                    <path d="${spiralTailPath}" fill="url(#${uid}_sh_tail)" stroke="${outline}" stroke-width="1.2" stroke-linejoin="round"/>
                    ${tailRings}
                </g>

                ${coralFronds}

                <!-- 珍珠母贝幻彩 S 形海马躯干 -->
                <path d="${trunkPath}" fill="url(#${uid}_sh_grad)" stroke="${outline}" stroke-width="1.45" stroke-linejoin="round"/>

                <g clip-path="url(#${uid}_sh_clip)">
                    ${isSilhouette ? '' : `<path d="${trunkPath}" fill="url(#${uid}_sh_sheen)"/>`}
                    ${isSilhouette ? '' : '<path d="M 106,46 C 118,53 118,67 107,77" fill="none" stroke="rgba(255,255,255,0.52)" stroke-width="3.0" stroke-linecap="round"/>'}
                    ${buildSeahorseArmorSVG(isSilhouette, '#ffffff', outline, '#fef9c3')}
                </g>

                <!-- 小巧颊鳍 -->
                <path d="M 95,33 C 89,32 87,36 89,40 C 92,41 95,38 96,35 Z" fill="url(#${uid}_sh_fin)" stroke="${outline}" stroke-width="0.85"/>
                ${art.svgEye(106, 25, 4.1, isSilhouette, isShiny ? palette.iris : '#f59e0b', { style: 'cute', uid })}
                ${art.svgShinyOverlay(isSilhouette, isShiny)}
            `;
        },

        drawCanvas(ctx, size, time, opts) {
            const s = Math.max(8, finite(size, 26));
            const { art, palette, isShiny, speedRatio, bodyBend, wagPhase, finPhase, phaseOffset } = resolveDrawContext(opts, 6.2);

            const cRose = isShiny ? '#f472b6' : '#fb7185';
            const cPeach = isShiny ? palette.body : '#fdba74';
            const cMint = isShiny ? palette.fin : '#5eead4';
            const cIris = isShiny ? palette.bodyDark : '#818cf8';
            const outline = isShiny ? palette.outline : '#4c1d95';

            const hoverY = Math.sin(wagPhase * 0.45 + phaseOffset) * s * 0.055;
            const leanTilt = bodyBend * 0.26 + Math.sin(wagPhase * 0.45) * 0.08 + clamp((speedRatio - 1) * 0.12, -0.06, 0.16);

            ctx.save();
            ctx.translate(0, hoverY);
            ctx.rotate(leanTilt);
            ctx.scale(1.16, 1.16);

            // 1. 高频煽动薄纱背鳍
            const finFlutter = 0.72 + Math.sin(finPhase * 1.45) * 0.28;
            ctx.save();
            ctx.translate(-s * 0.14, s * 0.02);
            ctx.scale(finFlutter, 1);
            ctx.fillStyle = isShiny ? palette.finLight : 'rgba(224, 242, 254, 0.72)';
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.7, s * 0.032);
            ctx.beginPath();
            ctx.moveTo(0, -s * 0.16);
            ctx.bezierCurveTo(-s * 0.24, -s * 0.22, -s * 0.34, -s * 0.04, -s * 0.30, s * 0.08);
            ctx.bezierCurveTo(-s * 0.26, s * 0.20, -s * 0.10, s * 0.20, 0, s * 0.14);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 2. 螺旋卷尾
            const tailCurlWag = Math.sin(wagPhase - 0.8) * 0.16 + bodyBend * 0.18;
            ctx.save();
            ctx.translate(0, s * 0.34);
            ctx.rotate(tailCurlWag);
            const tailGrad = ctx.createLinearGradient(0, 0, s * 0.28, s * 0.32);
            tailGrad.addColorStop(0, cMint);
            tailGrad.addColorStop(0.55, cIris);
            tailGrad.addColorStop(1, cRose);
            ctx.strokeStyle = tailGrad;
            ctx.lineCap = 'round';
            ctx.lineWidth = Math.max(2.2, s * 0.16);
            ctx.beginPath();
            ctx.moveTo(0, -s * 0.03);
            ctx.bezierCurveTo(-s * 0.02, s * 0.22, s * 0.14, s * 0.36, s * 0.28, s * 0.32);
            ctx.bezierCurveTo(s * 0.38, s * 0.28, s * 0.40, s * 0.14, s * 0.29, s * 0.11);
            ctx.stroke();

            ctx.lineWidth = Math.max(1.4, s * 0.09);
            ctx.beginPath();
            ctx.moveTo(s * 0.29, s * 0.11);
            ctx.bezierCurveTo(s * 0.21, s * 0.10, s * 0.18, s * 0.19, s * 0.24, s * 0.22);
            ctx.stroke();

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.48)';
            ctx.lineWidth = Math.max(0.6, s * 0.03);
            ctx.beginPath();
            ctx.moveTo(0, s * 0.04);
            ctx.bezierCurveTo(0, s * 0.22, s * 0.15, s * 0.32, s * 0.27, s * 0.28);
            ctx.stroke();
            ctx.restore();

            // 2.5 背脊珊瑚叶须
            ctx.save();
            ctx.fillStyle = cRose;
            ctx.globalAlpha = 0.72;
            const frondPos = [[-0.14, -0.24], [-0.18, -0.04], [-0.15, 0.14]];
            for (let i = 0; i < frondPos.length; i++) {
                const fx = frondPos[i][0] * s;
                const fy = frondPos[i][1] * s;
                ctx.beginPath();
                ctx.moveTo(fx, fy - s * 0.04);
                ctx.quadraticCurveTo(fx - s * 0.12, fy, fx, fy + s * 0.04);
                ctx.closePath();
                ctx.fill();
            }
            ctx.restore();

            // 3. 珍珠母贝幻彩 S 形躯干 + 圆润珊瑚枝冠 + 长管吻
            const bodyGrad = ctx.createLinearGradient(-s * 0.1, -s * 0.70, s * 0.2, s * 0.42);
            bodyGrad.addColorStop(0, cRose);
            bodyGrad.addColorStop(0.42, cPeach);
            bodyGrad.addColorStop(0.75, cMint);
            bodyGrad.addColorStop(1, cIris);

            ctx.save();
            ctx.fillStyle = bodyGrad;
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.85, s * 0.046);
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(-s * 0.08, -s * 0.56);
            // 圆润珊瑚枝冠
            ctx.quadraticCurveTo(-s * 0.13, -s * 0.72, -s * 0.03, -s * 0.68);
            ctx.quadraticCurveTo(s * 0.03, -s * 0.82, s * 0.09, -s * 0.68);
            ctx.quadraticCurveTo(s * 0.18, -s * 0.76, s * 0.18, -s * 0.58);
            // 管状长吻
            ctx.bezierCurveTo(s * 0.28, -s * 0.55, s * 0.44, -s * 0.56, s * 0.55, -s * 0.55);
            ctx.bezierCurveTo(s * 0.60, -s * 0.55, s * 0.60, -s * 0.45, s * 0.55, -s * 0.46);
            ctx.bezierCurveTo(s * 0.42, -s * 0.47, s * 0.28, -s * 0.45, s * 0.18, -s * 0.40);
            ctx.bezierCurveTo(s * 0.14, -s * 0.34, s * 0.24, -s * 0.22, s * 0.28, -s * 0.06);
            ctx.bezierCurveTo(s * 0.31, s * 0.12, s * 0.20, s * 0.26, s * 0.06, s * 0.36);
            ctx.lineTo(-s * 0.06, s * 0.36);
            ctx.bezierCurveTo(-s * 0.14, s * 0.22, -s * 0.20, s * 0.04, -s * 0.16, -s * 0.18);
            ctx.bezierCurveTo(-s * 0.13, -s * 0.36, -s * 0.09, -s * 0.46, -s * 0.08, -s * 0.56);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // 4. 分节骨环弧纹
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.54)';
            ctx.lineWidth = Math.max(0.65, s * 0.034);
            ctx.lineCap = 'round';
            const ringYs = [-0.34, -0.22, -0.10, 0.02, 0.14, 0.26];
            for (let i = 0; i < ringYs.length; i++) {
                const ry = ringYs[i] * s;
                const bulge = i >= 2 && i <= 4 ? 0.22 * s : 0.14 * s;
                ctx.beginPath();
                ctx.moveTo(-s * 0.13, ry);
                ctx.quadraticCurveTo(s * 0.04, ry + s * 0.04, bulge, ry);
                ctx.stroke();
            }
            ctx.restore();

            // 5. 晶莹萌眼
            art.drawCanvasEye(ctx, s * 0.13, -s * 0.54, Math.max(1.9, s * 0.108), isShiny ? palette.iris : '#f59e0b', { style: 'cute' });

            ctx.restore();
        }
    };

    // ========================================================================
    // 3. 雷鸣电鳗 (thunder_eel) — 风暴靛蓝 + 等离子腹鳍 + 贴躯分支电弧
    // ========================================================================
    WWF.FISH_MODELS.thunder_eel = {
        motion: {
            swimStyle: 'undulate',
            tailFreq: 10.5,
            tailAmp: 0.28,
            bodyFlex: 0.32,
            pectoralFreq: 7.2,
            turnAgility: 1.18,
            bobAmp: 2.6,
            tailPivot: '56px 54px'
        },

        buildSVGContent({ isSilhouette, isShiny, uid, palette, art }) {
            const cTop = isSilhouette ? palette.bodyDark : (isShiny ? palette.bodyDark : '#0b1630');
            const cMid = isSilhouette ? palette.body : (isShiny ? palette.body : '#1d4ed8');
            const cGlow = isSilhouette ? palette.bodyLight : (isShiny ? palette.finLight : '#38bdf8');
            const cVolt = isSilhouette ? palette.belly : (isShiny ? palette.bellyWarm : '#fef08a');
            const outline = isSilhouette ? palette.stroke : (isShiny ? palette.outline : '#082f49');

            const bodyPath =
                'M 55,46 ' +
                'C 70,47 84,60 100,58 ' +
                'C 118,56 130,38 150,40 ' +
                'C 167,42 181,47 185,54 ' +
                'C 183,61 170,66 152,65 ' +
                'C 134,62 120,76 100,77 ' +
                'C 82,78 68,64 55,61 ' +
                'C 51,57 51,50 55,46 Z';

            const bodyRibbonFinPath =
                'M 142,64 ' +
                'C 132,74 123,78 113,78 ' +
                'C 103,88 91,89 80,82 ' +
                'C 70,79 62,69 54,61 ' +
                'L 58,56 C 72,64 85,74 100,74 C 118,74 130,63 142,64 Z';

            const tailBodyPath = 'M 58,47 C 42,45 31,55 15,58 C 29,64 43,62 58,60 Z';
            const tailRibbonPath = 'M 58,59 C 47,70 34,72 15,58 C 31,61 45,60 58,56 Z';

            const ribbonRays = isSilhouette ? '' : art.svgFinRays([
                'M 132,67 L 130,75',
                'M 121,69 L 119,78',
                'M 109,75 L 106,85',
                'M 96,76 L 94,86',
                'M 83,74 L 80,82',
                'M 69,67 L 66,75'
            ], 'rgba(186,230,253,0.68)', 0.72, 0.85);

            // 精致菱形晶簇生物电节点（替代大圆波点）
            const bioNodes = isSilhouette ? '' : [
                [143, 52, 2.2], [131, 53, 2.1], [119, 59, 2.2],
                [106, 65, 2.3], [93, 66, 2.1], [81, 61, 1.9], [69, 55, 1.7]
            ].map(([nx, ny, nr], idx) => {
                const col = idx % 2 === 0 ? cGlow : cVolt;
                return `
                    <circle cx="${nx}" cy="${ny}" r="${(nr * 2.1).toFixed(1)}" fill="${col}" opacity="0.24"/>
                    <path d="M ${nx},${ny - nr} L ${nx + nr * 0.8},${ny} L ${nx},${ny + nr} L ${nx - nr * 0.8},${ny} Z" fill="#ffffff" stroke="${col}" stroke-width="0.65"/>
                `;
            }).join('');

            const tailBioNodes = isSilhouette ? '' : `
                <circle cx="44" cy="55" r="3.4" fill="${cGlow}" opacity="0.25"/>
                <path d="M 44,53.2 L 45.5,55 L 44,56.8 L 42.5,55 Z" fill="#ffffff" stroke="${cVolt}" stroke-width="0.5"/>
                <circle cx="31" cy="57" r="2.6" fill="${cGlow}" opacity="0.24"/>
                <circle cx="31" cy="57" r="1.1" fill="${cGlow}"/>
            `;

            // 贴合躯干轮廓跳跃的多分支纤细电青/白芯电弧
            const sparks = isSilhouette ? '' : `
                <g class="svg-fish-spark" fill="none" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M 145,41 L 136,33 L 128,38 L 118,30 L 110,36" stroke="${cGlow}" stroke-width="2.8" opacity="0.78"/>
                    <path d="M 145,41 L 136,33 L 128,38 L 118,30 L 110,36" stroke="#ffffff" stroke-width="1.15"/>
                    <path d="M 128,38 L 125,28 M 136,33 L 139,27" stroke="${cVolt}" stroke-width="0.95" opacity="0.95"/>
                    <path d="M 118,74 L 109,84 L 99,79 L 89,89 L 80,82" stroke="${cGlow}" stroke-width="2.7" opacity="0.76"/>
                    <path d="M 118,74 L 109,84 L 99,79 L 89,89 L 80,82" stroke="#ffffff" stroke-width="1.1"/>
                    <path d="M 99,79 L 97,89" stroke="${cVolt}" stroke-width="0.9" opacity="0.92"/>
                    <path d="M 70,45 L 62,38 L 53,42 L 44,36" stroke="${cGlow}" stroke-width="2.5" opacity="0.74"/>
                    <path d="M 70,45 L 62,38 L 53,42 L 44,36" stroke="${cVolt}" stroke-width="1.05"/>
                </g>
            `;

            return `
                <defs>
                    <linearGradient id="${uid}_te_body" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${cTop}"/>
                        <stop offset="48%" stop-color="${cMid}"/>
                        <stop offset="86%" stop-color="${isSilhouette ? palette.body : (isShiny ? palette.belly : '#38bdf8')}"/>
                        <stop offset="100%" stop-color="${isSilhouette ? palette.belly : cVolt}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_te_fin" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${cMid}" stop-opacity="${isSilhouette ? 0.92 : 0.72}"/>
                        <stop offset="100%" stop-color="${cGlow}" stop-opacity="${isSilhouette ? 0.85 : 0.42}"/>
                    </linearGradient>
                    <clipPath id="${uid}_te_clip">
                        <path d="${bodyPath}"/>
                    </clipPath>
                </defs>

                <!-- 连续等离子电青波浪腹鳍 -->
                <path d="${bodyRibbonFinPath}" fill="url(#${uid}_te_fin)" stroke="${outline}" stroke-width="1.0" stroke-linejoin="round"/>
                ${ribbonRays}

                <!-- 摆动蛇形尾段 -->
                <g class="svg-fish-tail">
                    <path d="${tailRibbonPath}" fill="url(#${uid}_te_fin)" stroke="${outline}" stroke-width="0.95" stroke-linejoin="round"/>
                    <path d="${tailBodyPath}" fill="url(#${uid}_te_body)" stroke="${outline}" stroke-width="1.35" stroke-linejoin="round"/>
                    ${tailBioNodes}
                </g>

                <!-- 蛇形电鳗身躯 -->
                <path d="${bodyPath}" fill="url(#${uid}_te_body)" stroke="${outline}" stroke-width="1.5" stroke-linejoin="round"/>

                <g clip-path="url(#${uid}_te_clip)">
                    ${isSilhouette ? '' : `
                        <path d="M 60,52 Q 82,66 102,65 Q 124,62 146,51" fill="none" stroke="${cGlow}" stroke-width="1.4" opacity="0.52"/>
                        <path d="M 148,43 Q 165,45 178,51" fill="none" stroke="rgba(224,242,254,0.44)" stroke-width="2.2" stroke-linecap="round"/>
                    `}
                    ${bioNodes}
                </g>

                <!-- 胸鳍（锚定关节根部） -->
                <g class="svg-fish-pec" style="transform-box: view-box; transform-origin: 151px 64px;">
                    <path d="M 150,60 C 142,62 138,68 144,72 C 149,73 154,67 153,61 Z" fill="url(#${uid}_te_fin)" stroke="${outline}" stroke-width="1.0"/>
                </g>

                ${isSilhouette ? '' : '<path d="M 171,60 Q 178,60 183,56" fill="none" stroke="#090d16" stroke-width="1.5" stroke-linecap="round"/>'}
                ${art.svgEye(168, 50, 4.3, isSilhouette, isShiny ? palette.iris : '#fde047', { style: 'glow', uid })}
                ${sparks}
                ${art.svgShinyOverlay(isSilhouette, isShiny)}
            `;
        },

        drawCanvas(ctx, size, time, opts) {
            const s = Math.max(8, finite(size, 26));
            const { art, palette, isShiny, speedRatio, bodyBend, wagPhase, finPhase, phaseOffset } = resolveDrawContext(opts, 10.5);

            const cTop = isShiny ? palette.bodyDark : '#0b1630';
            const cMid = isShiny ? palette.body : '#1d4ed8';
            const cGlow = isShiny ? palette.finLight : '#38bdf8';
            const cVolt = isShiny ? palette.bellyWarm : '#fef08a';
            const outline = isShiny ? palette.outline : '#082f49';

            const pts = art.buildSpinePoints(
                s * 1.06,
                -s * 1.12,
                14,
                bodyBend,
                wagPhase,
                s * 0.14 * Math.min(1.45, 0.78 + speedRatio * 0.34),
                1.15
            );
            const widths = [0.13, 0.22, 0.24, 0.23, 0.22, 0.21, 0.19, 0.18, 0.16, 0.14, 0.11, 0.085, 0.06, 0.035].map(w => w * s);

            // 1. 连续等离子腹鳍
            const finOffsets = widths.map((w, idx) => {
                if (idx < 3) return w * 0.4;
                const t = (idx - 3) / 10;
                const ripple = Math.sin(wagPhase * 1.6 - idx * 0.85) * s * 0.04;
                const finH = s * (0.21 * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.88) + 0.05);
                return w + finH + ripple;
            });
            const finCurve = computeSpineOffsetCurve(pts, finOffsets, 1);

            ctx.save();
            const finGrad = ctx.createLinearGradient(0, 0, 0, s * 0.52);
            finGrad.addColorStop(0, cMid);
            finGrad.addColorStop(1, cGlow);
            ctx.fillStyle = finGrad;
            ctx.globalAlpha = 0.68;
            ctx.beginPath();
            ctx.moveTo(pts[3].x, pts[3].y);
            for (let i = 3; i < pts.length; i++) ctx.lineTo(finCurve[i].x, finCurve[i].y);
            for (let i = pts.length - 1; i >= 3; i--) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 0.85;
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.65, s * 0.03);
            ctx.stroke();
            ctx.restore();

            // 2. 蛇形身体丝带
            const bodyGrad = ctx.createLinearGradient(0, -s * 0.34, 0, s * 0.34);
            bodyGrad.addColorStop(0, cTop);
            bodyGrad.addColorStop(0.55, cMid);
            bodyGrad.addColorStop(1, cGlow);
            art.drawCanvasSpineRibbon(ctx, pts, widths, bodyGrad, outline, Math.max(0.85, s * 0.042));

            // 3. 精致晶体生物电节点
            for (let i = 3; i <= 11; i++) {
                const p = pts[i];
                const pulse = 0.55 + 0.45 * Math.sin(time * 9 - i * 0.75 + phaseOffset);
                const rNode = Math.max(1.0, s * (0.045 - i * 0.0012) * (0.85 + pulse * 0.25));
                const nodeColor = i % 2 === 0 ? cGlow : cVolt;
                drawSoftGlowDot(art, ctx, p.x, p.y, rNode, nodeColor, '#ffffff');
            }

            // 4. 贴合躯干轮廓的细碎电弧丝（彻底移除粗黄折线框）
            const tick = Math.floor(time * 14);
            const arcCount = speedRatio > 1.3 ? 3 : 2;
            for (let a = 0; a < arcCount; a++) {
                const seed = tick * 17 + a * 31;
                const startIdx = 2 + Math.floor(Math.abs(Math.sin(seed * 1.13)) * 5);
                const endIdx = Math.min(12, startIdx + 3);
                const side = ((seed + a) % 2 === 0) ? -1 : 1;

                ctx.save();
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.beginPath();
                let midPx = 0;
                let midPy = 0;
                const midK = Math.floor((startIdx + endIdx) * 0.5);
                for (let k = startIdx; k <= endIdx; k++) {
                    const p = pts[k];
                    const jitterY = side * (widths[k] + s * (0.04 + Math.abs(Math.sin(seed + k * 2.3)) * 0.11));
                    const jitterX = Math.cos(seed + k * 1.9) * s * 0.04;
                    const px = p.x + jitterX;
                    const py = p.y + jitterY;
                    if (k === startIdx) ctx.moveTo(p.x, p.y + side * widths[k] * 0.8);
                    ctx.lineTo(px, py);
                    if (k === midK) {
                        midPx = px;
                        midPy = py;
                    }
                }
                ctx.strokeStyle = cGlow;
                ctx.globalAlpha = 0.78;
                ctx.lineWidth = Math.max(1.5, s * 0.068);
                ctx.stroke();

                ctx.strokeStyle = '#ffffff';
                ctx.globalAlpha = 0.96;
                ctx.lineWidth = Math.max(0.75, s * 0.028);
                ctx.stroke();

                ctx.strokeStyle = cVolt;
                ctx.globalAlpha = 0.90;
                ctx.lineWidth = Math.max(0.75, s * 0.026);
                ctx.beginPath();
                ctx.moveTo(midPx, midPy);
                ctx.lineTo(midPx + Math.sin(seed) * s * 0.06, midPy + side * s * 0.11);
                ctx.stroke();
                ctx.restore();
            }

            // 5. 小胸鳍与发光电鳗眼
            const pec = pts[2];
            ctx.save();
            ctx.translate(pec.x, pec.y + widths[2] * 0.65);
            ctx.rotate(Math.sin(finPhase) * 0.25);
            ctx.fillStyle = cGlow;
            ctx.globalAlpha = 0.78;
            ctx.beginPath();
            ctx.ellipse(-s * 0.05, s * 0.08, s * 0.11, s * 0.055, -0.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            art.drawCanvasEye(ctx, pts[1].x + s * 0.04, pts[1].y - widths[1] * 0.28, Math.max(1.9, s * 0.095), isShiny ? palette.iris : '#fde047', { style: 'glow' });
        }
    };

    // ========================================================================
    // 4. 银鳞龙鱼 (arowana) — 铂金月银平直背脊 + 吊桥巨颌 + 盾形大鳞
    // ========================================================================
    function buildArowanaArmorScalesSVG(isSilhouette, rimColor, shColor) {
        if (isSilhouette) return '';
        const rows = [
            { y: 46, xs: [64, 78, 92, 106, 120, 134], alpha: 0.75 },
            { y: 55, xs: [57, 71, 85, 99, 113, 127], alpha: 0.92 },
            { y: 64, xs: [64, 78, 92, 106, 120, 134], alpha: 0.70 }
        ];
        const parts = [];
        for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            for (let c = 0; c < row.xs.length; c++) {
                const x = row.xs[c];
                const y = row.y;
                parts.push(
                    `<path d="M ${x + 1},${y - 5.2} C ${x - 6.5},${y - 3.6} ${x - 6.5},${y + 3.6} ${x + 1},${y + 5.2}" fill="none" stroke="${shColor}" stroke-width="1.3" stroke-linecap="round" opacity="${row.alpha}"/>` +
                    `<path d="M ${x},${y - 5.0} C ${x - 6.2},${y - 3.4} ${x - 6.2},${y + 3.4} ${x},${y + 5.0}" fill="none" stroke="${rimColor}" stroke-width="1.0" stroke-linecap="round" opacity="${row.alpha}"/>`
                );
            }
        }
        return `<g class="svg-ar-scales">${parts.join('')}</g>`;
    }

    WWF.FISH_MODELS.arowana = {
        motion: {
            swimStyle: 'majestic',
            tailFreq: 6.0,
            tailAmp: 0.20,
            bodyFlex: 0.17,
            pectoralFreq: 4.2,
            turnAgility: 0.92,
            bobAmp: 2.5,
            tailPivot: '46px 53px'
        },

        buildSVGContent({ isSilhouette, isShiny, uid, palette, art }) {
            const cTop = isSilhouette ? palette.bodyDark : (isShiny ? palette.body : '#64748b');
            const cSilver = isSilhouette ? palette.body : (isShiny ? palette.bodyLight : '#f8fafc');
            const cPearl = isSilhouette ? palette.body : (isShiny ? palette.belly : '#dbeafe');
            const cBelly = isSilhouette ? palette.belly : (isShiny ? palette.bellyWarm : '#bae6fd');
            const cFin = isSilhouette ? palette.finDark : (isShiny ? palette.fin : '#38bdf8');
            const cFinTip = isSilhouette ? palette.finLight : (isShiny ? palette.finLight : '#e0f2fe');
            const outline = isSilhouette ? palette.stroke : (isShiny ? palette.outline : '#334155');
            const rayColor = isShiny ? 'rgba(255,255,255,0.68)' : 'rgba(255,255,255,0.70)';

            // 平直如刃的铂金背脊 + 上翘吊桥巨颌 + 优雅流线深胸
            const bodyPath =
                'M 44,41 ' +
                'L 156,37 ' +
                'Q 168,38 175,41 ' +
                'L 182,44 ' +
                'C 176,56 164,66 148,70 ' +
                'C 121,76 82,74 44,61 Z';

            const barbels = `
                <g fill="${isSilhouette ? palette.finLight : cFin}" stroke="${outline}" stroke-width="0.45">
                    <path d="M 180,43 Q 187,36 189,30 Q 186,38 182,45 Z"/>
                    <path d="M 181,46 Q 188,43 190,39 Q 186,44 182,48 Z"/>
                </g>
            `;

            return `
                <defs>
                    <linearGradient id="${uid}_ar_body" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${cTop}"/>
                        <stop offset="28%" stop-color="${cSilver}"/>
                        <stop offset="68%" stop-color="${cPearl}"/>
                        <stop offset="100%" stop-color="${cBelly}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_ar_irid" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stop-color="#a5b4fc" stop-opacity="0.14"/>
                        <stop offset="50%" stop-color="#f0abfc" stop-opacity="0.22"/>
                        <stop offset="100%" stop-color="#bae6fd" stop-opacity="0.16"/>
                    </linearGradient>
                    <linearGradient id="${uid}_ar_fin" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="${cFin}" stop-opacity="${isSilhouette ? 0.94 : 0.78}"/>
                        <stop offset="100%" stop-color="${cFinTip}" stop-opacity="${isSilhouette ? 0.88 : 0.44}"/>
                    </linearGradient>
                    <clipPath id="${uid}_ar_clip">
                        <path d="${bodyPath}"/>
                    </clipPath>
                </defs>

                <!-- 靠后丝带长背鳍与超长波浪臀鳍 -->
                <g class="svg-fish-veil">
                    <path d="M 98,39 C 81,23 56,21 42,33 L 45,42 Z" fill="url(#${uid}_ar_fin)" stroke="${outline}" stroke-width="1.05" stroke-linejoin="round"/>
                    ${!isSilhouette ? art.svgFinRays([
                        'M 89,39 Q 83,31 78,27',
                        'M 77,40 Q 71,31 66,27',
                        'M 65,40 Q 59,31 54,28',
                        'M 53,41 Q 49,34 46,32'
                    ], rayColor, 0.62, 0.85) : ''}
                    <path d="M 108,71 C 88,91 56,93 41,79 L 45,60 Z" fill="url(#${uid}_ar_fin)" stroke="${outline}" stroke-width="1.05" stroke-linejoin="round"/>
                    ${!isSilhouette ? art.svgFinRays([
                        'M 96,71 Q 90,81 86,86',
                        'M 83,71 Q 77,82 73,87',
                        'M 70,69 Q 64,80 60,85',
                        'M 57,66 Q 52,76 49,79'
                    ], rayColor, 0.62, 0.85) : ''}
                </g>

                <!-- 圆润铂金桨尾 -->
                <g class="svg-fish-tail">
                    <path d="M 46,41 C 30,35 15,41 14,52 C 14,64 30,70 46,61 Z" fill="url(#${uid}_ar_fin)" stroke="${outline}" stroke-width="1.15" stroke-linejoin="round"/>
                    ${!isSilhouette ? art.svgFinRays([
                        'M 44,47 Q 30,44 19,46',
                        'M 44,52 Q 29,52 17,53',
                        'M 44,57 Q 30,60 20,61'
                    ], rayColor, 0.68, 0.9) : ''}
                </g>

                <!-- 铂金银龙鱼身 -->
                <path d="${bodyPath}" fill="url(#${uid}_ar_body)" stroke="${outline}" stroke-width="1.45" stroke-linejoin="round"/>

                <!-- 虹彩珍珠光泽 + 真实马蹄盾形银鳞 + 吊桥巨颌 -->
                <g clip-path="url(#${uid}_ar_clip)">
                    ${isSilhouette ? '' : `
                        <path d="${bodyPath}" fill="url(#${uid}_ar_irid)"/>
                        <path d="M 52,39 L 154,39" fill="none" stroke="rgba(255,255,255,0.78)" stroke-width="2.6" stroke-linecap="round"/>
                        <path d="M 145,42 Q 137,55 147,68" fill="none" stroke="${outline}" stroke-width="1.65" stroke-linecap="round" opacity="0.60"/>
                    `}
                    ${buildArowanaArmorScalesSVG(isSilhouette, 'rgba(255,255,255,0.72)', isShiny ? 'rgba(180,83,9,0.34)' : 'rgba(56,189,248,0.36)')}
                    ${isSilhouette ? '' : '<path d="M 179,44 L 154,60" fill="none" stroke="#0f172a" stroke-width="1.95" stroke-linecap="round"/>'}
                </g>

                ${barbels}

                <!-- 修长剑翼胸鳍（锚定关节根部） -->
                <g class="svg-fish-pec" style="transform-box: view-box; transform-origin: 138px 66px;">
                    <path d="M 138,65 C 122,74 100,87 88,96 C 100,97 125,86 141,70 Z" fill="url(#${uid}_ar_fin)" stroke="${outline}" stroke-width="1.05" stroke-linejoin="round"/>
                    ${!isSilhouette ? art.svgFinRays([
                        'M 136,68 Q 117,80 97,92',
                        'M 138,70 Q 123,82 106,90'
                    ], rayColor, 0.65, 0.85) : ''}
                </g>

                ${art.svgEye(163, 46, 4.7, isSilhouette, isShiny ? palette.iris : '#f59e0b', { style: 'fierce', uid, browColor: outline })}
                ${art.svgShinyOverlay(isSilhouette, isShiny)}
            `;
        },

        drawCanvas(ctx, size, time, opts) {
            const s = Math.max(8, finite(size, 26));
            const { art, palette, isShiny, speedRatio, bodyBend, wagPhase, finPhase } = resolveDrawContext(opts, 6.0);

            const cTop = isShiny ? palette.body : '#64748b';
            const cSilver = isShiny ? palette.bodyLight : '#f8fafc';
            const cBelly = isShiny ? palette.belly : '#bae6fd';
            const cFin = isShiny ? palette.fin : '#38bdf8';
            const outline = isShiny ? palette.outline : '#334155';

            const pts = art.buildSpinePoints(
                s * 1.02,
                -s * 0.96,
                9,
                bodyBend * 0.72,
                wagPhase,
                s * 0.068 * Math.min(1.4, 0.75 + speedRatio * 0.28),
                0.52
            );

            const topOffsets = [0.09, 0.19, 0.20, 0.20, 0.20, 0.19, 0.18, 0.14, 0.10].map(w => w * s);
            const botOffsets = [0.07, 0.27, 0.35, 0.34, 0.32, 0.27, 0.22, 0.16, 0.10].map(w => w * s);
            const topPts = computeSpineOffsetCurve(pts, topOffsets, -1);
            const botPts = computeSpineOffsetCurve(pts, botOffsets, 1);

            // 1. 长背鳍与长臀鳍
            ctx.save();
            const finGrad = ctx.createLinearGradient(0, -s * 0.4, 0, s * 0.4);
            finGrad.addColorStop(0, isShiny ? palette.finLight : 'rgba(224,242,254,0.68)');
            finGrad.addColorStop(0.5, cFin);
            finGrad.addColorStop(1, isShiny ? palette.finLight : 'rgba(224,242,254,0.68)');
            ctx.fillStyle = finGrad;
            ctx.globalAlpha = 0.78;
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.7, s * 0.032);

            ctx.beginPath();
            ctx.moveTo(topPts[4].x, topPts[4].y);
            ctx.bezierCurveTo(topPts[5].x, topPts[5].y - s * 0.26, topPts[7].x, topPts[7].y - s * 0.26, topPts[8].x, topPts[8].y - s * 0.09);
            ctx.lineTo(topPts[8].x, topPts[8].y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(botPts[4].x, botPts[4].y);
            ctx.bezierCurveTo(botPts[5].x, botPts[5].y + s * 0.29, botPts[7].x, botPts[7].y + s * 0.29, botPts[8].x, botPts[8].y + s * 0.09);
            ctx.lineTo(botPts[8].x, botPts[8].y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 2. 圆桨尾鳍
            const tailBase = pts[8];
            const tailPrev = pts[7];
            const tailAng = Math.atan2(tailPrev.y - tailBase.y, tailPrev.x - tailBase.x);
            ctx.save();
            ctx.translate(tailBase.x, tailBase.y);
            ctx.rotate(tailAng + Math.sin(wagPhase - 1.2) * 0.2);
            ctx.fillStyle = cFin;
            ctx.globalAlpha = 0.78;
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.7, s * 0.032);
            ctx.beginPath();
            ctx.moveTo(0, -s * 0.09);
            ctx.bezierCurveTo(-s * 0.22, -s * 0.22, -s * 0.44, -s * 0.14, -s * 0.44, 0);
            ctx.bezierCurveTo(-s * 0.44, s * 0.14, -s * 0.22, s * 0.22, 0, s * 0.09);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 3. 铂金龙鱼平直背脊与吊桥巨颌主体
            const jawTipX = pts[0].x + s * 0.15;
            const jawTipY = topPts[0].y - s * 0.01;
            const bodyGrad = ctx.createLinearGradient(0, -s * 0.25, 0, s * 0.34);
            bodyGrad.addColorStop(0, cTop);
            bodyGrad.addColorStop(0.32, cSilver);
            bodyGrad.addColorStop(1, cBelly);

            ctx.save();
            ctx.fillStyle = bodyGrad;
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.85, s * 0.044);
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(topPts[8].x, topPts[8].y);
            for (let i = 7; i >= 0; i--) ctx.lineTo(topPts[i].x, topPts[i].y);
            ctx.lineTo(jawTipX, jawTipY);
            ctx.quadraticCurveTo(pts[0].x + s * 0.08, botPts[0].y + s * 0.08, botPts[1].x, botPts[1].y);
            for (let i = 2; i < botPts.length; i++) ctx.lineTo(botPts[i].x, botPts[i].y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = Math.max(0.9, s * 0.04);
            ctx.beginPath();
            ctx.moveTo(jawTipX - s * 0.02, jawTipY + s * 0.02);
            ctx.lineTo(pts[1].x, pts[1].y + s * 0.10);
            ctx.stroke();

            // 马蹄盾形大鳞弧（非几何菱格）
            art.drawCanvasScaleArcs(
                ctx,
                (pts[2].x + pts[6].x) * 0.5,
                (pts[2].y + pts[6].y) * 0.5,
                s * 0.72,
                s * 0.30,
                3,
                5,
                isShiny ? 'rgba(180,83,9,0.40)' : 'rgba(56,189,248,0.42)'
            );
            ctx.restore();

            // 4. 修长剑翼胸鳍
            const pecWave = Math.sin(finPhase) * 0.16;
            ctx.save();
            ctx.translate(pts[2].x - s * 0.03, botPts[2].y - s * 0.03);
            ctx.rotate(pecWave);
            ctx.fillStyle = cFin;
            ctx.globalAlpha = 0.80;
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.7, s * 0.03);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-s * 0.46, s * 0.29);
            ctx.quadraticCurveTo(-s * 0.21, s * 0.25, s * 0.04, s * 0.04);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 5. 前伸流银龙须与猛禽龙眼
            const sway = Math.sin(wagPhase * 0.7) * s * 0.03;
            drawCanvasTaperedBarbel(ctx, jawTipX, jawTipY, jawTipX + s * 0.10, jawTipY - s * 0.08 + sway, jawTipX + s * 0.15, jawTipY - s * 0.15 + sway, cFin, s * 0.042);
            drawCanvasTaperedBarbel(ctx, jawTipX, jawTipY + s * 0.03, jawTipX + s * 0.09, jawTipY + s * 0.01 - sway, jawTipX + s * 0.14, jawTipY - s * 0.04 - sway, cSilver, s * 0.038);

            art.drawCanvasEye(ctx, pts[0].x - s * 0.02, topPts[0].y + s * 0.09, Math.max(1.9, s * 0.105), isShiny ? palette.iris : '#f59e0b', { style: 'fierce', browColor: outline });
        }
    };

    // ========================================================================
    // 5. 深渊巨鲶 (catfish) — 冷月青背光 + 清晰三对触须 + 长波浪臀鳍
    // ========================================================================
    function buildCatfishMottlesSVG(isSilhouette, mottleDark, mottleLight) {
        if (isSilhouette) return '';
        return `
            <g class="svg-cf-mottles">
                <ellipse cx="96" cy="52" rx="14" ry="8" transform="rotate(-12 96 52)" fill="${mottleDark}" opacity="0.38"/>
                <ellipse cx="122" cy="48" rx="11" ry="7" transform="rotate(14 122 48)" fill="${mottleDark}" opacity="0.35"/>
                <ellipse cx="70" cy="58" rx="10" ry="6" transform="rotate(-6 70 58)" fill="${mottleDark}" opacity="0.36"/>
                <ellipse cx="136" cy="60" rx="9" ry="5.5" fill="${mottleLight}" opacity="0.24"/>
                <ellipse cx="86" cy="66" rx="8" ry="4.5" fill="${mottleLight}" opacity="0.22"/>
                <circle cx="110" cy="56" r="3.4" fill="${mottleLight}" opacity="0.26"/>
                <circle cx="144" cy="44" r="2.8" fill="${mottleDark}" opacity="0.32"/>
            </g>
        `;
    }

    WWF.FISH_MODELS.catfish = {
        motion: {
            swimStyle: 'undulate',
            tailFreq: 6.8,
            tailAmp: 0.25,
            bodyFlex: 0.26,
            pectoralFreq: 4.5,
            turnAgility: 0.78,
            bobAmp: 2.2,
            tailPivot: '44px 59px'
        },

        buildSVGContent({ isSilhouette, isShiny, uid, palette, art }) {
            const cTop = isSilhouette ? palette.bodyDark : (isShiny ? palette.bodyDark : '#25384f');
            const cMid = isSilhouette ? palette.body : (isShiny ? palette.body : '#3e5976');
            const cTeal = isSilhouette ? palette.body : (isShiny ? palette.body : '#567896');
            const cBelly = isSilhouette ? palette.belly : (isShiny ? palette.bellyWarm : '#cbd5e1');
            const cFin = isSilhouette ? palette.finDark : (isShiny ? palette.fin : '#293d54');
            const cFinEdge = isSilhouette ? palette.finLight : (isShiny ? palette.finLight : '#7ea2bf');
            const cBarbelLong = isSilhouette ? palette.fin : (isShiny ? palette.bodyLight : '#94b3ce');
            const cBarbelShort = isSilhouette ? palette.stroke : (isShiny ? palette.bellyWarm : '#cbd5e1');
            const outline = isSilhouette ? palette.stroke : (isShiny ? palette.outline : '#0f172a');
            const rimColor = isSilhouette ? 'rgba(148,163,184,0.16)' : (isShiny ? '#fef08a' : '#7dd3fc');

            const bodyPath =
                'M 43,52 ' +
                'C 64,46 88,38 118,36 ' +
                'C 140,34 163,38 176,51 ' +
                'C 179,56 178,62 173,66 ' +
                'C 159,77 135,82 108,79 ' +
                'C 82,76 62,70 43,66 Z';

            const analFinPath = 'M 103,77 C 91,94 71,95 56,86 C 48,81 43,73 44,65 L 68,69 Z';

            const tailRays = isSilhouette ? '' : art.svgFinRays([
                'M 42,54 Q 29,48 19,49',
                'M 42,59 Q 27,59 17,59',
                'M 42,64 Q 29,70 19,69'
            ], 'rgba(186,230,253,0.48)', 0.6, 0.85);

            // 梳理整齐的 3 对渐细触须：1 对优雅向后流线主颌须 + 2 对长短分明颏须（绝不交叉）
            const barbels = `
                <g fill="${cBarbelLong}" stroke="${outline}" stroke-width="0.45">
                    <path d="M 173,53 C 185,48 190,53 182,60 C 168,69 146,70 122,63 C 145,67 166,66 179,58 C 185,53 183,50 172,55 Z"/>
                    <path d="M 170,58 C 183,58 189,64 180,71 C 166,78 140,78 112,72 C 138,75 163,75 177,69 C 184,64 181,60 169,60 Z"/>
                </g>
                <g fill="${cBarbelShort}" stroke="${outline}" stroke-width="0.4">
                    <path d="M 166,72 C 170,79 169,86 165,91 C 167,85 167,79 164,73 Z"/>
                    <path d="M 159,75 C 162,82 160,89 154,94 C 157,88 159,82 157,76 Z"/>
                    <path d="M 152,77 C 153,84 149,90 143,94 C 147,89 150,84 150,78 Z"/>
                    <path d="M 145,78 C 144,84 139,89 133,92 C 137,88 141,84 143,79 Z"/>
                </g>
            `;

            return `
                <defs>
                    <linearGradient id="${uid}_cf_body" x1="15%" y1="0%" x2="85%" y2="100%">
                        <stop offset="0%" stop-color="${cTop}"/>
                        <stop offset="48%" stop-color="${cMid}"/>
                        <stop offset="78%" stop-color="${cTeal}"/>
                        <stop offset="100%" stop-color="${cBelly}"/>
                    </linearGradient>
                    <linearGradient id="${uid}_cf_fin" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${cFin}" stop-opacity="${isSilhouette ? 0.95 : 0.90}"/>
                        <stop offset="100%" stop-color="${cFinEdge}" stop-opacity="${isSilhouette ? 0.88 : 0.65}"/>
                    </linearGradient>
                    <clipPath id="${uid}_cf_clip">
                        <path d="${bodyPath}"/>
                    </clipPath>
                </defs>

                <!-- 前移小背鳍 -->
                <path d="M 110,37 C 113,22 123,20 127,36 Z" fill="url(#${uid}_cf_fin)" stroke="${outline}" stroke-width="1.15" stroke-linejoin="round"/>

                <!-- 连绵长臀鳍 -->
                <path d="${analFinPath}" fill="url(#${uid}_cf_fin)" stroke="${outline}" stroke-width="1.15" stroke-linejoin="round"/>

                <!-- 圆润大桨尾 -->
                <g class="svg-fish-tail">
                    <path d="M 46,51 C 32,40 16,44 15,59 C 14,75 31,80 46,67 Z" fill="url(#${uid}_cf_fin)" stroke="${outline}" stroke-width="1.25" stroke-linejoin="round"/>
                    ${tailRays}
                </g>

                <!-- 远古巨鲶身躯 -->
                <path d="${bodyPath}" fill="url(#${uid}_cf_body)" stroke="${outline}" stroke-width="1.5" stroke-linejoin="round"/>

                <!-- 冷月青轮廓背光 + 斑驳石纹 + 阔口 -->
                <g clip-path="url(#${uid}_cf_clip)">
                    ${buildCatfishMottlesSVG(isSilhouette, '#0f172a', isShiny ? '#fbcfe8' : '#0f766e')}
                    ${isSilhouette ? '' : `
                        <path d="M 48,51 C 76,42 118,34 166,44" fill="none" stroke="${rimColor}" stroke-width="2.4" stroke-linecap="round" opacity="0.52"/>
                        <path d="M 74,44 Q 118,37 156,43" fill="none" stroke="rgba(226,232,240,0.28)" stroke-width="2.8" stroke-linecap="round"/>
                        <path d="M 150,66 Q 165,70 176,60" fill="none" stroke="#090d16" stroke-width="2.4" stroke-linecap="round"/>
                        <path d="M 152,69 Q 165,72 174,64" fill="none" stroke="rgba(186,230,253,0.42)" stroke-width="1.2" stroke-linecap="round"/>
                    `}
                </g>

                <!-- 宽圆浆状胸鳍（锚定关节根部） -->
                <g class="svg-fish-pec" style="transform-box: view-box; transform-origin: 135px 69px;">
                    <path d="M 134,67 C 120,73 108,86 114,94 C 123,98 136,86 139,71 Z" fill="url(#${uid}_cf_fin)" stroke="${outline}" stroke-width="1.1" stroke-linejoin="round"/>
                </g>

                ${barbels}

                ${art.svgEye(154, 48, 3.9, isSilhouette, isShiny ? palette.iris : '#f59e0b', { style: 'fierce', uid, browColor: outline })}
                ${art.svgShinyOverlay(isSilhouette, isShiny)}
            `;
        },

        drawCanvas(ctx, size, time, opts) {
            const s = Math.max(8, finite(size, 26));
            const { art, palette, isShiny, speedRatio, bodyBend, wagPhase, finPhase } = resolveDrawContext(opts, 6.8);

            const cTop = isShiny ? palette.bodyDark : '#25384f';
            const cMid = isShiny ? palette.body : '#3e5976';
            const cBelly = isShiny ? palette.bellyWarm : '#cbd5e1';
            const cFin = isShiny ? palette.fin : '#293d54';
            const cBarbelLong = isShiny ? palette.bodyLight : '#94b3ce';
            const cBarbelShort = isShiny ? palette.bellyWarm : '#cbd5e1';
            const outline = isShiny ? palette.outline : '#0f172a';
            const rimColor = isShiny ? '#fef08a' : '#7dd3fc';

            const pts = art.buildSpinePoints(
                s * 1.08,
                -s * 1.06,
                11,
                bodyBend,
                wagPhase,
                s * 0.115 * Math.min(1.4, 0.78 + speedRatio * 0.30),
                0.72
            );
            const widths = [0.26, 0.45, 0.49, 0.42, 0.34, 0.28, 0.22, 0.18, 0.14, 0.11, 0.09].map(w => w * s);

            // 1. 前移小背鳍
            ctx.save();
            ctx.fillStyle = cFin;
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.7, s * 0.032);
            ctx.beginPath();
            ctx.moveTo(pts[3].x + s * 0.06, pts[3].y - widths[3] * 0.85);
            ctx.quadraticCurveTo(pts[3].x - s * 0.02, pts[3].y - widths[3] - s * 0.22, pts[4].x + s * 0.04, pts[4].y - widths[4] * 0.85);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 2. 连绵长臀鳍
            const analOffsets = widths.map((w, idx) => (idx < 4 ? w * 0.6 : w + s * 0.16 * Math.sin(((idx - 4) / 6) * Math.PI * 0.85 + 0.2)));
            const analCurve = computeSpineOffsetCurve(pts, analOffsets, 1);
            ctx.save();
            ctx.fillStyle = cFin;
            ctx.globalAlpha = 0.88;
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.7, s * 0.032);
            ctx.beginPath();
            ctx.moveTo(pts[4].x, pts[4].y);
            for (let i = 4; i < pts.length; i++) ctx.lineTo(analCurve[i].x, analCurve[i].y);
            for (let i = pts.length - 1; i >= 4; i--) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 3. 圆铲尾
            const tailBase = pts[10];
            const tailPrev = pts[9];
            const tailAng = Math.atan2(tailPrev.y - tailBase.y, tailPrev.x - tailBase.x);
            ctx.save();
            ctx.translate(tailBase.x, tailBase.y);
            ctx.rotate(tailAng + Math.sin(wagPhase - 1.3) * 0.22);
            ctx.fillStyle = cFin;
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.8, s * 0.036);
            ctx.beginPath();
            ctx.moveTo(0, -s * 0.08);
            ctx.bezierCurveTo(-s * 0.24, -s * 0.26, -s * 0.44, -s * 0.16, -s * 0.44, 0);
            ctx.bezierCurveTo(-s * 0.44, s * 0.16, -s * 0.24, s * 0.26, 0, s * 0.08);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 4. 宽扁无鳞躯干丝带
            const bodyGrad = ctx.createLinearGradient(0, -s * 0.44, 0, s * 0.44);
            bodyGrad.addColorStop(0, cTop);
            bodyGrad.addColorStop(0.55, cMid);
            bodyGrad.addColorStop(1, cBelly);
            art.drawCanvasSpineRibbon(ctx, pts, widths, bodyGrad, outline, Math.max(0.9, s * 0.048));

            // 5. 冷月青背部轮廓亮边 + 斑驳石纹 + 阔口
            ctx.save();
            ctx.strokeStyle = rimColor;
            ctx.globalAlpha = 0.45;
            ctx.lineWidth = Math.max(1.0, s * 0.055);
            ctx.lineCap = 'round';
            ctx.beginPath();
            for (let i = 1; i <= 8; i++) {
                const px = pts[i].x;
                const py = pts[i].y - widths[i] * 0.72;
                if (i === 1) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
            ctx.globalAlpha = 1;

            const mottleIndices = [2, 4, 6, 8];
            for (let m = 0; m < mottleIndices.length; m++) {
                const p = pts[mottleIndices[m]];
                ctx.fillStyle = m % 2 === 0 ? 'rgba(15, 23, 42, 0.34)' : (isShiny ? 'rgba(244, 114, 182, 0.26)' : 'rgba(20, 184, 166, 0.24)');
                ctx.beginPath();
                ctx.ellipse(p.x, p.y - widths[mottleIndices[m]] * 0.16, s * 0.13, widths[mottleIndices[m]] * 0.36, 0.2, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.strokeStyle = '#090d16';
            ctx.lineWidth = Math.max(1.1, s * 0.055);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(pts[0].x + s * 0.04, pts[0].y + s * 0.06);
            ctx.quadraticCurveTo(pts[0].x - s * 0.06, pts[0].y + s * 0.16, pts[1].x - s * 0.02, pts[1].y + s * 0.18);
            ctx.stroke();
            ctx.restore();

            // 6. 圆润胸鳍
            ctx.save();
            ctx.translate(pts[2].x - s * 0.04, pts[2].y + widths[2] * 0.56);
            ctx.rotate(Math.sin(finPhase) * 0.2);
            ctx.fillStyle = cFin;
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(0.7, s * 0.032);
            ctx.beginPath();
            ctx.ellipse(-s * 0.12, s * 0.12, s * 0.17, s * 0.09, -0.55, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 7. 清晰梳理的三对共 6 根渐细触须（主颌须向后高扬，与下方短颏须绝不交叉）
            const head = pts[0];
            const sway = Math.sin(wagPhase * 0.85) * s * 0.045;
            drawCanvasTaperedBarbel(ctx, head.x + s * 0.04, head.y - s * 0.04, head.x + s * 0.22, head.y - s * 0.08 + sway, head.x - s * 0.24, head.y + s * 0.08 + sway, cBarbelLong, s * 0.046);
            drawCanvasTaperedBarbel(ctx, head.x, head.y + s * 0.06, head.x + s * 0.18, head.y + s * 0.10 - sway * 0.7, head.x - s * 0.36, head.y + s * 0.18 - sway * 0.5, cBarbelLong, s * 0.052);

            drawCanvasTaperedBarbel(ctx, head.x + s * 0.01, head.y + s * 0.18, head.x + s * 0.08, head.y + s * 0.29, head.x + s * 0.03, head.y + s * 0.39, cBarbelShort, s * 0.035);
            drawCanvasTaperedBarbel(ctx, head.x - s * 0.05, head.y + s * 0.20, head.x, head.y + s * 0.31, head.x - s * 0.05, head.y + s * 0.40, cBarbelShort, s * 0.035);
            drawCanvasTaperedBarbel(ctx, head.x - s * 0.10, head.y + s * 0.21, head.x - s * 0.08, head.y + s * 0.32, head.x - s * 0.15, head.y + s * 0.40, cBarbelShort, s * 0.035);
            drawCanvasTaperedBarbel(ctx, head.x - s * 0.15, head.y + s * 0.22, head.x - s * 0.16, head.y + s * 0.32, head.x - s * 0.23, head.y + s * 0.38, cBarbelShort, s * 0.033);

            // 8. 醒目猛兽琥珀眼
            art.drawCanvasEye(ctx, pts[1].x + s * 0.04, pts[1].y - widths[1] * 0.34, Math.max(1.85, s * 0.09), isShiny ? palette.iris : '#f59e0b', { style: 'fierce', browColor: outline });
        }
    };
})();
