const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setupUpdates } = require('../desktop/updates.cjs');
test('updates require explicit download and installation; ZIP remains manual', async () => {
  const updater = new EventEmitter(), calls = [];
  updater.checkForUpdates = async () => { calls.push('check'); updater.emit('checking-for-update'); updater.emit('update-available', { version: '0.2.0' }); };
  updater.downloadUpdate = async () => { calls.push('download'); updater.emit('update-downloaded'); };
  updater.quitAndInstall = () => calls.push('install');
  const app = { isPackaged: true, getVersion: () => '0.1.0' };
  const flow = setupUpdates(app, () => {}, { autoUpdater: updater, installed: () => true });
  assert.equal(updater.autoDownload, false); assert.equal(updater.autoInstallOnAppQuit, false);
  await flow.download(); assert.deepEqual(calls, []);
  await flow.check(); assert.equal(flow.state.phase, 'available'); assert.deepEqual(calls, ['check']);
  await flow.download(); assert.equal(flow.state.phase, 'ready'); assert.deepEqual(calls, ['check', 'download']);
  flow.install(); await new Promise(r => setImmediate(r)); assert.equal(calls.at(-1), 'install');
  const portable = setupUpdates(app, () => {}, { autoUpdater: new EventEmitter(), installed: () => false });
  await portable.check(); assert.equal(portable.state.phase, 'manual');
});
