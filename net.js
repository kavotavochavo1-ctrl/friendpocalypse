// live/net.js — lobby + online co-op over WebRTC (Trystero, serverless signalling) — host-authoritative.
// Host: runs SIM.step with every player's input, sends each client a compressed snapshot of what is near its hero (15 Hz).
// Client: sends its input (30 Hz, presses latched so quick taps are never lost) and renders snapshots interpolated by id.
// Rooms are links: ?room=CODE. Whoever creates the room hosts; up to 8 players; free hero slots can be bots.
(function () {
  const APP = 'friendpocalypse-v1', SNAP_HZ = 15, IN_HZ = 30, TRYSTERO = 'https://cdn.jsdelivr.net/npm/trystero@0.26.0/+esm';
  const HEROES = ['hasan', 'danil', 'vitya', 'leha'], NAMES = { hasan: 'Хасан', danil: 'Данил', vitya: 'Витя', leha: 'Лёха' };
  const DESC = { hasan: 'Усы-хлысты, стягивает толпу. Хрупкий.', danil: 'Фотокарточки, метки, баффы. Дальний бой.',
    vitya: 'Ядовитые облака. Бьёт и своих. Не поднимает друзей.', leha: 'Танк. Пистолет → ПП → дробовик → РПГ. Щит.' };
  const q = new URLSearchParams(location.search);
  const NET = (window.NET = { mode: 'off', hero: localStorage.getItem('fp_hero') || q.get('hero') || 'hasan', bots: true, open: true });
  let room = null, act = {}, selfId = null, roster = [], peerToPid = {}, remote = {}, lastSnap = 0, myPid = 0;
  let snaps = [], hostGone = false; NET.dbg = { sent: 0, got: 0, bytes: 0, err: '' };

  // ---------------- compression (deflate-raw via CompressionStream) ----------------
  const pack = async (obj) => new Uint8Array(await new Response(new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const unpack = async (u8) => JSON.parse(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text());

  // ---------------- snapshot: what one client needs to draw and hear its part of the park ----------------
  const ET = Object.keys(SIM.ETYPES), r1 = (v) => Math.round(v), r2 = (v) => Math.round(v * 100) / 100;
  const DROP = ['prev', 'hitSet', 'ups', 'ccd', 'st', 'queue'];
  function snapshot(S, pid) {
    const p = S.players.find((o) => o.id === pid) || S.players[0], R = 1500, nearP = (x, y, r = R) => Math.abs(x - p.x) < r * 1.4 && Math.abs(y - p.y) < r;
    const players = S.players.map((o) => { const c = {}; for (const k in o) if (!DROP.includes(k)) c[k] = o[k]; c.x = r1(c.x); c.y = r1(c.y); c.cam = c.cam.map(r1); return c; });
    const E = []; for (const e of S.enemies) if (nearP(e.x, e.y)) E.push(e.id, ET.indexOf(e.type), r1(e.x), r1(e.y), r1(e.vx), r1(e.vy), r1(e.hp), r1(e.hpMax), r1(e.dist), r2(e.spawnT), r2(e.hitT), r2(e.biteT || -9), e.face);
    const G = []; for (const g of S.gems) if (nearP(g.x, g.y, 1200)) G.push(g.id, r1(g.x), r1(g.y), g.v);
    const B = S.proj.filter((b) => nearP(b.x, b.y)).map((b) => [b.id, b.kind, r1(b.x), r1(b.y), r1(b.vx), r1(b.vy), b.c || 0, b.tox || 0]);
    const EB = S.eproj.filter((b) => nearP(b.x, b.y)).map((b) => [r1(b.x), r1(b.y), r2(b.ttl)]);
    const ev = S.ev.filter((e) => e.x === undefined || nearP(e.x, e.y, 2000) || e.k === 'say');
    const enemyDots = S.enemies.length > 0 ? S.enemies.filter((e, i) => i % 3 === 0).map((e) => [r1(e.x / 8), r1(e.y / 8)]) : [];
    return { t: S.t, wave: S.wave, waveT: r2(S.waveT), brk: r2(S.brk), xp: S.xp, lvl: S.lvl, xpNext: S.xpNext, kills: S.kills, over: S.over, won: S.won,
      awards: S.awards, comboT: S.comboT, solo: S.solo, players, E, G, B, EB, clouds: S.clouds, marks: S.marks, ev, dots: enemyDots };
  }
  function restore(n) {
    const enemies = []; for (let i = 0; i < n.E.length; i += 13) { const a = n.E;
      enemies.push({ id: a[i], type: ET[a[i + 1]], x: a[i + 2], y: a[i + 3], vx: a[i + 4], vy: a[i + 5], hp: a[i + 6], hpMax: a[i + 7], dist: a[i + 8], spawnT: a[i + 9], hitT: a[i + 10], biteT: a[i + 11], face: a[i + 12], r: SIM.ETYPES[ET[a[i + 1]]].r }); }
    const gems = []; for (let i = 0; i < n.G.length; i += 4) gems.push({ id: n.G[i], x: n.G[i + 1], y: n.G[i + 2], v: n.G[i + 3] });
    const proj = n.B.map((b) => ({ id: b[0], kind: b[1], x: b[2], y: b[3], vx: b[4], vy: b[5], c: b[6], tox: b[7] }));
    const eproj = n.EB.map((b) => ({ x: b[0], y: b[1], ttl: b[2] }));
    return Object.assign({}, n, { enemies, gems, proj, eproj, dots: n.dots });
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
      <div class="row">${!inRoom ? `<button id="solo">Играть (с ботами)</button><button id="soloalone" class="alt">Соло без ботов</button><button id="mk" class="alt">Создать комнату для друзей</button>` : ''}
        ${!inRoom ? `</div><div class="row"><input id="code" maxlength="5" placeholder="КОД КОМНАТЫ ОТ ДРУГА" style="text-transform:uppercase;flex:0 1 260px"><button id="join" class="alt">Войти</button>` : ''}
        ${isHost ? `<input id="lnk" readonly value="${link}"><button id="cp" class="alt">Копировать ссылку</button>` : ''}</div>
      ${isHost ? `<div class="row"><label><input type="checkbox" id="bots" ${NET.bots ? 'checked' : ''} style="min-width:0;flex:0"> Боты на свободных героях</label><button id="go">Старт (${roster.length} игр.)</button></div>` : ''}
      <div class="note">WASD — бег · Space — рывок · Q — способность · R — ульта · E — встать/поднять · 1/2/3 — улучшение · M — музыка${inRoom ? '' : ' · Ссылку на комнату отправь друзьям, им ничего не нужно ставить'}</div></div>`;
    el.querySelectorAll('.h').forEach((d) => (d.onclick = () => { NET.hero = d.dataset.h; localStorage.setItem('fp_hero', NET.hero); if (act.hello) act.hello.send({ hero: NET.hero }); if (isHost) { roster.find((r) => r.self).hero = NET.hero; sendRoster(); } render(); }));
    const $ = (id) => el.querySelector('#' + id);
    if ($('solo')) $('solo').onclick = () => startLocal(false);
    if ($('soloalone')) $('soloalone').onclick = () => startLocal(true);
    if ($('mk')) $('mk').onclick = () => host();
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
    for (const n of ['hello', 'roster', 'start', 'snap', 'input', 'bye']) act[n] = room.makeAction(n);
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
    act.input.onMessage = (d, { peerId }) => { const pid = peerToPid[peerId]; if (pid === undefined) return; const prev = remote[pid] || {}; remote[pid] = Object.assign(d, { slot: d.slot || prev.slot || 0 }); };
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
    act.snap.onMessage = async (d) => { NET.dbg.got++; let S; try { S = restore(await unpack(d instanceof Uint8Array ? d : new Uint8Array(d))); } catch (e) { NET.dbg.err = String(e); return; } snaps.push({ at: performance.now(), S }); if (snaps.length > 3) snaps.shift(); };
    act.hello.send({ hero: NET.hero });
    render();
  }

  // ---------------- per-frame hooks used by index.html ----------------
  NET.inputs = (local) => { const out = { 0: local }; for (const pid in remote) { out[pid] = Object.assign({}, remote[pid]); remote[pid].slot = 0; } return out; };
  NET.hostTick = async (S) => { const now = performance.now(); if (now - lastSnap < 1000 / SNAP_HZ) return; lastSnap = now;
    for (const peer in peerToPid) { if (peer === selfId) continue; try { const u8 = await pack(snapshot(S, peerToPid[peer])); NET.dbg.bytes = u8.length; act.snap.send(u8, { target: peer }); NET.dbg.sent++; } catch (e) { NET.dbg.err = String(e); } } };
  let lastIn = 0, latch = {};
  NET.clientInput = (inp) => { for (const k of ['dash', 'jump', 'q', 'r', 'e']) if (inp[k]) latch[k] = 1; if (inp.slot) latch.slot = inp.slot;
    const now = performance.now(); if (now - lastIn < 1000 / IN_HZ || !act.input) return; lastIn = now;
    const d = { left: inp.left ? 1 : 0, right: inp.right ? 1 : 0, up: inp.up ? 1 : 0, down: inp.down ? 1 : 0 };
    for (const k of ['dash', 'jump', 'q', 'r', 'e']) d[k] = inp[k] || latch[k] ? 1 : 0; d.slot = latch.slot || 0; latch = {}; act.input.send(d); };
  NET.view = view;
  NET.openLobby = () => { if (NET.mode === 'client' && !hostGone) return; NET.open = true; render(); };

  const code = q.get('room');
  if (code && q.get('host')) { NET.mode = 'off'; history.replaceState(null, '', location.pathname); }   // a reload ends the old room
  else if (code) client(code.toUpperCase());
  render();
  const whenGame = (f) => (window.GAME ? f() : setTimeout(() => whenGame(f), 50));     // index.html defines GAME after the assets load
  if (q.has('play') && !code) whenGame(() => { startLocal(false); if (q.has('wave')) { const S = window.GAME.state(); S.wave = +q.get('wave'); S.lvl = 2 + S.wave * 2; } });   // ?play[&wave=N]: quick start / tests
})();
