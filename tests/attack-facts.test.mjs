import assert from 'node:assert/strict';
import test from 'node:test';
import { QUICK_BATTLE, teamMatch } from '../src/rules/data.js';
import { applyAction, createMatch, eventsFor, viewFor } from '../src/rules/engine.js';

const step = (s, seat, action) => { const r = applyAction(s, seat, action); assert.ok(r.ok, r.error); return r; };
const attackOf = (r) => r.events.find((e) => e.type === 'attack');

test('plain attack carries neutral facts and keeps legacy fields (Quick Battle)', () => {
  const r = step(createMatch(QUICK_BATTLE), 0, { type: 'attack', move: 'fangSnap' });
  const e = attackOf(r);
  assert.deepEqual(
    { damage: e.damage, bonus: e.bonus, from: e.from, to: e.to, blocked: e.blocked, dispelled: e.dispelled, mark: e.mark },
    { damage: 20, bonus: 0, from: 60, to: 40, blocked: 0, dispelled: null, mark: 0 });
  for (const k of ['type', 'seat', 'uid', 'id', 'move', 'target', 'targetId']) assert.ok(k in e, k);
});

test('guard reports blocked damage', () => {
  let s = createMatch(teamMatch(19, 'tide', 'bloom'));
  s = step(s, 0, { type: 'attack', move: 'withdraw' }).state;
  const e = attackOf(step(s, 1, { type: 'attack', move: 'vineWhip' }));
  assert.equal(e.blocked, 10); assert.equal(e.damage, 10); assert.equal(e.dispelled, null);
});

test('dispel reports what it stripped, and blocks nothing afterwards', () => {
  let s = createMatch(teamMatch(19, 'tide', 'bloom'));
  s.players[0].active.id = 'psyduck'; s.players[1].active.guard = 20; s.players[1].active.charged = true;
  const e = attackOf(step(s, 0, { type: 'attack', move: 'confusion' }));
  assert.deepEqual(e.dispelled, { guard: 20, charged: true }); assert.equal(e.blocked, 0); assert.equal(e.damage, 10);
  // Nothing to strip -> null
  const s2 = createMatch(teamMatch(19, 'tide', 'bloom')); s2.players[0].active.id = 'psyduck';
  assert.equal(attackOf(step(s2, 0, { type: 'attack', move: 'confusion' })).dispelled, null);
});

test('Hex reports its mark only when the target survives, matching state', () => {
  const s = createMatch(teamMatch(19, 'bloom', 'tide')); s.players[0].active.id = 'gastly';
  const r = step(s, 0, { type: 'attack', move: 'hex' });
  assert.equal(attackOf(r).mark, 15); assert.equal(r.state.players[1].active.hex, 15);
  const s2 = createMatch(teamMatch(19, 'bloom', 'tide')); s2.players[0].active.id = 'gastly'; s2.players[1].active.hp = 10;
  const r2 = step(s2, 0, { type: 'attack', move: 'hex' });
  assert.equal(attackOf(r2).mark, 0); assert.ok(r2.events.some((e) => e.type === 'ko'));
});

test('replay identity: same setup + same actions => identical state and events', () => {
  const actions = [[0, { type: 'attack', move: 'withdraw' }], [1, { type: 'attack', move: 'vineWhip' }], [0, { type: 'attack', move: 'waterGun' }]];
  const play = () => { let s = createMatch(teamMatch(19, 'tide', 'bloom')); const ev = [];
    for (const [seat, a] of actions) { const r = step(s, seat, a); s = r.state; ev.push(...r.events); } return { s, ev }; };
  const a = play(), b = play();
  assert.deepEqual(a.s, b.s); assert.deepEqual(a.ev, b.ev);
  assert.deepEqual(JSON.parse(JSON.stringify(a.ev)), a.ev); // wire-safe
});

test('hidden hands: opponent view and events never expose hand, deck or draws', () => {
  const s = createMatch(teamMatch(19, 'bloom', 'tide'));
  const ball = s.players[0].hand.find((c) => c.id === 'pokeBall');
  const r = step(s, 0, { type: 'trainer', card: ball.uid });
  const v = viewFor(r.state, 1);
  assert.deepEqual(v.players[0].hand, []); assert.deepEqual(v.players[0].deck, []); assert.deepEqual(v.players[1].deck, []);
  assert.equal(v.players[0].handCount, r.state.players[0].hand.length); assert.equal(v.setup, undefined);
  for (const e of eventsFor(r.events, 1)) if (e.type === 'draw' && e.seat === 0) { assert.equal(e.id, null); assert.equal(e.uid, null); }
  const own = JSON.stringify(r.state.players[0].hand.map((c) => c.uid));
  for (const uid of JSON.parse(own)) assert.ok(!JSON.stringify(v).includes(`"${uid}"`), `leaked ${uid}`);
});
