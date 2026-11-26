import * as THREE from 'three';
import { tween } from './util.js';

// A single reusable mesh holds the moving segments and fragments of one move.
// Each board presents confirmed attacks sequentially.
const styles = {
  vine: ['#3f702d', '#a4e05b'],
  water: ['#1594db', '#c5faff'],
  ember: ['#d44b1e', '#ffd782'],
  drain: ['#448f56', '#beff83'],
  electric: ['#aa701b', '#fff475'],
  ghost: ['#4a346e', '#ce8bfa'],
  psychic: ['#ab4694', '#ffb4e3'],
};

export class MoveTrail {
  constructor(root) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshBasicMaterial(), 56
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    root.add(this.mesh);
    this.transform = new THREE.Object3D();
    this.tint = new THREE.Color();
    this.pos = new THREE.Vector3();
    this.generation = 0;
  }

  particle(color, x, y, z, width, height, depth, angle = 0) {
    const i = this.mesh.count++;
    this.transform.position.set(x, y, z);
    this.transform.rotation.set(0, angle, angle * .6);
    this.transform.scale.set(width, height, depth);
    this.transform.updateMatrix();
    this.mesh.setMatrixAt(i, this.transform.matrix);
    this.mesh.setColorAt(i, this.tint.set(color));
  }

  refresh() {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.generation++;
    this.mesh.visible = false;
    this.mesh.count = 0;
  }

  async play(kind, start, end, impact) {
    this.clear();
    const generation = this.generation;
    const [body, edge] = styles[kind];
    const dist = Math.hypot(end.x-start.x, end.z-start.z) || 1;
    const sideX = (end.z-start.z)/dist, sideZ = (start.x-end.x)/dist;
    const trail = (from, to, progress, returning = false) => {
      this.mesh.count = 0;
      const strands = kind === 'vine' ? 2 : 1;
      const segments = strands === 2 ? 22 : 18;
      for (let j=0; j<strands; j++) {
        for (let i=0; i<segments; i++) {
          const u=i/(segments-1), tail=1-u;
          const t = kind==='vine' ? progress*u : progress-tail*.34;
          if(t<0) continue;
          const arc=Math.sin(Math.PI*t);
          this.pos.lerpVectors(from,to,t);
          let wave = 0, lift=.009*arc;
          if(kind==='vine') {wave=(j?1:-1)*arc*(.014+.006*Math.sin(6*t));lift+=arc*.011;}
          if(kind==='water') wave=Math.sin(18*t)*arc*.002;
          if(kind==='electric') wave=Math.sin(31*t)*arc*.007;
          if(kind==='ghost'||kind==='psychic'||returning) {wave=Math.sin(15*t)*arc*.009;lift+=Math.cos(15*t)*arc*.008;}
          if(kind==='ember') lift+=tail*tail*.016;
          const r=kind==='vine'?.0028:(.0014+.0045*u);
          this.particle(i%4===0?edge:body,this.pos.x+sideX*wave,this.pos.y+lift,this.pos.z+sideZ*wave,r,r,kind==='ember'?r*1.6:r,10*t);
        }
      }
      this.refresh();
    };
    this.mesh.visible=true;
    try {
      await tween(.28,p=>{if(this.generation===generation)trail(start,end,p);});
      if(this.generation!==generation)return;
      impact();
      await tween(kind==='drain'?.36:.26,p=>{
        if(this.generation!==generation)return;
        if(kind==='drain'){trail(end,start,p,true);return;}
        if(kind==='vine')trail(start,end,1-p);
        else this.mesh.count=0;
        for(let i=0;i<10;i++) {
          const angle=i*2.4, radius=(.006+p*.025)*(1+(i%3)*.14);
          const lift=kind==='ember'?p*.028:Math.sin(Math.PI*p)*.015;
          const r=(1-p)*.0032;
          this.particle(i%2?edge:body,end.x+Math.cos(angle)*radius,end.y+lift,end.z+Math.sin(angle)*radius,r,r*1.6,r,angle+p*4);
        }
        this.refresh();
      });
    } finally {
      if(this.generation===generation)this.clear();
    }
  }
}
