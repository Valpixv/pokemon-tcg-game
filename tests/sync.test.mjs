// Two-client simulation: host (authoritative, seat 0) and guest (seat 1)
// over an in-memory link that behaves like the WebSocket relay.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from '../src/rules/engine.js';
import { QUICK_BATTLE } from '../src/rules/data.js';
import { createHostSession, createGuestSession, memoryLinkPair, MatchClient } from '../src/net/match.js';

const flush = () => new Promise((r) => setTimeout(r, 5));

function setup() {
  const [hostLink, guestLink] = memoryLinkPair();
  const host = createHostSession(createMatch(QUICK_BATTLE), hostLink);
  const guest = createGuestSession(guestLink);
  const log = { host: [], guest: [] };
  host.client.on('update', (u) => log.host.push(u));
  guest.client.on('update', (u) => log.guest.push(u));
  return { host, guest, log, hostLink, guestLink };
}

test('both clients agree on turn ownership and HP from one confirmed event', async () => {
  const { host, guest, log } = setup();
  await flush();
  assert.equal(guest.client.state.current, 0);
  // Guest tries to act on host's turn: rejected, nothing changes.
  const rejects = [];
  guest.client.on('reject', (r) => rejects.push(r));
  guest.client.request({ type: 'attack', move: 'sparkJab' });
  await flush();
  assert.equal(rejects.length, 1);
  assert.equal(rejects[0].error, 'Not your turn');

  host.client.request({ type: 'attack', move: 'fangSnap' });
  await flush();
  const hAtk = log.host.flatMap((u) => u.events).filter((e) => e.type === 'attack');
  const gAtk = log.guest.flatMap((u) => u.events).filter((e) => e.type === 'attack');
  assert.equal(hAtk.length, 1);
  assert.equal(gAtk.length, 1);
  assert.deepEqual(hAtk[0], gAtk[0]);
  assert.equal(guest.client.state.players[1].active.hp, 40);
  assert.equal(host.client.state.players[1].active.hp, 40);
  assert.equal(guest.client.state.current, 1);
});

test('rapid repeated requests resolve exactly one attack', async () => {
  const { host, log } = setup();
  await flush();
  for (let i = 0; i < 5; i++) host.client.request({ type: 'attack', move: 'fangSnap' });
  await flush();
  const atk = log.host.flatMap((u) => u.events).filter((e) => e.type === 'attack');
  assert.equal(atk.length, 1);
  assert.equal(host.authority.state.players[1].active.hp, 40);
});

test('a duplicated network message is applied once', async () => {
  const { host, guestLink } = setup();
  await flush();
  host.client.request({ type: 'endTurn' });
  await flush();
  const msg = { t: 'req', reqId: 'dup-1', action: { type: 'attack', move: 'sparkJab' } };
  guestLink.send(msg); guestLink.send(msg); guestLink.send(msg);
  await flush();
  assert.equal(host.authority.state.players[0].active.hp, 20);
});

test('duplicate update delivery to a client is ignored', async () => {
  const c = new MatchClient(1, () => {});
  const seen = [];
  c.on('update', (u) => seen.push(u));
  const state = { seq: 3 };
  c.receive({ t: 'snapshot', seq: 3, state, epoch: 'e' });
  c.receive({ t: 'update', seq: 4, state: { seq: 4 }, events: [{ type: 'attack' }], epoch: 'e' });
  c.receive({ t: 'update', seq: 4, state: { seq: 4 }, events: [{ type: 'attack' }], epoch: 'e' });
  assert.equal(seen.length, 2);
  assert.equal(seen[1].events.length, 1);
});

test('reconnect recovers from a snapshot without replaying the last hit', async () => {
  const { host, log } = setup();
  await flush();
  host.client.request({ type: 'attack', move: 'fangSnap' });
  await flush();
  // Guest headset drops and comes back on a new link.
  const [hostLink2, guestLink2] = memoryLinkPair();
  host.authority.attach(1, (m) => hostLink2.send(m));
  hostLink2.onMessage((m) => host.authority.handle(1, m));
  const { createGuestSession: mk } = await import('../src/net/match.js');
  const g2 = mk(guestLink2);
  const g2log = [];
  g2.client.on('update', (u) => g2log.push(u));
  await flush();
  assert.equal(g2log.length, 1);
  assert.equal(g2log[0].snapshot, true);
  assert.equal(g2log[0].events.length, 0, 'no replayed attack event');
  assert.equal(g2.client.state.players[1].active.hp, 40);
  assert.equal(log.host.flatMap((u) => u.events).filter((e) => e.type === 'attack').length, 1);
});

test('guest hand stays private', async () => {
  const { guest } = setup();
  await flush();
  assert.equal(guest.client.state.players[0].hand.length, 0);
  assert.equal(guest.client.state.players[0].handCount, 1);
});
