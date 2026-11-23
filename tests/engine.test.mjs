import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, applyAction, legalActions, unavailableReason, viewFor } from '../src/rules/engine.js';
import { chooseAction } from '../src/rules/ai.js';
import { QUICK_BATTLE, MOVES, CARDS } from '../src/rules/data.js';

const fresh = () => createMatch(QUICK_BATTLE);
const act = (s, seat, a) => { const r = applyAction(s, seat, a); assert.ok(r.ok, r.error); return r; };

test('opening matchup and HP', () => {
  const s = fresh();
  assert.equal(s.players[0].active.id, 'gloomwing');
  assert.equal(s.players[0].active.hp, 40);
  assert.equal(s.players[0].bench[0].id, 'puffmire');
  assert.equal(s.players[0].bench[0].hp, 60);
  assert.equal(s.players[1].active.id, 'voltpip');
  assert.equal(s.players[1].active.hp, 60);
  assert.equal(s.current, 0);
  assert.equal(s.players[0].hand.length, 1, 'turn 1 draw');
});

test('reference exchange: Bite then Pika Punch', () => {
  let s = fresh();
  let r = act(s, 0, { type: 'attack', move: 'fangSnap' });
  assert.equal(r.events.filter((e) => e.type === 'attack').length, 1);
  assert.equal(r.state.players[1].active.hp, 40);
  assert.equal(r.state.current, 1);
  // Repeating the same pinch is rejected: not your turn anymore.
  const again = applyAction(r.state, 0, { type: 'attack', move: 'fangSnap' });
  assert.equal(again.ok, false);
  s = r.state;
  const ai = chooseAction(s, 1, { scriptFirstReply: true });
  assert.deepEqual(ai, { type: 'attack', move: 'sparkJab' });
  r = act(s, 1, ai);
  assert.equal(r.state.players[0].active.hp, 20);
});

test('charge adds bonus once and does not stack', () => {
  let s = fresh();
  s = act(s, 0, { type: 'endTurn' }).state;
  s = act(s, 1, { type: 'attack', move: 'charge' }).state;
  assert.equal(s.players[1].active.charged, true);
  s = act(s, 0, { type: 'endTurn' }).state;
  assert.equal(unavailableReason(s, 1, 'attack', { move: 'charge' }), 'Already charged');
  const r = act(s, 1, { type: 'attack', move: 'sparkJab' });
  assert.equal(r.events[0].damage, MOVES.sparkJab.damage + MOVES.charge.bonus);
  assert.equal(r.state.players[1].active.charged, false);
});

test('retreat swaps and preserves HP, ends turn', () => {
  let s = fresh();
  s = act(s, 0, { type: 'endTurn' }).state;
  s = act(s, 1, { type: 'attack', move: 'sparkJab' }).state; // gloomwing 20/40
  const r = act(s, 0, { type: 'retreat', bench: 0 });
  assert.equal(r.state.players[0].active.id, 'puffmire');
  assert.equal(r.state.players[0].bench[0].id, 'gloomwing');
  assert.equal(r.state.players[0].bench[0].hp, 20);
  assert.equal(r.state.current, 1);
});

test('retreat without bench explains why', () => {
  const s = fresh();
  s.players[0].bench = [null, null, null];
  assert.equal(unavailableReason(s, 0, 'retreat'), 'Bench a Pokémon to retreat');
});

test('potion: invalid full-HP target keeps the card; valid heals, capped, once per turn', () => {
  let s = fresh();
  s = act(s, 0, { type: 'endTurn' }).state;
  s = act(s, 1, { type: 'attack', move: 'sparkJab' }).state; // gloomwing 20/40, p0 draws card 2
  const potion = s.players[0].hand.find((c) => c.id === 'potion');
  const bad = applyAction(s, 0, { type: 'potion', card: potion.uid, target: s.players[0].bench[0].uid });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /full HP/);
  const r = act(s, 0, { type: 'potion', card: potion.uid, target: s.players[0].active.uid });
  assert.equal(r.state.players[0].active.hp, 40);
  assert.equal(r.state.players[0].discard.length, 1);
  assert.equal(r.state.current, 0, 'potion does not end the turn');
});

test('bench from hand into empty slot', () => {
  let s = fresh();
  s = act(s, 0, { type: 'endTurn' }).state;
  s = act(s, 1, { type: 'endTurn' }).state; // p0 drew pebblit
  const peb = s.players[0].hand.find((c) => c.id === 'pebblit');
  assert.ok(peb);
  assert.equal(applyAction(s, 0, { type: 'bench', card: peb.uid, slot: 0 }).ok, false, 'occupied slot');
  const r = act(s, 0, { type: 'bench', card: peb.uid, slot: 1 });
  assert.equal(r.state.players[0].bench[1].id, 'pebblit');
});

test('knockout, score, promotion and win; rematch resets', () => {
  let s = fresh();
  // Force quick KOs by lowering HP directly in the test fixture.
  s.players[1].active.hp = 10;
  let r = act(s, 0, { type: 'attack', move: 'fangSnap' });
  assert.ok(r.events.some((e) => e.type === 'ko'));
  assert.equal(r.state.players[0].score, 1);
  assert.equal(r.state.phase, 'promote');
  assert.equal(r.state.pendingPromote, 1);
  assert.deepEqual(legalActions(r.state, 0), []);
  r = act(r.state, 1, { type: 'promote', bench: 0 });
  assert.equal(r.state.players[1].active.id, 'pebblit');
  assert.equal(r.state.players[1].active.hp, CARDS.pebblit.hp);
  assert.equal(r.state.current, 1, 'promoted player takes their turn');
  s = r.state;
  s.players[1].bench = [null, null, null];
  s.players[1].active.hp = 5;
  s = act(s, 1, { type: 'endTurn' }).state;
  r = act(s, 0, { type: 'attack', move: 'fangSnap' });
  assert.equal(r.state.phase, 'over');
  assert.equal(r.state.winner, 0);
  const re = act(r.state, 1, { type: 'rematch' });
  assert.equal(re.state.players[0].score, 0);
  assert.equal(re.state.players[1].active.hp, 60);
  assert.equal(re.state.players[1].active.charged, false);
  assert.ok(re.state.seq > r.state.seq, 'seq stays monotonic across rematch');
});

test('viewFor hides opponent hand and deck order', () => {
  const s = fresh();
  const v = viewFor(s, 1);
  assert.equal(v.players[0].hand.length, 0);
  assert.equal(v.players[0].handCount, 1);
  assert.equal(v.players[0].deck.length, 0);
});

test('AI vs AI always finishes a match with only legal actions', () => {
  for (let seed = 1; seed <= 60; seed++) {
    let x = seed;
    const rand = () => ((x = (x * 16807) % 2147483647) / 2147483647);
    let s = fresh();
    let steps = 0;
    while (s.phase !== 'over' && steps < 400) {
      const seat = s.phase === 'promote' ? s.pendingPromote : s.current;
      const a = chooseAction(s, seat, {}, rand);
      assert.ok(a, 'AI produced an action');
      s = act(s, seat, a).state;
      steps++;
    }
    assert.equal(s.phase, 'over', `seed ${seed} finished`);
    // Never wastes Potion on a full HP target (engine forbids it, AI never errored).
  }
});

test('empty deck: the draw is skipped, the turn still starts normally', () => {
  let s = fresh();
  s.players[1].deck = [];
  const r = act(s, 0, { type: 'endTurn' });
  const draw = r.events.find((e) => e.type === 'draw' && e.seat === 1);
  assert.equal(draw.empty, true);
  assert.equal(r.state.current, 1);
  assert.equal(r.state.players[1].hand.length, 0);
  assert.ok(legalActions(r.state, 1).some((a) => a.type === 'attack'), 'can still act');
});

test('End Turn passes the turn once and the next player draws', () => {
  const s = fresh();
  const r = act(s, 0, { type: 'endTurn' });
  assert.equal(r.state.current, 1);
  assert.equal(r.state.turn, 2);
  assert.equal(r.state.players[1].hand.length, 1);
  assert.equal(applyAction(r.state, 0, { type: 'endTurn' }).ok, false, 'a repeated End Turn is rejected');
});

test('retreat explanation changes once a reserve is benched', () => {
  let s = fresh();
  s.players[0].bench = [null, null, null];
  s.players[0].hand.push({ uid: 'x1', id: 'pebblit', hp: 50, maxHp: 50, charged: false });
  assert.equal(unavailableReason(s, 0, 'retreat'), 'Bench a Pokémon to retreat');
  s = act(s, 0, { type: 'bench', card: 'x1', slot: 2 }).state;
  assert.equal(unavailableReason(s, 0, 'retreat'), null);
});
