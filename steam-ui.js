(function () {
  if (!window.FP_STEAM) return;
  const api = window.FP_STEAM; let status, update;
  const css = document.createElement('style'); css.textContent = `
    #steam-panel{margin:12px 0 16px;font-size:10px;line-height:1.8;color:#f6e7c8}
    #steam-panel .steam-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
    #steam-panel button{font-size:10px;padding:8px 10px}
    #steam-update{margin-top:8px;color:#ffd76a}
    #steam-friends{color:#f6e7c8;background:#120a0e;border:3px solid #8a5a32;border-radius:10px;padding:24px;max-width:560px;width:calc(100% - 80px);font:12px 'Press Start 2P',monospace}
    #steam-friends::backdrop{background:#000b}
    #steam-friends h2{font-size:16px;color:#ffd76a;line-height:1.6;margin:0 0 16px}
    #steam-friends p{line-height:1.8;font-size:10px}
    #steam-friends-list{display:grid;gap:8px;max-height:45vh;overflow:auto}
    #steam-friends button{font:inherit;font-size:11px;padding:10px;background:#1e3040;border:2px solid #3e6a8a;border-radius:6px;color:#ffe9b0;cursor:pointer;text-align:left}
    #steam-friends button:disabled{opacity:.6}
    #steam-close{margin-top:16px}
    #lobby button:focus-visible,#steam-friends button:focus-visible{outline:3px solid #ffd76a;outline-offset:3px}
  `; document.head.appendChild(css);
  const dialog = document.createElement('dialog'); dialog.id = 'steam-friends';
  dialog.innerHTML = '<h2>Пригласить через Steam</h2><p>Другу нужно запустить лаунчер. Если приглашение не появилось, отправь код комнаты.</p><div id="steam-friends-list"></div><p id="steam-invite-status" role="status"></p><button id="steam-close">Закрыть</button>';
  document.body.appendChild(dialog); dialog.querySelector('#steam-close').onclick = () => dialog.close();
  dialog.addEventListener('keydown', e => e.stopPropagation());
  function paint() {
    const panel = document.getElementById('steam-panel'); if (!panel) return;
    panel.replaceChildren();
    const line = document.createElement('div'); line.setAttribute('role', 'status');
    line.textContent = status ? `${status.message}${status.available ? ' · ' + status.name : ''}` : 'Проверяем Steam…'; panel.appendChild(line);
    const actions = document.createElement('div'); actions.className = 'steam-actions'; panel.appendChild(actions);
    function button(label, fn) { const b = document.createElement('button'); b.textContent = label; b.className = 'alt'; b.onclick = async () => { b.disabled = true; try { await fn(); } catch (e) { line.textContent = e.message; } finally { b.disabled = false; } }; actions.appendChild(b); }
    if (!status?.available) {
      button('Открыть Steam', () => api.call('openSteam'));
      button('Проверить Steam', async () => { status = await api.call('retry'); paint(); });
    }
    if (window.NET?.mode !== 'off' && status?.available) button('Пригласить друга', friends);
    const phase = update?.phase;
    if (!['checking', 'downloading'].includes(phase)) button(phase === 'available' ? 'Скачать обновление' : phase === 'ready' ? 'Установить и перезапустить' : 'Проверить обновления', async () => { update = await api.call(phase === 'available' ? 'updateDownload' : phase === 'ready' ? 'updateInstall' : 'updateCheck'); paint(); });
    button('GitHub Releases', () => api.call('releases'));
    if (update) { const u = document.createElement('div'); u.id = 'steam-update'; u.setAttribute('role', 'status'); u.textContent = `v${update.version} · ${update.message}`; panel.appendChild(u); }
  }
  async function friends() {
    dialog.showModal(); const list = dialog.querySelector('#steam-friends-list'), message = dialog.querySelector('#steam-invite-status');
    list.textContent = 'Загружаем друзей…'; message.textContent = '';
    try {
      const rows = await api.call('friends'); list.replaceChildren(); if (!rows.length) list.textContent = 'Список друзей пуст. Передай код комнаты.';
      for (const row of rows) {
        const b = document.createElement('button'); b.textContent = row.name; b.onclick = async () => { b.disabled = true; try { await api.call('invite', row.id); message.textContent = `Приглашение для ${row.name} отправлено`; } catch (e) { message.textContent = e.message; } finally { b.disabled = false; } }; list.appendChild(b);
      }
    } catch (e) { list.textContent = e.message; }
  }
  api.onEvent(e => { if (e.type === 'update') { update = e; paint(); } });
  window.SteamUI = { mount: paint };
  Promise.all([api.call('status'), api.call('updateStatus')]).then(([s, u]) => { status = s; update = u; paint(); });
})();
