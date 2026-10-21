function setupUpdates(app, emit, dependencies = {}) {
  const autoUpdater = dependencies.autoUpdater || require('electron-updater').autoUpdater;
  const installed = dependencies.installed || (() => require('node:fs').existsSync(require('node:path').join(require('node:path').dirname(app.getPath('exe')), 'Uninstall Friendpocalypse.exe')));
  const state = { phase: 'idle', message: 'Проверить обновления', version: app.getVersion() };
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  const change = (phase, message, extra = {}) => { Object.assign(state, { phase, message }, extra); emit({ type: 'update', ...state }); };
  autoUpdater.on('checking-for-update', () => change('checking', 'Проверяем обновления…'));
  autoUpdater.on('update-available', info => change('available', `Скачать версию ${info.version}`, { nextVersion: info.version }));
  autoUpdater.on('update-not-available', () => change('current', 'Установлена последняя версия'));
  autoUpdater.on('download-progress', p => change('downloading', `Обновление: ${Math.floor(p.percent)}%`, { percent: p.percent }));
  autoUpdater.on('update-downloaded', () => change('ready', 'Установить и перезапустить'));
  autoUpdater.on('error', () => change('error', 'Обновление недоступно. Попробуй позже или скачай с GitHub.'));
  return {
    state,
    async check() {
      // ZIP can be unpacked and played, but NSIS installation is required for updates.
      if (!app.isPackaged || !installed()) {
        change('manual', 'Для автообновлений установи Setup.exe из GitHub Releases.'); return state;
      }
      if (['checking', 'downloading', 'ready'].includes(state.phase)) return state;
      try { await autoUpdater.checkForUpdates(); } catch {} return state;
    },
    async download() { if (state.phase !== 'available') return state; change('downloading', 'Начинаем загрузку…'); try { await autoUpdater.downloadUpdate(); } catch {} return state; },
    install() { if (state.phase === 'ready') setImmediate(() => autoUpdater.quitAndInstall(false, true)); }
  };
}
module.exports = { setupUpdates };
