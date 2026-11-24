/**
 * ============================================================================
 * 《微风垂钓物语 2.0》高精鱼类建模渲染引擎与触感交互控制器 (js/fish_renderer.js)
 * ============================================================================
 * 负责维护：
 * 1. WWF.FISH_MODELS 注册表与单调递增 SVG UID 生成器
 * 2. WWF.FishArt 共享色彩、高光、骨骼脊柱包络、鳍脉与运动参数工具集
 * 3. WWF.renderModelFishSVG / WWF.drawModelCanvasFish 顶层模型调度器
 * 4. WWF.bindFishShowcaseFeel 2.5D 倾斜跟随、摆尾加速与轻戳果冻回弹交互手感
 */
(function () {
    'use strict';

    const WWF = window.WWF = window.WWF || {};
    WWF.FISH_MODELS = WWF.FISH_MODELS || {};

    let svgUidCounter = 0;
    let eyeUidCounter = 0;

    function clamp(v, min, max) {
        return v < min ? min : (v > max ? max : v);
    }

    function parseHex(hex) {
        if (typeof hex !== 'string') return null;
        let clean = hex.trim();
        if (clean.startsWith('#')) clean = clean.slice(1);
        if (clean.length === 3) {
            clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
        }
        if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
        const num = parseInt(clean, 16);
        return {
            r: (num >> 16) & 255,
            g: (num >> 8) & 255,
            b: num & 255
        };
    }

    function toHex(r, g, b) {
        const cr = clamp(Math.round(r), 0, 255).toString(16).padStart(2, '0');
        const cg = clamp(Math.round(g), 0, 255).toString(16).padStart(2, '0');
        const cb = clamp(Math.round(b), 0, 255).toString(16).padStart(2, '0');
        return `#${cr}${cg}${cb}`;
    }

    function shadeHex(hex, amount = 0) {
        const rgb = parseHex(hex);
        if (!rgb) return hex || '#64748b';
        const t = clamp(amount, -1, 1);
        if (t >= 0) {
            return toHex(
                rgb.r + (255 - rgb.r) * t,
                rgb.g + (255 - rgb.g) * t,
                rgb.b + (255 - rgb.b) * t
            );
        }
        const f = 1 + t;
        return toHex(rgb.r * f, rgb.g * f, rgb.b * f);
    }

    function mixHex(hexA, hexB, ratio = 0.5) {
        const a = parseHex(hexA);
        const b = parseHex(hexB);
        if (!a || !b) return hexA || hexB || '#64748b';
        const t = clamp(ratio, 0, 1);
        return toHex(
            a.r + (b.r - a.r) * t,
            a.g + (b.g - a.g) * t,
            a.b + (b.b - a.b) * t
        );
    }

    const DEFAULT_MOTION = {
        swimStyle: 'glide',
        tailFreq: 8.5,
        tailAmp: 0.24,
        bodyFlex: 0.18,
        pectoralFreq: 5.5,
        turnAgility: 1.0,
        bobAmp: 3.5,
        tailPivot: '46px 60px'
    };

    const FishArt = {
        clamp,
        shadeHex,
        mixHex,

        getPalette(fish, isSilhouette = false, isShiny = false) {
            if (isSilhouette) {
                return {
                    body: '#1b283b',
                    bodyLight: '#24344c',
                    bodyDark: '#101928',
                    belly: '#152031',
                    bellyWarm: '#1d2c42',
                    fin: '#131f30',
                    finLight: '#1c2b40',
                    finDark: '#0b131f',
                    stroke: '#364a66',
                    outline: '#364a66',
                    finOutline: '#2a3b52',
                    highlight: 'rgba(148, 163, 184, 0.14)',
                    rimLight: 'rgba(148, 163, 184, 0.16)',
                    shadow: 'rgba(9, 14, 24, 0.45)',
                    glow: 'rgba(51, 65, 85, 0.25)',
                    iris: '#2a3a50',
                    eyeHighlight: 'rgba(148, 163, 184, 0.18)'
                };
            }

            if (isShiny) {
                return {
                    body: '#f5b938',
                    bodyLight: '#fef6d2',
                    bodyDark: '#b45309',
                    belly: '#fbcfe8',
                    bellyWarm: '#fff1f2',
                    fin: '#38bdf8',
                    finLight: '#e0f2fe',
                    finDark: '#0369a1',
                    stroke: 'rgba(120, 53, 15, 0.72)',
                    outline: '#78350f',
                    finOutline: '#075985',
                    highlight: 'rgba(255, 250, 230, 0.62)',
                    rimLight: 'rgba(254, 249, 195, 0.72)',
                    shadow: 'rgba(120, 53, 15, 0.28)',
                    glow: '#fde047',
                    iris: '#ec4899',
                    eyeHighlight: '#fffbeb'
                };
            }

            const baseBody = (fish && fish.bodyColor) || '#38bdf8';
            const baseBelly = (fish && fish.bellyColor) || '#f8fafc';
            const baseFin = (fish && fish.finColor) || '#0284c7';

            return {
                body: baseBody,
                bodyLight: shadeHex(baseBody, 0.30),
                bodyDark: shadeHex(baseBody, -0.34),
                belly: baseBelly,
                bellyWarm: shadeHex(baseBelly, 0.24),
                fin: baseFin,
                finLight: shadeHex(baseFin, 0.34),
                finDark: shadeHex(baseFin, -0.32),
                stroke: 'rgba(12, 22, 38, 0.56)',
                outline: shadeHex(baseBody, -0.58),
                finOutline: shadeHex(baseFin, -0.50),
                highlight: 'rgba(255, 255, 255, 0.38)',
                rimLight: 'rgba(224, 242, 254, 0.45)',
                shadow: 'rgba(10, 18, 34, 0.26)',
                glow: baseFin,
                iris: shadeHex(baseFin, -0.10),
                eyeHighlight: '#ffffff'
            };
        },

        getMotion(fish) {
            const id = fish && fish.id;
            const model = id ? WWF.FISH_MODELS[id] : null;
            const custom = (model && model.motion) || {};
            return Object.assign({}, DEFAULT_MOTION, custom);
        },

        svgEye(cx, cy, r = 5.4, isSilhouette = false, irisColor = '#38bdf8', styleOpts = null) {
            if (isSilhouette) {
                return `<circle cx="${cx}" cy="${cy}" r="${(r * 0.88).toFixed(2)}" fill="#26354a" stroke="#3f5473" stroke-width="0.9"/>`;
            }

            eyeUidCounter += 1;
            const opts = styleOpts || {};
            const style = opts.style || 'natural';
            const eid = (opts.uid ? `${opts.uid}_e${eyeUidCounter}` : `fe_${eyeUidCounter}`);
            const irisBase = irisColor || '#38bdf8';
            const irisLight = shadeHex(irisBase, 0.38);
            const irisDark = shadeHex(irisBase, -0.46);
            const pupilColor = opts.pupilColor || '#070b14';
            const browColor = opts.browColor || 'rgba(15, 23, 42, 0.65)';
            const rStr = r.toFixed(2);
            const socketR = (r * 1.18).toFixed(2);

            if (style === 'glow') {
                const pupilRx = (r * 0.22).toFixed(2);
                const pupilRy = (r * 0.54).toFixed(2);
                return `
                    <g class="svg-fish-eye" data-eye-style="glow">
                        <defs>
                            <radialGradient id="${eid}_glow" cx="46%" cy="46%" r="54%">
                                <stop offset="0%" stop-color="#ffffff"/>
                                <stop offset="28%" stop-color="${irisLight}"/>
                                <stop offset="72%" stop-color="${irisBase}"/>
                                <stop offset="100%" stop-color="${irisDark}"/>
                            </radialGradient>
                        </defs>
                        <circle cx="${cx}" cy="${cy}" r="${(r * 1.38).toFixed(2)}" fill="${irisBase}" opacity="0.22"/>
                        <circle cx="${cx}" cy="${cy}" r="${socketR}" fill="rgba(6, 10, 24, 0.68)"/>
                        <circle cx="${cx}" cy="${cy}" r="${rStr}" fill="url(#${eid}_glow)" stroke="${irisLight}" stroke-width="0.65"/>
                        <ellipse cx="${(cx + r * 0.08).toFixed(2)}" cy="${cy}" rx="${pupilRx}" ry="${pupilRy}" fill="${pupilColor}"/>
                        <circle cx="${(cx + r * 0.32).toFixed(2)}" cy="${(cy - r * 0.32).toFixed(2)}" r="${Math.max(0.75, r * 0.22).toFixed(2)}" fill="#ffffff" opacity="0.95"/>
                        <circle cx="${(cx - r * 0.22).toFixed(2)}" cy="${(cy + r * 0.34).toFixed(2)}" r="${Math.max(0.45, r * 0.12).toFixed(2)}" fill="${irisLight}" opacity="0.85"/>
                    </g>
                `;
            }

            if (style === 'dragon') {
                const rx = (r * 1.24).toFixed(2);
                const ry = (r * 0.88).toFixed(2);
                return `
                    <g class="svg-fish-eye" data-eye-style="dragon">
                        <defs>
                            <radialGradient id="${eid}_dragIrs" cx="45%" cy="55%" r="55%">
                                <stop offset="0%" stop-color="${irisLight}"/>
                                <stop offset="60%" stop-color="${irisBase}"/>
                                <stop offset="100%" stop-color="${irisDark}"/>
                            </radialGradient>
                        </defs>
                        <ellipse cx="${cx}" cy="${cy}" rx="${(r * 1.34).toFixed(2)}" ry="${(r * 0.98).toFixed(2)}" transform="rotate(-12 ${cx} ${cy})" fill="rgba(15, 23, 42, 0.45)"/>
                        <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(-12 ${cx} ${cy})" fill="#f8fafc" stroke="${irisDark}" stroke-width="0.7"/>
                        <circle cx="${(cx + r * 0.10).toFixed(2)}" cy="${cy}" r="${(r * 0.72).toFixed(2)}" fill="url(#${eid}_dragIrs)"/>
                        <ellipse cx="${(cx + r * 0.12).toFixed(2)}" cy="${cy}" rx="${(r * 0.23).toFixed(2)}" ry="${(r * 0.54).toFixed(2)}" fill="${pupilColor}"/>
                        <path d="M ${(cx - r * 1.35).toFixed(2)},${(cy - r * 0.15).toFixed(2)} Q ${cx},${(cy - r * 1.25).toFixed(2)} ${(cx + r * 1.30).toFixed(2)},${(cy - r * 0.55).toFixed(2)}" fill="none" stroke="${browColor}" stroke-width="${Math.max(1.2, r * 0.28).toFixed(2)}" stroke-linecap="round"/>
                        <circle cx="${(cx + r * 0.28).toFixed(2)}" cy="${(cy - r * 0.26).toFixed(2)}" r="${Math.max(0.8, r * 0.22).toFixed(2)}" fill="#ffffff"/>
                        <circle cx="${(cx - r * 0.18).toFixed(2)}" cy="${(cy + r * 0.24).toFixed(2)}" r="${Math.max(0.45, r * 0.12).toFixed(2)}" fill="rgba(255,255,255,0.75)"/>
                    </g>
                `;
            }

            if (style === 'celestial') {
                const starR = Math.max(1.1, r * 0.34);
                const sx = cx + r * 0.26;
                const sy = cy - r * 0.26;
                const starPath = `M ${sx.toFixed(2)},${(sy - starR).toFixed(2)} L ${(sx + starR * 0.28).toFixed(2)},${(sy - starR * 0.28).toFixed(2)} L ${(sx + starR).toFixed(2)},${sy.toFixed(2)} L ${(sx + starR * 0.28).toFixed(2)},${(sy + starR * 0.28).toFixed(2)} L ${sx.toFixed(2)},${(sy + starR).toFixed(2)} L ${(sx - starR * 0.28).toFixed(2)},${(sy + starR * 0.28).toFixed(2)} L ${(sx - starR).toFixed(2)},${sy.toFixed(2)} L ${(sx - starR * 0.28).toFixed(2)},${(sy - starR * 0.28).toFixed(2)} Z`;
                return `
                    <g class="svg-fish-eye" data-eye-style="celestial">
                        <defs>
                            <radialGradient id="${eid}_cel" cx="42%" cy="42%" r="58%">
                                <stop offset="0%" stop-color="${irisLight}"/>
                                <stop offset="52%" stop-color="${irisBase}"/>
                                <stop offset="100%" stop-color="#1e1b4b"/>
                            </radialGradient>
                        </defs>
                        <circle cx="${cx}" cy="${cy}" r="${(r * 1.24).toFixed(2)}" fill="rgba(49, 46, 129, 0.45)"/>
                        <circle cx="${cx}" cy="${cy}" r="${rStr}" fill="url(#${eid}_cel)" stroke="#e9d5ff" stroke-width="0.7"/>
                        <path d="M ${(cx - r * 0.45).toFixed(2)},${(cy + r * 0.45).toFixed(2)} A ${(r * 0.65).toFixed(2)},${(r * 0.65).toFixed(2)} 0 0,0 ${(cx + r * 0.56).toFixed(2)},${(cy + r * 0.20).toFixed(2)}" fill="none" stroke="#fde68a" stroke-width="${Math.max(0.7, r * 0.14).toFixed(2)}" stroke-linecap="round" opacity="0.88"/>
                        <circle cx="${(cx + r * 0.08).toFixed(2)}" cy="${cy}" r="${(r * 0.40).toFixed(2)}" fill="#09071a"/>
                        <path d="${starPath}" fill="#ffffff"/>
                        <circle cx="${(cx - r * 0.26).toFixed(2)}" cy="${(cy + r * 0.30).toFixed(2)}" r="${Math.max(0.5, r * 0.14).toFixed(2)}" fill="#fde68a" opacity="0.9"/>
                    </g>
                `;
            }

            // natural / cute / fierce
            const isCute = style === 'cute';
            const isFierce = style === 'fierce';
            const irisR = r * (isCute ? 0.78 : 0.72);
            const pupilR = r * (isCute ? 0.46 : (isFierce ? 0.38 : 0.42));
            const ix = cx + r * 0.11;
            const iy = cy;
            const glint1Rx = Math.max(0.85, r * (isCute ? 0.29 : 0.24));
            const glint1Ry = Math.max(0.65, r * (isCute ? 0.23 : 0.18));
            const glint2R = Math.max(0.45, r * (isCute ? 0.14 : 0.11));

            const browCap = isFierce
                ? `<path d="M ${(cx - r * 1.06).toFixed(2)},${(cy - r * 0.32).toFixed(2)} Q ${cx},${(cy - r * 1.18).toFixed(2)} ${(cx + r * 1.06).toFixed(2)},${(cy - r * 0.36).toFixed(2)} Q ${cx},${(cy - r * 0.62).toFixed(2)} ${(cx - r * 1.06).toFixed(2)},${(cy - r * 0.32).toFixed(2)} Z" fill="${browColor}"/>`
                : '';

            return `
                <g class="svg-fish-eye" data-eye-style="${style}">
                    <defs>
                        <radialGradient id="${eid}_scl" cx="42%" cy="35%" r="65%">
                            <stop offset="0%" stop-color="#f8fafc"/>
                            <stop offset="72%" stop-color="#e2e8f0"/>
                            <stop offset="100%" stop-color="#94a3b8"/>
                        </radialGradient>
                        <linearGradient id="${eid}_irs" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stop-color="${irisDark}"/>
                            <stop offset="52%" stop-color="${irisBase}"/>
                            <stop offset="100%" stop-color="${irisLight}"/>
                        </linearGradient>
                    </defs>
                    <circle cx="${cx}" cy="${cy}" r="${socketR}" fill="rgba(10, 18, 34, 0.38)"/>
                    <circle cx="${cx}" cy="${cy}" r="${rStr}" fill="url(#${eid}_scl)" stroke="rgba(15, 23, 42, 0.42)" stroke-width="0.65"/>
                    <circle cx="${ix.toFixed(2)}" cy="${iy.toFixed(2)}" r="${irisR.toFixed(2)}" fill="url(#${eid}_irs)" stroke="${irisDark}" stroke-width="0.5"/>
                    <path d="M ${(ix - irisR * 0.55).toFixed(2)},${(iy + irisR * 0.42).toFixed(2)} A ${(irisR * 0.72).toFixed(2)},${(irisR * 0.72).toFixed(2)} 0 0,0 ${(ix + irisR * 0.58).toFixed(2)},${(iy + irisR * 0.32).toFixed(2)}" fill="none" stroke="rgba(255,255,255,0.52)" stroke-width="${Math.max(0.6, r * 0.14).toFixed(2)}" stroke-linecap="round"/>
                    <circle cx="${(ix + r * 0.04).toFixed(2)}" cy="${iy.toFixed(2)}" r="${pupilR.toFixed(2)}" fill="${pupilColor}"/>
                    <ellipse cx="${(ix + r * 0.22).toFixed(2)}" cy="${(iy - r * 0.28).toFixed(2)}" rx="${glint1Rx.toFixed(2)}" ry="${glint1Ry.toFixed(2)}" transform="rotate(-24 ${(ix + r * 0.22).toFixed(2)} ${(iy - r * 0.28).toFixed(2)})" fill="#ffffff" opacity="0.96"/>
                    <circle cx="${(ix - r * 0.20).toFixed(2)}" cy="${(iy + r * 0.26).toFixed(2)}" r="${glint2R.toFixed(2)}" fill="rgba(255,255,255,0.82)"/>
                    ${browCap}
                </g>
            `;
        },

        svgFinRays(pathsArray, strokeColor = 'rgba(255,255,255,0.45)', opacity = 0.65, width = 1.05) {
            if (!Array.isArray(pathsArray) || pathsArray.length === 0) return '';
            const shadowLines = pathsArray.map(d =>
                `<path d="${d}" fill="none" stroke="rgba(10,18,34,0.22)" stroke-width="${(width * 1.7).toFixed(2)}" stroke-linecap="round" opacity="${(opacity * 0.55).toFixed(2)}"/>`
            ).join('');
            const highlightLines = pathsArray.map(d =>
                `<path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="${width.toFixed(2)}" stroke-linecap="round" opacity="${opacity}"/>`
            ).join('');
            return `<g class="svg-fish-fin-rays">${shadowLines}${highlightLines}</g>`;
        },

        svgScalePatch(rows, opts = null) {
            if (!Array.isArray(rows) || rows.length === 0) return '';
            const o = opts || {};
            const rimColor = o.rimColor || 'rgba(255, 255, 255, 0.38)';
            const shadowColor = o.shadowColor || 'rgba(15, 23, 42, 0.16)';
            const rx = Number.isFinite(o.rx) ? o.rx : 5.2;
            const ry = Number.isFinite(o.ry) ? o.ry : 4.8;
            const rimWidth = Number.isFinite(o.rimWidth) ? o.rimWidth : 1.05;
            const shWidth = Number.isFinite(o.shWidth) ? o.shWidth : 1.25;
            const parts = [];

            for (let r = 0; r < rows.length; r++) {
                const row = rows[r];
                const y = row.y;
                const rowAlpha = Number.isFinite(row.alpha) ? row.alpha : 1;
                const xs = row.xs || [];
                const lRx = Number.isFinite(row.rx) ? row.rx : rx;
                const lRy = Number.isFinite(row.ry) ? row.ry : ry;
                for (let c = 0; c < xs.length; c++) {
                    const x = xs[c];
                    const op = (rowAlpha * (c === 0 || c === xs.length - 1 ? 0.65 : 1)).toFixed(2);
                    parts.push(
                        `<path d="M ${(x + 0.9).toFixed(1)},${(y - lRy * 0.92).toFixed(1)} Q ${(x - lRx * 0.78).toFixed(1)},${(y + 0.3).toFixed(1)} ${(x + 0.9).toFixed(1)},${(y + lRy).toFixed(1)}" fill="none" stroke="${shadowColor}" stroke-width="${shWidth}" stroke-linecap="round" opacity="${op}"/>` +
                        `<path d="M ${x.toFixed(1)},${(y - lRy).toFixed(1)} Q ${(x - lRx).toFixed(1)},${y.toFixed(1)} ${x.toFixed(1)},${(y + lRy).toFixed(1)}" fill="none" stroke="${rimColor}" stroke-width="${rimWidth}" stroke-linecap="round" opacity="${op}"/>`
                    );
                }
            }
            return `<g class="svg-fish-scales">${parts.join('')}</g>`;
        },

        svgShinyOverlay(isSilhouette = false, isShiny = false) {
            if (isSilhouette || !isShiny) return '';
            return `
                <g class="svg-fish-sparkles">
                    <path d="M 30,21 L 32.8,28.2 L 40,31 L 32.8,33.8 L 30,41 L 27.2,33.8 L 20,31 L 27.2,28.2 Z" fill="#fef6d2" opacity="0.94"/>
                    <path d="M 168,17 L 170,22.2 L 175.2,24.2 L 170,26.2 L 168,31.4 L 166,26.2 L 160.8,24.2 L 166,22.2 Z" fill="#fef08a" opacity="0.95"/>
                    <path d="M 114,12 L 115.6,16.4 L 120,18 L 115.6,19.6 L 114,24 L 112.4,19.6 L 108,18 L 112.4,16.4 Z" fill="#ffffff" opacity="0.88"/>
                    <circle cx="56" cy="96" r="2.1" fill="#fbcfe8" opacity="0.88"/>
                    <circle cx="152" cy="93" r="1.8" fill="#bae6fd" opacity="0.88"/>
                    <circle cx="88" cy="18" r="1.3" fill="#fef08a" opacity="0.75"/>
                </g>
            `;
        },

        drawCanvasSoftGlow(ctx, x, y, r, innerColor, midColor = null, outerColor = 'rgba(0,0,0,0)') {
            const safeR = Math.max(1.2, r);
            ctx.save();
            const grad = ctx.createRadialGradient(x, y, safeR * 0.05, x, y, safeR);
            grad.addColorStop(0, innerColor);
            if (midColor) grad.addColorStop(0.45, midColor);
            grad.addColorStop(1, outerColor);
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, safeR, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        },

        drawCanvasFinRays(ctx, rays, strokeColor = 'rgba(255,255,255,0.45)', lineWidth = 0.9) {
            if (!Array.isArray(rays) || rays.length === 0) return;
            ctx.save();
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = Math.max(0.55, lineWidth);
            ctx.lineCap = 'round';
            ctx.beginPath();
            for (let i = 0; i < rays.length; i++) {
                const r = rays[i];
                ctx.moveTo(r[0], r[1]);
                if (r.length >= 6) {
                    ctx.quadraticCurveTo(r[2], r[3], r[4], r[5]);
                } else {
                    ctx.lineTo(r[2], r[3]);
                }
            }
            ctx.stroke();
            ctx.restore();
        },

        buildAsymEnvelope(points, topWidths, botWidths) {
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
                const tw = Math.max(0.4, Array.isArray(topWidths) ? (topWidths[i] ?? 2) : 2);
                const bw = Math.max(0.4, Array.isArray(botWidths) ? (botWidths[i] ?? 2) : 2);
                topPts.push({ x: p.x + nx * tw, y: p.y + ny * tw });
                botPts.push({ x: p.x - nx * bw, y: p.y - ny * bw });
            }
            return { topPts, botPts };
        },

        traceEnvelopePath(ctx, points, topPts, botPts, noseExtend = 3) {
            const n = points.length;
            if (n < 2) return;
            ctx.beginPath();
            ctx.moveTo(topPts[0].x, topPts[0].y);
            for (let i = 1; i < n - 1; i++) {
                const mx = (topPts[i].x + topPts[i + 1].x) * 0.5;
                const my = (topPts[i].y + topPts[i + 1].y) * 0.5;
                ctx.quadraticCurveTo(topPts[i].x, topPts[i].y, mx, my);
            }
            ctx.lineTo(topPts[n - 1].x, topPts[n - 1].y);
            ctx.lineTo(botPts[n - 1].x, botPts[n - 1].y);
            for (let i = n - 2; i > 0; i--) {
                const mx = (botPts[i].x + botPts[i - 1].x) * 0.5;
                const my = (botPts[i].y + botPts[i - 1].y) * 0.5;
                ctx.quadraticCurveTo(botPts[i].x, botPts[i].y, mx, my);
            }
            ctx.lineTo(botPts[0].x, botPts[0].y);
            ctx.quadraticCurveTo(points[0].x + noseExtend, points[0].y, topPts[0].x, topPts[0].y);
            ctx.closePath();
        },

        drawCanvasEye(ctx, x, y, r = 3, irisColor = '#38bdf8', styleOpts = null) {
            const safeR = Math.max(1.8, r);
            const opts = styleOpts || {};
            const style = opts.style || 'natural';
            const irisBase = irisColor || '#38bdf8';
            const irisLight = shadeHex(irisBase, 0.36);
            const irisDark = shadeHex(irisBase, -0.45);
            const pupilColor = opts.pupilColor || '#070b14';
            const browColor = opts.browColor || 'rgba(15, 23, 42, 0.65)';

            ctx.save();

            if (style === 'glow') {
                FishArt.drawCanvasSoftGlow(ctx, x, y, safeR * 1.7, irisLight, irisBase);
                ctx.fillStyle = 'rgba(6, 10, 24, 0.65)';
                ctx.beginPath();
                ctx.arc(x, y, safeR * 1.18, 0, Math.PI * 2);
                ctx.fill();

                const grad = ctx.createRadialGradient(x, y, safeR * 0.1, x, y, safeR);
                grad.addColorStop(0, '#ffffff');
                grad.addColorStop(0.32, irisLight);
                grad.addColorStop(0.8, irisBase);
                grad.addColorStop(1, irisDark);
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(x, y, safeR, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = pupilColor;
                ctx.beginPath();
                ctx.ellipse(x + safeR * 0.08, y, Math.max(0.6, safeR * 0.24), safeR * 0.55, 0, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(x + safeR * 0.32, y - safeR * 0.3, Math.max(0.65, safeR * 0.22), 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
                return;
            }

            if (style === 'celestial') {
                ctx.fillStyle = 'rgba(49, 46, 129, 0.45)';
                ctx.beginPath();
                ctx.arc(x, y, safeR * 1.25, 0, Math.PI * 2);
                ctx.fill();

                const grad = ctx.createRadialGradient(x - safeR * 0.2, y - safeR * 0.2, safeR * 0.1, x, y, safeR);
                grad.addColorStop(0, irisLight);
                grad.addColorStop(0.55, irisBase);
                grad.addColorStop(1, '#1e1b4b');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(x, y, safeR, 0, Math.PI * 2);
                ctx.fill();

                ctx.strokeStyle = '#fde68a';
                ctx.lineWidth = Math.max(0.6, safeR * 0.14);
                ctx.beginPath();
                ctx.arc(x, y, safeR * 0.68, 0.25, Math.PI * 0.85);
                ctx.stroke();

                ctx.fillStyle = '#09071a';
                ctx.beginPath();
                ctx.arc(x + safeR * 0.08, y, safeR * 0.40, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(x + safeR * 0.28, y - safeR * 0.28, Math.max(0.7, safeR * 0.26), 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
                return;
            }

            if (style === 'dragon') {
                ctx.save();
                ctx.translate(x, y);
                ctx.rotate(-0.20);
                ctx.fillStyle = 'rgba(15, 23, 42, 0.42)';
                ctx.beginPath();
                ctx.ellipse(0, 0, safeR * 1.32, safeR * 0.96, 0, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = '#f8fafc';
                ctx.beginPath();
                ctx.ellipse(0, 0, safeR * 1.22, safeR * 0.86, 0, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = irisBase;
                ctx.beginPath();
                ctx.arc(safeR * 0.10, 0, safeR * 0.72, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = pupilColor;
                ctx.beginPath();
                ctx.ellipse(safeR * 0.12, 0, Math.max(0.7, safeR * 0.23), safeR * 0.54, 0, 0, Math.PI * 2);
                ctx.fill();

                ctx.strokeStyle = browColor;
                ctx.lineWidth = Math.max(0.9, safeR * 0.26);
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(-safeR * 1.25, -safeR * 0.22);
                ctx.quadraticCurveTo(0, -safeR * 1.15, safeR * 1.25, -safeR * 0.42);
                ctx.stroke();

                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(safeR * 0.30, -safeR * 0.25, Math.max(0.65, safeR * 0.22), 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
                ctx.restore();
                return;
            }

            // natural / cute / fierce
            const isCute = style === 'cute';
            const isFierce = style === 'fierce';
            ctx.fillStyle = 'rgba(10, 18, 34, 0.38)';
            ctx.beginPath();
            ctx.arc(x, y, safeR * 1.18, 0, Math.PI * 2);
            ctx.fill();

            const sclGrad = ctx.createRadialGradient(x - safeR * 0.2, y - safeR * 0.25, safeR * 0.1, x, y, safeR);
            sclGrad.addColorStop(0, '#f8fafc');
            sclGrad.addColorStop(0.75, '#e2e8f0');
            sclGrad.addColorStop(1, '#94a3b8');
            ctx.fillStyle = sclGrad;
            ctx.beginPath();
            ctx.arc(x, y, safeR, 0, Math.PI * 2);
            ctx.fill();

            const ix = x + safeR * 0.11;
            const irisR = safeR * (isCute ? 0.78 : 0.72);
            const irisGrad = ctx.createLinearGradient(ix, y - irisR, ix, y + irisR);
            irisGrad.addColorStop(0, irisDark);
            irisGrad.addColorStop(0.55, irisBase);
            irisGrad.addColorStop(1, irisLight);
            ctx.fillStyle = irisGrad;
            ctx.beginPath();
            ctx.arc(ix, y, irisR, 0, Math.PI * 2);
            ctx.fill();

            if (safeR >= 2.2) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.48)';
                ctx.lineWidth = Math.max(0.55, safeR * 0.13);
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.arc(ix, y, irisR * 0.72, 0.35, Math.PI * 0.85);
                ctx.stroke();
            }

            ctx.fillStyle = pupilColor;
            ctx.beginPath();
            ctx.arc(ix + safeR * 0.04, y, safeR * (isCute ? 0.46 : (isFierce ? 0.38 : 0.42)), 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(ix + safeR * 0.24, y - safeR * 0.28, Math.max(0.68, safeR * (isCute ? 0.27 : 0.22)), 0, Math.PI * 2);
            ctx.fill();

            if (safeR >= 2.6) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
                ctx.beginPath();
                ctx.arc(ix - safeR * 0.20, y + safeR * 0.26, Math.max(0.45, safeR * 0.12), 0, Math.PI * 2);
                ctx.fill();
            }

            if (isFierce) {
                ctx.fillStyle = browColor;
                ctx.beginPath();
                ctx.moveTo(x - safeR * 1.05, y - safeR * 0.30);
                ctx.quadraticCurveTo(x, y - safeR * 1.16, x + safeR * 1.05, y - safeR * 0.34);
                ctx.quadraticCurveTo(x, y - safeR * 0.60, x - safeR * 1.05, y - safeR * 0.30);
                ctx.closePath();
                ctx.fill();
            }

            ctx.restore();
        },

        drawCanvasShinyHalo(ctx, size, time = 0) {
            const safeSize = Math.max(6, size || 18);
            FishArt.drawCanvasSoftGlow(
                ctx, 0, 0, safeSize * 1.42,
                'rgba(254, 240, 138, 0.30)',
                'rgba(244, 114, 182, 0.10)'
            );

            ctx.save();
            ctx.setLineDash([Math.max(2, safeSize * 0.14), Math.max(2, safeSize * 0.16)]);
            ctx.lineDashOffset = -time * safeSize * 0.35;
            ctx.strokeStyle = 'rgba(254, 249, 195, 0.34)';
            ctx.lineWidth = Math.max(0.8, safeSize * 0.032);
            ctx.beginPath();
            ctx.ellipse(0, 0, safeSize * 1.24, safeSize * 0.78, -0.14, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);

            for (let i = 0; i < 4; i++) {
                const ang = time * 1.45 + i * (Math.PI * 0.5);
                const sx = Math.cos(ang) * safeSize * 1.22;
                const sy = Math.sin(ang) * safeSize * 0.76;
                const pulse = 0.72 + 0.32 * Math.sin(time * 3.4 + i * 1.6);
                const sr = Math.max(2.0, safeSize * (i % 2 === 0 ? 0.15 : 0.115)) * pulse;
                ctx.save();
                ctx.translate(sx, sy);
                ctx.globalAlpha = 0.65 + 0.32 * pulse;
                ctx.fillStyle = i % 2 === 0 ? '#fef6d2' : '#fbcfe8';
                ctx.beginPath();
                ctx.moveTo(0, -sr);
                ctx.quadraticCurveTo(0, 0, sr * 0.75, 0);
                ctx.quadraticCurveTo(0, 0, 0, sr);
                ctx.quadraticCurveTo(0, 0, -sr * 0.75, 0);
                ctx.quadraticCurveTo(0, 0, 0, -sr);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }
            ctx.restore();
        },

        drawCanvasShinySparkles(ctx, size, time = 0) {
            const safeSize = Math.max(6, size || 18);
            const spots = [
                { x: safeSize * 0.48, y: -safeSize * 0.44, phase: 0.4, color: '#ffffff', r: 0.13 },
                { x: -safeSize * 0.52, y: safeSize * 0.38, phase: 2.3, color: '#fef08a', r: 0.11 }
            ];
            ctx.save();
            for (let i = 0; i < spots.length; i++) {
                const sp = spots[i];
                const wave = 0.5 + 0.5 * Math.sin(time * 3.6 + sp.phase);
                const sr = Math.max(1.8, safeSize * sp.r * (0.68 + wave * 0.45));
                const dy = Math.sin(time * 2.1 + sp.phase) * safeSize * 0.04;
                ctx.save();
                ctx.translate(sp.x, sp.y + dy);
                ctx.globalAlpha = 0.42 + wave * 0.54;
                ctx.fillStyle = sp.color;
                ctx.beginPath();
                ctx.moveTo(0, -sr);
                ctx.quadraticCurveTo(0, 0, sr * 0.72, 0);
                ctx.quadraticCurveTo(0, 0, 0, sr);
                ctx.quadraticCurveTo(0, 0, -sr * 0.72, 0);
                ctx.quadraticCurveTo(0, 0, 0, -sr);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }
            ctx.restore();
        },

        buildSpinePoints(headX, tailX, count = 8, bodyBend = 0, wagPhase = 0, waveAmp = 2.5, waveFreq = 0.65) {
            const n = Math.max(3, count);
            const pts = [];
            for (let i = 0; i < n; i++) {
                const t = i / (n - 1);
                const x = headX + (tailX - headX) * t;
                const arch = Math.sin(t * Math.PI) * (0.72 + 0.42 * t) * bodyBend * Math.abs(tailX - headX) * 0.28;
                const env = 0.07 + Math.pow(t, 1.55) * 1.03;
                const travelWave = Math.sin(wagPhase - t * Math.PI * 2 * waveFreq) * waveAmp * env;
                pts.push({ x, y: arch + travelWave });
            }
            return pts;
        },

        drawCanvasSpineRibbon(ctx, points, widths, fillStyle, strokeStyle = null, lineWidth = 1.3) {
            if (!Array.isArray(points) || points.length < 2) return;
            const n = points.length;
            const topPts = [];
            const botPts = [];

            for (let i = 0; i < n; i++) {
                const p = points[i];
                const prev = points[Math.max(0, i - 1)];
                const next = points[Math.min(n - 1, i + 1)];
                const dx = next.x - prev.x;
                const dy = next.y - prev.y;
                const ang = Math.atan2(dy, dx);
                const perp = ang + Math.PI * 0.5;
                const w = Math.max(0.5, Array.isArray(widths) ? (widths[i] ?? 2) : 2);

                topPts.push({ x: p.x + Math.cos(perp) * w, y: p.y + Math.sin(perp) * w });
                botPts.push({ x: p.x - Math.cos(perp) * w, y: p.y - Math.sin(perp) * w });
            }

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(topPts[0].x, topPts[0].y);
            for (let i = 1; i < n - 1; i++) {
                const mx = (topPts[i].x + topPts[i + 1].x) * 0.5;
                const my = (topPts[i].y + topPts[i + 1].y) * 0.5;
                ctx.quadraticCurveTo(topPts[i].x, topPts[i].y, mx, my);
            }
            ctx.lineTo(topPts[n - 1].x, topPts[n - 1].y);
            ctx.lineTo(botPts[n - 1].x, botPts[n - 1].y);
            for (let i = n - 2; i > 0; i--) {
                const mx = (botPts[i].x + botPts[i - 1].x) * 0.5;
                const my = (botPts[i].y + botPts[i - 1].y) * 0.5;
                ctx.quadraticCurveTo(botPts[i].x, botPts[i].y, mx, my);
            }
            ctx.lineTo(botPts[0].x, botPts[0].y);
            const noseExt = Math.max(2, (Array.isArray(widths) ? (widths[0] ?? 2) : 2) * 0.72);
            ctx.quadraticCurveTo(points[0].x + (topPts[0].x - botPts[0].x) * 0.15 + noseExt, points[0].y, topPts[0].x, topPts[0].y);
            ctx.closePath();

            if (fillStyle) {
                ctx.fillStyle = fillStyle;
                ctx.fill();
            }
            if (strokeStyle) {
                ctx.strokeStyle = strokeStyle;
                ctx.lineWidth = lineWidth;
                ctx.stroke();
            }
            ctx.restore();
        },

        drawCanvasScaleArcs(ctx, cx, cy, rx, ry, rows = 3, cols = 4, strokeColor = 'rgba(255,255,255,0.28)') {
            ctx.save();
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 0.95;
            const rScale = Math.max(2.0, Math.min(rx, ry) * 0.25);
            for (let row = 0; row < rows; row++) {
                const ryRatio = rows === 1 ? 0 : (row / (rows - 1) - 0.5) * 1.05;
                const y = cy + ryRatio * ry;
                const stagger = (row % 2) * (rx / Math.max(2, cols));
                for (let col = 0; col < cols; col++) {
                    const rxRatio = cols === 1 ? 0 : (col / (cols - 1) - 0.5) * 1.2;
                    const x = cx + rxRatio * rx + stagger * 0.4;
                    ctx.globalAlpha = (col === 0 || col === cols - 1) ? 0.55 : 0.92;
                    ctx.beginPath();
                    ctx.arc(x, y, rScale, -Math.PI * 0.40, Math.PI * 0.40);
                    ctx.stroke();
                }
            }
            ctx.restore();
        }
    };

    WWF.FishArt = FishArt;

    /**
     * 根据 WWF.FISH_MODELS 渲染高精度分层矢量鱼 SVG
     */
    WWF.renderModelFishSVG = function (fish, isSilhouette = false, isShiny = false) {
        if (!fish || !fish.id) return null;
        const model = WWF.FISH_MODELS && WWF.FISH_MODELS[fish.id];
        if (!model || typeof model.buildSVGContent !== 'function') return null;

        svgUidCounter += 1;
        const uid = `fm_${fish.id}_${svgUidCounter}`;
        const palette = FishArt.getPalette(fish, !!isSilhouette, !!isShiny);
        const motion = FishArt.getMotion(fish);
        const tailDur = (1.25 / Math.max(0.5, (motion.tailFreq || 8.5) / 8.5)).toFixed(2);
        const pecDur = (1.4 / Math.max(0.5, (motion.pectoralFreq || 5.5) / 5.5)).toFixed(2);

        const content = model.buildSVGContent({
            fish,
            isSilhouette: !!isSilhouette,
            isShiny: !!isShiny,
            uid,
            palette,
            motion,
            art: FishArt
        });

        return `
            <svg viewBox="0 0 200 120" class="w-full h-full drop-shadow-md fish-model-svg ${(!isSilhouette && isShiny) ? 'shiny-glow' : ''}" data-fish-id="${fish.id}" data-silhouette="${!!isSilhouette}" data-swim-style="${motion.swimStyle}" style="--tail-origin:${motion.tailPivot};--tail-dur:${tailDur}s;--pec-dur:${pecDur}s;">
                ${content}
            </svg>
        `;
    };

    /**
     * 根据 WWF.FISH_MODELS 渲染关节级 Canvas 2D 动态鱼
     */
    WWF.drawModelCanvasFish = function (ctx, fish, x, y, size, dir = 1, time = 0, isShiny = false, extraOpts = null) {
        if (!ctx || !fish || !fish.id) return false;
        const model = WWF.FISH_MODELS && WWF.FISH_MODELS[fish.id];
        if (!model || typeof model.drawCanvas !== 'function') return false;

        const opts = extraOpts || {};
        const speedRatio = clamp(typeof opts.speedRatio === 'number' ? opts.speedRatio : 1, 0.25, 3.2);
        const bodyBend = clamp(typeof opts.bodyBend === 'number' ? opts.bodyBend : 0, -0.85, 0.85);
        const puffFactor = clamp(typeof opts.puffFactor === 'number' ? opts.puffFactor : 0, 0, 1.2);
        const pitch = clamp(typeof opts.pitch === 'number' ? opts.pitch : 0, -0.75, 0.75);
        const phaseOffset = typeof opts.phaseOffset === 'number' ? opts.phaseOffset : x * 0.04;
        const squashX = clamp(Number.isFinite(opts.squashX) ? opts.squashX : 1, 0.72, 1.32);
        const squashY = clamp(Number.isFinite(opts.squashY) ? opts.squashY : 1, 0.72, 1.32);

        const motion = FishArt.getMotion(fish);
        const palette = FishArt.getPalette(fish, false, !!isShiny);
        const wagPhase = Number.isFinite(opts.wagPhase)
            ? opts.wagPhase
            : time * (motion.tailFreq || 8.5) * (0.72 + speedRatio * 0.42) + phaseOffset;
        const finPhase = Number.isFinite(opts.finPhase)
            ? opts.finPhase
            : time * (motion.pectoralFreq || 5.5) * (0.78 + speedRatio * 0.34) + phaseOffset * 0.7;
        const minDir = fish.id === 'coral_seahorse' ? 0.28 : 0.12;
        const safeDir = dir >= 0 ? Math.max(minDir, dir) : Math.min(-minDir, dir);

        ctx.save();
        ctx.translate(x, y);
        if (pitch !== 0) ctx.rotate(pitch);
        ctx.scale(safeDir * squashX, squashY);

        if (isShiny) {
            FishArt.drawCanvasShinyHalo(ctx, size, time + phaseOffset * 0.35);
        }

        model.drawCanvas(ctx, size, time, {
            fish,
            isShiny: !!isShiny,
            palette,
            motion,
            art: FishArt,
            speedRatio,
            bodyBend,
            puffFactor,
            wagPhase,
            finPhase,
            phaseOffset
        });

        if (isShiny) {
            FishArt.drawCanvasShinySparkles(ctx, size, time + phaseOffset * 0.35);
        }

        ctx.restore();
        return true;
    };

    /**
     * 为捕获展示框 / 图鉴卡片绑定 2.5D 倾斜跟随、摆尾加速与轻戳果冻回弹手感
     */
    WWF.bindFishShowcaseFeel = function (containerEl, fish, opts = {}) {
        if (!containerEl) return;
        if (typeof containerEl._wwfFeelCleanup === 'function') {
            containerEl._wwfFeelCleanup();
            containerEl._wwfFeelCleanup = null;
        }

        const motion = FishArt.getMotion(fish);
        const baseTailDur = 1.25 / Math.max(0.5, (motion.tailFreq || 8.5) / 8.5);
        const tiltAmp = opts.compact ? 11 : 18;
        const shiftAmp = opts.compact ? 4 : 8;

        containerEl.classList.add('fish-showcase-stage');

        let targetRotX = 0;
        let targetRotY = 0;
        let targetShiftX = 0;
        let targetShiftY = 0;
        let curRotX = 0;
        let curRotY = 0;
        let curShiftX = 0;
        let curShiftY = 0;
        let squashX = 1;
        let squashY = 1;
        let squashVelX = 0;
        let squashVelY = 0;
        let energyBoost = 0;
        let puffTimeout = null;
        let rafId = null;
        let lastTs = 0;
        let destroyed = false;

        function ensureLoop() {
            if (rafId !== null || destroyed) return;
            lastTs = performance.now();
            rafId = requestAnimationFrame(tick);
        }

        function tick(now) {
            if (destroyed) {
                rafId = null;
                return;
            }
            const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
            lastTs = now;

            const follow = Math.min(1, dt * 14);
            curRotX += (targetRotX - curRotX) * follow;
            curRotY += (targetRotY - curRotY) * follow;
            curShiftX += (targetShiftX - curShiftX) * follow;
            curShiftY += (targetShiftY - curShiftY) * follow;

            // 二阶弹簧还原果冻拉伸形变
            const k = 240;
            const c = 18;
            squashVelX += ((1 - squashX) * k - squashVelX * c) * dt;
            squashVelY += ((1 - squashY) * k - squashVelY * c) * dt;
            squashX += squashVelX * dt;
            squashY += squashVelY * dt;

            energyBoost = Math.max(0, energyBoost - dt * 1.45);

            const svg = containerEl.querySelector('.fish-model-svg');
            if (svg) {
                svg.style.transform = `translate3d(${curShiftX.toFixed(2)}px, ${curShiftY.toFixed(2)}px, 0) rotateX(${curRotX.toFixed(2)}deg) rotateY(${curRotY.toFixed(2)}deg) scale(${squashX.toFixed(3)}, ${squashY.toFixed(3)})`;
                const boostedDur = baseTailDur / (1 + energyBoost * 1.55);
                svg.style.setProperty('--tail-dur', `${boostedDur.toFixed(2)}s`);
            }

            const settled =
                Math.abs(targetRotX - curRotX) < 0.04 &&
                Math.abs(targetRotY - curRotY) < 0.04 &&
                Math.abs(1 - squashX) < 0.002 &&
                Math.abs(1 - squashY) < 0.002 &&
                Math.abs(squashVelX) < 0.01 &&
                Math.abs(squashVelY) < 0.01 &&
                energyBoost <= 0.01;

            if (settled) {
                rafId = null;
                if (svg && targetRotX === 0 && targetRotY === 0) {
                    svg.style.transform = '';
                }
            } else {
                rafId = requestAnimationFrame(tick);
            }
        }

        function spawnPokeBubbles(clientX, clientY) {
            const rect = containerEl.getBoundingClientRect();
            const originX = typeof clientX === 'number' ? clientX - rect.left : rect.width * 0.55;
            const originY = typeof clientY === 'number' ? clientY - rect.top : rect.height * 0.5;
            const count = opts.compact ? 3 : 5;
            for (let i = 0; i < count; i++) {
                const dot = document.createElement('span');
                dot.className = 'fish-poked-bubble';
                const angle = (-Math.PI * 0.85) + Math.random() * Math.PI * 0.7;
                const dist = (opts.compact ? 18 : 28) + Math.random() * 22;
                const dx = Math.cos(angle) * dist + (Math.random() - 0.5) * 16;
                const dy = Math.sin(angle) * dist - 10;
                const sz = (opts.compact ? 4 : 5) + Math.random() * 4;
                dot.style.left = `${originX}px`;
                dot.style.top = `${originY}px`;
                dot.style.width = `${sz}px`;
                dot.style.height = `${sz}px`;
                dot.style.setProperty('--bx', `${dx.toFixed(1)}px`);
                dot.style.setProperty('--by', `${dy.toFixed(1)}px`);
                if (opts.isShiny) {
                    dot.style.background = i % 2 === 0 ? '#fef08a' : '#f472b6';
                }
                containerEl.appendChild(dot);
                setTimeout(() => {
                    if (dot.parentNode) dot.parentNode.removeChild(dot);
                }, 620);
            }
        }

        const onPointerMove = (e) => {
            if (opts.enableTilt === false) return;
            const rect = containerEl.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            const nx = clamp(((e.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
            const ny = clamp(((e.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
            targetRotY = nx * tiltAmp;
            targetRotX = -ny * (tiltAmp * 0.72);
            targetShiftX = nx * shiftAmp;
            targetShiftY = ny * (shiftAmp * 0.7);
            energyBoost = Math.max(energyBoost, 0.35);
            ensureLoop();
        };

        const onPointerLeave = () => {
            targetRotX = 0;
            targetRotY = 0;
            targetShiftX = 0;
            targetShiftY = 0;
            ensureLoop();
        };

        const onPointerDown = (e) => {
            if (opts.enablePoke === false) return;
            squashX = 1.14;
            squashY = 0.87;
            squashVelX = -0.35;
            squashVelY = 0.35;
            energyBoost = 1.0;

            const svg = containerEl.querySelector('.fish-model-svg');
            if (svg && fish && fish.id === 'emerald_puffer') {
                svg.classList.add('is-puffed');
                if (puffTimeout) clearTimeout(puffTimeout);
                puffTimeout = setTimeout(() => {
                    svg.classList.remove('is-puffed');
                }, 680);
            }

            spawnPokeBubbles(e.clientX, e.clientY);
            if (WWF.Sound && WWF.Sound.playNibble) {
                WWF.Sound.playNibble();
            }
            ensureLoop();
        };

        containerEl.addEventListener('pointermove', onPointerMove);
        containerEl.addEventListener('pointerleave', onPointerLeave);
        containerEl.addEventListener('pointerdown', onPointerDown);

        containerEl._wwfFeelCleanup = () => {
            destroyed = true;
            if (rafId !== null) cancelAnimationFrame(rafId);
            if (puffTimeout) clearTimeout(puffTimeout);
            containerEl.removeEventListener('pointermove', onPointerMove);
            containerEl.removeEventListener('pointerleave', onPointerLeave);
            containerEl.removeEventListener('pointerdown', onPointerDown);
            const svg = containerEl.querySelector('.fish-model-svg');
            if (svg) svg.style.transform = '';
        };
    };

})();
