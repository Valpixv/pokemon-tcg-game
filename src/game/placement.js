// Table placement and alignment. Works for XR (detected planes / hit-test /
// virtual plane) and for the browser preview (the virtual table top).
//
// Single headset:  point at table centre, pinch, rotate so the near edge
//                  faces you, resize if needed, confirm.
// Same table:      both players pinch the same two physical points in the
//                  same order - arena centre, then a point on the HOST's side.
//                  A preview shows the centreline and seats before confirming.
import * as THREE from 'three';
import { Button3D } from '../view/board.js';
import { Label } from '../view/util.js';
import { ARENA } from '../view/arena.js';

export class Placement {
  constructor({ scene, interactables, pointers, surface, head, onConfirm, twoPoint = false, localSeat = 0, initial = null }) {
    Object.assign(this, { scene, ix: interactables, pointers, surface, head, onConfirm, twoPoint, localSeat });
    this.group = new THREE.Group(); scene.add(this.group);
    this.pos = new THREE.Vector3(); this.yaw = 0; this.scale = initial?.scale || 1;
    this.step = 'aim'; this.pointA = null;
    this.buildGhost();
    this.buildUI();
    if (initial) { this.pos.copy(initial.pos); this.yaw = initial.yaw; this.scale = initial.scale; }
    // A pinch that lands on no button places / picks the point.
    this.prevMiss = pointers.onMiss;
    pointers.onMiss = (s) => this.onPinch(s);
    this.setStep('aim');
  }

  buildGhost() {
    const g = new THREE.Group(); this.ghost = g; this.group.add(g);
    const mat = new THREE.MeshBasicMaterial({ color: '#8fe03a', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(ARENA.radius, 40), mat); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.002; g.add(disc);
    const zone = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.26), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
    zone.rotation.x = -Math.PI / 2; zone.position.set(0, 0.001, 0.31); g.add(zone);
    const far = zone.clone(); far.position.z = -0.31; far.material = zone.material.clone(); far.material.opacity = 0.06; g.add(far);
    // centreline and "near edge" arrow
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.004, 0.9), new THREE.MeshBasicMaterial({ color: '#7ff0ff', transparent: true, opacity: 0.8, depthWrite: false }));
    line.rotation.x = -Math.PI / 2; line.position.y = 0.003; g.add(line);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.04, 3), new THREE.MeshBasicMaterial({ color: '#7ff0ff' }));
    arrow.rotation.x = Math.PI / 2; arrow.position.set(0, 0.01, 0.46); g.add(arrow);
    this.seatLabels = [0, 1].map((s) => {
      const l = new Label({ width: 0.16, height: 0.03, px: 512, font: '700 64px system-ui', bg: 'rgba(20,30,40,0.6)', radius: 0.4 });
      l.position.set(0, 0.05, s === 0 ? 0.47 : -0.47); g.add(l); return l;
    });
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.012, 0.018, 32), new THREE.MeshBasicMaterial({ color: '#ffffff', depthWrite: false, side: THREE.DoubleSide }));
    this.reticle.rotation.x = -Math.PI / 2; this.group.add(this.reticle);
    this.markA = new THREE.Mesh(new THREE.SphereGeometry(0.008), new THREE.MeshBasicMaterial({ color: '#ffcf5a' })); this.markA.visible = false; this.group.add(this.markA);
  }

  buildUI() {
    this.ui = new THREE.Group(); this.group.add(this.ui);
    this.instr = new Label({ width: 0.34, height: 0.07, px: 1024, font: '600 52px system-ui, sans-serif', bg: 'rgba(20,24,32,0.72)', radius: 0.2, lineHeight: 1.3, border: 'rgba(255,255,255,0.25)' });
    this.group.add(this.instr);
    const mk = (t, fn, w = 0.07) => { const b = new Button3D(t, { w, h: 0.024, interactables: this.ix, priority: 3, onSelect: fn, enabled: () => this.active }); this.ui.add(b); return b; };
    this.buttons = {
      rotL: mk('⟲ ROTATE', () => { this.yaw += Math.PI / 12; }),
      rotR: mk('ROTATE ⟳', () => { this.yaw -= Math.PI / 12; }),
      face: mk('FACE ME', () => this.faceHead()),
      smaller: mk('SMALLER', () => { this.scale = Math.max(0.8, +(this.scale - 0.05).toFixed(2)); }),
      larger: mk('LARGER', () => { this.scale = Math.min(1.2, +(this.scale + 0.05).toFixed(2)); }),
      move: mk('MOVE', () => this.setStep('aim')),
      confirm: mk('CONFIRM', () => this.confirm(), 0.09),
      redo: mk('REDO', () => this.setStep('aim')),
    };
    this.active = true;
  }

  setStep(step) {
    this.step = step;
    const two = this.twoPoint;
    const text = {
      aim: two ? 'Point at the CENTRE of the table and pinch.\nYou and your friend pick the same spot.' : 'Point at the centre of a clear table and pinch.',
      aimB: 'Now pinch a point on the HOST\'s side of the table,\nnear their edge (the same point your friend uses).',
      adjust: two ? 'Check the centreline points at the host and your seat label\nis on your side. CONFIRM or REDO.' : 'Rotate so the arrow points at you. Resize if the table is small.\nThen CONFIRM.',
    }[step];
    this.instr.set(text);
    const show = (names) => Object.entries(this.buttons).forEach(([k, b]) => { b.visible = names.includes(k); });
    if (step === 'aim' || step === 'aimB') { show([]); this.ghost.visible = step === 'aimB'; this.markA.visible = step === 'aimB'; }
    else { this.ghost.visible = true; this.markA.visible = false; show(two ? ['confirm', 'redo'] : ['rotL', 'rotR', 'face', 'smaller', 'larger', 'move', 'confirm']); }
    this.seatLabels.forEach((l, s) => { l.visible = two; l.set(s === 0 ? (this.localSeat === 0 ? 'HOST · YOU' : 'HOST') : (this.localSeat === 1 ? 'GUEST · YOU' : 'GUEST')); });
  }

  faceHead() {
    const h = this.head(); const d = new THREE.Vector3(h.x - this.pos.x, 0, h.z - this.pos.z);
    if (d.lengthSq() > 1e-4) this.yaw = Math.atan2(d.x, d.z);
  }

  onPinch(s) {
    if (!this.active) return;
    const p = this.surface(s.origin, s.dir);
    if (!p) return;
    if (this.step === 'aim') {
      this.pos.copy(p);
      if (this.twoPoint) { this.pointA = p.clone(); this.markA.position.copy(p); this.setStep('aimB'); }
      else { this.faceHead(); this.setStep('adjust'); }
    } else if (this.step === 'aimB') {
      const d = new THREE.Vector3().subVectors(p, this.pointA); d.y = 0;
      if (d.length() < 0.08) { this.instr.set('Pick a point further from the centre,\non the host\'s side.'); return; }
      this.pos.copy(this.pointA);
      this.yaw = Math.atan2(d.x, d.z); // +Z of the table frame points at the host (seat 0)
      this.setStep('adjust');
    }
  }

  confirm() {
    this.active = false;
    const result = { pos: this.pos.clone(), yaw: this.yaw, scale: this.scale };
    this.dispose();
    this.onConfirm(result);
  }

  update(dt) {
    if (!this.active) return;
    // ghost follows the pointer while aiming
    const src = this.pointers.sources.find((s) => s.valid);
    let hit = null;
    if (src) hit = this.surface(src.origin, src.dir);
    this.reticle.visible = !!hit && (this.step === 'aim' || this.step === 'aimB');
    if (hit) this.reticle.position.copy(hit).add(new THREE.Vector3(0, 0.002, 0));
    if (this.step === 'aim' && hit) { this.ghost.visible = !this.twoPoint; this.ghost.position.copy(hit); this.faceHeadPreview(hit); }
    else if (this.step === 'aimB' && hit) {
      this.ghost.position.copy(this.pointA);
      const d = new THREE.Vector3().subVectors(hit, this.pointA); this.ghost.rotation.y = Math.atan2(d.x, d.z);
    } else { this.ghost.position.copy(this.pos); this.ghost.rotation.y = this.yaw; }
    this.ghost.scale.setScalar(this.scale);
    // floating UI: instruction above the far side, buttons along the near-right
    const h = this.head();
    const base = this.step === 'adjust' ? this.pos : (hit || this.pos);
    const toHead = new THREE.Vector3(h.x - base.x, 0, h.z - base.z).normalize();
    if (!isFinite(toHead.x)) toHead.set(0, 0, 1);
    const right = new THREE.Vector3(toHead.z, 0, -toHead.x);
    const yawToHead = Math.atan2(toHead.x, toHead.z);
    this.instr.position.copy(base).addScaledVector(toHead, -0.05).add(new THREE.Vector3(0, 0.22, 0));
    this.instr.rotation.set(-0.15, yawToHead, 0, 'YXZ');
    this.ui.position.copy(base).addScaledVector(right, 0.3).addScaledVector(toHead, 0.12).add(new THREE.Vector3(0, 0.06, 0));
    this.ui.rotation.set(0, yawToHead - 0.5, 0);
    const visible = Object.values(this.buttons).filter((b) => b.visible);
    visible.forEach((b, i) => { b.position.set((i % 2) * 0.075 - 0.0375, -Math.floor(i / 2) * 0.03 + 0.04, 0); b.rotation.x = -0.3; });
  }
  faceHeadPreview(p) { const h = this.head(); this.ghost.rotation.y = Math.atan2(h.x - p.x, h.z - p.z); }

  dispose() {
    for (const b of Object.values(this.buttons)) b.dispose();
    this.pointers.onMiss = this.prevMiss;
    this.group.removeFromParent();
  }
}
