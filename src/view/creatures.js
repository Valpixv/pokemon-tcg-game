// Tabletop figures face local +Z. Imported and sculpted figures share the same combat poses.
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

class Creature extends THREE.Group {
  constructor(id, { hover = false, height = 0.06 } = {}) {
    super();
    this.speciesId = id;
    this.hover = hover;
    this.height = height;
    this.anchors = new Map();
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
  anchor(name, parent, x, y, z) {
    const point = new THREE.Object3D();
    point.name = name;
    point.position.set(x, y, z);
    parent.add(point);
    this.anchors.set(name, point);
    return point;
  }
  setGuarded(active) {
    if (!this.guardShell && active) {
      const material = new THREE.MeshBasicMaterial({
        color: '#91e8fd', transparent: true, opacity: .32, wireframe: true, depthWrite: false
      });
      this.guardShell = new THREE.Mesh(new THREE.IcosahedronGeometry(1,0),material);
      this.body.add(this.guardShell);
      this.guardShell.position.y=this.height*.42;
      this.guardShell.scale.set(this.radius*1.12,this.height*.58,this.radius*1.12);
    }
    if(this.guardShell)this.guardShell.visible=Boolean(active);
  }
  getAnchor(name) {
    return this.anchors.get(name) || this.anchors.get('center');
  }
  // Called before the figure is attached to a seat. Bounds are in table metres.
  finish() {
    this.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model);
    const mid = box.getCenter(new THREE.Vector3());
    this.height = box.max.y;
    this.radius = Math.max(box.max.x-box.min.x,box.max.z-box.min.z)/2;
    for (const [name, y, z] of [
      ['center', mid.y, mid.z], ['top', box.max.y, mid.z],
      ['base', box.min.y, mid.z], ['front', mid.y, box.max.z]
    ]) {
      if (!this.anchors.has(name)) this.anchor(name, this.body, mid.x, y-this.baseY, z);
    }
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
    this.flash(.85); // white-hot frame held through the hit-stop, before the tinted recoil
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
  async guard() {
    const curl = this.speciesId === 'sandshrew';
    await tween(.56, p => {
      const brace = p < .3 ? ease.out(p/.3) : p < .65 ? 1 : 1-ease.inOut((p-.65)/.35);
      this.body.scale.set(1+.08*brace, 1-.24*brace, 1-.08*brace);
      this.body.rotation.x = brace*(curl ? .82 : .26);
      this.body.rotation.y = brace*(curl ? .24 : .85);
    });
    this.restPose();
  }
  async celebrate() {
    await tween(.68, p => {
      const lift = Math.sin(Math.PI*p);
      this.offY = lift*lift*(this.hover ? .009 : .013);
      this.body.rotation.z = .13*Math.sin(2*Math.PI*p)*lift;
    });
    this.restPose();
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
    this.anchor('mouth', m, 0, 0, .024);
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
      if (az === 2.1) this.anchors.set('front', cap);
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
    this.armLift = 0;
    this.anchor('mouth', m, 0, .019, .020);
    for (const side of [-1,1]) {
      const eye = oval(m,M('#fff5df'),[side*.008,.03,.019],[.005,.003,.0018]);
      eye.rotation.z = side*.3;
      facet(m,browStone,[side*.009,.034,.0175],[.010,.004,.004],side*.43);
      oval(m,M('#302e2d'),[side*.0068,.03,.021],[.0013,.002,.001]);
      const arm = new THREE.Group(); arm.position.set(side*.019,.022,0); m.add(arm);
      const upper = oval(arm,stone,[side*.006,.002,0],[.01,.005,.005]); upper.rotation.z = side*.28;
      oval(arm,stone,[side*.015,.009,0],[.006,.010,.006]);
      const fist = oval(arm,stone,[side*.015,.018,.001],[.008,.007,.007]);
      this.anchors.set(side < 0 ? 'handR' : 'handL', fist);
      for (let i=0;i<3;i++) oval(arm,stone,[side*(.011+i*.0035),.02,.006],[.0024,.0037,.0025]);
      const thumb = oval(arm,browStone,[side*.010,.016,.005],[.004,.003,.004]);
      thumb.rotation.z=side*.4;
      this.arms.push(arm);
    }
    oval(m,M('#48413c'),[0,.019,.019],[.008,.001,.0015]);
    this.finish();
  }
  idle(dt, p) {
    this.arms.forEach((a, i) => {
      a.position.y = .022 + Math.sin(p*2+i)*.0012 + this.armLift*(i ? .004 : .014);
      a.rotation.x = this.armLift*(i ? .18 : .82);
    });
  }
  async attack(onImpact) {
    await tween(0.22, (p) => { this.armLift = ease.out(p); this.body.rotation.x = -.35*this.armLift; });
    await tween(0.12, (p) => { this.body.rotation.x = lerp(-0.35, 0.3, p); });
    onImpact?.();
    await tween(0.35, (p) => { this.armLift = 1-ease.out(p); this.body.rotation.x = .3*this.armLift; });
    this.body.rotation.x = 0;
  }
}

const CLASSES = { puffmire: Koffing, pebblit: Geodude };
class ImportedCreature extends Creature {
  constructor(id, source) {
    super(id,{hover:['gloomwing','gastly','magnemite'].includes(id)});
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
    const joints = {gloomwing:'torso',voltpip:'arm_right',bulbasaur:'bulb',charmander:'jaw',squirtle:'head_rotation',eevee:'ears',gastly:'body',psyduck:'head',sandshrew:'arm_right',magnemite:'magnet_right'};
    this.strikeJoint=this.rig.nodes.get(joints[id]);this.actionPose=0;
    const sockets = {
      mouth: 'locator_mouth', handR: 'locator_hand_primary', handL: 'locator_hand_secondary',
      front: {bulbasaur:'bulb',magnemite:'magnet_right'}[id] || 'locator_mouth'
    };
    for (const [name, bone] of Object.entries(sockets)) {
      const node = this.rig.nodes.get(bone);
      if (node) this.anchors.set(name, node);
    }
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
    return this.getAnchor('front').getWorldPosition(new THREE.Vector3());
  }
  async attack(impact) {
    const tilt = this.hover ? .26 : -.32;
    const reach={gloomwing:.081,voltpip:.052,eevee:.074,sandshrew:.065,charmander:.043}[this.speciesId]||.020;
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
export const creatureIds = [...Object.keys(CLASSES), ...importedSpecies];
