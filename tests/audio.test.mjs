import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS } from '../src/rules/data.js';
import {
  synthesize, variation, resetVariation, settings, announce, announceText,
  categoryOf, cryName, CRY_KINDS,
} from '../src/view/audio.js';

const RATE = 48000, FILM_MIX = .52; // capture-shot.js mixes every buffer at this level
const fakeCtx = { sampleRate: RATE, createBuffer: (ch, n, sr) => { const d = new Float32Array(n); return { length: n, sampleRate: sr, numberOfChannels: 1, getChannelData: () => d }; } };
const peak = (b) => b.getChannelData(0).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const sounds = synthesize(fakeCtx);
const species = Object.entries(CARDS).filter(([, c]) => c.kind === 'creature').map(([id]) => id);

test('variation is seeded, bounded and never draws from Math.random', () => {
  const real = Math.random;
  Math.random = () => { throw Error('audio variation must not consume the AI random stream'); };
  try {
    resetVariation(42); const a = Array.from({ length: 50 }, () => variation('fang'));
    resetVariation(42); const b = Array.from({ length: 50 }, () => variation('fang'));
    assert.deepEqual(a, b);
    for (const v of a) {
      assert.ok(v.rate >= .94 && v.rate <= 1.06, 'pitch within ±6%');
      assert.ok(v.gain >= 10 ** (-2 / 20) - 1e-9 && v.gain <= 10 ** (2 / 20) + 1e-9, 'gain within ±2 dB');
    }
    assert.ok(new Set(a.map(v => v.rate)).size > 40, 'repeats actually differ');
    resetVariation(1);
    for (let i = 0; i < 50; i++) { const v = variation('select'); assert.ok(Math.abs(v.rate - 1) <= .02); }
  } finally { Math.random = real; }
});

test('announcer and crowd are off by default; announce is a no-op while off', () => {
  assert.equal(settings.voice, false);
  assert.equal(settings.crowd, false);
  assert.equal(announce('PIKACHU USED\nPIKA PUNCH!'), false);
});

test('announcer text reads naturally', () => {
  assert.equal(announceText('PIKACHU USED\nPIKA PUNCH!'), 'Pikachu used pika punch!');
  assert.equal(announceText('GASTLY  ·  HEX\n50 → 40 HP'), 'Gastly, hex 50 to 40 hp');
});

test('every species has an original cry for each moment', () => {
  for (const id of species) for (const kind of CRY_KINDS) {
    const name = cryName(id, kind);
    assert.ok(name.startsWith('cry:' + id + ':'), id + ' has its own voice');
    assert.ok(sounds[name]?.length > 0, name);
    assert.equal(categoryOf(name), 'cry');
  }
  assert.equal(cryName('unknownmon', 'hurt'), 'cry:default:hurt');
  assert.ok(sounds['cry:default:hurt']);
});

test('synthesis is deterministic and no buffer clips', () => {
  const again = synthesize(fakeCtx);
  for (const [name, b] of Object.entries(sounds)) {
    assert.deepEqual(again[name].getChannelData(0), b.getChannelData(0), name + ' repeatable');
    assert.ok(peak(b) <= 1, name + ' peak ' + peak(b));
  }
  for (const name of ['windup', 'whoosh', 'thump', 'ko', 'win', 'crowd', 'cheer']) assert.ok(peak(sounds[name]) <= .5 + 1e-6, name);
});

test('the loudest stacked hit stays under 0.9 in the film mix', () => {
  // impact + heavy thump + the loudest hurt cry 0.14s later, mixed as capture-shot.js does
  const hurt = species.map(id => sounds[cryName(id, 'hurt')]).sort((a, b) => peak(b) - peak(a))[0];
  let worst = 0, worstName = '';
  for (const name of ['fang', 'electric', 'rock', 'vine', 'water', 'ember', 'hex', 'charge', 'heal']) {
    const layers = [[sounds[name], 0], [sounds.thump, 0], [hurt, Math.round(.14 * RATE)]];
    const n = Math.max(...layers.map(([b, at]) => b.length + at));
    for (let i = 0; i < n; i++) {
      let v = 0; for (const [b, at] of layers) { const k = i - at; if (k >= 0 && k < b.length) v += b.getChannelData(0)[k]; }
      if (Math.abs(v) * FILM_MIX > worst) { worst = Math.abs(v) * FILM_MIX; worstName = name; }
    }
  }
  assert.ok(worst < .9, `stacked ${worstName} peaks at ${worst.toFixed(3)}`);
});

test('crowd sounds are ambient (opt-in) and menu sounds stay in the ui bus', () => {
  assert.equal(categoryOf('crowd'), 'ambient');
  assert.equal(categoryOf('cheer'), 'ambient');
  assert.equal(categoryOf('confirm'), 'ui');
  assert.equal(categoryOf('thump'), 'move');
});
