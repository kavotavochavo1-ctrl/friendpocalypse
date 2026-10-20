// live/scene.js — FRIENDPOCALYPSE scene: a pure function of t and the sim state (engine.md §7).
// World renders into a half-res target (L.init pixel: 2) so painted pixel art and rotated parts share one 2-px grid;
// the HUD is drawn after finish at full res. Night: ground darkened by a light-field overlay with warm lamp pools,
// actors take a softer share of light (pitfalls: "one global light multiply").
(function () {
  const S = (window.SCENE = {}), L = LIB, M = L.M, W = SIM.VIEW.W, H = SIM.VIEW.H, Z = window.SIZES;
  S.REPEAT = ['paving_tex', 'grass_tex', 'meleuz_paving_tex'];
  const NIGHT = `
uniform vec4 u_lights[40]; uniform float u_n; uniform float u_dark; uniform vec3 u_amb;
void main(){ float l = 0.0;
  for (int i = 0; i < 40; i++) { if (float(i) >= u_n) break; vec4 q = u_lights[i];
    vec2 d = (v_px - q.xy) / vec2(q.z, q.z * 0.62); l += q.w * exp(-dot(d, d) * 2.4); }
  float a = u_dark * clamp(1.0 - l, 0.0, 1.0); o = vec4(u_amb * a, a); }`;
  const SLASH = `
uniform vec3 u_col; uniform float u_amt; uniform float u_ac; uniform float u_hs; uniform float u_w; uniform float u_core;
void main(){ vec2 d = v_uv * 2.0 - 1.0; float r = length(d), a = atan(d.y, d.x);
  float da = atan(sin(a - u_ac), cos(a - u_ac)); float s = (da + u_hs) / (2.0 * u_hs); if (s < 0.0 || s > 1.0) discard;
  float th = u_w * pow(sin(3.14159 * s), 0.7) * (0.35 + 0.65 * s); float b = 1.0 - smoothstep(0.0, th + 0.002, abs(r - 0.82));
  float core = 1.0 - smoothstep(0.0, th * 0.45 + 0.002, abs(r - 0.82));
  vec3 c = mix(u_col, vec3(1.0, 0.98, 0.85), core * u_core); float al = b * u_amt * s;
  o = vec4(c * al, al * 0.85); }`;
  const POND = `
uniform vec4 u_lamps[6]; uniform vec2 u_sz;
void main(){ vec2 d = v_uv * 2.0 - 1.0; float r = length(d); if (r > 1.0) discard;
  float rim = smoothstep(0.86, 0.9, r); vec2 p = v_uv * u_sz;
  float w = fbm(p * 0.012 + vec2(u_t * 0.05, u_t * 0.03)) * 0.6 + 0.4 * sin(p.y * 0.09 + u_t * 1.3 + fbm(p * 0.02) * 4.0);
  vec3 c = mix(vec3(0.06, 0.16, 0.20), vec3(0.14, 0.30, 0.32), w * 0.5 + 0.25);
  c += vec3(0.5, 0.7, 0.7) * smoothstep(0.82, 0.86, r) * 0.35;
  for (int i = 0; i < 6; i++) { vec4 q = u_lamps[i]; if (q.w <= 0.0) continue; vec2 e = (p - q.xy) / vec2(18.0, 60.0);
    c += vec3(1.0, 0.62, 0.25) * q.w * exp(-dot(e, e)) * (0.6 + 0.4 * sin(p.y * 0.4 - u_t * 3.0 + q.x)); }
  float pad = step(0.55, fbm(p * 0.03 + 3.0)) * step(r, 0.8) * 0.0;
  vec3 stone = mix(vec3(0.25, 0.17, 0.13), vec3(0.42, 0.30, 0.22), step(0.5, fract(atan(d.y, d.x) * 9.0)));
  c = mix(c, stone, rim); c += pad;
  o = vec4(c, 1.0); }`;
  S.programs = () => { L.init(W, H, { night: NIGHT, slash: SLASH, pond: POND }, { pixel: 1 }); L.glyphs('0123456789×+/:-'); };

  const SS = L.SS;
  const INK = [0.12, 0.06, 0.05], GAS = [0.55, 0.78, 0.18], GAS2 = [0.78, 0.86, 0.3], GAS0 = GAS, GAS20 = GAS2, WARM = [1.0, 0.62, 0.26];
  const hcol = (h) => SIM.HEROES[h].col;
  // world-space labels (nameplates, crits) never sit under a HUD panel: top-left stack, top-right map, wave box, ability bar
  const hudFree = (x, y) => y > 150 && x > 80 && x < W - 80 && !(y < 330 && (x < 520 || x > W - 340)) && !(y < 290 && Math.abs(x - W / 2) < 420) && !(y > H - 190 && Math.abs(x - W / 2) < 300);
  const pname = (p) => p.nick || SIM.HEROES[p.hero].name;                   // a friend's nick from the room, else the hero's name
  const FONT = '"Press Start 2P", "Trebuchet MS", sans-serif', FS = 0.62;   // Press Start 2P: clean Cyrillic pixel font, wide → scale sizes
  const lab = (id, str, x, y, o = {}) => L.label(id, str, x, y, Object.assign({}, o, { size: Math.round((o.size || 30) * FS), font: FONT, weight: 'normal' }));
  const labW = (id, str, o = {}) => L.labelW(id, str, Object.assign({}, o, { size: Math.round((o.size || 30) * FS), font: FONT, weight: 'normal' }));
  const DIRN = ['front', 'side', 'back', 'side'];
  const GUNS = ['gun_pistol', 'gun_smg', 'gun_shotgun', 'gun_rpg'];
  const lastEv = (ST, k, pid) => { for (let i = ST.ev.length - 1; i >= 0; i--) { const e = ST.ev[i]; if (e.k === k && e.pid === pid) return e; } return null; };
  const wrap = (str, n) => { const out = []; let cur = ''; for (const w of str.split(' ')) { if ((cur + ' ' + w).trim().length > n && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); } if (cur) out.push(cur); return out; };
  const mmss = (s) => { s = Math.max(0, Math.floor(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const sz = (n) => Z[n] || [G.tex(n).w, G.tex(n).h];
  const COMBO = { gaswhip: 'УСАТЫЙ ГАЗ!', headshot: 'ХЕДШОТ-КАМБЭК!', gasboom: 'ГАЗ РВАНУЛ!', toxcard: 'ТОКСИЧНЫЕ КАРТОЧКИ!' };
  // ---- FX kit: painted effect sprites (art/gen fx_*) + Arcada Effector flipbooks (fxa_*, exported atlases: cols, rows, frames) ----
  const FXA = { fxa_boom: [3, 3, 9], fxa_sparks: [4, 2, 8], fxa_shock: [4, 2, 8], fxa_fan: [4, 2, 8], fxa_gas: [4, 2, 8],
    fxa_evo: [4, 3, 12], fxa_vortex: [4, 4, 16], fxa_holo: [4, 4, 16], fxa_cyclone: [4, 4, 16], fxa_rank: [4, 4, 16],
    fxa_pop: [4, 2, 8], fxa_firework: [4, 3, 12], fxa_ice: [4, 2, 8], fxa_kettle: [4, 4, 16], fxa_flame: [4, 4, 16],
    fxa_beam: [1, 8, 8], fxa_warn: [4, 2, 8], fxa_slam: [3, 3, 9], fxa_wave: [4, 2, 8], fxa_tile: [4, 2, 8], fxa_rspark: [4, 2, 8], fxa_cheese: [4, 2, 8], fxa_dust: [4, 2, 8] };   // boss set (art/effector/make_boss_fx.py)   // alchemy set          // evolution set (art/effector/*.json)
  // chain lightning between two points: a jagged bright line with a soft glow (pure shader, redrawn every frame so it crackles)
  const bolt = (x0, y0, x1, y1, seed, amt) => { const n = 7, dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d; let px = x0, py = y0;
    G.blend('add'); for (let j = 1; j <= n; j++) { const f = j / n, o = j < n ? (L.rnd(seed, j) - 0.5) * 26 : 0, qx = x0 + dx * f + nx * o, qy = y0 + dy * f + ny * o;
      const an = Math.atan2(qy - py, qx - px), l = Math.hypot(qx - px, qy - py); L.solid(px, py - 2, l, 4, [0.75, 0.92, 1], an, 0, 2, amt); L.solid(px, py - 1, l, 2, [1, 1, 1], an, 0, 1, amt);
      G.draw(L.P.glow, { u_col: [0.4, 0.7, 1], u_k: 2.4, u_amt: 0.5 * amt }, G.xf(qx - 18, qy - 18, 36, 36)); px = qx; py = qy; } G.blend(); };
  const loopQ = (t, k = 0) => (((t + k) % 1) + 1) % 1;                                      // looping Effector atlases: 1 s per cycle
  const book = (n, q, x, y, w, h, o = {}) => { if (q < 0 || q >= 1) return; const [c, r, f] = FXA[n], i = Math.min(f - 1, Math.floor(q * f)), cx = i % c, cy = Math.floor(i / c);
    if (o.add) G.blend('add'); L.sprite(n, x - w / 2, y - h / 2, { w, h, src: [cx / c, cy / r, (cx + 1) / c, (cy + 1) / r], u: { alpha: o.a ?? 1, tint: o.tint || [1, 1, 1, 0] } }); if (o.add) G.blend(); };
  const spr = (n, x, y, w, h, rot = 0, o = {}) => { if (o.add) G.blend('add');
    L.sprite(n, 0, 0, { m: M.of(M.t(x, y), M.r(rot)), w, h, pivot: o.pivot || [w / 2, h / 2], flip: !!o.flip, u: { alpha: o.a ?? 1, tint: o.tint || [1, 1, 1, 0] } }); if (o.add) G.blend(); };
  // a painted strand bent along an arc: the texture is cut into N slices, each turned a bit more (mustache whips and blades)
  const ribbon = (n, x, y, ang, len, th, bend, a = 1, N = 8) => { let px = x, py = y; const sl = len / N;
    { let gx = x, gy = y; G.blend('add'); for (let j = 0; j < N; j++) { const an = ang + bend * Math.pow((j + 0.5) / N, 1.6);
        G.draw(L.P.glow, { u_col: [1, 0.6, 0.18], u_k: 2.2, u_amt: 0.25 * a }, G.xf(gx - th * 0.9, gy - th * 0.9, th * 1.8, th * 1.8)); gx += Math.cos(an) * sl; gy += Math.sin(an) * sl; } G.blend(); }
    for (let j = 0; j < N; j++) { const an = ang + bend * Math.pow((j + 0.5) / N, 1.6), tj = th * (1 - 0.35 * j / N);
      L.sprite(n, 0, 0, { m: M.of(M.t(px, py), M.r(an)), w: sl * 1.1, h: tj, pivot: [0, tj / 2], src: [j / N, 0, (j + 1) / N, 1], u: { alpha: a, tint: [1.35, 1.0, 0.6, 0.45] } });
      px += Math.cos(an) * sl; py += Math.sin(an) * sl; }
    return [px, py]; };
  // a flame tongue / tracer streak: a radial glow stretched along the screen direction (pure shader, no sprite)
  const streak = (x, y, as, len, wid, col, amt) => { G.blend('add'); G.draw(L.P.glow, { u_col: col, u_k: 2.4, u_amt: amt }, G.xf(x, y - wid / 2, len, wid, as, 0, wid / 2)); G.blend(); };
  // Hasan's mustache, in screen px from his feet per view (from the painted sprites: ~116 px up, a little forward when side-on)
  const mouth = (p, x, y) => p.dir === 1 || p.dir === 3 ? [x + (p.dir === 3 ? -7 : 7), y - 114] : [x + (p.dir === 2 ? 0 : 3), y - 116];
  // whip lash as a chain (follow-through / overlapping action): the base angle swings from a wind-up behind the head to the aim,
  // segment j follows it D·j/N later, so the wave rolls down the whip and the tip arrives last; all segments agree → straight snap
  const LASH = { T: 0.3, D: 0.28, N: 12 };
  const lashPts = (x0, y0, q, aim, side, R) => { const N = LASH.N, wind = aim + side * 2.2, over = aim - side * 0.15;
    const base = (u) => u < 0.08 ? wind + side * 0.3 * (u / 0.08) : u < 0.42 ? wind + side * 0.3 + (over - wind - side * 0.3) * Math.pow((u - 0.08) / 0.34, 2) : over + (aim - over) * SS(0.42, 0.8, u);
    const len = R * (0.4 + 0.6 * SS(0.04, 0.7, q)) * (1 - 0.7 * SS(0.78, 1, q)), sl = len / N;
    const lift = 70 * (1 - SS(0.3, 0.68, q)) + 24 * SS(0.82, 1, q), drop = 62 * SS(0.3, 0.7, q) * (1 - 0.5 * SS(0.8, 1, q));
    const curl = side * 1.7 * (1 - SS(0.42, 0.68, q) + SS(0.8, 1, q));
    const pts = [[x0, y0]]; let x = x0, y = y0;
    for (let j = 0; j < N; j++) { const s = (j + 1) / N, an = base(q - s * LASH.D) + curl * Math.pow(Math.max(0, (s - 0.65) / 0.35), 2);
      x += Math.cos(an) * sl; y += Math.sin(an) * sl * 0.78; pts.push([x, y - lift * Math.sin(Math.PI * s) * 0.9 + drop * s]); }
    return pts; };
  // the painted strand laid along a polyline: slice j of the texture spans pts[j] → pts[j+1] (thick at the face, thin curling tip)
  const ribbonPts = (n, pts, th, a = 1, tint = [1.2, 1.0, 0.75, 0.3], gcol = [1, 0.6, 0.18]) => { const N = pts.length - 1;
    G.blend('add'); for (let j = 2; j < N; j++) G.draw(L.P.glow, { u_col: gcol, u_k: 2.2, u_amt: 0.14 * a * j / N }, G.xf(pts[j][0] - th * 0.9, pts[j][1] - th * 0.9, th * 1.8, th * 1.8)); G.blend();   // glow grows to the tip, the face stays clear
    for (let j = 0; j < N; j++) { const [x0, y0] = pts[j], [x1, y1] = pts[j + 1], an = Math.atan2(y1 - y0, x1 - x0), sl = Math.hypot(x1 - x0, y1 - y0), tj = th * (1 - 0.45 * j / N);
      L.sprite(n, 0, 0, { m: M.of(M.t(x0, y0), M.r(an)), w: sl * 1.15, h: tj, pivot: [0, tj / 2], src: [j / N, 0, (j + 1) / N, 1], u: { alpha: a, tint } }); } };
  // the hero's own weapon after an element evolution (sigEvo): its colour, plus a mote height over the hero for the idle aura
  const EVOC = { hasan_shock: [0.45, 0.75, 1], hasan_fire: [1, 0.5, 0.15], danil_mail: [0.85, 0.88, 1], danil_fan: [1, 0.4, 0.8],
    vitya_boom: [1, 0.6, 0.15], vitya_frost: [0.6, 0.88, 1], leha_rail: [0.45, 0.8, 1], leha_inc: [1, 0.42, 0.12] };
  const sigOf = (ST, id) => { const o = ST.players.find((q) => q.id === id); return o && o.sigEvo; };
  const pigeon = (x, y, w, fr, flip) => { const n = 'fx_pigeon' + fr; spr(n, x, y, w, w * G.tex(n).h / G.tex(n).w, 0, { flip }); };   // two flap frames, own heights
  const scrA = (a) => Math.atan2(Math.sin(a) * 0.78, Math.cos(a));                   // world direction → screen angle (3/4 squash)
  const CARDC = [[1, 0.35, 0.75], [0.4, 0.75, 1], [1, 0.85, 0.3], [0.75, 0.5, 1]];
  const GUNUP = ['ПИСТОЛЕТ', 'ПП!', 'ДРОБОВИК!', 'РПГ!'];
  // Vitya's gas (procedural, the original soft look): a faint ground glow + soft puffs inside + a denser ring of smaller puffs
  // along the rim, so the radius reads from the gas itself — no outline
  const CLOUDC = { frost: [[0.62, 0.86, 1.0], [0.88, 0.97, 1.0], [0.35, 0.65, 1]], boom: [[0.72, 0.8, 0.2], [1.0, 0.66, 0.22], [0.9, 0.55, 0.1]] };
  const drawCloud = (id, x, y, r, life, a, ally, big, mode) => { const GAS = mode ? CLOUDC[mode][0] : GAS0, GAS2 = mode ? CLOUDC[mode][1] : GAS20;
    G.blend('add'); G.draw(L.P.glow, { u_col: ally ? [0.8, 0.5, 0.1] : mode ? CLOUDC[mode][2] : [0.4, 0.8, 0.1], u_k: 1.4, u_amt: 0.22 * life }, G.xf(x - r, y - r * 0.75, 2 * r, 1.5 * r)); G.blend();
    const n = big ? 16 : 7, m = Math.max(10, Math.min(30, Math.round(r / 7)));
    for (let j = 0; j < n; j++) { const an = L.rnd(id, j) * 6.28 + a * (0.3 + 0.4 * L.rnd(id, j + 9)), rr = r * 0.55 * Math.sqrt(L.rnd(id, j + 3));
      const px = x + Math.cos(an) * rr, py = y + Math.sin(an) * rr * 0.7 - 30 - 18 * a, pr = r * (0.38 + 0.2 * L.rnd(id, j + 5)) * (0.7 + 0.3 * SS(0, 1, a));
      L.puff(px, py, pr, j % 3 ? GAS : GAS2, 0.3 * life, id + j); }
    for (let j = 0; j < m; j++) { const an = (j + 0.4 * L.rnd(id, j + 40)) / m * 6.283 + a * 0.1, rr = r * (0.86 + 0.06 * Math.sin(a * 2 + j));
      L.puff(x + Math.cos(an) * rr, y + Math.sin(an) * rr * 0.75 - 14 - 6 * Math.sin(a * 1.6 + j), r * 0.24 * (0.8 + 0.4 * L.rnd(id, j + 60)) * (0.7 + 0.3 * SS(0, 0.6, a)),
        ally ? [0.85, 0.75, 0.2] : j % 2 ? GAS2 : GAS, 0.34 * life, id * 7 + j); } };
  const EV_TINT = { ghoul: [1, 1, 1, 0], sprinter: [1.25, 0.6, 0.55, 0.8], brute: [0.8, 0.75, 0.95, 0.6], spitter: [0.85, 0.6, 1.3, 0.8], bomber: [1.4, 0.8, 0.4, 0.8],
    starshiy: [0.8, 0.75, 0.9, 0.35], alpha: [0.45, 0.4, 0.5, 0.75] };
  // enemy art: the park's shadow ghouls (one rig, tinted per type); Meleuz's town folk (rigs front/back, sprites side-on), mums and dogs (sprites)
  const SKIN = { ghoul: 'rat', sprinter: 'rat', brute: 'fatrat', spitter: 'toxrat', bomber: 'bombrat', komissar: 'km', gopnik: 'gopnik', starshiy: 'gopnik', alkash: 'alkash', mom: 'mom', dog: 'dog', alpha: 'dog' };
  const BASEH = { ghoul: 84, gopnik: 120, alkash: 112, mom: 124, dog: 78, rat: 58, fatrat: 70, toxrat: 56, bombrat: 62, km: 140 };
  // the red commissar: a painted frame per action (fire from the hip, grenade, speech), a two-frame walk otherwise
  const kmView = (e, dv, ST) => { const K = ST.boss && ST.boss.km, A = K && K.atk, a = A ? ST.t - A.t0 : 9;
    return A && A.k === 'burst' ? 'km_fire' : A && A.k === 'nades' && a < 1.2 ? 'km_throw' : A && A.k === 'speech' ? 'km_speech' : dv === 'side' ? 'km_side' + (Math.floor(e.dist / 40) % 2) : 'km_' + dv; };
  // four-legged runners are frame sprites (3-frame side run + front/back); the toxic and kamikaze rats are one side sprite
  const SPRITE_VIEW = (skin, view, e, GT) => skin === 'toxrat' || skin === 'bombrat' ? skin : skin !== 'dog' && skin !== 'rat' && skin !== 'fatrat' ? skin + '_' + view
    : view === 'side' ? (e.type === 'alpha' && GT - (e.howlT || -99) > -7 && GT - (e.howlT || -99) < -5.6 ? 'dog_alpha' : skin + '_side' + runFrame(skin, e)) : skin + '_' + view;
  // rats run at a steady ~8 frames/s whatever their speed (slow ones stepped by distance looked choppy); dogs keep their stride
  const runFrame = (skin, e) => skin === 'dog' ? Math.floor(e.dist / 26) % 3 : Math.floor(e.dist / (SIM.ETYPES[e.type].spd || 100) * (skin === 'fatrat' ? 6.5 : 8.5)) % 3;
  const BUILD = { admin: 1, mosque: 1, church: 1, glory: 1, lenin: 1, tmonument: 1, kiosk: 1 };

  let camC = null, camGT = 0;
  S.render = (t) => {
    const ST = S.state || SIM.at(t), GT = ST.t, rnd = L.rnd;
    if (SIM.LV.id !== (ST.map || 'park')) SIM.useMap(ST.map || 'park');
    const mz = ST.map === 'meleuz', PAV = mz ? 'meleuz_paving_tex' : 'paving_tex';
    const me = ST.players[ST.me || 0];
    // ---- shake: trauma from recent hits / booms near me ----
    let tr = 0; for (const e of ST.ev) { const a = GT - e.t; if (a < 0 || a > 0.4) continue;
      if (e.k === 'boom' && (e.r >= 140 || e.kind === 'slam' || e.kind === 'bomb')) tr = Math.max(tr, 0.6 * (1 - a / 0.4) * SS(1100, 300, Math.hypot(e.x - me.x, e.y - me.y)));
      if (e.k === 'hurt' && e.pid === me.id && !e.ally) tr = Math.max(tr, 0.3 * (1 - a / 0.3));
      if (e.k === 'ult' && e.pid === me.id) tr = Math.max(tr, 0.4 * (1 - a / 0.4)); }
    const sh = ST.pause ? 0 : tr * tr * 22 * (window.SETTINGS ? SETTINGS.shake() : 1);
    { const tg = ST.cut ? [ST.cut.fx - W / 2, ST.cut.fy - 160 - H / 2] : me.cam; if (!camC || Math.abs(GT - camGT) > 1) camC = me.cam.slice(); camGT = GT;
      camC[0] += (tg[0] - camC[0]) * 0.07; camC[1] += (tg[1] - camC[1]) * 0.07; if (!ST.cut && Math.hypot(tg[0] - camC[0], tg[1] - camC[1]) < 4) camC = null; }
    const cam0 = camC || me.cam, cx = Math.round(cam0[0] + sh * Math.sin(GT * 83)), cy = Math.round(cam0[1] + sh * Math.sin(GT * 101 + 1));
    const sx = (x) => x - cx, sy = (y) => y - cy, vis = (x, y, m = 300) => x > cx - m && x < cx + W + m && y > cy - m && y < cy + H + m;

    // ===== ground =====
    L.beginBG([0.05, 0.05, 0.06, 1]);
    { const T = 640; L.sprite('grass_tex', 0, 0, { w: W, h: H, src: [cx / T, cy / T, (cx + W) / T, (cy + H) / T], u: { grade: [0.9, 0.95, 0, 1] } }); }
    const PT = 520;
    for (const [px, py, pw, ph, pr] of SIM.PATHS) { if (!vis(px, py, Math.max(pw, ph))) continue;
      L.sprite(PAV, sx(px - pw / 2), sy(py - ph / 2), { w: pw, h: ph, rot: pr, pivot: [pw / 2, ph / 2], src: [0, 0, pw / PT, ph / PT] });
      L.solid(sx(px - pw / 2), sy(py - ph / 2), pw, 10, [0.16, 0.09, 0.07], pr, pw / 2, ph / 2, 0.6);
      L.solid(sx(px - pw / 2), sy(py + ph / 2 - 10), pw, 10, [0.16, 0.09, 0.07], pr, pw / 2, -ph / 2 + 10, 0.6); }
    for (const [x, y, rx, ry, k] of SIM.SUBS) { if (!vis(x, y, rx)) continue;
      L.sprite(PAV, sx(x - rx), sy(y - ry), { w: rx * 2, h: ry * 2, src: [x / PT, y / PT, (x + 2 * rx) / PT, (y + 2 * ry) / PT], u: { disc: 0.02 } }); }
    { const [x, y] = SIM.C, rx = SIM.PLAZA[0] * 1.06, ry = SIM.PLAZA[1] * 1.06; L.sprite(mz ? 'meleuz_plaza_center' : 'plaza_center', sx(x - rx), sy(y - ry), { w: rx * 2, h: ry * 2 }); }
    // the eternal flame at the Monument of Glory: a dark star in the paving, the fire itself goes in the y-sort
    if (SIM.LV.FLAME && vis(SIM.LV.FLAME[0], SIM.LV.FLAME[1], 200)) { const fx = sx(SIM.LV.FLAME[0]), fy = sy(SIM.LV.FLAME[1]);
      L.shadow(fx, fy, 70, 34, 0.5); for (let j = 0; j < 5; j++) { const a = j / 5 * 6.283 - 1.571; L.solid(fx, fy, 64, 12, [0.42, 0.3, 0.24], scrA(a), 0, 6, 0.9); } L.shadow(fx, fy, 26, 13, 0.7); }
    // Сгущёнка: sticky cream puddles on the ground
    for (const z of ST.zones || []) { if (z.kind !== 'goo' || !vis(z.x, z.y, z.r)) continue; const a = GT - z.t0, life = SS(0, 0.2, a) * SS(z.ttl, z.ttl - 0.6, a), x = sx(z.x), y = sy(z.y);
      L.shadow(x, y, z.r * 1.02, z.r * 0.72, 0.3 * life);
      for (let j = 0; j < 9; j++) { const an = rnd(z.id, j) * 6.28, rr = z.r * 0.62 * Math.sqrt(rnd(z.id, j + 4)); L.puff(x + Math.cos(an) * rr, y + Math.sin(an) * rr * 0.7, z.r * (0.36 + 0.12 * rnd(z.id, j + 8)), [0.96, 0.9, 0.72], 0.55 * life, z.id + j); }
      for (let j = 0; j < 4; j++) L.star(x + (rnd(z.id, j + 20) - 0.5) * z.r, y + (rnd(z.id, j + 30) - 0.5) * z.r * 0.6, 7, [1, 1, 0.9], 0.5 * life * (0.5 + 0.5 * Math.sin(GT * 5 + j))); }
    // pond
    { const [x, y, rx, ry] = SIM.POND; if (vis(x, y, rx)) { const lam = new Float32Array(24); let k = 0;
        for (const [lx, ly] of SIM.LAMPS) if (k < 6 && Math.hypot(lx - x, ly - y) < 600) { lam.set([(lx - (x - rx)) * 1, (ly - (y - ry)) + 90, 0, 0.5], k * 4); k++; }
        G.draw(L.P.pond, { u_t: t, u_lamps: lam, u_sz: [rx * 2, ry * 2] }, G.xf(sx(x - rx), sy(y - ry), rx * 2, ry * 2)); } }
    // Vitya's gas: a soft shadow under the cloud (the puffs above draw the edge)
    for (const c of ST.clouds) { const a = GT - c.t0, life = SS(0, 0.25, a) * SS(c.ttl, c.ttl - 0.6, a); if (!vis(c.x, c.y, c.r)) continue;
      L.shadow(sx(c.x), sy(c.y), c.r * 0.9, c.r * 0.66, 0.22 * life); }
    // ultimate warning: the patch darkens and gas boils up along its rim before it goes off
    for (const e of ST.ev) if (e.k === 'warn' && e.slam && GT < e.until && GT >= e.t) { const q = (GT - e.t) / (e.until - e.t);
      L.shadow(sx(e.x), sy(e.y), e.r * 0.95, e.r * 0.7, 0.3 * q); L.ring(sx(e.x), sy(e.y), e.r * q, e.r * 0.72 * q, [1, 0.3, 0.2], 0.8, 0.05); L.cracks(sx(e.x), sy(e.y), e.r * 0.6 * q, q, e.t, 0, 0.5 * q); }
    for (const e of ST.ev) if (e.k === 'warn' && !e.slam && GT < e.until && GT >= e.t) { const q = (GT - e.t) / (e.until - e.t), x = sx(e.x), y = sy(e.y);
      L.shadow(x, y, e.r * 0.95, e.r * 0.7, 0.35 * q); G.blend('add'); G.draw(L.P.glow, { u_col: [0.5, 0.9, 0.1], u_k: 1.4, u_amt: (0.2 + 0.15 * Math.sin(GT * 24)) * q }, G.xf(x - e.r, y - e.r * 0.75, 2 * e.r, 1.5 * e.r)); G.blend();
      for (let j = 0; j < 18; j++) { const an = j / 18 * 6.283, ph = (q * 2 + L.rnd(e.t, j)) % 1;
        L.puff(x + Math.cos(an) * e.r * 0.85, y + Math.sin(an) * e.r * 0.64 - 20 - ph * 30, 22 + 18 * q, j % 2 ? GAS2 : GAS, 0.4 * q * SS(1, 0.6, ph), e.t + j); } }
    // chests (elite drops) and shawarma
    // «Бабушкин котёл»: the cauldron an elite drops — bubbling, glinting, hard to miss
    for (const c of ST.chests || []) { if (!vis(c.x, c.y, 80)) continue; const b = 2 * Math.sin(t * 3 + c.id), x = sx(c.x), y = sy(c.y);
      L.glow(x, y - 20, 80, [0.4, 1, 0.5], 0.35 + 0.12 * Math.sin(t * 4), 2); L.shadow(x, y + 2, 34, 9, 0.5);
      spr('fx_kettle', x, y - 30 + b, 70, 64); book('fxa_kettle', loopQ(t * 0.9, c.id * 0.3), x, y - 70 + b, 110, 110, { add: 1 }); }
    for (const f of ST.food || []) { if (!vis(f.x, f.y, 40)) continue; const b = 3 * Math.sin(t * 3.4 + f.id), x = sx(f.x), y = sy(f.y);
      L.shadow(x, y + 3, 16, 5, 0.45); L.glow(x, y - 12, 34, [1, 0.6, 0.3], 0.25, 2);
      L.rrect(x - 9, y - 30 + b, 18, 26, 8, [0.95, 0.85, 0.6], [0.8, 0.6, 0.35]); L.solid(x - 8, y - 22 + b, 16, 4, [0.85, 0.3, 0.2]); L.solid(x - 7, y - 14 + b, 14, 3, [0.4, 0.7, 0.3]); }
    // gems (on the ground, before the y-sort)
    for (const g of ST.gems) { if (!vis(g.x, g.y, 40)) continue; const b = 4 * Math.sin(t * 4 + g.id), big = g.v > 1, r = big ? 11 : 7, col = big ? [0.75, 0.4, 1.0] : [0.3, 0.85, 1.0];
      L.shadow(sx(g.x), sy(g.y) + 6, r, r * 0.4, 0.4); L.solid(sx(g.x) - r * 0.7, sy(g.y) - r * 0.7 + b - 6, r * 1.4, r * 1.4, col, Math.PI / 4, r * 0.7, r * 0.7);
      L.solid(sx(g.x) - r * 0.3, sy(g.y) - r * 0.5 + b - 8, r * 0.5, r * 0.5, [0.95, 1, 1], Math.PI / 4, r * 0.25, r * 0.25); }

    // ===== night: darken the ground, warm pools under the lamps =====
    const lights = [];
    for (const [x, y] of SIM.LAMPS) if (vis(x, y, 400)) lights.push([sx(x), sy(y) - 20, 330, 1.05 + 0.04 * Math.sin(t * 7.3 + x)]);
    for (const e of ST.ev) { const a = GT - e.t; if (a < 0) continue;
      if (e.k === 'boom' && a < 0.4) lights.push([sx(e.x), sy(e.y), e.r * 2, 0.7 * (1 - a / 0.4)]);
      if (e.k === 'shot' && a < 0.05) lights.push([sx(e.x), sy(e.y) - 50, 120, 0.35]); }
    for (const p of ST.players) if (!p.out && !p.inBus) lights.push([sx(p.x), sy(p.y) - 30, 300, p.id === me.id ? 0.55 : 0.3]);
    if (SIM.LV.FLAME && vis(SIM.LV.FLAME[0], SIM.LV.FLAME[1], 400)) lights.push([sx(SIM.LV.FLAME[0]), sy(SIM.LV.FLAME[1]) - 30, 380, 1.1 + 0.08 * Math.sin(t * 9)]);
    if (ST.bus && vis(ST.bus.x, ST.bus.y, 500)) lights.push([sx(ST.bus.x), sy(ST.bus.y) - 60, 420, 0.9]);
    lights.length = Math.min(40, lights.length);
    const lightAt = (x, y) => { let l = 0; for (const q of lights) { const dx = (x - q[0]) / q[2], dy = (y - q[1]) / (q[2] * 0.62); l += q[3] * Math.exp(-(dx * dx + dy * dy) * 2.4); } return Math.min(1.3, l); };
    { const arr = new Float32Array(160); lights.forEach((q, i) => arr.set(q, i * 4));
      G.draw(L.P.night, { u_lights: arr, u_n: lights.length, u_dark: 0.64, u_amb: [0.05, 0.03, 0.09] }, G.xf(0, 0, W, H)); }
    for (const [x, y] of SIM.LAMPS) if (vis(x, y, 300)) L.glow(sx(x), sy(y) - 10, 300, WARM, 0.3, 1.8);
    L.beginComp();
    drawHazards(ST, GT, sx, sy, vis);

    // ===== y-sorted world =====
    const Y = [];
    const shade = (x, y) => { const l = lightAt(x, y); return { grade: [0.85 + 0.15 * Math.min(1, l), 0.5 + 0.55 * Math.min(1, l), 0, 1], tint: [1.0, 0.82, 0.62, 0.35 * Math.min(1, l)] }; };
    for (const [k, x, y, s, f] of SIM.PROPS) { const [w, h] = sz(k), ww = w * s, hh = h * s; if (!vis(x, y, Math.max(420, ww * 0.6, hh))) continue;
      if (k === 'lenin' && ST.boss && ST.boss.kind === 'lenin') continue;
      Y.push([y, () => { const sxx = sx(x), syy = sy(y), u = shade(sxx, syy - Math.min(hh * 0.5, 200));
        if (BUILD[k]) { u.grade[0] = Math.max(0.8, u.grade[0]); u.grade[1] = Math.max(0.62, u.grade[1]); }             // landmarks stay readable at night
        if (k !== 'flowers') L.shadow(sxx + 10, syy - 4, ww * 0.42, Math.min(BUILD[k] ? 60 : 30, hh * 0.12), 0.5);
        const sway = (k === 'tree' || k === 'autumn' || k === 'cypress' || k === 'spruce' || k === 'thuja') ? [0.004, 3, t * 0.8 + x * 0.01, 1] : 0;
        L.sprite(k, sxx - ww / 2, syy - hh + (k === 'flowers' ? hh * 0.4 : 0), { w: ww, h: hh, flip: !!f, pad: sway ? 0.03 : 0, u: Object.assign(u, sway ? { sway } : {}) });
        if (k === 'lamp') { const lx = sxx, ly = syy - hh * 0.86; L.glow(lx, ly, 60, [1, 0.72, 0.35], 0.55, 2.5); L.glow(lx, ly, 18, [1, 0.92, 0.7], 0.6, 2); }
        if (k === 'mlamp') for (const [ox, oy] of [[0, 0.91], [-0.3, 0.76], [0.3, 0.76]]) L.glow(sxx + ox * ww, syy - hh * oy, 40, [1, 0.92, 0.72], 0.6, 2.2);
        if (k === 'admin' || k === 'mosque' || k === 'church') L.glow(sxx, syy - hh * 0.35, ww * 0.45, [1, 0.75, 0.4], 0.12, 1.6);
        if (k === 'kiosk') { const on = ST.wave >= (ST.kioskNext ?? 3) && !ST.bus; L.glow(sxx - ww * 0.05, syy - hh * 0.45, 70, on ? [0.4, 1, 0.75] : [1, 0.7, 0.35], on ? 0.5 + 0.2 * Math.sin(GT * 5) : 0.25, 2);
          if (on) { const ny = syy - hh - 30 + 5 * Math.sin(GT * 4); spr('it_can', sxx, ny, 40, 40); if (Math.hypot(me.x - x, me.y - y - 50) < 200 && hudFree(sxx, ny - 40)) lab('kio', 'E — энергетик', sxx, ny - 44, { size: 20, al: 0.5, col: '#9fffd0', font: FONT }); } } }]); }
    // the eternal flame (Effector flame flipbook on a warm glow)
    if (SIM.LV.FLAME && vis(SIM.LV.FLAME[0], SIM.LV.FLAME[1], 200)) { const [fx0, fy0] = SIM.LV.FLAME;
      Y.push([fy0, () => { const fx = sx(fx0), fy = sy(fy0); L.glow(fx, fy - 30, 90, [1, 0.55, 0.15], 0.6 + 0.1 * Math.sin(GT * 11), 2);
        book('fxa_flame', loopQ(GT * 1.1), fx, fy - 40, 70, 100, { add: 1 }); book('fxa_flame', loopQ(GT * 1.3, 0.5), fx + 8, fy - 34, 44, 70, { add: 1, a: 0.7 }); }]); }
    // the PAZik: parked with its door open, a glow and the head count over it
    if (ST.bus && vis(ST.bus.x, ST.bus.y, 600)) { const b = ST.bus;
      Y.push([b.y, () => { const [bw, bh] = sz('bus_paz'), x = sx(b.x), y = sy(b.y) + 1.5 * Math.sin(GT * 30) * SS(1.2, 0, GT - b.t0), dx = x + SIM.DOOR[0], dy = y + SIM.DOOR[1];
        const arr = SS(0, 1.2, GT - b.t0), ox = (1 - arr) * 900;                        // it rolls in from the edge
        L.shadow(x + ox, y - 6, bw * 0.46, 26, 0.55); L.sprite('bus_paz', x - bw / 2 + ox, y - bh, { w: bw, h: bh, u: { grade: [1, 1, 0, 1] } });
        L.glow(dx + ox, dy - 50, 90, [1, 0.85, 0.45], 0.45 + 0.2 * Math.sin(GT * 6), 2);
        if (arr >= 1) { for (let j = 0; j < 3; j++) { const ph = (GT * 1.4 + j / 3) % 1; L.ring(dx, dy, 40 + 70 * ph, 28 + 50 * ph, [1, 0.85, 0.4], 0.6 * (1 - ph), 0.08); }
          const act = ST.players.filter((p) => !p.out), n = act.filter((p) => p.inBus).length, s2 = (b.to === 'home' ? 'ДОМОЙ ' : 'В МЕЛЕУЗ ') + n + '/' + act.length;
          if (hudFree(x, y - bh - 30)) lab('busn', s2, x, y - bh - 30 + 4 * Math.sin(GT * 3), { size: 28, al: 0.5, col: '#ffe066', font: FONT }); } }]); }
    // enemies
    if (ST.boss && ST.boss.dead && (ST.boss.kind === 'lenin' || !ST.boss.gone) && vis(ST.boss.dx, ST.boss.dy, 400)) { const B = ST.boss;     // what's left of the boss
      Y.push([B.dy, () => { const n = B.kind === 'lenin' ? 'lenin_toppled' : 'vlad_dead', hh = B.kind === 'lenin' ? 170 : 110, ww = L.hsz(n, hh); L.shadow(sx(B.dx), sy(B.dy), ww * 0.4, 16, 0.5);
        L.sprite(n, sx(B.dx) - ww / 2, sy(B.dy) - hh, { w: ww, h: hh, u: shade(sx(B.dx), sy(B.dy) - 60) }); }]); }
    for (const e of ST.enemies) { if (!vis(e.x, e.y, e.boss || SIM.ETYPES[e.type].boss ? 500 : 120)) continue; const T = SIM.ETYPES[e.type], skin = SKIN[e.type] || 'ghoul';
      if (T.boss) { if (ST.boss) Y.push([e.y, () => drawBoss(e, ST.boss, sx(e.x), sy(e.y), GT, shade)]); continue; }
      Y.push([e.y, () => { const sp = Math.hypot(e.vx, e.vy), ph = e.dist / 34 * Math.PI, born = SS(0, 0.35, GT - e.spawnT); if (born < 0.03) return;      // a zero-scale rig blows up
        const dv = RATS[skin] ? 'side' : Math.abs(e.vy) > Math.abs(e.vx) * 1.3 ? (e.vy > 0 ? 'front' : 'back') : 'side', view = skin === 'km' ? kmView(e, dv, ST) : SPRITE_VIEW(skin, dv, e, GT);     // rats always run side-on
        const h = BASEH[skin] * T.sc * born * (e.elite ? 1.25 : 1) * (ST.spor === 'chonk' ? 1.4 : 1), w = L.hsz(view, h), x = sx(e.x) + (e.chg === 1 ? 3 * Math.sin(GT * 60) : 0), y = sy(e.y), bob = Math.abs(Math.sin(ph)) * 4 * Math.min(1, sp / 60);
        const hit = SS(0.12, 0, GT - e.hitT), u = shade(x, y - h / 2), tn = EV_TINT[e.type]; u.grade[1] = Math.max(0.78, u.grade[1]); u.rim = [0.55, e.face > 0 ? 0.004 : -0.004, -0.005, 1]; u.rimCol = [1, 0.45, 0.6];
        if (hit > 0) { u.grade = [1, 1, hit * 0.85, 1]; u.haze = [1, 0.95, 0.95]; }
        const charm = GT < (e.charmT || -9);
        const burning = GT < (e.burnT || -9), frozen = GT < (e.freezeT || -9);
        u.tint = e.elite ? (e.type === 'alpha' ? [0.75, 0.55, 0.3, 0.6] : [1.5, 1.15, 0.45, 0.85]) : frozen ? [0.7, 1.0, 1.6, 0.8] : charm ? [1.4, 0.6, 1.2, 0.65] : burning ? [1.5, 0.8, 0.45, 0.5] : tn ? [tn[0], tn[1], tn[2], tn[3]] : [1, 1, 1, 0];
        if (e.chg === 2) for (let j = 1; j <= 3; j++) L.puff(x - e.cdx * 26 * j, y - 8 - 4 * j, 10 + 6 * j, [0.55, 0.45, 0.4], 0.4 / j, GT * 10 + j);     // the pram's dust trail
        if (e.elite) L.glow(x, y - h * 0.5, h * 0.9, [1, 0.75, 0.25], 0.22 + 0.08 * Math.sin(GT * 5), 2);
        L.shadow(x, y, w * 0.32, 9 * T.sc, 0.5);
        const sq = 1 + 0.06 * Math.sin(2 * ph) * Math.min(1, sp / 60), lean = (e.vx / 300) * 0.12 + (GT - e.biteT < 0.2 ? 0.25 * e.face * Math.sin((GT - e.biteT) / 0.2 * Math.PI) : 0);
        if (RIG.has(view)) { const k = h / RIGS[view].h, ba = GT - (e.biteT || -9);
          RIG.draw({ name: view, view: dv, x, y, k, fl: dv === 'side' ? e.face : 1, ph: RIG.phase(view, e.dist, k, dv) + e.id, amt: Math.min(1, sp / 60), t, id: 'e' + e.id, u,
            aim: Math.atan2(e.vy, e.vx || 0.001), act: ba < 0.35 ? { kind: 'bite', a: ba / 0.35 } : null, lean: (e.vx / 300) * 0.1 });
        } else { const fx = dv === 'side' || SIDE_ONLY[skin] || view === 'km_fire' ? (skin === 'ghoul' ? -e.face : e.face) : 1, wob = skin === 'alkash' ? 0.07 * Math.sin(GT * 2.3 + e.id) : 0;     // the town folk's art faces right; drunks sway
          L.sprite(view, 0, 0, { m: M.of(M.t(x, y - bob), M.r(lean + wob), M.s(fx / Math.sqrt(sq), sq)), w, h, pivot: [w / 2, h], u }); }
        if (skin === 'ghoul') { const ex = dv === 'side' ? [0.17 * e.face] : dv === 'front' ? [-0.12, 0.12] : []; for (const o of ex) L.glow(x + o * w, y - h * 0.68 - bob, 7 * T.sc, [1, 0.3, 0.6], 0.9, 2); }
        else if (dv !== 'back' && !RATS[skin] && skin !== 'km') L.glow(x + (dv === 'side' ? 0.12 * e.face * w : 0), y - h * (skin === 'dog' ? 0.62 : 0.84) - bob, 10 * T.sc, [1, 0.3, 0.7], 0.5, 2);
        if (skin === 'km') { L.glow(x, y - h * 0.5, 70, [1, 0.2, 0.15], 0.2, 2); if (view === 'km_speech') { L.ring(x, y - h * 0.5, 80, 90, [1, 0.4, 0.3], 0.6, 0.05); L.glow(x, y - h * 0.5, 90, [1, 0.3, 0.2], 0.25, 2); } }
        if (skin === 'toxrat') L.glow(x + 0.4 * w * e.face, y - h * 0.45, 22, [0.5, 1, 0.2], 0.4, 2);
        if (skin === 'bombrat') { L.glow(x - 0.05 * w * e.face, y - h * 1.0, 16, [1, 0.8, 0.3], 0.6 + 0.4 * Math.sin(GT * 30 + e.id), 2); }
        if (e.type === 'bomber') L.glow(x, y - h * 0.5, 50, [1, 0.5, 0.1], 0.4 + 0.3 * Math.sin(GT * 14), 2.4);
        if (GT < (e.rootT || -9)) { const wb = 0.06 * Math.sin(GT * 9 + e.id);
          for (const [hy, rt] of [[0.42, 0.18], [0.62, -0.14]]) spr('fx_mustache', x, y - h * hy - bob, w * 0.95, w * 0.3, rt + wb, { tint: [1.2, 0.9, 0.6, 0.3] }); }
        if (frozen) spr('fx_ice', x, y - 24 * T.sc, 44 * T.sc, 52 * T.sc, 0, { a: 0.85 });
        if (burning) book('fxa_flame', loopQ(GT * 1.2, e.id * 0.17), x, y - h * 0.55, 40 * T.sc, 60 * T.sc, { add: 1, a: 0.8 });
        if (charm || ST.marks.some((m) => m.id === e.id)) { const hb = 4 * Math.sin(GT * 6 + e.id); L.glow(x, y - h - 20 + hb, 22, [1, 0.4, 0.8], 0.5, 2); spr('fx_heart', x, y - h - 20 + hb, 24, 22, 0.15 * Math.sin(GT * 3 + e.id)); }
        // small fry: a health bar only right after a hit (less noise); elites and big ones always
        if (e.hp < e.hpMax && (e.elite || T.sc >= 1.5 || GT - e.hitT < 1.5)) { const bw = 44 * Math.max(1, T.sc * 0.8); L.solid(x - bw / 2 - 2, y - h - 10, bw + 4, 8, [0.08, 0.03, 0.04]); L.solid(x - bw / 2, y - h - 8, bw * Math.max(0, e.hp / e.hpMax), 4, [0.95, 0.22, 0.32]); }
      }]); }
    // players
    for (const p of ST.players) { if (p.out || p.inBus || p.nat || !vis(p.x, p.y, 160)) continue;
      Y.push([p.y, () => { drawHero(p, sx(p.x), sy(p.y), GT, t, p.id === me.id, shade, ST); if (GT < (p.rootT || 0) && ST.boss) spr('trap_shut', sx(p.x) + 8, sy(p.y) - 10, 54, 40); }]);
      // «Прикрыл!»: a riot shield held in front — behind him when he walks up, an edge-on slab when he walks sideways
      if (p.hero === 'leha' && !p.down && GT - p.qT < 4 + ((p.m && p.m.shield) || 0)) { const qa = GT - p.qT, dur = 4 + ((p.m && p.m.shield) || 0), up = SS(0, 0.15, qa) * SS(dur, dur - 0.3, qa);
        const fx = p.fx || 0, fy = p.fy || 1, side = Math.abs(fx) > Math.abs(fy) * 1.2;
        Y.push([p.y + fy * 26 + 1, () => { const x = sx(p.x) + fx * 46, y = sy(p.y) + fy * 22, w = (side ? 30 : 66) * up, hgt = 92 * up;
          L.shadow(x, y + 2, w * 0.5 + 6, 7, 0.4); spr('fx_shield', x, y - hgt / 2 + 4, w, hgt, side ? fx * 0.06 : 0, { tint: fy < -0.5 ? [0.7, 0.7, 0.8, 0.6] : undefined });
          L.glow(x, y - hgt / 2, 60, [0.45, 0.8, 1], 0.12 + 0.06 * Math.sin(GT * 9), 2); }]); } }
    Y.sort((a, b) => a[0] - b[0]).forEach(([, d]) => d());

    // ===== gas clouds (soft, above actors, low alpha so actors stay readable) =====
    for (const c of ST.clouds) { if (!vis(c.x, c.y, c.r)) continue; const a = GT - c.t0, life = SS(0, 0.3, a) * SS(c.ttl, c.ttl - 0.8, a);
      const ally = ST.players.some((p) => p.hero !== 'vitya' && !p.out && ((p.x - c.x) / c.r) ** 2 + ((p.y - c.y) / (c.r * 0.75)) ** 2 < 1);
      const se = sigOf(ST, c.owner), mode = se === 'vitya_frost' ? 'frost' : se === 'vitya_boom' ? 'boom' : null;
      drawCloud(c.id, sx(c.x), sy(c.y), c.r, life * (c.trail ? 0.55 : 1), a, ally, c.big, mode);     // the evolution's trail is fainter: you can see through it
      if (mode === 'frost') for (let j = 0; j < 6; j++) { const an = rnd(c.id, j + 70) * 6.28 + GT * 0.4, rr = c.r * 0.7 * Math.sqrt(rnd(c.id, j + 80)), tw = 0.5 + 0.5 * Math.sin(GT * 3 + j * 1.7);   // snowflakes in the fog
        L.star(sx(c.x) + Math.cos(an) * rr, sy(c.y) + Math.sin(an) * rr * 0.7 - 40 - 20 * ((GT * 0.3 + rnd(c.id, j)) % 1), 9, [0.9, 0.97, 1], 0.7 * life * tw); }
      if (mode === 'boom') { const fuse = c.ign ? SS(c.ign - 0.9, c.ign, GT) : 0;                                   // sparks crackle inside; a lit fuse glows before it goes off
        for (let j = 0; j < 5; j++) { const an = rnd(c.id, j + 90) * 6.28 + GT * 2, rr = c.r * 0.6 * rnd(c.id, j + 95); if ((Math.floor(GT * 14) + j) % 3) L.star(sx(c.x) + Math.cos(an) * rr, sy(c.y) + Math.sin(an) * rr * 0.7 - 34, 7, [1, 0.75, 0.3], 0.8 * life); }
        if (fuse > 0 && GT < c.ign) L.glow(sx(c.x), sy(c.y) - 30, c.r * (0.6 + 0.4 * fuse), [1, 0.5, 0.1], (0.25 + 0.3 * Math.sin(GT * 30)) * fuse, 2); }
      if (c.cyc) book('fxa_cyclone', loopQ(GT * 0.9, c.id * 0.13), sx(c.x), sy(c.y) - 14, c.r * 3, c.r * 3, { a: 0.85 * life });
      if (c.big) for (let j = 0; j < 10; j++) { const an = GT * 2.2 + j * 0.63, rr = c.r * (0.3 + 0.5 * rnd(c.id, j + 200));          // debris in the storm
        L.solid(sx(c.x) + Math.cos(an) * rr, sy(c.y) - 40 + Math.sin(an) * rr * 0.5 - 30 * rnd(c.id, j), 10, 5, j % 2 ? [0.45, 0.28, 0.12] : [0.6, 0.45, 0.15], GT * 5 + j, 5, 2.5, life); } }
    // Hasan's tornado: a funnel of mustaches spinning on a dust shadow, wind arcs per tier
    for (const z of ST.zones || []) { if (z.kind !== 'tornado' || !vis(z.x, z.y, z.r * 2)) continue; const a = GT - z.t0, life = SS(0, 0.3, a) * SS(z.ttl, z.ttl - 0.3, a), x = sx(z.x), y = sy(z.y);
      L.shadow(x, y, z.r * 0.9, z.r * 0.4, 0.45 * life);
      G.blend('add'); G.draw(L.P.glow, { u_col: [1, 0.55, 0.15], u_k: 1.6, u_amt: 0.35 * life }, G.xf(x - z.r * 1.1, y - 230, z.r * 2.2, 260)); G.blend();
      for (let i = 0; i < 7; i++) { const hgt = i * 30, rr = z.r * (0.28 + 0.14 * i), sp = GT * (9 - i * 0.6) + i * 0.7;
        G.blend('add'); for (const o of [0, 2.1]) G.draw(L.P.slash, { u_col: [1, 0.68, 0.25], u_amt: 1.3 * life, u_ac: -sp * 1.3 + o, u_hs: 1.1, u_w: 0.13, u_core: 1 }, G.xf(x - rr, y - hgt - 30 - rr * 0.32, 2 * rr, 0.64 * rr)); G.blend();
        if (i % 2) continue;
        for (let k = 0; k < 3; k++) { const an = sp + k * 2.094, cx = Math.cos(an), front = Math.sin(an) > 0;
          const mw = 78 * (0.55 + 0.45 * Math.abs(cx)) * (0.8 + 0.07 * i); const mx2 = x + cx * rr * 0.82, my2 = y - hgt - 30 + Math.sin(an) * rr * 0.28;
          L.glow(mx2, my2, mw * 0.7, [1, 0.6, 0.2], 0.5 * life, 2); spr('fx_mustache', mx2, my2, mw, 78 * 0.3, -cx * 0.35, { a: life * (front ? 1 : 0.5), flip: cx < 0, tint: [1.5, 1.05, 0.55, 0.55] }); } }
      for (let j = 0; j < 12; j++) { const an = GT * 6 + j * 0.52, rr = z.r * (0.5 + 0.6 * rnd(z.id, j)), hy = (GT * 60 + j * 37) % 180;
        L.solid(x + Math.cos(an) * rr, y - hy + Math.sin(an) * rr * 0.3, 9, 5, j % 3 ? [0.42, 0.3, 0.12] : [0.65, 0.5, 0.2], GT * 7 + j, 4.5, 2.5, life * SS(180, 120, hy)); } }

    // ===== projectiles =====
    for (const b of ST.proj) { let x = sx(b.x), y = sy(b.y); const an = Math.atan2(b.vy, b.vx);
      if (b.kind === 'bullet' || b.kind === 'pellet' || b.kind === 'rocket') { const o = ST.players.find((q) => q.hero === 'leha' && q.id === b.own) || ST.players.find((q) => q.hero === 'leha'), mz = o && RIG.muzzle['p' + o.id];
        if (mz) { const s0x = sx(o.x) + Math.cos(an) * 46, s0y = sy(o.y) - 52 + Math.sin(an) * 30, w = Math.max(0, 1 - (Math.hypot(x - s0x, y - s0y)) / 160);
          x += (mz.tip[0] - s0x) * w; y += (mz.tip[1] - s0y) * w; } }
      if (b.kind === 'card') { const se = sigOf(ST, b.own), ci = (b.c || 0) % 4, col = b.tox ? GAS2 : se === 'danil_fan' ? [1, 0.4, 0.8] : CARDC[ci], fl = Math.cos(GT * 13 + b.id);
        if (se === 'danil_mail') { pigeon(x, y - 34, 50, Math.floor(GT * 16 + b.id) % 2, b.vx < 0); L.puff(x - b.vx * 0.03, y - 26 - b.vy * 0.03, 8, [0.9, 0.9, 1], 0.3, b.id); }
        if (se === 'danil_fan') for (let j = 1; j <= 3; j++) spr('fx_heart', x - b.vx * 0.024 * j, y - b.vy * 0.024 * j - 6 * Math.sin(GT * 9 + j), 26 - 4 * j, 23 - 4 * j, 0, { a: 1 - 0.2 * j });
        for (let j = 1; j <= 3; j++) L.star(x - b.vx * 0.014 * j, y - b.vy * 0.014 * j, 12 - 2 * j, col, 0.55 / j);
        L.glow(x, y, 30, col, 0.45, 2.5);
        spr('fx_card' + ci, x, y, 32 * Math.max(0.2, Math.abs(fl)), 46, 0.12 * Math.sin(GT * 7 + b.id), { tint: b.tox ? [0.7, 1.3, 0.4, 0.7] : fl < 0 ? [0.8, 0.75, 0.95, 0.5] : undefined }); }
      else if (b.kind === 'tapok') { const sp = GT * 14 + b.id; L.shadow(x, y + 46, 12, 4, 0.35);
        L.rrect(x - 13, y - 7, 26, 14, 7, [0.25, 0.45, 0.95], [0.15, 0.25, 0.65]); L.solid(x - 9, y - 1, 18, 2, [0.95, 0.95, 1], sp, 9, 1); L.solid(x - 1, y - 6, 2, 12, [0.95, 0.95, 1], sp, 1, 6); }
      else if (b.kind === 'petard') { const q = 1 - Math.max(0, b.ttl) / (b.ttl0 || 0.5), hgt = 100 * 4 * q * (1 - q);
        L.shadow(x, y + 46, 8, 3, 0.4); spr('fx_petard', x, y - hgt, 18, 24, GT * 12 + b.id); L.glow(x, y - hgt - 10, 14, [1, 0.8, 0.4], 0.9, 2); L.star(x, y - hgt - 11, 6, [1, 0.95, 0.6], 0.8); }
      else if (b.kind === 'firework') { const q = 1 - Math.min(b.ttl, 0.6) / 0.6, yy = y + 46 - 560 * (1 - q);
        if (b.ttl < 0.6) { for (let j = 1; j < 5; j++) L.star(x, yy - 18 * j, 9 - j, [1, 0.8, 0.4], 0.5 / j); L.glow(x, yy, 18, [1, 0.7, 0.3], 0.8, 2); spr('fx_firework', x, yy, 11, 30, Math.PI); }
        L.shadow(x, y + 46, 10 + 10 * q, 4 + 3 * q, 0.35 * q); }
      else if (b.kind === 'scoop') { for (let j = 1; j < 4; j++) L.puff(x - b.vx * 0.02 * j, y - b.vy * 0.02 * j, 7 + 2 * j, [0.85, 0.95, 1], 0.35 / j, b.id + j);
        L.glow(x, y, 20, [0.7, 0.9, 1], 0.4, 2.5); spr('fx_scoop', x, y, 22, 22, GT * 6 + b.id); }
      else if (b.kind === 'pigeon') { pigeon(x, y, 46, Math.floor(GT * 12 + b.id) % 2, b.vx < 0); if (b.r) L.glow(x, y, 18, [1, 0.5, 0.2], 0.6 + 0.3 * Math.sin(GT * 20), 2); }
      else if (b.kind === 'sugar') { for (let j = 1; j <= 3; j++) L.star(x - b.vx * 0.012 * j, y - b.vy * 0.012 * j, 9 - 2 * j, b.mods && b.mods.burn ? [1, 0.6, 0.2] : [1, 1, 0.95], 0.6 / j);
        L.glow(x, y, 20, b.mods && b.mods.burn ? [1, 0.5, 0.15] : [1, 0.95, 0.85], 0.4, 2.5); spr('fx_sugar', x, y, 24, 26, GT * 9 + b.id, { tint: b.mods && b.mods.burn ? [1.2, 0.6, 0.3, 0.6] : undefined });
        if (b.mods && b.mods.burn) book('fxa_flame', loopQ(GT * 2, b.id * 0.1), x, y - 10, 30, 40, { add: 1, a: 0.7 }); }
      else if (b.kind === 'tractor') { const [tw, th] = [150, 116], yy = y, life = SS(0, 0.15, 2 - b.ttl) * SS(0, 0.25, b.ttl), sh = b.mods && b.mods.shock;
        L.shadow(x, yy, 64, 14, 0.5 * life); for (let j = 1; j <= 4; j++) L.puff(x - b.vx * 0.06 * j, yy - 6 - 3 * j, 12 + 7 * j, [0.55, 0.45, 0.35], 0.35 * life / j, b.id + j + Math.floor(GT * 8));
        const ta = Math.atan2(b.vy, b.vx); spr('fx_tractor', x, yy - th / 2 + 2 * Math.sin(GT * 40), tw, th, b.vx < 0 ? ta - Math.PI : ta, { flip: b.vx < 0, a: life }); if (sh) { L.glow(x, yy - 50, 70, [0.4, 0.7, 1], 0.4, 2); if (Math.floor(GT * 20) % 2) bolt(x - 40, yy - 90, x + 40, yy - 20, GT * 50 + b.id, 0.8 * life); } }
      else if (b.kind === 'condensed') { const q = 1 - Math.max(0, b.ttl) / 0.6, hgt = 120 * 4 * q * (1 - q); L.shadow(x, y + 46, 10, 4, 0.4); spr('fx_condensed', x, y - hgt, 22, 28, GT * 8 + b.id); }
      else if (b.kind === 'can') { const q = 1 - Math.max(0, b.ttl) / 0.6, hgt = 120 * 4 * q * (1 - q);
        L.shadow(x, y + 46, 10, 4, 0.4); L.rrect(x - 7, y - 11 - hgt, 14, 22, 3, [0.3, 0.95, 0.9], [0.1, 0.55, 0.5]); L.solid(x - 7, y - 4 - hgt, 14, 5, [0.95, 0.3, 0.5], GT * 9, 7, 2.5); }
      else if (b.kind === 'rocket') { for (let j = 1; j < 7; j++) L.puff(x - Math.cos(an) * 20 * j, y - Math.sin(an) * 20 * j - 3 * j, 7 + 4 * j, [0.55, 0.5, 0.48], 0.4 / Math.sqrt(j), b.id + j);
        L.glow(x - Math.cos(an) * 22, y - Math.sin(an) * 22, 34, [1, 0.6, 0.2], 0.95, 2.5); spr('fx_rocket', x, y, 44, 16, an); }
      else if ((b.kind === 'pellet' || b.kind === 'bullet') && sigOf(ST, b.own) === 'leha_rail') {        // Рельсотрон: a long blue-white beam that crackles
        L.glow(x, y, 22, [0.5, 0.8, 1], 0.7, 2.5); streak(x - Math.cos(an) * 110, y - Math.sin(an) * 110, an, 120, 9, [0.5, 0.82, 1], 1.6); L.solid(x - 14, y - 1, 28, 2, [0.9, 0.97, 1], an, 14, 1);
        if (Math.floor(GT * 30 + b.id) % 3 === 0) bolt(x - Math.cos(an) * 70, y - Math.sin(an) * 70, x, y, GT * 60 + b.id, 0.6); }
      else if ((b.kind === 'pellet' || b.kind === 'bullet') && sigOf(ST, b.own) === 'leha_inc') {         // Зажигательные: a burning tracer with a flame on its head
        L.glow(x, y, 20, [1, 0.45, 0.12], 0.7, 2.5); streak(x - Math.cos(an) * 50, y - Math.sin(an) * 50, an, 56, 8, [1, 0.42, 0.12], 1.5);
        book('fxa_flame', loopQ(GT * 2.5, b.id * 0.07), x, y - 8, 22, 30, { add: 1, a: 0.8 }); L.puff(x - Math.cos(an) * 30, y - Math.sin(an) * 30 - 4, 6, [0.35, 0.3, 0.3], 0.3, b.id); }
      else if (b.kind === 'pellet') { L.glow(x, y, 12, [1, 0.7, 0.3], 0.5, 2.5); streak(x - Math.cos(an) * 22, y - Math.sin(an) * 22, an, 26, 6, [1, 0.75, 0.3], 1.2); }
      else { L.glow(x, y, 16, [1, 0.8, 0.4], 0.5, 2.5); streak(x - Math.cos(an) * 40, y - Math.sin(an) * 40, an, 46, 7, [1, 0.85, 0.45], 1.4); L.solid(x - 9, y - 1, 18, 2, [1, 0.97, 0.8], an, 9, 1); } }
    for (const b of ST.eproj) { const x = sx(b.x), y = sy(b.y);
      if (b.lob && b.kind === 'cheese') { const q = 1 - Math.max(0, b.ttl) / (b.ttl0 || 1), hgt = 260 * 4 * q * (1 - q); L.shadow(x, y + 40, 22, 8, 0.45); spr('fx_cheese', x, y - hgt, 52, 46, GT * 6); continue; }
      if (b.lob && b.kind === 'nade') { const q = 1 - Math.max(0, b.ttl) / (b.ttl0 || 1), hgt = 200 * 4 * q * (1 - q); L.shadow(x, y + 40, 10, 4, 0.45);
        L.rrect(x - 8, y - 8 - hgt, 16, 16, 7, [0.3, 0.4, 0.2], [0.15, 0.22, 0.1], 1); L.glow(x, y - 8 - hgt, 10, [1, 0.6, 0.2], 0.6, 2); continue; }
      if (b.kind === 'star') { const d = SIM.LV.LENIN ? Math.hypot(b.x - SIM.LV.LENIN[0], b.y + 40 - SIM.LV.LENIN[1]) : 999, lift = 230 * Math.max(0, 1 - d / 320);
        L.shadow(x, y + 40, 14, 5, 0.4); book('fxa_rspark', loopQ(GT * 2, b.x * 0.003), x, y - lift, 70, 70, { add: 1, a: 0.9 }); spr('fx_star', x, y - lift, 40, 38, GT * 5 + x * 0.01); continue; }
      if (b.kind === 'kbul') { const an = Math.atan2(b.vy || 0, b.vx || 1); L.glow(x, y, 14, [1, 0.5, 0.2], 0.6, 2.5); streak(x - Math.cos(an) * 30, y - Math.sin(an) * 30, an, 34, 6, [1, 0.45, 0.2], 1.3); continue; }
      if (b.lob) { const q = 1 - Math.max(0, b.ttl) / (b.ttl0 || 0.9), hgt = 150 * 4 * q * (1 - q); L.shadow(x, y + 40, 9, 4, 0.45);             // an empty bottle, spinning in an arc
        L.rrect(x - 5, y - 14 - hgt, 10, 24, 3, [0.25, 0.6, 0.25], [0.12, 0.35, 0.15], 0.95); L.solid(x - 2, y - 22 - hgt, 4, 9, [0.2, 0.5, 0.2], GT * 14, 2, 13); continue; }
      L.glow(x, y, 26, [0.75, 0.3, 1], 0.7, 2.2); L.puff(x, y, 10, [0.6, 0.2, 0.8], 0.9, b.ttl * 10); }

    // ===== event FX =====
    let critN = 0;                                                                   // stacked crit labels never overlap
    for (const e of ST.ev) { const a = GT - e.t; if (a < 0 || a > 1.6) continue; const ex = sx(e.x), ey = sy(e.y);
      // Hasan's whips: a lash of his own mustache, out of his face (wind-up over the head → the wave rolls down → dead-straight snap → recoil)
      if (e.k === 'whip' && a < LASH.T) { const q = a / LASH.T, p = ST.players.find((o) => o.id === e.pid); if (!p || p.down) continue;
        const [mx, my] = mouth(p, sx(p.x), sy(p.y));
        for (let k = 0; k < e.n; k++) { const sd = (k % 2 ? -1 : 1) * e.side, qk = Math.max(0, q - k * 0.07), aim = e.ang + (k - (e.n - 1) / 2) * 0.55;
          const ox = mx + 7 * sd * (p.dir === 1 || p.dir === 3 ? 0.3 : 1), R = e.R * (e.pull ? 1.08 : 1);
          if (qk > 0.12 && qk < 0.7) for (const [gx, gy] of lashPts(ox, my, qk - 0.06, aim, sd, R).filter((_, j) => j % 3 === 2))   // smear of the previous pose
            L.glow(gx, gy, 16, [1, 0.6, 0.2], 0.1, 2);
          const pts = lashPts(ox, my, qk, aim, sd, R), tip = pts[pts.length - 1];
          const se = p.sigEvo, wa = 1 - SS(0.9, 1, qk);
          ribbonPts('fx_whip_long', pts, 26, wa, se === 'hasan_shock' ? [0.8, 1.05, 1.45, 0.5] : se === 'hasan_fire' ? [1.6, 0.75, 0.3, 0.55] : undefined, se ? EVOC[se] : undefined);
          if (se === 'hasan_shock' && qk > 0.15 && qk < 0.9) for (let j = 3; j < pts.length - 1; j += 3) bolt(pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1] + (rnd(GT, j) - 0.5) * 18, GT * 40 + j, 0.75 * wa);   // the lash crackles
          if (se === 'hasan_fire' && qk > 0.1) for (let j = 4; j < pts.length; j += 3) book('fxa_flame', loopQ(GT * 2, j * 0.13), pts[j][0], pts[j][1] - 12, 22 + j * 2, 30 + j * 3, { add: 1, a: 0.85 * wa });   // flames lick along it
          if (qk > 0.64 && qk < 0.84) { const c = (qk - 0.64) / 0.2, ta = Math.atan2(tip[1] - pts[pts.length - 3][1], tip[0] - pts[pts.length - 3][0]);   // the crack
            L.star(tip[0], tip[1], 30 * (1 - c), [1, 0.95, 0.8], 0.7 * (1 - c)); book('fxa_sparks', c, tip[0], tip[1], 70, 70, { add: 1, a: 0.6 });
            book('fxa_shock', c, tip[0], tip[1], 80, 80, { add: 1, a: 0.35, tint: [1.3, 0.85, 0.4, 0.9] }); streak(tip[0] - Math.cos(ta) * 70, tip[1] - Math.sin(ta) * 70, ta, 80, 6, [1, 0.9, 0.6], 0.45 * (1 - c)); }
          if (e.pull && qk > 0.7) spr('fx_curl', tip[0], tip[1], 34, 34, GT * 14, { a: 1 - SS(0.85, 1, qk) }); } }
      if (e.k === 'kill' && a < 0.6) { const q = a / 0.6; for (let j = 0; j < 5; j++) { const an = rnd(e.t, j) * 6.28, d = 30 * q * e.sc;
          L.puff(ex + Math.cos(an) * d, ey - 30 * e.sc + Math.sin(an) * d * 0.6 - 30 * q, 14 * e.sc * (1 - 0.4 * q), [0.18, 0.08, 0.16], 0.7 * (1 - q), e.t + j); }
        L.star(ex, ey - 40 * e.sc, 26 * (1 - q), [1, 0.4, 0.7], 1 - q); }
      if (e.k === 'hit' && a < 0.3) { if (e.kind === 'card') book('fxa_fan', a / 0.3, ex, ey - 8, 80, 80, { add: 1, tint: e.tox ? [0.6, 1.4, 0.4, 0.8] : undefined });
        else if (e.kind === 'bullet' || e.kind === 'pellet') book('fxa_sparks', a / 0.25, ex, ey - 6, e.kind === 'pellet' ? 40 : 54, e.kind === 'pellet' ? 40 : 54, { add: 1 });
        else if (a < 0.15) L.star(ex, ey - 6, 16 * (1 - a / 0.15), [1, 0.9, 0.6], 1 - a / 0.15); }
      if (e.k === 'crit' && a < 0.5) { const cy = ey - 110 - 40 * a - 30 * (critN % 6), cx = ex + 70 * ((critN % 3) - 1); critN++;    // stacked; dropped near the top HUD
        if (hudFree(cx, cy)) lab('crit' + (e.t * 1000 | 0) % 7, 'КРИТ!', cx, cy, { size: 22, col: '#ffd040', al: 0.5, a: 1 - a / 0.5, font: FONT }); }
      if (e.k === 'boom' && a < 0.9) { const q = a / 0.9, r = e.r; L.glow(ex, ey - 20, r * 1.1, e.gas ? [0.7, 1, 0.3] : [1, 0.5, 0.12], (r >= 140 ? 0.5 : 0.3) * (1 - q) ** 2, 2.4);
        if (e.kind === 'slam' || e.kind === 'red' || e.kind === 'nade') { book('fxa_slam', a / 0.75, ex, ey - r * 0.25, r * 2.6, r * 2.6, { add: 1 }); continue; }
        if (e.kind === 'cheese') { book('fxa_cheese', a / 0.6, ex, ey - 10, r * 2.4, r * 2.4); continue; }
        if (e.kind === 'dust') { book('fxa_dust', a / 0.8, ex, ey - 20, r * 2.8, r * 2.8); continue; }
        if (e.kind === 'tornado') book('fxa_shock', a / 0.5, ex, ey - 20, r * 2.6, r * 2.6, { add: 1, tint: [1.3, 0.8, 0.4, 0.9] });
        else if (e.kind === 'petard' || e.kind === 'kamikaze') book('fxa_pop', a / 0.6, ex, ey - 24, r * 2.3, r * 2.3, { add: 1, a: 0.8 });
        else if (e.kind === 'firework') { book('fxa_firework', a / 0.9, ex, ey - 70, r * 3.2, r * 3.2, { add: 1 }); book('fxa_pop', a / 0.6, ex, ey - 16, r * 2, r * 2, { add: 1 }); }
        else if (e.kind === 'fried') { book('fxa_pop', a / 0.6, ex, ey - 20, r * 2.4, r * 2.4, { add: 1 }); book('fxa_ice', a / 0.6, ex, ey - 24, r * 2.2, r * 2.2); }
        else if (e.kind === 'ignite') book('fxa_boom', a / 0.6, ex, ey - r * 0.35, r * 2.5, r * 2.5, { tint: [0.8, 1.3, 0.45, 0.6] });
        else { if (a < 0.9) L.cracks(ex, ey, r * 0.7, a, e.t, 0, 0.6 * (1 - q)); book('fxa_boom', a / 0.6, ex, ey - r * 0.35, r * 2.7, r * 2.7, { tint: e.gas ? [0.7, 1.3, 0.4, 0.8] : undefined }); } }
      if (e.k === 'fart' && a < 0.6) book('fxa_gas', a / 0.6, ex, ey - 30, e.big ? 480 : 170, e.big ? 480 : 170, { a: 0.45 });
      // Q bursts, each in its hero's language
      if (e.k === 'q' && a < 0.8) { const p = ST.players.find((o) => o.id === e.pid); if (!p) continue; const hx = sx(p.x), hy = sy(p.y) - 60, ang = e.ang || 0, ar = (p.m && p.m.area) || 1;
        if (e.hero === 'danil' && a < 0.7) { const q = a / 0.7;            // «Фан-чант»: heart shock-arcs and hearts flying down the cone
          G.blend('add'); for (let j = 0; j < 3; j++) { const R = 360 * ar * (0.25 + 0.75 * SS(0, 1, q * 1.4 - j * 0.18)); if (R <= 0) continue;
            G.draw(L.P.slash, { u_col: [1, 0.4, 0.8], u_amt: (1 - q) * 0.9, u_ac: ang, u_hs: 0.62, u_w: 0.05, u_core: 0.6 }, G.xf(hx - R, hy - R * 0.75, 2 * R, 1.5 * R)); } G.blend();
          for (let j = 0; j < 12; j++) { const aj = ang + (rnd(e.t, j) - 0.5) * 1.15, d = 340 * ar * Math.min(1, q * (1.2 + 0.8 * rnd(e.t, j + 5))), s2 = 26 * (1 - 0.3 * q);
            spr('fx_heart', hx + Math.cos(aj) * d, hy + Math.sin(aj) * d * 0.75 - 20 * q, s2, s2 * 0.9, 0, { a: 1 - q * q }); }
          if (a < 0.5) book('fxa_fan', a / 0.5, hx + Math.cos(ang) * 40, hy + Math.sin(ang) * 30, 150, 150, { add: 1 }); }
        if (e.hero === 'vitya' && a < 0.7) { const q = a / 0.7;            // «Залп по ветру»: a gas jet streaming out, wind streaks along it
          for (let j = 0; j < 20; j++) { const ph = (q * 1.3 + rnd(e.t, j) * 0.35), d = 380 * ar * Math.min(1, ph), aj = ang + (rnd(e.t, j + 3) - 0.5) * 0.8 * Math.min(1, ph + 0.2), s2 = 24 + 70 * Math.min(1, ph);
            if (ph > 1.05) continue; L.puff(hx + Math.cos(aj) * d, hy + 30 + Math.sin(aj) * d * 0.75, s2 * 0.5, j % 3 ? GAS : GAS2, 0.5 * (1 - q), e.t + j); }
          for (let j = 0; j < 6; j++) { const aj = ang + (rnd(e.t, j + 9) - 0.5) * 0.6, d = 380 * ar * ((q * 1.6 + j * 0.17) % 1), as = scrA(aj);
            L.solid(hx + Math.cos(aj) * d, hy + 30 + Math.sin(aj) * d * 0.75, 60, 3, [0.85, 1, 0.5], as, 30, 1.5, 0.6 * (1 - q)); } }
        if (e.hero === 'leha' && a < 0.45) book('fxa_shock', a / 0.45, hx + Math.cos(ang) * 60, hy + 40 + Math.sin(ang) * 45, 230, 230, { add: 1 });
        if (e.hero === 'hasan' && a < 0.5) book('fxa_sparks', a / 0.5, hx, hy - 30, 120, 120, { add: 1 }); }
      // Лёха: muzzle per gun, shells ejected to the side, the shotgun's cone and smoke, the launcher's back-blast
      if (e.k === 'shot' && a < 0.5) { const p = ST.players.find((o) => o.id === e.pid); if (!p) continue;
        const ca = Math.cos(e.ang), mz = RIG.muzzle['p' + p.id], as = mz ? mz.a : scrA(e.ang), L0 = [48, 56, 70, 84][Math.min(3, e.g)];
        const mx = mz ? mz.tip[0] : sx(p.x) + ca * L0, my = mz ? mz.tip[1] : sy(p.y) - 52 + Math.sin(e.ang) * L0 * 0.6, gx = mz ? mz.grip[0] : sx(p.x) + ca * 20, gy = mz ? mz.grip[1] : sy(p.y) - 56;
        if (a < 0.06) { const k = 1 - a / 0.06, big = e.g === 2 ? 1 : 0;          // muzzle: hot core + flame tongues (shotgun: a wide fan of them)
          const mc = p.sigEvo === 'leha_rail' ? [0.55, 0.85, 1] : p.sigEvo === 'leha_inc' ? [1, 0.5, 0.15] : [1, 0.85, 0.5];
          L.glow(mx, my, [26, 20, 46, 34][Math.min(3, e.g)] * (p.sigEvo ? 1.4 : 1), mc, 0.9 * k, 2.2); L.star(mx, my, [20, 14, 30, 24][Math.min(3, e.g)], [1, 0.95, 0.7], k);
          for (const o of big ? [-0.32, -0.16, 0, 0.16, 0.32] : [0]) streak(mx, my, as + o, (big ? 70 : e.g >= 3 ? 50 : e.g === 1 ? 26 : 34) * (o ? 0.8 : 1), big ? 16 : 12, [1, 0.6, 0.2], 1.3 * k); }
        if (e.g === 2 || e.g >= 3) for (let j = 0; j < 4; j++) { const q = a / 0.5, back = e.g >= 3 ? -1 : 1;
          L.puff(mx + back * Math.cos(as) * (16 + 40 * q) * (1 + j * 0.3) - (back < 0 ? Math.cos(as) * 90 : 0), my + back * Math.sin(as) * 20 * q - 14 * q - (back < 0 ? Math.sin(as) * 50 : 0), 12 + 18 * q, [0.6, 0.56, 0.52], 0.45 * (1 - q), e.t + j); }
        if (e.g < 3 && a < 0.45) { const q = a / 0.45, side = ca >= 0 ? -1 : 1, n = e.g === 2 ? 2 : 1;
          for (let j = 0; j < n; j++) L.solid(gx + side * (20 + 50 * q) * (1 + 0.3 * j) - 4, gy - 70 * q + 120 * q * q + j * 4 - 2, 8, 4, e.g === 2 ? [0.85, 0.2, 0.15] : [0.95, 0.75, 0.3], GT * 25 + j, 4, 2, SS(1, 0.8, q)); } }
      if (e.k === 'gunup' && a < 1.8) { const p = ST.players.find((o) => o.id === e.pid); if (!p) continue; const q = a / 1.8, x = sx(p.x), y = sy(p.y) - 180 - 30 * SS(0, 0.3, q);
        L.glow(x, sy(p.y) - 60, 200, [1, 0.8, 0.35], 0.7 * (1 - q), 2); for (let j = 0; j < 3; j++) { const ph = (q * 2 + j / 3) % 1; L.solid(x - 50 + j * 50 - 8, sy(p.y) - 40 - ph * 120, 16, 26, [1, 0.85, 0.4], 0, 0, 0, 0.7 * (1 - ph) * (1 - q)); }
        lab('gu' + p.id, GUNUP[Math.min(3, e.g)], x, y, { size: 38, al: 0.5, col: '#ffe066', a: SS(0, 0.1, q) * SS(1, 0.8, q), font: FONT }); }
      if (e.k === 'step' && a < 0.3) L.puff(ex, ey - 4 - 8 * a, 6 + 18 * a, [0.55, 0.4, 0.3], 0.35 * (1 - a / 0.3), e.t);
      if (e.k === 'revive' && a < 1.0) { const q = a / 1; for (let j = 0; j < 8; j++) L.star(ex + Math.cos(j * 0.785 + q * 3) * 50 * q, ey - 60 - 90 * q + Math.sin(j * 0.785) * 20, 14, [0.6, 1, 0.6], 1 - q);
        L.ring(ex, ey, 40 + 60 * q, 30 + 45 * q, [0.6, 1, 0.6], 1 - q, 0.1); }
      if (e.k === 'lvl' && a < 1.2) for (const p of ST.players) if (!p.out) { const q = a / 1.2; L.ring(sx(p.x), sy(p.y), 30 + 70 * q, 22 + 50 * q, [0.45, 0.7, 1], 1 - q, 0.08); L.glow(sx(p.x), sy(p.y) - 60, 90, [0.5, 0.7, 1], 0.5 * (1 - q), 2); }
      if (e.k === 'spit' && a < 0.2) L.glow(ex, ey - 40, 30, [0.8, 0.3, 1], 1 - a / 0.2, 2);
      if (e.k === 'splat' && a < 0.4) { const q = a / 0.4; for (let j = 0; j < 8; j++) { const an = j * 0.785, d = e.r * 0.8 * q; L.puff(ex + Math.cos(an) * d, ey + Math.sin(an) * d * 0.7 - 20 * (1 - q), 14, [1, 0.95, 0.8], 0.7 * (1 - q), e.t + j); } }
      if (e.k === 'shatter' && a < 0.45) { const q = a / 0.45; for (let j = 0; j < 7; j++) { const an = rnd(e.t, j) * 6.28, d = 60 * q; L.solid(ex + Math.cos(an) * d, ey - 10 + Math.sin(an) * d * 0.6 - 40 * q * (1 - q), 7, 4, [0.4, 0.85, 0.4], an + q * 8, 3.5, 2, 1 - q); }
        L.ring(ex, ey, 62 * (0.5 + q), 44 * (0.5 + q), [0.6, 1, 0.6], 0.5 * (1 - q), 0.06); }
      if (e.k === 'rev' && a < 0.7 && hudFree(ex, ey - 150)) { lab('rev' + e.id % 9, '!', ex, ey - 150 - 10 * Math.sin(a * 20), { size: 46, al: 0.5, col: '#ff7060', a: 1 - a / 0.7, font: FONT }); }
      if (e.k === 'howl' && a < 1.0) { const q = a / 1; for (let j = 0; j < 3; j++) L.ring(ex, ey - 60, 40 + 140 * ((q + j * 0.25) % 1), 30 + 100 * ((q + j * 0.25) % 1), [1, 0.4, 0.3], 0.5 * (1 - q), 0.05);
        if (hudFree(ex, ey - 170)) lab('howl' + e.id % 5, 'АУУУУ!', ex, ey - 170, { size: 30, al: 0.5, col: '#ff9070', a: 1 - q, font: FONT }); }
      if (e.k === 'board' && a < 0.6) { const q = a / 0.6; for (let j = 0; j < 6; j++) L.star(ex + Math.cos(j * 1.05) * 50 * q, ey - 60 - 40 * q, 12, [1, 0.9, 0.5], 1 - q); }
      if (e.k === 'drink' && a < 1.2) { const q = a / 1.2; book('fxa_shock', a / 0.6, ex, ey - 50, 260, 260, { add: 1, tint: [0.5, 1.3, 0.9, 0.8] }); L.glow(ex, ey - 60, 160, [0.4, 1, 0.7], 0.5 * (1 - q), 2); }
      if (e.k === 'zap' && a < 0.14) bolt(ex, ey, sx(e.x2), sy(e.y2), e.t * 100 + Math.floor(GT * 30), 1 - a / 0.14);
      if (e.k === 'freeze' && a < 0.6) book('fxa_ice', a / 0.6, ex, ey - 34, 96, 96);
      if (e.k === 'coo' && a < 0.5) { book('fxa_shock', a / 0.5, ex, ey - 30, e.r * 2.6, e.r * 2.6, { add: 1, tint: [1.0, 0.95, 1.4, 0.7] }); for (let j = 0; j < 5; j++) L.star(ex + Math.cos(j * 1.26 + a * 4) * 60 * (a / 0.5), ey - 110 - 40 * (a / 0.5), 9, [0.9, 0.9, 1], 1 - a / 0.5); }
      if ((e.k === 'fission' || e.k === 'fusion') && a < 1.2) { book('fxa_evo', a / 0.95, ex, ey - 60, 300, 300, { add: 1, tint: e.k === 'fusion' ? [1.1, 0.6, 1.6, 0.8] : [1.3, 1.1, 0.6, 0.5] });
        lab('fx' + e.pid, e.k === 'fusion' ? 'СПЛАВ!' : 'ДЕЛЕНИЕ: +' + ((e.ids || []).length || 0), Math.max(200, Math.min(W - 200, ex)), Math.max(150, ey - 200), { size: 28, al: 0.5, col: e.k === 'fusion' ? '#d6a0ff' : '#ffe066', a: SS(1.2, 0.9, a), font: FONT }); }
      if (e.k === 'bass' && a < 0.45) { const q = a / 0.45; L.ring(ex, ey - 20, e.r * (0.3 + 0.7 * q), e.r * 0.75 * (0.3 + 0.7 * q), [0.75, 0.55, 1], 0.7 * (1 - q), 0.06); }
      if (e.k === 'chest' && a < 1.2) { const q = a / 1.2; for (let j = 0; j < 10; j++) L.star(ex + Math.cos(j * 0.63) * 90 * q, ey - 40 - 120 * q + Math.sin(j * 0.63) * 30, 14, [1, 0.85, 0.35], 1 - q);
        L.glow(ex, ey - 40, 160, [1, 0.8, 0.3], 0.6 * (1 - q), 2); }
      if (e.k === 'food' && a < 0.8) { const q = a / 0.8; L.ring(ex, ey, 20 + 50 * q, 14 + 36 * q, [0.5, 1, 0.5], 1 - q, 0.1); }
      if (e.k === 'elite' && a < 1.5) L.ring(ex, ey, 60 + 30 * Math.sin(a * 12), 45, [1, 0.75, 0.2], 1 - a / 1.5, 0.08);
      // evolution: the Effector «Evo Burst» (flash, gold shock ring, spark spray, rising stars) + its name over the hero
      if (e.k === 'upgrade' && e.evo && a < 1.8) { const p = ST.players.find((o) => o.id === e.pid), q = a / 1.8; L.glow(ex, ey - 60, 220, [1, 0.85, 0.4], 0.6 * (1 - q) ** 2, 2);
        book('fxa_evo', a / 0.95, ex, ey - 70, 480, 480, { add: 1 });
        if (p) lab('evo' + p.id, (e.fresh ? 'НОВЫЙ РЕЦЕПТ: ' : String(e.id).startsWith('awake_') ? 'ПРОБУЖДЕНИЕ: ' : 'ЭВОЛЮЦИЯ: ') + SIM.UPG.rname(String(e.id).startsWith('awake_') || SIM.UPG.RECIPES.some((r) => r.id === e.id) ? e.id : 'awake_' + p.hero), Math.max(260, Math.min(W - 260, ex)), Math.max(150, ey - 210 - 30 * SS(0, 0.3, q)), { size: 30, al: 0.5, col: '#ffe066', a: SS(0, 0.08, q) * SS(1, 0.75, q), font: FONT }); }
      if (e.k === 'block' && a < 0.3) book('fxa_sparks', a / 0.3, ex, ey, 70, 70, { add: 1, tint: e.by === 'leha' ? [0.5, 0.9, 1.4, 0.9] : undefined });
      if (e.k === 'shot' && a < 0.05) { const p = ST.players.find((o) => o.id === e.pid); if (p) { const mz = RIG.muzzle['p' + p.id]; L.glow(mz ? mz.tip[0] : sx(p.x) + Math.cos(e.ang) * 48, mz ? mz.tip[1] : sy(p.y) - 52 + Math.sin(e.ang) * 30, 30 + 10 * e.g, [1, 0.8, 0.4], 0.6, 2.4); } }
    }
    // ability auras that last
    for (const p of ST.players) { if (p.out || p.down || p.inBus || !vis(p.x, p.y, 500)) continue; const x = sx(p.x), y = sy(p.y), qa = GT - p.qT, ua = GT - p.ultT;
      if (p.sigEvo && EVOC[p.sigEvo]) { const c = EVOC[p.sigEvo], se = p.sigEvo, hy = p.hero === 'hasan' ? 112 : p.hero === 'vitya' ? 30 : 70;          // element motes rising off the weapon
        L.glow(x, y - hy, 34, c, 0.28 + 0.08 * Math.sin(GT * 5), 2);
        for (let j = 0; j < 4; j++) { const ph = (GT * 0.8 + j / 4 + p.id * 0.13) % 1, ox = (rnd(p.id * 9 + j, Math.floor(GT * 0.8 + j / 4)) - 0.5) * 50;
          if (se === 'danil_fan') spr('fx_heart', x + ox, y - hy - 50 * ph, 12, 11, 0, { a: 0.8 * (1 - ph) });
          else L.star(x + ox, y - hy - 50 * ph, se === 'vitya_frost' ? 9 : 6, c, 0.85 * (1 - ph)); }
        if ((se === 'hasan_shock' || se === 'leha_rail') && Math.floor(GT * 7 + p.id) % 5 === 0) bolt(x - 18, y - hy - 10, x + 18, y - hy + 8, GT * 30 + p.id, 0.5); }
      // «Подкрутил усы» / evolution: the mustache halves spin round him as two blades (motion blur arcs + the painted strands)
      const blades = (R, spd, amt) => { for (let k = 0; k < 2; k++) { const an = GT * spd + k * Math.PI, ex = Math.cos(an) * R, ey = Math.sin(an) * R * 0.75;
        G.blend('add'); G.draw(L.P.slash, { u_col: [1, 0.62, 0.2], u_amt: 0.55 * amt, u_ac: an - 0.5, u_hs: 0.7, u_w: 0.07, u_core: 0.7 }, G.xf(x - R, y - 60 - R * 0.75, 2 * R, 1.5 * R)); G.blend();
        ribbon('fx_whip_s', x, y - 112, Math.atan2(ey + 52, ex) + 0.35, Math.hypot(ex, ey + 52) * 0.95, 30, -0.8, amt); } };
      if (p.hero === 'hasan' && qa < 4) { blades(150 * p.m.area, 11, SS(4, 3.6, qa) * SS(0, 0.15, qa)); if (Math.floor(GT * 12) % 2) L.puff(x + rnd(GT, 1) * 60 - 30, y - 6, 16, [0.55, 0.42, 0.3], 0.3, GT); }
      if (p.evo && p.hero === 'hasan') { const R = 165 * p.m.area; book('fxa_vortex', loopQ(GT * 0.8), x, y - 24, R * 2.7, R * 2.7, { add: 1, a: 0.9 }); if (qa >= 4) blades(R, 7, 0.75); }
      // «Камбэк года»: the stage — 8 giant idol cards circling him, spotlights from above
      if (p.hero === 'danil' && ua < 5) { const k0 = SS(0, 0.3, ua) * SS(5, 4.7, ua), R = 150 * p.m.area;
        for (let k = 0; k < 3; k++) { const a = -0.9 + k * 0.9 + 0.3 * Math.sin(GT * 2 + k); L.solid(x - 30, y - 600, 60, 600, [1, 0.6, 0.9], a, 30, 600, 0.1 * k0); }
        L.glow(x, y - 40, 180, [1, 0.5, 0.85], 0.3 * k0, 2); if (ua < 0.45) book('fxa_fan', ua / 0.45, x, y - 60, 300, 300, { add: 1 });
        const cards = []; for (let k = 0; k < 8; k++) { const a = ua * 1.6 + k * Math.PI / 4; cards.push([x + Math.cos(a) * R, y - 30 + Math.sin(a) * R * 0.72, k, Math.cos(a)]); }
        cards.sort((u, v) => u[1] - v[1]).forEach(([cx, cy, k, c]) => { L.shadow(cx, cy + 30, 22, 6, 0.4 * k0); L.glow(cx, cy - 10, 46, CARDC[k % 4], 0.35 * k0, 2.5);
          spr('fx_card' + (k % 4), cx, cy - 12 + 4 * Math.sin(GT * 4 + k), 52 * (0.6 + 0.4 * Math.abs(c)) * k0, 76 * k0, 0.1 * Math.sin(GT * 2 + k)); }); }
      if (p.hero === 'danil' && p.evo) for (let k = 0; k < 6; k++) { const a = GT * 2.4 + k * Math.PI / 3, cx = x + Math.cos(a) * 130, cy = y - 40 + Math.sin(a) * 100;
        book('fxa_holo', loopQ(GT, k / 6), cx, cy, 120, 120, { add: 1 }); L.glow(cx, cy, 24, CARDC[k % 4], 0.45, 2.5); spr('fx_card' + (k % 4), cx, cy, 24 * (0.5 + 0.5 * Math.abs(Math.cos(a))), 36); }
      // Лёха: rank-up aura, gold chevrons rising off the ground while he carries the pocket apocalypse
      if (p.hero === 'leha' && p.evo) book('fxa_rank', loopQ(GT), x, y - 30, 240, 240, { add: 1 });
      if (p.petN) for (let k = 0; k < p.petN; k++) { const an = GT * 1.6 + k * 6.283 / p.petN;
        pigeon(x + Math.cos(an) * 64, y - 96 + Math.sin(an) * 22, 40, Math.floor(GT * 8 + k) % 2, Math.sin(an) > 0); }
      if (GT < p.buffT) for (let k = 0; k < 3; k++) { const an = GT * 3 + k * 2.094; spr('fx_heart', x + Math.cos(an) * 34, y - 10 + Math.sin(an) * 12, 13, 12, 0, { a: 0.85 }); }
    }
    { const fl = window.SETTINGS ? SETTINGS.flash() : 1; L.finish(t, { bloom: [0.26 * fl, 0.22 * fl], vignette: 0.86, warm: 0.6, roll: 1, dither: 0 }); }

    drawHUD(ST, me, GT, t, sx, sy);
  };

  // ---------------- hero (whole sprite per view for now; cut-out rigs replace this) ----------------
  function drawHero(p, x, y, GT, t, mine, shade, ST) {
    const view = p.hero + '_' + DIRN[p.dir], sm = ST.spor === 'smol' ? 0.8 : 1, w = sz(view)[0] * sm, h = sz(view)[1] * sm, flip = p.dir === 3;
    const sp = Math.hypot(p.vx, p.vy), run = Math.min(1, sp / 150), ph = p.dist / 62 * Math.PI;
    const col = hcol(p.hero);
    L.ring(x, y, 34, 13, col, mine ? 0.9 : 0.55, 0.16);
    L.shadow(x, y, 30, 10, 0.55);
    if (p.down) { const pulse = 0.5 + 0.5 * Math.sin(GT * 7);
      L.glow(x, y - 30, 120, [1, 0.25, 0.2], 0.25 + 0.2 * pulse, 2); L.ring(x, y - 4, 70, 30, [1, 0.3, 0.25], 0.5 + 0.4 * pulse, 0.08);
      L.sprite(view, 0, 0, { m: M.of(M.t(x, y - 18), M.r(-Math.PI / 2)), w, h, pivot: [w / 2, h * 0.55], u: { grade: [1, 1.15, 0, 1], rim: [0.6, 0, -0.006, 1], rimCol: [1, 0.5, 0.4] } });
      const q = p.revP; L.ring(x, y - 40, 44, 44, [0.3, 0.3, 0.3], 0.5, 0.12); if (q > 0) L.ring(x, y - 40, 44 * q, 44 * q, [0.5, 1, 0.5], 0.9, 0.2);
      lab('dn' + p.id, '+', x, y - 120 - 6 * Math.sin(GT * 6), { size: 70, col: '#ff5050', al: 0.5 });
      if (ST.clouds.length && SIM.inGas(ST, p.x, p.y)) lab('dg' + p.id, 'газ! время уходит быстрее', x, y - 150, { size: 18, col: '#c8ff60', al: 0.5, font: FONT });
      return; }
    const bob = run * 5 * Math.abs(Math.sin(ph)), sq = 1 + 0.035 * run * Math.cos(2 * ph), hurt = SS(0.15, 0, GT - p.hurtT);
    const lean = (flip ? -1 : 1) * run * 0.06 * (p.dir % 2), dash = false;
    const u = shade(x, y - h / 2); u.rim = [0.4, flip ? 0.004 : -0.004, -0.005, 1]; u.rimCol = [1, 0.7, 0.4];
    if (hurt > 0) { u.grade = [1, 1, hurt * 0.8, 1]; u.haze = [1, 0.3, 0.3]; }
    if (GT < p.inv && !dash && Math.floor(GT * 20) % 2) u.alpha = 0.55;
    if (RIG.has(view)) {
      const k = h / RIGS[view].h, aim = p.ax !== undefined ? Math.atan2(p.ay, p.ax) : null, at = GT - p.lastAtk;
      let act = null;
      if (p.hero === 'hasan') { const e = lastEv(ST, 'whip', p.id); if (e && GT - e.t < 0.3) act = { kind: 'whip', a: (GT - e.t) / 0.3, side: e.side > 0 ? 'R' : 'L' }; }
      if (p.hero === 'danil' && at < 0.32) act = { kind: 'throw', a: at / 0.32 };
      if (p.hero === 'vitya') { const e = lastEv(ST, 'fart', p.id); if (e && GT - e.t < 0.6) act = { kind: 'fart', a: (GT - e.t) / 0.6 }; }
      if (p.hero === 'leha' && at < 1.4) act = { kind: 'aim', w: SS(1.4, 1.0, at) * SS(0, 0.08, at + 0.08) };
      const g = p.hero === 'leha' ? (GT - p.ultT < 7 ? 3 : p.tier) : -1;
      RIG.draw({ name: view, view: DIRN[p.dir], x, y: y - (dash ? 4 : 0), k, fl: flip ? -1 : 1, ph: RIG.phase(view, p.dist, k, DIRN[p.dir]), amt: run, t, id: 'p' + p.id, u,
        aim: act ? aim : null, act, lean: lean + (dash ? 0.15 * (p.fx || 0) : 0), gun: g >= 0 ? GUNS[g] : null, gunLen: [34, 50, 72, 92][g] });
    } else L.sprite(view, 0, 0, { m: M.of(M.t(x, y - bob), M.r(lean), M.s((flip ? -1 : 1) / Math.sqrt(sq), sq)), w, h, pivot: [w / 2, h], u });
    if (p.hero === 'hasan' && p.hp < p.hpMax * 0.3) L.star(x + 6, y - h * 0.72, 10 + 4 * Math.sin(GT * 12), [1, 0.8, 0.3], 0.8);
    const ny = y - h - 26, clearHud = hudFree(x, ny);   // nameplates never sit under the HUD panels
    if (!mine && !ST.over && clearHud && (!window.SETTINGS || SETTINGS.get('names'))) { const nw = labW('nm' + p.id, pname(p), { size: 18, font: FONT }); lab('nm' + p.id, pname(p), x, y - h - 26, { size: 18, al: 0.5, col: '#f6e7c8', font: FONT });
      L.solid(x - 30, y - h - 12, 60, 7, [0.08, 0.03, 0.04]); L.solid(x - 29, y - h - 11, 58 * p.hp / p.hpMax, 5, [0.9, 0.2, 0.25]); }
  }


  // ---------------- bosses: sprites, hazards, cut-scenes (BOSSES.md) ----------------
  const RATS = { rat: 1, fatrat: 1, toxrat: 1, bombrat: 1 }, SIDE_ONLY = { toxrat: 1, bombrat: 1 };
  const BNAME = { vlad: 'ВЛАД', lenin: 'ИЛЬИЧ', hasan: 'ХАСАН', danil: 'ДАНИЛ', vitya: 'ВИТЯ', leha: 'ЛЁХА' };
  const BCOL = { vlad: '#d6a0ff', lenin: '#ff7a6a', hasan: '#ffd76a', danil: '#ffb0e0', vitya: '#b8ff7a', leha: '#c9d68a' };
  const SCARED = { rk_p2_0: 1, rk_p2_1: 1, rk_p3_0: 1, rk_end_0: 1, rk_s_0: 1, rk_s_1: 1, rk_s_2: 1 };
  const portraitOf = (id, who) => SCARED[id] ? 'portrait_vlad_scared' : id === 'ln_b_3' || id === 'ln_b_1' || id.startsWith('km_') ? 'portrait_komissar' : 'portrait_' + who;
  // the boss itself, at its ground point
  function drawBoss(e, B, x, y, GT, shade) {
    const hit = SS(0.12, 0, GT - e.hitT), u = shade(x, y - 120); u.grade[1] = Math.max(0.8, u.grade[1]);
    if (hit > 0) { u.grade = [1, 1, hit * 0.8, 1]; u.haze = [1, 0.95, 0.95]; }
    if (e.type === 'vlad') { if (B.hide) return;
      const dv = Math.abs(e.vy) > Math.abs(e.vx) * 1.3 ? (e.vy > 0 ? 'front' : 'back') : 'side', sc = GT < B.scared;
      const n = B.ph === 1 ? 'vlad_throne' : B.ph === 3 ? 'vlad_ball' : sc ? 'vlad_scared' : GT - (B.taunt || -9) < 1.3 ? 'vlad_taunt' : B.atk && B.atk.k === 'traps' ? 'vlad_summon'
        : dv === 'side' ? 'vlad_side' + (Math.floor(e.dist / 45) % 2) : 'vlad_' + dv;
      const hh = B.ph === 1 ? 300 : B.ph === 3 ? 270 : 150, ww = L.hsz(n, hh), shake = sc ? 3 * Math.sin(GT * 70) : 0, wob = B.ph === 3 ? 0.07 * Math.sin(e.dist / 60) : B.ph === 1 ? 0.02 * Math.sin(GT * 2) : 0;
      L.shadow(x, y, ww * 0.38, 16, 0.55); if (B.ph === 1) L.glow(x, y - 150, 220, [0.7, 0.4, 1], 0.15, 2);
      L.sprite(n, 0, 0, { m: M.of(M.t(x + shake, y), M.r(wob), M.s(n.startsWith('vlad_side') || n === 'vlad_taunt' ? e.face : 1, 1)), w: ww, h: hh, pivot: [ww / 2, hh], u });
      if (B.ph === 3) for (let j = 0; j < 3; j++) L.puff(x - e.vx * 0.08 * j, y - 6 - 4 * j, 14 + 10 * j, [0.4, 0.32, 0.28], 0.35 / (j + 1), GT * 9 + j);
      return; }
    // Ильич: a pose per attack; the eyes burn; the decree's weak spot pulses
    const n = leninPose(B, GT), hh = LENIN_H, ww = L.hsz(n, hh), vul = GT < (B.vuln || 0);
    u.grade[0] = Math.max(0.85, u.grade[0]); if (vul) u.tint = [1.6, 0.4, 0.3, 0.35 + 0.2 * Math.sin(GT * 12)];
    L.shadow(x, y, ww * 0.42, 26, 0.6); L.sprite(n, x - ww / 2, y - hh, { w: ww, h: hh, u });
    const [ex, ey] = leninEyes(B, GT, x, y), hot = B.lasers.length ? 1 : 0.55;
    for (const o of [-0.022, 0.022]) book('fxa_rspark', loopQ(GT * 1.6, o), ex + o * ww, ey, 34 * hot + 10, 34 * hot + 10, { add: 1, a: hot });
    if (B.ph >= 2) L.glow(x, y - hh * 0.55, 90, [1, 0.25, 0.1], 0.18 + 0.08 * Math.sin(GT * 4), 2);
    if (vul) { L.glow(x, y - hh * 0.5, 200, [1, 0.3, 0.2], 0.35, 2); if (hudFree(x, y - hh - 30)) lab('vuln', 'УЯЗВИМ!', x, y - hh - 30, { size: 30, al: 0.5, col: '#ffe066', font: FONT }); }
  }
  // ---- danger language: every boss attack area gets a red outline (with a dark underline so it reads on warm paving) ----
  const DR = [1, 0.16, 0.12], DK = [0.08, 0.0, 0.02];
  const seg = (x, y, ang, len, a = 1, th = 3) => { L.solid(x, y - (th + 4) / 2, len, th + 4, DK, ang, 0, (th + 4) / 2, 0.55 * a); L.solid(x, y - th / 2, len, th, DR, ang, 0, th / 2, a); };
  const oval = (x, y, r, a = 1, k = 0.75) => { const n = Math.max(24, Math.min(72, Math.round(r / 6))); let px = x + r, py = y;
    for (let j = 1; j <= n; j++) { const an = j / n * Math.PI * 2, qx = x + Math.cos(an) * r, qy = y + Math.sin(an) * r * k; seg(px, py, Math.atan2(qy - py, qx - px), Math.hypot(qx - px, qy - py) + 1, a); px = qx; py = qy; } };
  // a band of half-width hw along screen angle as, from (x, y), len long: its two edges and both caps
  const band = (x, y, as, len, hw, a = 1) => { const nx = -Math.sin(as) * hw, ny = Math.cos(as) * hw, ex = x + Math.cos(as) * len, ey = y + Math.sin(as) * len;
    seg(x + nx, y + ny, as, len, a); seg(x - nx, y - ny, as, len, a); seg(x - nx, y - ny, as + Math.PI / 2, 2 * hw, a); seg(ex - nx, ey - ny, as + Math.PI / 2, 2 * hw, a); };
  // an Effector flipbook turned around a pivot (beams, ring chunks)
  const bookR = (n, q, x, y, w, h, rot, piv, o = {}) => { const [c, r, f] = FXA[n], i = Math.min(f - 1, Math.floor(q * f)), cx = i % c, cy = Math.floor(i / c);
    G.blend('add'); L.sprite(n, 0, 0, { m: M.of(M.t(x, y), M.r(rot)), w, h, pivot: piv || [w / 2, h / 2], src: [cx / c, cy / r, (cx + 1) / c, (cy + 1) / r], u: { alpha: o.a ?? 1, tint: [1, 1, 1, 0] } }); G.blend(); };
  // Ilyich's pose now, and where his eyes are on that drawing (u, v of the sprite, measured on the art)
  const LEYE = { lenin_awake: [0.55, 0.065], lenin_windup: [0.545, 0.2], lenin_slam: [0.53, 0.37], lenin_orator: [0.48, 0.06], lenin_broken: [0.47, 0.06] }, LENIN_H = 360;
  const leninPose = (B, GT) => { const A = B.atk, a = A ? GT - A.t0 : 9;
    return B.ph === 3 && !(A && A.k === 'fist') ? 'lenin_broken' : A && A.k === 'fist' ? (a < 0.9 ? 'lenin_windup' : a < 1.6 ? 'lenin_slam' : 'lenin_awake')
      : A && (A.k === 'five' || A.k === 'coll' || A.k === 'oct' || A.k === 'decree' || A.k === 'march') ? 'lenin_orator' : 'lenin_awake'; };
  const leninEyes = (B, GT, x, y) => { const n = leninPose(B, GT), ww = L.hsz(n, LENIN_H), [u, v] = LEYE[n]; return [x - ww / 2 + u * ww, y - LENIN_H + v * LENIN_H, ww]; };
  // telegraphs and hazards on the ground (drawn above the night, below the people)
  function drawHazards(ST, GT, sx, sy, vis) {
    const B = ST.boss;
    if (ST.map === 'park') for (const [dx, dy] of SIM.HOLE_R) { const hx = SIM.C[0] + dx, hy = SIM.C[1] + dy; if (!vis(hx, hy, 100)) continue;
      const open = ST.ev.some((v) => v.k === 'hole' && GT - v.t < 1.6 && Math.hypot(v.x - hx, v.y - hy) < 40) || (B && B.hide && ST.ev.some((v) => v.k === 'hole' && !v.out && GT - v.t < 1.4));
      spr(open ? 'manhole_open' : 'manhole', sx(hx), sy(hy) - 6, 96, open ? 80 : 74); }
    // mousetraps: the snap zone is outlined once they are armed
    for (const tr of ST.traps || []) { if (!vis(tr.x, tr.y, 60)) continue; const arm = SS(tr.t0, tr.arm || tr.t0 + 0.5, GT);
      if (!tr.snap && arm >= 1) oval(sx(tr.x), sy(tr.y) - 4, 38, 0.55 + 0.25 * Math.sin(GT * 6 + tr.id));
      spr(tr.snap ? 'trap_shut' : 'trap_open', sx(tr.x), sy(tr.y) - 14, 58, 44, 0, { a: tr.snap ? SS(tr.snap + 1.5, tr.snap + 1.1, GT) : 0.5 + 0.5 * arm }); }
    for (const e of ST.ev) { if (GT < e.t || GT > (e.until || e.t + 1)) continue; const q = SS(e.t, e.until, GT);
      // a strike coming down here: the red Effector warning ring, a crisp outline, and a fill that closes in as it lands
      if (e.k === 'bwarn') { const x = sx(e.x), y = sy(e.y), w = e.r * 2 * 384 / 350;
        L.shadow(x, y, e.r * 0.95, e.r * 0.72, 0.3 * q); book('fxa_warn', loopQ(GT * 1.4, e.x * 0.001), x, y, w, w, { add: 1, a: 0.85 });
        oval(x, y, e.r, 0.9); L.ring(x, y, e.r * q, e.r * 0.75 * q, DR, 0.35 + 0.45 * q, 0.07); }
      if (e.k === 'bline') { const x = sx(e.x), y = sy(e.y), dx = e.x2 - e.x, dy = e.y2 - e.y, len = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
        L.solid(x, y - e.w / 2, len, e.w, DR, a, 0, e.w / 2, 0.1 + 0.18 * q); band(x, y, a, len, e.w / 2, 0.9); L.solid(x, y - 2, len * q, 4, [1, 0.6, 0.4], a, 0, 2, 0.8); }
      // a rat stampede: the swept strip is outlined; the rows' start lines and a preview sweep show where the gaps are
      if (e.k === 'lanes') { const px = -e.ay, py = e.ax, ph = ((GT - e.t) * 1.6) % 1, as = Math.atan2(e.ay, e.ax), L2 = 2100;
        for (const s of [-720, 720]) { const wx = e.x + px * s, wy = e.y + py * s; seg(sx(wx) - e.ax * 340, sy(wy) - e.ay * 340, as, L2 + 340, 0.85); }
        for (let row = 0; row < 3; row++) for (let s = -700; s <= 700; s += 39) { if (Math.abs(s - e.gaps[row][0]) < 110 || Math.abs(s - e.gaps[row][1]) < 110) continue;
          for (const d of [0, ph * L2]) { const wx = e.x + px * s - e.ax * row * 170 + e.ax * d, wy = e.y + py * s - e.ay * row * 170 + e.ay * d; if (!vis(wx, wy, 40)) continue;
            L.solid(sx(wx) - 14, sy(wy) - 3, 28, 6, DR, as + Math.PI / 2, 14, 3, d ? 0.45 * (1 - ph) : 0.85); } } } }
    if (!B) return;
    const e = ST.enemies.find((o) => o.id === B.id), ox = B.kind === 'lenin' ? SIM.LV.LENIN[0] : e ? e.x : 0, oy = B.kind === 'lenin' ? SIM.LV.LENIN[1] : e ? e.y : 0;
    // the rat-king ball: its crush radius
    if (B.kind === 'vlad' && B.ph === 3 && e && !B.dead) oval(sx(e.x), sy(e.y), e.r + 30, 0.7);
    // «Красный октябрь»: cells are outlined while they warn, then burn (Effector fire per cell)
    if (B.tiles) { const Tl = B.tiles, a = GT - Tl.t0;
      for (let cx = 0; cx < Tl.nx; cx++) for (let cy = 0; cy < Tl.ny; cy++) { if (!SIM.hotCell(Tl, cx, cy)) continue; const wx = Tl.x0 + cx * Tl.cs, wy = Tl.y0 + cy * Tl.cs; if (!vis(wx + 75, wy + 75, 120)) continue;
        const X = sx(wx) + 6, Y = sy(wy) + 6, S2 = Tl.cs - 12, burn = a >= 1;
        L.rrect(X, Y, S2, S2, 8, DR, [0.7, 0.05, 0.05], burn ? 0.3 * SS(2.6, 2.2, a) : 0.08 + 0.12 * a * (0.6 + 0.4 * Math.sin(GT * 20)));
        if (burn) book('fxa_tile', loopQ(GT * 1.2, cx * 0.17 + cy * 0.29), X + S2 / 2, Y + S2 / 2 - 14, S2 * 1.3, S2 * 1.3, { add: 1, a: SS(2.6, 2.2, a) });
        const oa = burn ? SS(2.6, 2.3, a) : 0.6 + 0.3 * Math.sin(GT * 14);
        seg(X, Y, 0, S2, oa); seg(X, Y + S2, 0, S2, oa); seg(X, Y, Math.PI / 2, S2, oa); seg(X + S2, Y, Math.PI / 2, S2, oa); } }
    // shock rings from the fist: chunks of Effector fire along the ring (the gaps stay empty), its two edges outlined
    // shock rings: Effector fire filling each arc between the safe gaps exactly; the gaps' ends get bright posts so the way out reads
    const P2 = (rx, ry, a, r) => [sx(rx + Math.cos(a) * r), sy(ry + Math.sin(a) * r * 0.75)];
    for (const R of B.rings || []) { const r = (GT - R.t0) * R.sp; if (r < 0) continue; const rx = R.x ?? ox, ry = R.y ?? oy, h = Math.min(0.7, SIM.RING_GAP / Math.max(1, r));
      const gs = R.gaps.map((g) => ((g % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).sort((p, q) => p - q);
      gs.forEach((g, gi) => { const a0 = g + h, a1 = (gi + 1 < gs.length ? gs[gi + 1] : gs[0] + 2 * Math.PI) - h; if (a1 <= a0) return;
        const n = Math.max(1, Math.ceil((a1 - a0) * r / 85)), da = (a1 - a0) / n;
        for (let k = 0; k < n; k++) { const a = a0 + (k + 0.5) * da, [X, Y] = P2(rx, ry, a, r); if (X < -120 || X > W + 120 || Y < -120 || Y > H + 120) continue;
          const ta = Math.atan2(Math.cos(a) * 0.75, -Math.sin(a));
          bookR('fxa_wave', loopQ(GT * 1.3, (gi * 7 + k) * 0.137), X, Y - 10, da * r * 1.15, 60, ta, null, { a: 0.95 });
          for (const dr of [-30, 30]) { const [x1, y1] = P2(rx, ry, a - da / 2, r + dr), [x2, y2] = P2(rx, ry, a + da / 2, r + dr); seg(x1, y1, Math.atan2(y2 - y1, x2 - x1), Math.hypot(x2 - x1, y2 - y1) + 1, 0.8, 2); } }
        for (const ae of [a0, a1]) { const [xa, ya] = P2(rx, ry, ae, r - 30), [xb, yb] = P2(rx, ry, ae, r + 30); seg(xa, ya, Math.atan2(yb - ya, xb - xa), Math.hypot(xb - xa, yb - ya), 1, 4);
          L.glow((xa + xb) / 2, (ya + yb) / 2 - 10, 30, [1, 0.9, 0.6], 0.5, 2); } }); }
    // eye lasers: a thin aiming line first (no outline — the beam itself is the warning), then the Effector beam along the ground, fed from his eyes
    const eyes = B.kind === 'lenin' && !B.dead ? leninEyes(B, GT, sx(ox), sy(oy)) : null;
    // each beam leaves one eye, comes down onto the paving LAS_GROUND out, and runs along the ground (only that part hurts — it is outlined)
    B.lasers.forEach((Ls, k) => { const G0 = SIM.LAS_GROUND, ca = Math.cos(Ls.a), sa = Math.sin(Ls.a) * 0.75, as = Math.atan2(sa, ca), x0 = sx(ox + ca * G0), y0 = sy(oy + sa * G0), hw = SIM.LAS_W + 16, len = 1700 - G0;
      const ex = eyes ? eyes[0] + (k % 2 ? 0.022 : -0.022) * eyes[2] : x0, ey = eyes ? eyes[1] : y0, ed = Math.hypot(x0 - ex, y0 - ey), ea = Math.atan2(y0 - ey, x0 - ex);
      if (GT < Ls.on || (Ls.hold && GT < Ls.hold)) { L.solid(x0, y0 - 1.5, len, 3, DR, as, 0, 1.5, 0.45 + 0.35 * Math.sin(GT * 20)); L.solid(ex, ey - 1, ed, 2, DR, ea, 0, 1, 0.6); return; }
      bookR('fxa_beam', loopQ(GT * 1.4, k * 0.31), x0, y0, len, hw * 3.2, as, [0, hw * 1.6]);
      bookR('fxa_beam', loopQ(GT * 1.4, k * 0.31 + 0.5), ex, ey, ed + 20, hw * 2.2, ea, [0, hw * 1.1]);
      book('fxa_slam', loopQ(GT * 3, k * 0.4) * 0.35, x0, y0 - 10, 120, 120, { add: 1, a: 0.8 }); });       // where it burns into the paving
    // the commissar's machine-gun cone while he sprays
    const K = B.km; if (K && K.atk && K.atk.k === 'burst') { const ke = ST.enemies.find((o) => o.id === K.eid);
      if (ke) { const X = sx(ke.x), Y = sy(ke.y) - 52; for (const o of [-0.13, 0.13]) seg(X, Y, K.aim + o, 720, 0.75); } }
  }
  // the dialogue box of a cut-scene: letterbox, portrait, name, typed text
  let cutKey = '', cutT0 = 0;
  function drawCut(ST, F) {
    const c = ST.cut, id = c.ids[c.i], [who, text] = (window.BLINES || {})[id] || ['', ''], k = c.key + c.i;
    if (k !== cutKey) { cutKey = k; cutT0 = performance.now(); }
    const n = Math.floor((performance.now() - cutT0) / 1000 * 42);
    L.solid(0, 0, W, 110, [0, 0, 0], 0, 0, 0, 0.92); L.solid(0, H - 110, W, 110, [0, 0, 0], 0, 0, 0, 0.92);
    const bx = W / 2 - 660, by = H - 300, bw = 1320, bh = 210; panel('cut', bx, by, bw, bh, 0.94);
    L.sprite(portraitOf(id, who), bx + 18, by + 18, { w: 174, h: 174 });
    lab('cutn', BNAME[who] || who, bx + 214, by + 40, Object.assign({ size: 30, col: BCOL[who] || '#f6e7c8' }, F));
    wrap(text.slice(0, n), 46).slice(0, 3).forEach((ln, j) => lab('cutt' + j, ln, bx + 214, by + 92 + j * 40, Object.assign({ size: 28, col: '#f6e7c8' }, F)));
    lab('cuth', 'E — дальше', bx + bw - 24, by + bh - 24, Object.assign({ size: 16, al: 1, col: '#9fd0ff' }, F));
  }
  function drawBossHUD(ST, me, GT, sx, sy, F) {
    const B = ST.boss; if (!B) return;
    if (!B.dead && ST.bossWave && !ST.cut) { const vl = B.kind === 'vlad', nm = vl ? 'ВЛАД — КОРОЛЬ КРЫС' : 'ВЛАДИМИР ИЛЬИЧ: ВОССТАНИЕ', bw = 760, bx = W / 2 - bw / 2, by = 150;
      panel('bossbar', bx - 10, by - 10, bw + 20, 70, 0.85); lab('bossn', nm, W / 2, by + 12, Object.assign({ size: 22, al: 0.5, col: vl ? '#d6a0ff' : '#ff8a7a' }, F));
      bar(bx, by + 30, bw, 22, B.hpf ?? 1, GT < (B.vuln || 0) ? [1, 0.85, 0.3] : [0.85, 0.15, 0.25], [0.55, 0.05, 0.12]);
      for (const f of vl ? [0.65, 0.3] : [0.7, 0.35]) L.solid(bx + bw * f - 1, by + 28, 3, 26, [1, 0.9, 0.7], 0, 0, 0, 0.8);
      if (B.km) { const K = B.km; panel('kmbar', bx + 180, by + 72, 400, 50, 0.85); lab('kmn', 'ВЕРНОСТЬ ПАРТИИ', bx + 380, by + 86, Object.assign({ size: 16, al: 0.5, col: '#ff6a5a' }, F));
        bar(bx + 190, by + 98, 380, 16, K.hpf ?? 1, [1, 0.25, 0.2], [0.6, 0.05, 0.05]); } }
    // a boss line in a speech bubble over the boss (clamped to the screen)
    const bk = [...ST.ev].reverse().find((v) => v.k === 'bark' && GT - v.t < 3.2 && GT >= v.t);
    if (bk && !ST.cut) { const [who, text] = (window.BLINES || {})[bk.id] || ['', '']; const lines = wrap(text, 30), a = SS(0, 0.15, GT - bk.t) * SS(3.2, 2.8, GT - bk.t);
      const tw = Math.max(...lines.map((ln, j) => labW('bk' + j, ln, Object.assign({ size: 20 }, F)))), bh = 34 + lines.length * 28;
      const x = Math.max(tw / 2 + 30, Math.min(W - tw / 2 - 30, sx(bk.x))), y = Math.max(ST.bossWave ? 300 : 200, Math.min(H - 220, sy(bk.y) - (who === 'lenin' ? 420 : 200)));
      L.rrect(x - tw / 2 - 21, y - bh / 2 - 3, tw + 42, bh + 6, 14, [0.55, 0.38, 0.22], [0.3, 0.18, 0.12], 0.9 * a); L.rrect(x - tw / 2 - 18, y - bh / 2, tw + 36, bh, 12, [0.14, 0.08, 0.12], [0.08, 0.04, 0.07], 0.92 * a);
      L.uiBox('bk', x - tw / 2 - 18, y - bh / 2, tw + 36, bh);
      lines.forEach((ln, j) => lab('bk' + j, ln, x, y - (lines.length - 1) * 14 + j * 28, Object.assign({ size: 20, al: 0.5, col: BCOL[who] || '#f6e7c8', a }, F))); }
    if (me.nat && !ST.cut) { const K = B.km, s1 = 'ВАШ ПЕРСОНАЖ НАЦИОНАЛИЗИРОВАН', s2 = 'Управление передано партии. Тактика комиссара:';
      const Y0 = H - 360, tw = Math.max(labW('nat1', s1, Object.assign({ size: 34 }, F)), 940); L.rrect(W / 2 - tw / 2 - 30, Y0 - 50, tw + 60, 168, 16, [0.45, 0.05, 0.05], [0.25, 0.02, 0.02], 0.85); L.uiBox('nat', W / 2 - tw / 2 - 30, Y0 - 50, tw + 60, 168);
      lab('nat1', s1, W / 2, Y0 - 16, Object.assign({ size: 34, al: 0.5, col: '#ffe066' }, F)); lab('nat2', s2, W / 2, Y0 + 22, Object.assign({ size: 18, al: 0.5, col: '#f6e7c8' }, F));
      ['1 Преследовать', '2 Подавлять огнём', '3 Защищать Ильича'].forEach((s, i) => lab('nat3' + i, s, W / 2 + (i - 1) * 300, Y0 + 60, Object.assign({ size: 20, al: 0.5, col: K && K.mode === i ? '#ffe066' : '#c8a8a0' }, F)));
      if (K) lab('nat4', 'Партия отпустит через ' + Math.max(0, Math.ceil(K.until - GT)) + ' с', W / 2, Y0 + 96, Object.assign({ size: 15, al: 0.5, col: '#ff9a8a' }, F)); }
    if (GT < (me.crisisT || 0)) lab('crisis', 'Идейный кризис: −20% урона', W / 2, 250, Object.assign({ size: 20, al: 0.5, col: '#ff9a8a' }, F));
  }

  // ---------------- HUD ----------------
  const panel = (id, x, y, w, h, a = 0.82) => { L.rrect(x - 3, y - 3, w + 6, h + 6, 10, [0.55, 0.38, 0.22], [0.3, 0.18, 0.12], a); L.rrect(x, y, w, h, 8, [0.12, 0.08, 0.1], [0.07, 0.05, 0.07], a); L.uiBox(id, x, y, w, h, 4); };
  const bar = (x, y, w, h, f, c0, c1) => { L.rrect(x, y, w, h, h / 2, [0.05, 0.02, 0.03], [0.1, 0.05, 0.06]); if (f > 0.01) L.rrect(x + 2, y + 2, (w - 4) * Math.min(1, f), h - 4, (h - 4) / 2, c0, c1); };
  const icon = (hero, id) => id === 'heal' ? 'it_heal' : id === 'reroll' ? 'it_crit' : id === 'fission' ? 'ic_fission' : SIM.UPG.iconOf(id, hero);
  const QN = { hasan: 'Подкрутил усы', danil: 'Фан-чант', vitya: 'Залп по ветру', leha: 'Прикрыл!' }, RN = { hasan: 'Усатое торнадо', danil: 'Камбэк года', vitya: 'Катастрофа', leha: 'До зубов' };
  const BN = { hasan: 'Усы-хлысты', danil: 'Карточки', vitya: 'Пуки' };
  function drawHUD(ST, me, GT, t, sx, sy) {
    const F = { font: FONT };
    if (ST.pause && !ST.over) L.solid(0, 0, W, H, [0.02, 0.0, 0.03], 0, 0, 0, 0.45);          // level-up pause: the world dims and stands still
    // ---- my portrait, HP, XP, level (top-left, like the reference) ----
    panel('me', 24, 20, 470, 150);
    L.sprite('portrait_' + me.hero, 34, 28, { w: 132, h: 132 });
    lab('myname', SIM.HEROES[me.hero].name, 184, 46, Object.assign({ size: 30, col: '#f6e7c8' }, F));
    bar(184, 70, 296, 30, me.hp / me.hpMax, [0.95, 0.25, 0.3], [0.7, 0.1, 0.15]);
    lab('myhp', `${Math.ceil(me.hp)} / ${me.hpMax}`, 470, 85, Object.assign({ size: 20, al: 1 }, F));
    bar(184, 108, 296, 22, ST.xp / ST.xpNext, [0.35, 0.55, 1], [0.2, 0.3, 0.8]);
    lab('myxp', `${Math.floor(ST.xp)} / ${ST.xpNext}`, 470, 119, Object.assign({ size: 16, al: 1 }, F));
    lab('mylv', `Ур. ${ST.lvl}`, 184, 150, Object.assign({ size: 24, col: '#ffd76a' }, F));
    // item slots: 4 weapons (the hero's own first; a fused pair shares one slot) | 4 passives, level pips under each
    { const it = me.items || {}, U = SIM.UPG, fused = me.fused || [], inF = (k) => fused.some((f) => f.includes(k));
      const sh = Object.keys(it).filter((k) => U.WEAPONS[k] && it[k] && !inF(k)), ps = Object.keys(it).filter((k) => U.PASSIVES[k] && it[k]);
      const ws = [[me.sigEvo || 'sig'], ...fused, ...sh.map((k) => [k])];
      panel('items', 24, 178, 470, 76, 0.7); L.solid(257, 186, 2, 58, [0.55, 0.38, 0.22], 0, 0, 0, 0.6);
      const slot = (x, ids) => { const y = 182; L.rrect(x, y, 50, 50, 6, [0.17, 0.11, 0.13], [0.1, 0.06, 0.08]); if (!ids) return;
        const id = ids[0], own = id === (me.sigEvo || 'sig'), mx = U.PASSIVES[id] && U.PASSIVES[id].max ? U.PASSIVES[id].max : U.MAXL;
        if (ids.length === 2) { L.glow(x + 25, y + 25, 34, [0.7, 0.4, 1], 0.35, 2); L.sprite(icon(me.hero, ids[0]), x - 2, y - 2, { w: 34, h: 34 }); L.sprite(icon(me.hero, ids[1]), x + 18, y + 18, { w: 34, h: 34 }); }
        else { if (own && me.evo) L.glow(x + 25, y + 25, 40, [1, 0.8, 0.3], 0.45 + 0.15 * Math.sin(GT * 4), 2);
          L.sprite(own && !me.sigEvo && me.evo ? icon(me.hero, 'evo') : icon(me.hero, id), x, y, { w: 50, h: 50 }); }
        const l = ids.length === 2 ? U.MAXL : it[id] || 1; for (let j = 0; j < mx; j++) L.solid(x + 4 + j * 15, y + 56, 12, 6, j < l ? [1, 0.85, 0.35] : [0.2, 0.15, 0.15]); };
      for (let i = 0; i < 4; i++) slot(30 + i * 56, ws[i]);
      for (let i = 0; i < 4; i++) slot(266 + i * 56, ps[i] ? [ps[i]] : null); }
    if (me.hero === 'danil') for (let k = 0; k < 3; k++) { const c = me.tokens[k];
      if (c === undefined) L.rrect(300 + k * 30, 136, 22, 30, 4, [0.2, 0.15, 0.18], [0.15, 0.1, 0.12]); else L.sprite('fx_card' + (c % 4), 300 + k * 30, 136, { w: 22, h: 30 }); }
    if (me.hero === 'leha') lab('gun', SIM.LEHA_GUNS[GT - me.ultT < 7 ? 3 : me.tier], 300, 150, Object.assign({ size: 18, col: '#c9d68a' }, F));
    // ---- allies (left column) ----
    let ay = 266; for (const p of ST.players) { if (p.id === me.id) continue; panel('al' + p.id, 24, ay, 210, 72, 0.75);
      L.sprite('portrait_' + p.hero, 30, ay + 5, { w: 62, h: 62, u: { alpha: p.out ? 0.3 : 1, grade: p.down ? [0.2, 0.7, 0, 1] : [1, 1, 0, 1] } });
      lab('aln' + p.id, p.bot ? SIM.HEROES[p.hero].name + ' (бот)' : pname(p), 100, ay + 20, Object.assign({ size: 16 }, F));
      bar(100, ay + 38, 124, 16, p.out ? 0 : p.hp / p.hpMax, [0.9, 0.2, 0.25], [0.6, 0.1, 0.15]);
      if (p.down) lab('ald' + p.id, p.out ? 'выбыл' : 'УПАЛ ' + Math.ceil(p.downT), 100, ay + 62, Object.assign({ size: 14, col: '#ff6060' }, F));
      else if (p.inBus) lab('ald' + p.id, 'в автобусе', 100, ay + 62, Object.assign({ size: 14, col: '#ffe066' }, F));
      ay += 84; }
    // ---- wave + timer (top centre) ----
    if (!ST.over) {
    panel('wave', W / 2 - 150, 16, 300, 112);
    const act = ST.players.filter((p) => !p.out), onBus = act.filter((p) => p.inBus).length, bus = ST.bus && !ST.endless;
    const wl = bus ? 'ВСЕ В АВТОБУС!' : ST.bossWave && !ST.clear ? 'БОСС' : ST.brk > 0 ? `Перерыв ${Math.ceil(ST.brk)}` : ST.clear ? 'Добей волну!' : `Волна ${ST.wave}`;
    lab('wavel', wl, W / 2, 44, Object.assign({ size: ST.clear || bus ? 26 : 30, al: 0.5, col: bus ? '#ffe066' : ST.clear ? '#ff9a6a' : '#ffd76a' }, F));
    if (bus) lab('timer', `В автобусе ${onBus}/${act.length}`, W / 2, 84, Object.assign({ size: 24, al: 0.5 }, F));
    else if (ST.clear) lab('timer', `Осталось ${ST.left ?? ST.enemies.length}`, W / 2, 84, Object.assign({ size: 24, al: 0.5 }, F));
    else if (ST.bossWave) lab('timer', `Волна ${ST.wave}`, W / 2, 84, Object.assign({ size: 24, al: 0.5 }, F));
    else lab('timer', mmss(ST.brk > 0 ? ST.brk : SIM.WAVE_LEN - ST.waveT), W / 2, 84, Object.assign({ size: 32, al: 0.5 }, F));
    lab('mapn', ST.endless ? `Бесконечная ночь · домой ${onBus}/${act.length}` : (SIM.MAPN[ST.map] || 'Парк') + (ST.map === 'meleuz' ? ' · волны 11–20' : ' · волны 1–10'), W / 2, 112, Object.assign({ size: 15, al: 0.5, col: ST.endless ? '#d6a0ff' : '#c8b8a0' }, F));
    // the spor and the energy drinks (risk taken → score multiplier)
    { const sp = ST.spor && SIM.SPORS[ST.spor], tags = [];
      if (sp) tags.push(['Спор: ' + sp.n, '#ff9a6a']); if (ST.drinks) tags.push(['Энергетики ×' + ST.drinks, '#9fffd0']); if (ST.daily) tags.push(['Забег дня', '#9fd0ff']);
      tags.forEach(([s2, c], i) => { const tw = labW('tag' + i, s2, Object.assign({ size: 15 }, F)); L.rrect(W / 2 - tw / 2 - 12, 136 + i * 30, tw + 24, 26, 8, [0.12, 0.08, 0.1], [0.07, 0.05, 0.07], 0.8);
        lab('tag' + i, s2, W / 2, 149 + i * 30, Object.assign({ size: 15, al: 0.5, col: c }, F)); }); } }
    // ---- kills / level (top-right) ----
    panel('res', W - 400, 20, 376, 56);
    L.glow(W - 380, 48, 18, [1, 0.3, 0.35], 0.6, 2); lab('kills', `${ST.kills}`, W - 360, 48, Object.assign({ size: 20 }, F));
    L.star(W - 240, 48, 16, [1, 0.85, 0.3], 1); lab('score', (ST.score || 0).toLocaleString('ru-RU'), W - 222, 48, Object.assign({ size: 22, col: '#ffe066' }, F));
    { const x = SIM.scoreX(ST); if (x > 1.001) lab('scx', '×' + x.toFixed(1), W - 34, 48, Object.assign({ size: 16, al: 1, col: '#ff9a6a' }, F)); }
    // ---- minimap ----
    const MX = W - 320, MY = 92, MW = 296, MH = 216, ks = MW / SIM.WORLD.x1;
    panel('map', MX, MY, MW, MH, 0.85);
    L.rrect(MX + (SIM.C[0] - SIM.PLAZA[0]) * ks, MY + (SIM.C[1] - SIM.PLAZA[1]) * ks, SIM.PLAZA[0] * 2 * ks, SIM.PLAZA[1] * 2 * ks, SIM.PLAZA[1] * ks, [0.35, 0.25, 0.22], [0.3, 0.2, 0.18]);
    for (const [px, py, pw, ph, pr] of SIM.PATHS) L.solid(MX + (px - pw / 2) * ks, MY + (py - ph / 2) * ks, pw * ks, ph * ks, [0.3, 0.22, 0.2], pr, pw * ks / 2, ph * ks / 2, 0.8);
    for (const [x, y, rx, ry] of SIM.SUBS) L.rrect(MX + (x - rx) * ks, MY + (y - ry) * ks, rx * 2 * ks, ry * 2 * ks, ry * ks, [0.3, 0.22, 0.2], [0.3, 0.22, 0.2]);
    for (const [x0, y0, x1, y1] of SIM.WALLS || []) L.rrect(MX + x0 * ks, MY + y0 * ks, (x1 - x0) * ks, (y1 - y0) * ks, 2, [0.55, 0.5, 0.45], [0.4, 0.35, 0.3]);
    { const [px, py, rx, ry] = SIM.POND; L.rrect(MX + (px - rx) * ks, MY + (py - ry) * ks, rx * 2 * ks, ry * 2 * ks, ry * ks, [0.15, 0.3, 0.35], [0.1, 0.22, 0.28]); }
    if (SIM.LV.KIOSK && ST.wave >= (ST.kioskNext ?? 3) && !ST.bus) L.solid(MX + SIM.LV.KIOSK[0] * ks - 4, MY + SIM.LV.KIOSK[1] * ks - 4, 8, 8, [0.4, 1, 0.75]);
    if (ST.bus) L.rrect(MX + ST.bus.x * ks - 9, MY + ST.bus.y * ks - 6, 18, 10, 3, [1, 0.85, 0.3], [0.9, 0.5, 0.2], 0.6 + 0.4 * Math.sin(GT * 6));
    if (ST.dots) for (const d of ST.dots) L.solid(MX + d[0] * 8 * ks - 1.5, MY + d[1] * 8 * ks - 1.5, 3, 3, [0.95, 0.25, 0.3]);
    else for (const e of ST.enemies) L.solid(MX + e.x * ks - 1.5, MY + e.y * ks - 1.5, 3, 3, [0.95, 0.25, 0.3]);
    for (const p of ST.players) if (!p.out && !p.inBus) { const c = p.id === me.id ? [0.4, 1, 0.4] : hcol(p.hero); L.solid(MX + p.x * ks - 4, MY + p.y * ks - 4, 8, 8, p.down && Math.floor(GT * 4) % 2 ? [1, 0.2, 0.2] : c, Math.PI / 4, 4, 4); }
    L.rrect(MX + me.cam[0] * ks, MY + me.cam[1] * ks, W * ks, H * ks, 2, [1, 1, 1], [1, 1, 1], 0.08);
    // ---- the bus is off-screen: an arrow at the edge points to it ----
    if (ST.bus && !me.inBus && !me.out && !ST.over) { const bx = sx(ST.bus.x), by = sy(ST.bus.y) - 80;
      if (bx < 40 || bx > W - 40 || by < 40 || by > H - 40) { const a = Math.atan2(by - H / 2, bx - W / 2), r = Math.min((W / 2 - 70) / Math.abs(Math.cos(a) || 1e-3), (H / 2 - 70) / Math.abs(Math.sin(a) || 1e-3));
        const ax = W / 2 + Math.cos(a) * r, ay2 = H / 2 + Math.sin(a) * r, pu = 0.7 + 0.3 * Math.sin(GT * 6);
        L.glow(ax, ay2, 50, [1, 0.8, 0.3], 0.5 * pu, 2); L.solid(ax - 24, ay2 - 8, 48, 16, [1, 0.85, 0.35], a, 24, 8, pu); L.solid(ax + Math.cos(a) * 18 - 14, ay2 + Math.sin(a) * 18 - 14, 28, 28, [1, 0.85, 0.35], a + Math.PI / 4, 14, 14, pu);
        lab('busar', 'АВТОБУС', ax - Math.cos(a) * 60, ay2 - Math.sin(a) * 40, Object.assign({ size: 16, al: 0.5, col: '#ffe066' }, F)); } }
    // ---- abilities (bottom centre): auto attack, Q, R ult — each with its painted icon ----
    if (!ST.over) { const gun = SIM.LEHA_GUNS[GT - me.ultT < 7 ? 3 : me.tier || 0];
      const slots = [['АВТО', me.sigEvo ? SIM.UPG.HEVO[me.sigEvo].n : me.hero === 'leha' ? gun : BN[me.hero], 0, 0, me.sigEvo ? icon(me.hero, me.sigEvo) : me.evo ? icon(me.hero, 'evo') : icon(me.hero, 'sig')],
        ['Q', QN[me.hero], me.qCD / (SIM.QCD[me.hero] * me.m.cd), 0, `ic_${me.hero}_q`], ['R', RN[me.hero], 1 - me.ult, 1, `ic_${me.hero}_r`]];
    const ultPct = Math.floor(me.ult * 100);
    slots.forEach(([key, name, cd, ult, ic], i) => { const x = W / 2 - 200 + i * 140, y = H - 150, s = 112;
      panel('ab' + i, x, y, s, s, 0.88);
      if (cd <= 0 && i) L.glow(x + s / 2, y + s / 2, ult ? 86 : 64, hcol(me.hero), (ult ? 0.4 : 0.25) + 0.15 * Math.sin(GT * 6), 2);
      L.sprite(ic, x + 6, y + 6, { w: s - 12, h: s - 12, u: { grade: cd > 0 ? [0.45, 0.35, 0, 1] : [1, 1, 0, 1] } });
      if (cd > 0) { L.solid(x + 6, y + 6 + (s - 12) * (1 - cd), s - 12, (s - 12) * cd, [0, 0, 0], 0, 0, 0, 0.5); }
      lab('abk' + i, key, x + s / 2, y + s + 6, Object.assign({ size: 20, al: 0.5, col: '#ffd76a' }, F));
      if (ult && cd > 0) lab('ultp', ultPct + '%', x + s / 2, y + s / 2, Object.assign({ size: 26, al: 0.5, col: '#ffffff' }, F));
      if (!ult && i && cd > 0) lab('abcd' + i, String(Math.ceil(cd * SIM.QCD[me.hero] * me.m.cd)), x + s / 2, y + s / 2, Object.assign({ size: 30, al: 0.5, col: '#ffffff' }, F));
      lab('abn' + i, name, x + s / 2, y - 18, Object.assign({ size: 15, al: 0.5 }, F)); }); }
    // ---- combo banner ----
    if (GT - ST.comboT < 2.2) { const e = [...ST.ev].reverse().find((v) => v.k === 'combo'); if (e) { const a = GT - e.t, k = SS(0, 0.15, a) * SS(2.2, 1.7, a), s = 54 + 20 * SS(0.15, 0, a);
      const tw = labW('combo', COMBO[e.key], Object.assign({ size: s, col: '#ffe066' }, F)); L.rrect(W / 2 - tw / 2 - 30, 180, tw + 60, 84, 16, [0.4, 0.1, 0.25], [0.2, 0.05, 0.15], 0.85 * k); L.uiBox('combo', W / 2 - tw / 2 - 30, 180, tw + 60, 84);
      lab('combo', COMBO[e.key], W / 2, 222, Object.assign({ size: s, al: 0.5, col: '#ffe066', a: k }, F)); } }
    // ---- a new recipe or an unlocked weapon ----
    { const dv = [...ST.ev].reverse().find((v) => (v.k === 'discover' || v.k === 'unlock') && GT - v.t < 3);
      if (dv) { const a = GT - dv.t, k = SS(0, 0.2, a) * SS(3, 2.4, a), q = SIM.QUESTS.find((o) => o.id === dv.id), U = SIM.UPG;
        const s2 = dv.k === 'unlock' ? 'ДЕЛО СДЕЛАНО! Открыто: ' + (q ? q.r.map((id) => (U.WEAPONS[id] || U.PASSIVES[id]).n).join(', ') : dv.id) : 'НОВЫЙ РЕЦЕПТ: ' + SIM.UPG.rname(dv.id);
        const fs = dv.k === 'unlock' ? 26 : 34, tw = labW('dvb', s2, Object.assign({ size: fs }, F)); L.rrect(W / 2 - tw / 2 - 30, 200, tw + 60, 64, 14, [0.12, 0.25, 0.12], [0.06, 0.14, 0.06], 0.85 * k); L.uiBox('dvb', W / 2 - tw / 2 - 30, 200, tw + 60, 64);
        lab('dvb', s2, W / 2, 232, Object.assign({ size: fs, al: 0.5, col: '#9fffa0', a: k }, F)); } }
    // ---- wave start / break banner ----
    const wv = [...ST.ev].reverse().find((v) => (v.k === 'wave' || v.k === 'break' || v.k === 'clear' || v.k === 'bus' || v.k === 'arrive' || v.k === 'drink' || v.k === 'timeout') && GT - v.t < 2.5);
    if (wv) { const a = GT - wv.t, k = SS(0, 0.2, a) * SS(2.5, 2.0, a), dp = wv.pid !== undefined && ST.players.find((q) => q.id === wv.pid);
      const s = wv.k === 'bus' ? (wv.to === 'home' ? 'АВТОБУС ДОМОЙ! ИЛИ ЕЩЁ ПОВОЮЕМ?' : 'ПАЗИК ДО МЕЛЕУЗА! ВСЕ В АВТОБУС!') : wv.k === 'arrive' ? 'МЕЛЕУЗ' : wv.k === 'timeout' ? 'НЕ УСПЕЛИ!'
        : wv.k === 'drink' ? `${dp ? pname(dp) : ''} выпил энергетик! ×${(1 + 0.1 * wv.n).toFixed(1)}` : wv.k === 'wave' ? `ВОЛНА ${wv.n}` : wv.k === 'clear' ? 'ДОБЕЙ ОСТАВШИХСЯ!' : `ВОЛНА ${wv.n} ПРОЙДЕНА!`;
      const tw = labW('wbn', s, Object.assign({ size: 64 }, F)); L.rrect(W / 2 - tw / 2 - 40, H * 0.36 - 50, tw + 80, 100, 18, [0.15, 0.08, 0.1], [0.08, 0.04, 0.06], 0.75 * k); L.uiBox('wbn', W / 2 - tw / 2 - 40, H * 0.36 - 50, tw + 80, 100);
      lab('wbn', s, W / 2, H * 0.36, Object.assign({ size: 64, al: 0.5, col: '#ffd76a', a: k }, F)); }
    // ---- upgrade cards ----
    if (me.pick && !ST.over) { const n = me.pick.length, cw = n >= 4 ? 340 : 420, ch = 190, x0 = W / 2 - (cw * n + 20 * (n - 1)) / 2, y0 = H - 470;
      const kb = ST.players.find((q) => q.id === ST.kettleBy), kettle = me.pick[0].kind === 'fission';
      const title = kettle ? (kb && kb.id !== me.id && ST.players.length > 1 ? `${pname(kb)} открыл котёл! Что сварим? (1–${n})` : `Бабушкин котёл! Что сварим? (1–${n})`) : `Новый уровень! Выбери улучшение (1–${n})`;
      lab('pickt', title, W / 2, y0 - 34, Object.assign({ size: 28, al: 0.5, col: kettle ? '#9fffa0' : '#9fd0ff' }, F));
      L.uiBox('pickt', W / 2 - labW('pickt', title, Object.assign({ size: 28 }, F)) / 2 - 10, y0 - 60, labW('pickt', title, Object.assign({ size: 28 }, F)) + 20, 52);
      me.pick.forEach((c, i) => { const x = x0 + i * (cw + 20), evo = c.kind === 'recipe', own = c.kind === 'sig' || evo, alc = evo || c.kind === 'fusion' || c.kind === 'fission';
        panel('card' + i, x, y0, cw, ch, 0.92);
        if (own || alc) L.glow(x + 50, y0 + 50, evo ? 200 : 110, evo ? [1, 0.8, 0.3] : c.kind === 'fusion' ? [0.7, 0.4, 1] : c.kind === 'fission' ? [1, 0.9, 0.4] : hcol(me.hero), evo ? 0.5 + 0.2 * Math.sin(GT * 5) : 0.25, 2);
        if (c.kind === 'fusion') { L.sprite(icon(me.hero, c.a), x + 10, y0 + 10, { w: 52, h: 52 }); L.sprite(icon(me.hero, c.b), x + 40, y0 + 40, { w: 52, h: 52 }); }
        else L.sprite(evo ? (c.found ? icon(me.hero, c.rid) : 'ic_unknown') : icon(me.hero, c.id), x + 14, y0 + 14, { w: 76, h: 76 });
        L.rrect(x + 6, y0 + 6, 30, 30, 8, [0.35, 0.2, 0.08], [0.2, 0.1, 0.05]); lab('ck' + i, String(i + 1), x + 21, y0 + 22, Object.assign({ size: 22, al: 0.5, col: '#ffd76a' }, F));
        const nsz = Math.min(22, Math.floor((cw - 112) / (c.n.length * 0.62)));
        if (c.kind === 'gift') L.glow(x + 50, y0 + 50, 110, [1, 0.6, 0.8], 0.3, 2);
        lab('cn' + i, c.n, x + 102, y0 + 38, Object.assign({ size: nsz, col: evo ? '#ffd76a' : c.kind === 'fusion' ? '#d6a0ff' : c.kind === 'gift' ? '#ffb0c8' : own ? '#ffb0e0' : c.kind === 'w' ? '#9fe0ff' : '#f6e7c8' }, F));
        if (c.tag) lab('ct' + i, c.tag, x + 102, y0 + 72, Object.assign({ size: 16, col: c.tag === 'НОВОЕ' ? '#8fff8f' : alc ? '#ffd76a' : '#c8b8a0' }, F));
        if (evo) { L.sprite(icon(me.hero, c.a), x + cw - 82, y0 + 92, { w: 30, h: 30 }); L.sprite(icon(me.hero, c.b), x + cw - 42, y0 + 92, { w: 30, h: 30 }); }
        wrap(c.d, Math.floor((cw - (evo ? 120 : 44)) / 11.8)).slice(0, 3).forEach((ln, j) => lab('cd' + i + '_' + j, ln, x + 22, y0 + 104 + j * 28, Object.assign({ size: 19, col: '#d8c8b0' }, F))); }); }
    // ---- pick pause: who is still choosing ----
    if (ST.pause && !ST.over) { const wait = (ST.pend || []).map((id) => ST.players.find((q) => q.id === id)).filter(Boolean).map(pname);
      const s1 = me.pick ? 'ПАУЗА — все выбирают улучшение' : 'Ты выбрал! Ждём друзей…', s2 = wait.length ? 'Ждём: ' + wait.join(', ') : '';
      const tw = Math.max(labW('pz1', s1, Object.assign({ size: 26 }, F)), labW('pz2', s2 || ' ', Object.assign({ size: 20 }, F)));
      L.rrect(W / 2 - tw / 2 - 26, 124, tw + 52, s2 ? 92 : 56, 12, [0.12, 0.08, 0.16], [0.07, 0.04, 0.1], 0.88); L.uiBox('pz', W / 2 - tw / 2 - 26, 124, tw + 52, s2 ? 92 : 56);
      lab('pz1', s1, W / 2, 152, Object.assign({ size: 26, al: 0.5, col: '#9fd0ff' }, F)); if (s2) lab('pz2', s2, W / 2, 190, Object.assign({ size: 20, al: 0.5, col: '#f6e7c8' }, F)); }
    // ---- downed / out ----
    if (me.inBus && !ST.over) { const s = ST.bus && ST.bus.to === 'home' ? 'Ты в автобусе домой. Ждём остальных…' : 'Ты в автобусе! Ждём остальных…';
      const tw = labW('inb', s, Object.assign({ size: 30 }, F)); L.rrect(W / 2 - tw / 2 - 30, H * 0.62 - 36, tw + 60, 72, 14, [0.25, 0.18, 0.05], [0.12, 0.08, 0.02], 0.8); L.uiBox('inb', W / 2 - tw / 2 - 30, H * 0.62 - 36, tw + 60, 72);
      lab('inb', s, W / 2, H * 0.62, Object.assign({ size: 30, al: 0.5, col: '#ffe066' }, F)); }
    if (me.down && !me.out && !ST.over && !ST.pause) { const s = ST.solo && me.selfRes > 0 ? 'Тебя вырубило! E — встать' : 'Тебя вырубило! Ждём, пока поднимут…';
      const tw = labW('dn', s, Object.assign({ size: 34 }, F)); L.rrect(W / 2 - tw / 2 - 30, H * 0.62 - 40, tw + 60, 110, 14, [0.3, 0.05, 0.05], [0.15, 0.02, 0.02], 0.8); L.uiBox('dn', W / 2 - tw / 2 - 30, H * 0.62 - 40, tw + 60, 110);
      lab('dn', s, W / 2, H * 0.62, Object.assign({ size: 34, al: 0.5, col: '#ffb0a0' }, F)); bar(W / 2 - 200, H * 0.62 + 30, 400, 20, me.downT / 30, [1, 0.3, 0.3], [0.7, 0.1, 0.1]); }
    // ---- results ----
    if (ST.over && ST.awards) { L.solid(0, 0, W, H, [0, 0, 0], 0, 0, 0, 0.55);
      const ttl = ST.home ? 'УЕХАЛИ ГЕРОЯМИ!' : ST.endless ? `НОЧЬ ВЗЯЛА ВЕРХ НА ВОЛНЕ ${ST.wave}` : ST.won ? 'МЕЛЕУЗ ЗАЧИЩЕН!' : ST.map === 'meleuz' ? 'МЕЛЕУЗ НЕ УСТОЯЛ…' : 'ВСЕ ЛЕГЛИ…';
      panel('res2', W / 2 - 520, 70, 1040, 210 + ST.awards.length * 100);
      lab('rt', ttl, W / 2, 120, Object.assign({ size: 48, al: 0.5, col: ST.won ? '#ffe066' : '#ff8080' }, F));
      lab('rsc', `Очки: ${(ST.score || 0).toLocaleString('ru-RU')} · волна ${ST.wave} · убито ${ST.kills}` + (ST.record ? '  НОВЫЙ РЕКОРД!' : ''), W / 2, 176, Object.assign({ size: 24, al: 0.5, col: ST.record ? '#9fffa0' : '#f6e7c8' }, F));
      ST.awards.forEach((a, i) => { const p = ST.players.find((q) => q.id === a.pid), y = 230 + i * 100;
        L.sprite('portrait_' + p.hero, W / 2 - 490, y, { w: 84, h: 84 });
        lab('aw' + i, a.t, W / 2 - 390, y + 26, Object.assign({ size: 32, col: '#ffd76a' }, F));
        lab('ad' + i, `${pname(p)}: ${a.d}`, W / 2 - 390, y + 64, Object.assign({ size: 22 }, F)); });
      lab('rr', ST.net ? 'Ждём, пока хост вернёт всех в комнату…' : window.NET && NET.mode === 'host' ? 'Backspace — в комнату' : 'Backspace — ещё раз', W / 2, 250 + ST.awards.length * 100, Object.assign({ size: 26, al: 0.5, col: '#9fd0ff' }, F)); }
    { const ar = [...ST.ev].reverse().find((v) => v.k === 'arrive' && GT - v.t < 1.4); if (ar) L.solid(0, 0, W, H, [0, 0, 0], 0, 0, 0, SS(1.4, 0.2, GT - ar.t)); }
    if (!ST.over) drawBossHUD(ST, me, GT, sx, sy, F);
    if (ST.cut && !ST.over) drawCut(ST, F);
    // demo caption
  }

  // QA hooks (engine.md §7): HUD screens with worst-case values
  S.QA = () => {
    const base = (f) => { const s = SIM.spawn(0, { hero: 'danil' }); for (let i = 0; i < 600; i++) SIM.step(s, { right: i < 200 ? 1 : 0 }); if (f) f(s); return s; };
    const match = SIM.at(20);
    return { states: [['match', Object.assign({}, match, { me: 0 })], ['play', base()],
      ['pick', base((s) => { const p = s.players[0]; p.hero = 'leha'; p.items = { sig: 5, tapok: 5, speaker: 3, dmg: 5, armor: 1, cd: 2, plate: 3, pick: 4 };
        p.pick = [SIM.cardFor(p, 'petard'), SIM.cardFor(p, 'armor'), SIM.cardFor(p, 'can'), SIM.cardFor(p, 'reroll')]; })],
      ['pick_hint', base((s) => { const p = s.players[0]; p.hero = 'hasan'; p.items = { sig: 2 }; p.pick = [SIM.cardFor(p, 'sig'), SIM.cardFor(p, 'pick'), SIM.cardFor(p, 'heal')]; })],
      ['pause', base((s) => { const p = s.players[0]; p.items = { sig: 3, tapok: 2, can: 1, dmg: 2, as: 1, deo: 3, crit: 4 }; p.pick = [SIM.cardFor(p, 'speaker'), SIM.cardFor(p, 'regen'), SIM.cardFor(p, 'heal')];
        s.pause = 1; s.pend = [0, 1, 2]; })],
      ['clear', base((s) => { s.clear = 1; s.waveT = SIM.WAVE_LEN; s.ev.push({ k: 'clear', n: 4, t: s.t - 0.4 }); })],
      ['down', base((s) => { s.players[0].down = 1; s.players[0].downT = 22; s.players[1].down = 1; })],
      ['combo', base((s) => { s.comboT = s.t; s.ev.push({ k: 'combo', key: 'toxcard', t: s.t - 0.3, x: 2600, y: 1900 }); })],
      ['results', base((s) => { s.over = s.t; s.won = 1; s.awards = [{ pid: 2, t: 'Главный токсик', d: '999 раз окурил своих' }, { pid: 1, t: 'Профессиональный лежун', d: 'падал 99 раз' }, { pid: 0, t: 'Пылесос усов', d: 'собрал 99999 опыта' }, { pid: 3, t: 'Мясник парка', d: '999999 урона' }, { pid: 1, t: 'Ангел-хранитель', d: 'поднял друзей 99 раз' }, { pid: 0, t: 'Любитель ароматов', d: '999 сек в облаке Вити' }, { pid: 2, t: 'Командный игрок', d: '99 комбо' }]; })], ...abilQA()],
      ...walkQA() };
  };
  // every hero ability mid-effect (worst case: a crowd around, wave 4), so each one's look is checked at full res
  const abil = (hero, key, after, f) => { const s = SIM.spawn(0, { hero }); s.wave = 4;
    const god = () => { s.xpNext = 1e9; s.chests = []; for (const p of s.players) { p.hp = p.hpMax = 9999; p.pick = null; p.queue = 0; } };
    for (let i = 0; i < 120 * 9; i++) { SIM.step(s, {}); god(); }
    const p = s.players[0]; p.qCD = 0; p.ult = 1; p.ultLock = 0; if (f) f(s, p); god();
    if (key) { SIM.step(s, { [key]: 1 }); SIM.step(s, {}); }
    for (let i = 0; i < 120 * after; i++) { SIM.step(s, {}); god(); }
    s.me = 0; return s; };
  const abilQA = () => [
    ...(() => { const s0 = abil('hasan', null, 0.05), p = s0.players[0]; p.inv = 0; p.hurtT = -9; s0.enemies = s0.enemies.filter((e) => Math.hypot(e.x - p.x, e.y - p.y) > 260);   // one lash, frame by frame
      return [0.03, 0.09, 0.15, 0.21, 0.25, 0.29].map((a, i) => ['hasan_whip' + i, Object.assign({}, s0, { ev: [{ k: 'whip', pid: 0, x: p.x, y: p.y, ang: 0.3, side: 1, pull: 1, n: 2, R: 200, t: s0.t - a }] })]); })(), ['hasan_q', abil('hasan', 'q', 0.8)], ['hasan_r', abil('hasan', 'r', 1.5)],
    ['danil_cards', abil('danil', null, 0.2)], ['danil_q', abil('danil', 'q', 0.25)], ['danil_r', abil('danil', 'r', 1.2)],
    ['vitya_gas', abil('vitya', null, 1.0, (s, p) => { p.items.sig = 5; p.m.double = 1; })], ['vitya_q', abil('vitya', 'q', 0.3)], ['vitya_r', abil('vitya', 'r', 1.6)],
    ['leha_smg', (() => { const s = abil('leha', null, 0.1, (s, p) => { p.items.sig = 2; p.tier = 1; }), p = s.players[0]; p.lastAtk = s.t - 0.02; p.ax = 1; p.ay = 0.2; s.ev.push({ k: 'shot', pid: 0, x: p.x, y: p.y, ang: Math.atan2(0.2, 1), g: 1, t: s.t - 0.01 }); return s; })()], ['leha_shotgun', (() => { const s = abil('leha', null, 0.6, (s, p) => { p.items.sig = 3; p.tier = 2; }), p = s.players[0]; s.ev.push({ k: 'shot', pid: 0, x: p.x, y: p.y, ang: 0.2, g: 2, t: s.t - 0.02 }); return s; })()],
    ['evo_track', abil('danil', null, 0.1, (s, p) => { p.items = { sig: 5, crit: 1, dmg: 2 }; })],
    ['evo_full', abil('vitya', null, 0.1, (s, p) => { p.items = { sig: 3, dmg: 1, as: 1, area: 2, deo: 1 }; })],
    ...['hasan', 'danil', 'vitya', 'leha'].map((h) => ['evo_' + h, (() => { const s = abil(h, null, 3.6, (s, p) => { p.evo = 1; p.items.sig = 5; p.tier = 3; }), p = s.players[0];
      s.ev.push({ k: 'upgrade', pid: 0, id: 'evo', x: p.x, y: p.y, evo: 1, t: s.t - 0.3 }); return s; })()]),
    ...['hasan', 'danil', 'vitya', 'leha'].map((h) => ['evoaura_' + h, abil(h, null, 3.6, (s, p) => { p.evo = 1; p.items.sig = 5; p.tier = 3; })]),
    // the cauldron: an undiscovered recipe, a known one and a fusion offer; a build with fused weapons + a hero evolution in the HUD
    ['kettle', (() => { const s = abil('vitya', null, 0.2, (s, p) => { p.items = { sig: 3, petard: 3, icecream: 3, can: 3, speaker: 3, dmg: 3, crit: 3 }; SIM.recalc(p); }), p = s.players[0];
      s.found = ['salute']; p.pick = SIM.kettleCards(s, p); s.pause = 1; s.pend = [0]; return s; })()],
    ['alchemy_hud', abil('leha', null, 1.2, (s, p) => { p.items = { sig: 3, leha_rail: 2, salute: 1, tapok: 3, speaker: 3, pigeon: 2, fury: 1, armor: 3, hp: 2 }; p.sigEvo = 'leha_rail';
      p.fused = [['tapok', 'speaker']]; SIM.recalc(p); })],
    ['status', abil('hasan', null, 0.4, (s, p) => { s.enemies.forEach((e, i) => { if (i % 3 === 0) e.burnT = s.t + 3; else if (i % 3 === 1) e.freezeT = s.t + 3; }); p.items.pigeon = 3; SIM.recalc(p); })],
    ['leha_q', abil('leha', 'q', 0.4)], ['leha_r', abil('leha', 'r', 1.0)], ...melQA(), ...sigQA(), ...bossQA()];
  // bosses mid-fight (BOSSES.md): a phase each, their telegraphs, a bark, the cut-scene box, the nationalised Лёха
  const bossQA = () => {
    const god = (s) => { s.xpNext = 1e9; for (const p of s.players) { p.hp = p.hpMax = 9999; p.pick = null; p.queue = 0; } };
    const run = (s, secs) => { for (let i = 0; i < 120 * secs; i++) { SIM.step(s, {}); god(s); } return s; };
    const fight = (map, secs, f, heroes, humans) => { const s = SIM.create({ heroes: heroes || ['hasan', 'danil', 'vitya', 'leha'], humans: humans || [0], map }); s.wave = map === 'park' ? 10 : 20; s.brk = 0;
      run(s, 2); SIM.startBoss(s); s.cut = null; s.boss.go = 1; s.boss.next = s.t + 0.5; const e = s.enemies.find((o) => o.id === s.boss.id); e.inv = 0; if (f) f(s, e);
      run(s, secs); s.cut = null; const p = s.players[0]; p.cam = [e.x - W / 2, e.y - 60 - H / 2 + 100]; s.me = 0; return s; };
    return [['boss_vlad', fight('park', 1.6, (s) => { s.boss.n = 1; s.ev.push({ k: 'bark', id: 'rk_t_vitya', x: s.boss ? SIM.C[0] : 0, y: SIM.C[1], t: s.t + 1.2 }); })],
      ['boss_vlad_ball', fight('park', 1.0, (s, e) => { e.hp = e.hpMax * 0.25; s.boss.ph = 3; e.r = 64; })],
      ['boss_lenin', fight('meleuz', 2.0, (s) => { s.boss.n = 0; })],
      ['boss_cut', (() => { const s = fight('meleuz', 0.2); s.cut = { key: 'ln_b', ids: ['ln_b_0', 'ln_b_1'], i: 0, t0: s.rt, fx: SIM.LV.LENIN[0], fy: SIM.LV.LENIN[1] }; return s; })()],
      ['boss_nat', (() => { const s = fight('meleuz', 0.1, (s, e) => { e.hp = e.hpMax * 0.68; }, ['leha', 'hasan', 'danil', 'vitya'], [0, 1]);
        s.cut = { key: 'ln_b', ids: ['ln_b_4'], i: 0, t0: -99, fx: 0, fy: 0, then: 'betray' }; SIM.step(s, {}); run(s, 2); s.cut = null; s.me = 0; return s; })()]]; };
  // the hero's own weapon after each element evolution, mid-attack
  const sigQA = () => { const evo = (hero, id, secs) => abil(hero, null, secs, (s, p) => { p.items = { sig: 3, [id]: 1 }; p.sigEvo = id; p.tier = 2; SIM.recalc(p); });
    const whip = (id) => { const s0 = evo('hasan', id, 0.05), p = s0.players[0]; p.inv = 0; p.hurtT = -9;
      return Object.assign({}, s0, { ev: [{ k: 'whip', pid: 0, x: p.x, y: p.y, ang: 0.3, side: 1, pull: 0, n: 2, R: 200, t: s0.t - 0.17 }] }); };
    const cards = (id) => { const s = evo('danil', id, 0.3), p = s.players[0];
      for (let k = 0; k < 3; k++) s.proj.push({ id: 900 + k, own: 0, kind: 'card', x: p.x + 110 + k * 90, y: p.y - 60 - k * 20, vx: 900, vy: -120, c: k, ttl: 0.5, hit: [] }); return s; };
    const gun = (id) => { const s = evo('leha', id, 0.6), p = s.players[0]; s.ev.push({ k: 'shot', pid: 0, x: p.x, y: p.y, ang: 0.2, g: 1, t: s.t - 0.01 }); return s; };
    return [['sig_hasan_shock', whip('hasan_shock')], ['sig_hasan_fire', whip('hasan_fire')], ['sig_danil_mail', cards('danil_mail')], ['sig_danil_fan', cards('danil_fan')],
      ['sig_vitya_boom', evo('vitya', 'vitya_boom', 1.2)], ['sig_vitya_frost', evo('vitya', 'vitya_frost', 1.2)], ['sig_leha_rail', gun('leha_rail')], ['sig_leha_inc', gun('leha_inc')]]; };
  // Мелеуз: the town, its folk, its items, the bus and the endless night's HUD
  const melQA = () => {
    const mel = (secs, f, at) => { const s = SIM.create({ heroes: ['hasan', 'danil', 'vitya', 'leha'], humans: [0], map: 'meleuz' }); s.wave = 14; s.brk = 0;
      const god = () => { s.xpNext = 1e9; for (const p of s.players) { p.hp = p.hpMax = 9999; p.pick = null; p.queue = 0; p.kq = 0; } };
      if (f) f(s, s.players[0]); for (let i = 0; i < 120 * secs; i++) { SIM.step(s, {}); god(); }
      if (at) { const p = s.players[0]; p.x = at[0]; p.y = at[1]; p.cam = [at[0] - W / 2, at[1] - 60 - H / 2]; }
      s.me = 0; return s; };
    const items = (s, p) => { p.items = { sig: 3, sugar: 3, tractor: 3, condensed: 2, kumys: 2, dmg: 2 }; SIM.recalc(p); };
    return [['mel_square', mel(10)], ['mel_admin', mel(0.2, null, [3900, 1250])], ['mel_glory', mel(0.2, null, [1450, 1300])], ['mel_mosque', mel(0.2, null, [1500, 3000])],
      ['mel_river', mel(0.2, null, [3800, 2900])], ['mel_church', mel(0.2, null, [2600, 1000])],
      ['mel_mobs', mel(16, (s) => { s.wave = 16; })], ['mel_items', mel(6, items)],
      ['mel_elites', mel(3, (s, p) => { s.eliteT = 0; s.wave = 15; for (let i = 0; i < 2; i++) { s.eliteT = 0; } })],
      ['bus_park', (() => { const s = SIM.spawn(0, { hero: 'vitya' }); s.wave = 10; for (let i = 0; i < 120 * 3; i++) SIM.step(s, {});
        s.enemies = []; s.bus = { x: SIM.LV.BUS[0], y: SIM.LV.BUS[1], to: 'meleuz', t0: s.t - 2 }; s.players[1].inBus = 1; const p = s.players[0]; p.x = s.bus.x - 500; p.y = s.bus.y + 40;
        p.cam = [p.x - W / 2 + 250, p.y - 60 - H / 2]; s.ev.push({ k: 'bus', to: 'meleuz', t: s.t - 0.5, x: s.bus.x, y: s.bus.y }); return s; })()],
      ['endless_hud', mel(2, (s) => { s.wave = 23; s.endless = 1; s.won = 1; s.spor = 'oh2'; s.drinks = 2; s.score = 1234567; s.bus = { x: SIM.LV.BUS[0], y: SIM.LV.BUS[1], to: 'home', t0: -9 }; })],
      ['gift_pick', (() => { const s = mel(0.5), p = s.players[0]; p.gifts = { g_dmg: 4 }; p.pick = ['g_dmg', 'g_crit', 'g_hp'].map((id) => SIM.cardFor(p, id)); s.pause = 1; s.pend = [0]; return s; })()],
      ['results_home', mel(0.2, (s) => { s.over = 1; s.won = 1; s.home = 1; s.endless = 1; s.wave = 27; s.score = 987654; s.awards = [{ pid: 0, t: 'Мясник Мелеуза', d: '999999 урона' }, { pid: 1, t: 'Ангел-хранитель', d: 'поднял друзей 9 раз' }]; })]]; };
  // walk cycles per actor and view (engine.md §7, animation.md §14): one stride, the actor really travelling, camera following
  const walkQA = () => {
    const cycles = {}, sprites = {}, subject = {}, cycleT = {}, rest = {}, actors = [], SP = 200, N = 12;
    const one = (hero, dir, dist, sp, enemy) => { const S = SIM.create({ heroes: [hero === 'ghoul' ? 'hasan' : hero] }); S.wave = 1; S.brk = 0; S.waveT = 1; S.ev = []; S.gems = [];
      const p = S.players[0], dx = [0, 1, 0, -1][dir], dy = [1, 0, -1, 0][dir], x0 = SIM.C[0], y0 = SIM.C[1] - 300;
      if (enemy) { p.x = x0 + 600; p.y = y0; p.cam = [x0 - W / 2, y0 - H / 2 - 60]; p.vx = p.vy = 0; p.dist = 0;
        S.enemies = [{ id: 7, type: 'ghoul', x: x0 + dx * dist, y: y0 + dy * dist, vx: dx * (sp || 0.01), vy: dy * (sp || 0.01), kx: 0, ky: 0, hp: 20, hpMax: 20, r: 22, hitT: -9, biteT: -9, dist, face: dx || 1, spawnT: -9 }];
        p.cam = [x0 - W / 2, y0 - H / 2 - 60]; }
      else { p.x = x0 + dx * dist; p.y = y0 + dy * dist; p.vx = dx * sp; p.vy = dy * sp; p.dir = dir; p.dist = dist; p.cam = [x0 - W / 2, y0 - H / 2 - 60]; p.lastAtk = -9; }
      S.me = 0; S.t = 5; return S; };
    for (const hero of ['hasan', 'danil', 'vitya', 'leha']) for (const [dir, v] of [[0, 'front'], [1, 'side'], [2, 'back']]) {
      const name = hero + '_' + v, R = window.RIGS && RIGS[name]; if (!R) continue;
      const hgt = hero === 'ghoul' ? 84 : Z[name][1], k = hgt / R.h, stride = (R.ankleL ? R.ankleL[1] : R.footL[1]) - R.hipL[1];
      const len = RIG.stride(name, k, v), key = hero + '_walk_' + v;
      const sp = hero === 'ghoul' ? SIM.ETYPES.ghoul.spd : SP;
      cycles[key] = Array.from({ length: N }, (_, i) => one(hero, dir, len * i / N, sp, hero === 'ghoul'));
      sprites[key] = Object.keys(window.ASSETS).filter((n) => n.startsWith(name + '__'));
      subject[key] = hero === 'ghoul' ? 'e7' : 'p0'; cycleT[key] = len / sp; actors.push(hero);
      rest[key] = Object.assign(one(hero, dir, 0, 0, hero === 'ghoul'), { neutral: true }); }
    return { cycles, sprites, subject, cycleT, rest, actors: [...new Set(actors)], box: () => [W / 2 - 200, H / 2 - 220, 400, 320] };
  };
})();
