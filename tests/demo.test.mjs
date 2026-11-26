import assert from 'node:assert/strict';
import test from 'node:test';
import { DEMOS, DemoPlayer, demoSetup } from '../src/demo/demos.js';
import { applyAction, createMatch, validate, viewFor } from '../src/rules/engine.js';

// Run a demo against the rules engine with a fixed clock; every request is
// validated exactly like the authority would. With {views:true} each seat only
// sees its private view (hidden hands/decks), as in the real client.
function run(name, opts, { views = false } = {}) {
  const setup = demoSetup(name, opts);
  let state = createMatch(setup);
  const demo = new DemoPlayer(name, setup);
  const cues = []; const events = []; const batches = []; const states = [state];
  const env = {
    idle: true,
    stateFor: (seat) => (views ? viewFor(state, seat) : state),
    request: (seat, action) => {
      assert.equal(validate(state, seat, action), null);
      const r = applyAction(state, seat, action); assert.ok(r.ok, r.error);
      state = r.state; events.push(...r.events.map((e) => e.type));
      batches.push(r.events); states.push(state);
    },
    cue: (cue, targetSeat) => cues.push({ cue, targetSeat, stateIndex: states.length - 1 }),
  };
  for (let t = 0; t < 30 && demo.running; t += 1 / 60) demo.tick(t, env);
  return { demo, cues: cues.map(({ cue, targetSeat }) => ({ cue, targetSeat })), cueAt: cues, events, batches, states, state };
}

test('opening-exchange: both sides attack through validated requests', () => {
  const { demo, cues, state } = run('opening-exchange');
  assert.equal(demo.status, 'done', demo.error);
  assert.deepEqual(cues, [{ cue: 'attack', targetSeat: 0 }, { cue: 'opponent-attack', targetSeat: 1 }, { cue: 'done', targetSeat: null }]);
  assert.ok(state.players[0].active.hp < state.players[0].active.maxHp);
  assert.ok(state.players[1].active.hp < state.players[1].active.maxHp);
});

test('team-showcase: trainers then attacks, cue precedes each request', () => {
  const { demo, cues } = run('team-showcase');
  assert.equal(demo.status, 'done', demo.error);
  assert.deepEqual(cues.map((c) => c.cue), ['trainer', 'attack', 'opponent-trainer', 'opponent-attack', 'done']);
  assert.deepEqual(demo.log.map((l) => l.action.type), ['trainer', 'attack', 'trainer', 'attack']);
  for (const l of demo.log) assert.ok(l.t > 0);
});

test('playback is deterministic across runs', () => {
  for (const name of Object.keys(DEMOS)) {
    const a = run(name), b = run(name);
    assert.deepEqual(a.demo.log, b.demo.log); assert.deepEqual(a.state, b.state);
  }
});

test('team-showcase skips an unplayable trainer instead of failing', () => {
  const { demo, cues } = run('team-showcase', { team: 'tide', away: 'bloom' }); // Potion at full HP
  assert.equal(demo.status, 'done', demo.error);
  assert.equal(cues[0].cue, 'attack');
});

test('knockout-promotion: real KO, real promotion, real win through legal actions', () => {
  const { demo, cues, events, state } = run('knockout-promotion', undefined, { views: true });
  assert.equal(demo.status, 'done', demo.error);
  assert.deepEqual(cues.map((c) => c.cue), ['knockout', 'opponent-promote', 'opponent-attack', 'finisher', 'win', 'done']);
  assert.deepEqual(demo.log.map((l) => l.action?.type ?? null), ['attack', 'promote', 'attack', 'attack', null]);
  assert.deepEqual(events, [
    'attack', 'chip', 'ko', 'promoteRequired',
    'promote', 'turn', 'draw',
    'attack', 'turn', 'draw',
    'attack', 'chip', 'ko', 'win']);
  assert.equal(state.phase, 'over'); assert.equal(state.winner, 0); assert.equal(state.winReason, 'no Pokémon left');
  assert.deepEqual(state.players.map((p) => p.score), [2, 0]);
  assert.equal(state.players[0].active.hp, 10); // 50 - 10 recoil - 20 bite - 10 recoil
});

test('knockout-promotion: replaying the logged actions reproduces the exact state', () => {
  const { demo, state } = run('knockout-promotion');
  let s = createMatch(demoSetup('knockout-promotion'));
  for (const l of demo.log) if (l.action) { const r = applyAction(s, l.targetSeat, l.action); assert.ok(r.ok, r.error); s = r.state; }
  assert.deepEqual(s, state);
});

test('hex-on-bench: Hex marks, retreat benches the target, the mark resolves on that same UID at end of turn', () => {
  const { demo, cues, cueAt, events, batches, states, state } = run('hex-on-bench', undefined, { views: true });
  assert.equal(demo.status, 'done', demo.error);
  assert.deepEqual(cues, [
    { cue: 'hex', targetSeat: 0 }, { cue: 'opponent-retreat', targetSeat: 1 },
    { cue: 'hex-resolved', targetSeat: 1 }, { cue: 'done', targetSeat: null }]);
  assert.deepEqual(demo.log.map((l) => l.action?.type ?? null), ['attack', 'retreat', null]);
  assert.deepEqual(events, ['attack', 'turn', 'draw', 'retreat', 'chip', 'turn', 'draw']);

  const [s0, afterHex, afterRetreat] = states;
  const victim = s0.players[1].active.uid; const reserve = s0.players[1].bench[0].uid;
  assert.equal(s0.players[0].active.id, 'gastly'); assert.equal(s0.players[1].active.id, 'bulbasaur');
  assert.equal(s0.players[1].active.hp, 60);

  // Hex: 10 now, mark of 15 left on the survivor. Gastly's own end of turn does not touch it.
  const [hexBatch, retreatBatch] = batches;
  const atk = hexBatch.find((e) => e.type === 'attack');
  assert.deepEqual([atk.move, atk.target, atk.damage, atk.from, atk.to, atk.mark], ['hex', victim, 10, 60, 50, 15]);
  assert.ok(!hexBatch.some((e) => e.type === 'chip'));
  assert.equal(afterHex.current, 1); assert.equal(afterHex.phase, 'play');
  assert.equal(afterHex.players[1].active.uid, victim);
  assert.equal(afterHex.players[1].active.hp, 50); assert.equal(afterHex.players[1].active.hex, 15);

  // Retreat is a pure swap (no damage); the chip comes after it, from the
  // retreating seat's end of turn, aimed at the benched victim's UID.
  assert.deepEqual(retreatBatch.map((e) => e.type), ['retreat', 'chip', 'turn', 'draw']);
  const [ret, chip] = retreatBatch;
  assert.deepEqual([ret.seat, ret.from, ret.to, ret.bench], [1, victim, reserve, 0]);
  assert.deepEqual([chip.seat, chip.uid, chip.id, chip.from, chip.to, chip.source], [1, victim, 'bulbasaur', 50, 35, 'Hex']);
  assert.equal(retreatBatch[2].seat, 0); // turn passes only after the chip

  // Live state after the chip: victim benched at 35 with the mark spent; reserve active and untouched.
  for (const s of [afterRetreat, state]) {
    const p = s.players[1];
    assert.equal(p.active.uid, reserve); assert.equal(p.active.hp, p.active.maxHp); assert.equal(p.active.hex, undefined);
    assert.equal(p.bench[0].uid, victim); assert.equal(p.bench[0].hp, 35); assert.equal(p.bench[0].hex, undefined);
    assert.equal(s.current, 0); assert.equal(s.phase, 'play'); assert.equal(s.winner, null);
    assert.deepEqual(s.players.map((x) => x.score), [0, 0]);
  }
  assert.equal(state.players[0].active.hp, 50); // Gastly untouched

  // Cue timing: each request cue fires on the state it acts on; hex-resolved only after the chip.
  assert.deepEqual(cueAt.slice(0, 3).map((c) => c.stateIndex), [0, 1, 2]);
});

test('hex-on-bench: the observation step waits until the mark has actually resolved', () => {
  const setup = demoSetup('hex-on-bench');
  const demo = new DemoPlayer('hex-on-bench', setup);
  demo.i = demo.steps.length - 1;
  let s = createMatch(setup);
  s = applyAction(s, 0, { type: 'attack', move: 'hex' }).state; // marked, still active, opponent's turn
  const cues = []; let sent = 0;
  const env = { idle: true, stateFor: () => s, request: () => sent++, cue: (c) => cues.push(c) };
  for (let t = 0; t < 20; t += 0.1) demo.tick(t, env);
  assert.equal(demo.status, 'failed'); assert.equal(sent, 0); assert.deepEqual(cues, ['failed']);
});

test('hex-on-bench: replaying the logged actions reproduces the exact state', () => {
  const { demo, state } = run('hex-on-bench');
  let s = createMatch(demoSetup('hex-on-bench'));
  for (const l of demo.log) if (l.action) { const r = applyAction(s, l.targetSeat, l.action); assert.ok(r.ok, r.error); s = r.state; }
  assert.deepEqual(s, state);
});

test('knockout-promotion fails loudly if the win never arrives', () => {
  const setup = demoSetup('knockout-promotion');
  const demo = new DemoPlayer('knockout-promotion', setup);
  demo.i = demo.steps.length - 1; // the await-win step
  const cues = []; let sent = 0;
  const env = { idle: true, stateFor: () => createMatch(setup), request: () => sent++, cue: (c) => cues.push(c) };
  for (let t = 0; t < 20; t += 0.1) demo.tick(t, env);
  assert.equal(demo.status, 'failed'); assert.equal(sent, 0); assert.deepEqual(cues, ['failed']);
});

test('waits while not idle, and fails loudly if a step never becomes playable', () => {
  const setup = demoSetup('opening-exchange');
  const demo = new DemoPlayer('opening-exchange', setup);
  let sent = 0; const cues = [];
  const env = { idle: false, stateFor: () => createMatch(setup), request: () => sent++, cue: (c) => cues.push(c) };
  for (let t = 0; t < 5; t += 0.1) demo.tick(t, env);
  assert.equal(sent, 0); assert.equal(cues.length, 0);
  const stuck = { ...createMatch(setup), current: 1 };
  const env2 = { idle: true, stateFor: () => stuck, request: () => sent++, cue: (c) => cues.push(c) };
  for (let t = 5; t < 20; t += 0.1) demo.tick(t, env2);
  assert.equal(demo.status, 'failed'); assert.equal(sent, 0); assert.deepEqual(cues, ['failed']);
});

test('never-idle table fails once after the busy limit, not before', () => {
  const setup = demoSetup('opening-exchange');
  const demo = new DemoPlayer('opening-exchange', setup);
  let sent = 0; const cues = [];
  const env = { idle: false, stateFor: () => createMatch(setup), request: () => sent++, cue: (c) => cues.push(c) };
  for (let t = 0; t <= 29; t += 0.1) demo.tick(t, env); // long legit animation chain
  assert.equal(demo.status, 'running');
  for (let t = 29; t < 40; t += 0.1) demo.tick(t, env);
  assert.equal(demo.status, 'failed'); assert.match(demo.error, /idle/);
  assert.equal(sent, 0); assert.deepEqual(cues, ['failed']);
});

test('busy time resets when the table goes idle, so long presentations between steps survive', () => {
  const setup = demoSetup('opening-exchange');
  let state = createMatch(setup); const demo = new DemoPlayer('opening-exchange', setup);
  let t = 0; let busyUntil = 0;
  const env = {
    get idle() { return t >= busyUntil; },
    stateFor: () => state,
    request: (seat, a) => { state = applyAction(state, seat, a).state; busyUntil = t + 25; }, // 25s each
    cue: () => {},
  };
  for (; t < 120 && demo.running; t += 1 / 30) demo.tick(t, env);
  assert.equal(demo.status, 'done', demo.error);
});

test('intentional pause freezes every timer: no failure, no request, resumes cleanly', () => {
  const setup = demoSetup('opening-exchange');
  const demo = new DemoPlayer('opening-exchange', setup);
  let sent = 0; const cues = [];
  const stuck = { ...createMatch(setup), current: 1 };
  const env = { idle: false, paused: true, stateFor: () => stuck, request: () => sent++, cue: (c) => cues.push(c) };
  for (let t = 0; t < 120; t += 0.1) demo.tick(t, env);
  assert.equal(demo.status, 'running'); assert.equal(sent, 0); assert.equal(cues.length, 0);
  let state = createMatch(setup);
  const live = { idle: true, stateFor: () => state, request: (s, a) => { sent++; state = applyAction(state, s, a).state; }, cue: (c) => cues.push(c) };
  for (let t = 120; t < 150 && demo.running; t += 1 / 60) demo.tick(t, live);
  assert.equal(demo.status, 'done', demo.error); assert.equal(sent, 2);
});

test('dispose stops playback silently and is terminal', () => {
  const setup = demoSetup('opening-exchange');
  const demo = new DemoPlayer('opening-exchange', setup);
  let sent = 0; const cues = [];
  const env = { idle: true, stateFor: () => createMatch(setup), request: () => sent++, cue: (c) => cues.push(c) };
  demo.tick(0, env); demo.dispose(); demo.dispose();
  for (let t = 0; t < 60; t += 0.1) demo.tick(t, env);
  assert.equal(demo.status, 'disposed'); assert.equal(demo.running, false);
  assert.equal(sent, 0); assert.deepEqual(cues, []);
  demo.fail('late', env); assert.equal(demo.status, 'disposed');
});

test('a failed demo never resumes and cues failed exactly once', () => {
  const setup = demoSetup('opening-exchange');
  const demo = new DemoPlayer('opening-exchange', setup);
  let sent = 0; const cues = [];
  const stuck = { ...createMatch(setup), current: 1 };
  const env = { idle: true, stateFor: () => stuck, request: () => sent++, cue: (c) => cues.push(c) };
  for (let t = 0; t < 20; t += 0.1) demo.tick(t, env);
  assert.equal(demo.status, 'failed');
  const live = { ...env, stateFor: () => createMatch(setup) };
  for (let t = 20; t < 60; t += 0.1) demo.tick(t, live);
  demo.fail('again', live);
  assert.equal(sent, 0); assert.deepEqual(cues, ['failed']); assert.equal(demo.running, false);
});
