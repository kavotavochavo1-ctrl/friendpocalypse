const { app, BrowserWindow, ipcMain, protocol, net, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { appendFileSync, mkdirSync } = require('node:fs');
const { SteamNet } = require('./steam-net.cjs');
const { lobbyId, ACTIONS } = require('./wire.cjs');
const RELEASES = 'https://github.com/kavotavochavo1-ctrl/friendpocalypse/releases';
let win, transport, steam, timer, updates, pendingInvite = null, opening = false;
let status = { available: false, appId: 480, version: app.getVersion(), message: 'Запусти Steam и войди в аккаунт. Соло доступно без Steam.' };
protocol.registerSchemesAsPrivileged([{ scheme: 'fpgame', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const emit = event => { if (win && !win.isDestroyed()) win.webContents.send('steam:event', event); };
function log(e) { try { mkdirSync(app.getPath('logs'), { recursive: true }); appendFileSync(path.join(app.getPath('logs'), 'steam.log'), `${new Date().toISOString()} ${String(e)}\n`); } catch {} }
function invite(args) {
  const i = args.indexOf('+connect_lobby');
  const value = i >= 0 ? args[i + 1] : args.find(v => /^friendpocalypse:\/\//i.test(v));
  if (value) { try { pendingInvite = lobbyId(value); emit({ type: 'invite', code: pendingInvite }); } catch (e) { log(e); } }
}
function initSteam() {
  if (transport) return status;
  try {
    steam ||= require('./sdk.cjs').createSDK();
    const sdkPath = app.isPackaged ? path.join(process.resourcesPath, 'steamworks_sdk') : path.join(__dirname, '../vendor/steamworks_sdk');
    const dll = require('node:fs').readFileSync(path.join(sdkPath, 'redistributable_bin/win64/steam_api64.dll'));
    if (require('node:crypto').createHash('sha256').update(dll).digest('hex') !== 'eb17909a76668cf9ae0b92a618a34a50f6c73d3a6787cb4dd8ce36a8b10bfb75') throw Error('Файл Steam DLL изменён. Переустанови игру из GitHub Releases.');
    steam.setSdkPath(sdkPath);
    if (!steam.init({ appId: 480 })) throw Error('Steam недоступен. Запусти Steam, войди в аккаунт и нажми «Проверить Steam».');
    // Upstream 0.11.3 leaks its receive pointer array. Keep the same parser,
    // release the temporary native allocation even when the queue is empty.
    const sockets = steam.networkingSockets, koffi = require('koffi');
    sockets.receiveMessages = function (connection, maxMessages = 64) {
      const ptr = koffi.alloc('void*', maxMessages);
      try {
        const count = this.libraryLoader.SteamAPI_ISteamNetworkingSockets_ReceiveMessagesOnConnection(this.getInterface(), connection, ptr, maxMessages);
        if (count <= 0) return [];
        return koffi.decode(ptr, koffi.array('void*', count)).map(p => this.parseNetworkMessage(p)).filter(Boolean);
      } finally { koffi.free(ptr); }
    };
    transport = new SteamNet(steam, emit);
    steam.matchmaking.onGameLobbyJoinRequested(e => { pendingInvite = String(e.lobbyId); emit({ type: 'invite', code: pendingInvite }); });
    pendingInvite ||= steam.matchmaking.getConnectLobbyIdFromCommandLine();
    status = { ...status, available: true, name: steam.friends.getPersonaName(), selfId: transport.id, message: 'Steam подключён · Spacewar 480' };
    timer = setInterval(() => { try { transport.tick(); } catch (e) { log(e); emit({ type: 'error', message: 'Сбой сети Steam. Выйди из комнаты и попробуй снова.' }); transport.leave(); } }, 10);
  } catch (e) { log(e); status = { ...status, available: false, message: String(e.message || e) }; }
  return status;
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  invite(process.argv);
  app.on('second-instance', (_, argv) => { invite(argv); if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.on('open-url', (event, url) => { event.preventDefault(); invite([url]); });
  app.whenReady().then(async () => {
    protocol.handle('fpgame', async request => {
      const url = new URL(request.url);
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      const root = app.getAppPath(), file = path.resolve(root, relative);
      // Serve only public game assets, never source, node_modules or user files.
      if (url.hostname !== 'app' || !file.startsWith(root + path.sep) || !/^(?:index\.html|[a-z][a-z-]*\.js|(?:assets|audio|fonts)\/[\w./ -]+)$/.test(relative) || relative.includes('..')) return new Response('Forbidden', { status: 403 });
      const response = await net.fetch(pathToFileURL(file).href);
      if (relative !== 'index.html') return response;
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self' https://yamuyazqiflzlxkisyln.supabase.co; object-src 'none'; frame-src 'none'; base-uri 'none'");
      return new Response(response.body, { status: response.status, headers });
    });
    initSteam(); updates = require('./updates.cjs').setupUpdates(app, emit);
    if (app.isPackaged) app.setAsDefaultProtocolClient('friendpocalypse');
    ipcMain.handle('steam:call', async (event, method, data) => {
      if (event.sender !== win?.webContents || !event.senderFrame?.url.startsWith('fpgame://app/')) throw Error('Недопустимый источник');
      if (method === 'status') return status;
      if (method === 'retry') return initSteam();
      if (method === 'pendingInvite') { const value = pendingInvite; pendingInvite = null; return value; }
      if (method === 'releases') { await shell.openExternal(RELEASES); return; }
      if (method === 'openSteam') { await shell.openExternal('steam://open/main'); return; }
      if (method === 'updateStatus') return updates.state;
      if (method === 'updateCheck') return updates.check();
      if (method === 'updateDownload') return updates.download();
      if (method === 'updateInstall') { if (transport?.lobby) throw Error('Сначала выйди из комнаты, затем установи обновление.'); return updates.install(); }
      if (!transport) throw Error(status.message);
      if (method === 'open') {
        if (opening) throw Error('Подключение уже выполняется');
        opening = true; try { return await transport.open(data || {}); } finally { opening = false; }
      }
      if (method === 'connect') return transport.connect();
      if (method === 'leave') return transport.leave();
      if (method === 'send') { if (!ACTIONS.includes(data?.name) || (data.target && !transport.members.has(data.target))) throw Error('Недопустимое сообщение'); return transport.send(data); }
      if (method === 'friends') return transport.friends();
      if (method === 'invite') return transport.invite(String(data));
      throw Error('Неизвестная команда');
    });
    win = new BrowserWindow({ width: 1366, height: 820, minWidth: 960, minHeight: 640, title: 'Friendpocalypse', backgroundColor: '#120a0e', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('fpgame://app/')) event.preventDefault(); });
    win.webContents.on('did-start-navigation', (_, url, __, isMainFrame) => { if (isMainFrame && transport?.lobby) transport.leave(); });
    await win.loadURL('fpgame://app/index.html');
    if (app.isPackaged) setTimeout(() => updates.check(), 5000);
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { clearInterval(timer); try { transport?.close(); steam?.shutdown(); } catch (e) { log(e); } });
}
