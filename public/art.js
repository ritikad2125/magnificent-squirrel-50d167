// Paint Militia — procedural art: parallax scenery, terrain, water, avatars, pickups.
const ART = (() => {
  const { WORLD, RECTS, FALLS, COLORS, WEAPONS } = SHARED;
  const TILE = 2400;

  function rng(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function mk(w, h) { const c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h); return c; }
  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function shade(h, amt) {
    const [r, g, b] = hexRgb(h);
    const f = (c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }
  function rgba(h, a) { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; }
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ------------------------------------------------------------ parallax layers
  function mountainLayer(seed, h, res, pal, count, snowFrac) {
    const c = mk(TILE * res, h * res), g = c.getContext('2d');
    g.scale(res, res);
    const R = rng(seed);
    const peaks = [];
    for (let i = 0; i < count; i++) peaks.push({ x: (i + R() * 0.8) * (TILE / count), h: h * (0.45 + R() * 0.5) });
    peaks.sort((a, b) => a.h - b.h);
    for (const pk of peaks) for (const off of [-TILE, 0, TILE]) {
      const px = pk.x + off, top = h - pk.h, wl = pk.h * (1.05 + R() * 0.3), wr = pk.h * (1.1 + R() * 0.3);
      const mid = px + (R() - 0.3) * pk.h * 0.25;
      // lit face
      g.fillStyle = pal.lit;
      g.beginPath(); g.moveTo(px, top); g.lineTo(px - wl, h);
      g.lineTo(mid, h); g.closePath(); g.fill();
      // shadow face
      g.fillStyle = pal.dark;
      g.beginPath(); g.moveTo(px, top); g.lineTo(mid, h); g.lineTo(px + wr, h); g.closePath(); g.fill();
      // ridge detail lines
      g.strokeStyle = pal.line; g.lineWidth = 2;
      for (let k = 0; k < 3; k++) {
        const t0 = 0.25 + R() * 0.5;
        g.beginPath(); g.moveTo(px + (mid - px) * t0 * 0.2, top + pk.h * t0 * 0.6);
        g.lineTo(px + (mid - px) * t0 + (R() - 0.5) * 30, top + pk.h * (t0 + 0.25)); g.stroke();
      }
      if (pk.h > h * snowFrac) {
        const sh = pk.h * (0.22 + R() * 0.1);
        const jag = (a, b, n, side) => {
          const pts = [];
          for (let k = 1; k < n; k++) { const t = k / n; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + (k % 2 ? 7 : -3) * (side ? 1 : 0.8)]); }
          return pts;
        };
        const lp = [px - wl * sh / pk.h, top + sh], cp = [mid * 0.35 + px * 0.65, top + sh * 1.15], rp = [px + wr * sh / pk.h, top + sh];
        g.fillStyle = pal.snow;
        g.beginPath(); g.moveTo(px, top); g.lineTo(...lp);
        for (const q of jag(lp, cp, 4, 1)) g.lineTo(...q);
        g.lineTo(...cp); g.closePath(); g.fill();
        g.fillStyle = pal.snowDark;
        g.beginPath(); g.moveTo(px, top); g.lineTo(...cp);
        for (const q of jag(cp, rp, 4, 0)) g.lineTo(...q);
        g.lineTo(...rp); g.closePath(); g.fill();
      }
    }
    // atmospheric haze toward the base
    const fog = g.createLinearGradient(0, h * 0.35, 0, h);
    fog.addColorStop(0, rgba(pal.haze, 0)); fog.addColorStop(1, rgba(pal.haze, pal.hazeA));
    g.fillStyle = fog; g.fillRect(0, 0, TILE, h);
    return { c, h, res };
  }

  function pine(g, x, base, hgt, col, hi) {
    const w = hgt * 0.42;
    g.fillStyle = shade(col, -0.3); g.fillRect(x - hgt * 0.04, base - hgt * 0.18, hgt * 0.08, hgt * 0.2);
    for (let i = 0; i < 3; i++) {
      const ty = base - hgt * (0.15 + i * 0.26), th = hgt * 0.45, tw = w * (1 - i * 0.24);
      g.fillStyle = col;
      g.beginPath(); g.moveTo(x, ty - th); g.lineTo(x - tw, ty); g.lineTo(x + tw, ty); g.closePath(); g.fill();
      if (hi) {
        g.fillStyle = hi;
        g.beginPath(); g.moveTo(x, ty - th); g.lineTo(x - tw, ty); g.lineTo(x - tw * 0.2, ty); g.closePath(); g.fill();
      }
    }
  }

  function periodicRidge(R, n, amp) {
    const fs = [];
    for (let i = 0; i < n; i++) fs.push({ k: 1 + ((R() * 6) | 0) + i, a: amp * (0.6 + R() * 0.6) / (i + 1), p: R() * Math.PI * 2 });
    return (x) => fs.reduce((s, f) => s + Math.sin((x / TILE) * Math.PI * 2 * f.k + f.p) * f.a, 0);
  }

  function hillLayer(seed, h, res) {
    const c = mk(TILE * res, h * res), g = c.getContext('2d');
    g.scale(res, res);
    const R = rng(seed);
    const ridge = periodicRidge(R, 4, 45);
    const yAt = (x) => h * 0.42 + ridge(x);
    const grad = g.createLinearGradient(0, h * 0.2, 0, h);
    grad.addColorStop(0, '#6aa96f'); grad.addColorStop(0.5, '#3f8161'); grad.addColorStop(1, '#2c5f55');
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= TILE; x += 8) g.lineTo(x, yAt(x));
    g.lineTo(TILE, h); g.closePath(); g.fill();
    // rim light
    g.strokeStyle = 'rgba(255,230,170,0.35)'; g.lineWidth = 3;
    g.beginPath(); for (let x = 0; x <= TILE; x += 8) g.lineTo(x, yAt(x) + 1); g.stroke();
    // winding background river
    const rv = (x) => h * 0.78 + Math.sin((x / TILE) * Math.PI * 4) * 22 + Math.sin((x / TILE) * Math.PI * 10 + 1) * 8;
    g.lineCap = 'round';
    g.strokeStyle = '#7cc4e8'; g.lineWidth = 20;
    g.beginPath(); for (let x = -10; x <= TILE + 10; x += 10) g.lineTo(x, rv(x)); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 3; g.setLineDash([18, 26]);
    g.beginPath(); for (let x = -10; x <= TILE + 10; x += 10) g.lineTo(x, rv(x) - 3); g.stroke();
    g.setLineDash([]);
    // trees on the ridge
    for (let i = 0; i < 90; i++) {
      const x = R() * TILE, y = yAt(x) + 6 + R() * 50;
      pine(g, x, y, 38 + R() * 26, '#2f6a52', 'rgba(170,220,160,0.25)');
      if (x < 60) pine(g, x + TILE, y, 40, '#2f6a52');
      if (x > TILE - 60) pine(g, x - TILE, y, 40, '#2f6a52');
    }
    const fog = g.createLinearGradient(0, 0, 0, h);
    fog.addColorStop(0, 'rgba(255,214,170,0)'); fog.addColorStop(1, 'rgba(255,214,170,0.18)');
    g.fillStyle = fog; g.fillRect(0, 0, TILE, h);
    return { c, h, res };
  }

  function forestLayer(seed, h, res) {
    const c = mk(TILE * res, h * res), g = c.getContext('2d');
    g.scale(res, res);
    const R = rng(seed);
    const ridge = periodicRidge(R, 3, 18);
    const yAt = (x) => h * 0.55 + ridge(x);
    g.fillStyle = '#1f4a3f';
    g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= TILE; x += 10) g.lineTo(x, yAt(x));
    g.lineTo(TILE, h); g.closePath(); g.fill();
    const trees = [];
    for (let i = 0; i < 170; i++) { const x = R() * TILE; trees.push({ x, y: yAt(x) + 10 + R() * 30, s: 70 + R() * 70 }); }
    trees.sort((a, b) => a.y - b.y);
    for (const t of trees) {
      const offs = [0];
      if (t.x < 80) offs.push(TILE);
      if (t.x > TILE - 80) offs.push(-TILE);
      for (const off of offs) pine(g, t.x + off, t.y, t.s, '#1c4338', 'rgba(140,210,150,0.18)');
    }
    return { c, h, res };
  }

  function cloudSprite(seed) {
    const R = rng(seed), w = 360, h = 150, c = mk(w, h), g = c.getContext('2d');
    const puffs = [];
    for (let i = 0; i < 9; i++) puffs.push([60 + R() * 240, 70 + R() * 30, 30 + R() * 38]);
    for (const [x, y, r] of puffs) {
      const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.1, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.7, 'rgba(255,238,230,0.85)'); gr.addColorStop(1, 'rgba(255,210,200,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    return c;
  }

  // ------------------------------------------------------------ terrain
  function buildTerrain() {
    const c = mk(WORLD.w, WORLD.h + 80), g = c.getContext('2d');
    const R = rng(7);
    // soft drop shadows behind floating islands
    for (const r of RECTS) if (r.k === 'float') {
      g.fillStyle = 'rgba(20,30,50,0.18)';
      rr(g, r.x + 10, r.y + 14, r.w, r.h, 20); g.fill();
    }
    for (const r of RECTS) {
      if (r.k === 'pillar') drawPillar(g, r, R); else drawLand(g, r, R);
    }
    return c;
  }

  function drawLand(g, r, R) {
    const isFloat = r.k === 'float';
    // hanging roots / stalactites under floating islands
    if (isFloat) {
      for (let i = 0; i < r.w / 22; i++) {
        const x = r.x + 12 + R() * (r.w - 24), len = 10 + R() * 22;
        g.fillStyle = R() < 0.5 ? '#6b4a36' : '#57402f';
        g.beginPath(); g.moveTo(x - 8, r.y + r.h - 4); g.lineTo(x + 8, r.y + r.h - 4); g.lineTo(x + (R() - 0.5) * 4, r.y + r.h + len); g.closePath(); g.fill();
      }
      g.lineCap = 'round';
      for (let i = 0; i < r.w / 30; i++) {
        const x = r.x + 10 + R() * (r.w - 20), len = 18 + R() * 40;
        g.strokeStyle = '#3f8a3a'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x, r.y + r.h - 6);
        g.quadraticCurveTo(x + (R() - 0.5) * 20, r.y + r.h + len * 0.5, x + (R() - 0.5) * 10, r.y + r.h + len); g.stroke();
        g.fillStyle = '#5dbb4f';
        for (let k = 0; k < 3; k++) { g.beginPath(); g.ellipse(x + (R() - 0.5) * 8, r.y + r.h + len * (0.3 + k * 0.25), 3, 1.8, R() * 3, 0, 7); g.fill(); }
      }
    }
    // rock body
    g.save();
    rr(g, r.x, r.y, r.w, r.h, isFloat ? 16 : 26);
    const body = g.createLinearGradient(0, r.y, 0, r.y + Math.min(r.h, 300));
    body.addColorStop(0, '#b0825b'); body.addColorStop(0.35, '#8a6146'); body.addColorStop(1, '#4a3429');
    g.fillStyle = body; g.fill();
    g.clip();
    // strata
    g.strokeStyle = 'rgba(60,35,25,0.25)'; g.lineWidth = 2;
    for (let y = r.y + 30; y < r.y + r.h; y += 26 + R() * 20) {
      g.beginPath(); g.moveTo(r.x, y);
      for (let x = r.x; x <= r.x + r.w; x += 30) g.lineTo(x, y + Math.sin(x * 0.03 + y) * 4);
      g.stroke();
    }
    // stones
    const n = (r.w * r.h) / 900;
    for (let i = 0; i < n; i++) {
      const x = r.x + R() * r.w, y = r.y + 16 + R() * r.h, s = 4 + R() * 11;
      g.fillStyle = R() < 0.5 ? 'rgba(70,45,32,0.55)' : 'rgba(190,150,110,0.35)';
      g.beginPath(); g.ellipse(x, y, s, s * 0.7, R() * 3, 0, 7); g.fill();
      g.strokeStyle = 'rgba(255,230,190,0.18)'; g.lineWidth = 1.5;
      g.beginPath(); g.ellipse(x, y, s, s * 0.7, 0, Math.PI * 1.1, Math.PI * 1.7); g.stroke();
    }
    // glowing crystals in big landmasses
    if (!isFloat) {
      for (let i = 0; i < 5; i++) {
        const x = r.x + 40 + R() * (r.w - 80), y = r.y + 90 + R() * 180, s = 8 + R() * 8;
        const col = ['#6ef3ff', '#c08bff', '#7dffb0'][(R() * 3) | 0];
        const gl = g.createRadialGradient(x, y, 0, x, y, s * 3);
        gl.addColorStop(0, rgba(col, 0.45)); gl.addColorStop(1, rgba(col, 0));
        g.fillStyle = gl; g.beginPath(); g.arc(x, y, s * 3, 0, 7); g.fill();
        for (let k = 0; k < 3; k++) {
          const a = -Math.PI / 2 + (k - 1) * 0.5, L = s * (1.4 - Math.abs(k - 1) * 0.4);
          g.save(); g.translate(x, y); g.rotate(a + Math.PI / 2);
          g.fillStyle = col; g.beginPath(); g.moveTo(0, -L); g.lineTo(s * 0.35, 0); g.lineTo(0, s * 0.3); g.lineTo(-s * 0.35, 0); g.closePath(); g.fill();
          g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.moveTo(0, -L); g.lineTo(-s * 0.35, 0); g.lineTo(0, 0); g.closePath(); g.fill();
          g.restore();
        }
      }
    }
    // side light / shadow
    const sl = g.createLinearGradient(r.x, 0, r.x + 40, 0);
    sl.addColorStop(0, 'rgba(255,225,170,0.25)'); sl.addColorStop(1, 'rgba(255,225,170,0)');
    g.fillStyle = sl; g.fillRect(r.x, r.y, 40, r.h);
    const sr = g.createLinearGradient(r.x + r.w - 50, 0, r.x + r.w, 0);
    sr.addColorStop(0, 'rgba(20,10,30,0)'); sr.addColorStop(1, 'rgba(20,10,30,0.35)');
    g.fillStyle = sr; g.fillRect(r.x + r.w - 50, r.y, 50, r.h);
    const sb = g.createLinearGradient(0, r.y + r.h - 20, 0, r.y + r.h);
    sb.addColorStop(0, 'rgba(20,10,30,0)'); sb.addColorStop(1, 'rgba(20,10,30,0.35)');
    g.fillStyle = sb; g.fillRect(r.x, r.y + r.h - 20, r.w, 20);
    g.restore();
    grassCap(g, r.x, r.y, r.w, R, !isFloat);
  }

  function grassCap(g, x, y, w, R, lush) {
    // grass slab with drippy lower edge
    const gr = g.createLinearGradient(0, y - 4, 0, y + 18);
    gr.addColorStop(0, '#b5f06a'); gr.addColorStop(0.45, '#6cc644'); gr.addColorStop(1, '#3a8f35');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(x - 5, y + 2); g.quadraticCurveTo(x - 5, y - 4, x + 4, y - 4);
    g.lineTo(x + w - 4, y - 4); g.quadraticCurveTo(x + w + 5, y - 4, x + w + 5, y + 2);
    let cx = x + w + 5;
    while (cx > x - 5) {
      const step = 10 + R() * 14, d = 10 + R() * 9;
      g.quadraticCurveTo(cx - step / 2, y + d + 6, Math.max(x - 5, cx - step), y + 10);
      cx -= step;
    }
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,220,0.35)'; g.fillRect(x + 2, y - 4, w - 4, 2);
    // blades
    g.lineCap = 'round';
    for (let i = 0; i < w / 3.2; i++) {
      const bx = x - 2 + R() * (w + 4), bh = 4 + R() * (lush ? 11 : 7);
      g.strokeStyle = ['#8fe25a', '#6cc644', '#b9f58a', '#4fa83a'][(R() * 4) | 0]; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(bx, y - 2); g.quadraticCurveTo(bx + (R() - 0.5) * 4, y - bh * 0.6, bx + (R() - 0.5) * 6, y - bh); g.stroke();
    }
    // bushes & flowers
    if (lush) for (let i = 0; i < w / 160; i++) {
      const bx = x + 30 + R() * (w - 60), s = 10 + R() * 8;
      for (let k = 0; k < 4; k++) {
        const px = bx + (k - 1.5) * s * 0.7, py = y - s * 0.5 - (k % 2) * s * 0.4;
        const bg = g.createRadialGradient(px - 3, py - 4, 1, px, py, s);
        bg.addColorStop(0, '#9ee07a'); bg.addColorStop(1, '#2f7d32');
        g.fillStyle = bg; g.beginPath(); g.arc(px, py, s * 0.75, 0, 7); g.fill();
      }
    }
    for (let i = 0; i < w / 45; i++) {
      const fx = x + 6 + R() * (w - 12), fy = y - 5 - R() * 5, col = ['#fff', '#ffd23f', '#ff8fab', '#b8c0ff'][(R() * 4) | 0];
      g.strokeStyle = '#4fa83a'; g.lineWidth = 1; g.beginPath(); g.moveTo(fx, y); g.lineTo(fx, fy); g.stroke();
      g.fillStyle = col;
      for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; g.beginPath(); g.arc(fx + Math.cos(a) * 2.2, fy + Math.sin(a) * 2.2, 1.7, 0, 7); g.fill(); }
      g.fillStyle = '#ffb703'; g.beginPath(); g.arc(fx, fy, 1.3, 0, 7); g.fill();
    }
  }

  function drawPillar(g, r, R) {
    g.save();
    rr(g, r.x, r.y, r.w, r.h, 6);
    const gr = g.createLinearGradient(r.x, 0, r.x + r.w, 0);
    gr.addColorStop(0, '#c3c9d1'); gr.addColorStop(0.5, '#98a1ab'); gr.addColorStop(1, '#5d6570');
    g.fillStyle = gr; g.fill(); g.clip();
    g.strokeStyle = 'rgba(40,45,55,0.45)'; g.lineWidth = 2;
    for (let y = r.y + 18, row = 0; y < r.y + r.h; y += 18, row++) {
      g.beginPath(); g.moveTo(r.x, y); g.lineTo(r.x + r.w, y); g.stroke();
      const off = row % 2 ? r.w / 2 : r.w / 4;
      g.beginPath(); g.moveTo(r.x + off, y); g.lineTo(r.x + off, y + 18); g.stroke();
    }
    g.fillStyle = 'rgba(80,160,70,0.5)';
    for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(r.x + R() * r.w, r.y + R() * r.h, 3 + R() * 4, 0, 7); g.fill(); }
    g.restore();
    grassCap(g, r.x, r.y, r.w, R, false);
  }

  // paint splats stick to terrain only (source-atop)
  function splatDecal(tc, x, y, color, size) {
    const g = tc.getContext('2d');
    g.save(); g.globalCompositeOperation = 'source-atop';
    g.fillStyle = rgba(color, 0.85);
    const s = 7 * size;
    g.beginPath(); g.arc(x, y, s, 0, 7); g.fill();
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * 7, d = s * (0.8 + Math.random() * 1.2), r = s * (0.2 + Math.random() * 0.35);
      g.beginPath(); g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r, 0, 7); g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.beginPath(); g.arc(x - s * 0.3, y - s * 0.3, s * 0.35, 0, 7); g.fill();
    g.restore();
  }

  // ------------------------------------------------------------ scene
  let layers = null, clouds = null, terrain = null;
  function init() {
    layers = [
      { ...mountainLayer(11, 560, 0.5, { lit: '#a9b3ea', dark: '#7b84c4', line: 'rgba(90,95,160,0.35)', snow: '#ffffff', snowDark: '#cdd6f7', haze: '#ffcfae', hazeA: 0.75 }, 9, 0.62), f: 0.1, base: 1270, fill: '#f2c8ae' },
      { ...mountainLayer(23, 420, 0.5, { lit: '#7c96c9', dark: '#56699e', line: 'rgba(40,55,100,0.3)', snow: '#eef3ff', snowDark: '#b8c5ea', haze: '#f5c7a6', hazeA: 0.55 }, 11, 0.72), f: 0.22, base: 1320, fill: '#c9b5aa' },
      { ...hillLayer(5, 360, 0.75), f: 0.42, base: 1370, fill: '#2c5f55' },
      { ...forestLayer(9, 260, 0.75), f: 0.62, base: 1440, fill: '#1f4a3f' },
    ];
    clouds = [1, 2, 3, 4, 5].map(cloudSprite);
    terrain = buildTerrain();
  }
  function resetDecals() { terrain = buildTerrain(); }

  const CLOUDS = Array.from({ length: 9 }, (_, i) => ({ x: i * 420 + (i % 3) * 90, y: 520 + ((i * 137) % 340), s: 0.6 + ((i * 53) % 50) / 60, sp: 6 + (i % 4) * 4, k: i % 5 }));

  // screen position of a world y for a layer with parallax f
  const ly = (base, f, cam) => cam.sh / 2 + ((base - cam.y) * f + (base - 1000) * (1 - f)) * cam.s;

  function drawBackground(ctx, cam, t) {
    const { sw, sh, s } = cam;
    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, sh);
    const hy = ly(1250, 0.1, cam) / sh;
    sky.addColorStop(0, '#2a4a8f');
    sky.addColorStop(Math.max(0.01, Math.min(0.9, hy * 0.45)), '#5b7fd1');
    sky.addColorStop(Math.max(0.02, Math.min(0.95, hy * 0.8)), '#f7a8a0');
    sky.addColorStop(Math.max(0.03, Math.min(1, hy)), '#ffd6a0');
    sky.addColorStop(1, '#ffe2b8');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, sw, sh);

    // sun + glow
    const sx = sw / 2 + (1900 - cam.x) * 0.04 * s, sy = ly(760, 0.05, cam);
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 380 * s);
    glow.addColorStop(0, 'rgba(255,245,210,0.95)'); glow.addColorStop(0.12, 'rgba(255,220,150,0.7)');
    glow.addColorStop(0.4, 'rgba(255,170,120,0.2)'); glow.addColorStop(1, 'rgba(255,160,120,0)');
    ctx.fillStyle = glow; ctx.fillRect(sx - 380 * s, sy - 380 * s, 760 * s, 760 * s);
    ctx.fillStyle = '#fffbea'; ctx.beginPath(); ctx.arc(sx, sy, 46 * s, 0, 7); ctx.fill();
    // god rays
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.translate(sx, sy);
    for (let i = 0; i < 7; i++) {
      const a = t * 0.02 + i * 0.9, L = Math.max(sw, sh) * 1.4;
      ctx.rotate(0.9);
      ctx.fillStyle = `rgba(255,230,180,${0.035 + 0.02 * Math.sin(t * 0.5 + i)})`;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(L, -L * 0.05); ctx.lineTo(L, L * 0.07 + Math.sin(a) * 20); ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // clouds
    for (const c of CLOUDS) {
      const f = 0.08, span = 4200;
      let x = ((c.x + t * c.sp - cam.x * f) % span + span) % span - 600;
      const img = clouds[c.k], w = img.width * c.s * s * 1.2, h = img.height * c.s * s * 1.2;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(img, sw / 2 + (x - 1500) * s, ly(c.y, 0.08, cam) - h / 2, w, h);
    }
    ctx.globalAlpha = 1;

    // birds
    ctx.strokeStyle = 'rgba(60,50,80,0.55)'; ctx.lineWidth = Math.max(1, 1.6 * s);
    for (let i = 0; i < 5; i++) {
      const bx = ((t * 40 + i * 70 + 200) % 3600) - 300, by = 720 + Math.sin(t + i) * 12 + (i % 2) * 22;
      const X = sw / 2 + (bx - 1500 - cam.x * 0.15) * s * 0.9, Y = ly(by, 0.12, cam), wg = Math.sin(t * 8 + i) * 4 * s;
      ctx.beginPath(); ctx.moveTo(X - 8 * s, Y - wg); ctx.quadraticCurveTo(X - 3 * s, Y - 4 * s, X, Y); ctx.quadraticCurveTo(X + 3 * s, Y - 4 * s, X + 8 * s, Y - wg); ctx.stroke();
    }

    // parallax layers
    for (const L of layers) {
      const tw = TILE * s, th = L.h * s;
      const bottom = ly(L.base, L.f, cam);
      const top = bottom - th;
      if (top > sh) continue;
      const shift = sw / 2 - cam.x * L.f * s;
      let start = ((shift % tw) + tw) % tw - tw;
      for (let x = start; x < sw; x += tw) ctx.drawImage(L.c, x, top, tw + 1, th);
      if (bottom < sh) { ctx.fillStyle = L.fill; ctx.fillRect(0, bottom - 1, sw, sh - bottom + 1); }
    }
  }

  function drawTerrain(ctx, cam) {
    const vw = cam.sw / cam.s, vh = cam.sh / cam.s;
    let x0 = cam.x - vw / 2, y0 = cam.y - vh / 2, x1 = x0 + vw, y1 = y0 + vh;
    const cx0 = Math.max(0, x0), cy0 = Math.max(0, y0), cx1 = Math.min(terrain.width, x1), cy1 = Math.min(terrain.height, y1);
    if (cx1 <= cx0 || cy1 <= cy0) return;
    ctx.drawImage(terrain, cx0, cy0, cx1 - cx0, cy1 - cy0, (cx0 - x0) * cam.s, (cy0 - y0) * cam.s, (cx1 - cx0) * cam.s, (cy1 - cy0) * cam.s);
  }

  // world-space (ctx already transformed)
  function drawFalls(ctx, t) {
    for (const f of FALLS) {
      const h = WORLD.water - f.top;
      const gr = ctx.createLinearGradient(f.x, 0, f.x + f.w, 0);
      gr.addColorStop(0, 'rgba(160,220,255,0.55)'); gr.addColorStop(0.5, 'rgba(230,248,255,0.85)'); gr.addColorStop(1, 'rgba(140,205,245,0.55)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.moveTo(f.x, f.top); ctx.lineTo(f.x + f.w, f.top);
      ctx.lineTo(f.x + f.w + 10, WORLD.water); ctx.lineTo(f.x - 10, WORLD.water); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const lx = f.x + 4 + (i / 5) * (f.w - 8);
        const off = (t * 420 + i * 57) % 80;
        ctx.setLineDash([22, 58]); ctx.lineDashOffset = -off;
        ctx.beginPath(); ctx.moveTo(lx, f.top); ctx.lineTo(lx + (i - 2.5) * 3, WORLD.water); ctx.stroke();
      }
      ctx.setLineDash([]);
      // mist
      for (let i = 0; i < 5; i++) {
        const a = t * 2 + i * 1.3, r = 18 + Math.sin(a) * 6;
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath(); ctx.arc(f.x + f.w / 2 + Math.cos(a * 0.7 + i) * 26, WORLD.water - 6 + Math.sin(a) * 4, r, 0, 7); ctx.fill();
      }
    }
  }

  function drawRiver(ctx, cam, t) {
    const vw = cam.sw / cam.s, x0 = cam.x - vw / 2 - 20, x1 = x0 + vw + 40;
    const yBottom = cam.y + cam.sh / cam.s / 2 + 20;
    if (WORLD.water - 20 > yBottom) return;
    const wy = (x) => WORLD.water + Math.sin(x * 0.018 + t * 2.1) * 4 + Math.sin(x * 0.006 - t * 1.2) * 3;
    const gr = ctx.createLinearGradient(0, WORLD.water - 8, 0, WORLD.water + 160);
    gr.addColorStop(0, 'rgba(92,200,230,0.92)'); gr.addColorStop(0.3, 'rgba(34,122,170,0.95)'); gr.addColorStop(1, 'rgba(12,50,90,0.98)');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.moveTo(x0, yBottom + 400);
    for (let x = x0; x <= x1; x += 16) ctx.lineTo(x, wy(x));
    ctx.lineTo(x1, yBottom + 400); ctx.closePath(); ctx.fill();
    // surface highlight
    ctx.strokeStyle = 'rgba(220,250,255,0.9)'; ctx.lineWidth = 3;
    ctx.beginPath(); for (let x = x0; x <= x1; x += 16) ctx.lineTo(x, wy(x)); ctx.stroke();
    // shimmering glints
    ctx.fillStyle = 'rgba(255,245,215,0.7)';
    for (let i = 0; i < 40; i++) {
      const gx = Math.floor(x0 / 90) * 90 + i * 90 + ((i * 37) % 60);
      const gy = WORLD.water + 14 + ((i * 53) % 70);
      const a = Math.sin(t * 3 + i * 1.7);
      if (a < 0.2) continue;
      ctx.globalAlpha = a * 0.7;
      ctx.fillRect(gx + Math.sin(t + i) * 10, gy, 18 + (i % 3) * 8, 2);
    }
    ctx.globalAlpha = 1;
    // foam where land meets water
    for (const r of RECTS) {
      if (r.k !== 'land') continue;
      for (const ex of [r.x, r.x + r.w]) {
        if (ex <= 0 || ex >= WORLD.w) continue;
        for (let k = 0; k < 4; k++) {
          const a = t * 3 + k * 1.6 + ex;
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          ctx.beginPath(); ctx.ellipse(ex + (ex === r.x ? -1 : 1) * (6 + k * 7), WORLD.water + 2 + Math.sin(a) * 2, 9 - k * 1.5, 3, 0, 0, 7); ctx.fill();
        }
      }
    }
  }

  function drawVignette(ctx, sw, sh) {
    const v = ctx.createRadialGradient(sw / 2, sh / 2, Math.min(sw, sh) * 0.45, sw / 2, sh / 2, Math.max(sw, sh) * 0.8);
    v.addColorStop(0, 'rgba(10,5,30,0)'); v.addColorStop(1, 'rgba(10,5,30,0.38)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, sw, sh);
  }

  // ------------------------------------------------------------ avatars
  const FUR = { fox: '#ff8c42', panda: '#f5f5f5', cat: '#9aa5b1', frog: '#5cc85c', robot: '#c7d0da', bear: '#a0673f', bunny: '#fbf5f7', penguin: '#24304f' };

  function eye(ctx, x, y, r, lx, ly, blink) {
    if (blink) { ctx.strokeStyle = '#1b1b2f'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(x - r, y); ctx.quadraticCurveTo(x, y + r * 0.6, x + r, y); ctx.stroke(); return; }
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.fillStyle = '#1b1b2f'; ctx.beginPath(); ctx.arc(x + lx * r * 0.4, y + ly * r * 0.4, r * 0.58, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + lx * r * 0.4 - r * 0.2, y + ly * r * 0.4 - r * 0.25, r * 0.2, 0, 7); ctx.fill();
  }

  function headBase(ctx, col, r, sx = 1, sy = 1) {
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.45, r * 0.1, 0, 0, r * 1.1);
    g.addColorStop(0, shade(col, 0.35)); g.addColorStop(0.6, col); g.addColorStop(1, shade(col, -0.22));
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, r * sx, r * sy, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(20,15,40,0.45)'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  function drawHead(ctx, kind, color, lx, ly, blink) {
    const r = 16;
    const tri = (a, b, c, fill) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...c); ctx.closePath(); ctx.fill(); };
    switch (kind) {
      case 'fox':
        tri([-14, -5], [-11, -25], [-1, -13], '#ff8c42'); tri([2, -13], [11, -25], [14, -5], '#e0702c');
        tri([-11, -8], [-10, -20], [-4, -13], '#5a2d0c'); tri([5, -13], [10.5, -20], [11.5, -8], '#5a2d0c');
        headBase(ctx, FUR.fox, r);
        ctx.fillStyle = '#fff4ea'; ctx.beginPath(); ctx.ellipse(5, 7, 11, 7, 0, 0, 7); ctx.fill();
        eye(ctx, -2, -2, 4.2, lx, ly, blink); eye(ctx, 9, -2, 4.2, lx, ly, blink);
        ctx.fillStyle = '#1b1b2f'; ctx.beginPath(); ctx.ellipse(13, 5, 2.8, 2, 0, 0, 7); ctx.fill();
        break;
      case 'panda':
        ctx.fillStyle = '#1e1e28'; ctx.beginPath(); ctx.arc(-11, -12, 6.5, 0, 7); ctx.arc(11, -12, 6.5, 0, 7); ctx.fill();
        headBase(ctx, FUR.panda, r);
        ctx.fillStyle = '#1e1e28';
        ctx.beginPath(); ctx.ellipse(-3, -1, 5.5, 7, -0.4, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.ellipse(9, -1, 5.5, 7, 0.4, 0, 7); ctx.fill();
        eye(ctx, -3, -2, 3.3, lx, ly, blink); eye(ctx, 9, -2, 3.3, lx, ly, blink);
        ctx.fillStyle = '#1e1e28'; ctx.beginPath(); ctx.ellipse(4, 7, 3, 2.2, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = '#1e1e28'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(4, 9, 3, 0.3, 2.8); ctx.stroke();
        break;
      case 'cat':
        tri([-15, -4], [-12, -24], [-2, -14], FUR.cat); tri([2, -14], [12, -24], [15, -4], shade(FUR.cat, -0.1));
        tri([-12, -8], [-11, -19], [-5, -13], '#ffb3c6'); tri([5, -13], [11, -19], [12, -8], '#ffb3c6');
        headBase(ctx, FUR.cat, r);
        ctx.strokeStyle = 'rgba(60,70,85,0.6)'; ctx.lineWidth = 2;
        for (const x of [-3, 2, 7]) { ctx.beginPath(); ctx.moveTo(x, -15); ctx.lineTo(x, -10); ctx.stroke(); }
        eye(ctx, -2, -1, 4.2, lx, ly, blink); eye(ctx, 9, -1, 4.2, lx, ly, blink);
        tri([2.5, 5], [6.5, 5], [4.5, 7.5], '#ff7aa2');
        ctx.strokeStyle = 'rgba(40,40,50,0.7)'; ctx.lineWidth = 0.9;
        for (const d of [-1, 1]) { ctx.beginPath(); ctx.moveTo(9, 7); ctx.lineTo(20, 5 + d * 3); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, 7); ctx.lineTo(-11, 5 + d * 3); ctx.stroke(); }
        break;
      case 'frog':
        headBase(ctx, FUR.frog, r, 1.12, 0.9);
        ctx.fillStyle = FUR.frog; ctx.beginPath(); ctx.arc(-6, -13, 7.5, 0, 7); ctx.arc(8, -13, 7.5, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(20,15,40,0.45)'; ctx.lineWidth = 1.5; ctx.stroke();
        eye(ctx, -6, -13, 5.5, lx, ly, blink); eye(ctx, 8, -13, 5.5, lx, ly, blink);
        ctx.strokeStyle = '#1f5a28'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(2, 0, 10, 0.35, 2.8); ctx.stroke();
        ctx.fillStyle = 'rgba(255,120,150,0.55)'; ctx.beginPath(); ctx.arc(-10, 3, 3, 0, 7); ctx.arc(14, 3, 3, 0, 7); ctx.fill();
        break;
      case 'robot': {
        ctx.strokeStyle = '#8a95a3'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(0, -24); ctx.stroke();
        const bulb = ctx.createRadialGradient(0, -26, 0, 0, -26, 8);
        bulb.addColorStop(0, '#fff'); bulb.addColorStop(0.3, color); bulb.addColorStop(1, rgba(color, 0));
        ctx.fillStyle = bulb; ctx.beginPath(); ctx.arc(0, -26, 8, 0, 7); ctx.fill();
        const g = ctx.createLinearGradient(0, -16, 0, 16);
        g.addColorStop(0, '#eef2f6'); g.addColorStop(1, '#8793a1');
        ctx.fillStyle = g; rr(ctx, -16, -15, 32, 30, 8); ctx.fill();
        ctx.strokeStyle = 'rgba(20,15,40,0.45)'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#16213a'; rr(ctx, -11, -8, 25, 13, 5); ctx.fill();
        ctx.fillStyle = blink ? '#1f5f7a' : '#5ff3ff';
        const ex = lx * 2, ey = ly * 1.5;
        rr(ctx, -6 + ex, -4 + ey, 6, blink ? 2 : 5, 1.5); ctx.fill(); rr(ctx, 4 + ex, -4 + ey, 6, blink ? 2 : 5, 1.5); ctx.fill();
        ctx.fillStyle = '#6c7784'; for (const x of [-13, 13]) { ctx.beginPath(); ctx.arc(x, 9, 1.6, 0, 7); ctx.fill(); }
        ctx.fillStyle = '#16213a'; for (let i = 0; i < 4; i++) ctx.fillRect(-4 + i * 3.5, 9, 2, 3);
        break;
      }
      case 'bear':
        ctx.fillStyle = FUR.bear; ctx.beginPath(); ctx.arc(-11, -12, 6.5, 0, 7); ctx.arc(11, -12, 6.5, 0, 7); ctx.fill();
        ctx.fillStyle = '#e0b08a'; ctx.beginPath(); ctx.arc(-11, -12, 3.5, 0, 7); ctx.arc(11, -12, 3.5, 0, 7); ctx.fill();
        headBase(ctx, FUR.bear, r);
        ctx.fillStyle = '#e8c09b'; ctx.beginPath(); ctx.ellipse(5, 7, 8, 6, 0, 0, 7); ctx.fill();
        eye(ctx, -2, -2, 3.8, lx, ly, blink); eye(ctx, 9, -2, 3.8, lx, ly, blink);
        ctx.fillStyle = '#2b1a12'; ctx.beginPath(); ctx.ellipse(6, 4.5, 3.2, 2.3, 0, 0, 7); ctx.fill();
        break;
      case 'bunny':
        for (const [x, a] of [[-6, -0.15], [6, 0.2]]) {
          ctx.save(); ctx.translate(x, -14); ctx.rotate(a);
          ctx.fillStyle = FUR.bunny; ctx.beginPath(); ctx.ellipse(0, -11, 5.5, 13, 0, 0, 7); ctx.fill();
          ctx.strokeStyle = 'rgba(20,15,40,0.35)'; ctx.lineWidth = 1.2; ctx.stroke();
          ctx.fillStyle = '#ffb3c6'; ctx.beginPath(); ctx.ellipse(0, -11, 2.6, 9, 0, 0, 7); ctx.fill();
          ctx.restore();
        }
        headBase(ctx, FUR.bunny, r);
        eye(ctx, -2, -1, 4.3, lx, ly, blink); eye(ctx, 9, -1, 4.3, lx, ly, blink);
        ctx.fillStyle = '#ff7aa2'; ctx.beginPath(); ctx.ellipse(5, 5, 2.5, 1.8, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.8;
        ctx.fillRect(3.2, 7, 3.6, 3.5); ctx.strokeRect(3.2, 7, 3.6, 3.5);
        ctx.fillStyle = 'rgba(255,120,150,0.45)'; ctx.beginPath(); ctx.arc(-9, 4, 3, 0, 7); ctx.arc(14, 4, 3, 0, 7); ctx.fill();
        break;
      case 'penguin':
        headBase(ctx, FUR.penguin, r);
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(-1, 0, 7.5, 0, 7); ctx.arc(9, 0, 7.5, 0, 7); ctx.ellipse(4, 7, 11, 7, 0, 0, 7); ctx.fill();
        eye(ctx, -1, -1, 3.8, lx, ly, blink); eye(ctx, 9, -1, 3.8, lx, ly, blink);
        ctx.fillStyle = '#ff9f1c'; ctx.beginPath(); ctx.moveTo(1, 5); ctx.lineTo(8, 4); ctx.lineTo(17, 7); ctx.lineTo(8, 10); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,120,150,0.5)'; ctx.beginPath(); ctx.arc(-7, 6, 2.5, 0, 7); ctx.fill();
        break;
    }
  }

  function drawGun(ctx, wi, color) {
    const metal = '#3b3f4a', dark = '#23262e';
    switch (WEAPONS[wi].key) {
      case 'pistol':
        ctx.fillStyle = metal; rr(ctx, 6, -4, 16, 7, 2); ctx.fill();
        ctx.fillStyle = color; ctx.fillRect(9, -3, 10, 2.5);
        ctx.fillStyle = dark; ctx.fillRect(7, 1, 5, 8);
        break;
      case 'rifle':
        ctx.fillStyle = dark; rr(ctx, -2, -3, 10, 7, 2); ctx.fill();
        ctx.fillStyle = metal; rr(ctx, 6, -5, 26, 8, 2); ctx.fill();
        ctx.fillStyle = color; ctx.fillRect(10, -4, 16, 3);
        ctx.fillStyle = dark; ctx.fillRect(30, -3, 8, 3); ctx.fillRect(15, 2, 5, 9);
        break;
      case 'shotgun':
        ctx.fillStyle = '#6b4a36'; rr(ctx, -2, -3, 12, 8, 3); ctx.fill();
        ctx.fillStyle = metal; rr(ctx, 8, -6, 24, 11, 3); ctx.fill();
        ctx.fillStyle = color; ctx.fillRect(12, -5, 14, 4);
        ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(32, -3, 2.5, 0, 7); ctx.arc(32, 2, 2.5, 0, 7); ctx.fill();
        break;
      case 'sniper':
        ctx.fillStyle = dark; rr(ctx, -4, -3, 12, 7, 2); ctx.fill();
        ctx.fillStyle = metal; rr(ctx, 6, -3, 40, 5, 2); ctx.fill();
        ctx.fillStyle = color; ctx.fillRect(10, -2, 12, 3);
        ctx.fillStyle = '#16213a'; rr(ctx, 12, -10, 16, 5, 2); ctx.fill();
        ctx.fillStyle = '#5ff3ff'; ctx.beginPath(); ctx.arc(28, -7.5, 2, 0, 7); ctx.fill();
        break;
      case 'launcher': {
        const g = ctx.createLinearGradient(0, -7, 0, 7);
        g.addColorStop(0, shade(color, 0.3)); g.addColorStop(1, shade(color, -0.35));
        ctx.fillStyle = g; rr(ctx, -2, -7, 34, 13, 6); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(6, -7, 3, 13); ctx.fillRect(20, -7, 3, 13);
        ctx.fillStyle = dark; ctx.fillRect(8, 5, 5, 7);
        break;
      }
    }
  }
  const GUN_LEN = [22, 38, 34, 46, 32];

  function drawAvatar(ctx, o) {
    // o: {x,y,avatar,color,aim,weapon,vx,ground,jet,t,id,alpha,scale}
    const color = COLORS[o.color] || o.color;
    const face = Math.cos(o.aim) >= 0 ? 1 : -1;
    const la = face === 1 ? o.aim : Math.PI - o.aim;
    const lx = Math.cos(la), lyy = Math.sin(la);
    const t = o.t;
    const moving = o.ground && Math.abs(o.vx) > 30;
    const ph = moving ? t * 16 * Math.sign(o.vx) * face : 0;
    const bob = moving ? Math.abs(Math.sin(ph)) * -2 : o.ground ? Math.sin(t * 3 + o.id) * 0.8 : 0;
    const blink = ((t + o.id * 1.7) % 3.6) < 0.12;
    const fur = o.avatar === 'robot' ? '#c7d0da' : FUR[o.avatar] || '#ddd';

    ctx.save();
    ctx.translate(o.x, o.y);
    if (o.scale) ctx.scale(o.scale, o.scale);
    if (o.alpha != null) ctx.globalAlpha = o.alpha;
    // ground shadow
    if (o.ground) { ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(0, 29, 16, 3.5, 0, 0, 7); ctx.fill(); }
    ctx.scale(face, 1);
    ctx.translate(0, bob);

    const leg = (sx, a, back) => {
      ctx.save(); ctx.translate(sx, 15); ctx.rotate(a);
      ctx.strokeStyle = back ? '#1f2033' : '#2b2d42'; ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 9); ctx.stroke();
      ctx.fillStyle = back ? '#141420' : '#1d1d2b'; ctx.beginPath(); ctx.ellipse(2.5, 11.5, 5.5, 3.2, 0, 0, 7); ctx.fill();
      ctx.restore();
    };
    const swing = moving ? Math.sin(ph) * 0.7 : o.ground ? 0 : 0.35;
    leg(-3, o.ground ? -swing : 0.5, true);

    // jetpack
    const jg = ctx.createLinearGradient(-19, 0, -7, 0);
    jg.addColorStop(0, '#8a939e'); jg.addColorStop(0.5, '#e4e8ee'); jg.addColorStop(1, '#9aa3ae');
    ctx.fillStyle = jg; rr(ctx, -20, -3, 12, 20, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(20,15,40,0.4)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = color; ctx.fillRect(-20, 3, 12, 3);
    ctx.fillStyle = '#4b525c'; ctx.fillRect(-18, 17, 3.5, 3); ctx.fillRect(-12.5, 17, 3.5, 3);
    if (o.jet) {
      for (const nx of [-16.2, -10.7]) {
        const L = 16 + Math.random() * 12;
        const fg = ctx.createLinearGradient(0, 20, 0, 20 + L);
        fg.addColorStop(0, '#fff8d0'); fg.addColorStop(0.3, '#ffd23f'); fg.addColorStop(0.7, '#ff7b00'); fg.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = fg; ctx.beginPath(); ctx.moveTo(nx - 3, 20); ctx.quadraticCurveTo(nx, 20 + L * 1.1, nx + 3, 20); ctx.closePath(); ctx.fill();
      }
    }

    // torso
    const tg = ctx.createLinearGradient(0, -3, 0, 17);
    tg.addColorStop(0, shade(color, 0.2)); tg.addColorStop(1, shade(color, -0.3));
    ctx.fillStyle = tg; rr(ctx, -11, -3, 22, 20, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(20,15,40,0.4)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = '#3a2e2a'; ctx.fillRect(-11, 11, 22, 3.5);
    ctx.fillStyle = '#ffd23f'; ctx.fillRect(-1.5, 10.8, 4, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.beginPath(); ctx.ellipse(-4, 1.5, 4, 2.2, -0.4, 0, 7); ctx.fill();

    leg(3, o.ground ? swing : 0.25, false);

    // head
    ctx.save(); ctx.translate(1, -14);
    ctx.rotate(Math.max(-0.25, Math.min(0.25, la * 0.25)));
    drawHead(ctx, o.avatar, color, lx, lyy, blink);
    ctx.restore();

    // arm + gun
    ctx.save(); ctx.translate(1, 4); ctx.rotate(la);
    drawGun(ctx, o.weapon || 0, color);
    ctx.strokeStyle = shade(color, -0.1); ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(8, 1); ctx.stroke();
    ctx.fillStyle = fur; ctx.beginPath(); ctx.arc(9, 1.5, 3.8, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(20,15,40,0.4)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();

    ctx.restore();
  }

  function muzzle(o) {
    const L = GUN_LEN[o.weapon || 0];
    return [o.x + Math.cos(o.aim) * L, o.y - 4 + 4 + Math.sin(o.aim) * L];
  }

  // ------------------------------------------------------------ pickups & bullets
  const glowCache = {};
  function glow(color) {
    if (glowCache[color]) return glowCache[color];
    const c = mk(64, 64), g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, rgba(color, 0.95)); gr.addColorStop(0.6, rgba(color, 0.3)); gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return (glowCache[color] = c);
  }

  function drawPickup(ctx, k, t) {
    const y = k.y + Math.sin(t * 2.5 + k.id) * 5;
    const col = k.kind === 'health' ? '#ff4d6d' : '#ffd23f';
    ctx.drawImage(glow(col), k.x - 34, y - 34, 68, 68);
    ctx.save(); ctx.translate(k.x, y);
    ctx.strokeStyle = rgba(col, 0.8); ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]); ctx.lineDashOffset = -t * 20;
    ctx.beginPath(); ctx.arc(0, 0, 21, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(20,20,45,0.55)'; ctx.beginPath(); ctx.arc(0, 0, 17, 0, 7); ctx.fill();
    if (k.kind === 'health') {
      ctx.fillStyle = '#fff'; rr(ctx, -8, -9, 16, 19, 3); ctx.fill();
      ctx.fillStyle = '#ff4d6d'; ctx.fillRect(-2, -5, 4, 12); ctx.fillRect(-6, -1, 12, 4);
      ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(4, -9); ctx.lineTo(7, -16); ctx.stroke();
    } else {
      const wi = SHARED.WEAPON_INDEX[k.kind];
      const s = 0.62; ctx.scale(s, s); ctx.translate(-(GUN_LEN[wi] / 2), 0);
      drawGun(ctx, wi, '#ffd23f');
    }
    ctx.restore();
  }

  function drawBullet(ctx, b) {
    const color = COLORS[b.c];
    const w = WEAPONS[b.w];
    if (w.key === 'launcher') {
      const a = Math.atan2(b.vy, b.vx);
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(a + Math.PI / 2);
      const g = ctx.createRadialGradient(-3, -4, 1, 0, 0, 12);
      g.addColorStop(0, '#fff'); g.addColorStop(0.3, color); g.addColorStop(1, shade(color, -0.4));
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, 10, 12, 0, 0, 7); ctx.fill();
      ctx.fillStyle = shade(color, -0.3); ctx.beginPath(); ctx.moveTo(-3, 12); ctx.lineTo(3, 12); ctx.lineTo(0, 16); ctx.closePath(); ctx.fill();
      ctx.restore();
      return;
    }
    const sp = Math.hypot(b.vx, b.vy) || 1, tl = w.key === 'sniper' ? 70 : 26;
    ctx.strokeStyle = rgba(color, 0.55); ctx.lineWidth = w.size * 1.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(b.x - (b.vx / sp) * tl, b.y - (b.vy / sp) * tl); ctx.lineTo(b.x, b.y); ctx.stroke();
    const s = w.size * 4;
    ctx.drawImage(glow(color), b.x - s, b.y - s, s * 2, s * 2);
  }

  return {
    init, resetDecals, drawBackground, drawTerrain, drawFalls, drawRiver, drawVignette,
    drawAvatar, drawHead, drawPickup, drawBullet, splatDecal: (x, y, c, s) => splatDecal(terrain, x, y, c, s),
    muzzle, glow, rgba, shade, rr, FUR,
  };
})();
