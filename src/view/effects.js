// Brief, lightweight battle effects. They only animate - they never change
// HP; HP bars are driven by the confirmed battle event.
import * as THREE from 'three';
import { tween, ease, lerp, blobTexture } from './util.js';

const additive = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const spriteMat = (color, opacity = 1, add = true) => new THREE.SpriteMaterial({ map: blobTexture(), color, transparent: true, opacity, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending });

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
function disposeTree(o) { o.traverse((c) => { if (!c.isSprite) c.geometry?.dispose(); c.material?.dispose?.(); }); o.removeFromParent(); } // textures are shared and kept

export class Effects {
  // viewQuat(out): writes the viewer's world orientation (set by the game)
  constructor(parent) { this.root = new THREE.Group(); parent.add(this.root); this.viewQuat = null; }

  // Compile every material variant the effects use, once, before the first
  // attack, so the first impact does not stall on shader compilation.
  prewarm(renderer, scene, camera) {
    const g = new THREE.Group(); g.scale.setScalar(1e-4); this.root.add(g);
    const tri = new THREE.BufferGeometry(); tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    g.add(new THREE.Mesh(tri, additive('#fff', 1)));
    g.add(new THREE.Mesh(tri, new THREE.MeshBasicMaterial({ color: '#000', transparent: true, depthWrite: false })));
    g.add(new THREE.Mesh(tri, new THREE.MeshBasicMaterial({ color: '#000', transparent: true, depthWrite: false, side: THREE.DoubleSide })));
    g.add(new THREE.Sprite(spriteMat('#fff', 1, true)), new THREE.Sprite(spriteMat('#fff', 1, false)));
    g.add(new THREE.Mesh(tri, new THREE.MeshStandardMaterial({ color: '#888', flatShading: true })));
    try { renderer.compile(scene, camera); } catch { /* compile is an optimisation only */ }
    // Keep these materials alive (never disposed): three.js frees a shader
    // program when its last material is disposed, so without keepers every
    // impact would recompile the same programs (measured: ~20-80 ms stalls).
    // ...and actually draw them for a couple of frames at sub-pixel size: some
    // backends (ANGLE/D3D, mobile GL) finish shader setup only on first draw.
    this.keeperDraws = 0;
    g.traverse((o) => { o.frustumCulled = false; if (o.isMesh || o.isSprite) o.onAfterRender = () => { this.keeperDraws++; }; });
    this.keepers = g;
  }
  // remove the warm-up meshes once they have really been drawn (twice)
  tick() { if (this.keepers?.parent && this.keeperDraws >= 2 * this.keepers.children.length) this.keepers.removeFromParent(); }
  disposeKeepers() { if (this.keepers) { disposeTree(this.keepers); this.keepers = null; } }
  clear() { [...this.root.children].forEach(disposeTree); }

  async projectile(kind,start,end,land) {
    const colors={water:'#5fcfff',ember:'#ff7029',vine:'#64a941',drain:'#9ade62',psychic:'#f38be8',ghost:'#a47bed',electric:'#ffe654'};
    const group=new THREE.Group();this.root.add(group);
    const material=new THREE.MeshBasicMaterial({color:colors[kind],transparent:true,opacity:.94});
    const stream=kind==='water'||kind==='vine';
    const geometry=stream?new THREE.CylinderGeometry(.0018,.0026,1,7):new THREE.IcosahedronGeometry(.008,1);
    const parts=Array.from({length:kind==='vine'?2:3},()=>{const mesh=new THREE.Mesh(geometry,material);group.add(mesh);return mesh;});
    const direction=new THREE.Vector3(),tip=new THREE.Vector3(),base=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
    await tween(.29,p=>parts.forEach((part,i)=>{
      const t=Math.max(0,p-i*.055);
      tip.lerpVectors(start,end,t);tip.y+=Math.sin(Math.PI*t)*(.006+i*.002);
      tip.x+=Math.sin(Math.PI*t)*(i-1)*.009;
      if(stream){
        base.lerpVectors(start,end,kind==='vine'?0:Math.max(0,t-.24));
        direction.subVectors(tip,base);part.scale.y=Math.max(.0001,direction.length());
        part.position.copy(base).lerp(tip,.5);if(direction.lengthSq())part.quaternion.setFromUnitVectors(up,direction.normalize());
      }else{part.position.copy(tip);part.scale.setScalar(1-i*.19);part.rotation.y=t*7;}
    }));
    land();await tween(.10,p=>{material.opacity=1-p;});
    group.removeFromParent();geometry.dispose();material.dispose();
  }

  // Bite: the effect PEAKS ON ITS FIRST FRAME (it is started by the single
  // impact event), as a dense violet bloom at the contact point. Curved
  // fang-like fragments flash outward and the centre clears within ~0.15 s so
  // the defender's recoil is visible.
  async fang(pos) {
    const g = new THREE.Group(); g.position.copy(pos); this.root.add(g);
    // normal-blended body keeps it violet on pale wood; a small additive core gives the hot centre
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.018, 18, 12), new THREE.MeshBasicMaterial({ color: '#7a1fd6', transparent: true, opacity: 0.85, depthWrite: false }));
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.009, 14, 10), additive('#f3d6ff', 1));
    const glow = new THREE.Sprite(spriteMat('#a23cff', 0.9)); glow.scale.setScalar(0.075);
    g.add(glow, orb, core);
    const frags = [];
    for (let i = 0; i < 6; i++) {
      const f = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0024, 5, 14, Math.PI * 0.7), new THREE.MeshBasicMaterial({ color: i % 2 ? '#d38cff' : '#9b3dff', transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      const a = (i / 6) * Math.PI * 2 + 0.3;
      f.userData.dir = new THREE.Vector3(Math.cos(a), Math.sin(a) * 0.8 + 0.15, Math.sin(a) * 0.4);
      f.rotation.set(0, 0, a + Math.PI / 2); // crescents open outward, like a bite mark
      g.add(f); frags.push(f);
    }
    await tween(0.36, (p) => {
      const clear = ease.out(Math.min(1, p / 0.42));          // centre clears in ~0.15 s
      orb.scale.setScalar(1 + 0.7 * clear); orb.material.opacity = 0.85 * (1 - clear);
      core.scale.setScalar(1 - 0.6 * clear); core.material.opacity = 1 - clear;
      glow.material.opacity = 0.9 * (1 - p) ** 2; glow.scale.setScalar(0.075 + 0.03 * p);
      for (const f of frags) {
        f.position.copy(f.userData.dir).multiplyScalar(0.012 + 0.038 * ease.out(p));
        f.material.opacity = p < 0.15 ? 1 : 1 - ease.in((p - 0.15) / 0.85);
        f.scale.setScalar(1 - 0.3 * p);
      }
    });
    disposeTree(g);
  }

  // Pika Punch: a bright core and a few distinct jagged branches with a dark
  // under-rim (reads on the lime field and on light wood), decaying fast.
  // Peaks on its first frame, re-jags once.
  async electric(pos) {
    const g = new THREE.Group(); g.position.copy(pos); this.root.add(g);
    const center = new THREE.Sprite(spriteMat('#fffdf0', 1)); center.scale.setScalar(0.04);
    const halo = new THREE.Sprite(spriteMat('#ffd000', 0.85)); halo.scale.setScalar(0.08);
    g.add(halo, center);
    const hot = additive('#fff27a', 1);
    const rim = new THREE.MeshBasicMaterial({ color: '#2a1d00', transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
    const quad = (out, a, b, w) => {
      const d = new THREE.Vector3().subVectors(b, a); const side = new THREE.Vector3(-d.y, d.x, 0).normalize().multiplyScalar(w);
      const a1 = a.clone().add(side), a2 = a.clone().sub(side), b1 = b.clone().addScaledVector(side, 0.6), b2 = b.clone().addScaledVector(side, -0.6);
      out.push(...a1.toArray(), ...a2.toArray(), ...b1.toArray(), ...a2.toArray(), ...b2.toArray(), ...b1.toArray());
    };
    const build = () => {
      for (const n of ['bolts', 'rim']) { const old = g.getObjectByName(n); if (old) { old.geometry.dispose(); g.remove(old); } }
      const hotV = [], rimV = [];
      const count = 5;
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2 + Math.random() * 0.5;
        const dir = new THREE.Vector3(Math.cos(ang), Math.sin(ang) * 0.9, 0); // branches lie in the view plane (billboarded below)
        const nrm = new THREE.Vector3(-dir.y, dir.x, 0);
        let p = dir.clone().multiplyScalar(0.006); const len = 0.032 + Math.random() * 0.016; const segs = 3;
        for (let s = 0; s < segs; s++) {
          const q = p.clone().addScaledVector(dir, len / segs).addScaledVector(nrm, (s % 2 ? -1 : 1) * (0.004 + Math.random() * 0.003));
          const w = 0.0026 * (1 - s / segs) + 0.0008;
          quad(rimV, p, q, w * 2.1); quad(hotV, p, q, w);
          p = q;
        }
      }
      const mk = (v, mat, name, order) => { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); const m = new THREE.Mesh(geo, mat); m.name = name; m.renderOrder = order; g.add(m); };
      mk(rimV, rim, 'rim', 30); mk(hotV, hot, 'bolts', 31);
    };
    build();
    let rejagged = false;
    await tween(0.32, (p) => {
      if (!rejagged && p > 0.25) { rejagged = true; build(); }
      const k = (1 - p) ** 2.2;                         // fast decay from a first-frame peak
      center.scale.setScalar(0.022 + 0.022 * k); center.material.opacity = k;
      halo.scale.setScalar(0.06 + 0.05 * p); halo.material.opacity = 0.85 * k;
      hot.opacity = k; rim.opacity = 0.45 * k;
      g.scale.setScalar(0.9 + 0.25 * ease.out(p));
      if (this.viewQuat) { this.viewQuat(_qa); this.root.getWorldQuaternion(_qb).invert(); g.quaternion.copy(_qb.multiply(_qa)); } // branches face the viewer
    });
    disposeTree(g); hot.dispose(); rim.dispose();
  }

  // Several muted purple-green clouds drift toward the target, expand and
  // dissipate. Resolves `onArrive` when the first cloud reaches the target.
  async spores(from, to, onArrive) {
    const g = new THREE.Group(); this.root.add(g);
    const colors = ['#8e7aa8', '#7f9a6a', '#a08cc0', '#6f8f5e', '#9b86b5'];
    const puffs = colors.map((c, i) => {
      const s = new THREE.Sprite(spriteMat(c, 0, false)); s.scale.setScalar(0.02); g.add(s);
      s.userData = { delay: i * 0.09, off: new THREE.Vector3((Math.random() - 0.5) * 0.03, Math.random() * 0.02, (Math.random() - 0.5) * 0.02) };
      return s;
    });
    let arrived = false;
    await tween(1.1, (p) => {
      for (const s of puffs) {
        const t = Math.max(0, Math.min(1, (p * 1.1 - s.userData.delay) / 0.75));
        const pos = new THREE.Vector3().lerpVectors(from, to, ease.out(t)).add(s.userData.off.clone().multiplyScalar(t));
        pos.y += Math.sin(t * Math.PI) * 0.02;
        s.position.copy(pos);
        s.scale.setScalar(0.02 + 0.05 * t);
        s.material.opacity = t <= 0 ? 0 : (t < 0.7 ? 0.75 : 0.75 * (1 - (t - 0.7) / 0.3));
      }
      if (!arrived && p > 0.5) { arrived = true; onArrive?.(); }
    });
    if (!arrived) onArrive?.();
    g.children.forEach((s) => s.material.dispose()); g.removeFromParent();
  }

  // Small yellow arcs collecting around the creature.
  async charge(pos) {
    const g = new THREE.Group(); g.position.copy(pos); this.root.add(g);
    const arcs = [];
    for (let i = 0; i < 7; i++) {
      const a = new THREE.Mesh(new THREE.TorusGeometry(0.01, 0.0012, 4, 10, Math.PI * 0.6), additive('#ffe14a', 0));
      a.userData = { ang: (i / 7) * Math.PI * 2, h: (Math.random() - 0.3) * 0.04, delay: i * 0.05 };
      g.add(a); arcs.push(a);
    }
    const glow = new THREE.Sprite(spriteMat('#ffd000', 0)); glow.scale.setScalar(0.08); g.add(glow);
    await tween(0.8, (p) => {
      for (const a of arcs) {
        const t = Math.max(0, Math.min(1, (p - a.userData.delay) / 0.6));
        const r = lerp(0.06, 0.012, ease.in(t));
        const ang = a.userData.ang + t * 3;
        a.position.set(Math.cos(ang) * r, a.userData.h * (1 - t), Math.sin(ang) * r);
        a.rotation.set(ang, ang * 0.5, 0);
        a.material.opacity = Math.sin(t * Math.PI);
      }
      glow.material.opacity = 0.7 * Math.sin(p * Math.PI);
    });
    disposeTree(g);
  }

  async rock(from, to, onArrive) {
    const g = new THREE.Group(); this.root.add(g);
    const chunks = [0, 1, 2].map((i) => {
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(0.006 - i * 0.0012, 0), new THREE.MeshStandardMaterial({ color: '#8d8274', flatShading: true }));
      c.userData.d = i * 0.05; g.add(c); return c;
    });
    let arrived = false;
    await tween(0.45, (p) => {
      for (const c of chunks) {
        const t = Math.min(1, Math.max(0, (p - c.userData.d) / 0.8));
        c.position.lerpVectors(from, to, t); c.position.y += Math.sin(t * Math.PI) * 0.05;
        c.rotation.x += 0.3; c.visible = t > 0 && t < 1;
      }
      if (!arrived && p > 0.8) { arrived = true; onArrive?.(); }
    });
    disposeTree(g);
    const dust = new THREE.Sprite(spriteMat('#cbb79a', 0.8, false)); dust.position.copy(to); this.root.add(dust);
    await tween(0.3, (p) => { dust.scale.setScalar(0.02 + 0.05 * p); dust.material.opacity = 0.8 * (1 - p); });
    dust.material.dispose(); dust.removeFromParent();
  }

  async knockout(pos) {
    const g = new THREE.Group(); g.position.copy(pos); this.root.add(g);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.01, 0.014, 32), additive('#ffffff', 0.8));
    ring.rotation.x = -Math.PI / 2; g.add(ring);
    const puffs = Array.from({ length: 6 }, (_, i) => { const s = new THREE.Sprite(spriteMat('#e8e8f0', 0.6, false)); s.userData.a = (i / 6) * Math.PI * 2; g.add(s); return s; });
    await tween(0.6, (p) => {
      ring.scale.setScalar(1 + p * 4); ring.material.opacity = 0.8 * (1 - p);
      for (const s of puffs) { s.position.set(Math.cos(s.userData.a) * 0.04 * p, 0.01 + 0.02 * p, Math.sin(s.userData.a) * 0.04 * p); s.scale.setScalar(0.015 + 0.02 * p); s.material.opacity = 0.6 * (1 - p); }
    });
    disposeTree(g);
  }

  async heal(pos) {
    const g = new THREE.Group(); g.position.copy(pos); this.root.add(g);
    const parts = Array.from({ length: 8 }, (_, i) => {
      const s = new THREE.Sprite(spriteMat('#7dff9a', 0)); s.scale.setScalar(0.012);
      s.userData = { x: (Math.random() - 0.5) * 0.04, z: (Math.random() - 0.5) * 0.04, d: i * 0.05 }; g.add(s); return s;
    });
    await tween(0.8, (p) => {
      for (const s of parts) { const t = Math.max(0, Math.min(1, (p - s.userData.d) / 0.6)); s.position.set(s.userData.x, t * 0.05, s.userData.z); s.material.opacity = Math.sin(t * Math.PI); }
    });
    disposeTree(g);
  }
}
