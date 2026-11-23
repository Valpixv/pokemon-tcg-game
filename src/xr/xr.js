// WebXR plumbing for Quest Browser: passthrough AR session, hand/controller
// pointer sources, table surface queries and spatial anchors.
import * as THREE from 'three';
import { PointerSource } from '../input/pointer.js';

export async function arSupported() {
  try { return !!navigator.xr && await navigator.xr.isSessionSupported('immersive-ar'); } catch { return false; }
}

export async function startAR(renderer, overlayRoot) {
  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['local-floor'],
    optionalFeatures: ['hand-tracking', 'hit-test', 'plane-detection', 'anchors', ...(overlayRoot ? ['dom-overlay'] : [])],
    ...(overlayRoot ? { domOverlay: { root: overlayRoot } } : {}),
  });
  renderer.xr.setReferenceSpaceType('local-floor');
  await renderer.xr.setSession(session);
  return session;
}

// Hands and controllers -> PointerSources. Pinch / trigger = select.
export class XRInput {
  constructor(renderer, scene, pointers) {
    this.renderer = renderer; this.pointers = pointers; this.entries = [];
    for (let i = 0; i < 2; i++) {
      const ctrl = renderer.xr.getController(i); scene.add(ctrl);
      const hand = renderer.xr.getHand(i); scene.add(hand);
      const src = new PointerSource(`xr${i}`, 'xr');
      pointers.addSource(src);
      const e = { ctrl, hand, src, input: null, hitSource: null };
      // subtle ray + cursor + fingertip dot
      const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
      e.ray = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({ color: '#bff6ff', transparent: true, opacity: 0.35 }));
      e.cursor = new THREE.Mesh(new THREE.SphereGeometry(0.004, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthTest: false }));
      e.tipDot = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 10, 8), new THREE.MeshBasicMaterial({ color: '#7ff0ff', transparent: true, opacity: 0.8 }));
      scene.add(e.ray, e.cursor, e.tipDot); e.ray.visible = e.cursor.visible = e.tipDot.visible = false;
      ctrl.addEventListener('connected', (ev) => { e.input = ev.data; src.pressed = false; src.armed = false; this.requestHitTest(e); });
      ctrl.addEventListener('disconnected', () => { e.input = null; src.valid = false; src.pressed = false; e.hitSource?.cancel?.(); e.hitSource = null; });
      ctrl.addEventListener('selectstart', () => { src.down(); });
      ctrl.addEventListener('selectend', () => { src.up(); });
      this.entries.push(e);
    }
  }
  async requestHitTest(e) {
    const session = this.renderer.xr.getSession();
    if (!session?.requestHitTestSource || !e.input) return;
    try { e.hitSource = await session.requestHitTestSource({ space: e.input.targetRaySpace }); } catch { e.hitSource = null; }
  }
  // dt in seconds. The pointing ray is lightly smoothed with frame-rate
  // independent damping (time constant RAY_TAU): enough to calm hand tremor
  // at arm's length without making the cursor trail behind a deliberate move.
  update(dt = 1 / 72) {
    const RAY_TAU = 0.035;
    const k = 1 - Math.exp(-dt / RAY_TAU);
    for (const e of this.entries) {
      const { ctrl, hand, src } = e;
      const wasValid = src.valid;
      src.valid = !!e.input && ctrl.visible !== false && !!ctrl.matrixWorld;
      if (src.valid) {
        ctrl.updateMatrixWorld();
        _o.setFromMatrixPosition(ctrl.matrixWorld);
        _d.set(0, 0, -1).transformDirection(ctrl.matrixWorld);
        if (!wasValid || !e.smoothed) { src.origin.copy(_o); src.dir.copy(_d); e.smoothed = true; } // no lag after reacquiring
        else { src.origin.lerp(_o, k); src.dir.lerp(_d, k).normalize(); }
      } else e.smoothed = false;
      src.tip = null;
      const tipJoint = e.input?.hand ? hand.joints?.['index-finger-tip'] : null;
      if (tipJoint && tipJoint.visible) { src.tip = tipJoint.getWorldPosition(e.tipPos || (e.tipPos = new THREE.Vector3())); }
      // a hand whose joints are not tracked is not a valid pointer
      if (e.input?.hand && !src.tip) src.valid = false;
      e.tipDot.visible = !!src.tip; if (src.tip) e.tipDot.position.copy(src.tip);
      const len = src.hitPoint ? src.origin.distanceTo(src.hitPoint) : 0.35;
      e.ray.visible = src.valid; e.cursor.visible = src.valid && !!src.hitPoint;
      if (src.valid) {
        e.ray.position.copy(src.origin); e.ray.quaternion.setFromUnitVectors(_fwd, src.dir); e.ray.scale.set(1, 1, len);
        e.ray.material.opacity = src.focus ? 0.6 : 0.25;
        e.cursor.scale.setScalar(src.pressed ? 0.7 : src.focus ? 1.3 : 1); // press/focus readable on the cursor itself
        if (src.hitPoint) e.cursor.position.copy(src.hitPoint);
      }
    }
  }
}
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _fwd = new THREE.Vector3(0, 0, -1);

// Table surface query for placement: detected horizontal planes, then
// hit-test results, then a virtual plane at an adjustable height.
export class XRSurface {
  constructor(renderer, input) { this.renderer = renderer; this.input = input; this.virtualY = 0.74; this.lastFrame = null; this.source = 'virtual'; }
  setFrame(frame) { this.lastFrame = frame; }
  raycast(origin, dir) {
    const frame = this.lastFrame; const ref = this.renderer.xr.getReferenceSpace();
    let best = null, bestD = Infinity;
    if (frame?.detectedPlanes && ref) {
      for (const plane of frame.detectedPlanes) {
        if (plane.orientation !== 'horizontal' && plane.orientation !== 'Horizontal') continue;
        const pose = frame.getPose(plane.planeSpace, ref); if (!pose) continue;
        const m = new THREE.Matrix4().fromArray(pose.transform.matrix); const inv = m.clone().invert();
        const o = origin.clone().applyMatrix4(inv); const d = dir.clone().transformDirection(inv);
        if (Math.abs(d.y) < 1e-4) continue;
        const t = -o.y / d.y; if (t <= 0 || t > 3) continue;
        const p = o.clone().addScaledVector(d, t);
        if (!pointInPolygon(p.x, p.z, plane.polygon)) continue;
        const world = p.applyMatrix4(m);
        if (world.y < 0.3 || world.y > 1.3) continue; // floor/ceiling are not tables
        if (t < bestD) { bestD = t; best = world; }
      }
      if (best) { this.source = 'plane'; this.virtualY = best.y; return best; }
    }
    // hit-test from whichever input currently points (if the browser supports it)
    if (frame && ref) for (const e of this.input.entries) {
      if (!e.hitSource) continue;
      const res = frame.getHitTestResults(e.hitSource);
      if (res.length) {
        const pose = res[0].getPose(ref);
        if (pose) {
          const p = new THREE.Vector3(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
          if (p.y > 0.3 && p.y < 1.3 && Math.abs(p.clone().sub(origin).normalize().dot(dir)) > 0.98) { this.source = 'hit-test'; this.virtualY = p.y; return p; }
        }
      }
    }
    // virtual plane
    if (Math.abs(dir.y) < 1e-3) return null;
    const t = (this.virtualY - origin.y) / dir.y; if (t <= 0 || t > 3) return null;
    this.source = 'virtual';
    return origin.clone().addScaledVector(dir, t);
  }
}
function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

// Spatial anchor for the table pose. Persisted when the browser supports it.
const ANCHOR_KEY = 'tcb-table-anchor';
export class TableAnchor {
  constructor(renderer) { this.renderer = renderer; this.anchor = null; }
  async create(frame, pos, yaw, scale) {
    this.anchor = null;
    const ref = this.renderer.xr.getReferenceSpace();
    if (!frame?.createAnchor || !ref) return false;
    try {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      this.anchor = await frame.createAnchor(new XRRigidTransform({ x: pos.x, y: pos.y, z: pos.z }, { x: q.x, y: q.y, z: q.z, w: q.w }), ref);
      let uuid = null;
      if (this.anchor?.requestPersistentHandle) { try { uuid = await this.anchor.requestPersistentHandle(); } catch { uuid = null; } }
      try { localStorage.setItem(ANCHOR_KEY, JSON.stringify({ uuid, scale })); } catch { /* storage unavailable */ }
      return true;
    } catch { this.anchor = null; return false; }
  }
  async restore(session) {
    let saved = null; try { saved = JSON.parse(localStorage.getItem(ANCHOR_KEY) || 'null'); } catch { saved = null; }
    if (!saved?.uuid || !session.restorePersistentAnchor) return null;
    try { this.anchor = await session.restorePersistentAnchor(saved.uuid); return { scale: saved.scale || 1 }; } catch { return null; }
  }
  // Returns {pos, quat} when the anchor is tracked this frame.
  pose(frame) {
    if (!this.anchor || !frame) return null;
    const ref = this.renderer.xr.getReferenceSpace();
    const p = frame.getPose(this.anchor.anchorSpace, ref); if (!p) return null;
    const t = p.transform;
    return { pos: new THREE.Vector3(t.position.x, t.position.y, t.position.z), quat: new THREE.Quaternion(t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w) };
  }
  clear() { this.anchor?.delete?.(); this.anchor = null; }
}
