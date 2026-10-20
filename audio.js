// live/audio.js — sound from the sim event bus (S.ev): music by game phase, voice lines ('say' events, Gemini TTS files
// listed in audio/vo.js), and procedural SFX (WebAudio synth: whips, cards, guns, booms, farts…). No state in the scene:
// this module keeps its own cursor over event times and resets when the run restarts.
(function () {
  if (window.__STATIC_RENDER__ || new URLSearchParams(location.search).has('render')) return;
  let ctx = null, master, musicBus, sfxBus, voBus, noiseBuf, lastT = -1, lastRun = null, music = { name: null, src: null, gain: null };
  const buffers = {}, loading = {};
  const VO = new Set(window.VO || []);
  const MUSIC_LONG = new Set(window.MUSIC_LONG || []);   // full-length versions listed in audio/vo.js when they exist
  const vol = { master: 0.9, music: 0.35, sfx: 0.4, vo: 1.0 };
  const applyVol = () => { if (!ctx) return; master.gain.value = vol.master; musicBus.gain.value = vol.music; sfxBus.gain.value = vol.sfx; voBus.gain.value = vol.vo; };
  if (window.SETTINGS) SETTINGS.onChange((V) => { vol.master = V.master / 100; vol.music = V.music / 100; vol.sfx = V.sfx / 100; vol.vo = V.vo / 100; applyVol(); });

  const init = () => {
    if (ctx) return; ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = vol.master; master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; comp.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = vol.music; musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = vol.sfx; sfxBus.connect(comp);
    voBus = ctx.createGain(); voBus.gain.value = vol.vo; voBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  };
  addEventListener('keydown', init); addEventListener('pointerdown', init);

  const load = (url) => { if (buffers[url]) return Promise.resolve(buffers[url]); if (loading[url]) return loading[url];
    return (loading[url] = fetch(url).then((r) => r.arrayBuffer()).then((a) => ctx.decodeAudioData(a)).then((b) => (buffers[url] = b)).catch(() => null)); };

  // ---------------- music: crossfade between loops by phase ----------------
  // one track at a time: `want` is the latest request, `music` what is really playing. When a load finishes it only starts
  // if it is still wanted, and it always fades out whatever is playing at that moment (no stale `old` → no doubled tracks).
  let want = null;
  const TRACK = (n) => (MUSIC_LONG.has(n) ? n + '_long' : n);
  const playMusic = (name) => { if (!ctx || want === name) return; want = name;
    load('audio/music/' + TRACK(name) + '.ogg').then((b) => { if (!b || want !== name || music.name === name) return;
      const src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = b; src.loop = name !== 'victory'; src.connect(g); g.connect(musicBus);
      // sequential, not a crossfade: the old track fades out first, the new one comes in after it (two busy tracks never mix)
      const old = music, now = ctx.currentTime, gap = old.src ? 0.7 : 0;
      if (old.src) { old.gain.gain.cancelScheduledValues(now); old.gain.gain.setValueAtTime(old.gain.gain.value, now); old.gain.gain.linearRampToValueAtTime(0, now + 0.6); try { old.src.stop(now + 0.65); } catch (e) {} }
      g.gain.setValueAtTime(0, now + gap); g.gain.linearRampToValueAtTime(1, now + gap + 0.9); src.start(now + gap);
      music = { name, src, gain: g }; }); };

  // ---------------- voice lines ----------------
  let voUntil = 0;
  const NEEDS = window.VO_NEEDS || {};
  const say = (who, cat, v, pan, present) => {
    // only lines whose mentioned heroes are actually in this run (no "Лёха, …" when there is no Лёха)
    const ids = []; for (let i = 0; i < 6; i++) { const id = `${who}_${cat}_${i}`; if (VO.has(id) && (!present || (NEEDS[id] || []).every((h) => present.has(h)))) ids.push(id); }
    if (!ids.length || ctx.currentTime < voUntil - 0.2) return;
    const id = ids[v % ids.length];
    load('audio/vo/' + id + '.ogg').then((b) => { if (!b) return; const s = ctx.createBufferSource(), p = ctx.createStereoPanner(); s.buffer = b; p.pan.value = pan * 0.6;
      s.connect(p); p.connect(voBus); s.start(); voUntil = ctx.currentTime + b.duration;
      { const g = sfxBus.gain; g.cancelScheduledValues(ctx.currentTime); g.setValueAtTime(g.value, ctx.currentTime); g.linearRampToValueAtTime(vol.sfx * 0.5, ctx.currentTime + 0.08); g.linearRampToValueAtTime(vol.sfx, ctx.currentTime + b.duration + 0.2); }
      if (music.gain) { const g = musicBus.gain; g.cancelScheduledValues(ctx.currentTime); g.setValueAtTime(g.value, ctx.currentTime); g.linearRampToValueAtTime(vol.music * 0.35, ctx.currentTime + 0.1); g.linearRampToValueAtTime(vol.music, ctx.currentTime + b.duration + 0.3); } });
  };

  // boss lines: a cut-scene line cuts off whatever was speaking; a bark waits its turn
  let cutK = '', cur = null; const bossPre = {};
  const line = (id, cut) => { if (!ctx || (!cut && ctx.currentTime < voUntil - 0.2)) return; if (cut && cur) { try { cur.stop(); } catch (e) {} }
    const k0 = cutK; load('audio/vo/' + id + '.ogg').then((b) => { if (!b || (cut && cutK !== k0)) return; const s = ctx.createBufferSource(); s.buffer = b; s.connect(voBus); s.start(); cur = s; voUntil = ctx.currentTime + b.duration;
      if (music.gain) { const g = musicBus.gain; g.cancelScheduledValues(ctx.currentTime); g.setValueAtTime(g.value, ctx.currentTime); g.linearRampToValueAtTime(vol.music * 0.3, ctx.currentTime + 0.1); g.linearRampToValueAtTime(vol.music, ctx.currentTime + b.duration + 0.3); } }); };

  // ---------------- procedural SFX ----------------
  const env = (g, t, a, d, peak) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
  const out = (pan, v) => { const g = ctx.createGain(), p = ctx.createStereoPanner(); p.pan.value = pan; g.gain.value = v; g.connect(p); p.connect(sfxBus); return g; };
  const noise = (t, dur, f0, f1, q, peak, dst, type = 'bandpass') => { const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; s.loop = true; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    s.connect(f); f.connect(g); g.connect(dst); env(g, t, 0.005, dur, peak); s.start(t, Math.random()); s.stop(t + dur + 0.05); };
  const tone = (t, dur, f0, f1, type, peak, dst, a = 0.005) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur); o.connect(g); g.connect(dst); env(g, t, a, dur, peak); o.start(t); o.stop(t + dur + 0.05); };
  const FX = {
    whip: (t, d, r) => { noise(t, 0.16, 900 + 600 * r, 4000, 1.2, 0.5, d, 'bandpass'); tone(t + 0.1, 0.06, 1600, 600, 'triangle', 0.15, d); },
    pull: (t, d) => tone(t, 0.25, 300, 900, 'sine', 0.2, d),
    throw: (t, d, r) => { noise(t, 0.07, 3000, 6000, 3, 0.25, d, 'highpass'); tone(t, 0.05, 1800 + 400 * r, 2600, 'square', 0.04, d); },
    pistol: (t, d) => { noise(t, 0.12, 2500, 300, 0.8, 0.9, d, 'lowpass'); tone(t, 0.08, 180, 60, 'square', 0.3, d); },
    smg: (t, d) => { noise(t, 0.06, 3000, 500, 0.8, 0.5, d, 'lowpass'); },
    shotgun: (t, d) => { noise(t, 0.3, 1800, 120, 0.7, 1.2, d, 'lowpass'); tone(t, 0.15, 120, 40, 'sawtooth', 0.4, d); },
    rocket: (t, d) => { noise(t, 0.5, 600, 2400, 1, 0.5, d, 'bandpass'); tone(t, 0.3, 200, 500, 'sawtooth', 0.1, d); },
    boom: (t, d, r, big) => { noise(t, 0.9 + big * 0.5, 900, 40, 0.6, 1.6, d, 'lowpass'); tone(t, 0.6, 90, 28, 'sine', 1.0, d); },
    hit: (t, d, r) => tone(t, 0.04, 500 + 300 * r, 200, 'square', 0.08, d),
    kill: (t, d, r) => { noise(t, 0.14, 500, 120, 2, 0.35, d, 'bandpass'); tone(t, 0.1, 220 + 80 * r, 90, 'triangle', 0.18, d); },
    gem: (t, d, r) => { tone(t, 0.08, 1200 + 400 * r, 1800 + 400 * r, 'sine', 0.12, d); },
    lvl: (t, d) => [523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.08, 0.25, f, f, 'square', 0.12, d)),
    hurt: (t, d) => { tone(t, 0.18, 300, 120, 'sawtooth', 0.25, d); noise(t, 0.1, 1200, 300, 1, 0.3, d); },
    dash: (t, d) => noise(t, 0.2, 400, 2400, 1.5, 0.35, d),
    down: (t, d) => [392, 330, 262, 196].forEach((f, i) => tone(t + i * 0.12, 0.2, f, f * 0.97, 'triangle', 0.2, d)),
    revive: (t, d) => [392, 523, 659, 784].forEach((f, i) => tone(t + i * 0.07, 0.2, f, f, 'triangle', 0.2, d)),
    wave: (t, d) => { tone(t, 0.6, 110, 110, 'sawtooth', 0.3, d, 0.05); tone(t, 0.6, 165, 165, 'sawtooth', 0.2, d, 0.05); },
    combo: (t, d) => [659, 784, 988, 1318].forEach((f, i) => tone(t + i * 0.06, 0.18, f, f, 'square', 0.14, d)),
    spit: (t, d) => { noise(t, 0.2, 800, 300, 3, 0.3, d); tone(t, 0.15, 400, 150, 'sine', 0.15, d); },
    bass: (t, d) => { tone(t, 0.35, 70, 45, 'sine', 0.9, d); noise(t, 0.12, 300, 120, 1, 0.25, d, 'lowpass'); },
    chest: (t, d) => [523, 659, 784, 1046, 1318].forEach((f, i) => tone(t + i * 0.07, 0.3, f, f, 'triangle', 0.16, d)),
    food: (t, d) => { tone(t, 0.12, 300, 500, 'square', 0.12, d); tone(t + 0.1, 0.15, 500, 800, 'square', 0.1, d); },
    elite: (t, d) => { tone(t, 0.7, 90, 70, 'sawtooth', 0.35, d, 0.05); tone(t, 0.7, 135, 105, 'sawtooth', 0.25, d, 0.05); },
    evo: (t, d) => [392, 523, 659, 784, 1046, 1318, 1568].forEach((f, i) => tone(t + i * 0.06, 0.4, f, f * 1.01, 'square', 0.12, d)),
    block: (t, d) => { tone(t, 0.15, 1400, 1100, 'triangle', 0.2, d); noise(t, 0.1, 5000, 3000, 2, 0.2, d, 'highpass'); },
    // the star of the show: a brrrapp with a fluttering pitch, wet noise and a squeaky tail; every one is different
    fart: (t, d, r, big) => { const dur = (big ? 1.6 : 0.35 + 0.45 * r), o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(),
        f = ctx.createBiquadFilter(), g = ctx.createGain(), base = big ? 55 : 70 + 60 * r;
      o.type = 'sawtooth'; o.frequency.setValueAtTime(base * 1.3, t); o.frequency.exponentialRampToValueAtTime(base * (0.6 + 0.3 * r), t + dur);
      lfo.type = 'square'; lfo.frequency.setValueAtTime(18 + 20 * r, t); lfo.frequency.linearRampToValueAtTime(30 + 25 * r, t + dur); lg.gain.value = base * 0.5;
      lfo.connect(lg); lg.connect(o.frequency); f.type = 'lowpass'; f.frequency.value = 520 + 400 * r; f.Q.value = 6;
      o.connect(f); f.connect(g); g.connect(d); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(big ? 1.1 : 0.8, t + 0.03);
      g.gain.setValueAtTime(big ? 1.0 : 0.7, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
      noise(t, dur * 0.9, 300, 150, 2, big ? 0.5 : 0.3, d);
      if (r > 0.6 || big) tone(t + dur * 0.92, 0.12, 420 + 300 * r, 900 + 400 * r, 'square', 0.08, d); },
  };
  // recorded farts: 8 short + 3 big takes, each played at a random pitch so no two in a row sound alike
  const FARTS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => 'audio/sfx/fart_' + i + '.ogg'), BIG = [0, 1, 2].map((i) => 'audio/sfx/fart_big_' + i + '.ogg');
  let fartsReady = false;
  const preloadFarts = () => { if (fartsReady || !ctx) return; fartsReady = true; [...FARTS, ...BIG].forEach(load); };
  const fartSample = (t, d, r, big) => { preloadFarts(); const list = big ? BIG : FARTS, url = list[Math.floor(r * list.length) % list.length], b = buffers[url]; if (!b) return false;
    const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = 0.82 + 0.4 * ((r * 7.31) % 1); s.connect(d); s.start(t); return true; };
  const lastKind = {}, GAP = { bass: 0.3, whip: 0.2, throw: 0.16, shot0: 0.14, shot1: 0.11, shot2: 0.3, shot3: 0.3, kill: 0.14, hit: 0.25, gem: 0.07, boom: 0.18, spit: 0.5, fart: 0.25, dash: 0.2, block: 0.3, revive: 0.5, down: 0.5 };
  const h = (x) => { const v = Math.sin(x * 127.1) * 43758.5453; return v - Math.floor(v); };

  // ---------------- per-frame: consume new events ----------------
  const tick = () => {
    requestAnimationFrame(tick);
    if (!ctx) return; preloadFarts();
    const S = window.SCENE && SCENE.state; if (!S) { playMusic('calm'); return; }
    if (S.t < lastT - 0.5) lastT = S.t;                                            // a new run (restart / new room)
    const me = S.players[S.me || 0], cam = me.cam, now = ctx.currentTime;
    playMusic(S.over ? (S.won ? 'victory' : 'calm') : S.brk > 0 ? 'calm' : S.wave >= 8 ? 'intense' : 'battle');
    const present = new Set(S.players.filter((p) => !p.out).map((p) => p.hero));
    { const pre = S.map === 'meleuz' ? (S.wave >= 19 ? 'ln_' : '') : S.wave >= 9 ? 'rk_' : '';       // the boss's voice is fetched a wave early
      if (pre && !bossPre[pre] && window.BLINES) { bossPre[pre] = 1; Object.keys(BLINES).filter((id) => id.startsWith(pre) || (pre === 'ln_' && id.startsWith('km_'))).forEach((id) => load('audio/vo/' + id + '.ogg')); } }
    { const c = S.cut, k = c ? c.key + c.i : ''; if (k !== cutK) { cutK = k; if (c) { c.ids.forEach((id) => load('audio/vo/' + id + '.ogg')); line(c.ids[c.i], 1); } } }   // the whole scene preloads
    let n = 0, maxT = lastT;
    for (const e of S.ev) { if (e.t <= lastT) continue; if (e.t > maxT) maxT = e.t; if (S.t - e.t > 0.6) continue;   // stale (joined late / tab was hidden)
      const ex = (e.x || 0) - cam[0] - 960, ey = (e.y || 0) - cam[1] - 540, dd = Math.hypot(ex, ey), pan = Math.max(-1, Math.min(1, ex / 1100));
      const near = Math.max(0, 1 - dd / 1600), r = h(e.t * 13 + (e.x || 0));
      if (e.k === 'bark') { line(e.id); continue; }
      if (e.k === 'say') { if (Math.random() < (window.SETTINGS ? SETTINGS.voiceRate() : 1)) say(e.who, e.cat, e.v, pan, present); continue; }
      if (e.k === 'win' || e.k === 'lose') { say('ann', e.k, 0, 0); continue; }
      if (e.k === 'wave') { FX.wave(now, out(0, 0.7)); if (r < 0.5) say('ann', 'wave', 0, 0); continue; }
      if (e.k === 'combo') { FX.combo(now, out(0, 0.8)); continue; }
      if (e.k === 'lvl') { FX.lvl(now, out(0, 0.7)); continue; }
      if (e.k === 'upgrade' && e.evo) { FX.evo(now, out(0, 0.8)); continue; }
      if (e.k === 'elite') { FX.elite(now, out(pan, 0.7)); continue; }
      if (e.k === 'bus' || e.k === 'arrive') { FX.wave(now, out(0, 0.8)); continue; }
      if (e.k === 'drink' || (e.k === 'board' && e.pid === me.id)) { FX.chest(now, out(0, 0.7)); continue; }
      if (e.k === 'howl') { FX.elite(now, out(pan, 0.5)); continue; }
      if (e.k === 'chest' && e.pid === me.id) { FX.chest(now, out(0, 0.8)); continue; }
      if (e.k === 'food' && e.pid === me.id) { FX.food(now, out(0, 0.7)); continue; }
      // a crowd fight is a texture, not 200 sounds: my own actions at full volume, allies' quieter, each kind rate-limited
      const mine = e.pid === me.id, kind = e.k === 'shot' ? 'shot' + e.g : e.k;
      if (near <= 0.05 || (e.pid !== undefined && !mine && dd > 900) || n >= 4) continue;
      if (now - (lastKind[kind] || 0) < (GAP[kind] ?? 0.1) * (mine ? 1 : 2)) continue;
      if (!mine && (e.k === 'hit' || e.k === 'gem' || e.k === 'step' || e.k === 'throw')) continue;
      if (e.k === 'hurt' && (!mine || e.ally)) continue;
      lastKind[kind] = now; n++;
      const d = out(pan, near * (mine ? 1 : 0.45));
      if (e.k === 'whip') { FX.whip(now, d, r); if (e.pull) FX.pull(now + 0.05, d); }
      else if (e.k === 'throw') FX.throw(now, d, r);
      else if (e.k === 'shot') (e.g === 0 ? FX.pistol : e.g === 1 ? FX.smg : e.g === 2 ? FX.shotgun : FX.rocket)(now, d, r);
      else if (e.k === 'boom') FX.boom(now, d, r, e.gas ? 1 : 0);
      else if (e.k === 'hit' && r < 0.35) FX.hit(now, d, r);
      else if (e.k === 'kill' && r < 0.6) FX.kill(now, d, r);
      else if (e.k === 'gem' && e.pid === me.id) FX.gem(now, d, r);
      else if (e.k === 'hurt' && e.pid === me.id) FX.hurt(now, d);
      else if (e.k === 'dash') FX.dash(now, d);
      else if (e.k === 'down') FX.down(now, d);
      else if (e.k === 'revive') FX.revive(now, d);
      else if (e.k === 'fart') fartSample(now, d, r, e.big) || FX.fart(now, d, r, e.big);
      else if (e.k === 'spit' || e.k === 'shatter' || e.k === 'splat') FX.spit(now, d);
      else if (e.k === 'bass') FX.bass(now, d);
      else if (e.k === 'block') FX.block(now, d);
    }
    lastT = maxT;
  };
  tick();
})();
