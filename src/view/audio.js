// Short original synthesized sounds, spatialised at the table and kept quiet
// so two people can still talk over them.
import * as THREE from 'three';

let listener = null;
const buffers = {};
const MASTER = 0.35;

function make(ctx, dur, fn) {
  const sr = ctx.sampleRate; const n = Math.floor(sr * dur);
  const b = ctx.createBuffer(1, n, sr); const d = b.getChannelData(0);
  let state = {};
  for (let i = 0; i < n; i++) d[i] = fn(i / sr, i / n, state);
  return b;
}
const noise = () => Math.random() * 2 - 1;

function build(ctx) {
  buffers.confirm = make(ctx, 0.12, (t, p) => Math.sin(2 * Math.PI * (880 + 440 * p) * t) * (1 - p) * 0.5);
  buffers.select = make(ctx, 0.06, (t, p) => Math.sin(2 * Math.PI * 1200 * t) * (1 - p) * 0.35);
  buffers.invalid = make(ctx, 0.18, (t, p) => Math.sign(Math.sin(2 * Math.PI * 150 * t)) * (1 - p) * 0.18);
  buffers.fang = make(ctx, 0.28, (t, p, s) => {
    s.lp = (s.lp || 0) + (noise() - (s.lp || 0)) * 0.25;
    const crunch = s.lp * (p < 0.15 ? 1 : Math.exp(-(p - 0.15) * 12));
    return (crunch * 0.9 + Math.sin(2 * Math.PI * (300 - 200 * p) * t) * 0.4 * (1 - p)) * 0.7;
  });
  buffers.electric = make(ctx, 0.4, (t, p) => {
    const buzz = Math.sign(Math.sin(2 * Math.PI * (90 + 40 * Math.sin(t * 90)) * t));
    return (buzz * 0.35 + noise() * 0.5 * (Math.random() < 0.3 ? 1 : 0.2)) * Math.exp(-p * 4) * 0.7;
  });
  buffers.spores = make(ctx, 0.9, (t, p, s) => {
    s.lp = (s.lp || 0) + (noise() - (s.lp || 0)) * 0.05;
    return s.lp * Math.sin(Math.PI * p) * 1.6;
  });
  buffers.charge = make(ctx, 0.7, (t, p) => Math.sin(2 * Math.PI * (300 + 900 * p * p) * t) * Math.sin(Math.PI * p) * 0.3);
  buffers.rock = make(ctx, 0.3, (t, p, s) => { s.lp = (s.lp || 0) + (noise() - (s.lp || 0)) * 0.1; return s.lp * Math.exp(-p * 6) * 2; });
  buffers.ko = make(ctx, 0.7, (t, p) => Math.sin(2 * Math.PI * (520 - 380 * p) * t) * (1 - p) * 0.45);
  buffers.heal = make(ctx, 0.5, (t, p) => (Math.sin(2 * Math.PI * 660 * t) + Math.sin(2 * Math.PI * 990 * t)) * Math.sin(Math.PI * p) * 0.2);
  buffers.win = make(ctx, 1.0, (t, p) => [523, 659, 784].reduce((a, f, i) => a + (p > i * 0.2 ? Math.sin(2 * Math.PI * f * t) : 0), 0) * (1 - p) * 0.25);
}

export function initAudio(camera) {
  listener = new THREE.AudioListener();
  camera.add(listener);
  listener.setMasterVolume(MASTER);
  build(listener.context);
  return listener;
}
export function resumeAudio() { listener?.context.state === 'suspended' && listener.context.resume(); }

// Play a sound at a position inside `parent` (e.g. the table root).
export function play(name, parent, pos) {
  if (!listener || !buffers[name]) return;
  if (listener.context.state !== 'running') return;
  const a = new THREE.PositionalAudio(listener);
  a.setBuffer(buffers[name]); a.setRefDistance(0.4); a.setRolloffFactor(1.2);
  if (pos) a.position.copy(pos);
  parent.add(a); a.play();
  a.source.onended = () => { a.disconnect(); a.removeFromParent(); };
}
