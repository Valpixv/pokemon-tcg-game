// Browser test harness for the desktop preview (dev only, never imported by
// the game). Load it from the console of a running preview:
//   const H = await import('/tools/harness.js'); await H.ready();
// It drives the game through the real pointer path (synthetic pointer events
// on the canvas -> Pointers -> interactable targets) and steps the simulation
// deterministically with window.__step, so results do not depend on the
// tab being visible or on the machine's frame rate.

export const g = () => window.__game;
export const b = () => window.__game.board;
const canvas = () => window.__debug.renderer.domElement;

export async function ready(timeoutMs = 20000) {
  const t0 = performance.now();
  while (!(window.__game && window.__debug) && performance.now() - t0 < timeoutMs) await new Promise((r) => setTimeout(r, 50));
  if (!window.__game) throw new Error('game did not start'); // never pause a page that has not started
  window.__paused = true; // the harness owns time from here on
  await window.__step(0.1);
  return !!window.__game;
}

export function screen(obj) {
  const cam = window.__debug.camera; cam.updateMatrixWorld(); // the camera may have just moved
  const v = obj.isVector3 ? obj.clone() : obj.getWorldPosition(new obj.position.constructor());
  v.project(cam);
  return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];
}

function ev(type, x, y, target) {
  (target || canvas()).dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, pointerId: 1 }));
}
export const step = (s) => window.__step(s);

// Move to an object (or [x, y]), press, hold for `holdS`, release.
export async function tap(obj, holdS = 0.05, { after = 0.1, offset = [0, 0] } = {}) {
  const [x0, y0] = Array.isArray(obj) ? obj : screen(obj);
  const x = x0 + offset[0], y = y0 + offset[1];
  ev('pointermove', x, y); await step(1 / 60);
  ev('pointerdown', x, y); await step(holdS);
  ev('pointerup', x, y, window); await step(after);
}
export async function press(obj) { const [x, y] = Array.isArray(obj) ? obj : screen(obj); ev('pointermove', x, y); await step(1 / 60); ev('pointerdown', x, y); }
export async function moveTo(obj) { const [x, y] = Array.isArray(obj) ? obj : screen(obj); ev('pointermove', x, y); }
export function release() { ev('pointerup', 0, 0, window); }

export async function register() {
  await step(0.3);
  await tap(b().activeSlot); await tap(b().benchSlots[0]);
  await step(1.2);
  return g().phase;
}
export function seat(n) { window.__debug.setSeatView(n); window.__debug.camera.updateMatrixWorld(); }
// Let the compositor present the latest frame before a screenshot.
export const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

// Step in single frames until `cond()` is true (or `maxS` passes).
export async function until(cond, maxS = 6) {
  for (let t = 0; t < maxS; t += 1 / 60) { if (cond()) return t; await step(1 / 60); }
  return -1;
}

export function snapshot() {
  const st = g().st(); const p = st.players;
  return {
    phase: g().phase, current: st.current, turn: st.turn, matchPhase: st.phase,
    active: p.map((x) => x.active && `${x.active.id}#${x.active.uid} ${x.active.hp}/${x.active.maxHp}${x.active.charged ? ' charged' : ''}`),
    bench: p.map((x) => x.bench.map((c) => c && `${c.id}#${c.uid} ${c.hp}`)),
    bars: b().hpBars.map((h) => `${Math.round(h.hp)}/${h.max}`),
    score: p.map((x) => x.score),
  };
}

// From a fresh Quick Battle: register, press the first move, stop `afterImpact`
// seconds after the attack's single impact event (negative = before it).
export async function openingBite({ afterImpact = 2 / 60 } = {}) {
  await register(); await step(1);
  const G = g(), B = b(); G.stats.impacts.length = 0;
  await press(B.actionButtons[0]); await step(1 / 60); release();
  const tCallout = await until(() => B.callout.visible, 1);
  if (afterImpact < 0) { await step(Math.max(0, 0.2 + afterImpact)); return { tCallout }; }
  const tImpact = await until(() => G.stats.impacts.length > 0, 3);
  await step(afterImpact);
  return { tCallout, tImpact };
}

// Per-frame cost while the simulation runs for `seconds`: game step + render,
// with gl.finish() so GPU work is included (desktop WebGL only; this is not a
// headset measurement). Returns frame-time stats and the busiest frame's draw stats.
export async function profile(seconds, dt = 1 / 60) {
  const r = window.__debug.renderer, gl = r.getContext(), scene = window.__debug.scene, cam = window.__debug.camera;
  const frames = [];
  for (let t = 0; t < seconds; t += dt) {
    const t0 = performance.now();
    await window.__step(dt); // steps once and renders
    gl.finish();
    frames.push({ ms: performance.now() - t0, calls: r.info.render.calls, tris: r.info.render.triangles });
  }
  r.render(scene, cam);
  const ms = frames.map((f) => f.ms).sort((a, b) => a - b);
  const worst = frames.reduce((a, f) => (f.ms > a.ms ? f : a), frames[0]);
  const q = (p) => +ms[Math.min(ms.length - 1, Math.floor(p * ms.length))].toFixed(2);
  return { frames: frames.length, median: q(0.5), p95: q(0.95), max: q(1), worstCalls: worst.calls, worstTris: worst.tris, maxCalls: Math.max(...frames.map((f) => f.calls)) };
}

// Scene object counts, for leak checks across rematches.
export function counts() {
  const info = window.__debug.renderer.info;
  let objects = 0; window.__debug.scene.traverse(() => { objects++; });
  return { geometries: info.memory.geometries, textures: info.memory.textures, objects, interactables: window.__debug.interactables.list.length, programs: info.programs?.length };
}
