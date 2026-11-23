// Browser-preview stand-in for the real room: a round wooden table, a floor,
// soft walls, and a seated opponent mannequin to check sight lines.
import * as THREE from 'three';

export const TABLE_Y = 0.74;

function woodTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#9a6a3c'; g.fillRect(0, 0, 512, 512);
  for (let r = 4; r < 360; r += 3 + Math.random() * 5) {
    g.strokeStyle = `rgba(${70 + Math.random() * 40},${40 + Math.random() * 20},20,${0.12 + Math.random() * 0.15})`;
    g.lineWidth = 1 + Math.random() * 2; g.beginPath(); g.ellipse(256, 256, r, r * 0.97, 0, 0, Math.PI * 2); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function makeRoom() {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.035, 64), [
    new THREE.MeshStandardMaterial({ color: '#7a4f2a', roughness: 0.6 }),
    new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.55 }),
    new THREE.MeshStandardMaterial({ color: '#6a4322' })]);
  top.position.y = TABLE_Y - 0.0175; g.add(top);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, TABLE_Y - 0.03, 20), new THREE.MeshStandardMaterial({ color: '#5a3a1e' }));
  leg.position.y = (TABLE_Y - 0.03) / 2; g.add(leg);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.28, 0.03, 32), new THREE.MeshStandardMaterial({ color: '#5a3a1e' }));
  foot.position.y = 0.015; g.add(foot);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 48), new THREE.MeshStandardMaterial({ color: '#bfb6aa', roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; g.add(floor);
  const walls = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 3, 48, 1, true), new THREE.MeshStandardMaterial({ color: '#e9e3da', side: THREE.BackSide, roughness: 1 }));
  walls.position.y = 1.5; g.add(walls);
  // opponent mannequin at the far seat (eye height ~1.15 m)
  const skin = new THREE.MeshStandardMaterial({ color: '#c9b8a6', roughness: 0.8 });
  const shirt = new THREE.MeshStandardMaterial({ color: '#4a6b8a', roughness: 0.8 });
  const m = new THREE.Group(); m.position.set(0, 0, -0.78); g.add(m);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.32, 6, 16), shirt); torso.position.y = 0.82; torso.scale.z = 0.6; m.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 18), skin); head.position.y = 1.17; m.add(head);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), new THREE.MeshStandardMaterial({ color: '#222' }));
    eye.position.set(s * 0.035, 1.18, 0.088); m.add(eye);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.28, 4, 10), shirt);
    arm.position.set(s * 0.2, 0.8, 0.12); arm.rotation.x = -1.1; m.add(arm);
  }
  const chair = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), new THREE.MeshStandardMaterial({ color: '#3d3d44' }));
  chair.position.set(0, 0.225, -0.85); g.add(chair);
  g.userData.mannequin = m;
  return g;
}

// Seated eye positions (world) for each seat in the preview.
export function seatEye(seat) { return new THREE.Vector3(0, 1.2, seat === 0 ? 0.66 : -0.66); }
