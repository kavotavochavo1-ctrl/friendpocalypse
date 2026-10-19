// live/sim.js — FRIENDPOCALYPSE: deterministic co-op survivor-like sim, fixed 120 Hz, 1–8 players (humans or bots).
// Contract (engine.md §6): create / step / at / spawn / respawn / outOfPlay / scriptInput; events in S.ev.
// Host-authoritative: the host steps S with every player's input ({ players: { id: inp } }) and ships S to clients.
// Every reaction (whips, clouds, cards, rockets, revives, combos, voice lines) lives here so all clients see the same.
(function (root) {
  const DT = 1 / 120, L = 36.0;
  const VIEW = { W: 1920, H: 1080 }, WORLD = { x0: 0, y0: 0, x1: 5200, y1: 3800 };
  const C = [2600, 1900];                                                    // plaza centre
  const PLAZA = [600, 500];                                                  // plaza radii (3/4 view squash)
  const HINT = 'WASD — бег · Q — способность · R — ульта · E — поднять друга · 1/2/3 — улучшение';
  const h1 = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  const h2 = (a, b) => h1(a * 12.9898 + b * 78.233);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

  // ---------------- heroes ----------------
  const HEROES = {
    hasan: { name: 'ХАСАН', hp: 85, spd: 252, col: [0.85, 0.55, 0.25], pick: 1.2 },
    danil: { name: 'ДАНИЛ', hp: 100, spd: 242, col: [1.0, 0.35, 0.75], pick: 1.0 },
    vitya: { name: 'ВИТЯ', hp: 100, spd: 245, col: [0.55, 0.95, 0.25], pick: 1.0 },
    leha: { name: 'ЛЁХА', hp: 140, spd: 215, col: [0.6, 0.7, 0.35], pick: 1.0 },
  };
  const ORDER = ['hasan', 'danil', 'vitya', 'leha'];
  const QCD = { hasan: 16, danil: 20, vitya: 18, leha: 22 };
  const LEHA_GUNS = ['ПИСТОЛЕТ', 'ПП', 'ДРОБОВИК', 'РПГ'];

  // ---------------- enemies ----------------
  const ETYPES = {
    ghoul: { hp: 22, spd: 112, r: 22, dmg: 9, xp: 1, sc: 1.0, from: 1, w: 1 },
    sprinter: { hp: 12, spd: 205, r: 18, dmg: 6, xp: 1, sc: 0.8, from: 2, w: 0.35 },
    brute: { hp: 130, spd: 72, r: 38, dmg: 16, xp: 5, sc: 1.65, from: 3, w: 0.1 },
    spitter: { hp: 28, spd: 90, r: 22, dmg: 7, xp: 2, sc: 1.05, from: 4, ranged: 1, w: 0.14 },
    bomber: { hp: 18, spd: 150, r: 22, dmg: 18, xp: 2, sc: 1.0, from: 5, bomb: 1, w: 0.12 },
  };
  const WAVE_LEN = 60, BREAK = 9, WAVES = 10, LASH_HIT = 0.21;              // Hasan's whip: snap 0.21 s after the swing starts (scene LASH)
  // ability sizes (kept compact so 4–8 players don't paint the whole screen)
  const ULT_STAGE = 5, ULT_GAS = 230, TORNADO = { r: 140, ttl: 4, spd: 150 }, CHARM = { r: 360, half: 0.62, ttl: 2.5 }, JET = { r: 380, half: 0.45 };
  const stageCard = (p, ua, k) => { const a = ua * 1.6 + k * Math.PI / 4, R = 150 * p.m.area; return [p.x + Math.cos(a) * R, p.y - 30 + Math.sin(a) * R * 0.72]; };
  const inCone = (p, e, ang, r, half) => { const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy); if (d > r + e.r) return false; if (d < 30) return true;
    const da = Math.atan2(dy, dx) - ang; return Math.abs(Math.atan2(Math.sin(da), Math.cos(da))) < half; };
  const COOP = [1, 1, 1.65, 2.2, 2.7, 3.15, 3.55, 3.95, 4.3], COOP_HP = [1, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35];

  // ---------------- progression (Vampire Survivors / HoloCure style) ----------------
  // Every item has 5 levels. Slots: the hero's own weapon + up to 2 shared weapons + up to 4 passives.
  // Signature weapon at level 5 + its partner passive (level 2+) unlocks an EVOLUTION card.
  const SIG = {
    hasan: { n: 'Усы-хлысты', lv: ['Два уса хлещут ближайших', '+25% урона', '+1 ус за удар', '+25% радиус', 'Стягивание каждым 2-м ударом'], evo: 'pick', evoN: 'Усатый вихрь', evoD: 'Усы крутятся вокруг постоянно и стягивают толпу' },
    danil: { n: 'Фотокарточки', lv: ['Карты с рикошетом', '+1 карта за бросок', '+1 рикошет', '+30% урона', '+1 карта, карты пробивают'], evo: 'crit', evoN: 'Коллекция ультраредок', evoD: 'Кольцо карт вращается вокруг и бьёт само' },
    vitya: { n: 'Тихий, но смертельный', lv: ['Облако позади себя', 'Облако +20% больше', 'Пукает на 20% чаще', '+30% урона, яд замедляет', 'Два облака за раз'], evo: 'hp', evoN: 'Газовый циклон', evoD: 'Ходячий ядовитый смерч следует за Витей' },
    leha: { n: 'Оружейная лицензия', lv: ['Пистолет', 'ПП: очередь', 'Дробовик: веер дроби', '+30% урона', 'РПГ: ракеты со взрывом'], evo: 'armor', evoN: 'Карманный апокалипсис', evoD: 'РПГ стреляет залпом из 3 ракет' },
  };
  const WEAPONS = {
    tapok: { n: 'Тапок', lv: ['Бумеранг-тапок летит и возвращается', '+1 тапок', '+30% урона', '+1 тапок', 'Летит быстрее, бьёт сильнее'] },
    can: { n: 'Энергетик', lv: ['Банка-граната в толпу', 'Взрыв +25% больше', '+1 банка', '+30% урона', '+1 банка'] },
    speaker: { n: 'Колонка', lv: ['Бас бьёт волной вокруг', '+15% радиус', '+30% урона', 'Бас на 20% чаще', 'Волна замедляет врагов'] },
  };
  const PASSIVES = {
    dmg: { n: 'Злость', d: '+8% урона' }, as: { n: 'Кофеин', d: '+7% скорости атаки' }, area: { n: 'Размах', d: '+8% радиус атак' },
    hp: { n: 'Шаурма', d: '+15 к макс. HP, лечит' }, spd: { n: 'Кроссовки', d: '+5% скорости бега' }, pick: { n: 'Магнит', d: '+25% радиус сбора' },
    armor: { n: 'Толстокожий', d: '-5% входящего урона' }, regen: { n: 'Чай с мёдом', d: '+0.3 HP в секунду' }, crit: { n: 'Везунчик', d: '+4% шанс крита' },
    cd: { n: 'Без перерыва', d: '-6% перезарядки Q и ульты' },
    deo: { n: 'Дезодорант', d: 'Витя: на 35% меньше урона друзьям', hero: 'vitya', max: 3 }, plate: { n: 'Бронеплита', d: 'Лёха: щит +1.2 с, -4% урона', hero: 'leha', max: 3 },
  };
  const MAXW = 2, MAXP = 4;
  const lv = (p, id) => (p.items && p.items[id]) || 0;
  // derived stats from item levels (recomputed on every pick: no drifting multipliers)
  function recalc(p) {
    const H = HEROES[p.hero], m = p.m, L = (id) => lv(p, id);
    Object.assign(m, { dmg: 1 + 0.08 * L('dmg'), as: 1 + 0.07 * L('as'), area: 1 + 0.08 * L('area'), spd: 1 + 0.05 * L('spd'), pick: H.pick * (1 + 0.25 * L('pick')),
      armor: (1 - 0.05 * L('armor')) * (1 - 0.04 * L('plate')), regen: 0.3 * L('regen'), crit: 0.04 + 0.04 * L('crit'), cd: 1 - 0.06 * L('cd'),
      deo: Math.pow(0.65, L('deo')), shield: 1.2 * L('plate'), extra: 0, rico: 1, pullN: 3, ttl: 1, sdmg: 1, sarea: 1, srate: 1, pierce: 0, double: 0 });
    const g = L('sig');
    if (p.hero === 'hasan') { if (g >= 2) m.sdmg = 1.25; if (g >= 3) m.extra = 1; if (g >= 4) m.sarea = 1.25; if (g >= 5) m.pullN = 2; }
    if (p.hero === 'danil') { m.extra = (g >= 2 ? 1 : 0) + (g >= 5 ? 1 : 0); m.rico = g >= 3 ? 2 : 1; if (g >= 4) m.sdmg = 1.3; m.pierce = g >= 5 ? 1 : 0; }
    if (p.hero === 'vitya') { if (g >= 2) m.sarea = 1.2; if (g >= 3) m.srate = 0.8; if (g >= 4) m.sdmg = 1.3; m.double = g >= 5 ? 1 : 0; }
    if (p.hero === 'leha') { p.tier = [0, 1, 2, 2, 3][Math.max(0, g - 1)]; if (g >= 4) m.sdmg = 1.3; }
    p.hpMax = H.hp + 15 * L('hp'); p.hp = Math.min(p.hp, p.hpMax);
  }
  // what a card offers: { id, kind: 'sig' | 'w' | 'p' | 'evo' | 'heal', n, d, tag }
  function cardFor(p, id) {
    if (id === 'evo') { const sg = SIG[p.hero]; return { id, kind: 'evo', n: sg.evoN, d: sg.evoD, tag: 'ЭВОЛЮЦИЯ' }; }
    if (id === 'heal') return { id, kind: 'heal', n: 'Перекус', d: 'Лечит 40% HP', tag: '' };
    if (id === 'sig') { const sg = SIG[p.hero], l = lv(p, 'sig'); return { id, kind: 'sig', n: sg.n, d: sg.lv[l], tag: 'Ур. ' + (l + 1) }; }
    if (WEAPONS[id]) { const w = WEAPONS[id], l = lv(p, id); return { id, kind: 'w', n: w.n, d: w.lv[l], tag: l ? 'Ур. ' + (l + 1) : 'НОВОЕ' }; }
    const q = PASSIVES[id], l = lv(p, id); return { id, kind: 'p', n: q.n, d: q.d, tag: l ? 'Ур. ' + (l + 1) : 'НОВОЕ' };
  }
  const UPG = { WEAPONS, PASSIVES, SIG };

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
      pick: null, pickT: 0, items: { sig: 1 }, evo: 0, ultLock: 0, wcd: {}, vcd: 0, gasT: -9, buffT: -9, selfRes: 1,
      st: { dmg: 0, ally: 0, allyHit: 0, rev: 0, downs: 0, xp: 0, kills: 0, gasIn: 0, combo: 0 },
      prev: {}, cam: [C[0] - VIEW.W / 2, C[1] - VIEW.H / 2], camV: [0, 0] }; };
  const newPlayer = (id, hero, bot, i) => { const p = mkPlayer(id, hero, bot, i); recalc(p); return p; };

  function create(cfg = {}) {
    const heroes = cfg.heroes || ORDER, S = { t: 0, steps: 0, wt0: 0, mode: cfg.mode || 'play', seed: cfg.seed || 1,
      players: [], enemies: [], proj: [], eproj: [], clouds: [], zones: [], gems: [], marks: [], booms: [], nid: 1, rt: 0, pause: 0, pend: [], clear: 0, clearT: 0,
      wave: 1, waveT: 0, brk: 0, xp: 0, lvl: 1, xpNext: 6, eliteT: 20, chests: [], food: [], spawnAcc: 0, over: 0, won: 0, freeze: 0, kills: 0,
      comboT: -9, comboK: {}, sayT: -9, banter: 0, ev: [], awards: null, me: 0, solo: 0 };
    heroes.forEach((h, i) => S.players.push(newPlayer(i, h, cfg.humans ? !cfg.humans.includes(i) : 1, i)));
    S.solo = S.players.filter((p) => !p.bot).length <= 1 && S.players.length === 1 ? 1 : 0;
    S.xpNext = xpNeed(S, 1);
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
    if (!p || p.out || (p.down && cat !== 'down')) return; p.ccd = p.ccd || {};             // knocked-out / downed heroes stay quiet
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
    if (p) { p.st.dmg += dmg;
      if (p.hero === 'hasan' && !p.hitSet.includes(e.id)) { p.hitSet.push(e.id); if (p.hitSet.length > 8) p.hitSet.shift(); } }
    if (crit) ev(S, { k: 'crit', x: e.x, y: e.y });
    if (e.hp <= 0) killEnemy(S, e, p, kind);
  };
  const killEnemy = (S, e, p, kind) => {
    const T = ETYPES[e.type]; S.kills++; if (p) { p.st.kills++; if (S.t > p.ultLock) p.ult = Math.min(1, p.ult + 0.0032 * T.xp); }
    ev(S, { k: 'kill', x: e.x, y: e.y, type: e.type, kind, pid: p ? p.id : -1, sc: T.sc });
    S.gems.push({ id: S.nid++, x: e.x, y: e.y - 4, v: T.xp, t0: S.t });
    if (e.elite || h2(e.id, S.steps) < 0.015) S.food.push({ id: S.nid++, x: e.x + 20, y: e.y + 10, t0: S.t });
    if (e.type === 'bomber') explode(S, e.x, e.y, 100, 0, null, 'bomb');
    if (e.elite) { S.chests.push({ id: S.nid++, x: e.x, y: e.y, t0: S.t }); for (let i = 0; i < 6; i++) S.gems.push({ id: S.nid++, x: e.x + 80 * (h2(S.steps, i) - 0.5), y: e.y + 60 * (h2(S.steps, i + 3) - 0.5), v: 3, t0: S.t }); }
    // combos
    if (p && p.hero === 'leha' && S.marks.some((m) => m.id === e.id && S.t < m.until)) combo(S, 'headshot', e.x, e.y, p, 3);
    if (e.pullT && S.t - e.pullT < 1.6 && inGas(S, e.x, e.y)) { const hz = S.players.find((q) => q.id === e.pullBy); combo(S, 'gaswhip', e.x, e.y, hz, 4); }
  };
  const explode = (S, x, y, r, dmg, p, kind) => {
    let gas = null; if (kind === 'rocket') { gas = inGas(S, x, y); if (gas) { r *= 1.6; dmg *= 1.5; gas.ttl = S.t - gas.t0 + 0.3; combo(S, 'gasboom', x, y, p, 3); } }
    ev(S, { k: 'boom', x, y, r, kind, gas: gas ? 1 : 0 });
    if (dmg > 0) near(x, y, r, (e) => { const d = dist(e.x, e.y, x, y) || 1; hurtEnemy(S, e, dmg * (1 - 0.4 * d / r), p, kind, (e.x - x) / d * 260, (e.y - y) / d * 260); });
    if (kind === 'bomb') for (const q of S.players) if (alive(q) && dist(q.x, q.y, x, y) < r) hurtPlayer(S, q, 18 * (1 + 0.06 * (S.wave - 1)), null);
  };
  const hurtPlayer = (S, p, dmg, src, ally) => {
    if (!alive(p) || (!ally && S.t < p.inv)) return;
    let d = dmg * p.m.armor; if (p.hero === 'leha') { if (p.stillT > 2) d *= 0.75; if (S.t - p.qT < 4 + p.m.shield) d *= 0.4; }
    if (ally) { d = Math.min(d, p.hp - 1); if (d <= 0) return; } else p.inv = S.t + 0.45;
    p.hp -= d; p.hurtT = S.t; p.hurtBy = ally ? 'gas' : src ? src.type : 'boom/spit'; ev(S, { k: 'hurt', x: p.x, y: p.y, pid: p.id, ally: ally ? 1 : 0 });
    if (p.hp <= 0) { p.hp = 0; p.down = 1; p.downT = 30; p.revP = 0; p.st.downs++; ev(S, { k: 'down', x: p.x, y: p.y, pid: p.id, by: p.hurtBy });
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
      if (p.atkT <= 0 && tgt) { p.atkT = 0.62 / as; p.atkN++; p.atkSide = -p.atkSide; p.lastAtk = t;
        const ang = Math.atan2(p.ay, p.ax), R = 190 * area * p.m.sarea, pull = p.atkN % p.m.pullN === 0, n = 1 + p.m.extra;
        ev(S, { k: 'whip', pid: p.id, x: p.x, y: p.y, ang, side: p.atkSide, pull: pull ? 1 : 0, n, R });
        p.lash = { t: t + LASH_HIT, ang, R, pull, n }; }                 // the lash winds up over his head; damage lands on the snap
      if (p.lash && t >= p.lash.t) { const { ang, R, pull, n } = p.lash; p.lash = null;
        for (let k = 0; k < n; k++) { const a0 = ang + (k - (n - 1) / 2) * 0.55;
          near(p.x, p.y - 40, R, (e) => { const da = Math.atan2(e.y - (p.y - 40), e.x - p.x) - a0, dd = Math.abs(Math.atan2(Math.sin(da), Math.cos(da)));
            if (dd > 0.75) return; const ex = p.x + Math.cos(a0) * 70, ey = p.y - 40 + Math.sin(a0) * 70;
            if (pull && ETYPES[e.type].sc < 1.5 && !e.elite) { e.kx += (ex - e.x) * 5; e.ky += (ey - e.y) * 5; e.pullT = t; e.pullBy = p.id; } else if (pull) e.slowT = t + 1.2;
            hurtEnemy(S, e, 14 * p.m.dmg * p.m.sdmg, p, 'whip', Math.cos(a0) * 120, Math.sin(a0) * 120); }); }
        if (p.hitSet.length >= 5 && t - p.fastT > 6) { p.fastT = t; p.hitSet = []; } }
      // Q «Подкрутил усы»: two mustache blades spin close around him — a melee blender that shoves out and swats spit away (eproj loop)
      if (t - p.qT < 4) { if (Math.floor((t - p.qT) / 0.25) !== Math.floor((t - p.qT - DT) / 0.25))
        near(p.x, p.y - 30, 150 * area, (e) => { const d = dist(e.x, e.y, p.x, p.y) || 1; hurtEnemy(S, e, 8 * p.m.dmg, p, 'twirl', (e.x - p.x) / d * 300, (e.y - p.y) / d * 300); }); }
      // R «Усатое торнадо» is a travelling zone (S.zones, zoneStep)
    }
    if (p.hero === 'danil') {
      if (p.atkT <= 0 && tgt) { p.atkT = 0.55 / as * (p.set === 0 ? 0.85 : 1); p.lastAtk = t; const n = 1 + p.m.extra, ang = Math.atan2(p.ay, p.ax);
        for (let k = 0; k < n; k++) { const a = ang + (k - (n - 1) / 2) * 0.16;
          S.proj.push({ id: S.nid++, own: p.id, kind: 'card', x: p.x + p.ax * 24, y: p.y - 50, vx: Math.cos(a) * 920, vy: Math.sin(a) * 920, dmg: 10 * p.m.dmg * p.m.sdmg, ttl: 0.9, rico: p.m.rico + (p.set === 2 ? 1 : 0), pierce: p.m.pierce || 0, hit: [], tox: 0, c: (p.atkN + k) % 4 }); }
        p.atkN++; ev(S, { k: 'throw', pid: p.id, x: p.x, y: p.y }); }
      // R «Камбэк года»: a stage of 8 giant idol cards orbits him for 5 s — a fence that hits and shoves out whoever touches it, then the cards fly out
      const ua = t - p.ultT;
      if (ua < ULT_STAGE && Math.floor(ua / 0.12) !== Math.floor((ua - DT) / 0.12))
        for (let k = 0; k < 8; k++) { const [cx, cy] = stageCard(p, ua, k);
          near(cx, cy, 44, (e) => { const d = dist(e.x, e.y, p.x, p.y) || 1; hurtEnemy(S, e, 9 * p.m.dmg, p, 'card', (e.x - p.x) / d * 480, (e.y - p.y) / d * 480); }); }
      if (ua >= ULT_STAGE && ua - DT < ULT_STAGE)
        for (let k = 0; k < 8; k++) { const [cx, cy] = stageCard(p, ua, k), a = Math.atan2(cy - (p.y - 30), cx - p.x);
          S.proj.push({ id: S.nid++, own: p.id, kind: 'card', x: cx, y: cy - 20, vx: Math.cos(a) * 820, vy: Math.sin(a) * 820, dmg: 18 * p.m.dmg, ttl: 0.8, rico: 1, hit: [], tox: 0, c: k % 4 }); }
    }
    if (p.hero === 'vitya') {
      const solo = S.players.filter((q) => q !== p && alive(q) && dist(q.x, q.y, p.x, p.y) < 320).length;
      p.zone = 1 + 0.3 * Math.max(0, 1 - solo / 2);
      if (p.atkT <= 0) { p.atkT = 3.4 * p.m.srate / as; p.lastAtk = t; addCloud(S, p, p.x - p.fx * 30, p.y - 10 - p.fy * 20, 85 * area * p.m.sarea, 4.2);
        if (p.m.double) addCloud(S, p, p.x + p.fy * 110, p.y - 10 - p.fx * 80, 75 * area * p.m.sarea, 4.2); }
      if (t - p.ultT > 0.95 && t - p.ultT - DT <= 0.95) addCloud(S, p, p.ux, p.uy, ULT_GAS * area, 6, 1);
    }
    if (p.hero === 'leha') {
      const g = S.t - p.ultT < 7 ? 4 : p.tier, rate = [0.5, 0.13, 1.0, 1.5, 0.35][g];
      if (p.atkT <= 0 && tgt) { p.atkT = rate / as; p.lastAtk = t; p.atkN++; const ang = Math.atan2(p.ay, p.ax);
        const shot = (a, sp, dmg, kind, ttl) => S.proj.push({ id: S.nid++, own: p.id, kind, x: p.x + Math.cos(a) * 46, y: p.y - 52 + Math.sin(a) * 30, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg: dmg * p.m.dmg * p.m.sdmg, ttl, rico: 0, hit: [] });
        if (g === 0) shot(ang, 1300, 13, 'bullet', 0.6);
        if (g === 1) shot(ang + (h2(S.steps, 3) - 0.5) * 0.22, 1400, 6.5, 'bullet', 0.55);
        if (g === 2) for (let k = 0; k < 6; k++) shot(ang + (k - 2.5) * 0.11 + (h2(S.steps, k) - 0.5) * 0.06, 1150, 8, 'pellet', 0.32);
        if (g >= 3) { shot(ang, 820, g === 4 ? 52 : 42, 'rocket', 1.1); if (p.evo && g === 3) { shot(ang - 0.2, 800, 30, 'rocket', 1.1); shot(ang + 0.2, 800, 30, 'rocket', 1.1); } }
        ev(S, { k: 'shot', pid: p.id, x: p.x, y: p.y, ang, g }); }
    }
  }

  function gearStep(S, p, t) {
    const as = p.m.as, area = p.m.area, every = (id, period) => { p.wcd[id] = (p.wcd[id] || 0) - DT; if (p.wcd[id] > 0) return false; p.wcd[id] = period; return true; };
    const L = (id) => lv(p, id);
    // Тапок: a boomerang that flies out and comes back, hitting everything on both passes
    if (L('tapok') && every('tapok', 2.4 / as)) { const n = 1 + (L('tapok') >= 2) + (L('tapok') >= 4), fast = L('tapok') >= 5;
      for (let k = 0; k < n; k++) { const e = nearest(S, p.x, p.y, 650, []); const a = e ? Math.atan2(e.y - p.y, e.x - p.x) + (k - (n - 1) / 2) * 0.6 : (k / n) * Math.PI * 2 + t;
        const sp = fast ? 820 : 640; S.proj.push({ id: S.nid++, own: p.id, kind: 'tapok', x: p.x, y: p.y - 50, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, sp, t0: t, out: 0.55,
          dmg: 12 * p.m.dmg * (L('tapok') >= 3 ? 1.3 : 1) * (fast ? 1.25 : 1), ttl: 3, hit: [], back: 0 }); }
      ev(S, { k: 'throw', pid: p.id, x: p.x, y: p.y }); }
    // Энергетик: a can lobbed into the crowd, explodes where it lands
    if (L('can') && every('can', 3.2 / as)) { const n = 1 + (L('can') >= 3) + (L('can') >= 5), list = [];
      near(p.x, p.y, 560, (e) => list.push(e));
      for (let k = 0; k < n && list.length; k++) { const e = list[Math.floor(h2(S.steps, k + p.id) * list.length)];
        S.proj.push({ id: S.nid++, own: p.id, kind: 'can', x: p.x, y: p.y - 50, vx: (e.x - p.x) / 0.6, vy: (e.y - 45 - p.y + 50) / 0.6, t0: t, ttl: 0.6, hit: [],
          r: 95 * area * (L('can') >= 2 ? 1.25 : 1), dmg: 18 * p.m.dmg * (L('can') >= 4 ? 1.3 : 1) }); } }
    // Колонка: a bass pulse around the hero
    if (L('speaker') && every('speaker', 1.7 * (L('speaker') >= 4 ? 0.8 : 1) / as)) { const R = 150 * area * (L('speaker') >= 2 ? 1.15 : 1), d0 = 8 * p.m.dmg * (L('speaker') >= 3 ? 1.3 : 1);
      near(p.x, p.y - 30, R, (e) => { const d = dist(e.x, e.y, p.x, p.y) || 1; hurtEnemy(S, e, d0, p, 'bass', (e.x - p.x) / d * 220, (e.y - p.y) / d * 220); if (L('speaker') >= 5) e.slowT = Math.max(e.slowT, t + 1); });
      ev(S, { k: 'bass', pid: p.id, x: p.x, y: p.y, r: R }); }
    if (!p.evo) return;
    if (p.hero === 'hasan' && every('evo', 0.3)) near(p.x, p.y - 30, 170 * area, (e) => { const d = dist(e.x, e.y, p.x, p.y) || 1;
      if (ETYPES[e.type].sc < 1.5 && !e.elite) { e.kx += (p.x - e.x) / d * 90; e.ky += (p.y - e.y) / d * 90; } hurtEnemy(S, e, 7 * p.m.dmg * p.m.sdmg, p, 'twirl'); });
    if (p.hero === 'danil' && every('evo', 0.2)) for (let k = 0; k < 6; k++) { const a = t * 2.4 + k * Math.PI / 3, cx = p.x + Math.cos(a) * 130, cy = p.y - 40 + Math.sin(a) * 100;
      near(cx, cy, 34, (e) => hurtEnemy(S, e, 9 * p.m.dmg * p.m.sdmg, p, 'card')); }
    if (p.hero === 'vitya' && every('evo', 3.5)) { addCloud(S, p, p.x, p.y - 10, 170 * area, 4); S.clouds[S.clouds.length - 1].follow = p.id; S.clouds[S.clouds.length - 1].cyc = 1; }
  }

  function useQ(S, p, t) {
    // aim: Danil at the nearest crowd (charm cone), everyone else where he faces
    p.qa = p.hero === 'danil' && p.ax !== undefined ? Math.atan2(p.ay, p.ax) : Math.atan2(p.fy, p.fx);
    p.qT = t; p.qCD = QCD[p.hero] * p.m.cd; ev(S, { k: 'q', pid: p.id, hero: p.hero, x: p.x, y: p.y, ang: p.qa }); say(S, p, 'q');
    const area = p.m.area, ca = Math.cos(p.qa), sa = Math.sin(p.qa);
    // Danil «Фан-чант»: a megaphone cone of hearts — enemies in it are charmed (stop, wander, take +50%), friends nearby get the fan buff
    if (p.hero === 'danil') { near(p.x, p.y, CHARM.r * area, (e) => { if (!inCone(p, e, p.qa, CHARM.r * area, CHARM.half)) return;
        const big = ETYPES[e.type].sc >= 1.5 || e.elite; e.charmT = t + CHARM.ttl * (big ? 0.5 : 1); S.marks.push({ id: e.id, until: e.charmT, by: p.id }); });
      for (const q of S.players) if (alive(q) && dist(q.x, q.y, p.x, p.y) < 320) q.buffT = Math.max(q.buffT, t + 4); }
    // Vitya «Залп по ветру»: a gas jet — shoves the cone back, poisons it and leaves a short trail of small clouds along the line
    if (p.hero === 'vitya') { near(p.x, p.y, JET.r * area, (e) => { if (!inCone(p, e, p.qa, JET.r * area, JET.half)) return; const d = dist(e.x, e.y, p.x, p.y);
        const f = 1 - 0.5 * d / (JET.r * area); e.kx += ca * 720 * f; e.ky += sa * 720 * f; e.poisT = t + 4; e.slowT = Math.max(e.slowT, t + 1.2); hurtEnemy(S, e, 6 * p.m.dmg * p.m.sdmg, p, 'gas'); });
      [[110, 55], [200, 62], [290, 70]].forEach(([d, r]) => addCloud(S, p, p.x + ca * d * area, p.y - 10 + sa * d * 0.75 * area, r * area, 5)); }
    // Лёха «Прикрыл!»: a riot shield in front — a bash on raise, then it blocks spit from the front while he walks behind it
    if (p.hero === 'leha') near(p.x + ca * 60, p.y - 20 + sa * 45, 110, (e) => { hurtEnemy(S, e, 10 * p.m.dmg, p, 'bash', ca * 560, sa * 560); e.slowT = Math.max(e.slowT, t + 1); });
  }
  function useUlt(S, p, t) {
    p.ult = 0; p.ultT = t; p.ultLock = t + 35 * p.m.cd; ev(S, { k: 'ult', pid: p.id, hero: p.hero, x: p.x, y: p.y }); say(S, p, 'ult', true);
    if (p.hero === 'vitya') { p.ux = p.x; p.uy = p.y - 10; ev(S, { k: 'warn', x: p.ux, y: p.uy, r: ULT_GAS * p.m.area, until: t + 0.95 }); }
    if (p.hero === 'danil') for (const q of S.players) if (alive(q) && dist(q.x, q.y, p.x, p.y) < 320) q.buffT = t + 6;
    if (p.hero === 'hasan') S.zones.push({ id: S.nid++, kind: 'tornado', owner: p.id, x: p.x + p.fx * 110, y: p.y + p.fy * 80, vx: p.fx * TORNADO.spd, vy: p.fy * TORNADO.spd * 0.75,
      t0: t, ttl: TORNADO.ttl, r: TORNADO.r * p.m.area });
  }
  // travelling zones: Hasan's tornado drifts where he faced, sucks small enemies into a spin, chips them, flings them at the end
  function zoneStep(S, t) {
    for (const z of S.zones) { const p = S.players.find((q) => q.id === z.owner); if (!p) { z.ttl = 0; continue; }
      z.x += z.vx * DT; z.y += z.vy * DT; const zx = z.x, zy = z.y; collide(z, 20); if (z.x !== zx) z.vx *= -1; if (z.y !== zy) z.vy *= -1;
      const a = t - z.t0, R = z.r, end = a + DT >= z.ttl;
      near(z.x, z.y, R * 1.8, (e) => { const dx = e.x - z.x, dy = e.y - z.y, d = Math.hypot(dx, dy) || 1, big = ETYPES[e.type].sc >= 1.5 || e.elite;
        if (end) { if (d < R * 1.3) hurtEnemy(S, e, 34 * p.m.dmg, p, 'tornado', dx / d * 900, dy / d * 900); return; }
        if (!big) { const inw = d > R * 0.55 ? 1 : -0.4, k = d < R ? 1 : 0.55; e.kx += (-dy / d * 9 - dx / d * 5 * inw) * 30 * k; e.ky += (dx / d * 9 - dy / d * 5 * inw) * 30 * k; e.pullT = t; e.pullBy = p.id; }
        else e.slowT = t + 0.5;
        if (d < R && S.steps % 12 === 0) hurtEnemy(S, e, 6 * p.m.dmg, p, 'tornado'); });
      if (end) ev(S, { k: 'boom', x: z.x, y: z.y, r: R * 1.2, kind: 'tornado' }); }
    S.zones = S.zones.filter((z) => t < z.t0 + z.ttl);
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
    if (p.hp < p.hpMax * 0.6) for (const f of S.food) { const d = dist(f.x, f.y, p.x, p.y); if (d < 500) { mx += (f.x - p.x) / d * 1.5; my += (f.y - p.y) / d * 1.5; break; } }
    const wob = Math.sin(S.t * 0.9 + p.id * 2.1); mx += wob * 0.25; my += Math.cos(S.t * 0.7 + p.id) * 0.25;
    if (Math.abs(mx) > 0.25) inp[mx > 0 ? 'right' : 'left'] = 1; if (Math.abs(my) > 0.25) inp[my > 0 ? 'down' : 'up'] = 1;
    let cnt = 0; near(p.x, p.y, 240, () => cnt++);
    if (cnt >= 4 && p.qCD <= 0) inp.q = 1;
    if (p.ult >= 1 && cnt >= 6) inp.r = 1;
    return inp;
  }
  const botPick = (p) => { const rank = (c) => ({ evo: 0, sig: 1, w: c.tag === 'НОВОЕ' ? 3 : 2, p: c.tag === 'НОВОЕ' ? 5 : 4, heal: 6 })[c.kind];   // bots pick like a sensible player
    let b = 0; p.pick.forEach((c, i) => { if (rank(c) < rank(p.pick[b])) b = i; }); return b + 1; };
  // level-up / chest pick: the whole world waits until every player with a pending pick has chosen (S.t is frozen; S.rt keeps going)
  const PICK_AFK = 30;
  function pauseStep(S, inps) {
    for (const p of S.players) { if (!p.pick || p.out) continue;
      const inp = p.bot ? {} : (inps[p.id] || {});
      let slot = p.bot ? (S.rt - p.pickT > 1.2 ? botPick(p) : 0) : inp.slot;
      if (!(slot >= 1 && slot <= p.pick.length) && S.rt - p.pickT > PICK_AFK) slot = 1;                       // AFK: take the first card
      if (slot >= 1 && slot <= p.pick.length) applyPick(S, p, p.pick[slot - 1].id, S.t); }
  }

  // ---------------- step ----------------
  function step(S, inpAll) {
    if (S.over) { S.t += DT; S.steps++; if (S.ev.length > 96) S.ev.splice(0, S.ev.length - 96); return S; }
    const inps = (inpAll && inpAll.players) || { 0: inpAll || {} };
    S.rt = (S.rt || 0) + DT; S.steps++;
    S.pend = S.players.filter((p) => p.pick && !p.out).map((p) => p.id); S.pause = S.pend.length ? 1 : 0;
    if (S.pause) { pauseStep(S, inps); if (S.ev.length > 96) S.ev.splice(0, S.ev.length - 96); return S; }
    const t = S.t + DT; S.t = t;
    buildGrid(S);
    // ---- waves ----
    if (S.brk > 0) { S.brk -= DT; if (S.brk <= 0) { S.wave++; S.waveT = 0; ev(S, { k: 'wave', n: S.wave }); const p = S.players[Math.floor(h1(S.wave) * S.players.length)]; say(S, p, 'wave'); } }
    // the wave timer runs out → no more spawns; the break starts only once the last enemy of the wave is dead
    else if (S.clear) { S.clearT += DT;
      if (!S.enemies.length) { S.clear = 0; if (S.wave >= WAVES) { S.over = t; S.won = 1; finishRun(S); return S; }
        S.brk = BREAK; ev(S, { k: 'break', n: S.wave }); for (const p of S.players) { p.tokens = []; if (p.down && !p.out) { p.down = 0; p.hp = p.hpMax * 0.5; } p.hp = Math.min(p.hpMax, p.hp + p.hpMax * 0.3); }
        S.banter = t + 2; } }
    else { S.waveT += DT; if (S.waveT >= WAVE_LEN) { S.waveT = WAVE_LEN; S.clear = 1; S.clearT = 0; ev(S, { k: 'clear', n: S.wave }); } }
    if (S.banter && t > S.banter) { S.banter = 0; const up = S.players.filter(alive), a = up[Math.floor(h1(S.wave + 3) * up.length)]; if (a) { S.sayT = -9; a.vcd = 0; say(S, a, 'banter'); } }
    if (S.allyDownSay && t > S.allyDownSay[0]) { const a = S.players.find((q) => q.id === S.allyDownSay[1]); S.allyDownSay = 0; if (a && alive(a)) { a.vcd = 0; say(S, a, 'ally_down'); } }
    // ---- spawning: hold a target count around the team, outside every camera ----
    const n = S.players.length, coop = COOP[Math.min(8, n)], humans = Math.max(1, n);
    const want = S.brk > 0 || S.clear ? 0 : Math.min(190, Math.round((7 + S.wave * 5 + S.waveT * (0.08 + S.wave * 0.025)) * coop * (S.solo ? 0.7 : 1)));
    S.spawnAcc += DT * (2 + S.wave * 0.8) * coop;
    const live = S.players.filter(alive);
    while (S.spawnAcc >= 1 && S.enemies.length < want && live.length) { S.spawnAcc -= 1;
      const k = S.steps * 13 + S.enemies.length, p = live[Math.floor(h1(k) * live.length)], a = h1(k + 1) * Math.PI * 2, r = 1150 + 250 * h1(k + 2);
      let x = clamp(p.x + Math.cos(a) * r, 80, WORLD.x1 - 80), y = clamp(p.y + Math.sin(a) * r * 0.75, 180, WORLD.y1 - 60);
      if (blocked(x, y, 30) || S.players.some((q) => dist(q.x, q.y, x, y) < 900)) continue;
      const types = Object.keys(ETYPES).filter((ty) => ETYPES[ty].from <= S.wave), cnt = {};
      for (const o of S.enemies) cnt[o.type] = (cnt[o.type] || 0) + 1;
      const wts = types.map((ty) => (ty === 'spitter' && (cnt.spitter || 0) > Math.max(3, S.enemies.length * 0.12)) || (ty === 'brute' && (cnt.brute || 0) > Math.max(2, S.enemies.length * 0.1)) ? 0 : ETYPES[ty].w);
      let rw = h1(k + 3) * wts.reduce((a, b) => a + b, 0), ty = 'ghoul'; for (let i = 0; i < types.length; i++) { rw -= wts[i]; if (rw <= 0) { ty = types[i]; break; } }
      const T = ETYPES[ty], w1 = S.wave - 1, hp = T.hp * (1 + 0.18 * w1 + 0.025 * w1 * w1) * COOP_HP[Math.min(8, n)];
      S.enemies.push({ id: S.nid++, type: ty, x, y, vx: 0, vy: 0, kx: 0, ky: 0, hp, hpMax: hp, r: T.r, hitT: -9, atkT: 0, slowT: -9, poisT: -9, born: t, dist: 0, face: 1, flee: 0, shotT: t + 2 + h1(k) * 2, spawnT: t });
    }
    if (S.spawnAcc > 3) S.spawnAcc = 3;
    // an elite every ~25 s from wave 2: a golden brute that drops a chest (a free upgrade for whoever opens it)
    if (S.brk <= 0 && !S.clear && S.wave >= 2 && live.length && (S.eliteT -= DT) <= 0) { S.eliteT = Math.max(14, 28 - S.wave);
      const p = live[Math.floor(h1(S.steps) * live.length)], a = h1(S.steps + 5) * Math.PI * 2;
      const x = clamp(p.x + Math.cos(a) * 1200, 80, WORLD.x1 - 80), y = clamp(p.y + Math.sin(a) * 900, 180, WORLD.y1 - 60), w1 = S.wave - 1;
      if (!blocked(x, y, 40)) { const hp = 130 * 6 * (1 + 0.18 * w1 + 0.025 * w1 * w1) * COOP_HP[Math.min(8, n)];
        S.enemies.push({ id: S.nid++, type: 'brute', elite: 1, x, y, vx: 0, vy: 0, kx: 0, ky: 0, hp, hpMax: hp, r: 46, hitT: -9, atkT: 0, slowT: -9, poisT: -9, born: t, dist: 0, face: 1, flee: 0, shotT: 9e9, spawnT: t });
        ev(S, { k: 'elite', x, y }); } }
    // ---- players ----
    for (const p of S.players) {
      const inp = p.bot ? botInput(S, p) : (inps[p.id] || {});
      const edge = (k) => { const v = !!inp[k], e = v && !p.prev[k]; p.prev[k] = v; return e; };
      const qE = edge('q'), rE = edge('r'), eE = edge('e');
      if (p.out) continue;
      if (p.down) { const g = inGas(S, p.x, p.y); p.downT -= DT * (g ? 1.5 : 1); if (g) p.gasDown = t;
        if (S.solo && p.selfRes > 0 && (eE || p.bot)) { p.selfRes--; p.down = 0; p.hp = p.hpMax * 0.5; p.inv = t + 2; ev(S, { k: 'revive', pid: p.id, by: p.id, x: p.x, y: p.y }); }
        const helpers = S.players.filter((q) => q !== p && alive(q) && q.hero !== 'vitya' && dist(q.x, q.y, p.x, p.y) < 85);
        if (helpers.length) { p.revP += DT / 2.4; if (p.revP >= 1) { p.down = 0; p.hp = p.hpMax * 0.5; p.inv = t + 1.5; p.revP = 0; helpers[0].st.rev++; helpers[0].ult = Math.min(1, helpers[0].ult + 0.12);
          ev(S, { k: 'revive', pid: p.id, by: helpers[0].id, x: p.x, y: p.y }); say(S, helpers[0], 'revive'); } }
        else p.revP = Math.max(0, p.revP - DT * 0.3);
        const vt = S.players.find((q) => q.hero === 'vitya' && alive(q) && dist(q.x, q.y, p.x, p.y) < 85); if (vt && S.t - (p.cantT || -9) > 4) { p.cantT = S.t; say(S, vt, 'cant_revive'); }
        if (p.downT <= 0) { p.out = 1; ev(S, { k: 'out', pid: p.id, x: p.x, y: p.y }); }
        continue; }
      // move
      const ix = (inp.right ? 1 : 0) - (inp.left ? 1 : 0), iy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0), il = Math.hypot(ix, iy) || 1;
      const slowLeha = p.hero === 'leha' ? 1 - 0.04 * p.tier : 1, fast = t - p.fastT < 2 ? 1.25 : 1;
      const spd = HEROES[p.hero].spd * p.m.spd * slowLeha * fast * (t - p.qT < 4 && p.hero === 'hasan' ? 1.1 : 1);
      const tx = ix / il * spd, ty = iy / il * spd, acc = 2600 * DT;
      p.vx += clamp(tx - p.vx, -acc, acc); p.vy += clamp(ty - p.vy, -acc, acc);
      if (ix || iy) { p.fx = ix / il; p.fy = iy / il; p.dir = Math.abs(iy) > Math.abs(ix) * 1.2 ? (iy > 0 ? 0 : 2) : (ix > 0 ? 1 : 3); p.stillT = 0; } else p.stillT += DT;
      p.qCD = Math.max(0, p.qCD - DT);
      const mx = p.vx, my = p.vy;
      p.x += mx * DT; p.y += my * DT; collide(p, 24);
      const moved = Math.hypot(mx, my) * DT; if (moved > 0.05) { const b = Math.floor(p.dist / 62); p.dist += moved; if (Math.floor(p.dist / 62) !== b) ev(S, { k: 'step', pid: p.id, x: p.x, y: p.y }); }
      if (qE && p.qCD <= 0) useQ(S, p, t);
      if (rE && p.ult >= 1) useUlt(S, p, t);
      if (p.m.regen) p.hp = Math.min(p.hpMax, p.hp + p.m.regen * DT);
      if (t > p.ultLock) p.ult = Math.min(1, p.ult + DT / 300);                // about one ultimate per 1.5-2 min of fighting
      heroStep(S, p, inp, t); gearStep(S, p, t);
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
      let spd = T.spd * (t < e.slowT ? 0.45 : 1) * (t < e.poisT ? 0.8 : 1) * (inGas(S, e.x, e.y) ? 0.8 : 1) * (S.clear && S.clearT > 15 ? 1.6 : 1);
      let dx = 0, dy = 0; const charmed = t < (e.charmT || -9);
      if (charmed) { dx = Math.sin(t * 1.7 + e.id) * 0.35; dy = Math.cos(t * 1.3 + e.id * 2) * 0.35; }
      else if (e.flee) { const p = tg || { x: C[0], y: C[1] }; const d = dist(p.x, p.y, e.x, e.y) || 1; dx = (e.x - p.x) / d; dy = (e.y - p.y) / d; spd *= 1.4; e.hp -= DT * 30; }
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
      if (tg && !e.flee && !charmed) {
        if (td < e.r + 30 && t > e.atkT) { e.atkT = t + 0.7; e.biteT = t;
          if (T.bomb) { e.hp = 0; killEnemy(S, e, null, 'self'); } else hurtPlayer(S, tg, T.dmg * (1 + 0.07 * (S.wave - 1)) * (e.elite ? 1.5 : 1), e); }
        if (T.ranged && td < 640 && t > e.shotT) { e.shotT = t + 3.6 + h2(e.id, S.steps) * 2; const d = td || 1;
          S.eproj.push({ x: e.x, y: e.y - 40, vx: (tg.x - e.x) / d * 340, vy: (tg.y - 40 - e.y + 40) / d * 340, ttl: 2.4, dmg: T.dmg }); ev(S, { k: 'spit', x: e.x, y: e.y }); }
      }
      // gas damage
      const g = inGas(S, e.x, e.y); if (g && Math.floor((t - g.t0) / 0.5) !== Math.floor((t - DT - g.t0) / 0.5)) { const v = S.players.find((q) => q.id === g.owner);
        hurtEnemy(S, e, (g.big ? 26 : 7) * (g.cyc ? 1.5 : 1) * (v ? v.m.dmg * v.m.sdmg * (v.zone || 1) : 1), v, 'gas'); e.poisT = t + 1.5; if (v && lv(v, 'sig') >= 4) e.slowT = Math.max(e.slowT, t + 0.6); }
    }
    S.enemies = S.enemies.filter((e) => e.hp > 0 && !(e.flee && dist(e.x, e.y, C[0], C[1]) > 3000));
    // ---- projectiles ----
    for (const b of S.proj) { b.x += b.vx * DT; b.y += b.vy * DT; b.ttl -= DT;
      const p = S.players.find((q) => q.id === b.own);
      if (b.kind === 'can') { if (b.ttl <= 0 && p) explode(S, b.x, b.y + 45, b.r, b.dmg, p, 'can'); continue; }
      if (b.ttl <= 0) continue;
      if (b.kind === 'tapok' && p) { if (!b.back && t - b.t0 > b.out) { b.back = 1; b.hit = []; }
        if (b.back) { const dx = p.x - b.x, dy = p.y - 50 - b.y, d = Math.hypot(dx, dy) || 1; b.vx = dx / d * b.sp * 1.1; b.vy = dy / d * b.sp * 1.1; if (d < 30) { b.ttl = 0; continue; } } }
      if (b.kind === 'card' && !b.tox && inGas(S, b.x, b.y + 50)) { b.tox = 1; b.dmg *= 1.5; if (!S.comboK['toxcard'] || S.t - S.comboK['toxcard'] > 25) combo(S, 'toxcard', b.x, b.y + 50, p, 1); }
      const e = nearest(S, b.x, b.y + 45, b.kind === 'rocket' ? 34 : 26, b.hit);
      if (e) { b.hit.push(e.id);
        if (b.kind === 'rocket') { explode(S, b.x, b.y + 45, (S.t - p.ultT < 7 ? 150 : 130) * p.m.area, b.dmg, p, 'rocket'); b.ttl = 0; continue; }
        hurtEnemy(S, e, b.dmg, p, b.kind, b.vx * 0.15, b.vy * 0.15); ev(S, { k: 'hit', x: b.x, y: b.y + 45, kind: b.kind, tox: b.tox || 0 });
        if (b.kind === 'card') { p.hitN++; if (p.hitN % 15 === 0 && p.tokens.length < 3) { p.tokens.push(Math.floor(h2(S.steps, p.hitN) * 3)); ev(S, { k: 'token', pid: p.id });
            if (p.tokens.length === 3) { const tk = p.tokens; p.set = tk[0] === tk[1] && tk[1] === tk[2] ? 0 : new Set(tk).size === 3 ? 1 : 2; if (p.set === 1) p.m.crit += 0.1; ev(S, { k: 'set', pid: p.id, set: p.set }); } } }
        if (b.rico > 0) { const n2 = nearest(S, e.x, e.y, 300, b.hit); if (n2) { const d = dist(n2.x, n2.y, e.x, e.y) || 1; b.vx = (n2.x - e.x) / d * 900; b.vy = (n2.y - e.y) / d * 900; b.x = e.x; b.y = e.y - 45; b.rico--; b.dmg *= 0.65; b.ttl = 0.5; continue; } }
        if (b.kind === 'tapok') continue;
        if (b.pierce && b.hit.length <= b.pierce) continue;
        if (b.kind !== 'pellet' || b.hit.length > 1) b.ttl = 0; }
      if (b.kind === 'rocket' && b.ttl <= DT && b.ttl > 0) explode(S, b.x, b.y + 45, 130 * p.m.area, b.dmg, p, 'rocket');
    }
    S.proj = S.proj.filter((b) => b.ttl > 0);
    for (const b of S.eproj) { b.x += b.vx * DT; b.y += b.vy * DT; b.ttl -= DT;
      // Лёха's shield stops spit from the front; Hasan's mustache spin swats it from any side
      const lh = S.players.find((q) => q.hero === 'leha' && alive(q) && t - q.qT < 4 + q.m.shield && dist(q.x, q.y - 40, b.x, b.y) < 150 && (b.x - q.x) * q.fx + (b.y - q.y + 40) * q.fy > 10);
      const hz = S.players.find((q) => q.hero === 'hasan' && alive(q) && t - q.qT < 4 && dist(q.x, q.y - 30, b.x, b.y) < 150 * q.m.area);
      if (lh || hz) { b.ttl = 0; ev(S, { k: 'block', x: b.x, y: b.y, by: lh ? 'leha' : 'hasan' }); continue; }
      for (const p of S.players) { if (!alive(p)) continue;
        if (dist(p.x, p.y - 40, b.x, b.y) < 30) { hurtPlayer(S, p, b.dmg, null); b.ttl = 0; break; } } }
    S.eproj = S.eproj.filter((b) => b.ttl > 0);
    zoneStep(S, t);
    for (const c of S.clouds) if (c.follow !== undefined) { const o = S.players.find((q) => q.id === c.follow); if (o && !o.out) { c.x += (o.x - c.x) * 2.5 * DT; c.y += (o.y - 10 - c.y) * 2.5 * DT; } }
    S.clouds = S.clouds.filter((c) => t < c.t0 + c.ttl);
    S.marks = S.marks.filter((m) => t < m.until);
    // ---- gems: magnet, team XP, level ups ----
    for (const g of S.gems) { let best = null, bd = 1e9;
      for (const p of S.players) { if (!alive(p)) continue; const d = dist(p.x, p.y - 30, g.x, g.y); const R = 95 * p.m.pick * (t - p.qT < 4 && p.hero === 'hasan' ? 3 : 1); if (d < R && d < bd) { bd = d; best = p; } }
      if (best) { const sp = 700 + 900 * (1 - bd / 400); g.x += (best.x - g.x) / bd * sp * DT; g.y += (best.y - 30 - g.y) / bd * sp * DT;
        if (bd < 26) { g.got = 1; S.xp += g.v; best.st.xp += g.v; ev(S, { k: 'gem', x: g.x, y: g.y, pid: best.id, v: g.v }); } } }
    S.gems = S.gems.filter((g) => !g.got && t - g.t0 < 60);
    for (const c of S.chests) for (const p of S.players) if (alive(p) && !c.got && dist(p.x, p.y, c.x, c.y) < 70) { c.got = 1;
      if (p.pick) p.queue = (p.queue || 0) + 1; else { p.pick = rollPick(S, p); p.pickT = S.rt; } ev(S, { k: 'chest', pid: p.id, x: c.x, y: c.y }); say(S, p, 'lvl'); }
    S.chests = S.chests.filter((c) => !c.got);
    for (const f of S.food) for (const p of S.players) if (alive(p) && !f.got && p.hp < p.hpMax && dist(p.x, p.y, f.x, f.y) < 55) { f.got = 1; p.hp = Math.min(p.hpMax, p.hp + p.hpMax * 0.25); ev(S, { k: 'food', pid: p.id, x: f.x, y: f.y }); }
    S.food = S.food.filter((f) => !f.got && t - f.t0 < 40);
    if (S.gems.length > 260) S.gems.splice(0, S.gems.length - 260);
    while (S.xp >= S.xpNext) { S.xp -= S.xpNext; S.lvl++; S.xpNext = xpNeed(S, S.lvl); ev(S, { k: 'lvl', n: S.lvl });
      for (const p of S.players) { if (p.out) continue; if (p.pick) p.queue = (p.queue || 0) + 1; else { p.pick = rollPick(S, p); p.pickT = S.rt; } }
      const p = S.players[Math.floor(h1(S.lvl) * S.players.length)]; say(S, p, 'lvl'); }
    // ---- defeat ----
    if (S.players.every((p) => p.down || p.out)) { S.over = t; S.won = 0; finishRun(S); }
    if (S.ev.length > 96) S.ev.splice(0, S.ev.length - 96);
    return S;
  }
  const xpNeed = (S, l) => Math.round((4 + 3.5 * l + 0.22 * l * l) * (0.1 + 0.35 * S.players.length));   // solo ~lvl 18, four players ~lvl 24 by the end
  function applyPick(S, p, id, t) {
    if (id === 'evo') p.evo = 1; else if (id === 'heal') p.hp = Math.min(p.hpMax, p.hp + p.hpMax * 0.4);
    else { p.items[id] = lv(p, id) + 1; if (id === 'hp') p.hp += 20; }
    const tier0 = p.tier; recalc(p); ev(S, { k: 'upgrade', pid: p.id, id, x: p.x, y: p.y, evo: id === 'evo' ? 1 : 0 });
    if (p.hero === 'leha' && p.tier !== tier0) ev(S, { k: 'gunup', pid: p.id, g: p.tier, x: p.x, y: p.y });             // the arsenal grows: shown over his head
    if (p.queue > 0) { p.queue--; p.pick = rollPick(S, p); p.pickT = S.rt; } else p.pick = null;
  }
  function rollPick(S, p) {
    const cand = [], W = Object.keys(WEAPONS), P = Object.keys(PASSIVES).filter((id) => !PASSIVES[id].hero || PASSIVES[id].hero === p.hero);
    const ownW = W.filter((id) => lv(p, id)), ownP = P.filter((id) => lv(p, id));
    if (lv(p, 'sig') < 5) cand.push(['sig', 4]);
    for (const id of W) if (lv(p, id) ? lv(p, id) < 5 : ownW.length < MAXW) cand.push([id, lv(p, id) ? 3 : 1.2]);
    for (const id of P) { const mx = PASSIVES[id].max || 5; if (lv(p, id) ? lv(p, id) < mx : ownP.length < MAXP) cand.push([id, lv(p, id) ? 2.5 : 1.5]); }
    const out = [];
    if (!p.evo && lv(p, 'sig') >= 5 && lv(p, SIG[p.hero].evo) >= 2) out.push('evo');           // evolution always offered once unlocked
    for (let k = 0; out.length < 3 && cand.length && k < 50; k++) { const tot = cand.reduce((a, c) => a + c[1], 0); let r = h2(S.steps + k * 17, p.id * 7 + S.lvl) * tot;
      for (let i = 0; i < cand.length; i++) { r -= cand[i][1]; if (r <= 0) { out.push(cand[i][0]); cand.splice(i, 1); break; } } }
    while (out.length < 3) out.push('heal');
    return out.slice(0, 3).map((id) => cardFor(p, id));
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
      for (const p of S0.players) { p.ult = 0.55 + 0.1 * p.id; p.items.sig = 3; p.items[['tapok', 'can', 'speaker', 'tapok'][p.id]] = 2; recalc(p); } }
    const S = cache.S; while (S.steps < n) step(S, {});
    return Object.assign({}, S, { loop, q });
  }
  const demoCheck = (S) => S.kills > 30 && S.players.every((p) => !p.out);
  const selfCheck = () => { const f = []; S0check(f); return f; };
  const S0check = (f) => { const S = create(); for (const p of S.players) if (blocked(p.x, p.y, 24)) f.push('player spawn blocked ' + p.hero);
    for (const [x, y] of LAMPS) if (onPave(x, y) && dist(x, y, C[0], C[1]) < 200) f.push('lamp in plaza centre'); };

  root.SIM = { DT, L, VIEW, WORLD, HINT, C, PLAZA, PATHS, SUBS, PROPS, SOLIDS, POND, LAMPS, HEROES, ORDER, ETYPES, UPG, QCD, LEHA_GUNS, WAVE_LEN, BREAK, WAVES,
    onPave, inGas, collide, cardFor, lv, create, spawn, respawn, outOfPlay, step, at, scriptInput, demoCheck, selfCheck, botInput };
  if (typeof module !== 'undefined') module.exports = root.SIM;
})(typeof window !== 'undefined' ? window : globalThis);
