const { test } = require('node:test');
const assert = require('node:assert/strict');
const { roomCode, lobbyId, encode, decode } = require('../desktop/wire.cjs');
const { SteamNet } = require('../desktop/steam-net.cjs');
test('room code preserves every bit of Steam lobby IDs', () => {
  for (const id of ['109775245123456789', '18446744073709551615']) assert.equal(lobbyId(roomCode(id)), id);
  assert.equal(lobbyId('friendpocalypse://join/109775245123456789'), '109775245123456789');
  for (const code of ['', 'javascript:1', 'FP-!!!!', 'FP-ZZZZZZZZZZZZZ']) assert.throws(() => lobbyId(code));
});
test('wire keeps binary snapshots and rejects forged control messages', () => {
  const snap = Buffer.alloc(65000, 123);
  assert.deepEqual(decode(encode('snap', snap), false).data, snap);
  assert.equal(decode(encode('start', { pid: 0 }), true), null);
  assert.equal(decode(Buffer.from([4, 110, 117, 108, 108]), true), null);
  assert.equal(decode(encode('input', { seq: 10 }), true).data.seq, 10);
  assert.equal(decode(Buffer.from([255]), false), null);
  assert.throws(() => encode('snap', Buffer.alloc(524289)));
});
function fixture() {
  const events = [], sent = [], rejected = [], members = new Set(['host', 'friend']);
  const metadata = { game: 'friendpocalypse', protocol: 'steam-1', host: 'host' };
  let callback;
  const steam = {
    getStatus: () => ({ steamId: 'host' }), runCallbacks() {},
    networkingUtils: { initRelayNetworkAccess() {} },
    networkingSockets: {
      onConnectionStateChange(fn) { callback = fn; return () => {}; }, initAuthentication() {},
      createListenSocketP2P: () => 1, closeListenSocket() {}, acceptConnection: () => 1,
      closeConnection: handle => rejected.push(handle), runCallbacks() {},
      receiveMessages: () => [], sendMessage: (...args) => { sent.push(args); return { success: true }; }
    },
    matchmaking: {
      createLobby: async () => ({ success: true, lobbyId: '109775245123456789' }),
      joinLobby: async () => ({ success: true, lobbyId: '109775245123456789' }),
      setLobbyData: (_, key, value) => { metadata[key] = value; return true; },
      getLobbyData: (_, key) => metadata[key], getLobbyOwner: () => 'host',
      getNumLobbyMembers: () => members.size, getLobbyMemberByIndex: (_, i) => [...members][i], leaveLobby() {}
    }
  };
  const network = new SteamNet(steam, e => events.push(e));
  return { network, steam, events, sent, rejected, metadata, members, change: c => callback(c) };
}
test('only lobby members can connect; snapshots use unreliable, input stays reliable', async () => {
  const f = fixture(); await f.network.open({ host: true });
  f.change({ newState: 1, connection: 2, info: { identityRemote: 'outsider', listenSocket: 1 } });
  assert.deepEqual(f.rejected, [2]);
  f.change({ newState: 1, connection: 3, info: { identityRemote: 'friend', listenSocket: 1 } });
  f.change({ newState: 3, connection: 3, info: { identityRemote: 'friend' } });
  f.network.send({ name: 'snap', data: Buffer.alloc(65000) });
  f.network.send({ name: 'input', data: { seq: 1 } });
  assert.equal(f.sent[0][2], 1); assert.equal(f.sent[1][2], 9);
  assert.equal(f.events[0].type, 'join');
  f.members.delete('friend'); f.network.refreshMembers();
  assert.equal(f.events.at(-1).type, 'leave'); assert.equal(f.network.connections.size, 0);
});
test('foreign or incompatible lobby is left before connecting', async () => {
  const f = fixture(); f.metadata.protocol = 'other';
  await assert.rejects(f.network.open({ host: false, code: '109775245123456789' }), /Другая игра/);
  assert.equal(f.network.lobby, null);
});
