// live/net.js — lobby + online co-op over WebRTC (Trystero, serverless signalling) — host-authoritative.
// Host: runs SIM.step with every player's input, sends each client a compressed snapshot of what is near its hero (15 Hz).
// Client: sends its input (30 Hz, presses latched so quick taps are never lost) and renders snapshots interpolated by id.
// Rooms are links: ?room=CODE. Whoever creates the room hosts; up to 8 players; free hero slots can be bots.
(function () {
  const APP = 'friendpocalypse-v1', SNAP_HZ = 30, IN_HZ = 30, TRYSTERO = 'https://cdn.jsdelivr.net/npm/trystero@0.26.0/+esm';
  const HEROES = ['hasan', 'danil', 'vitya', 'leha'], NAMES = { hasan: 'Хасан', danil: 'Данил', vitya: 'Витя', leha: 'Лёха' };
  const DESC = { hasan: 'Усы-хлысты, зацеп, усатое торнадо. Ближний бой, хрупкий.', danil: 'Карточки, фан-чант (очаровывает), сцена-барьер. Поддержка.',
    vitya: 'Ядовитые облака. Бьёт и своих. Не поднимает друзей.', leha: 'Танк. Пистолет → ПП → дробовик → РПГ. Щит.' };
  const q = new URLSearchParams(location.search);
  const NET = (window.NET = { mode: 'off', hero: localStorage.getItem('fp_hero') || q.get('hero') || 'hasan', bots: true, open: true });
  let room = null, act = {}, selfId = null, roster = [], peerToPid = {}, remote = {}, lastSnap = 0, myPid = 0;
  let evBuf = [], snaps = [], hostGone = false, ackOf = {}, pred = null, hist = [], seq = 0, corr = [0, 0], lastPred = 0, camL = null; NET.dbg = { sent: 0, got: 0, bytes: 0, err: '' };

  // ---------------- compression (deflate-raw via CompressionStream) ----------------
  const pack = async (obj) => new Uint8Array(await new Response(new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const unpack = async (u8) => JSON.parse(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text());

  // ---------------- snapshot: what one client needs to draw and hear its part of the park ----------------
  const ET = Object.keys(SIM.ETYPES), r1 = (v) => Math.round(v), r2 = (v) => Math.round(v * 100) / 100;
  const HN = ['hasan', 'danil', 'vitya', 'leha'];
  const PF = ['id', 'hero', 'bot', 'x', 'y', 'vx', 'vy', 'fx', 'fy', 'ax', 'ay', 'dir', 'dist', 'hp', 'hpMax', 'down', 'downT', 'revP', 'out', 'inv', 'hurtT',
    'qa', 'qT', 'qCD', 'ult', 'ultT', 'tier', 'lastAtk', 'buffT', 'selfRes', 'ack', 'evo'];
  const evSince = {};
  function snapshot(S, pid) {
    const p = S.players.find((o) => o.id === pid) || S.players[0], R = 1500, nearP = (x, y, r = R) => Math.abs(x - p.x) < r * 1.4 && Math.abs(y - p.y) < r;
    // players as flat number rows (only what drawing, HUD, audio and prediction read); own row also carries cam + upgrade pick
    const players = S.players.map((o) => { const row = PF.map((k) => { const v = o[k]; return typeof v === 'number' ? (Number.isInteger(v) ? v : r2(v)) : v; });
      row[PF.indexOf('hero')] = HN.indexOf(o.hero); row[PF.indexOf('ack')] = ackOf[o.id] || 0;
      return [row, [r2(o.m.area), r2(o.m.cd), r2(o.m.shield), r2(o.m.spd)], o.tokens, o.id === pid ? o.pick : 0, o.id === pid ? o.cam.map(r1) : 0, o.id === pid ? o.items : 0]; });
    const E = []; for (const e of S.enemies) if (nearP(e.x, e.y)) E.push(e.id, ET.indexOf(e.type) + (e.elite ? 10 : 0), r1(e.x), r1(e.y), r1(e.vx), r1(e.vy), r1(e.hp), r1(e.hpMax), r1(e.dist), r2(e.spawnT), r2(e.hitT), r2(e.biteT || -9), e.face, r2(e.charmT || -9));
    const G = []; for (const g of S.gems) if (nearP(g.x, g.y, 1200)) G.push(g.id, r1(g.x), r1(g.y), g.v);
    const B = S.proj.filter((b) => nearP(b.x, b.y)).map((b) => [b.id, b.kind, r1(b.x), r1(b.y), r1(b.vx), r1(b.vy), b.c || 0, b.tox || 0, b.kind === 'can' ? r2(b.ttl) : 0]);
    const EB = S.eproj.filter((b) => nearP(b.x, b.y)).map((b) => [r1(b.x), r1(b.y), r2(b.ttl)]);
    const since = evSince[pid] ?? -1;                                       // only events this friend has not been sent yet
    const ev = S.ev.filter((e) => e.t > since && (e.x === undefined || nearP(e.x, e.y, 2000) || e.k === 'say'));
    const enemyDots = S.enemies.length > 0 ? S.enemies.filter((e, i) => i % 3 === 0).map((e) => [r1(e.x / 8), r1(e.y / 8)]) : [];
    return { t: S.t, wave: S.wave, waveT: r2(S.waveT), brk: r2(S.brk), xp: S.xp, lvl: S.lvl, xpNext: S.xpNext, kills: S.kills, over: S.over, won: S.won,
      awards: S.awards, comboT: S.comboT, solo: S.solo, players, E, G, B, EB, clouds: S.clouds, zones: S.zones, marks: S.marks, ev, dots: enemyDots,
      pause: S.pause, pend: S.pend, clear: S.clear, clearT: r2(S.clearT), left: S.enemies.length,
      chests: S.chests.map((c) => ({ id: c.id, x: r1(c.x), y: r1(c.y) })), food: S.food.filter((f) => nearP(f.x, f.y)).map((f) => ({ id: f.id, x: r1(f.x), y: r1(f.y) })) };
  }
  function restore(n) {
    const enemies = []; for (let i = 0; i < n.E.length; i += 14) { const a = n.E;
      enemies.push({ id: a[i], type: ET[a[i + 1] % 10], elite: a[i + 1] >= 10 ? 1 : 0, x: a[i + 2], y: a[i + 3], vx: a[i + 4], vy: a[i + 5], hp: a[i + 6], hpMax: a[i + 7], dist: a[i + 8], spawnT: a[i + 9], hitT: a[i + 10], biteT: a[i + 11], face: a[i + 12], charmT: a[i + 13], r: SIM.ETYPES[ET[a[i + 1] % 10]].r }); }
    const gems = []; for (let i = 0; i < n.G.length; i += 4) gems.push({ id: n.G[i], x: n.G[i + 1], y: n.G[i + 2], v: n.G[i + 3] });
    const proj = n.B.map((b) => ({ id: b[0], kind: b[1], x: b[2], y: b[3], vx: b[4], vy: b[5], c: b[6], tox: b[7], ttl: b[8] }));
    const eproj = n.EB.map((b) => ({ x: b[0], y: b[1], ttl: b[2] }));
    const players = n.players.map(([row, m, tokens, pick, cam, items]) => { const o = {}; PF.forEach((k, i) => (o[k] = row[i])); o.hero = HN[o.hero];
      o.m = { area: m[0], cd: m[1], shield: m[2], spd: m[3] }; o.tokens = tokens || []; o.pick = pick || null; o.items = items || { sig: 1 }; o.cam = cam || [o.x - 960, o.y - 600]; return o; });
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
      if (!camL) camL = [tx, ty]; camL[0] += (tx - camL[0]) * 0.12; camL[1] += (ty - camL[1]) * 0.12;
      S.players[mi] = Object.assign({}, S.players[mi], { x: pred.x, y: pred.y, vx: pred.vx, vy: pred.vy, cam: camL.slice(), dist: pred.dist, dir: pred.dir, fx: pred.fx || 0, fy: pred.fy || 1 }); }
    return S;
  }

  // ---------------- lobby UI ----------------
  const css = document.createElement('style'); css.textContent = `
#lobby{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:"Press Start 2P",monospace;color:#f6e7c8;z-index:5;pointer-events:none}
#lobby .box{pointer-events:auto;background:rgba(18,10,14,.88);border:3px solid #8a5a32;border-radius:14px;padding:22px 26px;min-width:min(820px,92vw);box-shadow:0 10px 40px #000a}
#lobby h1{margin:0 0 4px;font-size:30px;color:#ffd76a;letter-spacing:2px;text-shadow:0 3px 0 #3a1a10}
#lobby .sub{font-size:12px;opacity:.8;margin-bottom:16px}
#lobby .heroes{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
#lobby .h{background:#22141a;border:3px solid #4a2e22;border-radius:10px;padding:8px;cursor:pointer;text-align:center;transition:transform .1s}
#lobby .h:hover{transform:translateY(-3px)} #lobby .h.on{border-color:#ffd76a;background:#3a2218}
#lobby .h img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;image-rendering:pixelated}
#lobby .h b{display:block;font-size:15px;margin-top:4px} #lobby .h small{display:block;font-size:9px;line-height:1.5;opacity:.8;min-height:34px}
#lobby .row{display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;align-items:center}
#lobby button{font:inherit;font-size:12px;padding:10px 18px;border-radius:9px;border:2px solid #8a5a32;background:#5a2e1a;color:#ffe9b0;cursor:pointer}
#lobby button:hover{background:#7a3e22} #lobby button.alt{background:#1e3040;border-color:#3e6a8a}
#lobby input{font:inherit;font-size:11px;padding:8px;border-radius:8px;border:2px solid #4a2e22;background:#120a0e;color:#f6e7c8;flex:1;min-width:240px}
#lobby .peers{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap} #lobby .peer{font-size:11px;background:#2a1a20;border-radius:8px;padding:6px 10px}
#lobby .note{font-size:9px;line-height:1.7;opacity:.75;margin-top:10px} #lobby label{font-size:12px;cursor:pointer}
#netmsg{position:absolute;left:50%;top:14px;transform:translateX(-50%);font:11px "Press Start 2P",monospace;color:#ffe9b0;background:#000a;padding:4px 12px;border-radius:8px;z-index:6;display:none}`;
  document.head.appendChild(css);
  const el = document.createElement('div'); el.id = 'lobby'; document.body.appendChild(el);
  const msg = document.createElement('div'); msg.id = 'netmsg'; document.body.appendChild(msg);
  const say = (s, ms = 2500) => { msg.textContent = s; msg.style.display = 'block'; clearTimeout(say.t); if (ms) say.t = setTimeout(() => (msg.style.display = 'none'), ms); };

  function render() {
    if (!NET.open) { el.innerHTML = ''; return; }
    const inRoom = NET.mode !== 'off', isHost = NET.mode === 'host';
    const link = location.origin + location.pathname + '?room=' + (NET.code || '');
    el.innerHTML = `<div class="box"><h1>FRIENDPOCALYPSE</h1><div class="sub">${inRoom ? (isHost ? 'Ты хост. Код комнаты: <b style="color:#ffd76a;font-size:18px">' + NET.code + '</b> — продиктуй друзьям или кинь ссылку' : 'Комната <b>' + NET.code + '</b>' + (NET.mode === 'client' ? ' — ждём старта от хоста' : '')) : 'Выбери героя'}</div>
      <div class="heroes">${HEROES.map((h) => `<div class="h ${NET.hero === h ? 'on' : ''}" data-h="${h}"><img src="assets/portrait_${h}.png"><b>${NAMES[h]}</b><small>${DESC[h]}</small></div>`).join('')}</div>
      ${inRoom ? `<div class="peers">${roster.map((r) => `<div class="peer">${r.self ? '★ ' : ''}${NAMES[r.hero]}${r.host ? ' (хост)' : ''}</div>`).join('')}</div>` : ''}
      <div class="row">${!inRoom ? `<button id="solo">Играть (с ботами)</button><button id="soloalone" class="alt">Соло без ботов</button><button id="mk" class="alt">Создать комнату для друзей</button>` : ''}<button id="opts" class="alt">Настройки</button>
        ${!inRoom ? `</div><div class="row"><input id="code" maxlength="5" placeholder="КОД КОМНАТЫ ОТ ДРУГА" style="text-transform:uppercase;flex:0 1 260px"><button id="join" class="alt">Войти</button>` : ''}
        ${isHost ? `<input id="lnk" readonly value="${link}"><button id="cp" class="alt">Копировать ссылку</button>` : ''}</div>
      ${isHost ? `<div class="row"><label><input type="checkbox" id="bots" ${NET.bots ? 'checked' : ''} style="min-width:0;flex:0"> Боты на свободных героях</label><button id="go">Старт (${roster.length} игр.)</button></div>` : ''}
      <div class="note">WASD — бег · Q — способность · R — ульта · E — встать/поднять · 1/2/3 — улучшение · M — музыка${inRoom ? '' : ' · Ссылку на комнату отправь друзьям, им ничего не нужно ставить'}</div></div>`;
    el.querySelectorAll('.h').forEach((d) => (d.onclick = () => { NET.hero = d.dataset.h; localStorage.setItem('fp_hero', NET.hero); if (act.hello) act.hello.send({ hero: NET.hero }); if (isHost) { roster.find((r) => r.self).hero = NET.hero; sendRoster(); } render(); }));
    const $ = (id) => el.querySelector('#' + id);
    if ($('solo')) $('solo').onclick = () => startLocal(false);
    if ($('soloalone')) $('soloalone').onclick = () => startLocal(true);
    if ($('mk')) $('mk').onclick = () => host();
    if ($('opts')) $('opts').onclick = () => SETTINGS.show();
    if ($('join')) { const go = () => { const c = $('code').value.trim().toUpperCase(); if (c.length >= 4) client(c); }; $('join').onclick = go; $('code').onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') go(); }; }
    if ($('cp')) $('cp').onclick = () => { navigator.clipboard.writeText(link).then(() => say('Ссылка скопирована — кидай друзьям')); };
    if ($('bots')) $('bots').onchange = (e) => (NET.bots = e.target.checked);
    if ($('go')) $('go').onclick = () => hostStart();
  }
  const startLocal = (alone) => { NET.open = false; render(); window.GAME.start({ hero: NET.hero, solo: alone }); };

  // ---------------- room ----------------
  async function joinRoomCode(code) {
    say('Подключаюсь к комнате…', 0);
    const T = await import(TRYSTERO); selfId = T.selfId; NET.code = code;
    room = T.joinRoom({ appId: APP }, 'room-' + code);
    for (const n of ['hello', 'roster', 'start', 'snap', 'input', 'bye', 'ping', 'pong']) act[n] = room.makeAction(n);
    act.ping.onMessage = (d, { peerId }) => act.pong.send(d, { target: peerId });                     // host answers pings
    act.pong.onMessage = (d) => { NET.dbg.rtt = Math.round(performance.now() - d.t); };
    room.onPeerJoin = (id) => { if (NET.mode === 'host') { say('Игрок подключился'); } else if (NET.mode === 'client') act.hello.send({ hero: NET.hero }, { target: id }); };
    room.onPeerLeave = (id) => { if (NET.mode === 'host') { const r = roster.find((x) => x.peer === id); roster = roster.filter((x) => x.peer !== id); sendRoster(); render();
        const pid = peerToPid[id]; if (pid !== undefined && window.GAME.state()) { const p = window.GAME.state().players.find((o) => o.id === pid); if (p) p.bot = 1; } if (r) say(NAMES[r.hero] + ' вышел — его ведёт бот'); }
      else if (NET.mode === 'client' && id === NET.hostPeer) { hostGone = true; say('Хост вышел из игры', 0); } };
    say('', 1);
  }
  const sendRoster = () => act.roster && act.roster.send(roster.map((r) => ({ peer: r.peer, hero: r.hero, host: r.host })));
  async function host() {
    NET.code = Math.random().toString(36).slice(2, 7).toUpperCase(); NET.mode = 'host';
    history.replaceState(null, '', '?room=' + NET.code + '&host=1');
    await joinRoomCode(NET.code);
    roster = [{ peer: selfId, hero: NET.hero, host: 1, self: 1 }];
    act.hello.onMessage = (d, { peerId }) => { let r = roster.find((x) => x.peer === peerId); if (!r) { if (roster.length >= 8) return; roster.push((r = { peer: peerId, hero: d.hero })); } r.hero = d.hero; sendRoster(); render();
      if (window.GAME.state() && NET.started) lateJoin(peerId, r); };
    act.input.onMessage = (d, { peerId }) => { const pid = peerToPid[peerId]; if (pid === undefined) return; const prev = remote[pid] || {}; if (d.ss) ackSnap[pid] = Math.max(ackSnap[pid] || 0, d.ss); remote[pid] = Object.assign(d, { slot: d.slot || prev.slot || 0 }); };
    render();
  }
  function hostStart() {
    const heroes = roster.map((r) => r.hero), humans = roster.map((_, i) => i);
    if (NET.bots) for (const h of HEROES) if (!heroes.includes(h) && heroes.length < 8) heroes.push(h);
    const S = SIM.create({ heroes, humans }); S.solo = roster.length === 1 && heroes.length === 1 ? 1 : 0; S.me = 0; S.wt0 = 0;
    roster.forEach((r, i) => (peerToPid[r.peer] = i));
    NET.started = true; NET.open = false; render();
    window.GAME.set(S);
    roster.forEach((r, i) => { if (!r.self) act.start.send({ pid: i }, { target: r.peer }); });
  }
  function lateJoin(peerId, r) {           // a friend who opens the link mid-run takes a bot's hero, or joins as a new hero
    const S = window.GAME.state(); let p = S.players.find((o) => o.bot && o.hero === r.hero && !Object.values(peerToPid).includes(o.id)) || S.players.find((o) => o.bot && !Object.values(peerToPid).includes(o.id));
    if (!p && S.players.length < 8) { const base = S.players[0]; const np = JSON.parse(JSON.stringify(SIM.create({ heroes: [r.hero] }).players[0])); np.id = S.players.length; np.x = base.x + 60; np.y = base.y; S.players.push(np); p = np; }
    if (!p) return; p.bot = 0; peerToPid[peerId] = p.id; act.start.send({ pid: p.id }, { target: peerId }); say(NAMES[p.hero] + ' в игре!');
  }
  async function client(code) {
    NET.mode = 'client'; await joinRoomCode(code);
    act.roster.onMessage = (d, { peerId }) => { NET.hostPeer = peerId; roster = d.map((r) => Object.assign(r, { self: r.peer === selfId })); render(); };
    act.start.onMessage = (d, { peerId }) => { NET.hostPeer = peerId; myPid = d.pid; NET.started = true; NET.open = false; render(); snaps = []; document.getElementById('hint').style.opacity = 0; };
    act.snap.onMessage = async (d) => { NET.dbg.got++; NET.dbg.bytes = d.byteLength || d.length || 0; let S; try { S = restore(await unpack(d instanceof Uint8Array ? d : new Uint8Array(d))); } catch (e) { NET.dbg.err = String(e); return; } lastSq = Math.max(lastSq, S.sq || 0); snaps.push({ at: performance.now(), S }); if (snaps.length > 3) snaps.shift(); reconcile(S); };
    act.hello.send({ hero: NET.hero });
    render();
  }

  // ---------------- per-frame hooks used by index.html ----------------
  NET.inputs = (local) => { const out = { 0: local }; for (const pid in remote) { out[pid] = Object.assign({}, remote[pid]); ackOf[pid] = remote[pid].seq || 0; remote[pid].slot = 0; } return out; };
  const inflight = {}, snapSq = {}, ackSnap = {};
  NET.hostTick = async (S) => { const now = performance.now(); if (now - lastSnap < 1000 / SNAP_HZ) return; lastSnap = now;
    for (const peer in peerToPid) { if (peer === selfId) continue; const pid = peerToPid[peer];
      // backpressure: at most ~5 snapshots (~170 ms) on the wire per friend (acked through his input messages) — drop, never queue
      if (inflight[peer] || (snapSq[peer] || 0) - (ackSnap[pid] || 0) > 5) { NET.dbg.skipped = (NET.dbg.skipped || 0) + 1; continue; }
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
    lastIn = now; lastSent = key; latch = {}; d.seq = ++seq; d.ss = lastSq; act.input.send(d);
    if (pred) { hist.push({ seq, x: pred.x, y: pred.y }); if (hist.length > 120) hist.shift(); } };
  const meSnap = () => { const b = snaps[snaps.length - 1]; return b && b.S.players.find((o) => o.id === myPid); };
  function predict(inp) {
    const me = meSnap(), now = performance.now(); if (!me) return;
    const b = snaps[snaps.length - 1]; if (pred && b.S.pause) { pred.vx = pred.vy = 0; lastPred = now; return; }          // level-up pause: the world (and you) stand still
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
  NET.openLobby = () => { if (NET.mode === 'client' && !hostGone) return; NET.open = true; render(); };

  const code = q.get('room');
  if (code && q.get('host')) { NET.mode = 'off'; history.replaceState(null, '', location.pathname); }   // a reload ends the old room
  else if (code) client(code.toUpperCase());
  render();
  const whenGame = (f) => (window.GAME ? f() : setTimeout(() => whenGame(f), 50));     // index.html defines GAME after the assets load
  if (q.has('play') && !code) whenGame(() => { startLocal(false); if (q.has('wave')) { const S = window.GAME.state(); S.wave = +q.get('wave'); S.lvl = 2 + S.wave * 2; } });   // ?play[&wave=N]: quick start / tests
})();
