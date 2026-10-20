  // ---------------- bosses (BOSSES.md): Влад — Король крыс (park, wave 10), Владимир Ильич (Мелеуз, wave 20) ----------------
  // A boss is an enemy (ETYPES boss: 1) driven by bossStep; everything the scene must see lives in S.boss (synced whole).
  // Cut-scenes (S.cut) freeze the world like a level-up pick; lines are ids into root.BLINES (live/blines.js, voiced files).
  const BL = root.BLINES || {};
  const lineDur = (id) => clamp(1.4 + ((BL[id] || ['', ''])[1].length) * 0.06, 2.2, 6.5);
  const CUTS = {
    rk_in: ['rk_in_0', 'rk_in_1', 'rk_in_2', 'rk_in_3', 'rk_in_4'], rk_p2: ['rk_p2_0', 'rk_p2_1'], rk_p3: ['rk_p3_0', 'rk_p3_1', 'rk_p3_2'], rk_end: ['rk_end_0', 'rk_end_1'],
    ln_in: ['ln_in_0', 'ln_in_1', 'ln_in_2', 'ln_in_3', 'ln_in_4'], ln_b: ['ln_b_0', 'ln_b_1', 'ln_b_2', 'ln_b_3', 'ln_b_4'], ln_f: ['ln_f_0', 'ln_f_1', 'ln_f_2'],
    ln_p3: ['ln_p3'], ln_end: ['ln_end'], ln_solo: ['ln_b_0', 'ln_solo'] };
  const startCut = (S, key, fx, fy, then) => {
    const ids = CUTS[key].filter((id) => { const who = (BL[id] || [])[0]; return !HEROES[who] || S.players.some((p) => p.hero === who && !p.out); });
    S.cut = { key, ids, i: 0, t0: S.rt, fx, fy, then: then || null }; };
  const bark = (S, id, x, y) => ev(S, { k: 'bark', id, x, y });
  const heroNear = (S, x, y) => { let b = null, bd = 1e9; for (const p of S.players) if (alive(p)) { const d = dist(p.x, p.y, x, y); if (d < bd) { bd = d; b = p; } } return b; };
  const bossE = (S) => S.boss && S.enemies.find((e) => e.id === S.boss.id);
  function cutStep(S, inps) {
    const c = S.cut; let skip = false;
    for (const p of S.players) { if (p.bot || p.out) continue; const inp = inps[p.id] || {}, v = !!(inp.e || inp.act); if (v && !p.prevCut) skip = true; p.prevCut = v; }
    if (S.rt - c.t0 < lineDur(c.ids[c.i]) && !(skip && S.rt - c.t0 > 0.6)) return;
    c.i++; c.t0 = S.rt; if (c.i < c.ids.length) return;
    S.cut = null; const then = c.then;
    if (then === 'go') { const e = bossE(S); if (e) e.inv = 0; S.boss.next = S.t + 1.5; }
    if (then === 'betray') betray(S);
    if (then === 'end') { S.bossWave = 0; S.clear = 1; S.clearT = 0; S.boss.gone = 1; ev(S, { k: 'clear', n: S.wave }); }
  }
  function startBoss(S) {
    const kind = S.map === 'park' ? 'vlad' : 'lenin', [x, y] = kind === 'vlad' ? [C[0], C[1] - 40] : LV.LENIN, T = ETYPES[kind];
    S.enemies = S.enemies.filter((e) => dist(e.x, e.y, x, y) > 700);
    const e = mkEnemy(S, kind, x, y, T.hp * hpScale(S), { boss: 1, inv: 9e9 }); S.enemies.push(e);
    S.bossWave = 1; S.traps = [];
    S.boss = { kind, id: e.id, ph: 1, atk: null, next: 9e9, lasers: [], rings: [], tiles: null, vuln: 0, hits: [], scared: 0, scareCD: 0, tauntT: S.t + 12, hide: 0, holeCD: 0,
      dash: null, km: null, n: 0, t0: S.t, said: {} };
    ev(S, { k: 'boss', kind, x, y }); startCut(S, kind === 'vlad' ? 'rk_in' : 'ln_in', x, y, 'go');
  }
  function bossDead(S, e) {
    const B = S.boss; B.dead = S.t; B.atk = null; B.lasers = []; B.rings = []; B.tiles = null; B.dx = e.x; B.dy = e.y;
    S.chests.push({ id: S.nid++, x: e.x + 60, y: e.y + 40, t0: S.t });
    for (const o of S.enemies) if (o.run || o.type === 'komissar') o.hp = 0;
    const km = B.km && S.players.find((p) => p.id === B.km.pid); if (km) { km.nat = 0; km.hp = km.hpMax * 0.5; km.inv = S.t + 2; B.km = null; }
    ev(S, { k: 'bossdead', kind: B.kind, x: e.x, y: e.y }); startCut(S, B.kind === 'vlad' ? 'rk_end' : 'ln_end', e.x, e.y, 'end');
  }
  const bossHit = (S, e, dmg) => { const B = S.boss; if (!B || e.id !== B.id) return; B.hits.push([S.t, dmg]); };
  // a rat stampede / ring: plain rats that run straight and vanish (they bite whoever they cross, once)
  const runner = (S, x, y, dx, dy, sp, ttl) => { if (blocked(x, y, 18)) return;
    S.enemies.push(mkEnemy(S, 'sprinter', x, y, ETYPES.sprinter.hp * hpScale(S) * 0.5, { run: [dx * sp, dy * sp], runEnd: S.t + ttl, hitP: [] })); };
  function runStep(S, e, t) {
    e.vx = e.run[0]; e.vy = e.run[1]; e.x += e.vx * DT; e.y += e.vy * DT; e.dist += Math.hypot(e.vx, e.vy) * DT; e.face = e.vx >= 0 ? 1 : -1;
    for (const p of S.players) if (alive(p) && !e.hitP.includes(p.id) && dist(p.x, p.y, e.x, e.y) < e.r + 26) { e.hitP.push(p.id); e.biteT = t; hurtPlayer(S, p, ETYPES.sprinter.dmg * 1.4 * enemyX(S), e); }
    if (t > e.runEnd || e.x < WORLD.x0 || e.x > WORLD.x1 || e.y < WORLD.y0 || e.y > WORLD.y1) e.hp = 0;
  }
  const lobAt = (S, x0, y0, tx, ty, ttl, kind, r, dmg, extra) => { S.eproj.push(Object.assign({ lob: 1, kind, x: x0, y: y0, vx: (tx - x0) / ttl, vy: (ty - 40 - y0) / ttl, ttl, ttl0: ttl, r, dmg }, extra));
    ev(S, { k: 'bwarn', x: tx, y: ty, r, until: S.t + ttl }); };
  const star = (S, x, y, a, sp, kind, dmg) => S.eproj.push({ kind, x, y: y - 40, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.8, ttl: 5, dmg });

  function bossStep(S, e, t) {
    const T = ETYPES[e.type]; if (e.run) return runStep(S, e, t);
    if (e.type === 'komissar') return komStep(S, e, t);
    const B = S.boss; if (!B || B.dead) return;
    e.kx = e.ky = 0; B.hits = B.hits.filter((h) => t - h[0] < 2);
    if (e.inv > t) return;                                                    // waiting for its cut-scene
    if (T.boss && e.type === 'vlad') vladStep(S, e, t, B); else leninStep(S, e, t, B);
    // taunts: whoever is closest gets it (Vlad), Lenin only shouts his attack names
    if (e.type === 'vlad' && t > B.tauntT && !B.hide) { B.tauntT = t + 13 + 6 * h1(S.steps); const p = heroNear(S, e.x, e.y);
      const id = p && h1(S.steps + 3) < 0.55 ? 'rk_t_' + p.hero : 'rk_t_' + Math.floor(h1(S.steps + 5) * 3); bark(S, id, e.x, e.y); B.taunt = t; }
  }

  // ---- Влад ----
  const HOLE_R = [[520, 0], [-520, 0], [0, 400], [0, -400]];
  const holes = () => HOLE_R.map(([dx, dy]) => [C[0] + dx, C[1] + dy]);
  function vladStep(S, e, t, B) {
    const hp = e.hp / e.hpMax;
    if (B.ph === 1 && hp < 0.65) { B.ph = 2; B.atk = null; B.next = t + 2; e.r = 30;                       // the throne falls apart — into rats
      for (let k = 0; k < 10; k++) { const a = k / 10 * TAU; S.enemies.push(mkEnemy(S, 'ghoul', e.x + Math.cos(a) * 90, e.y + Math.sin(a) * 70, ETYPES.ghoul.hp * hpScale(S))); }
      ev(S, { k: 'boom', x: e.x, y: e.y, r: 150, kind: 'throne' }); startCut(S, 'rk_p2', e.x, e.y); return; }
    if (B.ph === 2 && hp < 0.3) { B.ph = 3; B.atk = null; B.next = t + 2.5; e.r = 64; B.hide = 0; e.inv = 0; e.vx = e.vy = 0; startCut(S, 'rk_p3', e.x, e.y); return; }
    const tg = heroNear(S, e.x, e.y); if (!tg) return;
    const d = dist(tg.x, tg.y, e.x, e.y) || 1, ux = (tg.x - e.x) / d, uy = (tg.y - e.y) / d;
    // scared: a burst of damage makes him cower for a second (and dive into a sewer when he can)
    const burst = B.hits.reduce((a, h) => a + h[1], 0);
    if (burst > e.hpMax * 0.06 && t > B.scareCD) { B.scareCD = t + 7; B.scared = t + 1.1; bark(S, 'rk_s_' + Math.floor(h1(S.steps) * 3), e.x, e.y); if (B.ph === 2) B.holeCD = Math.min(B.holeCD, t + 1.2); }
    // the sewer: under the ground he can't be hit; he comes out of the manhole farthest from the team
    if (B.hide) { if (t >= B.hide) { let best = null, bd = -1; for (const h of holes()) { const q = heroNear(S, h[0], h[1]), dd = q ? dist(q.x, q.y, h[0], h[1]) : 0; if (dd > bd) { bd = dd; best = h; } }
        e.x = best[0]; e.y = best[1] + 10; B.hide = 0; e.inv = 0; ev(S, { k: 'hole', x: best[0], y: best[1], out: 1 }); } return; }
    if (B.dash) { e.x += B.dash.vx * DT; e.y += B.dash.vy * DT; collide(e, 24);
      for (const p of S.players) if (alive(p) && !B.dash.hit.includes(p.id) && dist(p.x, p.y, e.x, e.y) < 60) { B.dash.hit.push(p.id); hurtPlayer(S, p, 22 * enemyX(S), e); p.vx += B.dash.vx * 0.5; p.vy += B.dash.vy * 0.5; }
      if (t > B.dash.until) B.dash = null; return; }
    if (t < B.scared) return;
    // movement per phase
    let mx = 0, my = 0, sp = 0;
    if (B.ph === 1) { sp = 55; const want = 320; mx = d > want ? ux : -ux; my = d > want ? uy : -uy; if (Math.abs(d - want) < 40) mx = my = 0; }
    if (B.ph === 2) { sp = 215;
      if (d < 190 && t > B.holeCD) { B.holeCD = t + 9; B.hide = t + 1.3; e.inv = t + 99; ev(S, { k: 'hole', x: e.x, y: e.y }); bark(S, 'rk_hole', e.x, e.y); return; }
      const want = 400; mx = (d > want ? ux : -ux) - uy * 0.6; my = (d > want ? uy : -uy) + ux * 0.6; }
    if (B.ph === 3) {                                                         // the rat-king ball: rolls at you, bounces off the square's edge
      e.vx += ux * 520 * DT; e.vy += uy * 520 * DT; const v = Math.hypot(e.vx, e.vy), vm = 430; if (v > vm) { e.vx *= vm / v; e.vy *= vm / v; }
      const ox = e.x, oy = e.y; e.x += e.vx * DT; e.y += e.vy * DT; e.x = clamp(e.x, C[0] - 1100, C[0] + 1100); e.y = clamp(e.y, C[1] - 760, C[1] + 760); collide(e, 50);
      if (e.x !== ox + e.vx * DT) e.vx *= -0.8; if (e.y !== oy + e.vy * DT) e.vy *= -0.8; e.dist += v * DT;
      for (const p of S.players) if (alive(p) && dist(p.x, p.y, e.x, e.y) < e.r + 30 && t > (p.ballT || 0)) { p.ballT = t + 0.8; hurtPlayer(S, p, 24 * enemyX(S), e); p.vx += e.vx * 1.2; p.vy += e.vy * 1.2; } }
    else if (sp) { const l = Math.hypot(mx, my) || 1; e.vx = mx / l * sp; e.vy = my / l * sp; e.x += e.vx * DT; e.y += e.vy * DT; e.dist += sp * DT * (mx || my ? 1 : 0); collide(e, 24);
      e.x = clamp(e.x, C[0] - 1300, C[0] + 1300); e.y = clamp(e.y, C[1] - 900, C[1] + 900); }
    if (Math.abs(e.vx) > 4) e.face = e.vx > 0 ? 1 : -1;
    // attacks
    if (!B.atk && t >= B.next) { const list = B.ph === 1 ? ['lanes', 'cheese', 'summon'] : B.ph === 2 ? ['dash', 'traps', 'cheese', 'dash'] : ['ring', 'cheese', 'lanes'];
      B.atk = { k: list[B.n++ % list.length], t0: t }; const A = B.atk;
      if (A.k === 'lanes') { const a = Math.atan2(uy, ux) + (h1(S.steps) < 0.5 ? Math.PI / 2 : 0), ax = Math.cos(a), ay = Math.sin(a) * 0.75, al = Math.hypot(ax, ay);
        A.ax = ax / al; A.ay = ay / al; A.cx = tg.x - A.ax * 1050; A.cy = tg.y - A.ay * 1050; A.gaps = [0, 1, 2].map((j) => [(h1(S.steps + j * 7) - 0.5) * 900, (h1(S.steps + j * 7 + 3) - 0.5) * 900]);
        ev(S, { k: 'lanes', x: A.cx, y: A.cy, ax: A.ax, ay: A.ay, gaps: A.gaps, until: t + 1.1 }); if (h1(S.steps + 1) < 0.5) bark(S, 'rk_wave', e.x, e.y); }
      if (A.k === 'cheese') { const up = S.players.filter(alive), n = B.ph === 3 ? 6 : 4;
        for (let k = 0; k < n; k++) { const p = up[k % up.length], ox = (h1(S.steps + k) - 0.5) * 240, oy = (h1(S.steps + k + 9) - 0.5) * 180;
          lobAt(S, e.x, e.y - 120, p.x + p.vx * 0.6 + ox, p.y + p.vy * 0.6 + oy, 1.0 + k * 0.15, 'cheese', 78, 14 * enemyX(S), { slow: 1 }); } }
      if (A.k === 'summon') { for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; const x = e.x + Math.cos(a) * 130, y = e.y + Math.sin(a) * 100; if (!blocked(x, y, 20)) S.enemies.push(mkEnemy(S, 'ghoul', x, y, ETYPES.ghoul.hp * hpScale(S))); }
        ev(S, { k: 'summon', x: e.x, y: e.y }); }
      if (A.k === 'dash') { const L = Math.min(800, d + 250); A.tx = e.x + ux * L; A.ty = e.y + uy * L; ev(S, { k: 'bline', x: e.x, y: e.y, x2: A.tx, y2: A.ty, w: 70, until: t + 0.7 }); }
      if (A.k === 'traps') { if (!B.said.trap) { B.said.trap = 1; bark(S, 'rk_trap', e.x, e.y); }
        S.players.filter(alive).forEach((p, k) => { for (let j = 0; j < 2; j++) { const a = Math.atan2(p.fy, p.fx) + (j - 0.5) * 1.1 + (h1(S.steps + k * 3 + j) - 0.5) * 0.6, r = 140 + 90 * h1(S.steps + k + j * 5);
          const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r * 0.75; if (!blocked(x, y, 20)) S.traps.push({ id: S.nid++, x, y, t0: t, arm: t + 0.5, snap: 0 }); } });
        if (S.traps.length > 14) S.traps.splice(0, S.traps.length - 14); }
      if (A.k === 'ring') { const g0 = Math.floor(h1(S.steps) * 18); for (let k = 0; k < 18; k++) { if ((k - g0 + 18) % 6 < 2) continue; const a = k / 18 * TAU; runner(S, e.x + Math.cos(a) * 70, e.y + Math.sin(a) * 50, Math.cos(a), Math.sin(a) * 0.75, 400, 3.5); }
        ev(S, { k: 'summon', x: e.x, y: e.y }); } }
    const A = B.atk; if (!A) return;
    if (A.k === 'lanes' && t >= A.t0 + 1.1) { const px = -A.ay, py = A.ax;
      for (let row = 0; row < 3; row++) for (let s = -700; s <= 700; s += 78) { if (Math.abs(s - A.gaps[row][0]) < 110 || Math.abs(s - A.gaps[row][1]) < 110) continue;
        runner(S, A.cx + px * s - A.ax * row * 170, A.cy + py * s - A.ay * row * 170, A.ax, A.ay, 520, 4.6); }
      B.atk = null; B.next = t + 3.4; }
    else if (A.k === 'dash' && t >= A.t0 + 0.7) { const dd = dist(A.tx, A.ty, e.x, e.y) || 1; B.dash = { vx: (A.tx - e.x) / dd * 1150, vy: (A.ty - e.y) / dd * 1150, until: t + dd / 1150, hit: [] }; B.atk = null; B.next = t + 2.6; }
    else if (A.k !== 'lanes' && A.k !== 'dash' && t >= A.t0 + 0.8) { B.atk = null; B.next = t + (B.ph === 3 ? 2.6 : 3.2); }
  }

  // ---- Владимир Ильич ----
  const LAS_W = 30;
  const laserHits = (S, B, e, t) => { for (const L of B.lasers) { if (t < L.on) continue; const ca = Math.cos(L.a), sa = Math.sin(L.a);
      for (const p of S.players) { if (!alive(p)) continue; const dx = p.x - e.x, dy = (p.y - e.y) / 0.75, along = dx * ca + dy * sa, perp = Math.abs(-dx * sa + dy * ca);
        if (along > 70 && along < 1700 && perp < LAS_W + 16) hurtPlayer(S, p, 12 * enemyX(S), e); } } };
  function leninStep(S, e, t, B) {
    const hp = e.hp / e.hpMax; e.vx = e.vy = 0; e.x = LV.LENIN[0]; e.y = LV.LENIN[1];
    if (B.ph === 1 && hp < 0.7) { B.ph = 2; B.atk = null; B.lasers = []; B.next = t + 3; leninSides(S, e); return; }
    if (B.ph === 2 && hp < 0.35) { B.ph = 3; B.atk = null; B.lasers = []; B.next = t + 3; B.world = t + 2; B.rev = t + 11; startCut(S, 'ln_p3', e.x, e.y); return; }
    // lasers turn; «Революционный поворот» / «Мировая революция»: they stop, show the new way, and turn back
    for (const L of B.lasers) if (t >= L.on && !(L.hold > t)) L.a += L.spin * DT;
    if (B.world && t >= B.world && !B.lasers.some((L) => L.world)) { const a0 = h1(S.steps) * TAU; B.lasers.push({ a: a0, on: t + 1.2, spin: 0.38, world: 1 }, { a: a0 + Math.PI, on: t + 1.2, spin: 0.38, world: 1 }); bark(S, 'ln_laser', e.x, e.y); }
    if (B.world && t >= B.rev) { B.rev = t + 9; for (const L of B.lasers) if (L.world) { L.hold = t + 0.8; L.spin = -L.spin; } }
    laserHits(S, B, e, t);
    // shock rings from the fist: they roll outward; the gaps are where you stand
    for (const R of B.rings) { const r = (t - R.t0) * R.sp; if (r < 0) continue; for (const p of S.players) { if (!alive(p) || R.hit.includes(p.id)) continue;
        const dx = p.x - e.x, dy = (p.y - e.y) / 0.75, d = Math.hypot(dx, dy); if (Math.abs(d - r) > 30) continue; const a = Math.atan2(dy, dx);
        if (R.gaps.some((g) => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < 0.32)) continue; R.hit.push(p.id); hurtPlayer(S, p, 16 * enemyX(S), e); } }
    B.rings = B.rings.filter((R) => (t - R.t0) * R.sp < 1600);
    // «Красный октябрь»: the paving goes red cell by cell; burning cells hurt, the safe ones move every cycle
    if (B.tiles) { const Tl = B.tiles, a = t - Tl.t0;
      if (a > 2.6) { Tl.n++; Tl.t0 = t; Tl.seed = S.steps; if (Tl.n >= 3) B.tiles = null; }
      else if (a > 1.0) for (const p of S.players) { if (!alive(p)) continue; const cx = Math.floor((p.x - Tl.x0) / Tl.cs), cy = Math.floor((p.y - Tl.y0) / Tl.cs);
        if (cx >= 0 && cy >= 0 && cx < Tl.nx && cy < Tl.ny && hotCell(Tl, cx, cy)) hurtPlayer(S, p, 13 * enemyX(S), e); } }
    // «Пятилетка»: five strikes under the team, each one faster
    const A = B.atk;
    if (A && A.k === 'five') { if (A.i < 5 && t >= A.nextW) { const up = S.players.filter(alive), p = up[A.i % Math.max(1, up.length)];
        if (p) { const dl = [1.0, 0.85, 0.7, 0.55, 0.42][A.i]; A.q.push([p.x + p.vx * 0.3, p.y + p.vy * 0.3, t + dl]); ev(S, { k: 'bwarn', x: p.x + p.vx * 0.3, y: p.y + p.vy * 0.3, r: 115, until: t + dl, red: 1 }); A.nextW = t + dl * 0.75; } A.i++; }
      for (const q of A.q) if (q[2] && t >= q[2]) { q[2] = 0; ev(S, { k: 'boom', x: q[0], y: q[1], r: 115, kind: 'red' }); for (const p of S.players) if (alive(p) && dist(p.x, p.y, q[0], q[1]) < 115) hurtPlayer(S, p, 18 * enemyX(S), e); }
      if (A.i >= 5 && A.q.every((q) => !q[2])) { B.atk = null; B.next = t + 1.8; } return; }
    if (A && A.k === 'coll') { if (t >= A.t0 + 3.2 && !A.hit) { A.hit = 1; B.lasers = B.lasers.filter((L) => !L.coll); const x = e.x + Math.cos(A.a) * 430, y = e.y + Math.sin(A.a) * 430 * 0.75;
        A.sx = x; A.sy = y; ev(S, { k: 'bwarn', x, y, r: 230, until: t + 0.8, red: 1 }); A.boom = t + 0.8; }
      if (A.boom && t >= A.boom) { A.boom = 0; ev(S, { k: 'boom', x: A.sx, y: A.sy, r: 230, kind: 'slam' }); for (const p of S.players) if (alive(p) && dist(p.x, p.y, A.sx, A.sy) < 230) hurtPlayer(S, p, 26 * enemyX(S), e); B.atk = null; B.next = t + 2; }
      return; }
    if (A && A.k === 'fist' && !A.done && t >= A.t0 + 0.9) { A.done = 1; ev(S, { k: 'boom', x: e.x, y: e.y + 60, r: 200, kind: 'slam' });
      for (let j = 0; j < (B.ph === 3 ? 4 : 3); j++) B.rings.push({ t0: t + j * 0.5, sp: 430, gaps: [0, 1, 2].map((k) => h1(S.steps + j * 5 + k) * TAU), hit: [] }); }
    if (A && A.k === 'march' && A.i < 3 && t >= A.t0 + A.i * 0.5) { const g0 = Math.floor(h1(S.steps + A.i) * 24), g1 = (g0 + 12) % 24;
      for (let k = 0; k < 24; k++) { if ((k - g0 + 24) % 24 < 3 || (k - g1 + 24) % 24 < 3) continue; star(S, e.x, e.y, k / 24 * TAU + A.i * 0.13, 290, 'star', 11 * enemyX(S)); } A.i++; }
    if (A && t >= A.end) { B.atk = null; B.next = t + (B.ph === 3 ? 1.6 : 2.2); if (A.k === 'decree') { B.vuln = t + 4; ev(S, { k: 'vuln', x: e.x, y: e.y }); B.next = t + 4.5; } }
    if (!B.atk && t >= B.next) { const list = B.ph === 1 ? ['gaze', 'fist', 'march'] : B.ph === 2 ? ['five', 'gaze', 'coll', 'fist', 'turn', 'march'] : ['oct', 'march', 'fist', 'decree'];
      const k = list[B.n++ % list.length], tg = heroNear(S, e.x, e.y), a0 = tg ? Math.atan2((tg.y - e.y) / 0.75, tg.x - e.x) : 0, N = { t0: t, k };
      B.atk = N;
      if (k === 'gaze' || k === 'turn') { const s = h1(S.steps) < 0.5 ? 0.45 : -0.45; B.lasers = [{ a: a0 - 0.6, on: t + 1.3, spin: s }, { a: a0 + 0.6, on: t + 1.3, spin: s }]; N.end = t + 6;
        if (k === 'turn') N.flip = t + 3.4; if (!B.said.laser) { B.said.laser = 1; bark(S, 'ln_laser', e.x, e.y); } }
      if (k === 'fist') N.end = t + 3.2;
      if (k === 'march') { N.i = 0; N.end = t + 1.8; }
      if (k === 'five') { N.i = 0; N.q = []; N.nextW = t + 0.3; bark(S, 'ln_five', e.x, e.y); }
      if (k === 'coll') { N.a = a0; B.lasers.push({ a: a0 - 1.3, on: t + 0.8, spin: 0.43, coll: 1 }, { a: a0 + 1.3, on: t + 0.8, spin: -0.43, coll: 1 }); bark(S, 'ln_coll', e.x, e.y); }
      if (k === 'oct') { B.tiles = { x0: e.x - 900, y0: e.y - 640, cs: 150, nx: 12, ny: 9, t0: t, n: 0, seed: S.steps }; N.end = t + 7.8; bark(S, 'ln_oct', e.x, e.y); }
      if (k === 'decree') { N.end = t + 4.2; N.i = 0; bark(S, 'ln_decree', e.x, e.y);
        B.rings.push({ t0: t + 0.6, sp: 470, gaps: [a0, a0 + 2.1, a0 + 4.2], hit: [] }, { t0: t + 1.6, sp: 470, gaps: [a0 + 1, a0 + 3.1, a0 + 5.2], hit: [] }); N.k2 = 'march'; } }
    if (B.atk && B.atk.flip && t >= B.atk.flip) { B.atk.flip = 0; for (const L of B.lasers) { L.hold = t + 0.7; L.spin = -L.spin; } }
    if (B.atk && B.atk.k === 'gaze' || B.atk && B.atk.k === 'turn') { if (t >= B.atk.end - 0.1) B.lasers = B.lasers.filter((L) => L.world); }
    if (B.atk && B.atk.k === 'decree' && B.atk.i < 3 && t >= B.atk.t0 + 1 + B.atk.i * 0.6) { const i = B.atk.i++; for (let k = 0; k < 20; k++) { if (k % 5 === i) continue; star(S, e.x, e.y, k / 20 * TAU + i * 0.2, 320, 'star', 11 * enemyX(S)); } }
  }
  const hotCell = (Tl, cx, cy) => { const dx = (cx + 0.5) * Tl.cs + Tl.x0 - LV.LENIN[0], dy = (cy + 0.5) * Tl.cs + Tl.y0 - LV.LENIN[1];
    if (Math.hypot(dx, dy) < 170) return false; return h2(Tl.seed + cx * 17, cy * 31 + Tl.n) < 0.5; };

  // ---- Лёха — «Красный комиссар» ----
  function leninSides(S, e) {
    const L = S.players.find((p) => p.hero === 'leha' && alive(p)); if (!L) return;
    const humans = S.players.filter((p) => !p.bot && !p.out);
    if (!L.bot && humans.length === 1) { startCut(S, 'ln_solo', L.x, L.y); L.crisisT = S.t + 10; return; }      // alone at the keyboard: he stays himself, with a doubt
    startCut(S, 'ln_b', L.x, L.y, 'betray');
  }
  function betray(S) {
    const L = S.players.find((p) => p.hero === 'leha' && alive(p)); if (!L || !S.boss) return;
    const few = S.players.filter((p) => !p.bot && !p.out).length <= 2;
    const e = mkEnemy(S, 'komissar', L.x, L.y, ETYPES.komissar.hp * hpScale(S) * (few ? 0.55 : 1), {}); S.enemies.push(e);
    L.nat = 1; L.vx = L.vy = 0; S.boss.km = { eid: e.id, pid: L.id, mode: 0, until: S.t + (few ? 25 : 45), atk: null, next: S.t + 1.5, aim: 0 };
    ev(S, { k: 'betray', pid: L.id, x: L.x, y: L.y });
  }
  function freeLeha(S, e, beaten) {
    const B = S.boss, K = B && B.km; if (!K) return; const L = S.players.find((p) => p.id === K.pid); e.hp = 0; B.km = null;
    if (!L) return; L.nat = 0; L.x = e.x; L.y = e.y; L.hp = L.hpMax * 0.5; L.inv = S.t + 2; if (!beaten) L.rootT = S.t + 2;
    ev(S, { k: 'freed', pid: L.id, x: L.x, y: L.y }); if (beaten) startCut(S, 'ln_f', L.x, L.y); else bark(S, 'ln_f_0', LV.LENIN[0], LV.LENIN[1]);
  }
  function komStep(S, e, t) {
    const B = S.boss, K = B && B.km; if (!K || K.eid !== e.id) { e.hp = 0; return; }
    if (t >= K.until) return freeLeha(S, e, 0);
    const L = S.players.find((p) => p.id === K.pid); if (L && L.bot && t > (K.botMode || 0)) { K.botMode = t + 10; K.mode = (K.mode + 1) % 3; }
    const tg = heroNear(S, e.x, e.y); if (!tg) return; const d = dist(tg.x, tg.y, e.x, e.y) || 1, ux = (tg.x - e.x) / d, uy = (tg.y - e.y) / d;
    const A = K.atk, still = A && A.k === 'speech';
    if (!still) { let mx = 0, my = 0;
      if (K.mode === 0) { mx = d > 230 ? ux : 0; my = d > 230 ? uy : 0; }
      if (K.mode === 1) { mx = d > 470 ? ux : d < 380 ? -ux : -uy * 0.5; my = d > 470 ? uy : d < 380 ? -uy : ux * 0.5; }
      if (K.mode === 2) { const gx = LV.LENIN[0] + Math.cos(t * 0.6) * 260, gy = LV.LENIN[1] + 80 + Math.sin(t * 0.6) * 190, gd = dist(gx, gy, e.x, e.y) || 1; mx = (gx - e.x) / gd; my = (gy - e.y) / gd; }
      const l = Math.hypot(mx, my); if (l > 0.01) { e.vx = mx / l * 175; e.vy = my / l * 175; } else { e.vx = e.vy = 0; }
      e.x += e.vx * DT; e.y += e.vy * DT; e.dist += Math.hypot(e.vx, e.vy) * DT; collide(e, 22); }
    else { e.vx = e.vy = 0; }
    e.face = tg.x > e.x ? 1 : -1;
    if (!A && t >= K.next) { const opts = K.mode === 0 ? ['burst', 'nades', 'burst'] : K.mode === 1 ? ['burst', 'burst', 'nades'] : ['speech', 'burst', 'nades'];
      const k = opts[Math.floor(h1(S.steps) * 3)]; K.atk = { k, t0: t, i: 0 }; K.aim = Math.atan2(uy, ux) - 0.7 * (h1(S.steps + 1) < 0.5 ? 1 : -1);
      if (k === 'speech') { e.shieldT = t + 2.5; bark(S, 'km_2', e.x, e.y); } else if (h1(S.steps + 2) < 0.4) bark(S, k === 'burst' ? 'km_0' : 'km_1', e.x, e.y); }
    const N = K.atk; if (!N) return;
    if (N.k === 'burst') { const want = Math.atan2(uy, ux), da = Math.atan2(Math.sin(want - K.aim), Math.cos(want - K.aim)); K.aim += clamp(da, -1.3 * DT, 1.3 * DT);
      if (Math.floor((t - N.t0) / 0.09) !== Math.floor((t - N.t0 - DT) / 0.09)) S.eproj.push({ kind: 'kbul', x: e.x + Math.cos(K.aim) * 40, y: e.y - 52, vx: Math.cos(K.aim) * 620, vy: Math.sin(K.aim) * 620, ttl: 1.3, dmg: 5 * enemyX(S) });
      if (t - N.t0 > 1.5) { K.atk = null; K.next = t + 1.6; } }
    else if (N.k === 'nades') { if (N.i < 3 && t >= N.t0 + N.i * 0.35) { const up = S.players.filter(alive), p = up[N.i % up.length];
        lobAt(S, e.x, e.y - 60, p.x + (h1(S.steps) - 0.5) * 160, p.y + (h1(S.steps + 4) - 0.5) * 120, 1.0, 'nade', 90, 16 * enemyX(S)); N.i++; }
      if (t - N.t0 > 1.6) { K.atk = null; K.next = t + 1.6; } }
    else if (N.k === 'speech' && t - N.t0 > 2.5) { K.atk = null; K.next = t + 1.2; }
  }
