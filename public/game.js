// Paint Militia — client
// Your own player is simulated right here (instant controls). Every ~100 ms the game syncs with
// the Netlify Function, which referees hits, splats, pickups, respawns, scores and the match clock.
(() => {
  const { WORLD, SPAWNS, PICKUPS, WEAPONS, COLORS, AVATARS, RULES, PHYS } = SHARED;
  const $ = (id) => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d');
  const TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const API = '/.netlify/functions/game';
  const SYNC_MS = { game: 100, lobby: 900, results: 1500, menu: 1500 };
  const STEP = 1 / 60;

  // ------------------------------------------------------------ prefs
  const store = {
    get(k, d) { try { const v = localStorage.getItem('pm_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('pm_' + k, JSON.stringify(v)); } catch {} },
  };
  const tab = {
    get(k) { try { return JSON.parse(sessionStorage.getItem('pm_' + k)); } catch { return null; } },
    set(k, v) { try { v == null ? sessionStorage.removeItem('pm_' + k) : sessionStorage.setItem('pm_' + k, JSON.stringify(v)); } catch {} },
  };
  const me = {
    name: store.get('name', ''),
    avatar: store.get('avatar', AVATARS[(Math.random() * AVATARS.length) | 0]),
    color: store.get('color', (Math.random() * COLORS.length) | 0),
    // one identity per browser tab, kept across reloads so you can rejoin a running match
    token: tab.get('token') || (Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^a-z0-9]/g, '').slice(0, 32),
  };
  tab.set('token', me.token);

  // ------------------------------------------------------------ canvas sizing
  let SW = 0, SH = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, TOUCH ? 1.6 : 2);
    SW = window.innerWidth; SH = window.innerHeight;
    cv.width = Math.round(SW * DPR); cv.height = Math.round(SH * DPR);
    updateRotate();
  }
  window.addEventListener('resize', resize);

  // ------------------------------------------------------------ sound
  const AU = {
    ctx: null, master: null, muted: store.get('muted', false), noiseBuf: null, jetGain: null,
    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.55; this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.8;
      this.jetGain = this.ctx.createGain(); this.jetGain.gain.value = 0;
      src.connect(bp); bp.connect(this.jetGain); this.jetGain.connect(this.master); src.start();
    },
    setMuted(m) { this.muted = m; store.set('muted', m); if (this.master) this.master.gain.value = m ? 0 : 0.55; },
    tone(f0, f1, dur, type = 'square', vol = 0.2, delay = 0) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime + delay, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
    },
    noise(dur, freq, vol = 0.3, type = 'lowpass', f1) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime, s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      s.buffer = this.noiseBuf; f.type = type; f.frequency.setValueAtTime(freq, t);
      if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
    },
    play(kind, vol = 1, arg) {
      if (!this.ctx || this.muted || vol < 0.03) return;
      switch (kind) {
        case 'shot': {
          const w = WEAPONS[arg].key;
          if (w === 'sniper') { this.tone(1400, 90, 0.35, 'sawtooth', 0.12 * vol); this.noise(0.25, 3000, 0.3 * vol, 'lowpass', 300); }
          else if (w === 'shotgun') this.noise(0.28, 2000, 0.45 * vol, 'lowpass', 200);
          else if (w === 'launcher') { this.tone(200, 500, 0.2, 'triangle', 0.25 * vol); this.noise(0.15, 800, 0.2 * vol); }
          else if (w === 'rifle') this.tone(900 + Math.random() * 200, 250, 0.07, 'square', 0.07 * vol);
          else this.tone(1000, 300, 0.1, 'square', 0.09 * vol);
          break;
        }
        case 'hit': this.noise(0.08, 1800, 0.25 * vol, 'bandpass'); break;
        case 'hitmark': this.tone(1800, 1600, 0.05, 'sine', 0.15); break;
        case 'hurt': this.tone(220, 110, 0.18, 'sawtooth', 0.12); break;
        case 'splat': this.noise(0.4, 1200, 0.5 * vol, 'lowpass', 150); this.tone(300, 60, 0.3, 'sine', 0.25 * vol); break;
        case 'boom': this.noise(0.8, 900, 0.8 * vol, 'lowpass', 60); this.tone(120, 30, 0.6, 'sine', 0.5 * vol); break;
        case 'splash': this.noise(0.6, 3000, 0.4 * vol, 'highpass', 600); break;
        case 'pick': [660, 880, 1320].forEach((f, i) => this.tone(f, f, 0.1, 'triangle', 0.18, i * 0.06)); break;
        case 'beep': this.tone(arg || 660, arg || 660, 0.15, 'sine', 0.25); break;
        case 'win': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f * 1.01, 0.25, 'triangle', 0.22, i * 0.12)); break;
        case 'score': [880, 1320].forEach((f, i) => this.tone(f, f, 0.12, 'triangle', 0.2, i * 0.07)); break;
      }
    },
  };

  // ------------------------------------------------------------ server clock
  const clock = {
    off: 0, n: 0, best: Infinity, rtt: 0,
    sample(serverNow, t0, t1) {
      const rtt = t1 - t0, off = serverNow - (t0 + t1) / 2;
      this.rtt = rtt;
      if (!this.n || Math.abs(off - this.off) > 1500) this.off = off;
      else this.off += (off - this.off) * (rtt <= this.best * 1.3 ? 0.25 : 0.05);
      this.best = Math.min(this.best * 1.02 + 1, rtt);
      this.n++;
    },
    now() { return Date.now() + this.off; },
  };

  // ------------------------------------------------------------ network
  const net = { code: null, you: 0, hostId: 0, players: new Map(), state: 'menu' };
  let room = null;          // latest view of the room from the server
  let session = null;       // { code, id }
  let view = 'menu';        // menu | lobby | game | results
  let evSeq = -1, curMatch = 0, failures = 0;
  let claims = [];

  async function api(body) {
    const t0 = Date.now();
    let res, data;
    try {
      res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
      data = await res.json();
    } catch {
      const e = new Error('Could not reach the game server.'); e.status = 0; throw e;
    }
    if (typeof data.now === 'number') clock.sample(data.now, t0, Date.now());
    if (!res.ok) { const e = new Error(data.error || 'Request failed.'); e.status = res.status; throw e; }
    return data;
  }

  function command(action, extra = {}) {
    if (!session) return Promise.resolve();
    return api({ action, code: session.code, id: session.id, token: me.token, since: evSeq, st: stateForSend(), ...extra })
      .then(applyView)
      .catch((e) => toast(e.message));
  }

  let looping = false;
  async function syncLoop() {
    if (looping) return;
    looping = true;
    while (session) {
      const t0 = performance.now();
      const sent = claims; claims = [];
      try {
        const v = await api({ action: 'sync', code: session.code, id: session.id, token: me.token, since: evSeq, st: stateForSend(), claims: sent });
        if (failures >= 3) toast('Reconnected!');
        failures = 0;
        applyView(v);
      } catch (e) {
        if (e.status === 403 || e.status === 404) { toast(e.message); leaveToMenu(false); break; }
        if (e.status === 0 || e.status >= 500) claims = sent.concat(claims); // nothing was applied — try again
        if (++failures === 3) toast('Connection trouble — retrying…', 4000);
      }
      const period = SYNC_MS[view] || 1000;
      await new Promise((r) => setTimeout(r, Math.max(15, period - (performance.now() - t0))));
    }
    looping = false;
  }

  function applyView(v) {
    if (!v || !session) return;
    room = v;
    net.code = v.code; net.you = v.you; net.hostId = v.hostId; net.state = v.state;
    net.players = new Map(v.players.map((p) => [p.id, p]));
    if (!net.players.has(net.you)) { toast('You left the room.'); leaveToMenu(false); return; }

    if (v.state === 'playing' && (view !== 'game' || curMatch !== v.match)) startGame(v);

    if (evSeq < 0) evSeq = v.seq;
    for (const ev of v.events || []) if (ev.s > evSeq) { evSeq = ev.s; serverEvent(ev.e); }
    for (const [id, st] of Object.entries(v.states || {})) ingestRemote(+id, st);
    for (const i of v.granted || []) grantPickup(i);

    if (v.state === 'ended' && (view === 'game' || view === 'menu' || view === 'lobby') && v.results) showResults(v.results);
    else if (v.state === 'lobby' && view !== 'lobby') showView('lobby');
    renderLobby(); renderResultsButtons();
  }

  // ------------------------------------------------------------ remote players (smoothed)
  const remotes = new Map();   // id -> { buf: [], lastT, seen: Set }
  let pendingShots = [];
  let ageAvg = 250;
  function interpDelay() { return Math.max(120, Math.min(500, ageAvg + 70)); }

  function ingestRemote(id, st) {
    if (id === net.you) return;
    let r = remotes.get(id);
    if (!r) { r = { buf: [], lastT: 0, seen: new Set(), wasAlive: false }; remotes.set(id, r); }
    if (st.t > r.lastT) {
      r.buf.push(st); r.lastT = st.t;
      if (r.buf.length > 40) r.buf.shift();
      const age = clock.now() - st.t;
      if (age > -500 && age < 3000) ageAvg += (age - ageAvg) * 0.1;
    }
    for (const s of st.shots || []) {
      if (r.seen.has(s.id) || s.t < room.startAt - 1000) continue;
      r.seen.add(s.id);
      pendingShots.push({ ...s, owner: id });
    }
    if (r.seen.size > 400) r.seen = new Set([...r.seen].slice(-200));
  }

  const lerpAng = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };
  function sampleRemote(r, rt) {
    const b = r.buf;
    if (!b.length) return null;
    if (rt <= b[0].t) return { ...b[0] };
    for (let i = b.length - 1; i >= 0; i--) {
      if (b[i].t <= rt) {
        const a = b[i], n = b[i + 1];
        if (!n) {
          const ex = Math.min(0.15, (rt - a.t) / 1000);
          return { ...a, x: a.x + a.vx * ex, y: a.y + a.vy * ex };
        }
        const t = (rt - a.t) / Math.max(1, n.t - a.t);
        if (Math.hypot(n.x - a.x, n.y - a.y) > 260 || a.a !== n.a) return { ...(t < 0.5 ? a : n) };
        return { ...n, x: a.x + (n.x - a.x) * t, y: a.y + (n.y - a.y) * t, aim: lerpAng(a.aim, n.aim, t) };
      }
    }
    return { ...b[0] };
  }

  // ------------------------------------------------------------ my player (simulated locally)
  const my = { x: 0, y: 0, vx: 0, vy: 0, fuel: 100, onGround: false, jetting: false, jetTime: 0, w: 0, ammo: -1, cd: 0, alive: false, inWorld: false };
  let myShots = [], shotN = 0, pendingDeathUntil = 0;
  let bullets = [];            // everyone's bullets, simulated locally
  const pickupTaken = {};      // optimistic removal until the server confirms

  function stateForSend() {
    const sn = clock.now();
    if (view !== 'game' || !my.inWorld) return { t: sn };
    myShots = myShots.filter((s) => sn - s.t < 1500);
    return {
      t: sn, x: Math.round(my.x), y: Math.round(my.y), vx: Math.round(my.vx), vy: Math.round(my.vy), aim: +aimAngle().toFixed(3),
      w: my.w, ammo: my.ammo, fuel: Math.round(my.fuel), jet: my.jetting, ground: my.onGround, a: my.alive, jt: +my.jetTime.toFixed(2),
      shots: myShots,
    };
  }

  function myLife(sn) { return SHARED.lifeAt(room && room.life[net.you], sn); }

  function respawn(sn) {
    let spot;
    if (sn < room.startAt + 1500) {
      const ids = [...net.players.keys()].sort((a, b) => a - b);
      spot = SPAWNS[(ids.indexOf(net.you) * 5 + room.match * 3) % SPAWNS.length];
    } else {
      const others = [...(cur ? cur.p.values() : [])].filter((p) => p.id !== net.you && p.alive);
      let best = -1;
      for (const s of SPAWNS) {
        let d = 1e9;
        for (const q of others) d = Math.min(d, Math.hypot(q.x - s[0], q.y - s[1]));
        const sc = Math.min(d, 1600) + Math.random() * 400;
        if (sc > best) { best = sc; spot = s; }
      }
    }
    Object.assign(my, { x: spot[0] + (Math.random() * 40 - 20), y: spot[1] - PHYS.hh - 1, vx: 0, vy: 0, fuel: 100, w: 0, ammo: -1, cd: 0.3, alive: true, inWorld: true, onGround: false });
    onEvent(['spawn', net.you, my.x, my.y]);
    deathInfo = null;
  }

  function fireLocal(sn) {
    const w = WEAPONS[my.w], base = aimAngle();
    const pel = [];
    for (let k = 0; k < w.pellets; k++) {
      pel.push([+(base + (Math.random() - 0.5) * w.spread * 2).toFixed(4), Math.round(w.speed * (w.pellets > 1 ? 0.85 + Math.random() * 0.3 : 1))]);
    }
    const shot = { id: net.you + '-' + (++shotN), t: Math.round(sn), x: Math.round(my.x), y: Math.round(my.y - 4), vx0: Math.round(my.vx * 0.15), vy0: Math.round(my.vy * 0.15), w: my.w, c: playerInfo(net.you).color, pel };
    myShots.push(shot);
    for (const b of SHARED.shotBullets(shot, net.you)) { b.mine = true; bullets.push(b); }
    const kick = { pistol: 30, rifle: 12, shotgun: 260, sniper: 320, launcher: 180 }[w.key] || 0;
    my.vx -= Math.cos(base) * kick; my.vy -= Math.sin(base) * kick * 0.6;
    my.cd = w.rate;
    if (w.ammo > 0) { my.ammo--; if (my.ammo <= 0) { my.w = 0; my.ammo = -1; } }
    onEvent(['shot', net.you, shot.w]);
  }

  function grantPickup(i) {
    const k = PICKUPS[i];
    if (!k || k.kind === 'health') return;
    const wi = SHARED.WEAPON_INDEX[k.kind];
    my.w = wi; my.ammo = WEAPONS[wi].ammo; my.cd = Math.min(my.cd, 0.15);
  }

  // targets a bullet can hit, as seen on this screen
  function targetsFor(owner, sn) {
    const out = [];
    if (!cur) return out;
    for (const p of cur.p.values()) if (p.id !== owner && p.alive && !p.inv) out.push(p);
    return out;
  }

  function explodeMine(b, x, y, sn) {
    const w = WEAPONS[b.w];
    onEvent(['boom', Math.round(x), Math.round(y), b.c]);
    for (const p of cur.p.values()) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d > w.radius) continue;
      const f = 1 - d / w.radius, self = p.id === net.you;
      const dmg = w.dmg * (0.35 + 0.65 * f) * (self ? 0.5 : 1);
      const ang = Math.atan2(p.y - y, p.x - x);
      const kx = Math.cos(ang) * 700 * f, ky = Math.sin(ang) * 700 * f - 200 * f;
      if (self) { if (!p.inv) { my.vx += kx; my.vy += ky; } claims.push({ k: 'hit', v: net.you, d: +dmg.toFixed(1), w: b.w, x: my.x, y: my.y }); }
      else if (!p.inv) claims.push({ k: 'hit', v: p.id, d: +dmg.toFixed(1), w: b.w, x: p.x, y: p.y, kx: Math.round(kx), ky: Math.round(ky) });
    }
  }

  function stepBullets(dt, sn) {
    const keep = [];
    for (const b of bullets) {
      const w = WEAPONS[b.w];
      const r = SHARED.stepBullet(b, dt, targetsFor(b.owner, sn));
      if (!r) { keep.push(b); continue; }
      if (w.radius && r.kind !== 'water' && r.kind !== 'gone') {
        if (b.mine) explodeMine(b, r.x, r.y, sn); else onEvent(['boom', Math.round(r.x), Math.round(r.y), b.c]);
      } else if (r.kind === 'wall') onEvent(['wall', Math.round(r.x), Math.round(r.y), b.c, w.key === 'sniper' ? 2 : 1]);
      else if (r.kind === 'water') onEvent(['drip', Math.round(r.x)]);
      else if (r.kind === 'player' && b.mine) {
        const t = r.target;
        claims.push({ k: 'hit', v: t.id, d: b.dmg, w: b.w, x: Math.round(t.x), y: Math.round(t.y) });
        burst(t.x, t.y - 6, COLORS[b.c], 10, 380, 4, 0.6);
        hitAt.set(t.id, performance.now());
        hitMarkAt = performance.now(); AU.play('hitmark');
      }
    }
    bullets = keep;
  }

  function simStep(dt, sn) {
    if (!room || room.state !== 'playing') return;
    // replay other players' shots once the smoothed timeline reaches them
    const rt = sn - interpDelay();
    if (pendingShots.length) {
      const later = [];
      for (const s of pendingShots) {
        if (s.t > rt) { later.push(s); continue; }
        onEvent(['shot', s.owner, s.w]);
        const bs = SHARED.shotBullets(s, s.owner);
        let catchUp = Math.min(0.4, (rt - s.t) / 1000);
        while (catchUp > STEP) { for (const b of bs) SHARED.stepBullet(b, STEP, []); catchUp -= STEP; }
        bullets.push(...bs);
      }
      pendingShots = later;
    }

    const L = myLife(sn);
    if (my.alive && !L.alive) { my.alive = false; }
    if (!my.alive && L.alive && sn > pendingDeathUntil) respawn(sn);

    const frozen = sn < room.startAt;
    const inp = readInput();
    if (my.alive) {
      const fell = SHARED.stepPlayer(my, frozen ? { mx: 0, jet: false } : inp, dt);
      if (fell) {
        claims.push({ k: 'fall', x: Math.round(my.x) });
        my.alive = false; pendingDeathUntil = sn + 2500;
        deathInfo = { how: 'river' };
      } else {
        my.cd -= dt;
        if (!frozen && inp.fire && my.cd <= 0) fireLocal(sn);
        for (let i = 0; i < PICKUPS.length; i++) {
          const k = PICKUPS[i];
          if (!pickupActive(i, sn) || Math.abs(k.x - my.x) > 38 || Math.abs(k.y - my.y) > 50) continue;
          if (k.kind === 'health' && L.hp >= 100) continue;
          claims.push({ k: 'pick', i });
          pickupTaken[i] = sn + 1200;
        }
      }
    }
    if (!L.alive) pendingDeathUntil = 0;
    stepBullets(dt, sn);
  }

  const pickupActive = (i, sn) => room && room.pickups[i] <= sn && !(pickupTaken[i] > sn);

  // ------------------------------------------------------------ particles
  const parts = [];
  function P(o) {
    if (parts.length > 1400) parts.splice(0, 100);
    parts.push(Object.assign({ vx: 0, vy: 0, g: 0, drag: 0, life: 1, max: 1, size: 3, color: '#fff', kind: 'dot', rot: 0, vr: 0 }, o, { max: o.life || 1 }));
  }
  const rnd = (a, b) => a + Math.random() * (b - a);
  function burst(x, y, color, n, spd, size = 4, life = 0.7) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = rnd(0.2, 1) * spd;
      P({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - spd * 0.2, g: 900, drag: 1.5, life: rnd(life * 0.5, life), size: rnd(size * 0.5, size), color, kind: 'drop' });
    }
  }
  function waterSplash(x, big) {
    const n = big ? 40 : 8;
    for (let i = 0; i < n; i++) P({ x: x + rnd(-10, 10), y: WORLD.water, vx: rnd(-1, 1) * (big ? 260 : 90), vy: -rnd(200, big ? 750 : 350), g: 1500, life: rnd(0.5, 1.1), size: rnd(2, big ? 6 : 3.5), color: '#d8f4ff', kind: 'dot' });
    if (big) P({ x, y: WORLD.water, life: 0.6, size: 10, color: '#ffffff', kind: 'ring', r: 90 });
  }
  function updateParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.vy += p.g * dt;
      const d = Math.max(0, 1 - p.drag * dt); p.vx *= d; p.vy *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      if (!p.screen && p.kind === 'drop' && p.y > WORLD.water) { p.life = 0; }
    }
  }
  function drawParts(screen) {
    for (const p of parts) {
      if (!!p.screen !== screen) continue;
      const k = p.life / p.max;
      switch (p.kind) {
        case 'dot': ctx.globalAlpha = Math.min(1, k * 2); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * k), 0, 7); ctx.fill(); break;
        case 'drop': {
          ctx.globalAlpha = Math.min(1, k * 2.5);
          const sp = Math.hypot(p.vx, p.vy), st = Math.min(3, 1 + sp / 400), a = Math.atan2(p.vy, p.vx);
          ctx.fillStyle = p.color; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(a);
          ctx.beginPath(); ctx.ellipse(0, 0, p.size * st, p.size, 0, 0, 7); ctx.fill(); ctx.restore();
          break;
        }
        case 'smoke': ctx.globalAlpha = k * 0.35; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.8 - k), 0, 7); ctx.fill(); break;
        case 'ring': ctx.globalAlpha = k; ctx.strokeStyle = p.color; ctx.lineWidth = p.size * k; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 - k * k) + 4, 0, 7); ctx.stroke(); break;
        case 'flash': { ctx.globalAlpha = k; const s = p.size * (0.6 + k * 0.4); ctx.drawImage(ART.glow(p.color), p.x - s, p.y - s, s * 2, s * 2); break; }
        case 'spark': ctx.globalAlpha = k; ctx.strokeStyle = p.color; ctx.lineWidth = p.size; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke(); break;
        case 'conf': ctx.globalAlpha = Math.min(1, k * 3); ctx.fillStyle = p.color; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size * Math.abs(Math.cos(p.rot * 1.3)) + 1); ctx.restore(); break;
        case 'text': {
          ctx.globalAlpha = Math.min(1, k * 2.5);
          ctx.font = `900 ${p.size}px Nunito, sans-serif`; ctx.textAlign = 'center';
          ctx.lineWidth = p.size / 5; ctx.strokeStyle = 'rgba(20,15,50,0.85)'; ctx.strokeText(p.text, p.x, p.y);
          ctx.fillStyle = p.color; ctx.fillText(p.text, p.x, p.y);
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ events → effects
  let cur = null;               // everything drawn this frame
  const cam = { x: 1500, y: 1000, s: 1, sw: 0, sh: 0, shake: 0 };
  const killfeed = [];
  const hitAt = new Map();
  let myLastHit = 0, hitMarkAt = 0, lastBeep = 0, deathInfo = null, bigMsg = null;
  const pickupState = PICKUPS.map((k, i) => ({ ...k, id: i, active: true }));

  function playerInfo(id) { return net.players.get(id) || { name: '???', avatar: 'fox', color: 0 }; }
  function volAt(x, y) { const d = Math.hypot(x - cam.x, y - cam.y); return Math.max(0, 1 - d / 1400); }

  // events decided by the server
  function serverEvent(e) {
    switch (e[0]) {
      case 'kb': if (e[1] === net.you && my.alive) { my.vx += e[2]; my.vy += e[3]; } break;
      case 'hit':
        if (e[3] === net.you && e[1] !== net.you) {
          const p = cur && cur.p.get(e[1]);
          if (p) P({ x: p.x + rnd(-10, 10), y: p.y - 40, vy: -70, life: 0.8, size: 15 + Math.min(12, e[2] / 5), color: '#fff', kind: 'text', text: '-' + e[2] });
        } else onEvent(e);
        break;
      default: onEvent(e);
    }
  }

  function onEvent(e) {
    const P0 = cur && cur.p;
    switch (e[0]) {
      case 'shot': {
        const p = P0 && P0.get(e[1]); if (!p) break;
        const [mx, my_] = ART.muzzle({ x: p.x, y: p.y, aim: e[1] === net.you ? aimAngle() : p.aim, weapon: e[2] });
        const col = COLORS[playerInfo(e[1]).color];
        P({ x: mx, y: my_, life: 0.07, size: e[2] === 3 ? 26 : 16, color: col, kind: 'flash' });
        if (e[2] === 3 || e[2] === 2) for (let i = 0; i < 5; i++) P({ x: mx, y: my_, vx: Math.cos(p.aim + rnd(-0.4, 0.4)) * rnd(200, 500), vy: Math.sin(p.aim + rnd(-0.4, 0.4)) * rnd(200, 500), life: 0.2, size: 2, color: '#fff3c4', kind: 'spark' });
        AU.play('shot', e[1] === net.you ? 1 : volAt(p.x, p.y) * 0.7, e[2]);
        if (e[1] === net.you && (e[2] === 3 || e[2] === 4 || e[2] === 2)) cam.shake = Math.max(cam.shake, 5);
        break;
      }
      case 'hit': {
        const p = P0 && P0.get(e[1]); if (!p) break;
        const col = COLORS[playerInfo(e[3]).color] || '#fff';
        burst(p.x, p.y - 6, col, 10, 380, 4, 0.6);
        P({ x: p.x + rnd(-10, 10), y: p.y - 40, vy: -70, life: 0.8, size: 15 + Math.min(12, e[2] / 5), color: '#fff', kind: 'text', text: '-' + e[2] });
        hitAt.set(e[1], performance.now());
        if (e[1] === net.you) { myLastHit = performance.now(); cam.shake = Math.max(cam.shake, 6); AU.play('hurt'); }
        else AU.play('hit', volAt(p.x, p.y) * 0.6);
        break;
      }
      case 'wall':
        ART.splatDecal(e[1], e[2], COLORS[e[3]], e[4] === 2 ? 1.6 : 0.9);
        burst(e[1], e[2], COLORS[e[3]], 5, 220, 3, 0.4);
        break;
      case 'boom': {
        const [x, y, c] = [e[1], e[2], COLORS[e[3]]];
        P({ x, y, life: 0.25, size: 120, color: c, kind: 'flash' });
        P({ x, y, life: 0.5, size: 12, color: c, kind: 'ring', r: 150 });
        P({ x, y, life: 0.35, size: 6, color: '#fff', kind: 'ring', r: 110 });
        burst(x, y, c, 50, 800, 7, 1);
        for (let i = 0; i < 16; i++) P({ x: x + rnd(-40, 40), y: y + rnd(-40, 40), vx: rnd(-60, 60), vy: rnd(-90, -20), life: rnd(0.8, 1.5), size: rnd(14, 26), color: '#e8e2f5', kind: 'smoke' });
        for (let i = 0; i < 14; i++) { const a = Math.random() * 7, d = Math.random() * 120; ART.splatDecal(x + Math.cos(a) * d, y + Math.sin(a) * d, c, rnd(0.8, 2)); }
        cam.shake = Math.max(cam.shake, 22 * volAt(x, y));
        AU.play('boom', volAt(x, y));
        break;
      }
      case 'splat': {
        const [killer, victim, how, x, y] = e.slice(1);
        const vi = playerInfo(victim), ki = killer ? playerInfo(killer) : null;
        const col = COLORS[(ki || vi).color];
        if (how !== 'river') {
          burst(x, y, col, 45, 700, 7, 1.1);
          burst(x, y, COLORS[vi.color], 20, 400, 5, 0.9);
          P({ x, y, life: 0.4, size: 90, color: col, kind: 'flash' });
          for (let i = 0; i < 18; i++) P({ x, y: y - 10, vx: rnd(-300, 300), vy: rnd(-600, -200), g: 800, drag: 1, vr: rnd(-10, 10), life: rnd(1, 1.8), size: rnd(3, 5), color: COLORS[(Math.random() * 8) | 0], kind: 'conf' });
          for (let i = 0; i < 6; i++) { const a = Math.random() * 7, d = rnd(10, 70); ART.splatDecal(x + Math.cos(a) * d, y + Math.sin(a) * d + 20, col, rnd(1, 2.2)); }
          AU.play('splat', killer === net.you || victim === net.you ? 1 : volAt(x, y));
        }
        killfeed.unshift({ t: performance.now(), killer: ki, victim: vi, how });
        if (killfeed.length > 5) killfeed.pop();
        if (killer === net.you) { bigMsg = { text: '+1 SPLAT!', color: COLORS[playerInfo(net.you).color], t: performance.now() }; AU.play('score'); }
        if (victim === net.you) {
          my.alive = false;
          deathInfo = { by: ki, how };
          if (how === 'river' || !ki) bigMsg = { text: '-1 OOPS!', color: '#ff9fb0', t: performance.now() };
        }
        break;
      }
      case 'fall': waterSplash(e[1], true); AU.play('splash', volAt(e[1], WORLD.water)); break;
      case 'drip': waterSplash(e[1], false); break;
      case 'pick': {
        const k = pickupState[e[3]];
        if (k) for (let i = 0; i < 16; i++) { const a = (i / 16) * 7; P({ x: k.x, y: k.y, vx: Math.cos(a) * 220, vy: Math.sin(a) * 220, drag: 3, life: 0.5, size: 3, color: e[2] === 'health' ? '#ff8fab' : '#ffd23f', kind: 'dot' }); }
        if (e[1] === net.you) {
          AU.play('pick');
          const label = e[2] === 'health' ? 'Juice Box +50 HP' : WEAPONS[SHARED.WEAPON_INDEX[e[2]]].name;
          bigMsg = { text: label, color: e[2] === 'health' ? '#ff8fab' : '#ffd23f', t: performance.now(), small: true };
        }
        break;
      }
      case 'spawn': {
        const [pid, x, y] = [e[1], e[2], e[3]];
        P({ x, y, life: 0.6, size: 5, color: COLORS[playerInfo(pid).color], kind: 'ring', r: 60 });
        P({ x, y, life: 0.4, size: 60, color: '#ffffff', kind: 'flash' });
        break;
      }
    }
  }

  // ------------------------------------------------------------ input
  const keys = new Set();
  const mouse = { x: 0, y: 0, down: false, used: false };
  const sticks = { L: null, R: null };
  let lastAim = { x: 1, y: 0 };
  const STICK_R = 58;

  window.addEventListener('keydown', (e) => {
    if (view !== 'game') return;
    keys.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); mouse.down = false; sticks.L = sticks.R = null; });
  cv.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.used = true; });
  cv.addEventListener('mousedown', (e) => { if (e.button === 0) { mouse.down = true; mouse.used = true; } AU.init(); });
  window.addEventListener('mouseup', () => (mouse.down = false));
  cv.addEventListener('contextmenu', (e) => e.preventDefault());

  function touchHandler(e) {
    if (view !== 'game') return;
    e.preventDefault();
    AU.init();
    for (const t of e.changedTouches) {
      if (e.type === 'touchstart') {
        const side = t.clientX < SW / 2 ? 'L' : 'R';
        if (!sticks[side]) sticks[side] = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
      } else {
        for (const side of ['L', 'R']) {
          const s = sticks[side];
          if (!s || s.id !== t.identifier) continue;
          if (e.type === 'touchmove') {
            s.x = t.clientX; s.y = t.clientY;
            const dx = s.x - s.ox, dy = s.y - s.oy, d = Math.hypot(dx, dy);
            if (d > STICK_R * 1.4) { s.ox = s.x - (dx / d) * STICK_R * 1.4; s.oy = s.y - (dy / d) * STICK_R * 1.4; }
          } else sticks[side] = null;
        }
      }
    }
  }
  for (const ev of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) cv.addEventListener(ev, touchHandler, { passive: false });

  function stickVec(s) {
    if (!s) return { x: 0, y: 0, m: 0 };
    const dx = (s.x - s.ox) / STICK_R, dy = (s.y - s.oy) / STICK_R, m = Math.hypot(dx, dy);
    const k = m > 1 ? 1 / m : 1;
    return { x: dx * k, y: dy * k, m: Math.min(1, m) };
  }

  function readInput() {
    let mx = 0, jet = false, fire = false;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp') || keys.has('Space')) jet = true;
    if (mouse.used && !TOUCH && my.inWorld) {
      const wx = cam.x + (mouse.x - SW / 2) / cam.s, wy = cam.y + (mouse.y - SH / 2) / cam.s;
      const ax = wx - my.x, ay = wy - (my.y - 4);
      if (Math.hypot(ax, ay) > 4) lastAim = { x: ax, y: ay };
      fire = mouse.down;
    }
    const L = stickVec(sticks.L), R = stickVec(sticks.R);
    if (sticks.L) {
      if (Math.abs(L.x) > 0.18) mx = Math.max(-1, Math.min(1, (L.x - Math.sign(L.x) * 0.18) / 0.62));
      if (L.y < -0.38) jet = true;
    }
    if (sticks.R && R.m > 0.2) { lastAim = { x: R.x, y: R.y }; fire = R.m > 0.5; }
    return { mx, jet, fire };
  }
  function aimAngle() { return Math.atan2(lastAim.y, lastAim.x); }

  // ------------------------------------------------------------ rendering
  function setCamScale() {
    cam.sw = SW; cam.sh = SH;
    cam.s = Math.min(SH / 680, SW / 1050);
  }

  function clampCam() {
    const vw = SW / cam.s, vh = SH / cam.s;
    cam.x = vw >= WORLD.w ? WORLD.w / 2 : Math.max(vw / 2, Math.min(WORLD.w - vw / 2, cam.x));
    cam.y = Math.max(-250 + vh / 2, Math.min(WORLD.water + 110 - vh / 2, cam.y));
  }

  function worldBegin() {
    const sx = cam.shake ? rnd(-cam.shake, cam.shake) : 0, sy = cam.shake ? rnd(-cam.shake, cam.shake) : 0;
    ctx.setTransform(DPR * cam.s, 0, 0, DPR * cam.s, DPR * (SW / 2 - cam.x * cam.s + sx), DPR * (SH / 2 - cam.y * cam.s + sy));
  }
  const screenBegin = () => ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const toScreen = (x, y) => [SW / 2 + (x - cam.x) * cam.s, SH / 2 + (y - cam.y) * cam.s];

  // assemble what is on screen: me (live) + everyone else (smoothed) + all bullets
  function buildCur(sn) {
    const p = new Map();
    const rt = sn - interpDelay();
    const score = (id) => (room.scores && room.scores[id]) || { score: 0, deaths: 0 };
    if (my.inWorld) {
      const L = myLife(sn);
      p.set(net.you, {
        id: net.you, x: my.x, y: my.y, vx: my.vx, vy: my.vy, aim: aimAngle(), hp: L.hp, fuel: my.fuel, w: my.w, ammo: my.ammo,
        alive: my.alive, jet: my.jetting, inv: my.alive && sn < L.inv, ground: my.onGround,
        resp: Math.max(0, L.respawnAt - sn), score: score(net.you).score, deaths: score(net.you).deaths, killer: L.killer,
      });
    }
    for (const [id, r] of remotes) {
      if (!net.players.has(id)) continue;
      const s = sampleRemote(r, rt);
      if (!s) continue;
      const L = SHARED.lifeAt(room.life[id], sn);
      const alive = L.alive && s.a && sn - r.lastT < 4000;
      if (alive && !r.wasAlive) onEvent(['spawn', id, s.x, s.y]);
      r.wasAlive = alive;
      p.set(id, {
        id, x: s.x, y: s.y, vx: s.vx, vy: s.vy, aim: s.aim, hp: L.hp, fuel: s.fuel, w: s.w, ammo: s.ammo, alive, jet: s.jet,
        inv: sn < L.inv, ground: s.ground, resp: 0, score: score(id).score, deaths: score(id).deaths, killer: L.killer,
      });
    }
    // players with no position yet still appear on the scoreboard
    for (const id of net.players.keys()) if (!p.has(id)) p.set(id, { id, x: -999, y: -999, alive: false, hp: 0, score: score(id).score, deaths: score(id).deaths, w: 0, ammo: -1, fuel: 0 });
    const b = new Map(bullets.map((x) => [x.id, x]));
    const k = PICKUPS.map((_, i) => (pickupActive(i, sn) ? 1 : 0));
    return { p, b, k };
  }

  function drawWorld(t, players, bulletList, pickActive) {
    screenBegin();
    ART.drawBackground(ctx, cam, t);
    ART.drawTerrain(ctx, cam);
    worldBegin();
    ART.drawFalls(ctx, t);
    for (const k of pickupState) {
      k.active = pickActive ? !!pickActive[k.id] : true;
      if (k.active) ART.drawPickup(ctx, k, t);
    }
    for (const b of bulletList) ART.drawBullet(ctx, b);
    for (const o of players) drawPlayer(o, t);
    drawParts(false);
    ART.drawRiver(ctx, cam, t);
    screenBegin();
    for (const o of players) drawTag(o);
    ART.drawVignette(ctx, SW, SH);
  }

  function drawPlayer(o, t) {
    const now = performance.now();
    const hurt = now - (hitAt.get(o.id) || 0) < 140;
    const alpha = o.inv ? 0.55 + 0.45 * Math.abs(Math.sin(t * 10)) : 1;
    ART.drawAvatar(ctx, { ...o, x: o.x + (hurt ? rnd(-2, 2) : 0), alpha, t });
    if (o.inv) {
      const g = ctx.createRadialGradient(o.x, o.y, 20, o.x, o.y, 46);
      g.addColorStop(0, 'rgba(160,230,255,0)'); g.addColorStop(0.8, 'rgba(160,230,255,0.25)'); g.addColorStop(1, 'rgba(220,250,255,0.7)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.x, o.y, 46, 0, 7); ctx.fill();
    }
    if (hurt) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(o.x, o.y - 6, 30, 0, 7); ctx.fill(); }
    if (o.jet && Math.random() < 0.7) {
      const face = Math.cos(o.aim) >= 0 ? 1 : -1;
      P({ x: o.x - face * 13 + rnd(-3, 3), y: o.y + 34, vx: rnd(-30, 30), vy: rnd(60, 160), life: rnd(0.35, 0.7), size: rnd(5, 9), color: '#f5efe6', kind: 'smoke', drag: 2 });
      if (Math.random() < 0.5) P({ x: o.x - face * 13, y: o.y + 30, vx: rnd(-40, 40), vy: rnd(150, 300), life: 0.2, size: 2, color: '#ffb703', kind: 'dot' });
    }
  }

  function drawTag(o) {
    const info = playerInfo(o.id);
    const [sx, sy] = toScreen(o.x, o.y - 54);
    if (sx < -60 || sx > SW + 60 || sy < -30 || sy > SH + 30) return;
    const fs = Math.max(11, Math.min(15, 15 * cam.s + 4));
    ctx.font = `900 ${fs}px Nunito, sans-serif`; ctx.textAlign = 'center';
    ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(20,15,50,0.8)'; ctx.strokeText(info.name, sx, sy);
    ctx.fillStyle = o.id === net.you ? '#fff' : COLORS[info.color]; ctx.fillText(info.name, sx, sy);
    const bw = 44, bh = 5, hp = Math.max(0, o.hp) / 100;
    ctx.fillStyle = 'rgba(20,15,50,0.7)'; ART.rr(ctx, sx - bw / 2 - 1, sy + 4, bw + 2, bh + 2, 3); ctx.fill();
    ctx.fillStyle = hp > 0.5 ? '#3ddc97' : hp > 0.25 ? '#ffd23f' : '#ff4d6d';
    ART.rr(ctx, sx - bw / 2, sy + 5, bw * hp, bh, 2.5); ctx.fill();
  }

  // ------------------------------------------------------------ HUD
  function panel(x, y, w, h, r = 12, a = 0.5) { ctx.fillStyle = `rgba(20,16,50,${a})`; ART.rr(ctx, x, y, w, h, r); ctx.fill(); }

  function drawHUD(t, sn) {
    screenBegin();
    const ui = Math.max(0.72, Math.min(1.25, Math.min(SW / 950, SH / 520)));
    const mp = cur.p.get(net.you);
    const now = performance.now();
    const go = room.startAt - sn;
    const left = Math.max(0, room.endAt - Math.max(sn, room.startAt));
    const pad = 10;

    const hurtK = Math.max(0, 1 - (now - myLastHit) / 450);
    const lowHp = mp && mp.alive && mp.hp < 35 ? 0.35 + 0.2 * Math.sin(t * 6) : 0;
    if (hurtK > 0 || lowHp > 0) {
      const g = ctx.createRadialGradient(SW / 2, SH / 2, Math.min(SW, SH) * 0.3, SW / 2, SH / 2, Math.max(SW, SH) * 0.75);
      g.addColorStop(0, 'rgba(255,40,80,0)'); g.addColorStop(1, `rgba(255,40,80,${Math.max(hurtK * 0.55, lowHp)})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, SW, SH);
    }

    // timer
    const secs = Math.ceil(left / 1000), mm = Math.floor(secs / 60), ss = String(secs % 60).padStart(2, '0');
    const tw = 120 * ui;
    panel(SW / 2 - tw / 2, pad, tw, 44 * ui, 14 * ui, 0.55);
    ctx.textAlign = 'center';
    ctx.font = `400 ${26 * ui}px 'Lilita One', Nunito, sans-serif`;
    ctx.fillStyle = secs <= 30 && go <= 0 ? (Math.sin(t * 8) > 0 ? '#ff4d6d' : '#fff') : '#fff';
    ctx.fillText(`${mm}:${ss}`, SW / 2, pad + 26 * ui);
    ctx.font = `800 ${10 * ui}px Nunito, sans-serif`; ctx.fillStyle = '#c9c2e8';
    ctx.fillText(`FIRST TO ${room.target || RULES.target}`, SW / 2, pad + 39 * ui);

    // kill feed
    let ky = pad + 44 * ui + 18 * ui;
    ctx.font = `800 ${12 * ui}px Nunito, sans-serif`;
    for (const k of killfeed) {
      const age = (now - k.t) / 1000;
      if (age > 5) continue;
      ctx.globalAlpha = Math.min(1, (5 - age) * 2);
      const a = k.killer ? k.killer.name : '', b = k.victim.name;
      const mid = k.how === 'river' ? ' fell in the river 💦' : k.killer ? '  🎨  ' : ' splatted themself';
      const segs = k.killer ? [[a, COLORS[k.killer.color]], [mid, '#fff'], [b, COLORS[k.victim.color]]] : [[b, COLORS[k.victim.color]], [mid, '#fff']];
      const W = segs.reduce((s, p) => s + ctx.measureText(p[0]).width, 0) + 16;
      panel(SW / 2 - W / 2, ky - 13 * ui, W, 19 * ui, 8, 0.45);
      let x = SW / 2 - W / 2 + 8; ctx.textAlign = 'left';
      for (const [txt, col] of segs) { ctx.fillStyle = col; ctx.fillText(txt, x, ky + 1); x += ctx.measureText(txt).width; }
      ky += 22 * ui;
    }
    ctx.globalAlpha = 1;

    // scoreboard (top-right)
    const rows = [...cur.p.values()].map((p) => ({ ...p, info: playerInfo(p.id) })).sort((a, b) => b.score - a.score || a.deaths - b.deaths);
    const rw = 150 * ui, rh = 19 * ui, bx = SW - rw - pad - 48, by = pad;
    panel(bx, by, rw, rh * rows.length + 10, 12, 0.45);
    rows.forEach((r, i) => {
      const y = by + 5 + i * rh;
      if (r.id === net.you) { ctx.fillStyle = 'rgba(255,210,63,0.22)'; ART.rr(ctx, bx + 3, y, rw - 6, rh, 6); ctx.fill(); }
      ctx.fillStyle = COLORS[r.info.color]; ctx.beginPath(); ctx.arc(bx + 14, y + rh / 2, 5 * ui, 0, 7); ctx.fill();
      ctx.font = `800 ${12 * ui}px Nunito, sans-serif`; ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
      let nm = r.info.name; if (nm.length > 11) nm = nm.slice(0, 10) + '…';
      ctx.fillText(`${i + 1}. ${nm}`, bx + 24, y + rh * 0.7);
      ctx.textAlign = 'right'; ctx.font = `900 ${13 * ui}px Nunito, sans-serif`; ctx.fillStyle = r.score < 0 ? '#ff9fb0' : '#ffd23f';
      ctx.fillText(r.score, bx + rw - 10, y + rh * 0.72);
    });

    // minimap (top-left)
    const mw = 170 * ui, mh = mw * (WORLD.h + 150) / WORLD.w, mx0 = pad, my0 = pad, ms = mw / WORLD.w, oy = 150;
    panel(mx0, my0, mw, mh, 10, 0.45);
    ctx.save(); ART.rr(ctx, mx0, my0, mw, mh, 10); ctx.clip();
    ctx.fillStyle = 'rgba(76,201,240,0.5)'; ctx.fillRect(mx0, my0 + (WORLD.water + oy) * ms, mw, mh);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (const r of SHARED.RECTS) ctx.fillRect(mx0 + r.x * ms, my0 + (r.y + oy) * ms, Math.max(1.5, r.w * ms), Math.max(1.5, r.h * ms));
    const vw = SW / cam.s, vh = SH / cam.s;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
    ctx.strokeRect(mx0 + (cam.x - vw / 2) * ms, my0 + (cam.y - vh / 2 + oy) * ms, vw * ms, vh * ms);
    for (const k of pickupState) if (k.active) { ctx.fillStyle = k.kind === 'health' ? '#ff8fab' : '#ffd23f'; ctx.fillRect(mx0 + k.x * ms - 1.5, my0 + (k.y + oy) * ms - 1.5, 3, 3); }
    for (const p of cur.p.values()) {
      if (!p.alive) continue;
      ctx.fillStyle = COLORS[playerInfo(p.id).color];
      ctx.beginPath(); ctx.arc(mx0 + p.x * ms, my0 + (p.y + oy) * ms, p.id === net.you ? 4 : 3, 0, 7); ctx.fill();
      if (p.id === net.you) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
    ctx.restore();

    // bottom status: HP, fuel, weapon
    if (mp) {
      const w = Math.min(300 * ui, SW - 2 * (TOUCH ? 150 : 20)), h = 50 * ui, x = SW / 2 - w / 2, y = SH - h - pad;
      panel(x, y, w, h, 14, 0.5);
      const bar = (yy, frac, c1, c2, label) => {
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ART.rr(ctx, x + 36 * ui, yy, w - 46 * ui - 80 * ui, 9 * ui, 5); ctx.fill();
        const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, c1); g.addColorStop(1, c2);
        ctx.fillStyle = g; ART.rr(ctx, x + 36 * ui, yy, Math.max(0, (w - 46 * ui - 80 * ui) * frac), 9 * ui, 5); ctx.fill();
        ctx.font = `900 ${10 * ui}px Nunito, sans-serif`; ctx.textAlign = 'left'; ctx.fillStyle = '#c9c2e8'; ctx.fillText(label, x + 9 * ui, yy + 8 * ui);
      };
      bar(y + 12 * ui, Math.max(0, mp.hp) / 100, '#ff4d6d', '#3ddc97', 'HP');
      bar(y + 29 * ui, mp.fuel / 100, '#ff7b00', '#ffd23f', 'JET');
      const wpn = WEAPONS[mp.w];
      ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.font = `900 ${11 * ui}px Nunito, sans-serif`;
      ctx.fillText(wpn.name.toUpperCase(), x + w - 10 * ui, y + 20 * ui);
      ctx.fillStyle = '#ffd23f'; ctx.font = `400 ${18 * ui}px 'Lilita One', Nunito, sans-serif`;
      ctx.fillText(mp.ammo < 0 ? '∞' : mp.ammo, x + w - 10 * ui, y + 40 * ui);
    }

    // crosshair / hit marker
    if (!TOUCH && mouse.used) {
      const hm = now - hitMarkAt < 150;
      ctx.strokeStyle = hm ? '#ff4d6d' : 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
      const r = hm ? 12 : 9;
      ctx.beginPath(); ctx.arc(mouse.x, mouse.y, r, 0, 7); ctx.moveTo(mouse.x - r - 5, mouse.y); ctx.lineTo(mouse.x - r + 3, mouse.y);
      ctx.moveTo(mouse.x + r - 3, mouse.y); ctx.lineTo(mouse.x + r + 5, mouse.y); ctx.moveTo(mouse.x, mouse.y - r - 5); ctx.lineTo(mouse.x, mouse.y - r + 3);
      ctx.moveTo(mouse.x, mouse.y + r - 3); ctx.lineTo(mouse.x, mouse.y + r + 5); ctx.stroke();
    } else if (now - hitMarkAt < 150 && mp) {
      const [sx, sy] = toScreen(mp.x + Math.cos(aimAngle()) * 110, mp.y + Math.sin(aimAngle()) * 110);
      ctx.strokeStyle = '#ff4d6d'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(sx - 8, sy - 8); ctx.lineTo(sx + 8, sy + 8); ctx.moveTo(sx + 8, sy - 8); ctx.lineTo(sx - 8, sy + 8); ctx.stroke();
    }

    // touch sticks
    if (TOUCH) {
      const drawStick = (s, side) => {
        const idle = !s, ox = s ? s.ox : side === 'L' ? 110 : SW - 110, oy = s ? s.oy : SH - 100;
        const v = stickVec(s);
        ctx.globalAlpha = idle ? 0.35 : 0.8;
        ctx.fillStyle = 'rgba(20,16,50,0.35)'; ctx.beginPath(); ctx.arc(ox, oy, STICK_R, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2; ctx.stroke();
        if (side === 'L') { ctx.strokeStyle = 'rgba(255,183,3,0.7)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(ox, oy, STICK_R - 4, -Math.PI * 0.8, -Math.PI * 0.2); ctx.stroke(); }
        if (side === 'R') { ctx.strokeStyle = 'rgba(255,77,109,0.6)'; ctx.lineWidth = 3; ctx.setLineDash([5, 6]); ctx.beginPath(); ctx.arc(ox, oy, STICK_R * 0.5, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
        const kx = ox + v.x * STICK_R, ky2 = oy + v.y * STICK_R;
        const g = ctx.createRadialGradient(kx - 6, ky2 - 8, 2, kx, ky2, 28);
        g.addColorStop(0, '#fff'); g.addColorStop(1, side === 'L' ? '#ffd23f' : '#ff4d6d');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(kx, ky2, 26, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(20,16,50,0.7)'; ctx.font = '900 11px Nunito'; ctx.textAlign = 'center';
        ctx.fillText(side === 'L' ? 'MOVE' : 'FIRE', kx, ky2 + 4);
        ctx.globalAlpha = 1;
      };
      drawStick(sticks.L, 'L'); drawStick(sticks.R, 'R');
    }

    // big popup text
    if (bigMsg) {
      const age = (now - bigMsg.t) / 1000;
      if (age > 1.3) bigMsg = null;
      else {
        const sc = age < 0.15 ? age / 0.15 * 1.2 : 1.2 - Math.min(0.2, (age - 0.15));
        ctx.globalAlpha = Math.min(1, (1.3 - age) * 3);
        ctx.save(); ctx.translate(SW / 2, SH * 0.3); ctx.scale(sc, sc);
        ctx.font = `400 ${(bigMsg.small ? 24 : 40) * ui}px 'Lilita One', Nunito, sans-serif`; ctx.textAlign = 'center';
        ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(20,15,50,0.85)'; ctx.strokeText(bigMsg.text, 0, 0);
        ctx.fillStyle = bigMsg.color; ctx.fillText(bigMsg.text, 0, 0);
        ctx.restore(); ctx.globalAlpha = 1;
      }
    }

    // dead overlay
    if (mp && !mp.alive && my.inWorld && go <= 0) {
      ctx.fillStyle = 'rgba(20,10,40,0.45)'; ctx.fillRect(0, 0, SW, SH);
      ctx.textAlign = 'center';
      ctx.font = `400 ${54 * ui}px 'Lilita One', Nunito, sans-serif`;
      ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(20,15,50,0.9)';
      const title = deathInfo && deathInfo.how === 'river' ? 'SPLASH!' : 'SPLATTED!';
      ctx.strokeText(title, SW / 2, SH * 0.4); ctx.fillStyle = COLORS[playerInfo(net.you).color]; ctx.fillText(title, SW / 2, SH * 0.4);
      ctx.font = `800 ${18 * ui}px Nunito, sans-serif`; ctx.fillStyle = '#fff';
      const sub = !deathInfo ? '' : deathInfo.how === 'river' ? 'You fell in the river (−1)' : deathInfo.by ? `by ${deathInfo.by.name}` : 'You splatted yourself (−1)';
      ctx.fillText(sub, SW / 2, SH * 0.4 + 34 * ui);
      ctx.font = `400 ${36 * ui}px 'Lilita One', Nunito, sans-serif`; ctx.fillStyle = '#ffd23f';
      ctx.fillText(`Respawning in ${Math.max(1, Math.ceil((mp.resp || RULES.respawnMs) / 1000))}`, SW / 2, SH * 0.4 + 84 * ui);
    }

    // countdown
    if (go > -900) {
      const n = Math.ceil(go / 1000);
      const txt = go > 0 ? String(n) : 'GO!';
      const frac = go > 0 ? (go % 1000) / 1000 : 1 + go / 900;
      if (go > 0 && n !== lastBeep) { lastBeep = n; AU.play('beep', 1, 520); }
      if (go <= 0 && lastBeep !== 0) { lastBeep = 0; AU.play('beep', 1, 1040); }
      ctx.save(); ctx.translate(SW / 2, SH / 2); const sc = 0.8 + frac * 0.6; ctx.scale(sc, sc);
      ctx.globalAlpha = Math.min(1, frac * 2);
      ctx.font = `400 ${110 * ui}px 'Lilita One', Nunito, sans-serif`; ctx.textAlign = 'center';
      ctx.lineWidth = 12; ctx.strokeStyle = 'rgba(20,15,50,0.9)'; ctx.strokeText(txt, 0, 36 * ui);
      ctx.fillStyle = go > 0 ? '#fff' : '#ffd23f'; ctx.fillText(txt, 0, 36 * ui);
      ctx.restore(); ctx.globalAlpha = 1;
      if (go > 0) {
        ctx.font = `800 ${16 * ui}px Nunito, sans-serif`; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
        ctx.fillText(TOUCH ? 'Left stick: move · push up to fly  —  Right stick: aim & fire' : 'A/D move · W/Space jetpack · Mouse aim & fire', SW / 2, SH / 2 + 90 * ui);
      }
    }
  }

  // ------------------------------------------------------------ menu backdrop
  const demoBots = AVATARS.slice(0, 5).map((a, i) => ({ id: 100 + i, avatar: a, color: i * 2 % 8, ph: i * 1.3 }));
  function drawMenuScene(t) {
    setCamScale();
    cam.s = Math.max(cam.s, SH / 900);
    cam.x = 1500 + Math.sin(t * 0.05) * 900;
    cam.y = 900 + Math.sin(t * 0.07) * 120;
    clampCam();
    const bots = demoBots.map((b, i) => {
      const x = cam.x + Math.sin(t * 0.35 + b.ph) * 500 + (i - 2) * 160;
      const y = 700 + Math.sin(t * 0.9 + b.ph * 2) * 160 + (i % 2) * 90;
      const aim = Math.sin(t * 0.6 + b.ph) * 0.6 + (Math.sin(t * 0.35 + b.ph) > 0 ? 0 : Math.PI);
      return { ...b, x, y, aim, weapon: i % 5, vx: 0, jet: Math.cos(t * 0.9 + b.ph * 2) < 0.3, ground: false, hp: 100 };
    });
    screenBegin();
    ART.drawBackground(ctx, cam, t);
    ART.drawTerrain(ctx, cam);
    worldBegin();
    ART.drawFalls(ctx, t);
    for (const k of pickupState) ART.drawPickup(ctx, k, t);
    for (const b of bots) {
      ART.drawAvatar(ctx, { ...b, t });
      if (b.jet && Math.random() < 0.6) P({ x: b.x - (Math.cos(b.aim) >= 0 ? 13 : -13), y: b.y + 34, vx: rnd(-30, 30), vy: rnd(60, 160), life: 0.5, size: rnd(5, 9), color: '#f5efe6', kind: 'smoke', drag: 2 });
      if (Math.random() < 0.02) {
        const a = b.aim;
        P({ x: b.x + Math.cos(a) * 30, y: b.y + Math.sin(a) * 30, vx: Math.cos(a) * 700, vy: Math.sin(a) * 700, g: 300, life: 0.8, size: 6, color: COLORS[b.color], kind: 'drop' });
      }
    }
    drawParts(false);
    ART.drawRiver(ctx, cam, t);
    screenBegin();
    ART.drawVignette(ctx, SW, SH);
  }

  // ------------------------------------------------------------ main loop
  let lastFrame = performance.now(), simAcc = 0, frozenState = null;
  function frame(nowMs) {
    const dt = Math.min(0.05, (nowMs - lastFrame) / 1000); lastFrame = nowMs;
    const t = nowMs / 1000;
    updateParts(dt);
    cam.shake *= Math.pow(0.001, dt); if (cam.shake < 0.3) cam.shake = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    if (view === 'game' && room) {
      const sn = clock.now();
      simAcc = Math.min(simAcc + dt, 0.1);
      while (simAcc >= STEP) { simStep(STEP, clock.now()); simAcc -= STEP; }
      cur = buildCur(sn);
      frozenState = cur;
    }
    if ((view === 'game' || view === 'results') && (view === 'game' ? cur : frozenState)) {
      const state = view === 'game' ? cur : frozenState;
      setCamScale();
      const players = [];
      for (const p of state.p.values()) {
        if (!p.alive) continue;
        const info = playerInfo(p.id);
        players.push({ ...p, avatar: info.avatar, color: info.color, weapon: p.w });
      }
      const mine = players.find((p) => p.id === net.you);
      if (mine) {
        const tx = mine.x + Math.cos(mine.aim) * 80, ty = mine.y - 30 + Math.sin(mine.aim) * 50;
        const k = 1 - Math.pow(0.0005, dt);
        cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
      }
      clampCam();
      players.sort((a, b) => (a.id === net.you) - (b.id === net.you));
      drawWorld(t, players, [...state.b.values()], state.k);
      if (view === 'game') drawHUD(t, clock.now());
      if (AU.jetGain) AU.jetGain.gain.value = view === 'game' && mine && mine.jet && !AU.muted ? 0.07 : 0;
    } else {
      if (AU.jetGain) AU.jetGain.gain.value = 0;
      drawMenuScene(t);
      if (view === 'lobby') drawLobbyAvatars(t);
    }
    screenBegin();
    drawParts(true);
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ UI: menu
  function showView(v) {
    view = v;
    $('menu').classList.toggle('hidden', v !== 'menu');
    $('lobby').classList.toggle('hidden', v !== 'lobby');
    $('results').classList.toggle('hidden', v !== 'results');
    $('hudBtns').classList.toggle('hidden', v !== 'game');
    if (v === 'lobby') renderLobby();
    updateRotate();
  }

  function updateRotate() {
    $('rotate').classList.toggle('hidden', !(TOUCH && view === 'game' && SH > SW));
  }

  let toastTimer = 0;
  function toast(msg, ms = 2200) {
    const el = $('toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  function headCanvas(avatar, colorIdx, size = 64) {
    const c = document.createElement('canvas'); c.width = size * 2; c.height = size * 2;
    const g = c.getContext('2d'); g.scale((size * 2) / 64, (size * 2) / 64);
    g.translate(32, 38);
    ART.drawHead(g, avatar, COLORS[colorIdx], 0.6, 0.1, false);
    return c;
  }

  function buildMenu() {
    const av = $('avatars'); av.innerHTML = '';
    for (const a of AVATARS) {
      const b = document.createElement('button'); b.title = a; b.setAttribute('aria-label', a);
      b.appendChild(headCanvas(a, me.color));
      b.classList.toggle('sel', a === me.avatar);
      b.onclick = () => { me.avatar = a; store.set('avatar', a); buildMenu(); };
      av.appendChild(b);
    }
    const cl = $('colors'); cl.innerHTML = '';
    COLORS.forEach((c, i) => {
      const b = document.createElement('button'); b.style.background = c; b.setAttribute('aria-label', 'colour ' + (i + 1));
      b.classList.toggle('sel', i === me.color);
      b.onclick = () => { me.color = i; store.set('color', i); buildMenu(); };
      cl.appendChild(b);
    });
  }

  function readName() {
    const n = $('name').value.trim();
    if (!n) { $('menuErr').textContent = 'Type a name first!'; $('name').focus(); return false; }
    me.name = n; store.set('name', n); $('menuErr').textContent = '';
    return true;
  }

  function goFullscreen() {
    if (!TOUCH) return;
    const el = document.documentElement;
    const rf = el.requestFullscreen || el.webkitRequestFullscreen;
    if (rf && !document.fullscreenElement) {
      Promise.resolve(rf.call(el)).then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
    }
  }

  let entering = false;
  async function enter(action, code) {
    if (entering) return;
    entering = true;
    AU.init();
    $('create').disabled = $('join').disabled = true;
    try {
      const v = await api({ action, code, name: me.name, avatar: me.avatar, color: me.color, token: me.token });
      beginSession(v);
    } catch (e) { $('menuErr').textContent = e.message; }
    finally { entering = false; $('create').disabled = $('join').disabled = false; }
  }

  function beginSession(v) {
    session = { code: v.code, id: v.you };
    tab.set('session', session);
    evSeq = -1; curMatch = 0; remotes.clear(); claims = [];
    showView('lobby');
    applyView(v);
    syncLoop();
  }

  $('create').onclick = () => { if (readName()) enter('create'); };
  $('join').onclick = () => {
    if (!readName()) return;
    const code = $('code').value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) { $('menuErr').textContent = 'Room codes are 4 letters.'; return; }
    enter('join', code);
  };
  $('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('join').click(); });
  $('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('create').click(); });
  const qp = new URLSearchParams(location.search).get('room');
  if (qp) $('code').value = qp.toUpperCase().slice(0, 4);

  function leaveToMenu(tellServer) {
    if (tellServer && session) api({ action: 'leave', code: session.code, id: session.id, token: me.token }).catch(() => {});
    session = null; tab.set('session', null);
    room = null; net.code = null; net.players = new Map(); frozenState = null; cur = null;
    remotes.clear(); bullets = []; pendingShots = []; my.inWorld = false; my.alive = false;
    showView('menu');
  }

  // ------------------------------------------------------------ UI: lobby
  const lobbyCanvases = new Map();
  let lobbySig = '';
  function renderLobby() {
    if (view !== 'lobby') return;
    const players = [...net.players.values()];
    const sig = JSON.stringify([net.code, net.hostId, players]);
    if (sig === lobbySig) return;
    lobbySig = sig;
    $('roomCode').textContent = net.code || '----';
    const url = location.origin + '/?room=' + (net.code || '');
    $('joinUrl').innerHTML = '';
    $('joinUrl').append('Friends open ');
    const b = document.createElement('b'); b.textContent = url; $('joinUrl').append(b);
    const list = $('plist'); list.innerHTML = ''; lobbyCanvases.clear();
    for (const p of players) {
      const d = document.createElement('div'); d.className = 'pcard' + (p.id === net.you ? ' me' : '');
      const c = document.createElement('canvas'); c.width = 240; c.height = 192; d.appendChild(c);
      lobbyCanvases.set(p.id, c);
      if (p.id === net.hostId) { const cr = document.createElement('div'); cr.className = 'crown'; cr.textContent = '👑'; d.appendChild(cr); }
      const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = p.name; nm.style.color = COLORS[p.color]; d.appendChild(nm);
      const st = document.createElement('div'); const ready = p.ready || p.id === net.hostId;
      st.className = 'st' + (ready ? ' ok' : '');
      st.textContent = !p.connected ? 'Reconnecting…' : p.id === net.hostId ? 'Host' : ready ? '✔ Ready' : 'Not ready';
      d.appendChild(st); list.appendChild(d);
    }
    for (let i = players.length; i < Math.max(2, Math.min(RULES.maxPlayers, players.length + 1)); i++) {
      const d = document.createElement('div'); d.className = 'pcard empty'; d.textContent = 'Waiting for player…'; list.appendChild(d);
    }
    const mine = net.players.get(net.you);
    const isHost = net.you === net.hostId;
    const rb = $('readyBtn');
    rb.classList.toggle('hidden', isHost);
    if (mine) { rb.textContent = mine.ready ? 'Not ready' : "I'm Ready!"; rb.classList.toggle('on', mine.ready); }
    const sb = $('startBtn');
    sb.classList.toggle('hidden', !isHost);
    const present = players.filter((p) => p.connected);
    const allReady = present.every((p) => p.ready || p.id === net.hostId);
    sb.disabled = present.length < RULES.minPlayers || !allReady;
    $('lobbyMsg').textContent = present.length < RULES.minPlayers ? 'Waiting for at least one more player to join…'
      : !allReady ? (isHost ? 'Waiting for everyone to tap Ready…' : 'Tap Ready when you are set!')
      : isHost ? 'Everyone is ready — start the match!' : 'Waiting for the host to start…';
  }
  function drawLobbyAvatars(t) {
    for (const [id, c] of lobbyCanvases) {
      const p = net.players.get(id); if (!p) continue;
      const g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
      const gl = g.createRadialGradient(120, 110, 10, 120, 110, 100);
      gl.addColorStop(0, ART.rgba(COLORS[p.color], 0.45)); gl.addColorStop(1, ART.rgba(COLORS[p.color], 0));
      g.fillStyle = gl; g.fillRect(0, 0, c.width, c.height);
      const aim = Math.sin(t * 0.8 + id) * 0.5 - 0.1;
      ART.drawAvatar(g, { id, x: 120, y: 100 + Math.sin(t * 2 + id) * 5, avatar: p.avatar, color: p.color, aim, weapon: id % 5, vx: 0, ground: false, jet: true, t, scale: 2.2 });
    }
  }
  $('readyBtn').onclick = () => { const mine = net.players.get(net.you); command('ready', { v: !(mine && mine.ready) }); };
  $('startBtn').onclick = () => { $('startBtn').disabled = true; command('start').finally(() => { lobbySig = ''; renderLobby(); }); };
  $('leaveBtn').onclick = () => leaveToMenu(true);
  $('leave2Btn').onclick = () => leaveToMenu(true);
  $('againBtn').onclick = () => command('lobby');

  // ------------------------------------------------------------ game start / results
  function startGame(v) {
    curMatch = v.match;
    ART.resetDecals();
    frozenState = null; cur = null; killfeed.length = 0; parts.length = 0; deathInfo = null; bigMsg = null; lastBeep = -1;
    bullets = []; pendingShots = []; myShots = []; claims = []; pendingDeathUntil = 0;
    for (const r of remotes.values()) { r.buf = []; r.lastT = 0; r.wasAlive = false; }
    for (const k in pickupTaken) delete pickupTaken[k];
    Object.assign(my, { alive: false, inWorld: false, jetTime: 0, w: 0, ammo: -1 });
    showView('game');
    goFullscreen();
  }

  function showResults(res) {
    showView('results');
    const list = res.players;
    const top = list[0];
    $('winTitle').textContent = top ? `${top.name} wins!` : 'Match over';
    if (top && top.id === net.you) AU.play('win'); else AU.play('score');
    const pod = $('podium'); pod.innerHTML = '';
    for (const i of [1, 0, 2]) {
      const p = list[i]; if (!p) continue;
      const d = document.createElement('div'); d.className = 'pod p' + (i + 1);
      const c = document.createElement('canvas'); c.width = 240; c.height = 240;
      ART.drawAvatar(c.getContext('2d'), { id: p.id, x: 120, y: 130, avatar: p.avatar, color: p.color, aim: i === 0 ? -0.8 : -0.2, weapon: i === 0 ? 4 : 0, vx: 0, ground: true, jet: false, t: 0.5, scale: 2.8 });
      d.appendChild(c);
      const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = p.name; nm.style.color = COLORS[p.color]; d.appendChild(nm);
      const sc = document.createElement('div'); sc.className = 'sc'; sc.textContent = `${p.score} pts`; d.appendChild(sc);
      const blk = document.createElement('div'); blk.className = 'blk'; blk.textContent = i + 1; d.appendChild(blk);
      pod.appendChild(d);
    }
    const aw = $('awards'); aw.innerHTML = '';
    for (const a of res.awards) {
      const p = list.find((q) => q.id === a.id); if (!p) continue;
      const d = document.createElement('div'); d.className = 'award';
      d.innerHTML = `<div class="ic"></div><div class="tt"></div><div class="wn"></div><div class="vl"></div>`;
      d.querySelector('.ic').textContent = a.icon;
      d.querySelector('.tt').textContent = a.title; d.querySelector('.wn').textContent = p.name; d.querySelector('.wn').style.color = COLORS[p.color];
      d.querySelector('.vl').textContent = a.value;
      aw.appendChild(d);
    }
    const tb = $('table');
    tb.innerHTML = '<tr><th>#</th><th>Player</th><th>Score</th><th>Splats</th><th>Splatted</th></tr>';
    list.forEach((p, i) => {
      const tr = document.createElement('tr'); if (p.id === net.you) tr.className = 'me';
      tr.innerHTML = `<td>${i + 1}</td><td><span class="dot"></span><span class="n"></span></td><td>${p.score}</td><td>${p.splats}</td><td>${p.deaths}</td>`;
      tr.querySelector('.dot').style.background = COLORS[p.color]; tr.querySelector('.n').textContent = p.name;
      tb.appendChild(tr);
    });
    renderResultsButtons();
    for (let i = 0; i < 160; i++) P({ screen: true, x: rnd(0, SW), y: rnd(-SH * 0.6, -10), vx: rnd(-60, 60), vy: rnd(80, 260), g: 60, vr: rnd(-8, 8), life: rnd(3, 6), size: rnd(4, 7), color: COLORS[(Math.random() * 8) | 0], kind: 'conf' });
  }
  function renderResultsButtons() {
    if (view !== 'results') return;
    const isHost = net.you === net.hostId;
    $('againBtn').classList.toggle('hidden', !isHost);
    $('resultsMsg').textContent = isHost ? '' : 'Waiting for the host…';
  }

  $('fsBtn').onclick = () => {
    const el = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen(); else (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
  };
  $('muteBtn').onclick = () => { AU.setMuted(!AU.muted); $('muteBtn').textContent = AU.muted ? '🔇' : '🔊'; };
  $('muteBtn').textContent = AU.muted ? '🔇' : '🔊';

  // ------------------------------------------------------------ boot
  resize();
  ART.init();
  $('name').value = me.name;
  buildMenu();
  showView('menu');
  requestAnimationFrame(frame);
  document.fonts && document.fonts.ready.then(() => buildMenu());
  // a reload mid-game drops you straight back into your room
  const saved = tab.get('session');
  if (saved && saved.code) {
    api({ action: 'join', code: saved.code, name: me.name, avatar: me.avatar, color: me.color, token: me.token })
      .then(beginSession)
      .catch(() => tab.set('session', null));
  }
})();
