import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const cache = new Map();
const rad = Math.PI / 180;
const extent = {bulbasaur:.078,charmander:.079,squirtle:.072,eevee:.081,gastly:.061,psyduck:.073,sandshrew:.070,magnemite:.080};
export const importedSpecies = Object.keys(extent);

function rotation(angles = [0,0,0]) {
  return new THREE.Euler(-angles[0]*rad,angles[1]*rad,-angles[2]*rad,'ZYX');
}

function cubeGeometry(cube, bone, desc) {
  const [x,y,z] = cube.origin, [w,h,d] = cube.size;
  const inflate = 2*(cube.inflate || 0);
  const geo = new THREE.BoxGeometry(Math.max(.002,w+inflate), Math.max(.002,h+inflate), Math.max(.002,d+inflate));
  const uv = geo.attributes.uv, [u,v] = cube.uv;
  // Bedrock's unwrapped box, in Three's +X,-X,+Y,-Y,+Z,-Z face order.
  const faces = [[u+d+w,v+d,d,h],[u,v+d,d,h],[u+d,v,w,d],[u+d+w,v+d,w,-d],[u+2*d+w,v+d,w,h],[u+d,v+d,w,h]];
  const mirror = cube.mirror ?? bone.mirror;
  if (mirror) [faces[0],faces[1]]=[faces[1],faces[0]];
  faces.forEach(([left,top,width,height],i)=>{
    for(let k=0;k<4;k++){
      const right=Boolean(k%2)!==Boolean(mirror);
      uv.setXY(i*4+k,(left+(right?width:0))/desc.texture_width,1-(top+(k>=2?height:0))/desc.texture_height);
    }
  });
  const pivot = cube.pivot || bone.pivot || [0,0,0];
  const base = bone.pivot || [0,0,0];
  geo.translate(x+w/2-pivot[0],y+h/2-pivot[1],z+d/2-pivot[2]);
  geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rotation(cube.rotation)));
  geo.translate(...pivot.map((p,i)=>p-base[i]));
  return geo;
}

async function load(id) {
  const root = import.meta.env.BASE_URL+'models/'+id+'/';
  const json = async file => { const r=await fetch(root+file); if(!r.ok) throw Error('Missing '+id+' '+file); return r.json(); };
  const [raw,animation,skin]=await Promise.all([json('model.json'),json('idle.json'),new THREE.TextureLoader().loadAsync(root+'skin.png')]);
  skin.colorSpace=THREE.SRGBColorSpace; skin.magFilter=THREE.NearestFilter; skin.userData.shared=true;
  const definition=raw['minecraft:geometry'][0];
  const bones=definition.bones.map(b=>{
    const parts=(b.cubes||[]).map(c=>cubeGeometry(c,b,definition.description));
    const mesh=parts.length?mergeGeometries(parts,false):null;
    if(mesh) mesh.userData.shared=true;
    parts.forEach(p=>p.dispose());
    return {...b,mesh};
  });
  return {bones,animation,skin};
}

export function prepareModel(id) {
  if (!cache.has(id)) cache.set(id,load(id).catch(error=>{cache.delete(id);throw error;}));
  return cache.get(id);
}

export function buildRig(source,id) {
  const rig=new THREE.Group(), nodes=new Map(), pivots=new Map();
  const material=new THREE.MeshStandardMaterial({map:source.skin,roughness:.9,alphaTest:.45,side:THREE.DoubleSide});
  for(const b of source.bones){
    const node=new THREE.Bone(); node.name=b.name; nodes.set(b.name,node);
    pivots.set(b.name,new THREE.Vector3(...(b.pivot||[0,0,0])));
    if(b.mesh)node.add(new THREE.Mesh(b.mesh,material));
    node.rotation.copy(rotation(b.rotation));
    // Alternate facial expressions and equipment are additional meshes on these source rigs.
    if(/eyelid|ditto|blush|glasses|mouth_open|emote2|pupil_closed|eye_angry|eye_sad|pupil_happy|pupil_recoil|angry_eye|tongue|mouth_full|mouth_half|^vine_|^ball$/.test(b.name))node.visible=false;
  }
  for(const b of source.bones){
    const node=nodes.get(b.name);node.position.copy(pivots.get(b.name));
    if(b.parent)node.position.sub(pivots.get(b.parent));
    (nodes.get(b.parent)||rig).add(node);
  }
  const {duration,fps,tracks}=source.animation;
  const channels=tracks.filter(([name])=>nodes.has(name)).map(([name,property,frames])=>{
    const node=nodes.get(name);
    return {node,property,frames,base:property==='rotation'?node.rotation.toArray().slice(0,3):node.position.toArray()};
  });
  function pose(time) {
    const index=(time%duration)*fps,i=Math.floor(index),f=index-i;
    for(const {node,property,frames,base} of channels){
      const a=frames.length===1?frames[0]:frames[i],b=frames.length===1?a:frames[i+1];
      const x=a[0]+f*(b[0]-a[0]),y=a[1]+f*(b[1]-a[1]),z=a[2]+f*(b[2]-a[2]);
      if(property==='rotation')node.rotation.set(base[0]-rad*x,base[1]+rad*y,base[2]-rad*z,'ZYX');
      else if(property==='scale')node.scale.set(x,y,z);
      else node.position.set(base[0]-x,base[1]+y,base[2]+z);
    }
  }
  pose(0);
  rig.updateMatrixWorld(true);
  // Bake the visible cubes into one draw while keeping their original animated joints.
  const parts = [];
  rig.traverseVisible(node => { if (node.isMesh) parts.push(node); });
  if (!source.geometry) {
    const weighted = parts.map((part, index) => {
      const geometry = part.geometry.clone().applyMatrix4(part.matrixWorld);
      const count = geometry.getAttribute('position').count;
      const indices = new Uint16Array(count * 4);
      const weights = new Float32Array(count * 4);
      for (let vertex = 0; vertex < count; vertex++) {
        indices[vertex * 4] = index;
        weights[vertex * 4] = 1;
      }
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
      return geometry;
    });
    source.geometry = mergeGeometries(weighted, false);
    source.geometry.userData.shared = true;
    source.geometry.computeBoundingBox();
    weighted.forEach(geometry => geometry.dispose());
  }
  const skeleton = new THREE.Skeleton(parts.map(part => part.parent));
  for (const node of nodes.values()) {
    for (const child of [...node.children]) if (child.isMesh) node.remove(child);
  }
  const mesh = new THREE.SkinnedMesh(source.geometry, material);
  rig.add(mesh);
  mesh.bind(skeleton);
  mesh.frustumCulled = false;
  rig.rotation.y = Math.PI;
  rig.updateMatrixWorld(true);
  const box = source.geometry.boundingBox.clone().applyMatrix4(rig.matrixWorld);
  const size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  const scale=extent[id]/Math.max(size.x,size.y,size.z);
  rig.scale.setScalar(scale);rig.position.set(-center.x*scale,-box.min.y*scale,-center.z*scale);
  return {rig,pose,nodes};
}
