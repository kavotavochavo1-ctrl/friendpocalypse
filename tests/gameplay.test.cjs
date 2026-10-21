const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function game() {
  const context = vm.createContext({ console }); context.window = context;
  for (const file of ['blines.js', 'sim.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  return context.SIM;
}
test('critical damage cannot kill either boss before its final phase', () => {
  const sim = game();
  for (const [map, wave] of [['park', 10], ['meleuz', 20]]) for (const phase of [1, 2]) {
    const s = sim.create({ heroes: ['danil', 'hasan'], humans: [0, 1], map }); s.wave = wave;
    for (let i = 0; i < 240; i++) sim.step(s, {});
    sim.startBoss(s);
    for (let i = 0; i < 120 * 30 && !(s.boss.go && !s.cut); i++) sim.step(s, {});
    const boss = s.enemies.find(e => e.id === s.boss.id); s.boss.ph = phase; s.boss.vuln = 0; boss.inv = 0;
    for (const p of s.players) p.m.crit = 1;
    boss.hp = boss.hpMax * 0.15; sim.debugHitRaw(s, boss, boss.hpMax * 0.1);
    assert.ok(boss.hp >= 1 && !s.boss.dead, `${map}, phase ${phase}`);
  }
});
test('eliminated player follows a teammate and cycles only on a fresh E press', () => {
  const sim = game(), s = sim.create({ heroes: ['hasan', 'danil', 'leha'], humans: [0, 1, 2] });
  const [dead, first, second] = s.players; dead.out = dead.down = 1; dead.hp = 0;
  s.spawnAcc = -1e9; s.xpNext = 1e9;
  sim.step(s, {}); assert.equal(dead.spec, first.id);
  sim.step(s, { players: { 0: { e: 1 } } }); assert.equal(dead.spec, second.id);
  sim.step(s, { players: { 0: { e: 1 } } }); assert.equal(dead.spec, second.id);
  second.out = 1; sim.step(s, {}); assert.equal(dead.spec, first.id);
  assert.ok(Math.abs(dead.cam[0] - first.cam[0]) < 1);
  assert.ok(Math.abs(dead.cam[1] - first.cam[1]) < 1);
});
