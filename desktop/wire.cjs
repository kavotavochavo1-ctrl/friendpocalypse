const ACTIONS = ['hello', 'roster', 'start', 'snap', 'input', 'bye', 'ping', 'pong', 'back'];
const CLIENT_ACTIONS = new Set(['hello', 'input', 'bye', 'ping', 'pong']);
const MAX_BYTES = 512 * 1024;
function encode(name, data) {
  const channel = ACTIONS.indexOf(name);
  if (channel < 0) throw Error('Неизвестное сообщение');
  const body = name === 'snap' ? Buffer.from(data) : Buffer.from(JSON.stringify(data));
  if (body.length > MAX_BYTES) throw Error('Сообщение слишком большое');
  return Buffer.concat([Buffer.from([channel]), body]);
}
function decode(bytes, isHost) {
  const b = Buffer.from(bytes), name = ACTIONS[b[0]];
  if (!name || b.length > MAX_BYTES + 1 || (isHost && !CLIENT_ACTIONS.has(name))) return null;
  try {
    if (name === 'snap') return { name, data: b.subarray(1) };
    if (isHost && b.length > 4096) return null;
    const data = JSON.parse(b.subarray(1).toString());
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return { name, data };
  } catch { return null; }
}
function roomCode(id) { return 'FP-' + BigInt(id).toString(36).toUpperCase(); }
function lobbyId(value) {
  const s = String(value).trim();
  const link = /^friendpocalypse:\/\/join\/(\d{15,20})\/?$/i.exec(s);
  if (link) return link[1];
  if (/^\d{15,20}$/.test(s)) return s;
  if (!/^FP-[0-9A-Z]{1,13}$/i.test(s)) throw Error('Вставь Steam-код комнаты вида FP-…');
  let n = 0n; for (const c of s.slice(3).toLowerCase()) n = n * 36n + BigInt(parseInt(c, 36));
  if (n <= 0n || n > 18446744073709551615n) throw Error('Неверный код комнаты');
  return n.toString();
}
module.exports = { ACTIONS, MAX_BYTES, encode, decode, roomCode, lobbyId };
