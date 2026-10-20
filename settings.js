// live/settings.js — player settings (per browser, localStorage): volumes, voice-line rate, screen shake, flashes,
// ally name tags, FPS/network overlay, fullscreen. Opened from the lobby or with Esc in a run (solo pauses meanwhile).
(function () {
  const DEF = { master: 90, music: 35, sfx: 40, vo: 100, voices: 0.7, shake: 50, flash: 1, names: 1, netinfo: 0, quality: 0 };
  let V = Object.assign({}, DEF);
  try { Object.assign(V, JSON.parse(localStorage.getItem('fp_settings') || '{}')); } catch (e) {}
  if (!V.v2) { if (V.shake === 100) V.shake = DEF.shake; V.v2 = 1; }        // the old default shake was too strong
  const subs = [];
  const save = () => { try { localStorage.setItem('fp_settings', JSON.stringify(V)); } catch (e) {} subs.forEach((f) => f(V)); };
  const S = (window.SETTINGS = {
    get: (k) => V[k], set: (k, v) => { V[k] = v; save(); }, all: () => V, onChange: (f) => { subs.push(f); f(V); },
    voiceRate: () => V.voices, shake: () => V.shake / 100, flash: () => V.flash,
    isOpen: () => open, toggle: () => (open ? close() : show()), show: () => show(), close: () => close(),
  });
  let open = false;
  const css = document.createElement('style'); css.textContent = `
#settings{position:absolute;inset:0;display:none;align-items:center;justify-content:center;z-index:8;background:#0008;font-family:"Press Start 2P",monospace;color:#f6e7c8}
#settings .box{background:rgba(18,10,14,.95);border:3px solid #8a5a32;border-radius:14px;padding:20px 24px;width:min(640px,92vw);max-height:90vh;overflow:auto}
#settings h2{margin:0 0 14px;font-size:18px;color:#ffd76a}
#settings .r{display:grid;grid-template-columns:200px 1fr 46px;gap:10px;align-items:center;margin:10px 0;font-size:10px}
#settings input[type=range]{width:100%;accent-color:#ffb040}
#settings .opts{display:flex;gap:6px;flex-wrap:wrap;grid-column:2 / 4}
#settings button{font:inherit;font-size:10px;padding:8px 10px;border-radius:7px;border:2px solid #6a4a2a;background:#2a1a14;color:#f6e7c8;cursor:pointer}
#settings button.on{background:#7a3e22;border-color:#ffb040;color:#ffe9b0}
#settings .row2{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}
#settings .keys{font-size:9px;line-height:1.9;opacity:.8;margin-top:12px}`;
  document.head.appendChild(css);
  const el = document.createElement('div'); el.id = 'settings'; document.body.appendChild(el);
  const slider = (k, label) => `<div class="r"><span>${label}</span><input type="range" min="0" max="100" value="${V[k]}" data-k="${k}"><span id="v_${k}">${V[k]}</span></div>`;
  const choice = (k, label, opts) => `<div class="r"><span>${label}</span><div class="opts">${opts.map(([v, n]) => `<button data-k="${k}" data-v="${v}" class="${V[k] === v ? 'on' : ''}">${n}</button>`).join('')}</div></div>`;
  function render() {
    const inRun = !!(window.GAME && window.GAME.state && window.GAME.state());
    el.innerHTML = `<div class="box"><h2>Настройки${inRun && window.NET && NET.mode === 'off' ? ' · пауза' : ''}</h2>
      ${slider('master', 'Общая громкость')}${slider('music', 'Музыка')}${slider('sfx', 'Эффекты')}${slider('vo', 'Голоса')}
      ${choice('voices', 'Реплики героев', [[1, 'Часто'], [0.7, 'Обычно'], [0.35, 'Редко'], [0, 'Выкл']])}
      ${slider('shake', 'Тряска экрана')}
      ${choice('quality', 'Качество графики', [[0, 'Авто (чётко)'], [1, '1080p'], [0.75, 'Среднее'], [0.5, 'Низкое']])}
      ${choice('flash', 'Вспышки и свечение', [[1, 'Полные'], [0.5, 'Меньше']])}
      ${choice('names', 'Имена над друзьями', [[1, 'Вкл'], [0, 'Выкл']])}
      ${choice('netinfo', 'FPS и сеть (F3)', [[1, 'Показывать'], [0, 'Скрыть']])}
      <div class="row2"><button id="s_full">Полный экран</button><button id="s_reset">Сбросить</button>
        ${inRun ? '<button id="s_menu">Выйти в меню</button>' : ''}<button id="s_close" class="on">Готово (Esc)</button></div>
      <div class="keys">WASD — бег · Q — способность · R — ульта (копится от убийств) · E — встать (соло) · 1/2/3 — улучшение · M — музыка вкл/выкл</div></div>`;
    el.querySelectorAll('input[type=range]').forEach((r) => (r.oninput = () => { V[r.dataset.k] = +r.value; el.querySelector('#v_' + r.dataset.k).textContent = r.value; save(); }));
    el.querySelectorAll('button[data-k]').forEach((b) => (b.onclick = () => { V[b.dataset.k] = +b.dataset.v; save(); render(); }));
    el.querySelector('#s_full').onclick = () => { const d = document.documentElement; document.fullscreenElement ? document.exitFullscreen() : d.requestFullscreen && d.requestFullscreen(); };
    el.querySelector('#s_reset').onclick = () => { V = Object.assign({}, DEF); save(); render(); };
    el.querySelector('#s_close').onclick = () => close();
    const m = el.querySelector('#s_menu'); if (m) m.onclick = () => { close(); window.GAME.toMenu && window.GAME.toMenu(); };
  }
  function show() { open = true; render(); el.style.display = 'flex'; }
  function close() { open = false; el.style.display = 'none'; }
  el.addEventListener('keydown', (e) => e.stopPropagation());
  addEventListener('keydown', (e) => { if (e.code === 'KeyM') { V.music = V.music > 0 ? 0 : DEF.music; save(); if (open) render(); } });
})();
