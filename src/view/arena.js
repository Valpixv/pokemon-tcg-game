// Miniature circular stadium. Origin = arena centre on the table surface.
import * as THREE from 'three';

export const ARENA = { radius: 0.16, height: 0.014 };

export function makeArena() {
  const g = new THREE.Group();
  const { radius: R, height: H } = ARENA;
  // short pale-grey faceted base, slightly translucent
  const base = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.008, R + 0.012, H, 28, 1),
    new THREE.MeshStandardMaterial({ color: '#d9dde3', roughness: 0.35, metalness: 0.05, flatShading: true, transparent: true, opacity: 0.9 }));
  base.position.y = H / 2; g.add(base);
  // faceted rim
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R + 0.006, 0.0035, 4, 28),
    new THREE.MeshStandardMaterial({ color: '#f4f6fa', roughness: 0.62, flatShading: true, transparent: true, opacity: 0.75 }));
  rim.rotation.x = Math.PI / 2; rim.position.y = H + 0.001; g.add(rim);
  // lime playing surface
  const field = new THREE.Mesh(new THREE.CircleGeometry(R, 48), new THREE.MeshStandardMaterial({ color: '#8fe03a', roughness: 0.85, emissive: '#2f6a00', emissiveIntensity: 0.25 }));
  field.rotation.x = -Math.PI / 2; field.position.y = H + 0.0004; g.add(field);
  // Markings sit on the field with a polygon offset instead of relying on a
  // sub-millimetre height gap, which shimmers at headset depth precision.
  const white = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const ring = (r, w) => { const m = new THREE.Mesh(new THREE.RingGeometry(r - w, r, 64), white); m.rotation.x = -Math.PI / 2; m.position.y = H + 0.0008; return m; };
  g.add(ring(R - 0.008, 0.0016), ring(0.028, 0.0014), ring(0.009, 0.0016));
  const inner = .028, outer = R - .008;
  // Stop at the center ring so the white lines never blend over one another.
  for (const side of [-1, 1]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(outer-inner,.0014),white);
    line.rotation.x = -Math.PI/2; line.position.set(side*(outer+inner)/2,H+.0008,0); g.add(line);
  }
  g.userData.surfaceY = H + 0.0008;
  return g;
}
