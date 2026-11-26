// Browser-preview stand-in for the real room: a round wooden table, a floor,
// soft walls, and a seated opponent mannequin to check sight lines.
import * as THREE from 'three';

export const TABLE_Y = 0.74;

function woodTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  // Longitudinal grain and subtle board seams. Keep the desktop set repeatable for takes.
  const grain = g.createLinearGradient(0, 0, 512, 480);
  grain.addColorStop(0, '#916344'); grain.addColorStop(.55, '#ae7850'); grain.addColorStop(1, '#966741');
  g.fillStyle = grain; g.fillRect(0, 0, 512, 512);
  for (let row = 0; row < 512; row += 4) {
    g.strokeStyle = row % 12 ? 'rgba(63,40,27,.075)' : 'rgba(249,219,159,.10)';
    g.beginPath();
    for (let x = 0; x <= 512; x += 8) {
      const y = row + 1.8 * Math.sin(x / 71 + row * .17) + 1.1 * Math.sin(x / 23 + row * .16);
      if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  g.fillStyle = 'rgba(57,34,23,.18)';
  for (let y = 66; y < 512; y += 120) g.fillRect(0, y, 512, 1);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Two-tone wall: painted upper wall, wood wainscot below a chair rail.
function wallTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256; const g = c.getContext('2d');
  const upper = g.createLinearGradient(0, 0, 0, 150); upper.addColorStop(0, '#c9cfc3'); upper.addColorStop(1, '#bcc4b6');
  g.fillStyle = upper; g.fillRect(0, 0, 1024, 168);
  g.fillStyle = '#93a397'; g.fillRect(0, 168, 1024, 88);                       // painted wainscot: contrasts with the wood table
  g.fillStyle = 'rgba(30,45,38,.16)'; for (let x = 0; x < 1024; x += 64) g.fillRect(x, 172, 2, 84); // panel seams
  g.fillStyle = '#e8e1cf'; g.fillRect(0, 162, 1024, 7);                         // chair rail
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.x = 6; return t;
}
// Round woven rug that frames the table in desktop takes.
function rugTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  g.translate(256, 256);
  [['#3f5a6e', 256], ['#d8c9a3', 236], ['#4f6f63', 226], ['#c4b48d', 150], ['#4f6f63', 142]].forEach(([col, r]) => { g.fillStyle = col; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill(); });
  g.strokeStyle = 'rgba(255,255,255,.07)'; for (let r = 8; r < 256; r += 6) { g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); }
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
  const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 48), new THREE.MeshStandardMaterial({ color: '#978875', roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; g.add(floor);
  const walls = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 3, 48, 1, true), new THREE.MeshStandardMaterial({ map: wallTexture(), side: THREE.BackSide, roughness: 1 }));
  walls.position.y = 1.5; g.add(walls);
  const baseboard = new THREE.Mesh(new THREE.CylinderGeometry(3.98, 3.98, 0.12, 48, 1, true), new THREE.MeshStandardMaterial({ color: '#e8e1cf', side: THREE.BackSide, roughness: .7 }));
  baseboard.position.y = 0.06; g.add(baseboard);
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.25, 64), new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 1 }));
  rug.rotation.x = -Math.PI / 2; rug.position.y = 0.002; g.add(rug);
  // Pendant lamp: warm pool of light on the table (desktop only - the room is hidden in XR).
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1.0, 6), new THREE.MeshStandardMaterial({ color: '#2b2b2b' }));
  cord.position.y = 2.5; cord.userData.receiveShadow = false; g.add(cord);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.13, 32, 1, true), new THREE.MeshStandardMaterial({ color: '#2f4a44', side: THREE.DoubleSide, roughness: .5, metalness: .2 }));
  shade.position.y = 1.95; shade.userData.receiveShadow = false; g.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), new THREE.MeshBasicMaterial({ color: '#fff1cf' }));
  bulb.position.y = 1.9; bulb.userData.receiveShadow = false; g.add(bulb);
  const lamp = new THREE.PointLight('#ffd9a0', 0.9, 2.2, 2); lamp.position.y = 1.88; g.add(lamp);
  // opponent mannequin at the far seat (eye height ~1.15 m)
  const skin = new THREE.MeshStandardMaterial({ color: '#c9b8a6', roughness: 0.8 });
  const shirt = new THREE.MeshStandardMaterial({ color: '#4a6b8a', roughness: 0.8 });
  const m = new THREE.Group(); m.position.set(0, 0, -0.78); g.add(m);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.32, 6, 16), shirt); torso.position.y = 0.82; torso.scale.z = 0.6; m.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 18), skin); head.position.y = 1.17; m.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.104, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.MeshStandardMaterial({ color: '#3a2a20', roughness: .9 }));
  hair.position.y = 1.18; hair.rotation.x = -0.25; m.add(hair);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.08, 12), skin); neck.position.y = 1.06; m.add(neck);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), new THREE.MeshStandardMaterial({ color: '#222' }));
    eye.position.set(s * 0.035, 1.18, 0.088); m.add(eye);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.28, 4, 10), shirt);
    arm.position.set(s * 0.2, 0.8, 0.12); arm.rotation.x = -1.1; m.add(arm);
  }
  const chairMat = new THREE.MeshStandardMaterial({ color: '#4a3a2c', roughness: .7 });
  const chair = new THREE.Group(); chair.position.set(0, 0, -0.85); g.add(chair);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, 0.42), chairMat); seat.position.y = 0.45; chair.add(seat);
  // open ladder back (posts, top rail, one slat) so the empty chair never reads as a slab
  for (const x of [-.2, .2]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.52, 0.035), chairMat); post.position.set(x, 0.72, -0.2); chair.add(post); }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.07, 0.03), chairMat); rail.position.set(0, 0.95, -0.2); chair.add(rail);
  const slat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.02), chairMat); slat.position.set(0, 0.75, -0.2); chair.add(slat);
  for (const [x, z] of [[-.19, -.18], [.19, -.18], [-.19, .18], [.19, .18]]) {
    const legC = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.015, 0.45, 8), chairMat); legC.position.set(x, 0.225, z); chair.add(legC);
  }
  // The opponent remains available for sight-line checks in regular preview.
  if (new URLSearchParams(location.search).has('demo')) { m.children.forEach(part => { part.visible = false; }); chair.visible = false; }
  g.userData.mannequin = m;
  return g;
}

// Seated eye positions (world) for each seat in the preview.
export function seatEye(seat) { return new THREE.Vector3(0, 1.2, seat === 0 ? 0.66 : -0.66); }
