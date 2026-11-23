// Original stylised creatures built from shaped primitives, so the build
// needs no downloaded model assets. Each faces its local +Z (toward the
// opponent) and has idle / attack / hit / knockout animations.
import * as THREE from 'three';
import { buildRig, importedSpecies } from './imported.js';
import { tween, wait, ease, lerp, blobTexture } from './util.js';

const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.0, ...o });
const sphere = (r, mat, ws = 20, hs = 14) => new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), mat);

function oval(parent, material, position, radii) {
  const mesh = sphere(1, material);
  mesh.position.set(...position);
  mesh.scale.set(...radii);
  parent.add(mesh);
  return mesh;
}

// A raised ridge follows the silhouette from either side of the miniature.
function ridge(parent, material, points, radius) {
  const path = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  parent.add(new THREE.Mesh(new THREE.TubeGeometry(path, 14, radius, 6, false), material));
}

class Creature extends THREE.Group {
  constructor(id, { hover = false, height = 0.06 } = {}) {
    super();
    this.speciesId = id;
    this.hover = hover;
    this.height = height;
    this.body = new THREE.Group();      // animated root (bob, lunge)
    this.model = new THREE.Group();     // static shape
    this.body.add(this.model);
    this.add(this.body);
    this.phase = Math.random() * 10;
    this.busy = false;
    // contact / hover shadow
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: blobTexture('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.y = 0.0008;
    sh.scale.setScalar(hover ? 0.05 : 0.055);
    sh.renderOrder = 1;
    this.shadow = sh; this.add(sh);
    this.baseY = hover ? 0.03 : 0;
    this.body.position.y = this.baseY;
  }
  // Collect materials for hit flashes.
  finish() {
    this.mats = [];
    this.model.traverse((o) => { if (o.isMesh && o.material?.isMeshStandardMaterial) this.mats.push(o.material); });
    this.mats = [...new Set(this.mats)];
    this.mats.forEach((m) => { m.userData.emissive0 = m.emissive.clone(); m.userData.ei0 = m.emissiveIntensity; });
    return this;
  }
  update(dt, t) {
    const p = t + this.phase;
    if (this.hover) {
      this.body.position.y = this.baseY + Math.sin(p * 2.4) * 0.004 + (this.offY || 0);
      const s = 1 - Math.sin(p * 2.4) * 0.12;
      this.shadow.scale.setScalar((this.hover ? 0.05 : 0.055) * s * (this.shadowScale ?? 1));
    } else {
      this.body.position.y = this.baseY + Math.abs(Math.sin(p * 3.1)) * 0.0025 + (this.offY || 0);
      this.shadow.scale.setScalar(0.055 * (this.shadowScale ?? 1));
    }
    this.idle?.(dt, p);
  }
  flash(intensity) {
    for (const m of this.mats) {
      m.emissive.copy(m.userData.emissive0).lerp(new THREE.Color('#ffffff'), intensity);
      m.emissiveIntensity = Math.max(m.userData.ei0, intensity);
    }
  }
  setOpacity(a) {
    this.model.traverse((o) => { if (o.isMesh) { o.material.transparent = a < 1; o.material.opacity = a; } });
    this.shadow.material.opacity = a;
  }
  // Recoil away from the attacker (local -Z). The body snaps back first; the
  // model inside it lags and swings through a beat later (overlapping
  // action), then everything settles exactly to rest. Flash is tinted to
  // the move so a hit reads as violet or yellow, not as a white wash.
  async hit(tint = '#ffffff') {
    const col = new THREE.Color(tint);
    await tween(0.46, (p) => {
      const snap = p < 0.18 ? ease.out(p / 0.18) : 1 - ease.inOut((p - 0.18) / 0.82);
      this.body.position.z = -0.016 * snap;
      this.body.rotation.x = -0.38 * snap;
      // follow-through: the model trails the body and overshoots on the return
      const lagP = Math.max(0, p - 0.08) / 0.92;
      this.model.rotation.x = 0.22 * Math.sin(lagP * Math.PI * 1.6) * (1 - lagP);
      this.body.rotation.z = Math.sin(p * 34) * 0.06 * (1 - p);
      this.flashTint(col, Math.max(0, 1 - p * 3) * 0.55);
    });
    this.restPose(); this.flash(0);
  }
  flashTint(color, intensity) {
    for (const m of this.mats) {
      m.emissive.copy(m.userData.emissive0).lerp(color, Math.min(1, intensity * 1.6));
      m.emissiveIntensity = Math.max(m.userData.ei0, intensity);
    }
  }
  // Exact starting pose of the animated roots (idle keeps animating parts).
  restPose() {
    this.body.position.set(0, this.body.position.y, 0);
    this.body.rotation.set(0, 0, 0);
    this.body.scale.setScalar(1);
    this.model.rotation.x = 0;
    this.offY = 0;
  }
  async knockout() {
    await tween(0.7, (p) => {
      this.body.rotation.y = p * Math.PI * 2.5;
      this.body.scale.setScalar(Math.max(0.001, 1 - ease.in(p)));
      this.offY = this.hover ? -0.02 * p : 0.01 * Math.sin(p * Math.PI);
      this.setOpacity(1 - ease.in(p));
    });
    this.visible = false;
  }
  async appear() {
    this.visible = true; this.setOpacity(1); this.offY = 0;
    this.body.rotation.set(0, 0, 0);
    await tween(0.45, (p) => { this.body.scale.setScalar(ease.back(p)); });
    this.body.scale.setScalar(1);
  }
  // Default attack: short anticipation, a lunge, impact callback, return.
  async attack(onImpact) {
    await tween(0.16, (p) => { this.body.position.z = -0.012 * ease.out(p); });
    await tween(0.14, (p) => { this.body.position.z = lerp(-0.012, 0.05, ease.in(p)); });
    onImpact?.();
    await tween(0.32, (p) => { this.body.position.z = lerp(0.05, 0, ease.out(p)); });
    this.body.position.z = 0;
  }
  async chargeUp() {
    await tween(0.7, (p) => { this.body.scale.y = 1 - 0.1 * Math.sin(p * Math.PI); this.flash(0.25 * Math.sin(p * Math.PI)); });
    this.body.scale.y = 1; this.flash(0);
  }
}

// ---------------------------------------------------------------- Zubat
class Zubat extends Creature {
  constructor() {
    super('gloomwing', { hover: true, height: 0.07 });
    const blue = M('#249dd5'), dark = M('#1866a6'), pink = M('#dd48a1', { side: THREE.DoubleSide });
    const m = this.model; m.position.y = 0.012;
    oval(m, blue, [0, 0, 0], [0.015, 0.018, 0.013]);
    const ivory = M('#fff1d5');
    oval(m, M('#261428'), [0, .005, .0086], [.0123, .0111, .0054]);
    for (const s of [-1, 1]) {
      const ear = new THREE.Group(); m.add(ear);
      ear.position.set(s * .009, .014, 0); ear.rotation.z = -s * .60;
      const outline = new THREE.Shape();
      outline.moveTo(0, 0); outline.quadraticCurveTo(-.010,.007,0,.023);
      outline.quadraticCurveTo(.011,.007,0,0);
      ear.add(new THREE.Mesh(new THREE.ExtrudeGeometry(outline, { depth:.002, bevelEnabled:false }),blue));
      const inner = new THREE.Mesh(new THREE.ShapeGeometry(outline),pink);
      inner.scale.set(.70,.72,1); inner.position.set(0,.002,.0021); ear.add(inner);
      for (const upper of [true,false]) {
        const fang = new THREE.Mesh(new THREE.ConeGeometry(.0017,.0046,8),ivory);
        fang.position.set(s * .0068, upper ? .0112 : -.0014,.0129);
        fang.rotation.z = upper ? Math.PI - s*.16 : s*.16; m.add(fang);
      }
      const leg = new THREE.Mesh(new THREE.ConeGeometry(.0015,.026,7),blue);
      leg.position.set(s*.006,-.025,-.003); leg.rotation.set(.25,0,Math.PI+s*.13); m.add(leg);
      const pivot = new THREE.Group(); pivot.position.set(s*.012,.004,-.002);
      const wing = new THREE.Group();
      const shape = new THREE.Shape();
      shape.moveTo(0,.003);
      shape.quadraticCurveTo(.016,.003,.027,.031);
      shape.quadraticCurveTo(.046,.018,.052,-.015);
      shape.quadraticCurveTo(.040,-.005,.032,-.021);
      shape.quadraticCurveTo(.018,-.007,0,-.008);
      shape.closePath();
      wing.add(new THREE.Mesh(new THREE.ShapeGeometry(shape,12),pink));
      ridge(wing,blue,[[0,.003,0],[.016,.013,0],[.027,.031,0],[.043,.011,0],[.052,-.015,0]],.0013);
      ridge(wing,dark,[[.027,.031,0],[.025,.011,0],[.032,-.021,0]],.00085);
      wing.scale.x = s; wing.rotation.x = Math.PI / 2 * 0.15;
      pivot.add(wing); m.add(pivot);
      (this.wings ||= []).push({ pivot, s });
    }
    this.finish();
  }
  idle(dt, p) {
    const flap = Math.sin(p * 9) * 0.55 + 0.1;
    for (const w of this.wings) { w.pivot.rotation.z = w.s * flap; w.pivot.rotation.y = -w.s * 0.25; }
  }
  async attack(onImpact) {
    // Draw back and aim, then dart forward on an arc that rises and swings to
    // one side, so at contact it is above and beside the target instead of
    // parked between it and the player. Then brake, return to its own side
    // and take a short settling beat at exactly the starting pose.
    const reach = 0.098, side = 0.03, lift = 0.034;
    await tween(0.2, (p) => { const k = ease.out(p); this.body.position.z = -0.016 * k; this.offY = 0.006 * k; this.body.rotation.x = -0.32 * k; }); // offY: update() owns position.y
    await tween(0.13, (p) => {
      const k = ease.in(p);
      this.body.position.z = lerp(-0.016, reach, k);
      this.body.position.x = side * Math.sin(k * Math.PI * 0.5);
      this.offY = 0.006 + lift * Math.sin(k * Math.PI * 0.5);
      this.body.rotation.x = lerp(-0.32, 0.55, k); // mouth-first, pitched down at the target
    });
    onImpact?.();
    const z0 = this.body.position.z, x0 = this.body.position.x, y0 = this.offY;
    await tween(0.1, (p) => { this.body.position.z = z0 - 0.008 * ease.out(p); this.body.rotation.x = lerp(0.55, -0.2, ease.out(p)); }); // brake
    const z1 = this.body.position.z;
    await tween(0.34, (p) => {
      const k = ease.inOut(p);
      this.body.position.z = lerp(z1, 0, k); this.body.position.x = lerp(x0, 0, k);
      this.offY = lerp(y0, 0, k); this.body.rotation.x = lerp(-0.2, 0, k);
    });
    this.offY = 0;
    await tween(0.18, (p) => { this.body.rotation.x = 0.08 * Math.sin(p * Math.PI * 2) * (1 - p); }); // settle
    this.restPose();
  }
}

// ------------------------------------------------------------------ Pikachu
class Pikachu extends Creature {
  constructor() {
    super('voltpip', { height: 0.076 });
    const gold = M('#ffd532'), ink = M('#221c26'), brown = M('#96512e');
    const m = this.model;
    oval(m, gold, [0, .023, 0], [.017, .022, .014]);
    oval(m, gold, [0, .047, .002], [.021, .017, .016]);
    this.ears = [];
    this.paws = [];
    for (const side of [-1, 1]) {
      const ear = new THREE.Group();
      ear.position.set(side * .012, .056, .001); m.add(ear);
      const profile = [[.001,0],[.0047,.006],[.0053,.013],[.0046,.018],[.003,.023],[0,.029]];
      for (const [section,material] of [[profile.slice(0,4),gold],[profile.slice(3),ink]]) {
        const geometry = new THREE.LatheGeometry(section.map(([r,y]) => new THREE.Vector2(r,y)),16);
        const blade = new THREE.Mesh(geometry,material);
        blade.scale.z=.68; ear.add(blade);
      }
      this.ears.push(ear);
      oval(m, ink, [side*.008,.049,.0165], [.0028,.0034,.0016]);
      oval(m, M('#ffffff'), [side*.008-.0006,.0505,.0179], [.001,.001,.0005]);
      oval(m, M('#eb4230'), [side*.015,.0415,.013], [.0043,.0038,.0024]);
      oval(m, gold, [side*.01,.004,.005], [.007,.004,.011]);
      this.paws.push(oval(m, gold, [side*.014,.026,.009], [.005,.009,.005]));
    }
    oval(m, ink, [0,.045,.018], [.0018,.001,.001]);
    ridge(m,ink,[[-.004,.042,.017],[0,.041,.0177],[.004,.042,.017]],.00055);
    for (const y of [.024,.032]) {
      // Follow the torso surface so the stripes also sit flush in profile.
      const stripe = [-.011,-.006,0,.006,.011].map(x => {
        const py = y - .001 + .003*(x/.011)**2;
        const z = -.014*Math.sqrt(1-(x/.017)**2-((py-.023)/.022)**2);
        return [x,py,z+.00055];
      });
      ridge(m,brown,stripe,.00125);
    }
    this.tail = new THREE.Group(); this.tail.position.set(.005,.014,-.014); m.add(this.tail);
    const points = [[0,0],[.009,.008],[.004,.012],[.015,.021],[.009,.024],[.030,.047],[.040,.035],[.020,.022],[.025,.019],[.012,.012],[.016,.008],[.003,0]];
    const shape = new THREE.Shape(points.map(([x,y]) => new THREE.Vector2(x,y)));
    this.tail.add(new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.003,bevelEnabled:false}),gold));
    const base = new THREE.Shape([points[0],points[1],points[2],points[3],points[9],points[10],points[11]].map(([x,y])=>new THREE.Vector2(x,y)));
    const root = new THREE.Mesh(new THREE.ExtrudeGeometry(base,{depth:.0035,bevelEnabled:false}),brown);
    root.position.z=-.00025; this.tail.add(root);
    this.finish();
  }
  idle(dt,p) {
    this.ears.forEach((ear,i) => { ear.rotation.z = (i ? -1 : 1) * (.43 + .06*Math.sin(p*4+i)); });
    this.tail.rotation.x = -.38 + .08*Math.sin(p*4);
    this.paws.forEach((paw,i) => { paw.rotation.x = .5 + .1*Math.sin(p*4+i); });
  }
  async attack(onImpact) {
    // crouch, lean forward, strike, recover
    await tween(0.18, (p) => { this.body.scale.y = 1 - 0.18 * ease.out(p); this.body.scale.x = this.body.scale.z = 1 + 0.08 * p; });
    await tween(0.12, (p) => {
      this.body.scale.y = lerp(0.82, 1.06, p); this.body.scale.x = this.body.scale.z = lerp(1.08, 0.97, p);
      this.body.position.z = 0.045 * ease.in(p); this.body.rotation.x = 0.5 * p;
    });
    onImpact?.();
    await tween(0.36, (p) => {
      this.body.position.z = lerp(0.045, 0, ease.out(p)); this.body.rotation.x = lerp(0.5, 0, ease.out(p));
      this.body.scale.setScalar(1); this.body.scale.y = lerp(1.06, 1, p);
    });
    this.body.position.z = 0; this.body.rotation.x = 0; this.body.scale.setScalar(1);
  }
}

// ----------------------------------------------------------------- Koffing
// Gas vents wrap around the sphere, leaving room for the face and skull marking.
class Koffing extends Creature {
  constructor() {
    super('puffmire', { hover: true, height: 0.07 });
    // Paint the grin and belly emblem directly onto the curved skin. The UV
    // seam sits on the flank, clear of the face and its three-quarter view.
    const skin = document.createElement('canvas'); skin.width=768; skin.height=384;
    const ctx = skin.getContext('2d');
    ctx.fillStyle='#a698c9'; ctx.fillRect(0,0,768,384);
    ctx.translate(192,185); ctx.scale(1.25,1.12);
    const ellipse = (x,y,rx,ry,color) => {
      ctx.fillStyle=color; ctx.beginPath(); ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2); ctx.fill();
    };
    for (const side of [-1,1]) {
      ellipse(side*39,-30,15,9,'#3b3147'); ellipse(side*39,-31,13,7,'#fff8ec');
      ellipse(side*37,-33,2,4,'#332739');
    }
    ctx.fillStyle='#442d44'; ctx.beginPath(); ctx.moveTo(-50,-10);
    ctx.quadraticCurveTo(0,-3,50,-13); ctx.bezierCurveTo(34,22,-25,27,-50,-10); ctx.fill();
    ellipse(2,8,21,5,'#cb88a1');
    for (const side of [-1,1]) {
      ctx.fillStyle='#fff3da'; ctx.beginPath(); ctx.moveTo(side*41,-9);
      ctx.lineTo(side*33,-8); ctx.lineTo(side*36,0); ctx.fill();
    }
    const cream='#f7e9cb';
    ctx.strokeStyle=cream; ctx.lineWidth=7; ctx.lineCap='round';
    for (const side of [-1,1]) {
      ctx.beginPath(); ctx.moveTo(side*23,48); ctx.lineTo(-side*23,69); ctx.stroke();
      ellipse(side*23,48,5,5,cream); ellipse(-side*23,69,5,5,cream);
    }
    ellipse(0,34,15,10,cream); ellipse(0,41,8,5,cream); ellipse(0,34,7,4,'#625876');
    const map = new THREE.CanvasTexture(skin); map.colorSpace = THREE.SRGBColorSpace;
    const lilac = M('#a899c5', { roughness:.9 });
    const m = this.model; m.position.y = .014;
    const body = sphere(.024,M('#ffffff',{map,roughness:.95}),40,28);
    const positions=body.geometry.attributes.position;
    for(let i=0;i<positions.count;i++){
      const x=positions.getX(i), y=positions.getY(i), z=positions.getZ(i);
      const k=1+.045*Math.sin(145*x+80*y)*Math.cos(130*z-60*y);
      positions.setXYZ(i,x*k*1.04,y*k,z*k);
    }
    body.geometry.computeVertexNormals(); m.add(body);
    // irregular raised vents
    const vents = [[0.7, 0.6], [-0.75, 0.4], [0.2, 1.0], [-0.3, -0.2], [0.9, -0.3], [-0.95, -0.5], [1.68, .28], [-1.65, -.4], [2.1,-.63], [2.6, 0.5], [3.4, -0.1]];
    this.vents = [];
    for (const [az, el] of vents) {
      const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el) * -1 + 0.0);
      if (dir.z > 0.55 && Math.abs(dir.x) < 0.5 && dir.y < 0.5) continue; // keep face clear
      const v = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.0055, 0.006, 10, 1, true), lilac);
      const cap = new THREE.Mesh(new THREE.CircleGeometry(0.0038, 10), M('#3d2a52'));
      cap.rotation.x = -Math.PI / 2; cap.position.y = 0.0025; v.add(cap);
      v.position.copy(dir.clone().multiplyScalar(0.0235));
      v.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      m.add(v); this.vents.push(v);
    }
    this.finish();
  }
  idle(dt, p) {
    this.model.rotation.z = Math.sin(p * 1.3) * 0.08;
    this.model.rotation.x = Math.sin(p * 0.9) * 0.05;
    this.vents.forEach((v, i) => v.scale.setScalar(1 + Math.max(0, Math.sin(p * 2 + i * 1.7)) * 0.15));
  }
  async attack(onImpact) {
    await tween(0.35, (p) => { this.body.rotation.x = 0.4 * ease.out(p); this.body.scale.setScalar(1 + 0.08 * Math.sin(p * Math.PI)); });
    onImpact?.(); // clouds launch; the effect decides when they land
    await tween(0.45, (p) => { this.body.rotation.x = lerp(0.4, 0, ease.inOut(p)); });
    this.body.rotation.x = 0; this.body.scale.setScalar(1);
  }
}

// ------------------------------------------------------------------ Geodude
class Geodude extends Creature {
  constructor() {
    super('pebblit', { hover: false, height: 0.055 });
    const stone = M('#918c82', { flatShading: true, roughness: 0.95 });
    const m = this.model;
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.022, 1), stone);
    body.position.y = 0.026; body.scale.set(1.05, 0.95, 0.95); m.add(body);
    const browStone = M('#837f78',{roughness:.96,flatShading:true});
    const facet = (parent,mat,pos,scale,tilt=0) => {
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1,0),mat);
      rock.position.set(...pos); rock.scale.set(...scale); rock.rotation.z=tilt; parent.add(rock);
    };
    facet(m,stone,[-.005,.044,-.003],[.013,.006,.012],-.12);
    facet(m,browStone,[.008,.032,-.016],[.014,.011,.007],.32);
    this.arms = [];
    for (const side of [-1,1]) {
      const eye = oval(m,M('#fff5df'),[side*.008,.03,.019],[.005,.003,.0018]);
      eye.rotation.z = side*.3;
      facet(m,browStone,[side*.009,.034,.0175],[.010,.004,.004],side*.43);
      oval(m,M('#302e2d'),[side*.0068,.03,.021],[.0013,.002,.001]);
      const arm = new THREE.Group(); arm.position.set(side*.019,.022,0); m.add(arm);
      const upper = oval(arm,stone,[side*.006,.002,0],[.01,.005,.005]); upper.rotation.z = side*.28;
      oval(arm,stone,[side*.015,.009,0],[.006,.010,.006]);
      oval(arm,stone,[side*.015,.018,.001],[.008,.007,.007]);
      for (let i=0;i<3;i++) oval(arm,stone,[side*(.011+i*.0035),.02,.006],[.0024,.0037,.0025]);
      const thumb = oval(arm,browStone,[side*.010,.016,.005],[.004,.003,.004]);
      thumb.rotation.z=side*.4;
      this.arms.push(arm);
    }
    oval(m,M('#48413c'),[0,.019,.019],[.008,.001,.0015]);
    this.finish();
  }
  idle(dt, p) { this.arms.forEach((a, i) => { a.position.y = 0.022 + Math.sin(p * 2 + i) * 0.0012; }); }
  async attack(onImpact) {
    await tween(0.22, (p) => { this.body.rotation.x = -0.35 * ease.out(p); this.arms.forEach((a) => { a.position.y = 0.022 + 0.014 * p; }); });
    await tween(0.12, (p) => { this.body.rotation.x = lerp(-0.35, 0.3, p); });
    onImpact?.();
    await tween(0.35, (p) => { this.body.rotation.x = lerp(0.3, 0, ease.out(p)); this.arms.forEach((a) => { a.position.y = lerp(0.036, 0.022, p); }); });
    this.body.rotation.x = 0;
  }
}

const CLASSES = { gloomwing: Zubat, voltpip: Pikachu, puffmire: Koffing, pebblit: Geodude };
class ImportedCreature extends Creature {
  constructor(id, source) {
    super(id,{hover:['gastly','magnemite'].includes(id)});
    this.rig = buildRig(source,id);
    this.model.add(this.rig.rig);
    if(id==='eevee'){
      this.tailRoot=this.rig.nodes.get('tail1');
      this.tailRest=this.tailRoot.rotation.y;
    }
    if(id==='charmander'){
      const tail=this.rig.nodes.get('fire');
      const flame=new THREE.Mesh(new THREE.OctahedronGeometry(1),M('#ff9637',{emissive:'#ef5718',emissiveIntensity:.6}));
      flame.position.y=3;flame.scale.set(1.55,3.7,1.55);tail.add(flame);
      this.flame=flame;
    }
    if(id==='gastly'){
      const cloud=M('#8254a6',{roughness:1});
      this.mist=Array.from({length:6},(_,i)=>{
        const puff=new THREE.Mesh(new THREE.IcosahedronGeometry(.006+i%3*.0016,0),cloud);this.model.add(puff);return puff;
      });
    }
    const joints = {bulbasaur:'bulb',charmander:'jaw',squirtle:'head_rotation',eevee:'ears',gastly:'body',psyduck:'head',sandshrew:'arm_right',magnemite:'magnet_right'};
    this.strikeJoint=this.rig.nodes.get(joints[id]);this.actionPose=0;
    this.finish();
  }
  idle(dt,t) {
    if(this.strikeJoint && this.jointOffset)this.strikeJoint.rotation.x-=this.jointOffset;
    this.rig.pose(t);this.jointOffset=this.actionPose;
    if(this.strikeJoint)this.strikeJoint.rotation.x+=this.jointOffset;
    if(this.tailRoot)this.tailRoot.rotation.y=this.tailRest+.15*Math.sin(t*3.4);
    if(this.flame)this.flame.scale.y=3.7+.55*Math.sin(t*14);
    this.mist?.forEach((p,i)=>{const a=i*Math.PI/3+t*.7;p.position.set(Math.cos(a)*.029,.025+Math.sin(a*2)*.012,Math.sin(a)*.023);});
  }
  launchPoint() {
    const node = ['muzzle','bill','jaw','bulb','magnet_right','head','body'].map(n=>this.rig.nodes.get(n)).find(Boolean);
    return node.getWorldPosition(new THREE.Vector3());
  }
  async attack(impact) {
    const tilt = this.hover ? .26 : -.32;
    const reach={eevee:.074,sandshrew:.065,charmander:.043}[this.speciesId]||.020;
    await tween(.18,p=>{ this.body.rotation.x=tilt*ease.out(p); this.body.scale.y=1-.1*p; });
    await tween(.15,p=>{this.actionPose=.48*Math.sin(p*Math.PI*.5);this.body.position.z=reach*ease.in(p);this.body.rotation.x=lerp(tilt,.22,p);});
    impact?.();
    await tween(.29,p=>{this.actionPose=.48*(1-p);this.body.position.z=reach*(1-ease.out(p));this.body.rotation.x=.22*(1-p);this.body.scale.y=.9+.1*p;});
    this.restPose();
  }
}
export function makeCreature(id, source) {
  if (importedSpecies.includes(id)) return new ImportedCreature(id,source);
  const C = CLASSES[id];
  if (!C) throw new Error(`No model for ${id}`);
  return new C();
}
export const creatureIds = Object.keys(CLASSES);
