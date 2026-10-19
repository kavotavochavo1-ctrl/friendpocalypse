// live/sim.js — FRIENDPOCALYPSE: deterministic co-op survivor-like sim, fixed 120 Hz, 1–8 players (humans or bots).
// Contract (engine.md §6): create / step / at / spawn / respawn / outOfPlay / scriptInput; events in S.ev.
// Host-authoritative: the host steps S with every player's input ({ players: { id: inp } }) and ships S to clients.
// Every reaction (whips, clouds, cards, rockets, revives, combos, voice lines) lives here so all clients see the same.
(function (root) {
  const DT = 1 / 120, L = 36.0;
  const VIEW = { W: 1920, H: 1080 }, WORLD = { x0: 0, y0: 0, x1: 5200, y1: 3800 };
  const C = [2600, 1900];                                                    // plaza centre
  const PLAZA = [600, 500];                                                  // plaza radii (3/4 view squash)
  const HINT = 'WASD — бег · Space — рывок · Q — способность · R — ульта · E — поднять друга · 1/2/3 — улучшение';
  const h1 = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  const h2 = (a, b) => h1(a * 12.9898 + b * 78.233);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

  // ---------------- heroes ----------------
  const HEROES = {
    hasan: { name: 'ХАСАН', hp: 85, spd: 275, col: [0.85, 0.55, 0.25], pick: 1.2 },
    danil: { name: 'ДАНИЛ', hp: 100, spd: 262, col: [1.0, 0.35, 0.75], pick: 1.0 },
    vitya: { name: 'ВИТЯ', hp: 100, spd: 266, col: [0.55, 0.95, 0.25], pick: 1.0 },
    leha: { name: 'ЛЁХА', hp: 140, spd: 232, col: [0.6, 0.7, 0.35], pick: 1.0 },
  };
  const ORDER = ['hasan', 'danil', 'vitya', 'leha'];
  const QCD = { hasan: 16, danil: 20, vitya: 18, leha: 22 };
  const LEHA_GUNS = ['ПИСТОЛЕТ', 'ПП', 'ДРОБОВИК', 'РПГ'];

  // ---------------- enemies ----------------
  const ETYPES = {
    ghoul: { hp: 22, spd: 112, r: 22, dmg: 9, xp: 1, sc: 1.0, from: 1 },
    sprinter: { hp: 12, spd: 205, r: 18, dmg: 6, xp: 1, sc: 0.8, from: 2 },
    brute: { hp: 130, spd: 72, r: 38, dmg: 18, xp: 5, sc: 1.65, from: 3 },
    spitter: { hp: 28, spd: 90, r: 22, dmg: 8, xp: 2, sc: 1.05, from: 4, ranged: 1 },
    bomber: { hp: 18, spd: 150, r: 22, dmg: 26, xp: 2, sc: 1.0, from: 5, bomb: 1 },
  };
  const WAVE_LEN = 60, BREAK = 9, WAVES = 10;
  const COOP = [1, 1, 1.65, 2.2, 2.7, 3.15, 3.55, 3.95, 4.3], COOP_HP = [1, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35];

  // ---------------- upgrades (3 cards per team level) ----------------
  const UPG = {
    dmg: { n: 'Злость', d: '+18% урона', f: (p) => (p.m.dmg *= 1.18) },
    as: { n: 'Кофеин', d: '+14% скорости атаки', f: (p) => (p.m.as *= 1.14) },
    area: { n: 'Размах', d: '+15% радиуса атак', f: (p) => (p.m.area *= 1.15) },
    hp: { n: 'Шаурма', d: '+25 к макс. HP и лечение', f: (p) => { p.hpMax += 25; p.hp = Math.min(p.hpMax, p.hp + 40); } },
    spd: { n: 'Кроссовки', d: '+9% скорости бега', f: (p) => (p.m.spd *= 1.09) },
    pick: { n: 'Магнит', d: '+35% радиус сбора', f: (p) => (p.m.pick *= 1.35) },
    armor: { n: 'Толстокожий', d: '-12% входящего урона', f: (p) => (p.m.armor *= 0.88) },
    regen: { n: 'Энергетик', d: 'Реген 1.2 HP/с', f: (p) => (p.m.regen += 1.2) },
    crit: { n: 'Везунчик', d: '+12% шанс крита (×2)', f: (p) => (p.m.crit += 0.12) },
    cd: { n: 'Без перерыва', d: '-15% перезарядка Q', f: (p) => (p.m.cd *= 0.85) },
    h_octo: { n: 'Осьминог', d: 'Хасан: +1 ус на удар', hero: 'hasan', f: (p) => (p.m.extra += 1) },
    h_oil: { n: 'Масло для усов', d: 'Хасан: стягивание каждым 2-м ударом', hero: 'hasan', f: (p) => (p.m.pullN = 2) },
    d_foil: { n: 'Фольга', d: 'Данил: +1 карточка за бросок', hero: 'danil', f: (p) => (p.m.extra += 1) },
    d_rico: { n: 'Рикошет', d: 'Данил: +1 отскок карты', hero: 'danil', f: (p) => (p.m.rico += 1) },
    v_chem: { n: 'Химик', d: 'Витя: облака дольше и злее', hero: 'vitya', f: (p) => { p.m.ttl *= 1.25; p.m.dmg *= 1.1; } },
    v_deo: { n: 'Дезодорант', d: 'Витя: друзьям почти не больно', hero: 'vitya', f: (p) => (p.m.deo *= 0.35) },
    v_beans: { n: 'Гороховый суп', d: 'Витя: пукает чаще', hero: 'vitya', f: (p) => (p.m.as *= 1.3) },
    l_gun: { n: 'Оружейная лицензия', d: 'Лёха: следующее оружие', hero: 'leha', max: 3, f: (p) => (p.tier = Math.min(3, p.tier + 1)) },
    l_plate: { n: 'Бронеплита', d: 'Лёха: щит дольше, -урон', hero: 'leha', f: (p) => { p.m.shield += 1.5; p.m.armor *= 0.9; } },
  };
  const UPG_IDS = Object.keys(UPG);

  // ---------------- the level, as data ----------------
  // paved areas (drawn + spawn-safe): rects [cx, cy, w, h, rot] and sub-plazas [x, y, rx, ry]
  const PATHS = [[C[0], 950, 330, 1900, 0], [C[0], 2850, 330, 1900, 0], [1150, C[1], 2300, 300, 0], [4050, C[1], 2300, 300, 0],
    [1950, 1400, 1300, 220, 0.66], [3250, 1400, 1300, 220, -0.66], [1950, 2400, 1300, 220, -0.66], [3250, 2400, 1300, 220, 0.66]];
  const SUBS = [[1250, 820, 330, 270, 'statue'], [3950, 820, 360, 290, 'gazebo'], [1250, 2980, 330, 270, 'pergola'], [3950, 2980, 400, 300, 'pond']];
  const onPave = (x, y) => {
    if (((x - C[0]) / PLAZA[0]) ** 2 + ((y - C[1]) / PLAZA[1]) ** 2 < 1) return true;
    for (const [sx, sy, rx, ry] of SUBS) if (((x - sx) / rx) ** 2 + ((y - sy) / ry) ** 2 < 1) return true;
    for (const [cx, cy, w, h, r] of PATHS) { const dx = x - cx, dy = y - cy, c = Math.cos(-r), s = Math.sin(-r);
      if (Math.abs(dx * c - dy * s) < w / 2 && Math.abs(dx * s + dy * c) < h / 2) return true; }
    return false;
  };
  // props: [kind, x, y, scale, flip]
  const PROPS = [];
  const addP = (k, x, y, s = 1, f = 0) => PROPS.push([k, Math.round(x), Math.round(y), s, f]);
  // lamps ring the plaza (the reference's light pools) and line the paths
  for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * Math.PI * 2; addP('lamp', C[0] + Math.cos(a) * (PLAZA[0] + 70), C[1] + Math.sin(a) * (PLAZA[1] + 60)); }
  for (const d of [-1, 1]) for (let k = 1; k <= 3; k++) { const off = PLAZA[1] + 380 * k; addP('lamp', C[0] - 210, C[1] + d * off); addP('lamp', C[0] + 210, C[1] + d * off); }
  for (const d of [-1, 1]) for (let k = 1; k <= 3; k++) { const off = PLAZA[0] + 420 * k; addP('lamp', C[0] + d * off, C[1] - 190); addP('lamp', C[0] + d * off, C[1] + 210); }
  for (const [x, y, rx, ry] of SUBS) for (let i = 0; i < 4; i++) { const a = (i + 0.5) / 4 * Math.PI * 2; addP('lamp', x + Math.cos(a) * (rx + 40), y + Math.sin(a) * (ry + 40)); }
  // benches face the plaza from its rim, between the lamps
  for (let i = 0; i < 8; i++) { if (i % 2) continue; const a = i / 8 * Math.PI * 2 + 0.05; addP('bench', C[0] + Math.cos(a) * (PLAZA[0] + 95), C[1] + Math.sin(a) * (PLAZA[1] + 75)); }
  // hedges + fences frame the garden beds along the plaza (gaps where the paths enter)
  for (let i = 0; i < 16; i++) { const a = (i + 0.5) / 16 * Math.PI * 2, n = ((a / (Math.PI / 4)) % 2 + 2) % 2;
    if (n < 0.45 || n > 1.55) continue;                                       // path openings at the 8 path directions
    addP(i % 3 ? 'bush' : 'fence', C[0] + Math.cos(a) * (PLAZA[0] + 190), C[1] + Math.sin(a) * (PLAZA[1] + 170), i % 3 ? 0.9 : 1); }
  // landmarks
  addP('statue', SUBS[0][0], SUBS[0][1] + 20, 1); addP('gazebo', SUBS[1][0], SUBS[1][1] + 60, 1); addP('pergola', SUBS[2][0], SUBS[2][1] + 30, 1);
  // trees and flower beds scattered over the gardens (deterministic, off the paving, not crowding)
  for (let i = 0, n = 0; i < 900 && n < 70; i++) { const x = 120 + h2(i, 1) * (WORLD.x1 - 240), y = 200 + h2(i, 2) * (WORLD.y1 - 300);
    if (onPave(x, y) || onPave(x, y + 60) || onPave(x + 90, y) || onPave(x - 90, y)) continue;
    if (PROPS.some((p) => dist(p[1], p[2], x, y) < (p[0] === 'tree' ? 230 : 160))) continue;
    const r = h2(i, 3); addP(r < 0.42 ? 'tree' : r < 0.6 ? 'cypress' : r < 0.72 ? 'autumn' : r < 0.86 ? 'bush' : 'flowers', x, y, 0.85 + 0.3 * h2(i, 4), h2(i, 5) > 0.5); n++; }
  for (let i = 0; i < 12; i++) { const a = h2(i, 9) * 6.28, r = 900 + h2(i, 10) * 1300, x = C[0] + Math.cos(a) * r, y = C[1] + Math.sin(a) * r * 0.8;
    if (!onPave(x, y) && x > 100 && y > 150 && x < WORLD.x1 - 100 && y < WORLD.y1 - 100 && !PROPS.some((p) => dist(p[1], p[2], x, y) < 140)) addP('bin', x, y); }
  const FOOT = { lamp: 13, bench: 0, tree: 26, cypress: 18, autumn: 24, bush: 46, flowers: 0, fence: 0, bin: 16, statue: 85, gazebo: 175, pergola: 0 };
  const SOLIDS = [];
  for (const [k, x, y, s] of PROPS) { if (FOOT[k]) SOLIDS.push({ x, y: y - 6, r: FOOT[k] * s });
    if (k === 'bench') { SOLIDS.push({ x: x - 44, y: y - 10, r: 22 }, { x: x + 44, y: y - 10, r: 22 }); }
    if (k === 'fence') { for (const o of [-80, 0, 80]) SOLIDS.push({ x: x + o, y: y - 6, r: 20 }); }
    if (k === 'pergola') { SOLIDS.push({ x: x - 95, y: y - 6, r: 24 }, { x: x + 95, y: y - 6, r: 24 }); } }
  const POND = [SUBS[3][0], SUBS[3][1] + 20, 300, 190];                     // water ellipse blocks movement
  const LAMPS = PROPS.filter((p) => p[0] === 'lamp').map((p) => [p[1], p[2]]);
  const blocked = (x, y, r) => { if (((x - POND[0]) / (POND[2] + r)) ** 2 + ((y - POND[1]) / (POND[3] + r)) ** 2 < 1) return true;
    for (const o of SOLIDS) if (Math.abs(x - o.x) < o.r + r && dist(x, (y - o.y) * 1.4 + o.y, o.x, o.y) < o.r + r) return true; return false; };
  const collide = (o, r) => {
    for (const s of SOLIDS) { if (Math.abs(o.x - s.x) > s.r + r + 4 || Math.abs(o.y - s.y) > s.r + r + 4) continue;
      const dx = o.x - s.x, dy = (o.y - s.y) * 1.4, d = Math.hypot(dx, dy), R = s.r + r;
      if (d < R && d > 0) { o.x = s.x + dx / d * R; o.y = s.y + dy / d * R / 1.4; } }
    const ex = (o.x - POND[0]) / (POND[2] + r), ey = (o.y - POND[1]) / (POND[3] + r), e = Math.hypot(ex, ey);
    if (e < 1 && e > 0) { o.x = POND[0] + ex / e * (POND[2] + r); o.y = POND[1] + ey / e * (POND[3] + r); }
    o.x = clamp(o.x, WORLD.x0 + 60, WORLD.x1 - 60); o.y = clamp(o.y, WORLD.y0 + 140, WORLD.y1 - 50);
  };

  // ---------------- state ----------------
  const mkPlayer = (id, hero, bot, i) => { const H = HEROES[hero], a = i / 4 * Math.PI * 2 + 0.6;
    return { id, hero, bot: bot ? 1 : 0, x: C[0] + Math.cos(a) * 110, y: C[1] + Math.sin(a) * 90, vx: 0, vy: 0, fx: 0, fy: 1, dir: 0, dist: 0,
      hp: H.hp, hpMax: H.hp, down: 0, downT: 0, revP: 0, out: 0, inv: 0, hurtT: -9, dashT: -9, dashCD: 0, qT: -99, qOn: 0, qCD: 0, ult: 0, ultT: -99,
      atkT: 0, atkN: 0, atkSide: 1, lastAtk: -9, tier: 0, tokens: [], set: -1, hitN: 0, hitSet: [], fastT: -9, stillT: 0,
      m: { dmg: 1, as: 1, area: 1, spd: 1, pick: H.pick, armor: 1, regen: 0, crit: 0.04, cd: 1, extra: 0, rico: 1, pullN: 3, ttl: 1, deo: 1, shield: 0 },
      pick: null, pickT: 0, ups: {}, vcd: 0, gasT: -9, buffT: -9, selfRes: 1,
      st: { dmg: 0, ally: 0, allyHit: 0, rev: 0, downs: 0, xp: 0, kills: 0, gasIn: 0, combo: 0 },
      prev: {}, cam: [C[0] - VIEW.W / 2, C[1] - VIEW.H / 2], camV: [0, 0] }; };

  function create(cfg = {}) {
    const heroes = cfg.heroes || ORDER, S = { t: 0, steps: 0, wt0: 0, mode: cfg.mode || 'play', seed: cfg.seed || 1,
      players: [], enemies: [], proj: [], eproj: [], clouds: [], gems: [], marks: [], booms: [], nid: 1,
      wave: 1, waveT: 0, brk: 0, xp: 0, lvl: 1, xpNext: 12, spawnAcc: 0, over: 0, won: 0, freeze: 0, kills: 0,
      comboT: -9, comboK: {}, sayT: -9, banter: 0, ev: [], awards: null, me: 0, solo: 0 };
    heroes.forEach((h, i) => S.players.push(mkPlayer(i, h, cfg.humans ? !cfg.humans.includes(i) : 1, i)));
    S.solo = S.players.filter((p) => !p.bot).length <= 1 && S.players.length === 1 ? 1 : 0;
    return S;
  }
  // play mode: the local human is player 0 (hero from cfg), the other heroes are bots unless cfg.heroes says otherwise
  const spawn = (worldT, cfg = {}) => { const me = cfg.hero || 'hasan', rest = cfg.solo ? [] : ORDER.filter((h) => h !== me);
    const S = create({ heroes: [me, ...rest], humans: [0] }); S.wt0 = worldT; S.solo = cfg.solo ? 1 : 0; return S; };
  const respawn = (S, worldT) => spawn(worldT, { hero: S.players[0].hero, solo: S.solo });
  const outOfPlay = () => false;

  // ---------------- helpers ----------------
  const ev = (S, o) => { o.t = S.t; S.ev.push(o); };
  const alive = (p) => !p.down && !p.out;
  const GRID = 96;
  let grid = new Map();
  const buildGrid = (S) => { grid = new Map(); for (const e of S.enemies) { const k = Math.floor(e.x / GRID) * 4096 + Math.floor(e.y / GRID);
    let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(e); } };
  const near = (x, y, r, fn) => { const x0 = Math.floor((x - r) / GRID), x1 = Math.floor((x + r) / GRID), y0 = Math.floor((y - r) / GRID), y1 = Math.floor((y + r) / GRID);
    for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) { const a = grid.get(gx * 4096 + gy); if (a) for (const e of a) if (e.hp > 0 && dist(e.x, e.y, x, y) < r + e.r) fn(e); } };
  const nearest = (S, x, y, r, skip) => { let b = null, bd = r; near(x, y, r, (e) => { if (skip && skip.includes(e.id)) return; const d = dist(e.x, e.y, x, y); if (d < bd) { bd = d; b = e; } }); return b; };
  const inGas = (S, x, y, ownerSkip) => { for (const c of S.clouds) if (c.owner !== ownerSkip && S.t < c.t0 + c.ttl && S.t > c.t0 + 0.15 &&
    ((x - c.x) / c.r) ** 2 + ((y - c.y) / (c.r * 0.75)) ** 2 < 1) return c; return null; };
  // voice lines: a player speaks at most every ~20 s, the team at most every ~5 s, each category has its own chance and cooldown
  const SAY_P = { gas: 0.5, q: 0.35, lvl: 0.5, low: 0.7, wave: 0.6, revive: 0.8, ally_down: 0.8, cant_revive: 0.6, gas_reply: 1, banter: 1 };
  const SAY_CD = { gas: 25, low: 30, q: 30, cant_revive: 30 };
  const say = (S, p, cat, force) => {
    if (!p) return; p.ccd = p.ccd || {};
    if (!force && (S.t < p.vcd || S.t - S.sayT < 5 || S.t < (p.ccd[cat] || 0) || h2(S.steps, p.id + 3) > (SAY_P[cat] ?? 0.8))) return;
    if (force && S.t - S.sayT < 1.5) return;
    p.vcd = S.t + 16 + 10 * h2(S.steps, p.id); p.ccd[cat] = S.t + (SAY_CD[cat] || (cat.startsWith('combo') ? 60 : 12)); S.sayT = S.t; ev(S, { k: 'say', who: p.hero, cat, v: Math.floor(h2(S.steps, p.id + 7) * 4), x: p.x, y: p.y, pid: p.id });
  };
  const combo = (S, key, x, y, p, bonus) => {
    if (S.t - (S.comboK[key] || -9) < 7) return; S.comboK[key] = S.t; S.comboT = S.t;
    ev(S, { k: 'combo', key, x, y, pid: p ? p.id : -1 }); if (p) { p.st.combo++; say(S, p, 'combo_' + key); }
    for (let i = 0; i < bonus; i++) S.gems.push({ id: S.nid++, x: x + 60 * (h2(S.steps, i) - 0.5), y: y + 50 * (h2(S.steps, i + 9) - 0.5), v: 2, t0: S.t });
  };
  const hurtEnemy = (S, e, dmg, p, kind, kx = 0, ky = 0) => {
    if (e.hp <= 0) return;
    if (S.marks.length && S.marks.some((m) => m.id === e.id && S.t < m.until)) dmg *= 1.5;
    let crit = 0; if (p && h2(S.steps + e.id, dmg) < p.m.crit) { dmg *= 2; crit = 1; }
    e.hp -= dmg; e.hitT = S.t; e.kx += kx; e.ky += ky; e.lastHit = p ? p.id : -1; e.lastKind = kind;
    if (p) { p.st.dmg += dmg; p.ult = Math.min(1, p.ult + dmg / 900);
      if (p.hero === 'hasan' && !p.hitSet.includes(e.id)) { p.hitSet.push(e.id); if (p.hitSet.length > 8) p.hitSet.shift(); } }
    if (crit) ev(S, { k: 'crit', x: e.x, y: e.y });
    if (e.hp <= 0) killEnemy(S, e, p, kind);
  };
  const killEnemy = (S, e, p, kind) => {
    const T = ETYPES[e.type]; S.kills++; if (p) p.st.kills++;
    ev(S, { k: 'kill', x: e.x, y: e.y, type: e.type, kind, pid: p ? p.id : -1, sc: T.sc });
    S.gems.push({ id: S.nid++, x: e.x, y: e.y - 4, v: T.xp, t0: S.t });
    if (e.type === 'bomber') explode(S, e.x, e.y, 120, 0, null, 'bomb');
    // combos
    if (p && p.hero === 'leha' && S.marks.some((m) => m.id === e.id && S.t < m.until)) combo(S, 'headshot', e.x, e.y, p, 3);
    if (e.pullT && S.t - e.pullT < 1.6 && inGas(S, e.x, e.y)) { const hz = S.players.find((q) => q.id === e.pullBy); combo(S, 'gaswhip', e.x, e.y, hz, 4); }
  };
  const explode = (S, x, y, r, dmg, p, kind) => {
    let gas = null; if (kind === 'rocket') { gas = inGas(S, x, y); if (gas) { r *= 1.6; dmg *= 1.5; gas.ttl = S.t - gas.t0 + 0.3; combo(S, 'gasboom', x, y, p, 3); } }
    ev(S, { k: 'boom', x, y, r, kind, gas: gas ? 1 : 0 });
    if (dmg > 0) near(x, y, r, (e) => { const d = dist(e.x, e.y, x, y) || 1; hurtEnemy(S, e, dmg * (1 - 0.4 * d / r), p, kind, (e.x - x) / d * 260, (e.y - y) / d * 260); });
    if (kind === 'bomb') for (const q of S.players) if (alive(q) && dist(q.x, q.y, x, y) < r) hurtPlayer(S, q, 26, null);
  };
  const hurtPlayer = (S, p, dmg, src, ally) => {
    if (!alive(p) || (!ally && S.t < p.inv)) return;
    let d = dmg * p.m.armor; if (p.hero === 'leha') { if (p.stillT > 2) d *= 0.75; if (S.t - p.qT < 4 + p.m.shield) d *= 0.4; }
    if (ally) { d = Math.min(d, p.hp - 1); if (d <= 0) return; } else p.inv = S.t + 0.45;
    p.hp -= d; p.hurtT = S.t; ev(S, { k: 'hurt', x: p.x, y: p.y, pid: p.id, ally: ally ? 1 : 0 });
    if (p.hp <= 0) { p.hp = 0; p.down = 1; p.downT = 30; p.revP = 0; p.st.downs++; ev(S, { k: 'down', x: p.x, y: p.y, pid: p.id });
      say(S, p, 'down', true); const helper = S.players.find((q) => q !== p && alive(q) && q.hero !== 'vitya'); if (helper) S.allyDownSay = [S.t + 2.2, helper.id]; }
    else if (p.hp < p.hpMax * 0.25 && !ally) say(S, p, 'low');
  };
  const addCloud = (S, p, x, y, r, ttl, big) => { S.clouds.push({ id: S.nid++, owner: p.id, x, y, r, ttl: ttl * p.m.ttl, t0: S.t, big: big ? 1 : 0, tick: 0, atick: 0 });
    if (S.clouds.length > 40) S.clouds.shift(); ev(S, { k: 'fart', x, y, pid: p.id, big: big ? 1 : 0 }); };

  // ---------------- hero attacks ----------------
  function heroStep(S, p, inp, t) {
    const as = p.m.as * (S.t < p.buffT ? 1.4 : 1), area = p.m.area;
    const tgt = nearest(S, p.x, p.y - 40, p.hero === 'hasan' ? 230 * area : p.hero === 'vitya' ? 0 : 760);
    if (tgt) { const d = dist(tgt.x, tgt.y, p.x, p.y) || 1; p.ax = (tgt.x - p.x) / d; p.ay = (tgt.y - p.y) / d; } else { p.ax = p.fx; p.ay = p.fy; }
    p.atkT -= DT;
    if (p.hero === 'hasan') {
      if (p.atkT <= 0 && tgt) { p.atkT = 0.6 / as; p.atkN++; p.atkSide = -p.atkSide; p.lastAtk = t;
        const ang = Math.atan2(p.ay, p.ax), R = 200 * area, pull = p.atkN % p.m.pullN === 0, n = 1 + p.m.extra;
        for (let k = 0; k < n; k++) { const a0 = ang + (k - (n - 1) / 2) * 0.55;
          near(p.x, p.y - 40, R, (e) => { const da = Math.atan2(e.y - (p.y - 40), e.x - p.x) - a0, dd = Math.abs(Math.atan2(Math.sin(da), Math.cos(da)));
            if (dd > 0.75) return; const ex = p.x + Math.cos(a0) * 70, ey = p.y - 40 + Math.sin(a0) * 70;
            if (pull && ETYPES[e.type].sc < 1.5) { e.kx += (ex - e.x) * 5; e.ky += (ey - e.y) * 5; e.pullT = t; e.pullBy = p.id; } else if (pull) e.slowT = t + 1.2;
            hurtEnemy(S, e, 15 * p.m.dmg, p, 'whip', Math.cos(a0) * 120, Math.sin(a0) * 120); }); }
        ev(S, { k: 'whip', pid: p.id, x: p.x, y: p.y, ang, side: p.atkSide, pull: pull ? 1 : 0, n, R });
        if (p.hitSet.length >= 5 && t - p.fastT > 6) { p.fastT = t; p.hitSet = []; } }
      if (t - p.qT < 4) { if (Math.floor((t - p.qT) / 0.25) !== Math.floor((t - p.qT - DT) / 0.25))
        near(p.x, p.y - 30, 170 * area, (e) => { const d = dist(e.x, e.y, p.x, p.y) || 1; hurtEnemy(S, e, 8 * p.m.dmg, p, 'twirl', (e.x - p.x) / d * 300, (e.y - p.y) / d * 300); }); }
      if (t - p.ultT < 3.2) { const ox = p.x + p.fx * 220, oy = p.y + p.fy * 180;
        near(ox, oy, 460 * area, (e) => { const d = dist(e.x, e.y, ox, oy) || 1, big = ETYPES[e.type].sc >= 1.5;
          if (!big) { e.kx += (-(e.y - oy) / d * 9 + (ox - e.x) / d * 5) * 60 * DT * 60; e.ky += ((e.x - ox) / d * 9 + (oy - e.y) / d * 5) * 60 * DT * 60; } else e.slowT = t + 0.5;
          if (S.steps % 12 === 0) hurtEnemy(S, e, 7 * p.m.dmg, p, 'tornado'); });
        if (t - p.ultT + DT >= 3.2) near(ox, oy, 480 * area, (e) => { const d = dist(e.x, e.y, ox, oy) || 1; hurtEnemy(S, e, 40 * p.m.dmg, p, 'tornado', (e.x - ox) / d * 900, (e.y - oy) / d * 900); }); }
    }
    if (p.hero === 'danil') {
      if (p.atkT <= 0 && tgt) { p.atkT = 0.44 / as * (p.set === 0 ? 0.8 : 1); p.lastAtk = t; const n = 1 + p.m.extra, ang = Math.atan2(p.ay, p.ax);
        for (let k = 0; k < n; k++) { const a = ang + (k - (n - 1) / 2) * 0.16;
          S.proj.push({ id: S.nid++, own: p.id, kind: 'card', x: p.x + p.ax * 24, y: p.y - 50, vx: Math.cos(a) * 920, vy: Math.sin(a) * 920, dmg: 10 * p.m.dmg, ttl: 0.9, rico: p.m.rico + (p.set === 2 ? 1 : 0), hit: [], tox: 0, c: (p.atkN + k) % 3 }); }
        p.atkN++; ev(S, { k: 'throw', pid: p.id, x: p.x, y: p.y }); }
      if (t - p.ultT < 1.6 && Math.floor((t - p.ultT) / 0.5) !== Math.floor((t - p.ultT - DT) / 0.5))
        for (let k = 0; k < 22; k++) { const a = k / 22 * Math.PI * 2 + t; S.proj.push({ id: S.nid++, own: p.id, kind: 'card', x: p.x, y: p.y - 50, vx: Math.cos(a) * 820, vy: Math.sin(a) * 820, dmg: 16 * p.m.dmg, ttl: 0.9, rico: 1, hit: [], tox: 0, c: k % 3 }); }
    }
    if (p.hero === 'vitya') {
      const solo = S.players.filter((q) => q !== p && alive(q) && dist(q.x, q.y, p.x, p.y) < 320).length;
      p.zone = 1 + 0.3 * Math.max(0, 1 - solo / 2);
      if (p.atkT <= 0) { p.atkT = 3.4 / as; p.lastAtk = t; addCloud(S, p, p.x - p.fx * 30, p.y - 10 - p.fy * 20, 105 * area, 4.2); }
      if (t - p.ultT > 0.95 && t - p.ultT - DT <= 0.95) addCloud(S, p, p.ux, p.uy, 400 * area, 6, 1);
    }
    if (p.hero === 'leha') {
      const g = S.t - p.ultT < 7 ? 4 : p.tier, rate = [0.45, 0.12, 0.95, 1.4, 0.35][g];
      if (p.atkT <= 0 && tgt) { p.atkT = rate / as; p.lastAtk = t; p.atkN++; const ang = Math.atan2(p.ay, p.ax);
        const shot = (a, sp, dmg, kind, ttl) => S.proj.push({ id: S.nid++, own: p.id, kind, x: p.x + Math.cos(a) * 46, y: p.y - 52 + Math.sin(a) * 30, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg: dmg * p.m.dmg, ttl, rico: 0, hit: [] });
        if (g === 0) shot(ang, 1300, 13, 'bullet', 0.6);
        if (g === 1) shot(ang + (h2(S.steps, 3) - 0.5) * 0.22, 1400, 6.5, 'bullet', 0.55);
        if (g === 2) for (let k = 0; k < 6; k++) shot(ang + (k - 2.5) * 0.11 + (h2(S.steps, k) - 0.5) * 0.06, 1150, 8, 'pellet', 0.32);
        if (g >= 3) shot(ang, 820, g === 4 ? 52 : 42, 'rocket', 1.1);
        ev(S, { k: 'shot', pid: p.id, x: p.x, y: p.y, ang, g }); }
    }
  }

  function useQ(S, p, t) {
    p.qT = t; p.qCD = QCD[p.hero] * p.m.cd; ev(S, { k: 'q', pid: p.id, hero: p.hero, x: p.x, y: p.y }); say(S, p, 'q');
    if (p.hero === 'danil') { const ids = []; for (let k = 0; k < 5; k++) { const e = nearest(S, p.x, p.y, 800, ids); if (!e) break; ids.push(e.id); S.marks.push({ id: e.id, until: t + 5, by: p.id }); } }
    if (p.hero === 'vitya') { for (let k = 1; k <= 5; k++) addCloud(S, p, p.x + p.fx * 75 * k, p.y - 10 + p.fy * 60 * k, 70 + 8 * k, 6);
      near(p.x + p.fx * 200, p.y + p.fy * 160, 260, (e) => { e.kx += p.fx * 600; e.ky += p.fy * 600; e.poisT = t + 4; }); }
  }
  function useUlt(S, p, t) {
    p.ult = 0; p.ultT = t; ev(S, { k: 'ult', pid: p.id, hero: p.hero, x: p.x, y: p.y }); say(S, p, 'ult', true);
    if (p.hero === 'vitya') { p.ux = p.x; p.uy = p.y - 10; ev(S, { k: 'warn', x: p.ux, y: p.uy, r: 400 * p.m.area, until: t + 0.95 }); }
    if (p.hero === 'danil') for (const q of S.players) if (alive(q) && dist(q.x, q.y, p.x, p.y) < 450) q.buffT = t + 6;
  }

  // ---------------- bots (attract demo, empty co-op slots) ----------------
  function botInput(S, p) {
    const inp = {}; let mx = 0, my = 0;
    near(p.x, p.y, 330, (e) => { const d = dist(e.x, e.y, p.x, p.y) || 1, w = (330 - d) / 330; mx -= (e.x - p.x) / d * w * 2.2; my -= (e.y - p.y) / d * w * 2.2; });
    const team = S.players.filter((q) => q !== p && alive(q)); let cx = C[0], cy = C[1];
    if (team.length) { cx = team.reduce((a, q) => a + q.x, 0) / team.length; cy = team.reduce((a, q) => a + q.y, 0) / team.length; }
    const keep = p.hero === 'vitya' ? 380 : 190, dt = dist(cx, cy, p.x, p.y);
    if (dt > keep) { mx += (cx - p.x) / dt * 0.8; my += (cy - p.y) / dt * 0.8; } else if (p.hero === 'vitya' && dt < 260 && dt > 1) { mx -= (cx - p.x) / dt; my -= (cy - p.y) / dt; }
    for (const q of S.players) { if (q === p || q.out) continue; const d = dist(q.x, q.y, p.x, p.y) || 1; if (d < 170) { mx -= (q.x - p.x) / d * (170 - d) / 170 * 2.5; my -= (q.y - p.y) / d * (170 - d) / 170 * 2.5; } }
    const dc = dist(C[0], C[1], p.x, p.y); if (dc > 900) { mx += (C[0] - p.x) / dc * 0.6; my += (C[1] - p.y) / dc * 0.6; }
    const down = S.players.find((q) => q.down && !q.out && p.hero !== 'vitya'); if (down) { const d = dist(down.x, down.y, p.x, p.y) || 1; if (d > 40) { mx += (down.x - p.x) / d * 2.4; my += (down.y - p.y) / d * 2.4; } }
    let gb = null, gd = 260; for (const g of S.gems) { const d = dist(g.x, g.y, p.x, p.y); if (d < gd) { gd = d; gb = g; } }
    if (gb && !down) { mx += (gb.x - p.x) / gd * 0.7; my += (gb.y - p.y) / gd * 0.7; }
    const wob = Math.sin(S.t * 0.9 + p.id * 2.1); mx += wob * 0.25; my += Math.cos(S.t * 0.7 + p.id) * 0.25;
    if (Math.abs(mx) > 0.25) inp[mx > 0 ? 'right' : 'left'] = 1; if (Math.abs(my) > 0.25) inp[my > 0 ? 'down' : 'up'] = 1;
    let cnt = 0; near(p.x, p.y, 240, () => cnt++);
    if (cnt >= 4 && p.qCD <= 0) inp.q = 1;
    if (p.ult >= 1 && cnt >= 6) inp.r = 1;
    if (cnt >= 7 && p.dashCD <= 0 && S.steps % 90 === p.id * 7) inp.dash = 1;
    if (p.pick && S.t - p.pickT > 1.2) inp.slot = 1 + Math.floor(h2(S.steps, p.id) * 3);
    return inp;
  }

  // ---------------- step ----------------
  function step(S, inpAll) {
    const t = S.t + DT; S.t = t; S.steps++;
    if (S.over) { if (S.ev.length > 96) S.ev.splice(0, S.ev.length - 96); return S; }
    buildGrid(S);
    const inps = (inpAll && inpAll.players) || { 0: inpAll || {} };
    // ---- waves ----
    if (S.brk > 0) { S.brk -= DT; if (S.brk <= 0) { S.wave++; S.waveT = 0; ev(S, { k: 'wave', n: S.wave }); const p = S.players[Math.floor(h1(S.wave) * S.players.length)]; say(S, p, 'wave'); } }
    else { S.waveT += DT;
      if (S.waveT >= WAVE_LEN) { if (S.wave >= WAVES) { S.over = t; S.won = 1; finishRun(S); return S; }
        S.brk = BREAK; ev(S, { k: 'break', n: S.wave }); for (const p of S.players) { p.tokens = []; if (p.down && !p.out) { p.down = 0; p.hp = p.hpMax * 0.5; } p.hp = Math.min(p.hpMax, p.hp + p.hpMax * 0.3); }
        S.enemies.forEach((e) => (e.flee = 1)); S.banter = t + 2; } }
    if (S.banter && t > S.banter) { S.banter = 0; const a = S.players[Math.floor(h1(S.wave + 3) * S.players.length)]; S.sayT = -9; a.vcd = 0; say(S, a, 'banter'); }
    if (S.allyDownSay && t > S.allyDownSay[0]) { const a = S.players.find((q) => q.id === S.allyDownSay[1]); S.allyDownSay = 0; if (a && alive(a)) { a.vcd = 0; say(S, a, 'ally_down'); } }
    // ---- spawning: hold a target count around the team, outside every camera ----
    const n = S.players.length, coop = COOP[Math.min(8, n)], humans = Math.max(1, n);
    const want = S.brk > 0 ? 0 : Math.min(190, Math.round((9 + S.wave * 6 + S.waveT * (0.12 + S.wave * 0.03)) * coop * (S.solo ? 0.7 : 1)));
    S.spawnAcc += DT * (2 + S.wave * 0.8) * coop;
    const live = S.players.filter(alive);
    while (S.spawnAcc >= 1 && S.enemies.length < want && live.length) { S.spawnAcc -= 1;
      const k = S.steps * 13 + S.enemies.length, p = live[Math.floor(h1(k) * live.length)], a = h1(k + 1) * Math.PI * 2, r = 1150 + 250 * h1(k + 2);
      let x = clamp(p.x + Math.cos(a) * r, 80, WORLD.x1 - 80), y = clamp(p.y + Math.sin(a) * r * 0.75, 180, WORLD.y1 - 60);
      if (blocked(x, y, 30) || S.players.some((q) => dist(q.x, q.y, x, y) < 900)) continue;
      const types = Object.keys(ETYPES).filter((ty) => ETYPES[ty].from <= S.wave), roll = h1(k + 3);
      let ty = 'ghoul'; if (types.length > 1 && roll > 0.55) ty = types[1 + Math.floor(h1(k + 4) * (types.length - 1))];
      if (ty === 'brute' && roll < 0.8) ty = 'ghoul';
      const T = ETYPES[ty], hp = T.hp * (1 + 0.16 * (S.wave - 1)) * COOP_HP[Math.min(8, n)];
      S.enemies.push({ id: S.nid++, type: ty, x, y, vx: 0, vy: 0, kx: 0, ky: 0, hp, hpMax: hp, r: T.r, hitT: -9, atkT: 0, slowT: -9, poisT: -9, born: t, dist: 0, face: 1, flee: 0, shotT: t + 2 + h1(k) * 2, spawnT: t });
    }
    if (S.spawnAcc > 3) S.spawnAcc = 3;
    // ---- players ----
    for (const p of S.players) {
      const inp = p.bot ? botInput(S, p) : (inps[p.id] || {});
      const edge = (k) => { const v = !!inp[k], e = v && !p.prev[k]; p.prev[k] = v; return e; };
      const dashE = edge('dash') || edge('jump'), qE = edge('q'), rE = edge('r'), eE = edge('e');
      if (p.out) continue;
      if (p.down) { const g = inGas(S, p.x, p.y); p.downT -= DT * (g ? 1.5 : 1); if (g) p.gasDown = t;
        if (S.solo && p.selfRes > 0 && (eE || p.bot)) { p.selfRes--; p.down = 0; p.hp = p.hpMax * 0.5; p.inv = t + 2; ev(S, { k: 'revive', pid: p.id, by: p.id, x: p.x, y: p.y }); }
        const helpers = S.players.filter((q) => q !== p && alive(q) && q.hero !== 'vitya' && dist(q.x, q.y, p.x, p.y) < 85);
        if (helpers.length) { p.revP += DT / 2.4; if (p.revP >= 1) { p.down = 0; p.hp = p.hpMax * 0.5; p.inv = t + 1.5; p.revP = 0; helpers[0].st.rev++; helpers[0].ult = Math.min(1, helpers[0].ult + 0.15);
          ev(S, { k: 'revive', pid: p.id, by: helpers[0].id, x: p.x, y: p.y }); say(S, helpers[0], 'revive'); } }
        else p.revP = Math.max(0, p.revP - DT * 0.3);
        const vt = S.players.find((q) => q.hero === 'vitya' && alive(q) && dist(q.x, q.y, p.x, p.y) < 85); if (vt && S.t - (p.cantT || -9) > 4) { p.cantT = S.t; say(S, vt, 'cant_revive'); }
        if (p.downT <= 0) { p.out = 1; ev(S, { k: 'out', pid: p.id, x: p.x, y: p.y }); }
        continue; }
      // upgrade pick
      if (p.pick && inp.slot >= 1 && inp.slot <= 3) { const id = p.pick[inp.slot - 1]; UPG[id].f(p); p.ups[id] = (p.ups[id] || 0) + 1; p.pick = p.queue && p.queue > 0 ? rollPick(S, p) : null; if (p.queue) p.queue--; ev(S, { k: 'upgrade', pid: p.id, id }); }
      if (p.pick && t - p.pickT > 14) { const id = p.pick[0]; UPG[id].f(p); p.ups[id] = (p.ups[id] || 0) + 1; p.pick = null; }
      // move
      const ix = (inp.right ? 1 : 0) - (inp.left ? 1 : 0), iy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0), il = Math.hypot(ix, iy) || 1;
      const slowLeha = p.hero === 'leha' ? 1 - 0.04 * p.tier : 1, fast = t - p.fastT < 2 ? 1.25 : 1;
      const spd = HEROES[p.hero].spd * p.m.spd * slowLeha * fast * (t - p.qT < 4 && p.hero === 'hasan' ? 1.1 : 1);
      const tx = ix / il * spd, ty = iy / il * spd, acc = 2600 * DT;
      p.vx += clamp(tx - p.vx, -acc, acc); p.vy += clamp(ty - p.vy, -acc, acc);
      if (ix || iy) { p.fx = ix / il; p.fy = iy / il; p.dir = Math.abs(iy) > Math.abs(ix) * 1.2 ? (iy > 0 ? 0 : 2) : (ix > 0 ? 1 : 3); p.stillT = 0; } else p.stillT += DT;
      p.dashCD = Math.max(0, p.dashCD - DT); p.qCD = Math.max(0, p.qCD - DT);
      if (dashE && p.dashCD <= 0) { p.dashT = t; p.dashCD = 1.1; p.inv = Math.max(p.inv, t + 0.25); ev(S, { k: 'dash', pid: p.id, x: p.x, y: p.y, dx: p.fx, dy: p.fy }); }
      const dashing = t - p.dashT < 0.17, mx = dashing ? p.fx * 950 : p.vx, my = dashing ? p.fy * 950 : p.vy;
      p.x += mx * DT; p.y += my * DT; collide(p, 24);
      const moved = Math.hypot(mx, my) * DT; if (moved > 0.05) { const b = Math.floor(p.dist / 62); p.dist += moved; if (Math.floor(p.dist / 62) !== b) ev(S, { k: 'step', pid: p.id, x: p.x, y: p.y }); }
      if (qE && p.qCD <= 0) useQ(S, p, t);
      if (rE && p.ult >= 1) useUlt(S, p, t);
      if (p.m.regen) p.hp = Math.min(p.hpMax, p.hp + p.m.regen * DT);
      p.ult = Math.min(1, p.ult + DT / 160);
      heroStep(S, p, inp, t);
      // in Vitya's gas: allies take small damage (never lethal) and complain
      if (p.hero !== 'vitya') { const g = inGas(S, p.x, p.y);
        if (g) { const v = S.players.find((q) => q.id === g.owner); if (Math.floor((t - g.t0)) !== Math.floor((t - DT - g.t0)) || t - p.gasT > 1.0) {
            if (t - p.gasT > 0.95) { p.gasT = t; const d = (g.big ? 4 : 3) * (v ? v.m.deo : 1); hurtPlayer(S, p, d, v, true); p.st.gasIn++; if (v) { v.st.ally += d; v.st.allyHit++; }
              if (!p.inGas) { say(S, p, 'gas'); if (v && S.sayT === t && h2(S.steps, 11) < 0.5) { S.banterV = t + 2.2; S.banterW = v.id; } } } } }
        p.inGas = g ? 1 : 0; }
      // camera (per player, so every client follows its own hero)
      const tgx = clamp(p.x - VIEW.W / 2 + p.vx * 0.25, WORLD.x0, WORLD.x1 - VIEW.W), tgy = clamp(p.y - 60 - VIEW.H / 2 + p.vy * 0.2, WORLD.y0, WORLD.y1 - VIEW.H);
      p.camV[0] += (28 * (tgx - p.cam[0]) - 10.5 * p.camV[0]) * DT; p.cam[0] += p.camV[0] * DT;
      p.camV[1] += (28 * (tgy - p.cam[1]) - 10.5 * p.camV[1]) * DT; p.cam[1] += p.camV[1] * DT;
    }
    for (const p of S.players) if (p.out || p.down) { p.camV[0] *= 0.9; p.camV[1] *= 0.9; }
    if (S.banterV && t > S.banterV) { const v = S.players.find((q) => q.id === S.banterW); S.banterV = 0; if (v) { S.sayT = -9; v.vcd = 0; say(S, v, 'gas_reply'); } }
    // ---- enemies ----
    const targets = S.players.filter(alive);
    for (const e of S.enemies) {
      const T = ETYPES[e.type]; let tg = null, td = 1e9;
      for (const p of targets) { const d = dist(p.x, p.y, e.x, e.y); if (d < td) { td = d; tg = p; } }
      let spd = T.spd * (t < e.slowT ? 0.45 : 1) * (t < e.poisT ? 0.8 : 1) * (inGas(S, e.x, e.y) ? 0.8 : 1);
      let dx = 0, dy = 0;
      if (e.flee) { const p = tg || { x: C[0], y: C[1] }; const d = dist(p.x, p.y, e.x, e.y) || 1; dx = (e.x - p.x) / d; dy = (e.y - p.y) / d; spd *= 1.4; e.hp -= DT * 30; }
      else if (tg) { dx = (tg.x - e.x) / (td || 1); dy = (tg.y - e.y) / (td || 1);
        if (T.ranged && td < 520) { dx *= -0.5; dy *= -0.5; if (td < 380) { dx *= 2; dy *= 2; } } }
      // separation from neighbours
      near(e.x, e.y, e.r * 1.6, (o) => { if (o === e) return; const ox = e.x - o.x, oy = e.y - o.y, d = Math.hypot(ox, oy) || 0.1, R = e.r + o.r;
        if (d < R) { dx += ox / d * (R - d) / R * 1.6; dy += oy / d * (R - d) / R * 1.6; } });
      const sp = Math.min(1.6, Math.hypot(dx, dy)) || 1, nl = Math.hypot(dx, dy) || 1;
      e.vx = dx / nl * spd * Math.min(1, sp); e.vy = dy / nl * spd * Math.min(1, sp);
      e.x += (e.vx + e.kx) * DT; e.y += (e.vy + e.ky) * DT; const kd = Math.exp(-9 * DT); e.kx *= kd; e.ky *= kd;
      const mv = Math.hypot(e.vx, e.vy) * DT; e.dist += mv; if (Math.abs(e.vx) > 4) e.face = e.vx > 0 ? 1 : -1;
      collide(e, e.r * 0.6);
      if (e.hp <= 0) continue;
      if (tg && !e.flee) {
        if (td < e.r + 30 && t > e.atkT) { e.atkT = t + 0.7; e.biteT = t;
          if (T.bomb) { e.hp = 0; killEnemy(S, e, null, 'self'); } else hurtPlayer(S, tg, T.dmg * (1 + 0.06 * (S.wave - 1)), e); }
        if (T.ranged && td < 640 && t > e.shotT) { e.shotT = t + 2.6 + h2(e.id, S.steps) * 1.4; const d = td || 1;
          S.eproj.push({ x: e.x, y: e.y - 40, vx: (tg.x - e.x) / d * 420, vy: (tg.y - 40 - e.y + 40) / d * 420, ttl: 2.2, dmg: T.dmg }); ev(S, { k: 'spit', x: e.x, y: e.y }); }
      }
      // gas damage
      const g = inGas(S, e.x, e.y); if (g && Math.floor((t - g.t0) / 0.5) !== Math.floor((t - DT - g.t0) / 0.5)) { const v = S.players.find((q) => q.id === g.owner);
        hurtEnemy(S, e, (g.big ? 26 : 7) * (v ? v.m.dmg * (v.zone || 1) : 1), v, 'gas'); e.poisT = t + 1.5; }
    }
    S.enemies = S.enemies.filter((e) => e.hp > 0 && !(e.flee && dist(e.x, e.y, C[0], C[1]) > 3000));
    // ---- projectiles ----
    for (const b of S.proj) { b.x += b.vx * DT; b.y += b.vy * DT; b.ttl -= DT; if (b.ttl <= 0) continue;
      const p = S.players.find((q) => q.id === b.own);
      if (b.kind === 'card' && !b.tox && inGas(S, b.x, b.y + 50)) { b.tox = 1; b.dmg *= 1.5; if (!S.comboK['toxcard'] || S.t - S.comboK['toxcard'] > 25) combo(S, 'toxcard', b.x, b.y + 50, p, 1); }
      const e = nearest(S, b.x, b.y + 45, b.kind === 'rocket' ? 34 : 26, b.hit);
      if (e) { b.hit.push(e.id);
        if (b.kind === 'rocket') { explode(S, b.x, b.y + 45, (S.t - p.ultT < 7 ? 150 : 130) * p.m.area, b.dmg, p, 'rocket'); b.ttl = 0; continue; }
        hurtEnemy(S, e, b.dmg, p, b.kind, b.vx * 0.15, b.vy * 0.15); ev(S, { k: 'hit', x: b.x, y: b.y + 45, kind: b.kind, tox: b.tox || 0 });
        if (b.kind === 'card') { p.hitN++; if (p.hitN % 15 === 0 && p.tokens.length < 3) { p.tokens.push(Math.floor(h2(S.steps, p.hitN) * 3)); ev(S, { k: 'token', pid: p.id });
            if (p.tokens.length === 3) { const tk = p.tokens; p.set = tk[0] === tk[1] && tk[1] === tk[2] ? 0 : new Set(tk).size === 3 ? 1 : 2; if (p.set === 1) p.m.crit += 0.1; ev(S, { k: 'set', pid: p.id, set: p.set }); } } }
        if (b.rico > 0) { const n2 = nearest(S, e.x, e.y, 300, b.hit); if (n2) { const d = dist(n2.x, n2.y, e.x, e.y) || 1; b.vx = (n2.x - e.x) / d * 900; b.vy = (n2.y - e.y) / d * 900; b.x = e.x; b.y = e.y - 45; b.rico--; b.dmg *= 0.65; b.ttl = 0.5; continue; } }
        if (b.kind !== 'pellet' || b.hit.length > 1) b.ttl = 0; }
      if (b.kind === 'rocket' && b.ttl <= DT && b.ttl > 0) explode(S, b.x, b.y + 45, 130 * p.m.area, b.dmg, p, 'rocket');
    }
    S.proj = S.proj.filter((b) => b.ttl > 0);
    for (const b of S.eproj) { b.x += b.vx * DT; b.y += b.vy * DT; b.ttl -= DT;
      for (const p of S.players) { if (!alive(p)) continue;
        const lh = S.players.find((q) => q.hero === 'leha' && alive(q) && t - q.qT < 4 + q.m.shield && dist(q.x, q.y - 40, b.x, b.y) < 150);
        if (lh) { b.ttl = 0; ev(S, { k: 'block', x: b.x, y: b.y }); break; }
        if (dist(p.x, p.y - 40, b.x, b.y) < 30) { hurtPlayer(S, p, b.dmg, null); b.ttl = 0; break; } } }
    S.eproj = S.eproj.filter((b) => b.ttl > 0);
    S.clouds = S.clouds.filter((c) => t < c.t0 + c.ttl);
    S.marks = S.marks.filter((m) => t < m.until);
    // ---- gems: magnet, team XP, level ups ----
    for (const g of S.gems) { let best = null, bd = 1e9;
      for (const p of S.players) { if (!alive(p)) continue; const d = dist(p.x, p.y - 30, g.x, g.y); const R = 95 * p.m.pick * (t - p.qT < 4 && p.hero === 'hasan' ? 3 : 1); if (d < R && d < bd) { bd = d; best = p; } }
      if (best) { const sp = 700 + 900 * (1 - bd / 400); g.x += (best.x - g.x) / bd * sp * DT; g.y += (best.y - 30 - g.y) / bd * sp * DT;
        if (bd < 26) { g.got = 1; S.xp += g.v; best.st.xp += g.v; ev(S, { k: 'gem', x: g.x, y: g.y, pid: best.id, v: g.v }); } } }
    S.gems = S.gems.filter((g) => !g.got && t - g.t0 < 60);
    if (S.gems.length > 260) S.gems.splice(0, S.gems.length - 260);
    while (S.xp >= S.xpNext) { S.xp -= S.xpNext; S.lvl++; S.xpNext = Math.round(12 + S.lvl * 7 + S.lvl * S.lvl * 0.6); ev(S, { k: 'lvl', n: S.lvl });
      for (const p of S.players) { if (p.out) continue; if (p.pick) p.queue = (p.queue || 0) + 1; else { p.pick = rollPick(S, p); p.pickT = t; } }
      const p = S.players[Math.floor(h1(S.lvl) * S.players.length)]; say(S, p, 'lvl'); }
    // ---- defeat ----
    if (S.players.every((p) => p.down || p.out)) { S.over = t; S.won = 0; finishRun(S); }
    if (S.ev.length > 96) S.ev.splice(0, S.ev.length - 96);
    return S;
  }
  function rollPick(S, p) {
    const pool = UPG_IDS.filter((id) => (!UPG[id].hero || UPG[id].hero === p.hero) && !(UPG[id].max && (p.ups[id] || 0) >= UPG[id].max));
    const out = []; for (let k = 0; out.length < 3 && k < 40; k++) { const id = pool[Math.floor(h2(S.steps + k * 31, p.id + S.lvl) * pool.length)];
      if (!out.includes(id)) out.push(id); }
    const own = pool.filter((id) => UPG[id].hero === p.hero && !out.includes(id)); if (own.length && !out.some((id) => UPG[id].hero)) out[2] = own[Math.floor(h2(S.lvl, p.id) * own.length)];
    return out;
  }
  // funny awards for the results screen
  function finishRun(S) {
    const P = S.players, top = (f) => P.reduce((a, b) => (f(b) > f(a) ? b : a)), A = [];
    const v = P.find((p) => p.hero === 'vitya'); if (v && v.st.allyHit > 0) A.push({ pid: v.id, t: 'Главный токсик', d: `${v.st.allyHit} раз окурил своих` });
    const gs = top((p) => p.st.gasIn); if (gs.st.gasIn > 2) A.push({ pid: gs.id, t: 'Любитель ароматов', d: `${gs.st.gasIn} сек в облаке Вити` });
    const r = top((p) => p.st.rev); if (r.st.rev > 0) A.push({ pid: r.id, t: 'Ангел-хранитель', d: `поднял друзей ${r.st.rev} раз` });
    const d = top((p) => p.st.downs); if (d.st.downs > 0) A.push({ pid: d.id, t: 'Профессиональный лежун', d: `падал ${d.st.downs} раз` });
    const x = top((p) => p.st.xp); A.push({ pid: x.id, t: x.hero === 'hasan' ? 'Пылесос усов' : 'Пылесос', d: `собрал ${Math.round(x.st.xp)} опыта` });
    const k = top((p) => p.st.dmg); A.push({ pid: k.id, t: 'Мясник парка', d: `${Math.round(k.st.dmg)} урона` });
    const c = top((p) => p.st.combo); if (c.st.combo > 0) A.push({ pid: c.id, t: 'Командный игрок', d: `${c.st.combo} комбо` });
    S.awards = A; ev(S, { k: S.won ? 'win' : 'lose' });
  }

  // ---------------- attract demo: four bots fighting through a sped-up wave ----------------
  const scriptInput = () => ({});
  let cache = null;
  function at(t) {
    const loop = Math.floor(t / L), q = t - loop * L, n = Math.round(q / DT);
    if (!cache || cache.loop !== loop || cache.S.steps > n) { const S0 = create({ mode: 'demo' }); S0.wt0 = loop * L; S0.wave = 3; S0.lvl = 4; cache = { loop, S: S0 };
      for (const p of S0.players) { p.ult = 0.55 + 0.1 * p.id; p.tier = p.hero === 'leha' ? 2 : 0; } }
    const S = cache.S; while (S.steps < n) step(S, {});
    return Object.assign({}, S, { loop, q });
  }
  const demoCheck = (S) => S.kills > 30 && S.players.every((p) => !p.out);
  const selfCheck = () => { const f = []; S0check(f); return f; };
  const S0check = (f) => { const S = create(); for (const p of S.players) if (blocked(p.x, p.y, 24)) f.push('player spawn blocked ' + p.hero);
    for (const [x, y] of LAMPS) if (onPave(x, y) && dist(x, y, C[0], C[1]) < 200) f.push('lamp in plaza centre'); };

  root.SIM = { DT, L, VIEW, WORLD, HINT, C, PLAZA, PATHS, SUBS, PROPS, SOLIDS, POND, LAMPS, HEROES, ORDER, ETYPES, UPG, QCD, LEHA_GUNS, WAVE_LEN, BREAK, WAVES,
    onPave, inGas, collide, create, spawn, respawn, outOfPlay, step, at, scriptInput, demoCheck, selfCheck, botInput };
  if (typeof module !== 'undefined') module.exports = root.SIM;
})(typeof window !== 'undefined' ? window : globalThis);
