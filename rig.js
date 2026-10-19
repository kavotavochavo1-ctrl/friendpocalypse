// live/rig.js — cut-out rigs (rigcut.py / partrig.py output in window.RIGS) for heroes and ghouls, all three views.
// Pure function of the inputs (no state): gait phase comes from the actor's travelled distance, attacks from event ages.
// Side view: planted feet on explicit foot paths + two-bone IK (animation.md §12, §15.1). Front/back: the swing leg lifts
// toward the camera (shortens), the body drops at double support. Arms swing against the legs; attacks aim at the target.
(function () {
  const L = LIB, M = L.M, TAU = Math.PI * 2;
  const RIG = (window.RIG = {});
  const ang = (v) => Math.atan2(v[1], v[0]);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const SS = (e0, e1, x) => L.SS(e0, e1, x);
  RIG.has = (name) => !!(window.RIGS && RIGS[name] && window.ASSETS[name + '__body']);

  // the measured rest skeleton, cached per rig
  const SK = {};
  const sk = (name) => { if (SK[name]) return SK[name]; const R = RIGS[name], s = { R };
    s.gy = Math.max(R.footL[1], R.footR[1]); s.gx = (R.hipL[0] + R.hipR[0]) / 2;
    s.leg = (R.ankleL ? R.ankleL[1] : R.footL[1]) - R.hipL[1];
    s.l1 = { L: Math.hypot(...sub(R.kneeL, R.hipL)), R: Math.hypot(...sub(R.kneeR, R.hipR)) };
    s.l2 = { L: Math.hypot(...sub(R.ankleL || R.footL, R.kneeL)), R: Math.hypot(...sub(R.ankleR || R.footR, R.kneeR)) };
    // which way each knee folds, from the rest drawing (bent-back legs fold the other way)
    s.fwd = {}; for (const sd of ['L', 'R']) { const h = R['hip' + sd], kn = R['knee' + sd], an = R['ankle' + sd] || R['foot' + sd];
      const cr = (an[0] - h[0]) * (kn[1] - h[1]) - (an[1] - h[1]) * (kn[0] - h[0]); s.fwd[sd] = Math.abs(cr) < 30 ? 1 : cr < 0 ? 1 : -1; }
    return (SK[name] = s); };

  // two-bone IK in the picture plane; the knee folds toward `fwd` (+1 = +x of the drawing)
  const ik = (hip, tgt, l1, l2, fwd) => { let dx = tgt[0] - hip[0], dy = tgt[1] - hip[1], d = Math.hypot(dx, dy);
    const dm = Math.min(d, l1 + l2 - 0.01); if (d > dm) { dx *= dm / d; dy *= dm / d; d = dm; }
    const a = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)))), base = Math.atan2(dy, dx);
    const th = base - fwd * a; const knee = [hip[0] + Math.cos(th) * l1, hip[1] + Math.sin(th) * l1];
    return { knee, ankle: [hip[0] + dx, hip[1] + dy] }; };

  // draw one part: pivot `pv` (rig px, rest), placed at rig-space point `at`, rotated by `rot` (rig space), scaled sy along its axis
  function part(o, pn, pv, at, rot, extra = {}) {
    const tn = o.name + '__' + pn, A = window.ASSETS[tn]; if (!A) return;
    const c = A.crop || [0, 0], sc = A.scale || 1, P = o.P(at);
    const m = M.of(M.t(P[0], P[1]), M.r(rot * o.fl + o.lean), M.s(o.fl * o.k * (extra.sx || 1), o.k * (extra.sy || 1)));
    if (L.sp) { L.sprite(tn, 0, 0, { m, w: A.w / sc, h: A.h / sc, pivot: [pv[0] - c[0] / sc, pv[1] - c[1] / sc], u: extra.dark ? o.uFar : o.u }); return; }
    L.spriteFast(extra.dark ? o.uniFar : o.uni, tn, m, A.w / sc, A.h / sc, [pv[0] - c[0] / sc, pv[1] - c[1] / sc]);
  }
  const far = (u) => Object.assign({}, u, { grade: [u.grade ? u.grade[0] * 0.85 : 0.85, (u.grade ? u.grade[1] : 1) * 0.72, u.grade ? u.grade[2] : 0, 1] });

  // ---------------- the rig ----------------
  // o: { name, x, y (screen ground point), k (px per rig px), fl (±1 mirror), view ('front'|'side'|'back'), ph (gait phase, rad),
  //      amt (0..1 gait), t (world time, idle), id, u (sprite uniforms), aim (screen angle | null), act: { kind, a (0..1), side } , gun }
  RIG.draw = (o) => {
    const idn = typeof o.id === 'number' ? o.id : [...String(o.id || '')].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 997;
    const s = sk(o.name), R = s.R, view = o.view, amt = o.amt || 0, ph = o.ph || 0, k = o.k;
    o.fl = o.fl || 1; o.lean = o.lean || 0; o.uFar = far(o.u || {}); o.uni = L.spriteUni(o.u); o.uniFar = L.spriteUni(o.uFar);
    const act = o.act || null;
    // body motion: bob, sway, breath, attack body language
    let bob = 0, sway = 0, rotB = 0, breath = 1 + 0.012 * Math.sin((o.t || 0) * 2.3 + idn) * (1 - amt);
    if (view === 'side') bob = -amt * s.leg * 0.06 * Math.abs(Math.sin(ph));                 // highest over the stance leg
    else { bob = amt * R.h * 0.022 * (1 - Math.abs(Math.sin(ph))); sway = amt * s.leg * 0.03 * Math.sin(ph); }
    if (act && act.kind === 'fart') { const w = Math.sin(Math.PI * act.a); rotB = (view === 'side' ? 0.22 : 0) * w; bob += s.leg * 0.08 * w; }
    if (act && act.kind === 'bite') rotB += (view === 'side' ? 0.25 : 0) * Math.sin(Math.PI * act.a);
    const root = [s.gx, s.gy];
    const swayAt = (y) => sway * Math.max(0, Math.min(1, (s.gy - y) / Math.max(1, s.gy - R.crotch)));     // the feet stay planted
    o.P = (p) => [o.x + (p[0] - root[0] + swayAt(p[1])) * k * o.fl, o.y + (p[1] - root[1]) * k];
    const J = (n, p) => { if (L.TRACE) L.joint(o.id, n, o.P(p)); };

    // ---- legs ----
    const legs = {}, sideOf = (side) => ph + (side === 'L' ? 0 : Math.PI);
    const cyc = (p) => ((p / TAU) % 1 + 1) % 1;
    // foot path: stance slides back at body speed, swing eases forward with a lift (rig px, along the travel direction)
    const path = (u, S) => { if (u < 0.5) return [S * (0.5 - 2 * u), 0];
      const q = (u - 0.5) * 2, e = q * q * (3 - 2 * q); return [-S * 0.5 + S * e, s.leg * 0.18 * (1 - Math.cos(TAU * q)) / 2]; };
    if (view === 'side') {
      const T = {}; let drop = 0;
      for (const side of ['L', 'R']) { const ankR = R['ankle' + side] || R['foot' + side], [fx, lift] = path(cyc(sideOf(side)), s.leg * 0.85);
        const st = (1 - amt) * s.leg * (side === 'L' ? -0.13 : 0.11);                           // standing: one foot a little forward, one back
        T[side] = [ankR[0] + fx * amt + st, ankR[1] - lift * amt];
        // the hips drop just enough that both feet stay reachable (no clamped IK = no sliding feet)
        // evaluated at this leg's phase AND the other leg's, so the drop is the same every step (no limp with unequal legs)
        for (const oth of [side, side === 'L' ? 'R' : 'L']) { const [gx2, gl2] = path(cyc(sideOf(oth)), s.leg * (o.name.startsWith('ghoul') ? 0.575 : 0.85));
          const tx = ankR[0] + gx2 * amt + st, ty = ankR[1] - gl2 * amt;
          const hx = tx - R['hip' + side][0], hy = ty - (R['hip' + side][1] + bob), Lm = (s.l1[side] + s.l2[side]) * 0.985;
          if (Math.hypot(hx, hy) > Lm) drop = Math.max(drop, hy - Math.sqrt(Math.max(0, Lm * Lm - hx * hx))); } }
      if (!o.name.startsWith('ghoul')) bob += drop;
      for (const side of ['L', 'R']) { const hip = [R['hip' + side][0], R['hip' + side][1] + bob], kneeR = R['knee' + side], ankR = R['ankle' + side] || R['foot' + side], u = cyc(sideOf(side));
        if (o.name.startsWith('ghoul')) {                    // bent-legged ghouls: pendulum legs (their cut shins are too short for a stable IK)
          const [fx, lift] = path(u, s.leg * 0.575), Lr = Math.hypot(...sub(ankR, R['hip' + side])), rt = -Math.asin(Math.max(-0.9, Math.min(0.9, fx * amt / Lr))), rs = 1.2 * lift / s.leg * amt;
          const c = Math.cos(rt), sn = Math.sin(rt), kv = sub(kneeR, R['hip' + side]), knee = [hip[0] + kv[0] * c - kv[1] * sn, hip[1] + kv[0] * sn + kv[1] * c];
          const c2 = Math.cos(rt + rs), s2 = Math.sin(rt + rs), av = sub(ankR, kneeR), ankle = [knee[0] + av[0] * c2 - av[1] * s2, knee[1] + av[0] * s2 + av[1] * c2];
          legs[side] = { hip, knee, ankle, rotT: rt, rotS: rs, rotF: 0, sy: 1, ssy: 1 }; continue; }
        const sol = ik(hip, T[side], s.l1[side], s.l2[side], s.fwd[side]);
        legs[side] = { hip, knee: sol.knee, ankle: sol.ankle, rotT: ang(sub(sol.knee, hip)) - ang(sub(kneeR, R['hip' + side])),
          rotS: ang(sub(sol.ankle, sol.knee)) - ang(sub(ankR, kneeR)), rotF: u >= 0.42 && u < 0.5 ? -0.25 * amt * (u - 0.42) / 0.08 : 0, sy: 1, ssy: 1 }; }
    } else {
      // front / back: the planted foot stays put on screen while the body travels toward / away from the camera;
      // the swing foot lifts and comes through; the leg's picture length follows (screen depth, not limb length)
      const dirY = view === 'front' ? 1 : -1;
      for (const side of ['L', 'R']) { const hip = [R['hip' + side][0], R['hip' + side][1] + bob], kneeR = R['knee' + side], ankR = R['ankle' + side] || R['foot' + side];
        const [fy, lift] = path(cyc(sideOf(side)), s.leg * 0.5), ay = ankR[1] + amt * (fy * dirY - lift);
        const r = (ay - hip[1]) / (ankR[1] - R['hip' + side][1]);
        const knee = [hip[0] + (kneeR[0] - R['hip' + side][0]), hip[1] + (kneeR[1] - R['hip' + side][1]) * r];
        const ankle = [knee[0] + (ankR[0] - kneeR[0]), knee[1] + (ankR[1] - kneeR[1]) * r];
        legs[side] = { hip, knee, ankle, rotT: 0, rotS: 0, rotF: 0, sy: r, ssy: r }; }
    }
    const drawLeg = (side, dark) => { const g = legs[side], u = dark;
      part(o, 'thigh' + side, R['hip' + side], g.hip, g.rotT, { sy: g.sy, dark: u });
      part(o, 'shin' + side, R['knee' + side], g.knee, g.rotT + g.rotS, { sy: g.ssy, dark: u });
      part(o, 'foot' + side, R['ankle' + side] || R['foot' + side], g.ankle, g.rotF, { dark: u });
      J('hip' + side, g.hip); J('knee' + side, g.knee); J('ankle' + side, g.ankle);
      const fr = R['foot' + side], dy = g.ankle[1] - (R['ankle' + side] || fr)[1], dx = g.ankle[0] - (R['ankle' + side] || fr)[0];
      if (R['heel' + side]) { J('heel' + side, [R['heel' + side][0] + dx, R['heel' + side][1] + dy]); J('toe' + side, [R['toe' + side][0] + dx, R['toe' + side][1] + dy]); } };

    // ---- arms ----
    const aimL = o.aim == null ? null : (o.fl > 0 ? o.aim : Math.PI - o.aim);                 // aim in the drawing's own space
    const arms = {};
    for (const side of ['L', 'R']) { if (!R['sh' + side]) continue;
      const sh = [R['sh' + side][0], R['sh' + side][1] + bob], el = R['elbow' + side], hd = R['hand' + side];
      const legP = ph + (side === 'L' ? 0 : Math.PI);
      let a1, a2 = 0;                                                                         // rotations of the upper arm / forearm (rad, clockwise)
      if (view === 'side') { a1 = 0.5 * amt * Math.sin(legP); a2 = -(0.25 + 0.35 * Math.max(0, -Math.sin(legP))) * amt; }
      else { a1 = (side === 'L' ? 1 : -1) * 0.05 * amt * Math.sin(legP) + (side === 'L' ? 0.03 : -0.03) * (1 - amt) * Math.sin((o.t || 0) * 2.3 + idn); a2 = 0; }
      // attacks: the arm on the attack side turns toward the target (screen angle → arm rotation: hanging down = π/2)
      const rest = el ? ang(sub(hd, sh)) : Math.PI / 2;
      if (act && aimL != null) { const toAim = aimL - rest;
        const use = act.kind === 'aim' || act.kind === 'bite' || (act.kind === 'throw' ? side === (view === 'side' ? 'R' : 'R') : act.side ? side === act.side : side === 'R');
        if (use) { const a = act.a;
          if (act.kind === 'throw') { const wind = a < 0.35 ? SS(0, 0.35, a) : 1 - SS(0.35, 0.5, a), hit = SS(0.35, 0.5, a) * (1 - SS(0.6, 1, a));
            a1 = (1 - hit) * (a1 - 2.4 * wind) + hit * toAim; a2 = (1 - hit) * (-1.2 * wind) + hit * 0; }
          else if (act.kind === 'whip') { const w = Math.sin(Math.PI * Math.min(1, a * 1.4)); a1 = a1 * (1 - w) + toAim * w; a2 *= 1 - w; }
          else if (act.kind === 'bite') { const w = Math.sin(Math.PI * a); a1 = a1 * (1 - w) + (toAim + (side === 'L' ? -0.25 : 0.25)) * w; a2 = -0.5 * w; }
          else if (act.kind === 'aim') { const w = act.w == null ? 1 : act.w; a1 = a1 * (1 - w) + toAim * w; a2 = a2 * (1 - w) + (side === 'R' ? 0 : -0.35) * w; } }
        if (act.kind === 'fart' && side === 'L') { const w = Math.sin(Math.PI * act.a); a1 += (view === 'side' ? 1.6 : 0.9) * w; a2 -= 0.8 * w * Math.sin(act.a * 30); }   // waving it away
      }
      if (!el) { arms[side] = { sh, a1, a2, el: null }; continue; }
      const c1 = Math.cos(a1), s1 = Math.sin(a1), ev = sub(el, R['sh' + side]);
      const elbow = [sh[0] + ev[0] * c1 - ev[1] * s1, sh[1] + ev[0] * s1 + ev[1] * c1];
      const c2 = Math.cos(a1 + a2), s2 = Math.sin(a1 + a2), hv = sub(hd, el);
      const hand = [elbow[0] + hv[0] * c2 - hv[1] * s2, elbow[1] + hv[0] * s2 + hv[1] * c2];
      arms[side] = { sh, elbow, hand, a1, a2 };
    }
    const drawArm = (side, dark) => { const g = arms[side]; if (!g) return; const u = dark;
      if (g.elbow) { part(o, 'uarm' + side, R['sh' + side], g.sh, g.a1, { dark: u }); part(o, 'farm' + side, R['elbow' + side], g.elbow, g.a1 + g.a2, { dark: u });
        J('sh' + side, g.sh); J('elbow' + side, g.elbow); J('hand' + side, g.hand); }
      else part(o, 'arm' + side, R['sh' + side], g.sh, g.a1, { dark: u }); };
    const drawGun = () => { if (!o.gun || !arms.R || !arms.R.hand) return; const G = window.ASSETS[o.gun]; if (!G) return;
      const hp = o.P(arms.R.hand), a = (o.aim == null ? (o.fl > 0 ? 0.3 : Math.PI - 0.3) : o.aim), len = o.gunLen, h = len * G.h / G.w, back = Math.cos(a) < 0;
      L.sprite(o.gun, 0, 0, { m: M.of(M.t(hp[0], hp[1]), M.r(back ? a - Math.PI : a), M.s(back ? -1 : 1, 1)), w: len, h, pivot: [len * 0.22, h * 0.6], u: o.u });
      if (L.TRACE) { L.joint(o.id, 'grip', hp); L.joint(o.id, 'tip', [hp[0] + Math.cos(a) * len * 0.78, hp[1] + Math.sin(a) * len * 0.78]); } };
    // body (rotates about the crotch for lean / fart / bite)
    const drawBody = () => { const pv = [s.gx, R.crotch]; part(o, 'body', pv, [pv[0], pv[1] + bob], rotB, { sy: breath }); J('head', [R.head[0], R.head[1] + bob]); J('hip', [s.gx, R.crotch + bob]); };
    J('ground', root);

    // ---- layer by view ----
    if (view === 'side') { drawArm('L', 1); drawLeg('L', 1); drawBody(); drawLeg('R'); drawGun(); drawArm('R'); }
    else if (view === 'back') { if (o.gun) drawGun(); drawLeg('L'); drawLeg('R'); drawArm('L'); drawArm('R'); drawBody(); }
    else { drawLeg('L'); drawLeg('R'); drawBody(); drawArm('L'); drawArm('R'); drawGun(); }
    return { head: o.P([R.head[0], R.head[1] + bob]), hand: arms.R && arms.R.hand ? o.P(arms.R.hand) : null, top: o.P(R.top) };
  };
  // gait phase from distance: one stride (two steps) ≈ 1.7 leg lengths on screen
  // stride per view; crouched, bent-legged walkers (ghouls) take shorter steps
  RIG.stride = (name, k, view) => sk(name).leg * k * (view === 'side' ? (name.startsWith('ghoul') ? 1.15 : 1.7) : 1.0);
  RIG.phase = (name, dist, k, view) => dist / RIG.stride(name, k, view) * TAU;
})();
