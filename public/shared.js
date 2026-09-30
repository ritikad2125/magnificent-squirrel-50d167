// Shared between server (Node) and browser: map, weapons, tuning constants.
(function (root) {
  const WORLD = { w: 3000, h: 1500, water: 1400 };

  const RECTS = [
    // big landmasses (bottoms sink into the river)
    { x: 0, y: 1100, w: 720, h: 420, k: 'land' },
    { x: 2280, y: 1100, w: 720, h: 420, k: 'land' },
    { x: 1180, y: 1180, w: 640, h: 340, k: 'land' },
    // floating islands
    { x: 320, y: 860, w: 300, h: 44, k: 'float' },
    { x: 2380, y: 860, w: 300, h: 44, k: 'float' },
    { x: 860, y: 960, w: 220, h: 40, k: 'float' },
    { x: 1920, y: 960, w: 220, h: 40, k: 'float' },
    { x: 1290, y: 800, w: 420, h: 48, k: 'float' },
    { x: 640, y: 620, w: 260, h: 44, k: 'float' },
    { x: 2100, y: 620, w: 260, h: 44, k: 'float' },
    { x: 1330, y: 460, w: 340, h: 44, k: 'float' },
    { x: 60, y: 520, w: 240, h: 44, k: 'float' },
    { x: 2700, y: 520, w: 240, h: 44, k: 'float' },
    { x: 1000, y: 300, w: 180, h: 36, k: 'float' },
    { x: 1820, y: 300, w: 180, h: 36, k: 'float' },
    // stone cover pillars
    { x: 540, y: 1010, w: 56, h: 90, k: 'pillar' },
    { x: 2404, y: 1010, w: 56, h: 90, k: 'pillar' },
    { x: 1250, y: 1100, w: 50, h: 80, k: 'pillar' },
    { x: 1700, y: 1100, w: 50, h: 80, k: 'pillar' },
  ];

  // feet positions
  const SPAWNS = [
    [150, 1100], [450, 1100], [2550, 1100], [2850, 1100], [1400, 1180], [1600, 1180],
    [470, 860], [2530, 860], [1500, 800], [770, 620], [2230, 620], [180, 520], [2820, 520], [1500, 460],
  ];

  const PICKUPS = [
    { kind: 'launcher', x: 1500, y: 425 },
    { kind: 'sniper', x: 180, y: 485 }, { kind: 'sniper', x: 2820, y: 485 },
    { kind: 'shotgun', x: 970, y: 925 }, { kind: 'shotgun', x: 2030, y: 925 },
    { kind: 'rifle', x: 770, y: 585 }, { kind: 'rifle', x: 2230, y: 585 }, { kind: 'rifle', x: 1500, y: 1145 },
    { kind: 'health', x: 470, y: 825 }, { kind: 'health', x: 2530, y: 825 },
    { kind: 'health', x: 1090, y: 265 }, { kind: 'health', x: 1910, y: 265 },
  ];

  // decorative waterfalls pouring off islands into the river gaps
  const FALLS = [
    { x: 1030, w: 34, top: 998 }, { x: 1936, w: 34, top: 998 },
  ];

  const WEAPONS = [
    { key: 'pistol', name: 'Paint Pistol', dmg: 15, rate: 0.28, speed: 1500, spread: 0.035, life: 0.8, ammo: -1, pellets: 1, size: 5 },
    { key: 'rifle', name: 'Splat Rifle', dmg: 9, rate: 0.085, speed: 1700, spread: 0.07, life: 0.8, ammo: 70, pellets: 1, size: 4 },
    { key: 'shotgun', name: 'Blob Shotgun', dmg: 11, rate: 0.75, speed: 1300, spread: 0.3, life: 0.33, ammo: 10, pellets: 7, size: 5 },
    { key: 'sniper', name: 'Sniper Squirter', dmg: 85, rate: 1.1, speed: 3200, spread: 0, life: 0.9, ammo: 6, pellets: 1, size: 6 },
    { key: 'launcher', name: 'Balloon Launcher', dmg: 75, rate: 0.95, speed: 950, spread: 0.02, life: 2.2, ammo: 6, pellets: 1, size: 12, grav: 900, radius: 140 },
  ];
  const WEAPON_INDEX = {}; WEAPONS.forEach((w, i) => (WEAPON_INDEX[w.key] = i));

  const COLORS = ['#ff4d6d', '#ffb703', '#3ddc97', '#4cc9f0', '#9b5de5', '#ff7b00', '#f15bb5', '#b8f542'];
  const AVATARS = ['fox', 'panda', 'cat', 'frog', 'robot', 'bear', 'bunny', 'penguin'];

  const RULES = {
    matchSeconds: 300, target: 20, maxPlayers: 8, minPlayers: 2,
    respawnMs: 3000, spawnProtectMs: 2000, regenDelayMs: 4000, regenPerSec: 10,
    pickupRespawnMs: 15000, countdownMs: 3000,
  };

  const PHYS = {
    hw: 17, hh: 29, gravity: 1800, walk: 340, groundAcc: 3200, airAcc: 1600,
    jetAcc: 3100, maxRise: 560, maxFall: 1150, fuelDrain: 42, fuelRefill: 60,
  };

  // ---------------------------------------------------------------- simulation (runs in the browser)
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // segment (x1,y1)->(x2,y2) vs AABB expanded by pad. returns entry t in [0,1] or -1
  function segRect(x1, y1, x2, y2, rx, ry, rw, rh, pad) {
    const minX = rx - pad, maxX = rx + rw + pad, minY = ry - pad, maxY = ry + rh + pad;
    const dx = x2 - x1, dy = y2 - y1;
    let t0 = 0, t1 = 1;
    const clip = (p, q) => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    };
    if (clip(-dx, x1 - minX) && clip(dx, maxX - x1) && clip(-dy, y1 - minY) && clip(dy, maxY - y1)) return t0;
    return -1;
  }

  // advances one player; returns true if they fell into the river
  function stepPlayer(p, i, dt) {
    const target = i.mx * PHYS.walk;
    const acc = (p.onGround ? PHYS.groundAcc : PHYS.airAcc) * dt;
    if (p.vx < target) p.vx = Math.min(target, p.vx + acc);
    else if (p.vx > target) p.vx = Math.max(target, p.vx - acc);

    p.jetting = !!i.jet && p.fuel > 0;
    if (p.jetting) {
      p.vy -= PHYS.jetAcc * dt;
      p.fuel = Math.max(0, p.fuel - PHYS.fuelDrain * dt);
      p.jetTime = (p.jetTime || 0) + dt;
    } else if (p.onGround) {
      p.fuel = Math.min(100, p.fuel + PHYS.fuelRefill * dt);
    }
    p.vy += PHYS.gravity * dt;
    p.vy = clamp(p.vy, -PHYS.maxRise, PHYS.maxFall);

    const hw = PHYS.hw, hh = PHYS.hh;
    p.x += p.vx * dt;
    for (const r of RECTS) {
      if (p.x + hw > r.x && p.x - hw < r.x + r.w && p.y + hh > r.y && p.y - hh < r.y + r.h) {
        if (p.vx > 0) p.x = r.x - hw; else if (p.vx < 0) p.x = r.x + r.w + hw;
        else p.x = p.x < r.x + r.w / 2 ? r.x - hw : r.x + r.w + hw;
        p.vx = 0;
      }
    }
    p.x = clamp(p.x, hw, WORLD.w - hw);
    p.y += p.vy * dt;
    p.onGround = false;
    for (const r of RECTS) {
      if (p.x + hw > r.x && p.x - hw < r.x + r.w && p.y + hh > r.y && p.y - hh < r.y + r.h) {
        if (p.vy > 0) { p.y = r.y - hh; p.onGround = true; } else { p.y = r.y + r.h + hh; }
        p.vy = 0;
      }
    }
    if (p.y < -250) { p.y = -250; p.vy = Math.max(0, p.vy); }
    return p.y - hh > WORLD.water + 10;
  }

  // a shot = one trigger pull, replayed identically on every screen
  function shotBullets(shot, owner) {
    const w = WEAPONS[shot.w];
    return shot.pel.map(([a, sp], k) => ({
      id: shot.id + '.' + k, owner, w: shot.w, c: shot.c, dmg: w.dmg, life: w.life,
      x: shot.x + Math.cos(a) * 22, y: shot.y + Math.sin(a) * 22,
      vx: Math.cos(a) * sp + shot.vx0, vy: Math.sin(a) * sp + shot.vy0,
    }));
  }

  // advances a bullet; targets = [{id,x,y}] it can hit. returns null or {kind:'wall'|'player'|'water'|'expire'|'gone', x, y, target}
  function stepBullet(b, dt, targets) {
    const w = WEAPONS[b.w];
    if (w.grav) b.vy += w.grav * dt;
    const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
    let hitT = 2, hit = null;
    for (const r of RECTS) {
      const tt = segRect(b.x, b.y, nx, ny, r.x, r.y, r.w, r.h, 0);
      if (tt >= 0 && tt < hitT) { hitT = tt; hit = null; }
    }
    for (const p of targets) {
      const tt = segRect(b.x, b.y, nx, ny, p.x - PHYS.hw, p.y - PHYS.hh, PHYS.hw * 2, PHYS.hh * 2, w.size * 0.5);
      if (tt >= 0 && tt < hitT) { hitT = tt; hit = p; }
    }
    b.life -= dt;
    if (hitT <= 1) {
      const hx = b.x + (nx - b.x) * hitT, hy = b.y + (ny - b.y) * hitT;
      b.x = hx; b.y = hy;
      return { kind: hit ? 'player' : 'wall', x: hx, y: hy, target: hit };
    }
    b.x = nx; b.y = ny;
    if (b.y > WORLD.water) return { kind: 'water', x: b.x, y: WORLD.water };
    if (b.life <= 0) return { kind: 'expire', x: b.x, y: b.y };
    if (b.x < -200 || b.x > WORLD.w + 200 || b.y < -600) return { kind: 'gone', x: b.x, y: b.y };
    return null;
  }

  // health/respawn state is stored as timestamps; this derives the live values at `now`
  function lifeAt(l, now) {
    if (!l) return { hp: 100, alive: false, respawnAt: 0, inv: 0, killer: 0, how: '', lastHit: 0, hpAt: now };
    if (!l.alive) {
      if (now >= l.respawnAt) return { ...l, alive: true, hp: 100, hpAt: l.respawnAt, lastHit: 0, inv: l.respawnAt + RULES.spawnProtectMs };
      return { ...l };
    }
    let hp = l.hp;
    const from = Math.max(l.hpAt, l.lastHit + RULES.regenDelayMs);
    if (now > from && hp < 100) hp = Math.min(100, hp + ((now - from) / 1000) * RULES.regenPerSec);
    return { ...l, hp };
  }

  const S = { WORLD, RECTS, SPAWNS, PICKUPS, FALLS, WEAPONS, WEAPON_INDEX, COLORS, AVATARS, RULES, PHYS, segRect, stepPlayer, shotBullets, stepBullet, lifeAt };
  if (typeof module !== 'undefined' && module.exports) module.exports = S;
  else root.SHARED = S;
})(this);
