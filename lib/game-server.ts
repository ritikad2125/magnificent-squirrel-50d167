// Paint Militia — serverless referee.
// Each browser simulates its own player and posts ~10 syncs/sec. This module keeps the
// authoritative room record (players, health, scores, pickups, match clock, events) in
// Netlify Blobs, using strong consistency and ETag-conditional writes (compare-and-swap).
import { getStore } from "@netlify/blobs";
// shared.js is a plain script also loaded by the browser; esbuild bundles it as CommonJS.
// @ts-ignore -- no type declarations for the browser script
import SharedModule from "../public/shared.js";

type Store = ReturnType<typeof getStore>;

interface Weapon { key: string; name: string; dmg: number }
interface Pickup { kind: string; x: number; y: number }
interface Life { hp: number; hpAt: number; lastHit: number; alive: boolean; respawnAt: number; inv: number; killer: number; how: string }
interface Shared {
  WEAPONS: Weapon[]; PICKUPS: Pickup[]; COLORS: string[]; AVATARS: string[];
  WORLD: { water: number };
  RULES: { matchSeconds: number; target: number; maxPlayers: number; minPlayers: number; respawnMs: number; spawnProtectMs: number; pickupRespawnMs: number; countdownMs: number };
  lifeAt(l: Life | undefined, now: number): Life;
}
const S = SharedModule as Shared;

interface PlayerMeta { id: number; name: string; avatar: string; color: number; ready: boolean; token: string; joined: number }
interface Score { score: number; splats: number; deaths: number }
interface GameEvent { s: number; e: (string | number)[] }
interface Results {
  players: { id: number; name: string; avatar: string; color: number; score: number; splats: number; deaths: number; jet: number }[];
  awards: { title: string; icon: string; id: number; value: string }[];
}
export interface Room {
  code: string; created: number; hostId: number; nextId: number;
  state: "lobby" | "playing" | "ended"; match: number; startAt: number; endAt: number;
  players: Record<string, PlayerMeta>; life: Record<string, Life>; scores: Record<string, Score>;
  pickups: number[]; seq: number; events: GameEvent[]; results: Results | null;
}
export interface PlayerState {
  t: number; at: number; x: number; y: number; vx: number; vy: number; aim: number; w: number; ammo: number;
  fuel: number; jet: boolean; ground: boolean; a: boolean; jt: number; shots: Shot[];
}
interface Shot { id: string; t: number; x: number; y: number; vx0: number; vy0: number; w: number; c: number; pel: [number, number][] }
interface Claim { k: string; v?: number; d?: number; w?: number; x?: number; y?: number; kx?: number; ky?: number; i?: number }

const STORE_NAME = "paint-militia";
const ONLINE_MS = 10_000;
const PRUNE_MS = 30_000;
const MAX_EVENTS = 120;

class GameError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
// optional overrides, only used by the automated tests
const matchMs = () => (Number(process.env.PM_MATCH_SECONDS) || S.RULES.matchSeconds) * 1000;
const target = () => Number(process.env.PM_TARGET) || S.RULES.target;

const metaKey = (code: string) => `rooms/${code}/meta`;
const stateKey = (code: string, id: number, token: string) => `rooms/${code}/p/${id}-${token}`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function cleanName(n: unknown): string {
  const s = String(n ?? "").replace(/[^\p{L}\p{N} _\-!.]/gu, "").trim().slice(0, 14);
  return s || "Player";
}
function cleanCode(c: unknown): string {
  const s = String(c ?? "").toUpperCase().trim();
  if (!/^[A-Z]{4}$/.test(s)) throw new GameError(400, "Room codes are 4 letters.");
  return s;
}
function cleanToken(t: unknown): string {
  const s = String(t ?? "");
  if (!/^[a-z0-9]{8,40}$/i.test(s)) throw new GameError(400, "Missing player token.");
  return s;
}
function makeCode(): string {
  const L = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from({ length: 4 }, () => L[Math.floor(Math.random() * L.length)]).join("");
}

function sanitizeState(raw: unknown, now: number): PlayerState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const shots: Shot[] = [];
  if (Array.isArray(r.shots)) {
    for (const s of r.shots.slice(-40)) {
      if (!s || typeof s !== "object") continue;
      const o = s as Record<string, unknown>;
      const pel = Array.isArray(o.pel) ? o.pel.slice(0, 8).map((p) => [num((p as number[])[0]), num((p as number[])[1])] as [number, number]) : [];
      shots.push({
        id: String(o.id ?? "").slice(0, 24), t: num(o.t), x: num(o.x), y: num(o.y), vx0: num(o.vx0), vy0: num(o.vy0),
        w: clamp(Math.round(num(o.w)), 0, S.WEAPONS.length - 1), c: clamp(Math.round(num(o.c)), 0, S.COLORS.length - 1), pel,
      });
    }
  }
  return {
    t: num(r.t, now), at: now, x: num(r.x), y: num(r.y), vx: num(r.vx), vy: num(r.vy), aim: num(r.aim),
    w: clamp(Math.round(num(r.w)), 0, S.WEAPONS.length - 1), ammo: Math.round(num(r.ammo, -1)),
    fuel: clamp(num(r.fuel, 100), 0, 100), jet: !!r.jet, ground: !!r.ground, a: !!r.a, jt: Math.max(0, num(r.jt)), shots,
  };
}

// ---------------------------------------------------------------- blob access
async function readRoom(store: Store, code: string): Promise<{ room: Room; etag: string }> {
  const res = await store.getWithMetadata(metaKey(code), { type: "json", consistency: "strong" });
  if (!res || !res.data) throw new GameError(404, "No room with that code. Check the letters!");
  return { room: res.data as Room, etag: res.etag as string };
}

// Optimistic concurrency: apply `fn` to the latest room, write only if nobody else wrote in between.
async function mutate(store: Store, code: string, first: { room: Room; etag: string } | null, fn: (r: Room) => boolean): Promise<Room> {
  let cur = first;
  for (let attempt = 0; attempt < 12; attempt++) {
    if (!cur) cur = await readRoom(store, code);
    const draft = structuredClone(cur.room);
    if (!fn(draft)) return draft;
    const res = await store.setJSON(metaKey(code), draft, { onlyIfMatch: cur.etag });
    if (res.modified) return draft;
    cur = null;
    await new Promise((r) => setTimeout(r, 5 + Math.random() * 25 * (attempt + 1)));
  }
  throw new GameError(503, "The room is busy — please try again.");
}

async function readStates(store: Store, room: Room, code: string, skip: number): Promise<Record<string, PlayerState>> {
  const out: Record<string, PlayerState> = {};
  await Promise.all(Object.values(room.players).map(async (p) => {
    if (p.id === skip) return;
    const st = await store.get(stateKey(code, p.id, p.token), { type: "json", consistency: "strong" });
    if (st) out[p.id] = st as PlayerState;
  }));
  return out;
}

// ---------------------------------------------------------------- room rules
function newRoom(code: string, now: number): Room {
  return {
    code, created: now, hostId: 0, nextId: 1, state: "lobby", match: 0, startAt: 0, endAt: 0,
    players: {}, life: {}, scores: {}, pickups: S.PICKUPS.map(() => 0), seq: 0, events: [], results: null,
  };
}

function freshLife(at: number): Life {
  return { hp: 100, hpAt: at, lastHit: 0, alive: true, respawnAt: 0, inv: at + S.RULES.spawnProtectMs, killer: 0, how: "" };
}

function pushEvent(r: Room, e: (string | number)[]) {
  r.seq++;
  r.events.push({ s: r.seq, e });
  if (r.events.length > MAX_EVENTS) r.events.splice(0, r.events.length - MAX_EVENTS);
}

function isOnline(r: Room, id: number, states: Record<string, PlayerState>, now: number): boolean {
  const st = states[id];
  const seen = st ? st.at : r.players[id]?.joined ?? 0;
  return now - seen < ONLINE_MS;
}

function addPlayer(r: Room, msg: Record<string, unknown>, token: string, now: number): PlayerMeta {
  const used = new Set(Object.values(r.players).map((p) => p.color));
  let color = clamp(Math.round(num(msg.color)), 0, S.COLORS.length - 1);
  if (used.has(color)) color = S.COLORS.findIndex((_, i) => !used.has(i));
  if (color < 0) color = 0;
  const names = new Set(Object.values(r.players).map((p) => p.name.toLowerCase()));
  let name = cleanName(msg.name);
  if (names.has(name.toLowerCase())) for (let i = 2; ; i++) { const n = name.slice(0, 12) + i; if (!names.has(n.toLowerCase())) { name = n; break; } }
  const p: PlayerMeta = {
    id: r.nextId++, name, avatar: S.AVATARS.includes(String(msg.avatar)) ? String(msg.avatar) : S.AVATARS[0],
    color, ready: false, token, joined: now,
  };
  r.players[p.id] = p;
  if (!r.hostId) { r.hostId = p.id; p.ready = true; }
  if (r.state !== "lobby") {
    r.scores[p.id] = { score: 0, splats: 0, deaths: 0 };
    r.life[p.id] = freshLife(Math.max(now, r.startAt));
  }
  return p;
}

function removePlayer(r: Room, id: number) {
  delete r.players[id]; delete r.life[id]; delete r.scores[id];
}

function startMatch(r: Room, now: number) {
  r.state = "playing";
  r.match++;
  r.startAt = now + S.RULES.countdownMs + 500;
  r.endAt = r.startAt + matchMs();
  r.results = null;
  r.pickups = S.PICKUPS.map(() => 0);
  r.events = [];
  r.scores = {}; r.life = {};
  for (const id of Object.keys(r.players)) {
    r.scores[id] = { score: 0, splats: 0, deaths: 0 };
    r.life[id] = freshLife(r.startAt);
  }
  pushEvent(r, ["start", r.match]);
}

function endMatch(r: Room, states: Record<string, PlayerState>) {
  r.state = "ended";
  const list = Object.values(r.players).map((p) => {
    const sc = r.scores[p.id] ?? { score: 0, splats: 0, deaths: 0 };
    return { id: p.id, name: p.name, avatar: p.avatar, color: p.color, score: sc.score, splats: sc.splats, deaths: sc.deaths, jet: Math.round((states[p.id]?.jt ?? 0) * 10) / 10 };
  });
  list.sort((a, b) => b.score - a.score || a.deaths - b.deaths || b.splats - a.splats);
  const pick = <T>(f: (p: typeof list[number]) => T, better: (a: T, b: T) => boolean) =>
    list.length ? list.reduce((a, b) => (better(f(b), f(a)) ? b : a)) : null;
  const awards: Results["awards"] = [];
  const ms = pick((p) => p.splats, (a, b) => a > b);
  if (ms && ms.splats > 0) awards.push({ title: "Most Splats", icon: "🎯", id: ms.id, value: ms.splats + (ms.splats === 1 ? " splat" : " splats") });
  const ls = pick((p) => p.deaths, (a, b) => a < b);
  if (ls) awards.push({ title: "Least Splatted", icon: "🛡️", id: ls.id, value: ls.deaths + (ls.deaths === 1 ? " time" : " times") });
  const sa = pick((p) => p.jet, (a, b) => a > b);
  if (sa && sa.jet > 0) awards.push({ title: "Sky Ace", icon: "🚀", id: sa.id, value: sa.jet.toFixed(1) + "s airborne" });
  r.results = { players: list, awards };
  pushEvent(r, ["end", r.match]);
}

function kill(r: Room, victim: number, killer: number, how: string, now: number, x: number, y: number) {
  const L = S.lifeAt(r.life[victim], now);
  if (!L.alive) return;
  if (killer === victim) killer = 0;
  r.life[victim] = { ...L, hp: 0, hpAt: now, alive: false, respawnAt: now + S.RULES.respawnMs, inv: now + S.RULES.respawnMs + S.RULES.spawnProtectMs, killer, how };
  const vs = (r.scores[victim] ??= { score: 0, splats: 0, deaths: 0 });
  vs.deaths++;
  if (killer && r.players[killer]) {
    const ks = (r.scores[killer] ??= { score: 0, splats: 0, deaths: 0 });
    ks.score++; ks.splats++;
  } else vs.score--;
  pushEvent(r, ["splat", killer, victim, how, Math.round(x), Math.round(y)]);
}

function damage(r: Room, victim: number, amount: number, attacker: number, how: string, now: number, x: number, y: number) {
  const L = S.lifeAt(r.life[victim], now);
  if (!L.alive || now < L.inv) return;
  const hp = L.hp - amount;
  r.life[victim] = { ...L, hp, hpAt: now, lastHit: now };
  pushEvent(r, ["hit", victim, Math.round(amount), attacker]);
  if (hp <= 0) kill(r, victim, attacker, how, now, x, y);
}

function applyClaims(r: Room, id: number, claims: Claim[], now: number, granted: number[]): boolean {
  if (r.state !== "playing" || now < r.startAt - 250 || !claims.length) return false;
  let changed = false;
  for (const c of claims.slice(0, 40)) {
    if (!c || typeof c !== "object") continue;
    if (c.k === "hit") {
      const v = Math.round(num(c.v)), w = S.WEAPONS[Math.round(num(c.w, -1))];
      if (!r.players[v] || !w) continue;
      const dmg = clamp(num(c.d), 0, w.dmg);
      if (dmg <= 0) continue;
      const before = r.seq;
      damage(r, v, dmg, id, w.key, now, num(c.x), num(c.y));
      if (r.seq !== before && (c.kx || c.ky)) pushEvent(r, ["kb", v, Math.round(clamp(num(c.kx), -900, 900)), Math.round(clamp(num(c.ky), -900, 900))]);
      changed ||= r.seq !== before;
    } else if (c.k === "fall") {
      const before = r.seq;
      kill(r, id, 0, "river", now, num(c.x), S.WORLD.water);
      if (r.seq !== before) { pushEvent(r, ["fall", Math.round(num(c.x))]); changed = true; }
    } else if (c.k === "pick") {
      const i = Math.round(num(c.i, -1)), p = S.PICKUPS[i];
      if (!p || r.pickups[i] > now) continue;
      const L = S.lifeAt(r.life[id], now);
      if (!L.alive) continue;
      if (p.kind === "health") {
        if (L.hp >= 100) continue;
        r.life[id] = { ...L, hp: Math.min(100, L.hp + 50), hpAt: now };
      }
      r.pickups[i] = now + S.RULES.pickupRespawnMs;
      granted.push(i);
      pushEvent(r, ["pick", id, p.kind, i]);
      changed = true;
    }
  }
  return changed;
}

// housekeeping any request may perform: host hand-off, pruning, ending the match
function maintain(r: Room, states: Record<string, PlayerState>, now: number): boolean {
  let changed = false;
  if (r.state === "lobby") {
    for (const p of Object.values(r.players)) {
      const seen = states[p.id]?.at ?? p.joined;
      if (now - seen > PRUNE_MS) { removePlayer(r, p.id); changed = true; }
    }
  }
  if (!r.players[r.hostId] || !isOnline(r, r.hostId, states, now)) {
    const next = Object.values(r.players).find((p) => isOnline(r, p.id, states, now));
    if (next && next.id !== r.hostId) { r.hostId = next.id; next.ready = true; changed = true; }
  }
  if (r.state === "playing") {
    const t = target();
    const reached = Object.values(r.scores).some((s) => s.score >= t);
    if (reached || now >= r.endAt) { endMatch(r, states); changed = true; }
  }
  return changed;
}

function view(r: Room, you: number, states: Record<string, PlayerState>, now: number, since: number, granted: number[]) {
  const life: Record<string, unknown> = {};
  for (const [id, l] of Object.entries(r.life)) {
    const L = S.lifeAt(l, now);
    life[id] = { hp: Math.ceil(L.hp), hpAt: L.hpAt, lastHit: L.lastHit, alive: L.alive, respawnAt: L.respawnAt, inv: L.inv, killer: L.killer, how: L.how };
  }
  const others: Record<string, PlayerState> = {};
  if (r.state === "playing") for (const [id, st] of Object.entries(states)) if (+id !== you) others[id] = st;
  return {
    now, code: r.code, you, hostId: r.hostId, state: r.state, match: r.match, startAt: r.startAt, endAt: r.endAt, target: target(),
    players: Object.values(r.players).map((p) => ({
      id: p.id, name: p.name, avatar: p.avatar, color: p.color, ready: p.ready || p.id === r.hostId, connected: isOnline(r, p.id, states, now),
    })),
    life, scores: r.scores, pickups: r.pickups, seq: r.seq,
    events: since >= 0 ? r.events.filter((e) => e.s > since) : [],
    results: r.results, states: others, granted,
  };
}

// ---------------------------------------------------------------- actions
async function create(store: Store, msg: Record<string, unknown>) {
  const token = cleanToken(msg.token);
  const now = Date.now();
  for (let attempt = 0; attempt < 12; attempt++) {
    const r = newRoom(makeCode(), now);
    const p = addPlayer(r, msg, token, now);
    const res = await store.setJSON(metaKey(r.code), r, { onlyIfNew: true });
    if (res.modified) return json(view(r, p.id, {}, now, -1, []));
  }
  throw new GameError(503, "Could not create a room — please try again.");
}

async function join(store: Store, msg: Record<string, unknown>) {
  const code = cleanCode(msg.code), token = cleanToken(msg.token);
  const now = Date.now();
  let you = 0;
  const room = await mutate(store, code, null, (r) => {
    const existing = Object.values(r.players).find((p) => p.token === token);
    if (existing) { you = existing.id; existing.joined = now; return true; }
    if (Object.keys(r.players).length >= S.RULES.maxPlayers) throw new GameError(409, "That room is full (8 players max).");
    you = addPlayer(r, msg, token, now).id;
    return true;
  });
  const states = await readStates(store, room, code, you);
  return json(view(room, you, states, now, -1, []));
}

async function act(store: Store, msg: Record<string, unknown>) {
  const code = cleanCode(msg.code), token = cleanToken(msg.token);
  const id = Math.round(num(msg.id));
  const action = String(msg.action);
  const now = Date.now();
  const st = sanitizeState(msg.st, now);
  const pKey = stateKey(code, id, token);

  // round 1: read the room and publish my state in parallel
  const [first] = await Promise.all([readRoom(store, code), st ? store.setJSON(pKey, st) : null]);
  const me = first.room.players[id];
  if (!me || me.token !== token) {
    if (st) await store.delete(pKey).catch(() => {});
    throw new GameError(403, "You are no longer in this room.");
  }

  // round 2: everyone else's latest state
  const states = await readStates(store, first.room, code, id);
  if (st) states[id] = st;
  else if (me) {
    const mine = await store.get(pKey, { type: "json", consistency: "strong" });
    if (mine) states[id] = mine as PlayerState;
  }

  const claims = Array.isArray(msg.claims) ? (msg.claims as Claim[]) : [];
  const granted: number[] = [];
  const apply = (r: Room): boolean => {
    granted.length = 0;
    let changed = false;
    const p = r.players[id];
    if (!p) throw new GameError(403, "You are no longer in this room.");
    switch (action) {
      case "sync":
        changed = applyClaims(r, id, claims, now, granted);
        break;
      case "ready":
        if (r.state === "lobby") { p.ready = !!msg.v || id === r.hostId; changed = true; }
        break;
      case "look":
        if (r.state === "lobby") {
          if (S.AVATARS.includes(String(msg.avatar))) p.avatar = String(msg.avatar);
          changed = true;
        }
        break;
      case "start": {
        if (id !== r.hostId) throw new GameError(403, "Only the host can start.");
        if (r.state !== "lobby") break;
        const present = Object.values(r.players).filter((q) => isOnline(r, q.id, states, now));
        if (present.length < S.RULES.minPlayers) throw new GameError(400, "Need at least 2 players to start.");
        if (present.some((q) => !q.ready && q.id !== r.hostId)) throw new GameError(400, "Everyone needs to tap Ready first.");
        for (const q of Object.values(r.players)) if (!present.includes(q)) removePlayer(r, q.id);
        startMatch(r, now);
        changed = true;
        break;
      }
      case "lobby":
        if (id === r.hostId && r.state === "ended") {
          r.state = "lobby";
          for (const q of Object.values(r.players)) {
            q.ready = q.id === r.hostId;
            if (!isOnline(r, q.id, states, now)) removePlayer(r, q.id);
          }
          changed = true;
        }
        break;
      case "leave":
        removePlayer(r, id);
        if (r.hostId === id) r.hostId = 0;
        changed = true;
        break;
      default:
        throw new GameError(400, "Unknown action.");
    }
    return maintain(r, states, now) || changed;
  };

  let room: Room;
  const probe = structuredClone(first.room);
  const needsWrite = action !== "sync" || claims.length > 0 || maintain(probe, states, now);
  room = needsWrite ? await mutate(store, code, first, apply) : first.room;
  if (action === "leave") {
    await store.delete(pKey).catch(() => {});
    return json({ ok: true, now });
  }
  return json(view(room, id, states, now, Math.round(num(msg.since, -1)), granted));
}

export async function handle(req: Request, injected?: Store): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  let msg: Record<string, unknown>;
  try { msg = (await req.json()) as Record<string, unknown>; } catch { return json({ error: "Bad JSON." }, 400); }
  if (!msg || typeof msg !== "object") return json({ error: "Bad request." }, 400);
  const store = injected ?? getStore({ name: STORE_NAME, consistency: "strong" });
  try {
    if (msg.action === "create") return await create(store, msg);
    if (msg.action === "join") return await join(store, msg);
    return await act(store, msg);
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message, now: Date.now() }, e.status);
    console.error(e);
    return json({ error: "Server error — please try again.", now: Date.now() }, 500);
  }
}
