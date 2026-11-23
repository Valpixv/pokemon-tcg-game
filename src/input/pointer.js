// Unified pointing for mouse, tracked hands and controllers.
//
// Targets register a hit mesh. Every source produces a ray (and, for hands,
// a fingertip). Focus brightens a target before anything commits.
//  * buttons commit on press (immediate feedback)
//  * cards commit a tap on a short release, or a hold after `hold.duration`
//  * a new selection needs the previous press released first
//  * losing tracking mid-hold cancels the hold and changes nothing else
//  * small hand tremor is tolerated: focus is sticky within a few mm of the
//    focused target, and a hold survives brief drift; leaving the target
//    deliberately (beyond HOLD_SLOP for HOLD_GRACE) cancels the hold
import * as THREE from 'three';

const NEAR_DIST = 0.03;     // fingertip proximity focus (m)
const TAP_MAX = 0.35;       // seconds
const FOCUS_SLOP = 0.004;   // m: keep focus this far outside a target's box...
const FOCUS_GRACE = 0.12;   // s: ...for this long after the ray last hit it
const HOLD_SLOP = 0.012;    // m: a hold tolerates drift this far off its target...
const HOLD_GRACE = 0.15;    // s: ...and cancels after being further away this long

export class Interactables {
  constructor() { this.list = []; }
  add(t) { t.hit.userData.target = t; this.list.push(t); return t; }
  remove(t) { this.list = this.list.filter((x) => x !== t); }
  active() { return this.list.filter((t) => t.hit.visible !== false && isVisible(t.hit) && (!t.enabled || t.enabled())); }
}
function isVisible(o) { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; }

const _ray = new THREE.Raycaster();
const _box = new THREE.Box3();
const _hitsOut = [];

// Is the ray within `slop` metres of the target's world box?
function rayNear(ray, target, slop) {
  _box.setFromObject(target.hit).expandByScalar(slop);
  return ray.intersectsBox(_box);
}

export class PointerSource {
  constructor(name, kind) {
    Object.assign(this, { name, kind, origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), tip: null,
      valid: false, pressed: false, armed: true, focus: null, hold: null, hitPoint: null, hitDist: 0, releasePending: false,
      lastFocusHit: 0, _hitPoint: new THREE.Vector3() });
  }
  // Press/release helpers: a release that arrives before the frame loop saw
  // the press is held for one frame, so quick taps are never lost.
  down() { this.pressed = true; this.releasePending = false; }
  up() { if (this.wasPressed) this.pressed = false; else if (this.pressed) this.releasePending = true; }
  settle() { if (this.releasePending && this.wasPressed) { this.pressed = false; this.releasePending = false; } }
}

export class Pointers {
  constructor(interactables, { onCommit } = {}) {
    this.targets = interactables;
    this.sources = [];
    this.capture = null; // fn(source) -> true if a press was consumed (e.g. close preview)
    this.onCommit = onCommit;
    this.time = 0;
  }
  addSource(s) { this.sources.push(s); return s; }
  removeSource(s) { this.cancel(s); this.sources = this.sources.filter((x) => x !== s); }

  cancel(s) {
    if (s.hold) { const h = s.hold; s.hold = null; h.target.onPress?.(false, s); if (!h.done) h.target.hold?.onCancel?.(); }
    if (s.focus) { s.focus.onHover?.(false, s); s.focus = null; }
  }

  update(dt) {
    this.time += dt;
    const active = this.targets.active();
    const hitMeshes = active.map((t) => t.hit);
    for (const s of this.sources) {
      s.settle();
      if (!s.valid) { // tracking lost: drop focus, cancel an incomplete hold, require a fresh press
        if (s.hold || s.focus) this.cancel(s);
        s.armed = !s.pressed; s.wasPressed = s.pressed; s.hitPoint = null; // lost while pinching: that pinch must be released first
        continue;
      }
      _ray.set(s.origin, s.dir); _ray.far = 3;
      // ---- focus
      let focus = null; s.hitPoint = null;
      if (s.tip) {
        let best = NEAR_DIST;
        for (const t of active) {
          _box.setFromObject(t.hit);
          const d = _box.distanceToPoint(s.tip);
          if (d < best) { best = d; focus = t; s.hitPoint = s._hitPoint.copy(s.tip); }
        }
      }
      if (!focus) {
        _hitsOut.length = 0;
        const hits = _ray.intersectObjects(hitMeshes, false, _hitsOut);
        if (hits.length) {
          // prefer higher priority (buttons) when hits are nearly coincident
          hits.sort((a, b) => (a.distance - b.distance) - ((a.object.userData.target.priority || 0) - (b.object.userData.target.priority || 0)) * 0.01);
          const cur = s.focus && hits.find((h) => h.object.userData.target === s.focus);
          const h = cur || hits[0]; // a target that is still hit keeps focus (no flicker on overlaps)
          focus = h.object.userData.target; s.hitPoint = s._hitPoint.copy(h.point); s.hitDist = h.distance;
        } else if (s.focus && active.includes(s.focus) && this.time - s.lastFocusHit < FOCUS_GRACE && rayNear(_ray.ray, s.focus, FOCUS_SLOP)) {
          focus = s.focus; // tremor at a target's edge: keep it briefly instead of dropping focus
        }
      }
      if (focus && focus === s.focus && s.hitPoint) s.lastFocusHit = this.time;
      else if (focus !== s.focus && s.hitPoint) s.lastFocusHit = this.time;

      // ---- hold drift: tolerate tremor, cancel a deliberate move away
      if (s.hold && !s.hold.done) {
        if (focus === s.hold.target || rayNear(_ray.ray, s.hold.target, HOLD_SLOP)) s.hold.awaySince = null;
        else if (s.hold.awaySince == null) s.hold.awaySince = this.time;
        else if (this.time - s.hold.awaySince > HOLD_GRACE) { const h = s.hold; s.hold = null; h.cancelled = true; h.target.onPress?.(false, s); h.target.hold.onCancel?.(); }
      }
      if (s.hold && !s.hold.awaySince) focus = s.hold.target; // keep focus while holding on target
      if (focus !== s.focus) { s.focus?.onHover?.(false, s); focus?.onHover?.(true, s); s.focus = focus; }

      // ---- press edges
      const down = s.pressed && !s.wasPressed;
      const up = !s.pressed && s.wasPressed;
      s.wasPressed = s.pressed;
      if (!s.pressed) s.armed = true; // the release has been seen: the next press may commit

      if (down && s.armed) {
        s.armed = false;
        if (this.capture && this.capture(s)) continue;
        const t = s.focus;
        if (t) {
          t.onPress?.(true, s); // first-frame feedback for anything pressable
          if (t.hold) { s.hold = { target: t, start: this.time, done: false, awaySince: null }; t.hold.onStart?.(); t.hold.onProgress?.(0); }
          else { this.commit(t, s); t.onPress?.(false, s); }
        } else this.onMiss?.(s);
      }
      if (s.hold && s.pressed && !s.hold.done) {
        const p = Math.min(1, (this.time - s.hold.start) / s.hold.target.hold.duration);
        s.hold.target.hold.onProgress?.(p);
        if (p >= 1) { s.hold.done = true; s.hold.target.onPress?.(false, s); s.hold.target.hold.onComplete?.(); }
      }
      if (up && s.hold) {
        const h = s.hold; s.hold = null;
        if (!h.done) {
          h.target.onPress?.(false, s);
          h.target.hold.onCancel?.();
          // a short press that stayed on its target is a tap
          if (this.time - h.start <= TAP_MAX && !h.awaySince) this.commit(h.target, s);
        }
      }
    }
  }
  commit(t, s) {
    if (t.enabled && !t.enabled()) return;
    this.onCommit?.(t, s);
    t.onSelect?.(s);
  }
}

// Mouse source for the browser preview: left button = pinch.
export function attachMouse(pointers, dom, camera) {
  const s = pointers.addSource(new PointerSource('mouse', 'mouse'));
  const ndc = new THREE.Vector2();
  const ray = new THREE.Raycaster();
  let inside = false;
  const upd = () => { ray.setFromCamera(ndc, camera); s.origin.copy(ray.ray.origin); s.dir.copy(ray.ray.direction); };
  const setNdc = (e) => { const r = dom.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); inside = true; };
  dom.addEventListener('pointermove', setNdc);
  dom.addEventListener('pointerleave', () => { inside = false; });
  dom.addEventListener('pointerdown', (e) => { setNdc(e); if (e.button === 0) { upd(); s.valid = true; s.down(); } });
  window.addEventListener('pointerup', (e) => { if (e.button === 0) s.up(); });
  s.refresh = () => { s.valid = inside; if (inside) upd(); };
  return s;
}
