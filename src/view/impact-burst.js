// Type-coloured particle burst and a turf impact ring, layered on top of each
// move's own effect at the moment of impact. One Points draw and one ring per
// hit. Motion uses its own seeded generator, never Math.random, so capture
// takes (which seed Math.random for AI choices) stay identical.
import * as THREE from 'three';
import { tween, ease, blobTexture } from './util.js';

// speed: initial m/s; gravity: m/s² (negative rises); swirl: rad/s around the hit;
// drag: velocity decay per second; additive: glow on top, else solid dust.
export const BURST_STYLE = {
  electric: { color: '#fff3a0', n: 18, speed: .10, gravity: 0,    swirl: 0,  drag: 5,   life: .32, size: .0034, additive: true, jitter: .012 },
  ember:    { color: '#ffab4a', n: 16, speed: .05, gravity: -.10, swirl: 0,  drag: 2,   life: .55, size: .0040, additive: true },
  water:    { color: '#a7e9ff', n: 16, speed: .07, gravity: .32,  swirl: 0,  drag: 1,   life: .50, size: .0036, additive: true },
  vine:     { color: '#9bdc6e', n: 12, speed: .06, gravity: .18,  swirl: 0,  drag: 2,   life: .45, size: .0040, additive: false },
  drain:    { color: '#a4ffc6', n: 14, speed: .03, gravity: -.06, swirl: 4,  drag: 1.5, life: .60, size: .0034, additive: true },
  psychic:  { color: '#f5a8ff', n: 16, speed: .04, gravity: 0,    swirl: 7,  drag: 1.5, life: .55, size: .0034, additive: true },
  ghost:    { color: '#b49cf5', n: 14, speed: .03, gravity: -.03, swirl: 3,  drag: 1,   life: .70, size: .0042, additive: true },
  fang:     { color: '#d9a8ff', n: 14, speed: .09, gravity: .20,  swirl: 0,  drag: 3,   life: .35, size: .0032, additive: true },
  rock:     { color: '#bfae93', n: 14, speed: .06, gravity: .40,  swirl: 0,  drag: 1,   life: .50, size: .0042, additive: false },
  contact:  { color: '#ffe2c0', n: 12, speed: .07, gravity: .25,  swirl: 0,  drag: 2.5, life: .38, size: .0036, additive: true },
  spores:   { color: '#cdbbe9', n: 12, speed: .02, gravity: -.04, swirl: 1.5, drag: .8, life: .80, size: .0050, additive: false },
};

let seed = 0x1b0;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
export function resetBurstSeed(s = 0x1b0) { seed = s >>> 0; }

export function burstMaterial(style) {
  return new THREE.PointsMaterial({
    color: style.color, map: blobTexture(), size: style.size * 1.7, sizeAttenuation: true, transparent: true,
    depthWrite: false, blending: style.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}
export function ringMaterial(color) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .7, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
}

// point: where the hit lands; ground: a point on the turf under the defender.
// heavy: bigger, longer burst and a wider ring.
export async function impactBurst(parent, effect, point, ground, heavy = false) {
  const style = BURST_STYLE[effect] || BURST_STYLE.contact;
  const n = Math.round(style.n * (heavy ? 1.5 : 1)), life = style.life * (heavy ? 1.2 : 1);
  const pos = new Float32Array(n * 3), vel = [];
  for (let i = 0; i < n; i++) {
    // random direction on a sphere, biased upward so the burst reads above the turf
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    const s = style.speed * (.55 + rnd() * .9) * (heavy ? 1.25 : 1);
    vel.push(new THREE.Vector3(r * Math.cos(a) * s, Math.abs(u) * s * .9 + s * .25, r * Math.sin(a) * s));
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, burstMaterial(style)); pts.position.copy(point); pts.frustumCulled = false;
  parent.add(pts);

  const ring = new THREE.Mesh(new THREE.RingGeometry(.86, 1, 40), ringMaterial(style.color));
  ring.rotation.x = -Math.PI / 2; ring.position.copy(ground); ring.position.y += .0012; ring.renderOrder = 2;
  parent.add(ring);
  const ringMax = heavy ? .04 : .03;

  const p0 = vel.map(() => new THREE.Vector3());
  let last = 0;
  await tween(life, (p) => {
    const t = p * life, dt = t - last; last = t;
    const decay = Math.exp(-style.drag * dt);
    for (let i = 0; i < n; i++) {
      const v = vel[i], q = p0[i];
      v.multiplyScalar(decay); v.y -= style.gravity * dt;
      if (style.swirl) { const c = Math.cos(style.swirl * dt), s = Math.sin(style.swirl * dt); const x = q.x * c - q.z * s; q.z = q.x * s + q.z * c; q.x = x; }
      q.addScaledVector(v, dt);
      const j = style.jitter ? (rnd() - .5) * style.jitter * (1 - p) : 0;
      pos[i * 3] = q.x + j; pos[i * 3 + 1] = q.y; pos[i * 3 + 2] = q.z - j;
    }
    geo.attributes.position.needsUpdate = true;
    pts.material.opacity = p < .15 ? 1 : (1 - (p - .15) / .85) ** 1.4;
    const rp = Math.min(1, p / .6);
    ring.scale.setScalar(.008 + ringMax * ease.out(rp));
    ring.material.opacity = .7 * (1 - rp) ** 1.5;
  });
  geo.dispose(); pts.material.dispose(); pts.removeFromParent();
  ring.geometry.dispose(); ring.material.dispose(); ring.removeFromParent();
}
