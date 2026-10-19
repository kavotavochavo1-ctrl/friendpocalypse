// live/scene.js — FRIENDPOCALYPSE scene: a pure function of t and the sim state (engine.md §7).
// World renders into a half-res target (L.init pixel: 2) so painted pixel art and rotated parts share one 2-px grid;
// the HUD is drawn after finish at full res. Night: ground darkened by a light-field overlay with warm lamp pools,
// actors take a softer share of light (pitfalls: "one global light multiply").
(function () {
  const S = (window.SCENE = {}), L = LIB, M = L.M, W = SIM.VIEW.W, H = SIM.VIEW.H, Z = window.SIZES;
  S.REPEAT = ['paving_tex', 'grass_tex'];
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
  S.programs = () => { L.init(W, H, { night: NIGHT, slash: SLASH, pond: POND }, { pixel: 2 }); L.glyphs('0123456789×+/:-'); };

  const SS = L.SS;
  const INK = [0.12, 0.06, 0.05], GAS = [0.55, 0.78, 0.18], GAS2 = [0.78, 0.86, 0.3], WARM = [1.0, 0.62, 0.26];
  const hcol = (h) => SIM.HEROES[h].col;
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
  const EV_TINT = { ghoul: [1, 1, 1, 0], sprinter: [1.25, 0.6, 0.55, 0.8], brute: [0.8, 0.75, 0.95, 0.6], spitter: [0.85, 0.6, 1.3, 0.8], bomber: [1.4, 0.8, 0.4, 0.8] };

  S.render = (t) => {
    const ST = S.state || SIM.at(t), GT = ST.t, rnd = L.rnd;
    const me = ST.players[ST.me || 0];
    // ---- shake: trauma from recent hits / booms near me ----
    let tr = 0; for (const e of ST.ev) { const a = GT - e.t; if (a < 0 || a > 0.4) continue;
      if (e.k === 'boom') tr = Math.max(tr, (e.kind === 'rocket' ? 0.5 : 0.7) * (1 - a / 0.4) * SS(1100, 300, Math.hypot(e.x - me.x, e.y - me.y)));
      if (e.k === 'hurt' && e.pid === me.id && !e.ally) tr = Math.max(tr, 0.45 * (1 - a / 0.3));
      if (e.k === 'ult' && e.pid === me.id) tr = Math.max(tr, 0.4 * (1 - a / 0.4)); }
    const sh = tr * tr * 22 * (window.SETTINGS ? SETTINGS.shake() : 1);
    const cx = Math.round(me.cam[0] + sh * Math.sin(GT * 83)), cy = Math.round(me.cam[1] + sh * Math.sin(GT * 101 + 1));
    const sx = (x) => x - cx, sy = (y) => y - cy, vis = (x, y, m = 300) => x > cx - m && x < cx + W + m && y > cy - m && y < cy + H + m;

    // ===== ground =====
    L.beginBG([0.05, 0.05, 0.06, 1]);
    { const T = 640; L.sprite('grass_tex', 0, 0, { w: W, h: H, src: [cx / T, cy / T, (cx + W) / T, (cy + H) / T], u: { grade: [0.9, 0.95, 0, 1] } }); }
    const PT = 520;
    for (const [px, py, pw, ph, pr] of SIM.PATHS) { if (!vis(px, py, Math.max(pw, ph))) continue;
      L.sprite('paving_tex', sx(px - pw / 2), sy(py - ph / 2), { w: pw, h: ph, rot: pr, pivot: [pw / 2, ph / 2], src: [0, 0, pw / PT, ph / PT] });
      L.solid(sx(px - pw / 2), sy(py - ph / 2), pw, 10, [0.16, 0.09, 0.07], pr, pw / 2, ph / 2, 0.6);
      L.solid(sx(px - pw / 2), sy(py + ph / 2 - 10), pw, 10, [0.16, 0.09, 0.07], pr, pw / 2, -ph / 2 + 10, 0.6); }
    for (const [x, y, rx, ry, k] of SIM.SUBS) { if (!vis(x, y, rx)) continue;
      L.sprite('paving_tex', sx(x - rx), sy(y - ry), { w: rx * 2, h: ry * 2, src: [x / PT, y / PT, (x + 2 * rx) / PT, (y + 2 * ry) / PT], u: { disc: 0.02 } }); }
    { const [x, y] = SIM.C, rx = SIM.PLAZA[0] * 1.06, ry = SIM.PLAZA[1] * 1.06; L.sprite('plaza_center', sx(x - rx), sy(y - ry), { w: rx * 2, h: ry * 2 }); }
    // pond
    { const [x, y, rx, ry] = SIM.POND; if (vis(x, y, rx)) { const lam = new Float32Array(24); let k = 0;
        for (const [lx, ly] of SIM.LAMPS) if (k < 6 && Math.hypot(lx - x, ly - y) < 600) { lam.set([(lx - (x - rx)) * 1, (ly - (y - ry)) + 90, 0, 0.5], k * 4); k++; }
        G.draw(L.P.pond, { u_t: t, u_lamps: lam, u_sz: [rx * 2, ry * 2] }, G.xf(sx(x - rx), sy(y - ry), rx * 2, ry * 2)); } }
    // Vitya's gas: acid-green ground contour (danger reads before the cloud does), red when it holds a friend
    for (const c of ST.clouds) { const a = GT - c.t0, life = SS(0, 0.25, a) * SS(c.ttl, c.ttl - 0.6, a); if (!vis(c.x, c.y, c.r)) continue;
      const ally = ST.players.some((p) => p.hero !== 'vitya' && !p.out && ((p.x - c.x) / c.r) ** 2 + ((p.y - c.y) / (c.r * 0.75)) ** 2 < 1);
      L.ring(sx(c.x), sy(c.y), c.r, c.r * 0.75, ally ? [1.0, 0.25, 0.2] : [0.6, 1.0, 0.15], 0.75 * life, 0.035);
      L.shadow(sx(c.x), sy(c.y), c.r * 0.95, c.r * 0.7, 0.18 * life); }
    for (const e of ST.ev) if (e.k === 'warn' && GT < e.until && GT >= e.t) { const q = (GT - e.t) / (e.until - e.t);
      L.ring(sx(e.x), sy(e.y), e.r, e.r * 0.75, [1, 0.3, 0.15], 0.5 + 0.5 * Math.sin(GT * 30), 0.02); L.ring(sx(e.x), sy(e.y), e.r * q, e.r * 0.75 * q, GAS2, 0.6, 0.05); }
    // chests (elite drops) and shawarma
    for (const c of ST.chests || []) { if (!vis(c.x, c.y, 60)) continue; const b = 3 * Math.sin(t * 3 + c.id), x = sx(c.x), y = sy(c.y);
      L.glow(x, y - 20, 70, [1, 0.8, 0.3], 0.45 + 0.15 * Math.sin(t * 4), 2); L.shadow(x, y + 4, 26, 8, 0.5);
      L.rrect(x - 24, y - 34 + b, 48, 32, 5, [0.75, 0.45, 0.15], [0.45, 0.25, 0.08]); L.rrect(x - 24, y - 40 + b, 48, 12, 4, [0.95, 0.7, 0.25], [0.7, 0.45, 0.12]);
      L.solid(x - 4, y - 32 + b, 8, 10, [1, 0.9, 0.4]); L.star(x + 14, y - 40 + b, 10 + 4 * Math.sin(t * 6 + c.id), [1, 0.95, 0.6], 0.9); }
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
    for (const p of ST.players) if (!p.out) lights.push([sx(p.x), sy(p.y) - 30, 300, p.id === me.id ? 0.55 : 0.3]);
    lights.length = Math.min(40, lights.length);
    const lightAt = (x, y) => { let l = 0; for (const q of lights) { const dx = (x - q[0]) / q[2], dy = (y - q[1]) / (q[2] * 0.62); l += q[3] * Math.exp(-(dx * dx + dy * dy) * 2.4); } return Math.min(1.3, l); };
    { const arr = new Float32Array(160); lights.forEach((q, i) => arr.set(q, i * 4));
      G.draw(L.P.night, { u_lights: arr, u_n: lights.length, u_dark: 0.64, u_amb: [0.05, 0.03, 0.09] }, G.xf(0, 0, W, H)); }
    for (const [x, y] of SIM.LAMPS) if (vis(x, y, 300)) L.glow(sx(x), sy(y) - 10, 300, WARM, 0.3, 1.8);
    L.beginComp();

    // ===== y-sorted world =====
    const Y = [];
    const shade = (x, y) => { const l = lightAt(x, y); return { grade: [0.85 + 0.15 * Math.min(1, l), 0.5 + 0.55 * Math.min(1, l), 0, 1], tint: [1.0, 0.82, 0.62, 0.35 * Math.min(1, l)] }; };
    for (const [k, x, y, s, f] of SIM.PROPS) { if (!vis(x, y, 420)) continue; const [w, h] = sz(k), ww = w * s, hh = h * s;
      Y.push([y, () => { const sxx = sx(x), syy = sy(y), u = shade(sxx, syy - hh * 0.5);
        if (k !== 'flowers') L.shadow(sxx + 10, syy - 4, ww * 0.42, Math.min(30, hh * 0.12), 0.5);
        const sway = (k === 'tree' || k === 'autumn' || k === 'cypress') ? [0.004, 3, t * 0.8 + x * 0.01, 1] : 0;
        L.sprite(k, sxx - ww / 2, syy - hh + (k === 'flowers' ? hh * 0.4 : 0), { w: ww, h: hh, flip: !!f, pad: sway ? 0.03 : 0, u: Object.assign(u, sway ? { sway } : {}) });
        if (k === 'lamp') { const lx = sxx, ly = syy - hh * 0.86; L.glow(lx, ly, 60, [1, 0.72, 0.35], 0.55, 2.5); L.glow(lx, ly, 18, [1, 0.92, 0.7], 0.6, 2); } }]); }
    // enemies
    for (const e of ST.enemies) { if (!vis(e.x, e.y, 120)) continue; const T = SIM.ETYPES[e.type];
      Y.push([e.y, () => { const sp = Math.hypot(e.vx, e.vy), ph = e.dist / 34 * Math.PI, born = SS(0, 0.35, GT - e.spawnT);
        const view = Math.abs(e.vy) > Math.abs(e.vx) * 1.3 ? (e.vy > 0 ? 'ghoul_front' : 'ghoul_back') : 'ghoul_side';
        const h = 84 * T.sc * born * (e.elite ? 1.25 : 1), w = L.hsz(view, h), x = sx(e.x), y = sy(e.y), bob = Math.abs(Math.sin(ph)) * 4 * Math.min(1, sp / 60);
        const hit = SS(0.12, 0, GT - e.hitT), u = shade(x, y - h / 2), tn = EV_TINT[e.type]; u.grade[1] = Math.max(0.78, u.grade[1]); u.rim = [0.55, e.face > 0 ? 0.004 : -0.004, -0.005, 1]; u.rimCol = [1, 0.45, 0.6];
        if (hit > 0) { u.grade = [1, 1, hit * 0.85, 1]; u.haze = [1, 0.95, 0.95]; }
        u.tint = e.elite ? [1.5, 1.15, 0.45, 0.85] : [tn[0], tn[1], tn[2], tn[3]];
        if (e.elite) L.glow(x, y - h * 0.5, h * 0.9, [1, 0.75, 0.25], 0.22 + 0.08 * Math.sin(GT * 5), 2);
        L.shadow(x, y, w * 0.32, 9 * T.sc, 0.5);
        const sq = 1 + 0.06 * Math.sin(2 * ph) * Math.min(1, sp / 60), lean = (e.vx / 300) * 0.12 + (GT - e.biteT < 0.2 ? 0.25 * e.face * Math.sin((GT - e.biteT) / 0.2 * Math.PI) : 0);
        if (RIG.has(view)) { const k = h / RIGS[view].h, ba = GT - (e.biteT || -9);
          RIG.draw({ name: view, view: view.slice(6), x, y, k, fl: view === 'ghoul_side' ? e.face : 1, ph: RIG.phase(view, e.dist, k, view.slice(6)) + e.id, amt: Math.min(1, sp / 60), t, id: 'e' + e.id, u,
            aim: Math.atan2(e.vy, e.vx || 0.001), act: ba < 0.35 ? { kind: 'bite', a: ba / 0.35 } : null, lean: (e.vx / 300) * 0.1 });
        } else L.sprite(view, 0, 0, { m: M.of(M.t(x, y - bob), M.r(lean), M.s((view === 'ghoul_side' ? -e.face : 1) / Math.sqrt(sq), sq)), w, h, pivot: [w / 2, h], u });
        { const ex = view === 'ghoul_side' ? [0.17 * e.face] : view === 'ghoul_front' ? [-0.12, 0.12] : []; for (const o of ex) L.glow(x + o * w, y - h * 0.68 - bob, 7 * T.sc, [1, 0.3, 0.6], 0.9, 2); }
        if (e.type === 'bomber') L.glow(x, y - h * 0.5, 50, [1, 0.5, 0.1], 0.4 + 0.3 * Math.sin(GT * 14), 2.4);
        if (ST.marks.some((m) => m.id === e.id)) { L.ring(x, y - h - 18, 16, 16, [1, 0.35, 0.8], 0.9, 0.18); L.star(x, y - h - 18, 10, [1, 0.6, 0.9], 0.8); }
        if (e.hp < e.hpMax) { const bw = 44 * Math.max(1, T.sc * 0.8); L.solid(x - bw / 2 - 2, y - h - 10, bw + 4, 8, [0.08, 0.03, 0.04]); L.solid(x - bw / 2, y - h - 8, bw * Math.max(0, e.hp / e.hpMax), 4, [0.95, 0.22, 0.32]); }
      }]); }
    // players
    for (const p of ST.players) { if (p.out || !vis(p.x, p.y, 160)) continue;
      Y.push([p.y, () => drawHero(p, sx(p.x), sy(p.y), GT, t, p.id === me.id, shade, ST)]); }
    Y.sort((a, b) => a[0] - b[0]).forEach(([, d]) => d());

    // ===== gas clouds (soft, above actors, low alpha so actors stay readable) =====
    for (const c of ST.clouds) { if (!vis(c.x, c.y, c.r)) continue; const a = GT - c.t0, life = SS(0, 0.3, a) * SS(c.ttl, c.ttl - 0.8, a), n = c.big ? 16 : 7;
      for (let j = 0; j < n; j++) { const an = rnd(c.id, j) * 6.28 + a * (0.3 + 0.4 * rnd(c.id, j + 9)), rr = c.r * 0.55 * Math.sqrt(rnd(c.id, j + 3));
        const x = sx(c.x) + Math.cos(an) * rr, y = sy(c.y) + Math.sin(an) * rr * 0.7 - 30 - 18 * a, r = c.r * (0.38 + 0.2 * rnd(c.id, j + 5)) * (0.7 + 0.3 * SS(0, 1, a));
        L.puff(x, y, r, j % 3 ? GAS : GAS2, 0.32 * life, c.id + j); } }

    // ===== projectiles =====
    for (const b of ST.proj) { const x = sx(b.x), y = sy(b.y), an = Math.atan2(b.vy, b.vx);
      if (b.kind === 'card') { const cols = [[1, 0.35, 0.75], [0.3, 0.9, 1], [1, 0.85, 0.3]], col = b.tox ? GAS2 : cols[b.c || 0], sp = GT * 18 + b.id;
        L.glow(x, y, 26, col, 0.5, 2.5); L.rrect(x - 9, y - 12, 18, 24, 3, [0.98, 0.98, 1], col); L.solid(x - 7, y - 10, 14, 4, col, sp, 7, 10); }
      else if (b.kind === 'tapok') { const sp = GT * 14 + b.id; L.shadow(x, y + 46, 12, 4, 0.35);
        L.rrect(x - 13, y - 7, 26, 14, 7, [0.25, 0.45, 0.95], [0.15, 0.25, 0.65]); L.solid(x - 9, y - 1, 18, 2, [0.95, 0.95, 1], sp, 9, 1); L.solid(x - 1, y - 6, 2, 12, [0.95, 0.95, 1], sp, 1, 6); }
      else if (b.kind === 'can') { const q = 1 - Math.max(0, b.ttl) / 0.6, hgt = 120 * 4 * q * (1 - q);
        L.shadow(x, y + 46, 10, 4, 0.4); L.rrect(x - 7, y - 11 - hgt, 14, 22, 3, [0.3, 0.95, 0.9], [0.1, 0.55, 0.5]); L.solid(x - 7, y - 4 - hgt, 14, 5, [0.95, 0.3, 0.5], GT * 9, 7, 2.5); }
      else if (b.kind === 'rocket') { L.solid(x - 16, y - 5, 32, 10, [0.4, 0.42, 0.3], an, 16, 5); L.glow(x - Math.cos(an) * 18, y - Math.sin(an) * 18, 30, [1, 0.6, 0.2], 0.9, 2.5);
        for (let j = 1; j < 5; j++) L.puff(x - Math.cos(an) * 22 * j, y - Math.sin(an) * 22 * j, 8 + 3 * j, [0.6, 0.55, 0.5], 0.3 / j, b.id + j); }
      else { L.solid(x - 14, y - 2, 28, 4, [1, 0.9, 0.55], an, 14, 2); L.glow(x, y, 16, [1, 0.8, 0.4], 0.5, 2.5); } }
    for (const b of ST.eproj) { const x = sx(b.x), y = sy(b.y); L.glow(x, y, 26, [0.75, 0.3, 1], 0.7, 2.2); L.puff(x, y, 10, [0.6, 0.2, 0.8], 0.9, b.ttl * 10); }

    // ===== event FX =====
    for (const e of ST.ev) { const a = GT - e.t; if (a < 0 || a > 1.6) continue; const ex = sx(e.x), ey = sy(e.y);
      if (e.k === 'whip' && a < 0.22) { const q = a / 0.22, p = ST.players.find((o) => o.id === e.pid); if (!p) continue;
        const hx = sx(p.x), hy = sy(p.y) - 46, R = e.R * 0.95;
        for (let k = 0; k < e.n; k++) { const ac = e.ang + (k - (e.n - 1) / 2) * 0.55 + e.side * (0.9 - 1.6 * q);
          G.blend('add'); G.draw(L.P.slash, { u_col: [1, 0.68, 0.22], u_amt: (1 - q) * 1.4, u_ac: ac, u_hs: 0.9, u_w: 0.11, u_core: 1 }, G.xf(hx - R, hy - R * 0.8, 2 * R, 1.6 * R)); G.blend();
          G.draw(L.P.slash, { u_col: [0.22, 0.12, 0.07], u_amt: (1 - q) * 1.6, u_ac: ac - e.side * 0.08, u_hs: 0.6, u_w: 0.05, u_core: 0 }, G.xf(hx - R * 0.85, hy - R * 0.68, 1.7 * R, 1.36 * R)); }
        if (e.pull) L.ring(hx + Math.cos(e.ang) * 70, hy + Math.sin(e.ang) * 56, 60 * (1 - q), 46 * (1 - q), [1, 0.85, 0.4], 1 - q, 0.12); }
      if (e.k === 'kill' && a < 0.6) { const q = a / 0.6; for (let j = 0; j < 5; j++) { const an = rnd(e.t, j) * 6.28, d = 30 * q * e.sc;
          L.puff(ex + Math.cos(an) * d, ey - 30 * e.sc + Math.sin(an) * d * 0.6 - 30 * q, 14 * e.sc * (1 - 0.4 * q), [0.18, 0.08, 0.16], 0.7 * (1 - q), e.t + j); }
        L.star(ex, ey - 40 * e.sc, 26 * (1 - q), [1, 0.4, 0.7], 1 - q); }
      if (e.k === 'hit' && a < 0.15) L.star(ex, ey - 6, 16 * (1 - a / 0.15), e.tox ? GAS2 : [1, 0.9, 0.6], 1 - a / 0.15);
      if (e.k === 'crit' && a < 0.5) lab('crit' + (e.t * 1000 | 0) % 7, 'КРИТ!', ex, ey - 110 - 40 * a, { size: 22, col: '#ffd040', al: 0.5, a: 1 - a / 0.5, font: FONT });
      if (e.k === 'boom' && a < 0.9) { const q = a / 0.9, r = e.r; L.glow(ex, ey - 20, r * 1.1, e.gas ? [0.7, 1, 0.3] : [1, 0.5, 0.12], 0.55 * (1 - q) ** 2, 2.4);
        L.ring(ex, ey, r * (0.3 + 0.9 * q), r * 0.75 * (0.3 + 0.9 * q), [1, 0.85, 0.5], (1 - q) * 0.8, 0.08);
        for (let j = 0; j < 9; j++) { const an = rnd(e.t, j) * 6.28, d = r * 0.6 * Math.sqrt(q) * (0.5 + rnd(e.t, j + 4));
          L.puff(ex + Math.cos(an) * d, ey - 20 + Math.sin(an) * d * 0.6 - 40 * q, r * 0.35 * (1 - 0.5 * q), q < 0.25 ? [1, 0.75, 0.3] : [0.35, 0.3, 0.28], 0.8 * (1 - q), e.t + j); }
        if (a < 0.9) L.cracks(ex, ey, r * 0.7, a, e.t, 0, 0.6 * (1 - q)); }
      if (e.k === 'fart' && a < 0.5) { const q = a / 0.5; for (let j = 0; j < (e.big ? 10 : 4); j++) { const an = rnd(e.t, j) * 6.28;
          L.puff(ex + Math.cos(an) * 40 * q * (e.big ? 4 : 1), ey - 20 + Math.sin(an) * 24 * q * (e.big ? 4 : 1), 18 * (1 + q) * (e.big ? 2.5 : 1), [0.6, 0.5, 0.2], 0.5 * (1 - q), e.t + j); } }
      if (e.k === 'dash' && a < 0.35) for (let j = 0; j < 5; j++) { const q = a / 0.35; L.puff(ex - e.dx * 80 * q * (1 + j * 0.3), ey - e.dy * 60 * q - 8, 10 + 12 * q, [0.6, 0.45, 0.35], 0.5 * (1 - q), e.t + j); }
      if (e.k === 'step' && a < 0.3) L.puff(ex, ey - 4 - 8 * a, 6 + 18 * a, [0.55, 0.4, 0.3], 0.35 * (1 - a / 0.3), e.t);
      if (e.k === 'revive' && a < 1.0) { const q = a / 1; for (let j = 0; j < 8; j++) L.star(ex + Math.cos(j * 0.785 + q * 3) * 50 * q, ey - 60 - 90 * q + Math.sin(j * 0.785) * 20, 14, [0.6, 1, 0.6], 1 - q);
        L.ring(ex, ey, 40 + 60 * q, 30 + 45 * q, [0.6, 1, 0.6], 1 - q, 0.1); }
      if (e.k === 'lvl' && a < 1.2) for (const p of ST.players) if (!p.out) { const q = a / 1.2; L.ring(sx(p.x), sy(p.y), 30 + 70 * q, 22 + 50 * q, [0.45, 0.7, 1], 1 - q, 0.08); L.glow(sx(p.x), sy(p.y) - 60, 90, [0.5, 0.7, 1], 0.5 * (1 - q), 2); }
      if (e.k === 'spit' && a < 0.2) L.glow(ex, ey - 40, 30, [0.8, 0.3, 1], 1 - a / 0.2, 2);
      if (e.k === 'bass' && a < 0.45) { const q = a / 0.45; L.ring(ex, ey - 20, e.r * (0.3 + 0.7 * q), e.r * 0.75 * (0.3 + 0.7 * q), [0.75, 0.55, 1], 0.7 * (1 - q), 0.06); }
      if (e.k === 'chest' && a < 1.2) { const q = a / 1.2; for (let j = 0; j < 10; j++) L.star(ex + Math.cos(j * 0.63) * 90 * q, ey - 40 - 120 * q + Math.sin(j * 0.63) * 30, 14, [1, 0.85, 0.35], 1 - q);
        L.glow(ex, ey - 40, 160, [1, 0.8, 0.3], 0.6 * (1 - q), 2); }
      if (e.k === 'food' && a < 0.8) { const q = a / 0.8; L.ring(ex, ey, 20 + 50 * q, 14 + 36 * q, [0.5, 1, 0.5], 1 - q, 0.1); }
      if (e.k === 'elite' && a < 1.5) L.ring(ex, ey, 60 + 30 * Math.sin(a * 12), 45, [1, 0.75, 0.2], 1 - a / 1.5, 0.08);
      if (e.k === 'upgrade' && e.evo && a < 1.6) { const q = a / 1.6; L.glow(ex, ey - 60, 260, [1, 0.85, 0.4], 0.9 * (1 - q), 2); for (let j = 0; j < 14; j++) L.star(ex + Math.cos(j * 0.45 + a * 3) * 140 * q, ey - 60 + Math.sin(j * 0.45 + a * 3) * 100 * q, 16, [1, 0.95, 0.6], 1 - q); }
      if (e.k === 'block' && a < 0.3) { L.ring(ex, ey, 30 + 40 * a, 30 + 40 * a, [0.5, 0.9, 1], 1 - a / 0.3, 0.15); }
      if (e.k === 'shot' && a < 0.05) { const p = ST.players.find((o) => o.id === e.pid); if (p) L.glow(sx(p.x) + Math.cos(e.ang) * 48, sy(p.y) - 52 + Math.sin(e.ang) * 30, 30 + 10 * e.g, [1, 0.8, 0.4], 0.6, 2.4); }
    }
    // ability auras that last
    for (const p of ST.players) { if (p.out || p.down || !vis(p.x, p.y, 500)) continue; const x = sx(p.x), y = sy(p.y), qa = GT - p.qT, ua = GT - p.ultT;
      if (p.hero === 'hasan' && qa < 4) for (let k = 0; k < 2; k++) { const R = 170 * p.m.area, ac = GT * 13 + k * Math.PI;
        G.blend('add'); G.draw(L.P.slash, { u_col: [1, 0.65, 0.2], u_amt: 1.1 * SS(4, 3.6, qa), u_ac: ac, u_hs: 1.2, u_w: 0.09, u_core: 1 }, G.xf(x - R, y - 40 - R * 0.75, 2 * R, 1.5 * R)); G.blend(); }
      if (p.hero === 'hasan' && ua < 3.2) { const ox = x + p.fx * 220, oy = y + p.fy * 180, R = 300 + 60 * Math.sin(ua * 3);
        for (let k = 0; k < 4; k++) { G.blend('add'); G.draw(L.P.slash, { u_col: [1, 0.55, 0.15], u_amt: 1.2 * SS(3.2, 2.9, ua) * SS(0, 0.3, ua), u_ac: -GT * 9 + k * 1.57, u_hs: 0.8, u_w: 0.1, u_core: 1 }, G.xf(ox - R * (1 - k * 0.12), oy - 40 - R * 0.75 * (1 - k * 0.12), 2 * R * (1 - k * 0.12), 1.5 * R * (1 - k * 0.12))); G.blend(); }
        L.puff(ox, oy - 40, 120, [0.4, 0.25, 0.1], 0.3, GT * 3); }
      if (p.hero === 'danil' && ua < 1.8) { for (let k = 0; k < 3; k++) { const a = -0.9 + k * 0.9 + 0.3 * Math.sin(GT * 2 + k); L.solid(x - 30, y - 600, 60, 600, [1, 0.6, 0.9], a, 30, 600, 0.12 * SS(1.8, 1.4, ua)); }
        L.glow(x, y - 40, 200, [1, 0.5, 0.85], 0.4 * SS(1.8, 1.2, ua), 2); }
      if (p.hero === 'danil' && qa < 5) { const ca = GT * 2.5; L.glow(x + Math.cos(ca) * 70, y - 120 + Math.sin(ca) * 20, 18, [1, 1, 1], 0.6, 2); L.rrect(x + Math.cos(ca) * 70 - 12, y - 128 + Math.sin(ca) * 20, 24, 16, 3, [0.2, 0.2, 0.25], [0.35, 0.35, 0.4]); }
      if (p.hero === 'leha' && qa < 4 + p.m.shield) { const R = 110; L.ring(x + p.fx * 40, y - 40 + p.fy * 30, R, R * 0.8, [0.45, 0.85, 1], 0.6 + 0.2 * Math.sin(GT * 10), 0.06); L.glow(x, y - 40, 140, [0.4, 0.8, 1], 0.15, 2); }
      if (GT < p.buffT) L.ring(x, y, 46, 18, [1, 0.5, 0.85], 0.6, 0.15);
      if (p.evo && p.hero === 'hasan') for (let k = 0; k < 2; k++) { const R = 170 * p.m.area;
        G.blend('add'); G.draw(L.P.slash, { u_col: [1, 0.55, 0.15], u_amt: 0.75, u_ac: GT * 7 + k * Math.PI, u_hs: 1.0, u_w: 0.08, u_core: 1 }, G.xf(x - R, y - 30 - R * 0.75, 2 * R, 1.5 * R)); G.blend(); }
      if (p.evo && p.hero === 'danil') for (let k = 0; k < 6; k++) { const a = GT * 2.4 + k * Math.PI / 3, cx = x + Math.cos(a) * 130, cy = y - 40 + Math.sin(a) * 100, col = [[1, 0.35, 0.75], [0.3, 0.9, 1], [1, 0.85, 0.3]][k % 3];
        L.glow(cx, cy, 26, col, 0.5, 2.5); L.rrect(cx - 9, cy - 12, 18, 24, 3, [0.98, 0.98, 1], col); }
    }
    { const fl = window.SETTINGS ? SETTINGS.flash() : 1; L.finish(t, { bloom: [0.26 * fl, 0.22 * fl], vignette: 0.86, warm: 0.6, roll: 1, dither: 0 }); }

    drawHUD(ST, me, GT, t, sx, sy);
  };

  // ---------------- hero (whole sprite per view for now; cut-out rigs replace this) ----------------
  function drawHero(p, x, y, GT, t, mine, shade, ST) {
    const view = p.hero + '_' + DIRN[p.dir], [w0, h] = sz(view), w = w0, flip = p.dir === 3;
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
    const lean = (flip ? -1 : 1) * run * 0.06 * (p.dir % 2), dash = GT - p.dashT < 0.17;
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
    if (!mine && !ST.over && (!window.SETTINGS || SETTINGS.get('names'))) { const nw = labW('nm' + p.id, SIM.HEROES[p.hero].name, { size: 18, font: FONT }); lab('nm' + p.id, SIM.HEROES[p.hero].name, x, y - h - 26, { size: 18, al: 0.5, col: '#f6e7c8', font: FONT });
      L.solid(x - 30, y - h - 12, 60, 7, [0.08, 0.03, 0.04]); L.solid(x - 29, y - h - 11, 58 * p.hp / p.hpMax, 5, [0.9, 0.2, 0.25]); }
  }

  // ---------------- HUD ----------------
  const panel = (id, x, y, w, h, a = 0.82) => { L.rrect(x - 3, y - 3, w + 6, h + 6, 10, [0.55, 0.38, 0.22], [0.3, 0.18, 0.12], a); L.rrect(x, y, w, h, 8, [0.12, 0.08, 0.1], [0.07, 0.05, 0.07], a); L.uiBox(id, x, y, w, h, 4); };
  const bar = (x, y, w, h, f, c0, c1) => { L.rrect(x, y, w, h, h / 2, [0.05, 0.02, 0.03], [0.1, 0.05, 0.06]); if (f > 0.01) L.rrect(x + 2, y + 2, (w - 4) * Math.min(1, f), h - 4, (h - 4) / 2, c0, c1); };
  function drawHUD(ST, me, GT, t, sx, sy) {
    const F = { font: FONT };
    // ---- my portrait, HP, XP, level (top-left, like the reference) ----
    panel('me', 24, 20, 470, 150);
    L.sprite('portrait_' + me.hero, 34, 28, { w: 132, h: 132 });
    lab('myname', SIM.HEROES[me.hero].name, 184, 46, Object.assign({ size: 30, col: '#f6e7c8' }, F));
    bar(184, 70, 296, 30, me.hp / me.hpMax, [0.95, 0.25, 0.3], [0.7, 0.1, 0.15]);
    lab('myhp', `${Math.ceil(me.hp)} / ${me.hpMax}`, 470, 85, Object.assign({ size: 20, al: 1 }, F));
    bar(184, 108, 296, 22, ST.xp / ST.xpNext, [0.35, 0.55, 1], [0.2, 0.3, 0.8]);
    lab('myxp', `${Math.floor(ST.xp)} / ${ST.xpNext}`, 470, 119, Object.assign({ size: 16, al: 1 }, F));
    lab('mylv', `Ур. ${ST.lvl}`, 184, 150, Object.assign({ size: 24, col: '#ffd76a' }, F));
    { const it = me.items || {}, W2 = Object.keys(SIM.UPG.WEAPONS).filter((k) => it[k]), P2 = Object.keys(SIM.UPG.PASSIVES).filter((k) => it[k]);
      const slots = [['sig', SIM.UPG.SIG[me.hero].n, it.sig || 1, 1], ...W2.map((k) => [k, SIM.UPG.WEAPONS[k].n, it[k], 2]), ...P2.map((k) => [k, SIM.UPG.PASSIVES[k].n, it[k], 3])];
      panel('items', 24, 178, 470, 46, 0.7);
      slots.forEach(([k, n, l, kind], i) => { const x = 32 + i * 66, y = 184, col = kind === 1 ? hcol(me.hero) : kind === 2 ? [0.45, 0.8, 1] : [0.85, 0.75, 0.6];
        L.rrect(x, y, 60, 34, 6, col.map((v) => v * 0.45), col.map((v) => v * 0.25)); if (kind === 1 && me.evo) L.glow(x + 30, y + 17, 40, [1, 0.8, 0.3], 0.4, 2);
        lab('it' + i, n.slice(0, 4), x + 30, y + 13, Object.assign({ size: 15, al: 0.5 }, F));
        for (let j = 0; j < 5; j++) L.solid(x + 6 + j * 10, y + 26, 8, 4, j < l ? [1, 0.85, 0.35] : [0.2, 0.15, 0.15]); }); }
    if (me.hero === 'danil') for (let k = 0; k < 3; k++) { const c = me.tokens[k], cols = [[1, 0.35, 0.75], [0.3, 0.9, 1], [1, 0.85, 0.3]];
      L.rrect(300 + k * 30, 138, 22, 28, 4, c === undefined ? [0.2, 0.15, 0.18] : cols[c], c === undefined ? [0.15, 0.1, 0.12] : cols[c]); }
    if (me.hero === 'leha') lab('gun', SIM.LEHA_GUNS[GT - me.ultT < 7 ? 3 : me.tier], 300, 150, Object.assign({ size: 18, col: '#c9d68a' }, F));
    // ---- allies (left column) ----
    let ay = 236; for (const p of ST.players) { if (p.id === me.id) continue; panel('al' + p.id, 24, ay, 210, 72, 0.75);
      L.sprite('portrait_' + p.hero, 30, ay + 5, { w: 62, h: 62, u: { alpha: p.out ? 0.3 : 1, grade: p.down ? [0.2, 0.7, 0, 1] : [1, 1, 0, 1] } });
      lab('aln' + p.id, SIM.HEROES[p.hero].name + (p.bot ? ' (бот)' : ''), 100, ay + 20, Object.assign({ size: 16 }, F));
      bar(100, ay + 38, 124, 16, p.out ? 0 : p.hp / p.hpMax, [0.9, 0.2, 0.25], [0.6, 0.1, 0.15]);
      if (p.down) lab('ald' + p.id, p.out ? 'выбыл' : 'УПАЛ ' + Math.ceil(p.downT), 100, ay + 62, Object.assign({ size: 14, col: '#ff6060' }, F));
      ay += 84; }
    // ---- wave + timer (top centre) ----
    panel('wave', W / 2 - 130, 16, 260, 96);
    const wl = ST.brk > 0 ? `Перерыв ${Math.ceil(ST.brk)}` : `Волна ${ST.wave}`;
    lab('wavel', wl, W / 2, 44, Object.assign({ size: 30, al: 0.5, col: '#ffd76a' }, F));
    lab('timer', mmss(ST.brk > 0 ? ST.brk : SIM.WAVE_LEN - ST.waveT), W / 2, 86, Object.assign({ size: 32, al: 0.5 }, F));
    // ---- kills / level (top-right) ----
    panel('res', W - 400, 20, 376, 56);
    L.glow(W - 368, 48, 22, [1, 0.75, 0.2], 0.6, 2); lab('kills', `${ST.kills}`, W - 340, 48, Object.assign({ size: 26 }, F));
    L.solid(W - 200, 38, 18, 18, [0.75, 0.4, 1], Math.PI / 4, 9, 9); lab('lvlc', `${ST.lvl}`, W - 170, 48, Object.assign({ size: 26 }, F));
    // ---- minimap ----
    const MX = W - 320, MY = 92, MW = 296, MH = 216, ks = MW / SIM.WORLD.x1;
    panel('map', MX, MY, MW, MH, 0.85);
    L.rrect(MX + (SIM.C[0] - SIM.PLAZA[0]) * ks, MY + (SIM.C[1] - SIM.PLAZA[1]) * ks, SIM.PLAZA[0] * 2 * ks, SIM.PLAZA[1] * 2 * ks, SIM.PLAZA[1] * ks, [0.35, 0.25, 0.22], [0.3, 0.2, 0.18]);
    for (const [px, py, pw, ph, pr] of SIM.PATHS) L.solid(MX + (px - pw / 2) * ks, MY + (py - ph / 2) * ks, pw * ks, ph * ks, [0.3, 0.22, 0.2], pr, pw * ks / 2, ph * ks / 2, 0.8);
    for (const [x, y, rx, ry] of SIM.SUBS) L.rrect(MX + (x - rx) * ks, MY + (y - ry) * ks, rx * 2 * ks, ry * 2 * ks, ry * ks, [0.3, 0.22, 0.2], [0.3, 0.22, 0.2]);
    if (ST.dots) for (const d of ST.dots) L.solid(MX + d[0] * 8 * ks - 1.5, MY + d[1] * 8 * ks - 1.5, 3, 3, [0.95, 0.25, 0.3]);
    else for (const e of ST.enemies) L.solid(MX + e.x * ks - 1.5, MY + e.y * ks - 1.5, 3, 3, [0.95, 0.25, 0.3]);
    for (const p of ST.players) if (!p.out) { const c = p.id === me.id ? [0.4, 1, 0.4] : hcol(p.hero); L.solid(MX + p.x * ks - 4, MY + p.y * ks - 4, 8, 8, p.down && Math.floor(GT * 4) % 2 ? [1, 0.2, 0.2] : c, Math.PI / 4, 4, 4); }
    L.rrect(MX + me.cam[0] * ks, MY + me.cam[1] * ks, W * ks, H * ks, 2, [1, 1, 1], [1, 1, 1], 0.08);
    // ---- abilities (bottom centre): Space dash, Q, R ult ----
    if (!ST.over) { const slots = [['Space', 'Рывок', me.dashCD / 1.1, 0], ['Q', { hasan: 'Подкрутил усы', danil: 'Фанкам', vitya: 'Залп по ветру', leha: 'Прикрыл!' }[me.hero], me.qCD / (SIM.QCD[me.hero] * me.m.cd), 0],
      ['R', { hasan: 'Усатое торнадо', danil: 'Камбэк года', vitya: 'Катастрофа', leha: 'До зубов' }[me.hero], 1 - me.ult, 1]];
    const ultPct = Math.floor(me.ult * 100);
    slots.forEach(([key, name, cd, ult], i) => { const x = W / 2 - 200 + i * 140, y = H - 150, s = 112;
      panel('ab' + i, x, y, s, s, 0.88);
      if (ult) { L.sprite('portrait_' + me.hero, x + 6, y + 6, { w: s - 12, h: s - 12, u: { grade: cd > 0 ? [0.2, 0.5, 0, 1] : [1, 1, 0, 1] } }); if (cd <= 0) L.glow(x + s / 2, y + s / 2, 80, hcol(me.hero), 0.35 + 0.2 * Math.sin(GT * 6), 2); }
      else L.glow(x + s / 2, y + s / 2, 40, i ? hcol(me.hero) : [0.8, 0.8, 0.9], cd > 0 ? 0.15 : 0.6, 2);
      if (cd > 0) { L.solid(x + 4, y + 4 + (s - 8) * (1 - cd), s - 8, (s - 8) * cd, [0, 0, 0], 0, 0, 0, 0.55); }
      lab('abk' + i, key, x + s / 2, y + s + 6, Object.assign({ size: 20, al: 0.5, col: '#ffd76a' }, F));
      if (ult && cd > 0) lab('ultp', ultPct + '%', x + s / 2, y + s / 2, Object.assign({ size: 26, al: 0.5, col: '#ffffff' }, F));
      lab('abn' + i, name, x + s / 2, y - 18, Object.assign({ size: 15, al: 0.5 }, F)); }); }
    // ---- combo banner ----
    if (GT - ST.comboT < 2.2) { const e = [...ST.ev].reverse().find((v) => v.k === 'combo'); if (e) { const a = GT - e.t, k = SS(0, 0.15, a) * SS(2.2, 1.7, a), s = 54 + 20 * SS(0.15, 0, a);
      const tw = labW('combo', COMBO[e.key], Object.assign({ size: s, col: '#ffe066' }, F)); L.rrect(W / 2 - tw / 2 - 30, 180, tw + 60, 84, 16, [0.4, 0.1, 0.25], [0.2, 0.05, 0.15], 0.85 * k); L.uiBox('combo', W / 2 - tw / 2 - 30, 180, tw + 60, 84);
      lab('combo', COMBO[e.key], W / 2, 222, Object.assign({ size: s, al: 0.5, col: '#ffe066', a: k }, F)); } }
    // ---- wave start / break banner ----
    const wv = [...ST.ev].reverse().find((v) => (v.k === 'wave' || v.k === 'break') && GT - v.t < 2.5);
    if (wv) { const a = GT - wv.t, k = SS(0, 0.2, a) * SS(2.5, 2.0, a), s = wv.k === 'wave' ? `ВОЛНА ${wv.n}` : `ВОЛНА ${wv.n} ПРОЙДЕНА!`;
      const tw = labW('wbn', s, Object.assign({ size: 64 }, F)); L.rrect(W / 2 - tw / 2 - 40, H * 0.36 - 50, tw + 80, 100, 18, [0.15, 0.08, 0.1], [0.08, 0.04, 0.06], 0.75 * k); L.uiBox('wbn', W / 2 - tw / 2 - 40, H * 0.36 - 50, tw + 80, 100);
      lab('wbn', s, W / 2, H * 0.36, Object.assign({ size: 64, al: 0.5, col: '#ffd76a', a: k }, F)); }
    // ---- upgrade cards ----
    if (me.pick && !me.down && !ST.over) { const cw = 420, ch = 190, x0 = W / 2 - (cw * 3 + 40) / 2, y0 = H - 470;
      lab('pickt', 'Новый уровень! Выбери улучшение (1 / 2 / 3)', W / 2, y0 - 34, Object.assign({ size: 28, al: 0.5, col: '#9fd0ff' }, F));
      L.uiBox('pickt', W / 2 - labW('pickt', 'Новый уровень! Выбери улучшение (1 / 2 / 3)', Object.assign({ size: 28 }, F)) / 2 - 10, y0 - 60, labW('pickt', 'Новый уровень! Выбери улучшение (1 / 2 / 3)', Object.assign({ size: 28 }, F)) + 20, 52);
      me.pick.forEach((c, i) => { const x = x0 + i * (cw + 20), evo = c.kind === 'evo', own = c.kind === 'sig' || evo;
        const partner = c.kind === 'p' && SIM.UPG.SIG[me.hero].evo === c.id && !me.evo;
        panel('card' + i, x, y0, cw, ch, 0.92); if (own) L.glow(x + cw / 2, y0 + 30, evo ? 220 : 120, evo ? [1, 0.8, 0.3] : hcol(me.hero), evo ? 0.5 + 0.2 * Math.sin(GT * 5) : 0.25, 2);
        lab('ck' + i, String(i + 1), x + 26, y0 + 34, Object.assign({ size: 34, col: '#ffd76a' }, F));
        lab('cn' + i, c.n, x + 64, y0 + 34, Object.assign({ size: 22, col: evo ? '#ffd76a' : own ? '#ffb0e0' : c.kind === 'w' ? '#9fe0ff' : '#f6e7c8' }, F));
        if (c.tag) lab('ct' + i, c.tag, x + cw - 18, y0 + 72, Object.assign({ size: 18, al: 1, col: c.tag === 'НОВОЕ' ? '#8fff8f' : evo ? '#ffd76a' : '#c8b8a0' }, F));
        wrap(c.d, 26).forEach((ln, j) => lab('cd' + i + '_' + j, ln, x + 22, y0 + 104 + j * 30, Object.assign({ size: 19, col: '#d8c8b0' }, F)));
        if (partner) lab('ce' + i, '→ нужно для эволюции', x + 22, y0 + ch - 20, Object.assign({ size: 16, col: '#ffd76a' }, F)); }); }
    // ---- downed / out ----
    if (me.down && !me.out && !ST.over) { const s = ST.solo && me.selfRes > 0 ? 'Тебя вырубило! E — встать' : 'Тебя вырубило! Ждём, пока поднимут…';
      const tw = labW('dn', s, Object.assign({ size: 34 }, F)); L.rrect(W / 2 - tw / 2 - 30, H * 0.62 - 40, tw + 60, 110, 14, [0.3, 0.05, 0.05], [0.15, 0.02, 0.02], 0.8); L.uiBox('dn', W / 2 - tw / 2 - 30, H * 0.62 - 40, tw + 60, 110);
      lab('dn', s, W / 2, H * 0.62, Object.assign({ size: 34, al: 0.5, col: '#ffb0a0' }, F)); bar(W / 2 - 200, H * 0.62 + 30, 400, 20, me.downT / 30, [1, 0.3, 0.3], [0.7, 0.1, 0.1]); }
    // ---- results ----
    if (ST.over && ST.awards) { L.solid(0, 0, W, H, [0, 0, 0], 0, 0, 0, 0.55);
      const ttl = ST.won ? 'ПАРК ЗАЧИЩЕН!' : 'ВСЕ ЛЕГЛИ…'; panel('res2', W / 2 - 520, 110, 1040, 170 + ST.awards.length * 100);
      lab('rt', ttl, W / 2, 160, Object.assign({ size: 54, al: 0.5, col: ST.won ? '#ffe066' : '#ff8080' }, F));
      ST.awards.forEach((a, i) => { const p = ST.players.find((q) => q.id === a.pid), y = 230 + i * 100;
        L.sprite('portrait_' + p.hero, W / 2 - 490, y, { w: 84, h: 84 });
        lab('aw' + i, a.t, W / 2 - 390, y + 26, Object.assign({ size: 32, col: '#ffd76a' }, F));
        lab('ad' + i, `${SIM.HEROES[p.hero].name}: ${a.d}`, W / 2 - 390, y + 64, Object.assign({ size: 22 }, F)); });
      lab('rr', 'Backspace — ещё раз', W / 2, 250 + ST.awards.length * 100, Object.assign({ size: 26, al: 0.5, col: '#9fd0ff' }, F)); }
    // demo caption
  }

  // QA hooks (engine.md §7): HUD screens with worst-case values
  S.QA = () => {
    const base = (f) => { const s = SIM.spawn(0, { hero: 'danil' }); for (let i = 0; i < 600; i++) SIM.step(s, { right: i < 200 ? 1 : 0 }); if (f) f(s); return s; };
    const match = SIM.at(20);
    return { states: [['match', Object.assign({}, match, { me: 0 })], ['play', base()],
      ['pick', base((s) => { const p = s.players[0]; p.hero = 'leha'; p.items = { sig: 5, tapok: 5, speaker: 3, dmg: 5, armor: 1, cd: 2, plate: 3, pick: 4 };
        p.pick = [SIM.cardFor(p, 'evo'), SIM.cardFor(p, 'armor'), SIM.cardFor(p, 'can')]; })],
      ['pick_hint', base((s) => { const p = s.players[0]; p.hero = 'hasan'; p.items = { sig: 4 }; p.pick = [SIM.cardFor(p, 'sig'), SIM.cardFor(p, 'pick'), SIM.cardFor(p, 'heal')]; })],
      ['down', base((s) => { s.players[0].down = 1; s.players[0].downT = 22; s.players[1].down = 1; })],
      ['combo', base((s) => { s.comboT = s.t; s.ev.push({ k: 'combo', key: 'toxcard', t: s.t - 0.3, x: 2600, y: 1900 }); })],
      ['results', base((s) => { s.over = s.t; s.won = 1; s.awards = [{ pid: 2, t: 'Главный токсик', d: '999 раз окурил своих' }, { pid: 1, t: 'Профессиональный лежун', d: 'падал 99 раз' }, { pid: 0, t: 'Пылесос усов', d: 'собрал 99999 опыта' }, { pid: 3, t: 'Мясник парка', d: '999999 урона' }, { pid: 1, t: 'Ангел-хранитель', d: 'поднял друзей 99 раз' }, { pid: 0, t: 'Любитель ароматов', d: '999 сек в облаке Вити' }, { pid: 2, t: 'Командный игрок', d: '99 комбо' }]; })]],
      ...walkQA() };
  };
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
    for (const hero of ['hasan', 'danil', 'vitya', 'leha', 'ghoul']) for (const [dir, v] of [[0, 'front'], [1, 'side'], [2, 'back']]) {
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
