// Short original synthesized sounds, spatialised at the table and kept quiet
// so two people can still talk over them. Every sound is generated here: no
// sampled game, anime or third-party audio.
//
// Routing (live play): source → panner → per-sound gain → category bus → listener
// → compressor → speakers. Capture builds its own offline mix from the buffers, so
// anything that must be heard in a film has to be a buffer, not a node setting.
import * as THREE from 'three';

let listener = null, buses = null, crowdLoop = null;
const buffers = {};
const MASTER = 0.35;

// Category levels. 'voice' is the optional announcer; the others duck under it.
export const CATEGORY_LEVEL = { ui: 0.8, move: 1, cry: 0.7, voice: 1, ambient: 0.22 };
const DUCKED = ['move', 'cry', 'ambient'], DUCK = 0.5; // about -6 dB
export function categoryOf(name) {
  if (name.startsWith('cry:')) return 'cry';
  if (name === 'confirm' || name === 'select' || name === 'invalid') return 'ui';
  if (name === 'crowd' || name === 'cheer') return 'ambient';
  return 'move';
}

// ---------- settings (persisted per viewer; both off by default) ----------
const SETTINGS_KEY = 'tcb-audio';
export const settings = { voice: false, crowd: false };
try {
  const saved = JSON.parse(globalThis.localStorage?.getItem(SETTINGS_KEY) || '{}');
  settings.voice = saved.voice === true; settings.crowd = saved.crowd === true;
} catch { /* private window or no storage: keep defaults */ }
function saveSettings() { try { globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ } }
// Browsers load voices asynchronously; asking early means the first callout is not skipped.
const warmVoices = () => { try { globalThis.speechSynthesis?.getVoices(); } catch { /* ignore */ } };
if (settings.voice) warmVoices();
export function setVoice(on) { settings.voice = !!on; saveSettings(); if (on) warmVoices(); else stopVoice(); }
export function setCrowd(on) { settings.crowd = !!on; saveSettings(); on ? startCrowd() : stopCrowd(); }

// ---------- deterministic variation (separate from Math.random, which drives AI) ----------
let varSeed = 0x5eed;
export function resetVariation(seed = 0x5eed) { varSeed = seed >>> 0; }
function rand() { varSeed = (Math.imul(varSeed, 1664525) + 1013904223) >>> 0; return varSeed / 4294967296; }
// ±6% pitch and ±2 dB gain for moves and cries; menus vary less so they stay crisp.
export function variation(name) {
  const ui = categoryOf(name) === 'ui';
  const rate = 1 + (rand() * 2 - 1) * (ui ? 0.02 : 0.06);
  const gain = 10 ** (((rand() * 2 - 1) * (ui ? 1 : 2)) / 20);
  return { rate, gain };
}

// ---------- synthesis ----------
function make(ctx, dur, fn, peak = null) {
  const sr = ctx.sampleRate; const n = Math.floor(sr * dur);
  const b = ctx.createBuffer(1, n, sr); const d = b.getChannelData(0);
  const state = {};
  for (let i = 0; i < n; i++) d[i] = fn(i / sr, i / n, state);
  if (peak != null) { // normalise new sounds so stacked layers cannot clip
    let m = 0; for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(d[i]));
    if (m > 0) for (let i = 0; i < n; i++) d[i] *= peak / m;
  }
  return b;
}
let noiseSeed = 731;
function noise() {
  noiseSeed = (Math.imul(noiseSeed, 1664525) + 1013904223) >>> 0;
  return noiseSeed / 2147483648 - 1;
}
const TAU = 2 * Math.PI;

// Each species gets an original voice: base pitch (Hz), pitch sweep across the call,
// breath/grit amount, length (s), number of syllables and vibrato rate (Hz).
export const CRY_VOICE = {
  gloomwing: { base: 1750, sweep: -0.3, rough: 0.18, len: 0.30, chirps: 3, vib: 0 },   // thin chittering screech
  puffmire:  { base: 150,  sweep: -0.2, rough: 0.55, len: 0.60, chirps: 1, vib: 6 },   // gassy low groan
  voltpip:   { base: 900,  sweep: 0.25, rough: 0.05, len: 0.34, chirps: 2, vib: 9 },   // bright two-note squeak
  pebblit:   { base: 105,  sweep: -0.1, rough: 0.70, len: 0.42, chirps: 1, vib: 0 },   // gravelly grunt
  bulbasaur: { base: 420,  sweep: -0.25, rough: 0.12, len: 0.40, chirps: 2, vib: 4 },
  charmander:{ base: 640,  sweep: 0.15, rough: 0.20, len: 0.36, chirps: 2, vib: 7 },
  squirtle:  { base: 560,  sweep: 0.30, rough: 0.08, len: 0.32, chirps: 3, vib: 5 },
  eevee:     { base: 780,  sweep: 0.20, rough: 0.06, len: 0.38, chirps: 2, vib: 6 },
  gastly:    { base: 290,  sweep: -0.4, rough: 0.30, len: 0.70, chirps: 1, vib: 3 },   // hollow wail
  psyduck:   { base: 470,  sweep: -0.15, rough: 0.22, len: 0.40, chirps: 2, vib: 2 },
  sandshrew: { base: 360,  sweep: -0.2, rough: 0.35, len: 0.34, chirps: 2, vib: 0 },
  magnemite: { base: 1250, sweep: 0,    rough: 0.10, len: 0.36, chirps: 3, vib: 30 },  // metallic beeps
};
const DEFAULT_VOICE = { base: 500, sweep: 0, rough: 0.2, len: 0.36, chirps: 2, vib: 4 };
// How each moment reshapes the species voice.
const CRY_KIND = {
  enter:  { pitch: 1,    sweep: 0,    len: 1,   peak: 0.42 },
  attack: { pitch: 1.12, sweep: 0.2,  len: 0.7, peak: 0.40 },
  hurt:   { pitch: 1.22, sweep: -0.5, len: 0.5, peak: 0.34 },
  faint:  { pitch: 0.92, sweep: -0.7, len: 1.8, peak: 0.40 },
};
export const CRY_KINDS = Object.keys(CRY_KIND);
function cry(ctx, voice, kind) {
  const v = voice, k = CRY_KIND[kind];
  const len = v.len * k.len, sweep = v.sweep + k.sweep, base = v.base * k.pitch;
  return make(ctx, len, (t, p, s) => {
    const vib = 1 + 0.03 * Math.sin(TAU * v.vib * t);
    const f = base * (1 + sweep * p) * vib;
    s.ph = (s.ph || 0) + TAU * f / ctx.sampleRate;
    // a few harmonics, weighted towards 2nd/3rd for a vocal colour
    const tone = Math.sin(s.ph) + 0.6 * Math.sin(2 * s.ph) + 0.35 * Math.sin(3 * s.ph) + 0.15 * Math.sin(5 * s.ph);
    s.lp = (s.lp || 0) + (noise() - (s.lp || 0)) * 0.3;
    const syll = v.chirps > 1 ? Math.pow(Math.max(0, Math.sin(Math.PI * ((p * v.chirps) % 1))), 0.6) : 1;
    const env = Math.min(1, p * 25) * (kind === 'faint' ? (1 - p) ** 1.6 : Math.min(1, (1 - p) * 6));
    return (tone * (1 - v.rough) + s.lp * 2.2 * v.rough) * syll * env;
  }, k.peak);
}

export function synthesize(ctx) {
  const out = {};
  noiseSeed = 731;
  // UI and the original move sounds (levels unchanged so existing takes match)
  out.confirm = make(ctx, 0.12, (t, p) => Math.sin(TAU * (880 + 440 * p) * t) * (1 - p) * 0.5);
  out.select = make(ctx, 0.06, (t, p) => Math.sin(TAU * 1200 * t) * (1 - p) * 0.35);
  out.invalid = make(ctx, 0.18, (t, p) => Math.sign(Math.sin(TAU * 150 * t)) * (1 - p) * 0.18);
  out.fang = make(ctx, 0.28, (t, p, s) => {
    s.lp = (s.lp || 0) + (noise() - (s.lp || 0)) * 0.25;
    const crunch = s.lp * (p < 0.15 ? 1 : Math.exp(-(p - 0.15) * 12));
    const snap = Math.sin(TAU * 1350 * t) * Math.exp(-t * 190);
    const thump = Math.sin(TAU * (190 - 75 * p) * t) * Math.exp(-t * 25);
    return crunch * .65 + snap * .26 + thump * .34;
  });
  out.electric = make(ctx, 0.4, (t, p) => {
    const buzz = Math.sign(Math.sin(TAU * (90 + 40 * Math.sin(t * 90)) * t));
    return (buzz * 0.35 + noise() * .55 * (.25 + .75 * Math.max(0, Math.cos(t * 148)))) * Math.exp(-p * 4) * 0.7;
  });
  out.spores = make(ctx, 0.9, (t, p, s) => {
    s.lp = (s.lp || 0) + (noise() - (s.lp || 0)) * 0.05;
    return s.lp * Math.sin(Math.PI * p) * 1.6;
  });
  out.charge = make(ctx, 0.7, (t, p) => Math.sin(TAU * (300 + 900 * p * p) * t) * Math.sin(Math.PI * p) * 0.3);
  out.rock = make(ctx, 0.3, (t, p, s) => { s.lp = (s.lp || 0) + (noise() - (s.lp || 0)) * 0.1; return s.lp * Math.exp(-p * 6) * 2; });
  out.vine = make(ctx, .19, (t, p) => {
    const snap = Math.sin(TAU * (720 - 520 * p) * t) * Math.exp(-p * 13);
    return snap * .45 + noise() * Math.exp(-p * 19) * .30;
  });
  out.water = make(ctx, .32, (t, p, s) => {
    s.lp = (s.lp || 0) * .65 + noise() * .35;
    return s.lp * Math.sin(Math.PI * p) * .8 + Math.sin(TAU * (780 - 330 * p) * t) * Math.exp(-p * 12) * .12;
  });
  out.ember = make(ctx, .31, (t, p, s) => {
    s.lp = (s.lp || 0) * .82 + noise() * .18;
    return (s.lp * .9 + Math.sin(TAU * (155 - 65 * p) * t) * .24) * Math.exp(-p * 4);
  });
  out.hex = make(ctx, .38, (t, p) => {
    const phase = TAU * (365 - 130 * p) * t;
    return (Math.sin(phase) + .35 * Math.sin(phase * 1.52)) * Math.sin(Math.PI * p) * .23;
  });
  out.heal = make(ctx, 0.5, (t, p) => (Math.sin(TAU * 660 * t) + Math.sin(TAU * 990 * t)) * Math.sin(Math.PI * p) * 0.2);

  // Attack layers: windup as the attacker gathers, a travel whoosh for projectiles,
  // and a low thump under heavy or knockout hits.
  out.windup = make(ctx, 0.34, (t, p, s) => {
    s.bp = (s.bp || 0) + (noise() - (s.bp || 0)) * (0.04 + 0.3 * p);
    return (s.bp * 1.4 + Math.sin(TAU * (180 + 520 * p * p) * t) * 0.25) * p * Math.min(1, (1 - p) * 10);
  }, 0.32);
  out.whoosh = make(ctx, 0.46, (t, p, s) => {
    s.a = (s.a || 0) + (noise() - (s.a || 0)) * (0.08 + 0.25 * Math.sin(Math.PI * p));
    return s.a * Math.sin(Math.PI * p) ** 1.5;
  }, 0.3);
  out.thump = make(ctx, 0.32, (t, p, s) => {
    s.lp = (s.lp || 0) + (noise() - (s.lp || 0)) * 0.08;
    return Math.sin(TAU * (78 - 30 * p) * t) * Math.exp(-p * 7) + s.lp * Math.exp(-p * 18) * 0.6;
  }, 0.4);

  // Knockout: falling tone over a soft body-drop and a low minor dyad.
  out.ko = make(ctx, 0.9, (t, p, s) => {
    s.lp = (s.lp || 0) + (noise() - (s.lp || 0)) * 0.06;
    const fall = Math.sin(TAU * (520 - 380 * p) * t) * (1 - p) * 0.45;
    const drop = t > 0.32 ? (s.lp * 1.8 + Math.sin(TAU * 62 * t) * 0.6) * Math.exp(-(t - 0.32) * 9) : 0;
    const dyad = (Math.sin(TAU * 220 * t) + Math.sin(TAU * 261.6 * t)) * 0.12 * Math.sin(Math.PI * p);
    return fall + drop + dyad;
  }, 0.5);
  // Victory: a short rising arpeggio resolving onto a held major chord.
  out.win = make(ctx, 1.7, (t, p) => {
    const brass = (f, at) => {
      if (t < at) return 0;
      const u = t - at, ph = TAU * f * u;
      return (Math.sin(ph) + .45 * Math.sin(2 * ph) + .2 * Math.sin(3 * ph)) * Math.min(1, u * 30) * Math.exp(-u * 1.2);
    };
    const notes = [[523.3, 0], [659.3, .12], [784, .24], [1046.5, .36]];
    const chord = [523.3, 659.3, 784].reduce((a, f) => a + brass(f, .62), 0) * 0.6;
    return (notes.reduce((a, [f, at]) => a + (t < at + .4 ? brass(f, at) : 0), 0) + chord) * Math.min(1, (1 - p) * 4);
  }, 0.5);

  // Optional crowd: a seamless low murmur loop and a short cheer for knockouts.
  out.crowd = make(ctx, 4, (t, p, s) => {
    s.a = (s.a || 0) + (noise() - (s.a || 0)) * 0.05;
    s.b = (s.b || 0) + (noise() - (s.b || 0)) * 0.012;
    const swell = 0.75 + 0.25 * Math.sin(TAU * p * 2) * Math.sin(TAU * p * 3);
    return (s.a * 0.7 + s.b * 2) * swell * Math.min(1, p * 40, (1 - p) * 40);
  }, 0.5);
  out.cheer = make(ctx, 1.3, (t, p, s) => {
    s.a = (s.a || 0) + (noise() - (s.a || 0)) * 0.22;
    return s.a * Math.min(1, p * 8) * (1 - p) ** 1.3;
  }, 0.45);

  for (const [id, voice] of Object.entries(CRY_VOICE)) for (const kind of CRY_KINDS) out[`cry:${id}:${kind}`] = cry(ctx, voice, kind);
  for (const kind of CRY_KINDS) out[`cry:default:${kind}`] = cry(ctx, DEFAULT_VOICE, kind);
  return out;
}
export const cryName = (id, kind) => `cry:${CRY_VOICE[id] ? id : 'default'}:${kind}`;

// ---------- live graph ----------
export function initAudio(camera) {
  listener = new THREE.AudioListener();
  camera.add(listener);
  listener.setMasterVolume(MASTER);
  const ctx = listener.context;
  // Limiter after the master so stacked layers and cries never clip the speakers.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
  listener.gain.disconnect(); listener.gain.connect(comp); comp.connect(ctx.destination);
  buses = {};
  for (const [cat, level] of Object.entries(CATEGORY_LEVEL)) {
    const g = ctx.createGain(); g.gain.value = level; g.connect(listener.getInput()); buses[cat] = g;
  }
  Object.assign(buffers, synthesize(ctx));
  resetVariation();
  return listener;
}
export function resumeAudio() {
  if (listener?.context.state === 'suspended') listener.context.resume().then(() => settings.crowd && startCrowd());
  else if (settings.crowd) startCrowd();
}

// Play a sound at a position inside `parent` (e.g. the table root).
// opts.gain scales this one play; opts.delay starts it later (seconds).
export function play(name, parent, pos, opts = {}) {
  if (!listener || !buffers[name]) return;
  if (listener.context.state !== 'running') return;
  const cat = categoryOf(name);
  if (cat === 'ambient' && !settings.crowd) return; // crowd sounds are opt-in
  const v = variation(name);
  const a = new THREE.PositionalAudio(listener);
  a.gain.disconnect(); a.gain.connect(buses[cat]);
  a.setBuffer(buffers[name]); a.setRefDistance(0.4); a.setRolloffFactor(1.2);
  a.setVolume((opts.gain ?? 1) * v.gain);
  a.setPlaybackRate(v.rate);
  if (pos) a.position.copy(pos);
  parent.add(a); a.play(opts.delay || 0);
  a.source.onended = () => { a.disconnect(); a.gain.disconnect(); a.removeFromParent(); };
}

function duck(on) {
  if (!buses) return;
  const now = listener.context.currentTime;
  for (const cat of DUCKED) buses[cat].gain.setTargetAtTime(CATEGORY_LEVEL[cat] * (on ? DUCK : 1), now, on ? 0.04 : 0.25);
}

// ---------- optional announcer ----------
// Reads the on-table callout aloud. Off by default, never queues more than one
// line, and does nothing where the browser has no voices (headless capture).
export function announceText(text) {
  const s = String(text).replace(/\s*\n\s*/g, ' ').replace(/\s+·\s+/g, ', ').replace(/\s*→\s*/g, ' to ').toLowerCase().trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export function announce(text) {
  if (!settings.voice) return false;
  const synth = globalThis.speechSynthesis;
  if (!synth || !globalThis.SpeechSynthesisUtterance || !synth.getVoices().length) return false;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(announceText(text));
  u.rate = 1.1; u.pitch = 1.05; u.volume = 0.9;
  u.onstart = () => duck(true);
  u.onend = u.onerror = () => duck(false);
  synth.speak(u);
  return true;
}
function stopVoice() { try { globalThis.speechSynthesis?.cancel(); } catch { /* ignore */ } duck(false); }

// ---------- optional crowd bed ----------
function startCrowd() {
  if (crowdLoop || !listener || listener.context.state !== 'running') return;
  crowdLoop = new THREE.Audio(listener);
  crowdLoop.gain.disconnect(); crowdLoop.gain.connect(buses.ambient);
  crowdLoop.setBuffer(buffers.crowd); crowdLoop.setLoop(true); crowdLoop.play();
}
function stopCrowd() { if (crowdLoop) { crowdLoop.stop(); crowdLoop.disconnect(); crowdLoop.gain.disconnect(); crowdLoop = null; } }
