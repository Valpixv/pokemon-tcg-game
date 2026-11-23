// Pointer core: the same code path the mouse, tracked hands and controllers use.
// Two targets side by side like BITE and RETREAT, a hold target like a card.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Interactables, Pointers, PointerSource } from '../src/input/pointer.js';

const DT = 1 / 72; // Quest refresh

function setup() {
  const ix = new Interactables();
  const log = [];
  const plane = (x, z, w, h) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial());
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0, z); m.updateMatrixWorld(); return m;
  };
  // buttons 26 mm tall hit areas, 29 mm apart (as on the board)
  const bite = ix.add({ hit: plane(0, 0, 0.09, 0.026), onSelect: () => log.push('bite'), onPress: (on) => log.push(`bite:press:${on}`) });
  const retreat = ix.add({ hit: plane(0, 0.029, 0.09, 0.026), onSelect: () => log.push('retreat') });
  const card = ix.add({ hit: plane(0.2, 0, 0.063, 0.088), onSelect: () => log.push('tap'),
    hold: { duration: 0.75, onStart: () => log.push('hold:start'), onProgress: (p) => { log.at(-1) !== 'p' && log.push('p'); card.p = p; }, onComplete: () => log.push('inspect'), onCancel: () => log.push('hold:cancel') } });
  const P = new Pointers(ix);
  const s = P.addSource(new PointerSource('hand', 'xr'));
  s.valid = true;
  const aim = (x, z) => { s.origin.set(x, 0.4, z + 0.3); s.dir.set(0, -0.4, -0.3).normalize(); };
  const frames = (n) => { for (let i = 0; i < n; i++) P.update(DT); };
  return { P, s, aim, frames, log, card };
}

test('button commits on the first frame of the press, once', () => {
  const { s, aim, frames, log } = setup();
  aim(0, 0); frames(2);
  s.down(); frames(1);
  assert.deepEqual(log, ['bite:press:true', 'bite', 'bite:press:false']);
  frames(20); s.up(); frames(1);
  assert.equal(log.filter((l) => l === 'bite').length, 1, 'holding the pinch does not repeat');
});

test('release is required before a second commit; a release seen for one frame is enough', () => {
  const { s, aim, frames, log } = setup();
  aim(0, 0); frames(1);
  s.down(); frames(1); s.down(); frames(1); // still pressed: no second commit
  assert.equal(log.filter((l) => l === 'bite').length, 1);
  s.up(); frames(1); s.down(); frames(1);
  assert.equal(log.filter((l) => l === 'bite').length, 2);
});

test('a press and release inside one frame still counts (latched)', () => {
  const { s, aim, frames, log } = setup();
  aim(0, 0); frames(1);
  s.down(); s.up(); frames(2);
  assert.equal(log.filter((l) => l === 'bite').length, 1);
});

test('aiming at the edge between BITE and RETREAT picks exactly one; tremor keeps focus', () => {
  const { s, P, aim, frames, log } = setup();
  aim(0, 0.0128); frames(1);            // just inside BITE's hit area (edge at 13 mm)
  const first = s.focus;
  assert.ok(first);
  for (let i = 0; i < 20; i++) { aim(0, 0.0128 + (i % 2 ? 0.0012 : -0.0012)); frames(1); assert.equal(s.focus, first, 'focus does not flicker'); }
  s.down(); frames(1); s.up(); frames(1);
  assert.equal(log.filter((l) => l === 'bite' || l === 'retreat').length, 1);
  void P;
});

test('hold: tremor tolerated, completes once; drifting off cancels predictably with no tap', () => {
  const a = setup();
  a.aim(0.2, 0); a.frames(1); a.s.down(); a.frames(1);
  for (let i = 0; i < 60; i++) { a.aim(0.2 + (i % 2 ? 0.035 : -0.035), 0); a.frames(1); } // 3.5 cm jitter at the card edge region
  assert.ok(a.log.includes('inspect'), 'hold completed despite tremor');
  assert.equal(a.log.filter((l) => l === 'inspect').length, 1);
  a.s.up(); a.frames(1);
  assert.ok(!a.log.includes('tap'));

  const b = setup();
  b.aim(0.2, 0); b.frames(1); b.s.down(); b.frames(10);
  b.aim(0.45, 0); b.frames(Math.ceil(0.2 / DT)); // deliberately away for 0.2 s
  assert.ok(b.log.includes('hold:cancel'));
  b.aim(0.2, 0); b.frames(60);
  assert.ok(!b.log.includes('inspect'), 'a cancelled hold does not resume');
  b.s.up(); b.frames(1);
  assert.ok(!b.log.includes('tap'), 'no tap after a cancelled hold');
});

test('short press on a card is a tap; tracking loss mid-hold cancels and needs a fresh pinch', () => {
  const a = setup();
  a.aim(0.2, 0); a.frames(1); a.s.down(); a.frames(5); a.s.up(); a.frames(1);
  assert.deepEqual(a.log.filter((l) => l === 'tap'), ['tap']);

  const b = setup();
  b.aim(0.2, 0); b.frames(1); b.s.down(); b.frames(20);
  b.s.valid = false; b.frames(3);           // hand occluded / tracking lost while still pinching
  assert.ok(b.log.includes('hold:cancel'));
  b.s.valid = true; b.frames(60);           // tracking returns with the pinch still closed
  assert.ok(!b.log.includes('inspect'), 'no silent completion after reacquiring');
  assert.ok(!b.log.includes('tap'));
});

test('a pointer that appears and presses in the same frame commits (mouse entering the canvas)', () => {
  const { s, aim, frames, log } = setup();
  s.valid = false; frames(5);              // not over the canvas / not tracked, not pressed
  aim(0, 0); s.valid = true; s.down(); frames(1);
  assert.equal(log.filter((l) => l === 'bite').length, 1);
});
