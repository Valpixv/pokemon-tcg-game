import * as THREE from 'three';

// ------------------------------------------------------------ scheduler
// Frame-driven timers and tweens so every animation advances with the
// render loop (window rAF and XR session rAF alike).
const tasks = new Set();
let now = 0;
// Hit-stop: on impact, animation time holds for a few frames so a hit lands
// with weight. Counted in simulation time, so fixed-step captures stay exact.
let hold = 0;
export function hitStop(seconds) { hold = Math.max(hold, seconds); }
export function tick(dt) {
  if (hold > 0) { const used = Math.min(hold, dt); hold -= used; dt -= used; if (dt <= 0) return; }
  now += dt;
  for (const t of [...tasks]) {
    const p = Math.min(1, (now - t.start) / t.dur);
    t.fn?.(p);
    if (p >= 1) { tasks.delete(t); t.resolve(); }
  }
}
export function tween(dur, fn) {
  return new Promise((resolve) => { tasks.add({ start: now, dur: Math.max(1e-4, dur), fn, resolve }); });
}
export const wait = (dur) => tween(dur, null);
export const time = () => now;

export const ease = {
  out: (t) => 1 - (1 - t) ** 3,
  in: (t) => t * t * t,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  back: (t) => { const c = 1.7; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
};
export const lerp = (a, b, t) => a + (b - a) * t;

// --------------------------------------------------------------- labels
// Canvas-textured text plane. `set(text)` redraws only when text changes.
export class Label extends THREE.Mesh {
  constructor({ width = 0.1, height = 0.025, px = 512, font = '600 64px system-ui, sans-serif', color = '#ffffff',
    bg = null, radius = 0.25, align = 'center', spacing = 0, lineHeight = 1.15, padding = 0.06, border = null, depthTest = true } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = px; canvas.height = Math.max(8, Math.round(px * height / width));
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest, side: THREE.DoubleSide, toneMapped: false });
    super(new THREE.PlaneGeometry(width, height), mat);
    Object.assign(this, { canvas, tex, opts: { font, color, bg, radius, align, spacing, lineHeight, padding, border }, text: null });
    this.renderOrder = 10;
  }
  set(text, override = {}) {
    const key = text + JSON.stringify(override);
    if (key === this.text) return this;
    this.text = key;
    const o = { ...this.opts, ...override };
    const { canvas } = this; const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (o.bg) {
      ctx.fillStyle = o.bg;
      roundRect(ctx, 2, 2, W - 4, H - 4, Math.min(W, H) * o.radius); ctx.fill();
      if (o.border) { ctx.strokeStyle = o.border; ctx.lineWidth = 3; ctx.stroke(); }
    }
    ctx.font = o.font; ctx.fillStyle = o.color; ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${o.spacing}px`;
    const lines = String(text).split('\n');
    const size = parseInt(/(\d+)px/.exec(o.font)?.[1] || 48, 10);
    const lh = size * o.lineHeight;
    const pad = W * o.padding;
    const x = o.align === 'left' ? pad : o.align === 'right' ? W - pad : W / 2;
    ctx.textAlign = o.align;
    const y0 = H / 2 - ((lines.length - 1) * lh) / 2;
    lines.forEach((l, i) => {
      let line = l;
      // Inline colour runs: "{#ff0}text{/}"
      if (line.includes('{#')) { drawRich(ctx, line, x, y0 + i * lh, o); return; }
      ctx.fillText(line, x, y0 + i * lh, W - pad * 2);
    });
    this.tex.needsUpdate = true;
    return this;
  }
}

function drawRich(ctx, line, x, y, o) {
  const parts = []; const re = /\{(#[0-9a-fA-F]{3,6})\}(.*?)\{\/\}/g; let last = 0, m;
  while ((m = re.exec(line))) { if (m.index > last) parts.push([o.color, line.slice(last, m.index)]); parts.push([m[1], m[2]]); last = re.lastIndex; }
  if (last < line.length) parts.push([o.color, line.slice(last)]);
  const total = parts.reduce((w, [, t]) => w + ctx.measureText(t).width, 0);
  let cx = o.align === 'center' ? x - total / 2 : o.align === 'right' ? x - total : x;
  ctx.textAlign = 'left';
  for (const [c, t] of parts) { ctx.fillStyle = c; ctx.fillText(t, cx, y); cx += ctx.measureText(t).width; }
  ctx.textAlign = o.align;
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// Soft radial blob texture for shadows, glows and clouds.
const blobCache = new Map();
export function blobTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const key = inner + outer;
  if (blobCache.has(key)) return blobCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, inner); gr.addColorStop(1, outer); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.userData.shared = true; blobCache.set(key, t); return t;
}

// Y-axis billboard toward a world-space camera position.
const _v = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Quaternion();
export function faceCameraY(obj, camPos) {
  obj.getWorldPosition(_p);
  const parentQ = obj.parent ? obj.parent.getWorldQuaternion(_q) : _q.identity();
  _v.copy(camPos).sub(_p);
  const yaw = Math.atan2(_v.x, _v.z);
  obj.quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw).premultiply(parentQ.invert());
}
