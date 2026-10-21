const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function game() {
  const context = vm.createContext({ console });
  context.window = context;
  for (const file of ['blines.js', 'sim.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  return context.SIM;
}

test('barber speed and target scale gently with mustaches and survive snapshot serialization', () => {
  const sim = game();
  for (let count = 1; count <= 6; count++) {
    const state = sim.create({ heroes: ['hasan'], humans: [0], seed: 5000 });
    sim.step(state, {});
    assert.ok(state.barber);
    const player = state.players[0];
    player.must = count; player.x = state.barber.x; player.y = state.barber.y + 40;
    sim.step(state, {});
    assert.ok(player.trim);
    const duration = 1.4 / 1.175 * 1.1 / (1 + 0.05 * (count - 1));
    assert.ok(Math.abs(player.trim.pass - duration) < 1e-12);
    assert.ok(Math.abs(player.trim.width - 0.065 * 2 / 3 * 1.1 * (1 - 0.03 * (count - 1))) < 1e-12);
    const snapshot = JSON.parse(JSON.stringify(player.trim));
    assert.ok(Math.abs(sim.trimPos(snapshot, snapshot.t0 + 0.6)) < 1e-12);
    assert.ok(Math.abs(sim.trimPos(snapshot, snapshot.t0 + 0.6 + duration) - 1) < 1e-12);
    assert.equal(sim.CUT_W, 0.065 * 2 / 3 * 1.1);
    assert.equal(snapshot.width, player.trim.width);
  }
});

test('maximum-speed haircut still accepts a hit and rejects a miss', () => {
  const sim = game();
  for (const [offset, hit] of [[0, true], [-0.039, true], [-0.042, false], [-0.2, false]]) {
    const state = sim.create({ heroes: ['hasan'], humans: [0], seed: 5000 });
    sim.step(state, {});
    const player = state.players[0];
    player.must = 6; player.mustR = 5; player.x = state.barber.x; player.y = state.barber.y + 40;
    sim.step(state, {});
    const cut = player.trim;
    state.t = cut.t0 + 0.6 + cut.mark * cut.pass;
    sim.step(state, { trim: 10 + cut.mark + offset });
    assert.equal(player.trim, null);
    assert.equal(player.must, hit ? 6 : 5);
    assert.equal(player.mustR, hit ? 5 : 4);
    assert.equal(state.barber, null);
  }
});
