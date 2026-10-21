// Implements the existing room.makeAction interface over the isolated Steam bridge.
(function () {
  if (!window.FP_STEAM) return;
  const api = window.FP_STEAM;
  window.SteamRoom = {
    async open(host, code) {
      const actions = {}, pending = [], joined = new Set(); let joining = true, onJoin, onLeave;
      const room = {
        makeAction(name) {
          if (actions[name]) return actions[name];
          let listener; const queue = [];
          const action = { send: (data, options = {}) => api.call('send', { name, data, target: options.target }),
            receive: (data, peer) => { if (listener) listener(data, { peerId: peer }); else { if (queue.length >= 32) queue.shift(); queue.push([data, peer]); } } };
          Object.defineProperty(action, 'onMessage', { get: () => listener, set: fn => { listener = fn; for (const [data, peer] of queue.splice(0)) fn(data, { peerId: peer }); } });
          actions[name] = action; return action;
        },
        set onPeerJoin(fn) { onJoin = fn; for (const peer of joined) fn(peer); },
        set onPeerLeave(fn) { onLeave = fn; },
        leave() { unsubscribe(); return api.call('leave'); }
      };
      function receive(event) {
        if (joining) { pending.push(event); return; }
        if (event.type === 'join') { joined.add(event.peer); if (onJoin) onJoin(event.peer); }
        if (event.type === 'leave') { joined.delete(event.peer); if (onLeave) onLeave(event.peer); }
        if (event.type === 'message') room.makeAction(event.name).receive(event.data, event.peer);
      }
      const unsubscribe = api.onEvent(receive);
      try {
        const info = await api.call('open', { host, code });
        Object.assign(room, info); joining = false; pending.forEach(receive);
        // Handlers in net.js are installed synchronously after open resolves.
        room.connect = () => api.call('connect');
        return room;
      } catch (e) { unsubscribe(); throw e; }
    }
  };
})();
