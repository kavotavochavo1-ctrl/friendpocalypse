// live/net.js — lobby + online co-op over WebRTC (Trystero, serverless signalling) — host-authoritative.
// Host: runs SIM.step with every player's input, sends each client a compressed snapshot of what is near its hero (15 Hz).
// Client: sends its input (30 Hz, presses latched so quick taps are never lost) and renders snapshots interpolated by id.
// Rooms are links: ?room=CODE. Whoever creates the room hosts; up to 8 players; free hero slots can be bots.
(function () {
  const STEAM = !!window.FP_STEAM;
  let connecting = false;
  const LAG = +new URLSearchParams(location.search).get('lag') || 0;        // dev: ?lag=120 adds 120 ms each way on a client (to test prediction)
  const APP = 'friendpocalypse-v1', SNAP_HZ = 20, IN_HZ = 30, TRYSTERO = 'https://cdn.jsdelivr.net/npm/trystero@0.26.0/+esm';
  const HEROES = ['hasan', 'danil', 'vitya', 'leha'], NAMES = { hasan: 'Хасан', danil: 'Данил', vitya: 'Витя', leha: 'Лёха' };
  const DESC = { hasan: 'Усы-хлысты связывают врагов, усатое торнадо. Ближний бой, хрупкий.', danil: 'Карточки, фан-чант (очаровывает), сцена-барьер. Поддержка.',
    vitya: 'Ядовитые облака. Бьёт и своих. Не поднимает друзей.', leha: 'Танк. Пистолет → ПП → дробовик → РПГ. Щит.' };
  const q = new URLSearchParams(location.search);
  const NET = (window.NET = { mode: 'off', hero: localStorage.getItem('fp_hero') || q.get('hero') || 'hasan', bots: true, open: true });
  let room = null, act = {}, selfId = null, roster = [], peerToPid = {}, remote = {}, lastSnap = 0, myPid = 0;
  let evBuf = [], snaps = [], hostGone = false, ackOf = {}, pred = null, hist = [], seq = 0, corr = [0, 0], lastPred = 0, camL = null, camV = [0, 0], camT = 0; NET.dbg = { sent: 0, got: 0, bytes: 0, err: '' };

  // ---------------- compression (deflate-raw via CompressionStream) ----------------
  const pack = async (obj) => new Uint8Array(await new Response(new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const unpack = async (u8) => JSON.parse(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text());

  // ---------------- snapshot: what one client needs to draw and hear its part of the park ----------------
  const ET = Object.keys(SIM.ETYPES), r1 = (v) => Math.round(v), r2 = (v) => Math.round(v * 100) / 100;
  const HN = ['hasan', 'danil', 'vitya', 'leha'];
  const PF = ['id', 'hero', 'bot', 'x', 'y', 'vx', 'vy', 'fx', 'fy', 'ax', 'ay', 'dir', 'dist', 'hp', 'hpMax', 'down', 'downT', 'revP', 'out', 'inv', 'hurtT',
    'qa', 'qT', 'qCD', 'ult', 'ultT', 'tier', 'lastAtk', 'buffT', 'selfRes', 'ack', 'evo', 'nick', 'petN', 'sigEvo', 'rerolls', 'inBus', 'nat', 'rootT', 'slowT', 'crisisT', 'shells', 'gun', 'shop', 'nadeT'];
  // enemies go as two kinds of rows: FAST (every snapshot: id, x, y, vx, vy, hp, dist, hitT, face) and SLOW (type, hpMax and the effect timers —
  // sent only when they change for this friend, or every SLOW_EVERY snapshots as a resync). A crowd costs ~7 numbers per enemy, not 20.
  const EF = 9, SLOW_EVERY = 40, SF = 11;
  const slowRow = (e) => [ET.indexOf(e.type) + (e.elite ? 100 : 0), r1(e.hpMax), r2(e.spawnT), r2(e.biteT || -9), r2(e.charmT || -9), r2(e.burnT || -9),
    r2(e.freezeT || -9), e.chg || 0, r2(e.cdx || 0), r2(e.howlT || -99), r2(e.rootT || -9)];
  const slowSent = {};                                                      // host: per friend, the slow row last sent for each enemy id (per run)
  const evSince = {};
  function snapshot(S, pid) {
    // only what this friend's screen can show (view 1920×1080 around his camera centre, plus a margin for things walking in)
    const p = S.players.find((o) => o.id === pid) || S.players[0], R = 880, nearP = (x, y, r = R) => Math.abs(x - p.x) < r * 1.55 && Math.abs(y - p.y - 60) < r;
    // players as flat number rows (only what drawing, HUD, audio and prediction read); own row also carries cam + upgrade pick
    const players = S.players.map((o) => { const row = PF.map((k) => { const v = o[k]; return typeof v === 'number' ? (Number.isInteger(v) ? v : r2(v)) : v; });
      row[PF.indexOf('hero')] = HN.indexOf(o.hero); row[PF.indexOf('ack')] = ackOf[o.id] || 0;
      return [row, [r2(o.m.area), r2(o.m.cd), r2(o.m.shield), r2(o.m.spd)], o.album, o.id === pid ? o.pick : 0, o.id === pid ? o.cam.map(r1) : 0, o.id === pid ? o.items : 0, o.id === pid ? o.fused : 0, o.id === pid ? o.gifts : 0, o.id === pid ? o.att : 0]; });
    let cache = slowSent[pid]; if (!cache || cache.S !== S) cache = slowSent[pid] = { S, m: new Map(), n: 0 };
    const full = STEAM || cache.n++ % SLOW_EVERY === 0, E = [], ES2 = [];
    for (const e of S.enemies) { if (!nearP(e.x, e.y)) continue; E.push(e.id, r1(e.x), r1(e.y), r1(e.vx), r1(e.vy), r1(e.hp), r1(e.dist % 10000), r2(e.hitT), e.face);
      const sr = slowRow(e), key = sr.join(','); if (full || cache.m.get(e.id) !== key) { cache.m.set(e.id, key); ES2.push(e.id, ...sr); } }
    if (cache.m.size > 600) for (const id of cache.m.keys()) { if (!S.enemies.some((e) => e.id === id)) cache.m.delete(id); }
    const G = []; for (const g of S.gems) if (nearP(g.x, g.y, 1200)) G.push(g.id, r1(g.x), r1(g.y), g.v);
    const B = S.proj.filter((b) => nearP(b.x, b.y)).map((b) => [b.id, b.kind, r1(b.x), r1(b.y), r1(b.vx), r1(b.vy), b.c || 0, b.tox || 0, r2(b.ttl), r2(b.ttl0 || 0), (b.mods && b.mods.burn ? 1 : 0) | (b.mods && b.mods.shock ? 2 : 0), b.own]);
    const EB = S.eproj.filter((b) => nearP(b.x, b.y)).map((b) => [r1(b.x), r1(b.y), r2(b.ttl), b.lob ? r2(b.ttl0) : 0, b.kind || 0, r1(b.vx), r1(b.vy)]);
    const since = evSince[pid] ?? -1;                                       // only events this friend has not been sent yet
    const ev = S.ev.filter((e) => e.t > since && (e.x === undefined || nearP(e.x, e.y, 2000) || e.k === 'say' || e.k === 'bark'));
    const enemyDots = S.enemies.length > 0 ? S.enemies.filter((e, i) => i % 3 === 0).map((e) => [r1(e.x / 8), r1(e.y / 8)]) : [];
    return { t: S.t, wave: S.wave, waveT: r2(S.waveT), brk: r2(S.brk), xp: S.xp, lvl: S.lvl, xpNext: S.xpNext, kills: S.kills, over: S.over, won: S.won,
      awards: S.awards, comboT: S.comboT, solo: S.solo, kettleBy: S.kettleBy, players, E, ES: ES2, G, B, EB, clouds: S.clouds, zones: S.zones, marks: S.marks, ev, dots: enemyDots,
      pause: S.pause, pend: S.pend, clear: S.clear, clearT: r2(S.clearT), left: S.enemies.length,
      cards: S.cards, dealer: S.dealer, boss: S.boss && Object.assign({}, S.boss, { hits: 0, said: 0 }), cut: S.cut, traps: S.traps, bossWave: S.bossWave,
      map: S.map, bus: S.bus, endless: S.endless, home: S.home, score: S.score, drinks: S.drinks, kioskNext: S.kioskNext, spor: S.spor, daily: S.daily,
      chests: S.chests.map((c) => ({ id: c.id, x: r1(c.x), y: r1(c.y) })), food: S.food.filter((f) => nearP(f.x, f.y)).map((f) => ({ id: f.id, x: r1(f.x), y: r1(f.y) })) };
  }
  // client: slow enemy rows live here between snapshots (a new run — the clock went back — starts it over)
  let slowGot = new Map(), slowT = -1;
  function restore(n) {
    if (n.t < slowT - 1) slowGot = new Map(); slowT = n.t;
    for (let i = 0; i < n.ES.length; i += SF + 1) { const a = n.ES, old = slowGot.get(a[i]); if (!old || old.sq <= n.sq) slowGot.set(a[i], { sq: n.sq, a: a.slice(i + 1, i + SF + 1) }); }
    const enemies = []; for (let i = 0; i < n.E.length; i += EF) { const a = n.E, sw = slowGot.get(a[i]); if (!sw) continue; const b = sw.a, ty = ET[b[0] % 100];
      enemies.push({ id: a[i], type: ty, elite: b[0] >= 100 ? 1 : 0, x: a[i + 1], y: a[i + 2], vx: a[i + 3], vy: a[i + 4], hp: a[i + 5], hpMax: b[1], dist: a[i + 6], spawnT: b[2], hitT: a[i + 7], biteT: b[3], face: a[i + 8],
        charmT: b[4], burnT: b[5], freezeT: b[6], chg: b[7], cdx: b[8], howlT: b[9], rootT: b[10], r: SIM.ETYPES[ty].r }); }
    const gems = []; for (let i = 0; i < n.G.length; i += 4) gems.push({ id: n.G[i], x: n.G[i + 1], y: n.G[i + 2], v: n.G[i + 3] });
    const proj = n.B.map((b) => ({ id: b[0], kind: b[1], x: b[2], y: b[3], vx: b[4], vy: b[5], c: b[6], tox: b[7], ttl: b[8], ttl0: b[9], mods: b[10] ? { burn: b[10] & 1, shock: b[10] & 2 } : null, own: b[11] }));
    const eproj = n.EB.map((b) => ({ x: b[0], y: b[1], ttl: b[2], lob: b[3] ? 1 : 0, ttl0: b[3], kind: b[4] || null, vx: b[5], vy: b[6] }));
    const players = n.players.map(([row, m, tokens, pick, cam, items, fused, gifts, att]) => { const o = {}; PF.forEach((k, i) => (o[k] = row[i])); o.hero = HN[o.hero];
      o.m = { area: m[0], cd: m[1], shield: m[2], spd: m[3] }; o.album = tokens || []; o.tokens = []; o.pick = pick || null; o.items = items || { sig: 1 }; o.fused = fused || []; o.gifts = gifts || {}; o.att = att || {}; o.cam = cam || [o.x - 960, o.y - 600]; return o; });
    for (const e of n.ev) evBuf.push(e); while (evBuf.length && evBuf[0].t < n.t - 3) evBuf.shift(); if (evBuf.length > 200) evBuf.splice(0, evBuf.length - 200);
    return Object.assign({}, n, { players, enemies, gems, proj, eproj, dots: n.dots, ev: evBuf.slice() });
  }
  // interpolate between the two latest snapshots (one interval behind, so motion is smooth at 15 Hz)
  function view() {
    if (!snaps.length) return null; const now = performance.now(), b = snaps[snaps.length - 1], a = snaps[snaps.length - 2] || b;
    const k = Math.min(1.3, (now - b.at) / Math.max(30, b.at - a.at)), S = Object.assign({}, b.S);
    const lerpL = (A, B, f) => { const m = new Map(A.map((o) => [o.id, o])); return B.map((o) => { const p = m.get(o.id); if (!p) return o;
      return Object.assign({}, o, { x: p.x + (o.x - p.x) * f, y: p.y + (o.y - p.y) * f, cam: o.cam ? [p.cam[0] + (o.cam[0] - p.cam[0]) * f, p.cam[1] + (o.cam[1] - p.cam[1]) * f] : undefined }); }); };
    const f = Math.min(1, k);
    S.players = lerpL(a.S.players, b.S.players, f); S.enemies = lerpL(a.S.enemies, b.S.enemies, f);
    S.t = a.S.t + (b.S.t - a.S.t) * k; S.me = myPid; S.net = 1;
    const mi = S.players.findIndex((o) => o.id === myPid);
    if (mi >= 0 && pred && !S.players[mi].down && !S.players[mi].out) {
      const W = SIM.VIEW.W, H = SIM.VIEW.H, Wd = SIM.WORLD, cl = (v, a0, a1) => Math.max(a0, Math.min(a1, v));
      const tx = cl(pred.x - W / 2 + pred.vx * 0.25, Wd.x0, Wd.x1 - W), ty = cl(pred.y - 60 - H / 2 + pred.vy * 0.2, Wd.y0, Wd.y1 - H);
      // the same spring as the host's camera (sim.js camStep): the hero walks off first and the view follows, never the view first
      if (!camL) { camL = [tx, ty]; camV = [0, 0]; camT = now; } let cdt = Math.min(0.1, (now - camT) / 1000); camT = now;
      while (cdt > 0) { const h = Math.min(SIM.DT, cdt); cdt -= h; for (const k of [0, 1]) { camV[k] += (28 * ((k ? ty : tx) - camL[k]) - 10.5 * camV[k]) * h; camL[k] += camV[k] * h; } }
      S.players[mi] = Object.assign({}, S.players[mi], { x: pred.x, y: pred.y, vx: pred.vx, vy: pred.vy, cam: camL.slice(), dist: pred.dist, dir: pred.dir, fx: pred.fx || 0, fy: pred.fy || 1 }); }
    return S;
  }

  // ---------------- lobby UI: main menu + waiting room ----------------
  // Waiting room: everyone sees who is in the room (nick, hero, connection, ping, ready). The host starts once every friend is ready.
  // The shell is built once per screen; only the dynamic parts are refreshed, so typing a nick or a code never loses focus.
  const css = document.createElement('style'); css.textContent = `
#lobby{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:"Press Start 2P",monospace;color:#f6e7c8;z-index:5;pointer-events:none}
#lobby .box{pointer-events:auto;background:rgba(18,10,14,.9);border:3px solid #8a5a32;border-radius:14px;padding:20px 24px;width:min(880px,94vw);max-height:94vh;overflow:auto;box-shadow:0 10px 40px #000a;box-sizing:border-box}
#lobby h1{margin:0 0 4px;font-size:28px;color:#ffd76a;letter-spacing:2px;text-shadow:0 3px 0 #3a1a10}
#lobby .sub{font-size:12px;opacity:.85;margin-bottom:12px;line-height:1.6}
#lobby .code{color:#ffd76a;font-size:22px;letter-spacing:4px}
#lobby .heroes{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
#lobby .h{background:#22141a;border:3px solid #4a2e22;border-radius:10px;padding:7px;cursor:pointer;text-align:center;transition:transform .1s;position:relative}
#lobby .h:hover{transform:translateY(-3px)} #lobby .h.on{border-color:#ffd76a;background:#3a2218}
#lobby .h img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;image-rendering:pixelated}
#lobby .h b{display:block;font-size:14px;margin-top:4px} #lobby .h small{display:block;font-size:8px;line-height:1.5;opacity:.8;min-height:30px}
#lobby .box.room .h{display:grid;grid-template-columns:56px 1fr;gap:8px;align-items:center;text-align:left;padding:6px}
#lobby .box.room .h img{width:56px;height:56px} #lobby .box.room .h b{margin:0;font-size:12px} #lobby .box.room .h small{display:none} #lobby .box.room .h .who{left:auto;right:6px;top:4px;justify-content:flex-end}
#lobby .h .who{position:absolute;left:6px;right:6px;top:6px;display:flex;flex-wrap:wrap;gap:3px}
#lobby .h .who span{font-size:7px;background:#000c;border-radius:4px;padding:3px 4px;color:#9fe0ff}
#lobby .row{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;align-items:center}
#lobby button{font:inherit;font-size:12px;padding:10px 18px;border-radius:9px;border:2px solid #8a5a32;background:#5a2e1a;color:#ffe9b0;cursor:pointer}
#lobby button:hover{background:#7a3e22} #lobby button.alt{background:#1e3040;border-color:#3e6a8a} #lobby button.alt:hover{background:#28425a}
#lobby button.big{font-size:15px;padding:14px 26px} #lobby button.ok{background:#1f4a22;border-color:#4a9a4e} #lobby button.ok:hover{background:#2a6030}
#lobby button:disabled{opacity:.45;cursor:default;background:#2a2024;border-color:#4a3a34}
#lobby input{font:inherit;font-size:11px;padding:8px;border-radius:8px;border:2px solid #4a2e22;background:#120a0e;color:#f6e7c8;flex:1;min-width:200px}
#lobby .plist{margin-top:14px;display:flex;flex-direction:column;gap:6px}
#lobby .pl{display:grid;grid-template-columns:44px 1fr auto auto;gap:12px;align-items:center;background:#2a1a20;border:2px solid #3a2830;border-radius:10px;padding:6px 10px;font-size:11px}
#lobby .pl.rdy{border-color:#4a9a4e;background:#1d2a1e} #lobby .pl.me{box-shadow:0 0 0 2px #ffd76a55 inset}
#lobby .pl img{width:44px;height:44px;border-radius:6px;image-rendering:pixelated;object-fit:cover}
#lobby .pl .nm b{display:block;font-size:12px;color:#ffe9b0} #lobby .pl .nm i{font-style:normal;font-size:9px;opacity:.75}
#lobby .tag{font-size:8px;padding:4px 6px;border-radius:5px;background:#5a2e1a;color:#ffd76a;margin-left:6px}
#lobby .net{font-size:9px;white-space:nowrap} #lobby .net.g{color:#8fff8f} #lobby .net.y{color:#ffd76a} #lobby .net.r{color:#ff7a6a}
#lobby .st{font-size:10px;white-space:nowrap;min-width:110px;text-align:right} #lobby .st.on{color:#8fff8f} #lobby .st.off{color:#c8b8a0}
#lobby .pl.empty{opacity:.35;border-style:dashed;grid-template-columns:1fr;text-align:center;font-size:9px;padding:12px}
#lobby .status{font-size:11px;margin-top:12px;color:#9fd0ff;line-height:1.7} #lobby .status.warn{color:#ffb070}
#lobby input[type=checkbox]{flex:0 0 auto;min-width:0;width:18px;height:18px;padding:0;accent-color:#ffd76a}
#lobby .note{font-size:9px;line-height:1.7;opacity:.75;margin-top:10px} #lobby label{font-size:11px;cursor:pointer;display:flex;gap:8px;align-items:center}
#netmsg{position:absolute;left:50%;top:14px;transform:translateX(-50%);font:11px "Press Start 2P",monospace;color:#ffe9b0;background:#000a;padding:4px 12px;border-radius:8px;z-index:6;display:none}`;
  document.head.appendChild(css);
  const el = document.createElement('div'); el.id = 'lobby'; document.body.appendChild(el);
  const msg = document.createElement('div'); msg.id = 'netmsg'; document.body.appendChild(msg);
  const say = (s, ms = 2500) => { msg.textContent = s; msg.style.display = 'block'; clearTimeout(say.t); if (ms) say.t = setTimeout(() => (msg.style.display = 'none'), ms); };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const cleanNick = (s) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);
  NET.nick = cleanNick(localStorage.getItem('fp_name')) || 'Игрок' + Math.floor(10 + Math.random() * 89);
  NET.ready = false;
  const hello = () => act.hello && act.hello.send({ hero: NET.hero, nick: NET.nick, ready: NET.ready ? 1 : 0 });
  const me = () => roster.find((r) => r.self);

  let screen = '';
  function render() {
    if (!NET.open) { el.innerHTML = ''; screen = ''; return; }
    const sc = NET.mode === 'off' ? 'menu' : 'room:' + NET.mode;
    if (sc !== screen) { screen = sc; shell(); }
    dyn();
  }
  const heroGrid = () => HEROES.map((h) => `<div class="h ${NET.hero === h ? 'on' : ''}" data-h="${h}"><div class="who">${
    roster.filter((r) => r.hero === h).map((r) => `<span>${esc(r.nick || '?')}</span>`).join('')}</div><img src="assets/portrait_${h}.png"><b>${NAMES[h]}</b><small>${DESC[h]}</small></div>`).join('');
  function shell() {
    const inRoom = NET.mode !== 'off', isHost = NET.mode === 'host';
    const link = STEAM ? NET.code || '' : location.origin + location.pathname + '?room=' + (NET.code || '');
    el.innerHTML = `<div class="box ${inRoom ? 'room' : ''}"><h1>FRIENDPOCALYPSE</h1>
      <div class="sub">${!inRoom ? 'Выбери героя и ник' : isHost ? `Комната <span class="code">${esc(NET.code)}</span> — ты хост. ${STEAM ? 'Отправь код или приглашение Steam.' : 'Кинь друзьям ссылку или код.'}` : `Комната <span class="code">${esc(NET.code)}</span>`}</div>
      ${STEAM ? '<div id="steam-panel"></div>' : ''}
      <div class="row" style="margin-top:0"><label>Ник: <input id="nick" maxlength="12" value="${esc(NET.nick)}" style="min-width:160px;flex:0 1 200px"></label>
        ${isHost ? `<input id="lnk" aria-label="Код комнаты" readonly value="${esc(link)}"><button id="cp" class="alt">${STEAM ? 'Копировать код' : 'Копировать ссылку'}</button>` : ''}</div>
      <div class="heroes" id="heroes" style="margin-top:14px"></div>
      ${inRoom ? `<div class="plist" id="plist"></div><div class="status" id="status"></div>
        <div class="row"><button id="rdy" class="big"></button>${isHost ? `<label><input type="checkbox" id="bots" ${NET.bots ? 'checked' : ''} style="min-width:0;flex:0"> Боты на свободных героях</label><button id="go" class="big ok"></button>` : ''}
          <button id="alm" class="alt">Альманах</button><button id="rec" class="alt">Рекорды</button><button id="opts" class="alt">Настройки</button><button id="leave" class="alt">Выйти</button></div>`
      : `<div class="row"><button id="solo" class="big">Играть (с ботами)</button><button id="soloalone" class="alt">Соло без ботов</button><button id="mk" class="alt">Создать комнату для друзей</button><button id="alm" class="alt">Альманах</button><button id="rec" class="alt">Рекорды</button><button id="opts" class="alt">Настройки</button></div>
        <div class="row"><input id="code" aria-label="Код комнаты от друга" maxlength="${STEAM ? 64 : 5}" placeholder="${STEAM ? 'STEAM-КОД FP-…' : 'КОД КОМНАТЫ ОТ ДРУГА'}" style="text-transform:uppercase;flex:0 1 300px"><button id="join" class="alt">Войти в комнату</button></div>`}
      <div class="row" id="rules"></div>
      <div class="note">WASD — бег · Q — способность · R — ульта · E — ларёк / встать · 1/2/3 — улучшение · M — музыка · F3 — пинг и FPS</div></div>`;
    const $ = (id) => el.querySelector('#' + id);
    $('nick').oninput = (e) => { NET.nick = cleanNick(e.target.value) || NET.nick; localStorage.setItem('fp_name', NET.nick); if (isHost && me()) { me().nick = NET.nick; sendRoster(); dyn(); } else hello(); };
    $('nick').onkeydown = (e) => e.stopPropagation();
    if ($('solo')) $('solo').onclick = () => startLocal(false);
    if ($('soloalone')) $('soloalone').onclick = () => startLocal(true);
    if ($('mk')) $('mk').onclick = () => connectRoom(() => host());
    $('opts').onclick = () => SETTINGS.show(); $('alm').onclick = () => almanac(true); $('rec').onclick = () => records(true);
    if ($('join')) { const go = () => { const c = $('code').value.trim(); if (c.length >= 4) connectRoom(() => client(STEAM ? c : c.toUpperCase())); else say(STEAM ? 'Вставь Steam-код комнаты вида FP-…' : 'Код комнаты — 5 символов'); };
      $('join').onclick = go; $('code').onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') go(); }; }
    if ($('cp')) $('cp').onclick = () => { navigator.clipboard.writeText(link).then(() => say(STEAM ? 'Код скопирован — отправь друзьям' : 'Ссылка скопирована — кидай друзьям')).catch(() => say('Выдели и скопируй код из поля')); };
    if ($('bots')) $('bots').onchange = (e) => { NET.bots = e.target.checked; sendRoster(); };
    if ($('go')) $('go').onclick = () => { if (allReady()) hostStart(); };
    if ($('rdy')) $('rdy').onclick = () => { NET.ready = !NET.ready; if (isHost && me()) { me().ready = NET.ready ? 1 : 0; sendRoster(); } else hello(); dyn(); };
    if ($('leave')) $('leave').onclick = () => { try { room && room.leave(); } catch (e) {} location.href = location.pathname; };
    if (STEAM) SteamUI.mount();
  }
  async function connectRoom(fn) {
    if (connecting) return;
    connecting = true;
    try { await fn(); }
    catch (e) {
      try { await room?.leave(); } catch {} room = null; act = {}; roster = []; peerToPid = {}; remote = {};
      NET.mode = 'off'; NET.hostPeer = null; NET.started = false; NET.open = true; screen = ''; render();
      say(e.message || String(e), 0);
    } finally { connecting = false; }
  }
  const netCls = (r) => r.host ? 'g' : r.ping == null ? 'y' : r.ping < 120 ? 'g' : r.ping < 250 ? 'y' : 'r';
  const netTxt = (r) => r.host ? 'хост' : r.ping == null ? 'подключается…' : r.ping + ' мс';
  const allReady = () => roster.length > 0 && roster.every((r) => r.host || r.ready);
  function dyn() {
    const $ = (id) => el.querySelector('#' + id); if (!$('heroes')) return;
    $('heroes').innerHTML = heroGrid();
    el.querySelectorAll('.h').forEach((d) => (d.onclick = () => { NET.hero = d.dataset.h; localStorage.setItem('fp_hero', NET.hero);
      if (NET.mode === 'host' && me()) { me().hero = NET.hero; sendRoster(); } else hello(); dyn(); }));
    rules(); if (!$('plist')) return;
    const isHost = NET.mode === 'host', connected = NET.mode === 'host' || !!NET.hostPeer;
    $('plist').innerHTML = roster.map((r) => `<div class="pl ${r.ready || r.host ? 'rdy' : ''} ${r.self ? 'me' : ''}"><img src="assets/portrait_${r.hero}.png">
        <div class="nm"><b>${esc(r.nick || 'Игрок')}${r.host ? '<span class="tag">ХОСТ</span>' : ''}${r.self ? '<span class="tag" style="background:#1e3040;color:#9fe0ff">ТЫ</span>' : ''}</b><i>${NAMES[r.hero]}</i></div>
        <div class="net ${netCls(r)}">● ${netTxt(r)}</div><div class="st ${r.ready || r.host ? 'on' : 'off'}">${r.host ? 'запускает' : r.ready ? '✔ ГОТОВ' : 'не готов'}</div></div>`).join('')
      + Array.from({ length: Math.max(0, Math.min(4, 8) - roster.length) }, () => `<div class="pl empty">свободно${NET.bots && isHost ? ' — займёт бот' : ''}</div>`).join('');
    const waiting = roster.filter((r) => !r.host && !r.ready).map((r) => esc(r.nick || 'Игрок'));
    let st = '', warn = false;
    if (!connected) { const s = Math.floor((performance.now() - (NET.joinT || performance.now())) / 1000);
      st = `Ищем хоста… ${s} с`; if (s >= 20) { warn = true; st += '<br>Не получается связаться. Проверь код, хост должен быть в этой комнате. Помогает выключить VPN или зайти с другой сети (мобильный интернет).'; } }
    else if (roster.length <= 1) st = isHost ? `Ждём друзей… Отправь им ${STEAM ? 'код или приглашение Steam' : 'ссылку'}. Можно стартовать и одному с ботами.` : 'Ждём список игроков от хоста…';
    else if (waiting.length) st = `Ждём готовности: ${waiting.join(', ')}`;
    else st = isHost ? 'Все готовы — жми СТАРТ!' : 'Все готовы — ждём, когда хост нажмёт старт';
    $('status').innerHTML = st; $('status').className = 'status' + (warn ? ' warn' : '');
    if ($('rdy')) { $('rdy').style.display = isHost ? 'none' : ''; $('rdy').textContent = NET.ready ? '✔ Готов (отменить)' : 'Я готов!'; $('rdy').className = 'big ' + (NET.ready ? 'ok' : ''); $('rdy').disabled = !connected; }
    if ($('go')) { const ok = allReady(); $('go').disabled = !ok; $('go').textContent = ok ? `СТАРТ (${roster.length} игр.)` : `Ждём готовности (${roster.filter((r) => r.host || r.ready).length}/${roster.length})`; }
  }
  // «Спор» (one optional rule, multiplies the score) and «Забег дня» (today's seed + today's spor, same for everyone)
  NET.spor = localStorage.getItem('fp_spor') || ''; NET.daily = false;
  const dayKey = () => { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
  const daySpor = () => { const k = Object.keys(SIM.SPORS); return k[dayKey() % k.length]; };
  const runCfg = () => NET.daily ? { spor: daySpor(), seed: dayKey(), daily: 1 } : { spor: NET.spor || null, seed: 0, daily: 0 };
  function rules() {
    const box = el.querySelector('#rules'); if (!box) return; const canSet = NET.mode !== 'client', c = runCfg(), sp = c.spor && SIM.SPORS[c.spor];
    if (!canSet) { box.innerHTML = `<div class="status">${NET.daily ? 'Забег дня · ' : ''}Спор: ${sp ? esc(sp.n) + ' — ' + esc(sp.d) + ' (очки ×' + sp.x + ')' : 'без спора'}</div>`; return; }
    if (box.dataset.built) { const i = box.querySelector('#sinfo'); if (i) i.textContent = sp ? `${sp.d} · очки ×${sp.x}` : 'обычный забег'; return; }
    box.dataset.built = 1;
    box.innerHTML = `<label>Спор: <select id="spor" style="font:inherit;font-size:11px;padding:6px;border-radius:8px;background:#120a0e;color:#f6e7c8;border:2px solid #4a2e22">
      <option value="">без спора</option>${Object.entries(SIM.SPORS).map(([k, v]) => `<option value="${k}" ${NET.spor === k ? 'selected' : ''}>${esc(v.n)} ×${v.x}</option>`).join('')}</select></label>
      <label><input type="checkbox" id="daily" ${NET.daily ? 'checked' : ''}> Забег дня</label><span class="note" id="sinfo" style="margin:0"></span>`;
    const $ = (id) => box.querySelector('#' + id);
    $('spor').onchange = (e) => { NET.spor = e.target.value; localStorage.setItem('fp_spor', NET.spor); box.dataset.built = ''; rules(); if (NET.mode === 'host') sendRoster(); };
    $('daily').onchange = (e) => { NET.daily = e.target.checked; $('spor').disabled = NET.daily; rules(); if (NET.mode === 'host') sendRoster(); };
    $('spor').disabled = NET.daily; rules(); }
  setInterval(() => { if (NET.open && NET.mode !== 'off') dyn(); }, 1000);                 // timers and pings tick in the room
  const startLocal = (alone) => { if (!window.GAME) { setTimeout(() => startLocal(alone), 50); return; } NET.open = false; render(); window.GAME.start(Object.assign({ hero: NET.hero, solo: alone }, runCfg())); };

  // ---------------- meta between runs: the almanac of recipes found + unlocked weapons (localStorage) ----------------
  NET.meta = () => { try { const m = JSON.parse(localStorage.getItem('fp_meta') || '{}'); return { found: m.found || [], unlock: m.unlock || {} }; } catch (e) { return { found: [], unlock: {} }; } };
  const saveMeta = (m) => { try { localStorage.setItem('fp_meta', JSON.stringify(m)); } catch (e) {} };
  const seenEv = new Set();
  setInterval(() => { const S = window.SCENE && SCENE.state; if (!S || !S.ev) return; let m = null;           // record discoveries the moment they happen
    for (const e of S.ev) { if ((e.k === 'win' || e.k === 'lose') && !seenEv.has('end' + S.over)) { seenEv.add('end' + S.over); saveRun(S); }
      if (e.k !== 'discover' && e.k !== 'unlock') continue; const key = e.k + e.id + e.t; if (seenEv.has(key)) continue; seenEv.add(key); m = m || NET.meta();
      if (e.k === 'discover' && !m.found.includes(e.id)) m.found.push(e.id); if (e.k === 'unlock') m.unlock[e.id] = 1; }
    if (m) saveMeta(m); }, 250);
  const almEl = document.createElement('div'); almEl.id = 'almanac'; document.body.appendChild(almEl);
  const acss = document.createElement('style'); acss.textContent = `
#almanac{position:absolute;inset:0;display:none;align-items:center;justify-content:center;z-index:8;background:#000a;font-family:"Press Start 2P",monospace;color:#f6e7c8}
#almanac .box{background:rgba(18,10,14,.96);border:3px solid #8a5a32;border-radius:14px;padding:18px 22px;width:min(980px,95vw);max-height:92vh;overflow:auto;box-sizing:border-box}
#almanac h2{margin:0 0 6px;color:#ffd76a;font-size:20px} #almanac .sub{font-size:10px;opacity:.8;line-height:1.7;margin-bottom:12px}
#almanac .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px}
#almanac .r{display:grid;grid-template-columns:48px 1fr;gap:10px;align-items:center;background:#2a1a20;border:2px solid #3a2830;border-radius:10px;padding:6px 8px}
#almanac .r.on{border-color:#8a6a32} #almanac img{width:48px;height:48px;image-rendering:pixelated} #almanac .r.off img{filter:brightness(.25)}
#almanac b{font-size:11px;color:#ffe9b0;display:block} #almanac i{font-style:normal;font-size:8px;opacity:.8;line-height:1.6;display:block;margin-top:3px}
#almanac h3{font-size:12px;color:#9fd0ff;margin:14px 0 8px} #almanac button{font:inherit;font-size:12px;padding:10px 18px;border-radius:9px;border:2px solid #3e6a8a;background:#1e3040;color:#ffe9b0;cursor:pointer;margin-top:14px}`;
  document.head.appendChild(acss);
  function almanac(show) { if (!show) { almEl.style.display = 'none'; return; }
    const m = NET.meta(), U = SIM.UPG, R = U.RECIPES, nm = (id, h) => id === 'sig' ? 'оружие ' + (h ? NAMES[h] : 'героя') : (U.WEAPONS[id] || U.PASSIVES[id] || U.HEVO[id]).n;
    const row = (r) => { const on = m.found.includes(r.id); return `<div class="r ${on ? 'on' : 'off'}"><img src="assets/${on ? U.iconOf(r.id, r.hero) : 'ic_unknown'}.png"><div><b>${on ? esc(U.rname(r.id)) : '???'}</b>
      <i>${on ? esc(nm(r.from[0], r.hero)) + ' + ' + esc(nm(r.from[1], r.hero)) + '<br>' + esc(U.rdesc(r.id)) : (r.hero ? NAMES[r.hero] + ' · ' : '') + 'ещё не открыто'}</i></div></div>`; };
    const sec = (t, f) => { const list = R.filter(f); return `<h3>${t} (${list.filter((r) => m.found.includes(r.id)).length}/${list.length})</h3><div class="grid">${list.map(row).join('')}</div>`; };
    const nmI = (id) => (U.WEAPONS[id] || U.PASSIVES[id]).n;
    const lock = (q) => `<div class="r ${m.unlock[q.id] ? 'on' : 'off'}"><img src="assets/${m.unlock[q.id] ? 'it_' + q.r[0] : 'ic_lock'}.png"><div><b>${esc(q.n)}</b><i>${m.unlock[q.id] ? '✔ сделано · ' : 'награда: '}${esc(q.d || q.r.map(nmI).join(', '))}</i></div></div>`;
    almEl.innerHTML = `<div class="box"><h2>АЛЬМАНАХ БАБУШКИНОГО КОТЛА</h2><div class="sub">Котёл падает с золотых элиток. В нём: Деление (+уровни), Сплав (два макс. оружия в один слот) или Эволюция — два предмета 3 ур. по рецепту.
      Рецепты открываются, только когда их сваришь. Найдено ${m.found.length} из ${R.length}.</div>
      <h3>Дела (${SIM.QUESTS.filter((q) => m.unlock[q.id]).length}/${SIM.QUESTS.length})</h3><div class="grid">${SIM.QUESTS.map(lock).join('')}</div>
      ${sec('Эволюции оружия', (r) => r.kind === 'w')}${sec('Оружие героев', (r) => r.kind === 'h')}${sec('Пробуждения героев', (r) => r.kind === 'awake')}${sec('Эволюции пассивок', (r) => r.kind === 'p')}
      <button id="almx">Закрыть</button></div>`;
    almEl.style.display = 'flex'; almEl.querySelector('#almx').onclick = () => almanac(false); }
  addEventListener('keydown', (e) => { if (e.code === 'Escape' && almEl.style.display === 'flex') { almanac(false); e.stopImmediatePropagation(); } }, true);

  // ---------------- records: my best runs (localStorage) + the online board (Supabase REST, optional) ----------------
  // SB: the project URL and its public anon key (safe to ship: the table only allows reading and adding rows, see tools/supabase.sql)
  const SB = { url: 'https://yamuyazqiflzlxkisyln.supabase.co', key: 'sb_publishable_TqfGJS9yDiMT6qxDcMUD_A_JxPo3wXk' }, VER = 'meleuz-1';
  const sizeOf = (n) => n <= 1 ? 'соло' : n === 2 ? 'дуо' : '3–4';
  const loadRec = () => { try { return JSON.parse(localStorage.getItem('fp_rec') || '[]'); } catch (e) { return []; } };
  function saveRun(S) {
    const hum = S.players.filter((p) => !p.bot), mine = S.players.find((p) => p.id === (S.me || 0)) || S.players[0];
    const run = { score: S.score || 0, wave: S.wave, map: S.map || 'park', kills: S.kills, won: S.won ? 1 : 0, home: S.home ? 1 : 0, spor: S.spor || '', daily: S.daily ? dayKey() : 0,
      size: Math.max(1, hum.length), hero: mine.hero, nicks: hum.map((p) => p.nick || NAMES[p.hero]).join(', '), heroes: S.players.map((p) => p.hero).join(','), date: new Date().toISOString().slice(0, 10) };
    const list = loadRec(), best = !list.length || run.score > Math.max(...list.map((r) => r.score));
    list.push(run); list.sort((a, b) => b.score - a.score); try { localStorage.setItem('fp_rec', JSON.stringify(list.slice(0, 50))); } catch (e) {}
    NET.rec = { over: S.over, best: best && run.score > 0 };
    if (SB.url && NET.mode !== 'client' && S.t > 60 && run.score > 0)                                   // one row per team run: the host (or the solo player) sends it
      fetch(SB.url + '/rest/v1/runs', { method: 'POST', headers: { apikey: SB.key, Authorization: 'Bearer ' + SB.key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ nick: run.nicks.slice(0, 60), heroes: run.heroes.slice(0, 60), size: run.size, map: run.map, wave: run.wave, score: run.score, kills: run.kills,
          spor: run.spor || null, daily: run.daily || null, won: !!run.won, ver: VER }) }).catch(() => {});
  }
  const recEl = document.createElement('div'); recEl.id = 'records'; document.body.appendChild(recEl);
  const rcss = document.createElement('style'); rcss.textContent = `
#records{position:absolute;inset:0;display:none;align-items:center;justify-content:center;z-index:8;background:#000a;font-family:"Press Start 2P",monospace;color:#f6e7c8}
#records .box{background:rgba(18,10,14,.96);border:3px solid #8a5a32;border-radius:14px;padding:18px 22px;width:min(980px,95vw);max-height:92vh;overflow:auto;box-sizing:border-box}
#records h2{margin:0 0 10px;color:#ffd76a;font-size:20px} #records .tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
#records button{font:inherit;font-size:10px;padding:8px 12px;border-radius:8px;border:2px solid #3e6a8a;background:#1e3040;color:#ffe9b0;cursor:pointer} #records button.on{background:#5a2e1a;border-color:#ffd76a}
#records table{width:100%;border-collapse:collapse;font-size:10px} #records td,#records th{padding:7px 6px;border-bottom:1px solid #3a2830;text-align:left} #records th{color:#9fd0ff;font-weight:normal}
#records td.s{color:#ffe066;text-align:right} #records .sub{font-size:9px;opacity:.8;line-height:1.7;margin-top:10px}`;
  document.head.appendChild(rcss);
  const TABS = [['mine', 'Мои'], ['all', 'Все'], ['solo', 'Соло'], ['duo', 'Дуо'], ['team', '3–4'], ['day', 'Забег дня']];
  async function records(show, tab = 'mine') {
    if (!show) { recEl.style.display = 'none'; return; }
    const row = (r, i) => `<tr><td>${i + 1}</td><td>${esc(r.nick || r.nicks || '')}</td><td>${esc(SIM.MAPN[r.map] || r.map)} · ${r.wave}</td><td>${r.spor && SIM.SPORS[r.spor] ? esc(SIM.SPORS[r.spor].n) : ''}${r.daily ? ' · дня' : ''}</td><td>${sizeOf(r.size)}</td><td class="s">${Number(r.score).toLocaleString('ru-RU')}</td></tr>`;
    const head = '<tr><th>#</th><th>Кто</th><th>Карта · волна</th><th>Спор</th><th>Отряд</th><th style="text-align:right">Очки</th></tr>';
    let body = '';
    if (tab === 'mine') { const L2 = loadRec(); body = L2.length ? `<table>${head}${L2.slice(0, 20).map(row).join('')}</table>` : '<div class="sub">Пока пусто — сыграй забег!</div>'; }
    else if (!SB.url) body = '<div class="sub">Онлайн-таблица ещё не подключена.</div>';
    else { recEl.innerHTML = `<div class="box"><h2>РЕКОРДЫ</h2><div class="sub">Загружаю…</div></div>`; recEl.style.display = 'flex';
      const f = { all: '', solo: '&size=eq.1', duo: '&size=eq.2', team: '&size=gte.3', day: '&daily=eq.' + dayKey() }[tab];
      try { const r = await fetch(`${SB.url}/rest/v1/runs?select=nick,heroes,size,map,wave,score,spor,daily&order=score.desc&limit=30${f}`, { headers: { apikey: SB.key, Authorization: 'Bearer ' + SB.key } });
        const L2 = await r.json(); body = Array.isArray(L2) && L2.length ? `<table>${head}${L2.map(row).join('')}</table>` : '<div class="sub">Тут ещё никого — будь первым!</div>'; }
      catch (e) { body = '<div class="sub">Не удалось загрузить таблицу — проверь интернет.</div>'; } }
    recEl.innerHTML = `<div class="box"><h2>РЕКОРДЫ</h2><div class="tabs">${TABS.map(([k, n]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${n}</button>`).join('')}</div>${body}
      <div class="sub">Очки = убийства + бонусы за волны и переезд, умноженные на риск (спор, энергетики из ларька). После 20-й волны можно не садиться в автобус домой и копить очки в бесконечной ночи.
      Забег дня: у всех один спор и одно зерно на сегодня (${esc(SIM.SPORS[daySpor()].n)}).</div><button id="recx" style="margin-top:12px">Закрыть</button></div>`;
    recEl.style.display = 'flex'; recEl.querySelector('#recx').onclick = () => records(false);
    recEl.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => records(true, b.dataset.t))); }
  addEventListener('keydown', (e) => { if (e.code === 'Escape' && recEl.style.display === 'flex') { records(false); e.stopImmediatePropagation(); } }, true);

  // ---------------- room ----------------
  // STUN to find a direct path; a public TURN relay as the fallback for friends behind strict NATs / mobile networks
  const RTC = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
    { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' }] };
  async function joinRoomCode(code) {
    say('Подключаюсь к комнате…', 0); NET.code = code; NET.joinT = performance.now(); render();
    if (STEAM) {
      room = await SteamRoom.open(NET.mode === 'host', code); selfId = room.selfId; NET.code = room.code;
    } else {
      let T; try { T = await import(TRYSTERO); } catch (e) { say('Не удалось загрузить сетевой модуль — проверь интернет', 0); throw e; }
      selfId = T.selfId;
      room = T.joinRoom({ appId: APP, rtcConfig: RTC }, 'room-' + code);
    }
    for (const n of ['hello', 'roster', 'start', 'snap', 'input', 'bye', 'ping', 'pong', 'back']) act[n] = room.makeAction(n);
    act.ping.onMessage = (d, { peerId }) => act.pong.send(d, { target: peerId });                     // everyone answers pings
    act.pong.onMessage = (d, { peerId }) => { const rtt = Math.round(performance.now() - d.t); if (NET.mode === 'client') NET.dbg.rtt = rtt;
      const r = roster.find((x) => x.peer === peerId); if (r) r.ping = rtt; };
    room.onPeerJoin = (id) => { if (NET.mode === 'client') hello(); };
    room.onPeerLeave = (id) => { if (NET.mode === 'host') { const r = roster.find((x) => x.peer === id); roster = roster.filter((x) => x.peer !== id); sendRoster(); render();
        const pid = peerToPid[id]; if (pid !== undefined && window.GAME?.state()) { const p = window.GAME.state().players.find((o) => o.id === pid); if (p) p.bot = 1; }
        delete peerToPid[id]; delete remote[pid]; delete inflight[id]; delete snapSq[id]; delete ackSnap[pid]; delete slowSent[pid];
        if (r) say(esc(r.nick || NAMES[r.hero]) + ' вышел' + (NET.started ? ' — его ведёт бот' : '')); }
      else if (NET.mode === 'client' && id === NET.hostPeer) { hostGone = true; NET.hostPeer = null; say('Хост вышел из игры', 0); if (!NET.started) render(); } };
    say('', 1);
    if (STEAM) { screen = ''; render(); }
  }
  // host → everyone: the roster (with the host's measured ping to each friend)
  const sendRoster = () => act.roster && act.roster.send({ bots: NET.bots ? 1 : 0, spor: NET.spor, daily: NET.daily ? 1 : 0, list: roster.map((r) => ({ peer: r.peer, hero: r.hero, nick: r.nick, ready: r.ready ? 1 : 0, host: r.host ? 1 : 0, ping: r.ping })) });
  async function host() {
    NET.code = Math.random().toString(36).slice(2, 7).toUpperCase(); NET.mode = 'host'; NET.ready = true;
    if (!STEAM) history.replaceState(null, '', '?room=' + NET.code + '&host=1');
    await joinRoomCode(NET.code);
    roster = [{ peer: selfId, hero: NET.hero, nick: NET.nick, host: 1, ready: 1, self: 1 }];
    act.hello.onMessage = (d, { peerId }) => { let r = roster.find((x) => x.peer === peerId); const fresh = !r;
      if (!r) { if (roster.length >= 8) return; roster.push((r = { peer: peerId })); }
      r.hero = HEROES.includes(d.hero) ? d.hero : 'hasan'; r.nick = cleanNick(d.nick) || 'Игрок'; r.ready = d.ready ? 1 : 0;
      if (fresh) { say(r.nick + ' зашёл в комнату'); act.ping.send({ t: performance.now() }, { target: peerId }); }
      sendRoster(); render();
      if (window.GAME.state() && NET.started && fresh) lateJoin(peerId, r); };
    act.input.onMessage = (d, { peerId }) => { const pid = peerToPid[peerId]; if (pid === undefined) return; const prev = remote[pid] || {}; if (d.ss) ackSnap[pid] = Math.max(ackSnap[pid] || 0, d.ss); remote[pid] = Object.assign(d, { slot: d.slot || prev.slot || 0 }); };
    setInterval(() => { if (NET.mode !== 'host' || NET.started) return; for (const r of roster) if (!r.self) act.ping.send({ t: performance.now() }, { target: r.peer }); sendRoster(); }, 1000);
    render();
  }
  function hostStart() {
    if (!window.GAME) { setTimeout(hostStart, 50); return; }
    const heroes = roster.map((r) => r.hero), humans = roster.map((_, i) => i);
    if (NET.bots) for (const h of HEROES) if (!heroes.includes(h) && heroes.length < 8) heroes.push(h);
    const S = SIM.create(Object.assign({ heroes, humans, meta: NET.meta() }, runCfg())); S.solo = roster.length === 1 && heroes.length === 1 ? 1 : 0; S.me = 0; S.wt0 = 0;
    roster.forEach((r, i) => { peerToPid[r.peer] = i; S.players[i].nick = r.nick; });
    NET.started = true; NET.open = false; render();
    window.GAME.set(S);
    roster.forEach((r, i) => { if (!r.self) act.start.send({ pid: i }, { target: r.peer }); });
  }
  function lateJoin(peerId, r) {           // a friend who opens the link mid-run takes a bot's hero, or joins as a new hero
    const S = window.GAME.state(); let p = S.players.find((o) => o.bot && o.hero === r.hero && !Object.values(peerToPid).includes(o.id)) || S.players.find((o) => o.bot && !Object.values(peerToPid).includes(o.id));
    if (!p && S.players.length < 8) { const base = S.players[0]; const np = JSON.parse(JSON.stringify(SIM.create({ heroes: [r.hero] }).players[0])); np.id = S.players.length; np.x = base.x + 60; np.y = base.y; S.players.push(np); p = np; }
    if (!p) return; p.bot = 0; p.nick = r.nick; peerToPid[peerId] = p.id; act.start.send({ pid: p.id }, { target: peerId }); say(esc(r.nick) + ' в игре!');
  }
  async function client(code) {
    NET.mode = 'client'; NET.ready = false; await joinRoomCode(code);
    act.roster.onMessage = (d, { peerId }) => { NET.hostPeer = peerId; hostGone = false; NET.bots = !!d.bots; NET.spor = d.spor || ''; NET.daily = !!d.daily;
      roster = d.list.map((r) => Object.assign(r, { self: r.peer === selfId })); render(); };
    act.start.onMessage = (d, { peerId }) => { NET.hostPeer = peerId; myPid = d.pid; NET.started = true; NET.open = false; render(); snaps = []; document.getElementById('hint').style.opacity = 0; };
    act.back.onMessage = () => { NET.started = false; NET.ready = false; snaps = []; pred = null; SCENE.state = null; NET.open = true; render(); hello(); };   // host went back to the room
    act.snap.onMessage = async (d) => { if (LAG && !d.__lag) { setTimeout(() => act.snap.onMessage(Object.assign(d, { __lag: 1 })), LAG); return; } NET.dbg.got++; NET.dbg.bytes = d.byteLength || d.length || 0; let S; try { const data = await unpack(d instanceof Uint8Array ? d : new Uint8Array(d)); if ((data.sq || 0) <= lastSq) return; S = restore(data); } catch (e) { NET.dbg.err = String(e); return; } lastSq = Math.max(lastSq, S.sq || 0); snaps.push({ at: performance.now(), S }); if (snaps.length > 3) snaps.shift(); reconcile(S); };
    if (STEAM) await room.connect();
    hello();
    render();
  }

  // ---------------- per-frame hooks used by index.html ----------------
  NET.inputs = (local) => { const out = { 0: local }; for (const pid in remote) { out[pid] = Object.assign({}, remote[pid]); ackOf[pid] = remote[pid].seq || 0; remote[pid].slot = 0; } return out; };
  const inflight = {}, snapSq = {}, ackSnap = {};
  NET.hostTick = async (S) => { const now = performance.now(); if (now - lastSnap < 1000 / SNAP_HZ) return; lastSnap = now;
    for (const peer in peerToPid) { if (peer === selfId) continue; const pid = peerToPid[peer];
      // backpressure: at most ~3 snapshots (~150 ms) on the wire per friend (acked through his input messages) — drop, never queue
      if (inflight[peer] || (!STEAM && (snapSq[peer] || 0) - (ackSnap[pid] || 0) > 3)) { NET.dbg.skipped = (NET.dbg.skipped || 0) + 1; continue; }
      inflight[peer] = 1;
      try { const snap = snapshot(S, pid); snap.sq = snapSq[peer] = (snapSq[peer] || 0) + 1; evSince[pid] = S.t; const u8 = await pack(snap); NET.dbg.bytes = u8.length; NET.dbg.sent++;
        Promise.resolve(act.snap.send(u8, { target: peer })).catch(() => {}).finally(() => (inflight[peer] = 0)); } catch (e) { NET.dbg.err = String(e); inflight[peer] = 0; } } };
  let lastIn = 0, latch = {};
  // ---- client: numbered input + local prediction of the own hero (moves at once; the host's answer reconciles it) ----
  let lastSent = '', lastSq = 0;
  NET.clientInput = (inp) => { for (const k of ['q', 'r', 'e']) if (inp[k]) latch[k] = 1; if (inp.slot) latch.slot = inp.slot;
    predict(inp);
    if (!act.input) return;
    const d = { left: inp.left ? 1 : 0, right: inp.right ? 1 : 0, up: inp.up ? 1 : 0, down: inp.down ? 1 : 0 };
    for (const k of ['q', 'r', 'e']) d[k] = inp[k] || latch[k] ? 1 : 0; d.slot = latch.slot || 0;
    const key = JSON.stringify(d), now = performance.now();
    if (key === lastSent && now - lastIn < 1000 / IN_HZ) return;                     // unchanged: heartbeat only
    lastIn = now; lastSent = key; latch = {}; d.seq = ++seq; d.ss = lastSq; if (LAG) setTimeout(() => act.input.send(d), LAG); else act.input.send(d);
    if (pred) { hist.push({ seq, x: pred.x, y: pred.y }); if (hist.length > 120) hist.shift(); } };
  const meSnap = () => { const b = snaps[snaps.length - 1]; return b && b.S.players.find((o) => o.id === myPid); };
  function predict(inp) {
    const me = meSnap(), now = performance.now(); if (!me) return;
    // level-up pause: the world (and you) stand still — sit on the host's position, or reconcile re-adds the same offset every snapshot
    const b = snaps[snaps.length - 1]; if (pred && b.S.pause) { pred.x = me.x; pred.y = me.y; pred.vx = pred.vy = 0; corr = [0, 0]; hist = []; lastPred = now; return; }
    if (!pred || me.down || me.out) { pred = { x: me.x, y: me.y, vx: 0, vy: 0, dist: me.dist || 0, dir: me.dir || 0 }; hist = []; corr = [0, 0]; lastPred = now; return; }
    let dt = Math.min(0.1, (now - lastPred) / 1000); lastPred = now;
    const H = SIM.HEROES[me.hero], spd = H.spd * ((me.m && me.m.spd) || 1) * (me.hero === 'leha' ? 1 - 0.04 * (me.tier || 0) : 1);
    const ix = (inp.right ? 1 : 0) - (inp.left ? 1 : 0), iy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0), il = Math.hypot(ix, iy) || 1;
    if (ix || iy) { pred.fx = ix / il; pred.fy = iy / il; pred.dir = Math.abs(iy) > Math.abs(ix) * 1.2 ? (iy > 0 ? 0 : 2) : (ix > 0 ? 1 : 3); }
    while (dt > 0) { const h = Math.min(SIM.DT, dt); dt -= h;
      const acc = 2600 * h; pred.vx += Math.max(-acc, Math.min(acc, ix / il * spd - pred.vx)); pred.vy += Math.max(-acc, Math.min(acc, iy / il * spd - pred.vy));
      const mx = pred.vx, my = pred.vy;
      const ox = pred.x, oy = pred.y; pred.x += mx * h; pred.y += my * h; SIM.collide(pred, 24); pred.dist += Math.hypot(pred.x - ox, pred.y - oy); }
    // ease the reconciliation error in over ~150 ms (a hard snap only when far off)
    const cx = corr[0] * 0.12, cy = corr[1] * 0.12; pred.x += cx; pred.y += cy; corr[0] -= cx; corr[1] -= cy;
  }
  function reconcile(S) {
    const me = S.players.find((o) => o.id === myPid); if (!me || !pred) return;
    const i = hist.findIndex((h) => h.seq === me.ack); if (i < 0) return;
    const ex = me.x - hist[i].x, ey = me.y - hist[i].y; hist = hist.slice(i + 1).map((h) => ({ seq: h.seq, x: h.x + ex, y: h.y + ey }));
    if (Math.hypot(ex, ey) > 260) { pred.x += ex; pred.y += ey; corr = [0, 0]; } else { corr[0] += ex; corr[1] += ey; }
  }
  NET.view = view;
  // round trip check: host snapshot → wire → client restore must give back every visible enemy with the same fields
  NET.debugRoundTrip = async (S, pid) => { const o = snapshot(S, pid); o.sq = 1e9; evSince[pid] = S.t; const r = restore(await unpack(await pack(o))), bad = [];
    for (const c of r.enemies) { const e = S.enemies.find((q) => q.id === c.id);
      for (const k of ['type', 'x', 'y', 'hp', 'hpMax', 'face', 'elite']) if (k === 'x' || k === 'y' || k === 'hp' || k === 'hpMax' ? Math.abs(c[k] - e[k]) > 1 : c[k] !== (e[k] || 0)) bad.push([c.id, k, c[k], e[k]]); }
    return { sent: o.E.length / EF, restored: r.enemies.length, bad: bad.slice(0, 5) }; };
  NET.debugSnap = async (S, pid) => { const o = snapshot(S, pid), j = JSON.stringify(o), u8 = await pack(o); evSince[pid] = S.t;           // size check (devtools / QA): the same as one real send
    const part = {}; for (const k in o) part[k] = JSON.stringify(o[k] ?? 0).length; return { json: j.length, packed: u8.length, part }; };
  // ---- F3: network / performance overlay (what a laggy friend should screenshot) ----
  const ov = document.createElement('div'); ov.style.cssText = 'position:absolute;right:8px;top:8px;z-index:7;font:11px monospace;color:#cfe;background:#000b;padding:6px 9px;border-radius:6px;white-space:pre;display:none';
  document.body.appendChild(ov); let fN = 0, fT = performance.now(), fps = 0, gotPrev = 0, sentPrev = 0, snapHz = 0;
  addEventListener('keydown', (e) => { if (e.code === 'F3') { SETTINGS.set('netinfo', SETTINGS.get('netinfo') ? 0 : 1); e.preventDefault(); } });
  SETTINGS.onChange((V) => (ov.style.display = V.netinfo ? 'block' : 'none'));
  const tickOv = () => { requestAnimationFrame(tickOv); fN++; const now = performance.now();
    if (now - fT >= 1000) { fps = fN; fN = 0; snapHz = NET.mode === 'client' ? NET.dbg.got - gotPrev : NET.dbg.sent - sentPrev; gotPrev = NET.dbg.got; sentPrev = NET.dbg.sent; fT = now;
      if (NET.mode === 'client' && act.ping && NET.hostPeer) act.ping.send({ t: now }, { target: NET.hostPeer }); }
    if (ov.style.display === 'none') return;
    const S = window.SCENE && SCENE.state;
    ov.textContent = `fps ${fps}   ${NET.mode}${NET.code ? ' ' + NET.code : ''}
` + (NET.mode === 'client' ? `ping ${NET.dbg.rtt ?? '?'} ms   snaps ${snapHz}/s
snap ${(NET.dbg.bytes / 1024).toFixed(1)} KB   ~${(snapHz * NET.dbg.bytes / 1024).toFixed(0)} KB/s
pred err ${Math.round(Math.hypot(corr[0], corr[1]))} px` :
      NET.mode === 'host' ? `snaps out ${snapHz}/s to ${Object.keys(peerToPid).length - 1} friend(s)
snap ${(NET.dbg.bytes / 1024).toFixed(1)} KB` : '') + (S ? `
enemies ${S.enemies.length}` : ''); };
  tickOv();
  // back to the room after a run: the host takes everyone with it, friends must press ready again
  NET.openLobby = () => { if (NET.mode === 'client' && !hostGone) return;
    if (NET.mode === 'host') { NET.started = false; for (const r of roster) if (!r.host) r.ready = 0; remote = {}; if (act.back) act.back.send({}); sendRoster(); }
    NET.open = true; render(); };

  const code = q.get('room');
  if (code && q.get('host')) { NET.mode = 'off'; history.replaceState(null, '', location.pathname); }   // a reload ends the old room
  else if (code) connectRoom(() => client(code.toUpperCase()));
  render();
  const whenGame = (f) => (window.GAME ? f() : setTimeout(() => whenGame(f), 50));     // index.html defines GAME after the assets load
  if (STEAM) {
    const accept = code => whenGame(() => connectRoom(async () => {
      if (NET.mode !== 'off' || NET.started) { say('Приглашение получено. Выйди из текущей комнаты и вставь код: ' + code, 0); return; }
      await client(code);
    }));
    FP_STEAM.onEvent(e => { if (e.type === 'invite') accept(e.code); if (e.type === 'error') say(e.message, 0); });
    FP_STEAM.call('pendingInvite').then(code => { if (code) accept(code); });
    FP_STEAM.call('status').then(s => { if (s.available && !localStorage.getItem('fp_name')) { NET.nick = cleanNick(s.name) || NET.nick; screen = ''; render(); } });
  }
  if (q.has('play') && !code) whenGame(() => { startLocal(false); if (q.has('wave')) { const S = window.GAME.state(); S.wave = +q.get('wave'); S.lvl = 2 + S.wave * 2; } });   // ?play[&wave=N]: quick start / tests
})();
