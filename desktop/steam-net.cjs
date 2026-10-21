const { encode, decode, roomCode, lobbyId } = require('./wire.cjs');
const GAME = 'friendpocalypse', PROTOCOL = 'steam-1';
class SteamNet {
  constructor(steam, emit) {
    this.steam = steam; this.emit = emit; this.connections = new Map(); this.members = new Set();
    this.id = String(steam.getStatus().steamId); this.lobby = null; this.listen = 0; this.host = null;
    this.unsub = steam.networkingSockets.onConnectionStateChange(c => this.changed(c));
    steam.networkingUtils.initRelayNetworkAccess();
    steam.networkingSockets.initAuthentication();
  }
  changed(c) {
    const sockets = this.steam.networkingSockets;
    const peer = String(c.info.identityRemote).replace(/^steamid:/, '');
    if (c.newState === 1 && c.info.listenSocket) {
      this.refreshMembers();
      if (this.host !== this.id || !this.members.has(peer) || this.connections.has(peer)) {
        sockets.closeConnection(c.connection, 1000, 'Not in lobby', false); return;
      }
      this.connections.set(peer, { handle: c.connection, ready: false });
      if (sockets.acceptConnection(c.connection) !== 1) this.drop(peer);
    }
    const entry = this.connections.get(peer);
    if (!entry || entry.handle !== c.connection) return;
    if (c.newState === 3 && !entry.ready) { entry.ready = true; this.emit({ type: 'join', peer }); }
    if (c.newState === 4 || c.newState === 5) this.drop(peer);
  }
  refreshMembers() {
    if (!this.lobby) return;
    const m = this.steam.matchmaking, next = new Set();
    for (let i = 0; i < m.getNumLobbyMembers(this.lobby); i++) next.add(String(m.getLobbyMemberByIndex(this.lobby, i)));
    this.members = next;
    for (const peer of this.connections.keys()) if (!next.has(peer)) this.drop(peer);
  }
  drop(peer) {
    const entry = this.connections.get(peer); if (!entry) return;
    this.connections.delete(peer);
    this.steam.networkingSockets.closeConnection(entry.handle, 1000, 'Left room', false);
    if (entry.ready) this.emit({ type: 'leave', peer });
  }
  async open({ host, code }) {
    this.leave(); const m = this.steam.matchmaking;
    try {
      if (host) {
        const result = await m.createLobby(2, 8);
        if (!result.success) throw Error(result.error || 'Не удалось создать комнату Steam');
        this.lobby = String(result.lobbyId); this.host = this.id;
        this.listen = this.steam.networkingSockets.createListenSocketP2P(0);
        if (!this.listen) throw Error('Steam не открыл сетевой сокет');
        for (const [key, value] of Object.entries({ game: GAME, protocol: PROTOCOL, host: this.id })) {
          if (!m.setLobbyData(this.lobby, key, value)) throw Error('Steam не сохранил данные комнаты');
        }
      } else {
        const result = await m.joinLobby(lobbyId(code));
        if (!result.success) throw Error(result.response === 4 ? 'Комната заполнена' : 'Комната недоступна. Проверь код и Steam.');
        this.lobby = String(result.lobbyId);
        if (m.getLobbyData(this.lobby, 'game') !== GAME || m.getLobbyData(this.lobby, 'protocol') !== PROTOCOL) throw Error('Другая игра или версия. Обновитесь до одной версии.');
        this.host = m.getLobbyData(this.lobby, 'host');
        if (!this.host || this.host !== String(m.getLobbyOwner(this.lobby)) || this.host === this.id) throw Error('Хост уже вышел из комнаты');
      }
      this.refreshMembers(); this.lastMembers = Date.now();
      return { selfId: this.id, hostId: this.host, code: roomCode(this.lobby), lobbyId: this.lobby };
    } catch (e) { this.leave(); throw e; }
  }
  connect() {
    if (!this.lobby || this.host === this.id || this.connections.has(this.host)) return;
    const handle = this.steam.networkingSockets.connectP2P(this.host, 0);
    if (!handle) throw Error('Steam не смог начать подключение');
    this.connections.set(this.host, { handle, ready: false, since: Date.now() });
  }
  send({ name, data, target }) {
    if (!this.lobby) return;
    const b = encode(name, data), sockets = this.steam.networkingSockets;
    for (const [peer, connection] of this.connections) {
      if (!connection.ready || (target && peer !== target)) continue;
      // Unreliable + NoNagle for snapshots; controls/input keep reliable delivery.
      const result = sockets.sendMessage(connection.handle, b, name === 'snap' ? 1 : 9);
      if (!result.success && name !== 'snap') throw Error('Steam: очередь сообщений переполнена');
    }
  }
  tick() {
    this.steam.runCallbacks(); this.steam.networkingSockets.runCallbacks();
    if (!this.lobby) return;
    if (Date.now() - this.lastMembers > 1000) {
      this.lastMembers = Date.now(); this.refreshMembers();
      if (this.host !== this.id && !this.members.has(this.host)) {
        this.emit({ type: 'error', message: 'Хост вышел из комнаты. Создайте новую комнату.' }); this.leave(); return;
      }
    }
    for (const [peer, entry] of this.connections) {
      if (!entry.ready) {
        if (entry.since && Date.now() - entry.since > 30000) { this.emit({ type: 'error', message: 'Steam не нашёл маршрут к хосту за 30 секунд. Попробуй войти снова.' }); this.drop(peer); }
        continue;
      }
      for (const msg of this.steam.networkingSockets.receiveMessages(entry.handle, 64)) {
        const packet = decode(msg.data, this.host === this.id);
        if (packet) this.emit({ type: 'message', peer, ...packet });
      }
    }
  }
  friends() {
    const f = this.steam.friends, list = [];
    for (let i = 0; i < f.getFriendCount(4); i++) {
      const id = f.getFriendByIndex(i, 4); if (id) list.push({ id, name: f.getFriendPersonaName(id) });
    }
    return list;
  }
  invite(id) {
    if (!this.lobby || !this.friends().some(f => f.id === id)) throw Error('Сначала войди в комнату и выбери друга');
    if (!this.steam.matchmaking.inviteUserToLobby(this.lobby, id)) throw Error('Steam не отправил приглашение');
  }
  leave() {
    for (const peer of this.connections.keys()) this.drop(peer);
    if (this.listen) this.steam.networkingSockets.closeListenSocket(this.listen);
    if (this.lobby) this.steam.matchmaking.leaveLobby(this.lobby);
    this.lobby = null; this.listen = 0; this.host = null; this.members.clear();
  }
  close() { this.leave(); this.unsub(); }
}
module.exports = { SteamNet, GAME, PROTOCOL };
