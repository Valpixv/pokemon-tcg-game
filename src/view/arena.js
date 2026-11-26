// Miniature circular stadium. Origin = arena centre on the table surface.
import * as THREE from 'three';

import { drawBall } from './trainer-emblem.js';

export const ARENA = { radius: 0.16, height: 0.014 };

// Print the markings into the turf so every stripe and line shares one draw.
function turfTexture() {
  const canvas = document.createElement('canvas');
  const size = canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  const pitch = ctx.createRadialGradient(450, 400, 40, 512, 512, 570);
  pitch.addColorStop(0, '#a5cd68');
  pitch.addColorStop(1, '#6caa54');
  ctx.fillStyle = pitch;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(30,80,48,.053)';
  for (let y = 0; y < size; y += 128) ctx.fillRect(0, y, size, 64);
  ctx.translate(512, 512);
  ctx.strokeStyle = '#f5f7d3';
  ctx.lineWidth = 4.8;
  for (const radius of [486, 89, 27]) {
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, 2 * Math.PI);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(-486, 0); ctx.lineTo(-89, 0);
  ctx.moveTo(89, 0); ctx.lineTo(486, 0);
  ctx.stroke();
  // A painted League crest, with opposing trainer boxes and perimeter ticks.
  drawBall(ctx, 0, 0, 85, '#d7645c', '#f2e9bb', '#39594d');
  for (const orientation of [0, Math.PI]) {
    ctx.save();
    ctx.rotate(orientation);
    ctx.strokeStyle = '#f2efd0';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.roundRect(-128, 152, 256, 150, 64);
    ctx.stroke();
    ctx.restore();
  }
  for (let i = 0; i < 64; i++) {
    ctx.save();
    ctx.rotate(Math.PI * i / 32);
    ctx.fillStyle = i < 32 ? '#267487' : '#a04c43';
    ctx.fillRect(-5, 490, 10, i % 4 ? 12 : 20);
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function makeArena() {
  const g = new THREE.Group();
  const { radius: R, height: H } = ARENA;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(R + .008, R + .012, H, 48),
    new THREE.MeshStandardMaterial({ color: '#31485a', roughness: .64, metalness: .09, flatShading: true }));
  base.position.y = H / 2;
  g.add(base);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R + .006, .003, 6, 64),
    new THREE.MeshStandardMaterial({ color: '#f0edd8', roughness: .48, metalness: .12 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = H + .001;
  g.add(rim);
  const field = new THREE.Mesh(new THREE.CircleGeometry(R, 72),
    new THREE.MeshStandardMaterial({ map: turfTexture(), roughness: .96 }));
  field.rotation.x = -Math.PI / 2;
  field.position.y = H + .0004;
  g.add(field);
  g.userData.seatArcs = ['#49c4d7', '#eeab56'].map((color, seat) => {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(R + .006, .0017, 6, 28, Math.PI * .56),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .13, roughness: .55 }));
    arc.rotation.x = Math.PI / 2;
    arc.rotation.z = (.22 + seat) * Math.PI;
    arc.position.y = H + .0032;
    g.add(arc);
    return arc;
  });
  g.userData.surfaceY = H + .0008;
  return g;
}
