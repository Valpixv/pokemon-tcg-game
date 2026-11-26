import { prepareModel, importedSpecies } from './imported.js';
// Table-relative layout. Origin = arena centre on the tabletop.
// Each seat has its own frame (`side[seat]`), rotated 180 degrees for seat 1,
// in which +Z points toward that seat's player and +X is that player's right.
// Moving `root` moves arena, cards, creatures, buttons, panels and effects together.
import * as THREE from 'three';
import { ARENA, makeArena } from './arena.js';
import { CARD_W, CARD_H, makeCardMesh, cardFaceTexture, cardBackTexture } from './cards.js';
import { Label, roundRect, faceCameraY, tween, ease, lerp } from './util.js';
import { drawBall } from './trainer-emblem.js';
import { Effects } from './effects.js';
import { makeCreature } from './creatures.js';

export const LAYOUT = {
  creatureZ: 0.072,
  activeZ: 0.245,
  benchZ: 0.378,
  benchX: [-0.077, 0, 0.077],   // index 0 = player's left
  deck: [0.205, 0.29], trainer: [0.205, 0.405],
  hand: { x: -0.215, z: 0.38, step: 0.034 },
  actions: { x: 0.105, z: 0.212, step: 0.029 },
  score: [-0.112, 0.245],
  // Upright lineup: low and behind the owner's half so it never sits on the
  // sight line from either seat to either creature (see README test record).
  displayZ: 0.27, displayY: 0.12,
  panelX: 0.29, panelY: 0.07, panelZ: 0.03,
  preview: { x: -0.07, y: 0.112, z: ARENA.radius + 0.04, tilt: -0.18, yaw: 0.14 },
};
const FLAT = -Math.PI / 2;
const TILT = FLAT + 0.75;   // leaning back toward the seated player
const _qv = new THREE.Quaternion(), _qp = new THREE.Quaternion();
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

// ----------------------------------------------------------------- pieces
function bracket(w, h, { arm = 0.012, thick = 0.0016, color = '#ffffff', opacity = 0.95 } = {}) {
  const vertices = [];
  const bar = (bw, bh, x, y) => {
    const l = x - bw / 2, r = x + bw / 2, b = y - bh / 2, t = y + bh / 2;
    vertices.push(l,b,0, r,b,0, r,t,0, l,b,0, r,t,0, l,t,0);
  };
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    bar(arm, thick, sx * (w / 2 - arm / 2), sy * (h / 2 - thick / 2));
    bar(thick, arm - thick, sx * (w / 2 - thick / 2), sy * (h / 2 - (arm + thick) / 2));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const g = new THREE.Mesh(geometry, mat);
  g.rotation.x = FLAT; g.position.y = 0.0012;
  g.userData.mat = mat;
  return g;
}

// Buttons have four distinct looks:
//  rest        solid dark slate + light rim: readable on pale wood and dark tables
//  focus       cyan->violet fill, white rim, lifted toward the viewer
//  press       brightest fill, pushed in; shown from the first frame of the press
//  unavailable greyed, hatched, no lift; focusing it shows an amber rim instead
const liveButtons = new Set();
export class Button3D extends THREE.Group {
  constructor(text, { w = 0.068, h = 0.022, onSelect, enabled, priority = 1, interactables, sub = '' } = {}) {
    super();
    this.w = w; this.h = h; this.text = text; this.sub = sub; this.dim = false; this.hover = false; this.pressed = false; this.pressUntil = 0;
    this.canvas = document.createElement('canvas'); this.canvas.width = 512; this.canvas.height = Math.round(512 * h / w);
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.face.renderOrder = 12;
    // hit area slightly larger than the artwork, but never overlapping a neighbour
    // (action buttons are 29 mm apart; this hit area is 26 mm tall)
    this.hitMesh = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.12, h * 1.18), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
    this.add(this.face, this.hitMesh);
    this.ix = interactables;
    this.target = interactables.add({ hit: this.hitMesh, priority, enabled: () => this.visible && (!enabled || enabled()),
      onHover: (on) => { this.hover = on; this.draw(); },
      onPress: (on) => { if (on) { this.pressed = true; this.pressUntil = performance.now() + 140; this.face.scale.setScalar(0.94); this.draw(); } },
      onSelect: () => onSelect?.() });
    this.lift = 0;
    liveButtons.add(this);
    this.draw();
  }
  setText(text, sub = '') { if (text !== this.text || sub !== this.sub) { this.text = text; this.sub = sub; this.draw(); } }
  setDim(d) { if (d !== this.dim) { this.dim = d; this.draw(); } }
  tick(dt) {
    if (this.pressed && performance.now() > this.pressUntil) { this.pressed = false; this.draw(); }
    const focus = this.hover && !this.dim;
    this.lift = damp(this.lift, focus ? 1 : 0, 18, dt);
    const s = this.pressed ? 0.94 : 1 + 0.05 * this.lift;
    this.face.scale.setScalar(damp(this.face.scale.x, s, 30, dt));
    this.face.position.z = 0.0018 * this.lift;
  }
  draw() {
    const c = this.canvas, g = c.getContext('2d'); const W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    const focus = this.hover && !this.dim; const pressed = this.pressed && !this.dim;
    let fill;
    if (pressed || focus) {
      fill = g.createLinearGradient(0, 0, W, H);
      fill.addColorStop(0, pressed ? 'rgb(150,255,255)' : '#275878');
      fill.addColorStop(1, pressed ? 'rgb(205,150,255)' : '#1c3e59');
    } else fill = this.dim ? 'rgba(52,56,66,0.7)' : '#203d51';
    g.fillStyle = fill; roundRect(g, 4, 4, W - 8, H - 8, H * 0.3); g.fill();
    if (this.dim) { // hatch so "unavailable" does not rely on colour alone
      g.save(); g.clip(); g.strokeStyle = 'rgba(255,255,255,0.09)'; g.lineWidth = 6;
      for (let x = -H; x < W; x += 22) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + H, 0); g.stroke(); }
      g.restore();
    }
    g.strokeStyle = this.hover ? (this.dim ? 'rgba(255,196,90,0.95)' : '#ffffff') : 'rgba(255,255,255,0.55)';
    g.lineWidth = this.hover ? 7 : 4; roundRect(g, 4, 4, W - 8, H - 8, H * 0.3); g.stroke();
    drawBall(g, H * .46, H / 2, H * .24, this.dim ? '#83929a' : '#ff625b');
    const labelLeft = H * .86;
    g.fillStyle = this.dim ? 'rgba(255,255,255,0.5)' : (pressed ? '#101828' : '#ffffff');
    g.textBaseline = 'middle'; g.font = `800 ${Math.round(H * 0.44)}px system-ui, sans-serif`;
    if ('letterSpacing' in g) g.letterSpacing = '2px';
    if (this.sub) {
      g.textAlign = 'left'; g.fillText(this.text, labelLeft, H / 2, W * .72 - labelLeft);
      g.textAlign = 'right'; g.fillStyle = this.dim ? 'rgba(255,230,140,0.55)' : (pressed ? '#3a2400' : '#ffe27a'); g.fillText(this.sub, W * 0.93, H / 2, W * 0.2);
    } else { g.textAlign = 'center'; g.fillText(this.text, (labelLeft + W * .94) / 2, H / 2, W * .94 - labelLeft); }
    this.tex.needsUpdate = true;
  }
  dispose() { liveButtons.delete(this); this.ix.remove(this.target); this.tex.dispose(); }
  static tickAll(dt) { for (const b of liveButtons) b.tick(dt); }
}

// Billboarded HP bar: narrow dark backing, bright green bar, "HP 40/40".
export class HPBar extends THREE.Group {
  constructor() {
    super();
    const W = 0.068, H = 0.0135;
    this.back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ color: '#0c1018', transparent: true, opacity: 0.84, depthWrite: false }));
    this.track = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.004, 0.0036), new THREE.MeshBasicMaterial({ color: '#2b313d', depthWrite: false }));
    this.track.position.set(0, -0.0031, 0.0001);
    this.fillMesh = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.004, 0.0036), new THREE.MeshBasicMaterial({ color: '#45f06a', depthWrite: false }));
    this.fillMesh.geometry.translate((W - 0.004) / 2, 0, 0);
    this.fillMesh.position.set(-(W - 0.004) / 2, -0.0031, 0.0002);
    this.trail = new THREE.Mesh(this.fillMesh.geometry,
      new THREE.MeshBasicMaterial({ color: '#fff1c4', depthWrite: false }));
    this.trail.position.copy(this.fillMesh.position);
    this.trail.position.z -= .00005;
    this.trail.renderOrder = 11;
    this.trail.visible = false;
    this.label = new Label({ width: W - 0.004, height: 0.0072, px: 448, font: '800 44px system-ui, sans-serif', spacing: 2 });
    this.label.position.set(0, 0.0026, 0.0003);
    this.chargeIcon = new Label({ width: 0.013, height: 0.013, px: 64, font: '700 54px system-ui', color: '#ffe14a', bg: 'rgba(12,16,24,0.84)', radius: 0.5 }).set('⚡');
    this.chargeIcon.position.set(W / 2 + 0.0085, 0, 0); this.chargeIcon.visible = false;
    [this.back, this.track, this.fillMesh, this.label, this.chargeIcon].forEach((m) => { m.renderOrder = 11; });
    this.add(this.back, this.track, this.trail, this.fillMesh, this.label, this.chargeIcon);
    this.hp = 0; this.max = 1;
  }
  set(hp, max) {
    this.hp = hp; this.max = max;
    const f = Math.max(0.0001, hp / max);
    this.fillMesh.scale.x = f;
    this.fillMesh.material.color.set(f > 0.5 ? '#45f06a' : f > 0.25 ? '#ffd23a' : '#ff5a4a');
    this.label.set(`HP ${Math.round(hp)}/${max}`);
  }
  async animateTo(to, dur = 0.5) {
    const from = this.hp;
    this.trail.visible = from > to;
    await tween(dur, (p) => {
      this.set(lerp(from, to, ease.out(p)), this.max);
      if (this.trail.visible) {
        const follow = Math.max(0, (p - .42) / .58);
        this.trail.scale.x = Math.max(.0001, lerp(from, to, ease.out(follow)) / this.max);
      }
    });
    this.trail.visible = false;
    this.set(to, this.max);
  }
}

// One shared hold-progress meter: a dark pill with three dots that fill in
// turn, lifted above whatever card is being held and tilted to the reader.
class HoldMeter extends THREE.Group {
  constructor() {
    super();
    const pill = new THREE.Mesh(new THREE.PlaneGeometry(0.046, 0.016), new THREE.MeshBasicMaterial({ color: '#0c1018', transparent: true, opacity: 0.82, depthWrite: false, depthTest: false }));
    const ringGeo = new THREE.RingGeometry(0.0034, 0.0046, 20), dotGeo = new THREE.CircleGeometry(0.0034, 20);
    this.dots = [-1, 0, 1].map((i) => {
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, depthTest: false }));
      const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthTest: false }));
      ring.position.set(i * 0.013, 0, 0.0002); dot.position.set(i * 0.013, 0, 0.0003); this.add(ring, dot); return dot;
    });
    this.add(pill);
    [pill, ...this.children].forEach((m) => { m.renderOrder = 20; });
    this.visible = false; this.alpha = 0; this.p = 0;
  }
  // progress 0..1; each dot fills over its third of the hold
  set(p) { this.p = p; this.dots.forEach((d, i) => { const f = THREE.MathUtils.clamp(p * 3 - i, 0, 1); d.scale.setScalar(Math.max(0.001, f)); }); }
}

// One card slot on the table (active / bench / trainer).
class Slot extends THREE.Group {
  constructor(board, { title = '', titleSide = 'top', w = CARD_W + 0.006, h = CARD_H + 0.006 } = {}) {
    super();
    this.board = board;
    this.br = bracket(w, h); this.add(this.br);
    this.card = makeCardMesh(null); this.card.rotation.x = FLAT; this.card.position.y = 0.0008; this.card.visible = false; this.add(this.card);
    this.label = new Label({ width: 0.1, height: 0.012, px: 512, font: '800 46px system-ui, sans-serif', spacing: 5, bg: 'rgba(12,16,24,0.55)', radius: 0.5 });
    this.label.rotation.x = TILT + 0.3; this.label.position.set(0, 0.004, titleSide === 'top' ? -h / 2 - 0.009 : h / 2 + 0.009);
    this.add(this.label);
    this.title = title;
    this.plus = new Label({ width: 0.02, height: 0.02, px: 96, font: '300 90px system-ui', color: 'rgba(255,255,255,0.85)' }).set('+');
    this.plus.rotation.x = FLAT; this.plus.position.y = 0.002; this.plus.visible = false; this.add(this.plus);
    this.prompt = new Label({ width: 0.12, height: 0.02, px: 768, font: '600 44px system-ui, sans-serif', bg: 'rgba(15,20,30,0.78)', radius: 0.4, lineHeight: 1.2 });
    this.prompt.rotation.x = TILT; this.prompt.position.set(0, 0.03, -0.01); this.prompt.visible = false; this.add(this.prompt);
    this.hitMesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, h), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitMesh.position.y = 0.006; this.add(this.hitMesh);
    this.highlight = null; this.hovered = false; this.pressed = false; this.flashT = 0;
  }
  setHighlight(kind) { this.highlight = kind; }
  flash() { this.flashT = 1; }
  update(t, dt) {
    const m = this.br.userData.mat;
    if (this.flashT > 0) { this.flashT = Math.max(0, this.flashT - dt * 3); m.color.set('#ffffff'); m.opacity = 1; this.br.scale.setScalar(1 + 0.08 * this.flashT); }
    else {
      this.br.scale.setScalar(1);
      if (this.highlight) { m.color.set(this.highlight === 'target' ? '#7ff0ff' : this.highlight === 'warn' ? '#ffcf5a' : '#c9a6ff'); m.opacity = 0.6 + 0.4 * Math.sin(t * 6) ** 2; }
      else { m.color.set(this.hovered ? '#7ff0ff' : '#ffffff'); m.opacity = 0.95; }
    }
    // the card itself rises a little under focus and presses down on a pinch
    const target = this.pressed ? 0.0004 : this.hovered ? 0.003 : 0.0008; // never below the tabletop
    this.card.position.y = damp(this.card.position.y, target, 20, dt);
  }
}

// ------------------------------------------------------------------ Board
export class Board {
  constructor({ interactables, localSeat, cardMode = 'virtual', handlers }) {
    this.ix = interactables; this.localSeat = localSeat; this.cardMode = cardMode; this.h = handlers;
    this.root = new THREE.Group(); this.root.name = 'tableRoot';
    this.arena = makeArena(); this.root.add(this.arena);
    this.effects = new Effects(this.root);
    // Permanent local light for impacts. It exists from the start (intensity 0)
    // so a hit never adds a light and forces a shader recompile mid-attack.
    this.impactLight = new THREE.PointLight('#ffffff', 0, 0.12, 2); // physical units: a few cm away, ~0.003 cd is already a strong local flash
    this.impactLight.position.set(0, 0.05, 0); this.root.add(this.impactLight);
    this.side = [0, 1].map((s) => { const g = new THREE.Group(); g.rotation.y = s === 0 ? 0 : Math.PI; this.root.add(g); return g; });
    this.creatures = [null, null];  // current arena creature per seat
    this.anchor = [0, 1].map((s) => { const a = new THREE.Group(); a.position.set(0, ARENA.height + 0.0008, LAYOUT.creatureZ); a.rotation.y = Math.PI; this.side[s].add(a); return a; });
    this.hpBars = [0, 1].map((s) => { const b = new HPBar(); b.position.set(0, ARENA.height + 0.08, LAYOUT.creatureZ); this.side[s].add(b); return b; });
    this.displays = [0, 1].map((s) => this.buildDisplay(s));
    this.holdMeter = new HoldMeter(); this.root.add(this.holdMeter);
    this.buildLocalUI();
  }

  // Upright lineup of a seat's public cards, fronts toward the opponent.
  buildDisplay(seat) {
    const g = new THREE.Group(); g.position.set(0, 0, LAYOUT.displayZ); g.rotation.y = Math.PI; this.side[seat].add(g);
    g.userData.cards = [0, 1, 2, 3].map(() => {
      const c = makeCardMesh(null, { scale: 0.85 }); g.add(c); c.visible = false;
      const hit = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W * 0.85, CARD_H * 0.85), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
      c.add(hit);
      this.ix.add({ hit, kind: 'card', enabled: () => c.visible && this.h.canInspect(), onHover: () => {},
        hold: this.holdSpec(c, 0.7, () => this.h.inspect(c.userData.id, c)) });
      return c;
    });
    return g;
  }

  // Hold behaviour shared by every inspectable card: the meter appears over
  // the held card after a short delay (so quick taps do not flash it).
  holdSpec(obj, duration, onComplete, canShow = () => true) {
    return { duration,
      onStart: () => { this.holdMeter.userData.over = obj; this.holdMeter.set(0); },
      onProgress: (p) => { if (canShow()) { this.holdMeter.userData.over = obj; this.holdMeter.set(p); this.holdMeter.userData.active = p > 0.12; } },
      onComplete: () => { this.holdMeter.set(1); this.holdMeter.userData.active = false; onComplete(); },
      onCancel: () => { this.holdMeter.userData.active = false; } };
  }

  buildLocalUI() {
    const s = this.localSeat; const L = LAYOUT;
    const ui = new THREE.Group(); ui.name = 'localUI'; this.side[s].add(ui); this.ui = ui;

    // active slot
    this.activeSlot = new Slot(this); this.activeSlot.position.set(0, 0, L.activeZ); ui.add(this.activeSlot);
    this.ix.add(this.slotTarget(this.activeSlot, () => ({ where: 'active' })));
    // bench
    this.benchLabel = new Label({ width: 0.06, height: 0.01, px: 384, font: '800 44px system-ui', spacing: 10 }).set('BENCH');
    this.benchLabel.rotation.x = TILT + 0.3; this.benchLabel.position.set(L.benchX[0] - 0.012, 0.004, L.benchZ - CARD_H / 2 - 0.009);
    this.benchLabel.visible = false;
    ui.add(this.benchLabel);
    this.benchSlots = L.benchX.map((x, i) => {
      const sl = new Slot(this, { titleSide: 'bottom' }); sl.position.set(x, 0, L.benchZ); ui.add(sl);
      this.ix.add(this.slotTarget(sl, () => ({ where: 'bench', index: i })));
      return sl;
    });
    // deck
    this.deck = new THREE.Group(); this.deck.position.set(L.deck[0], 0, L.deck[1]); ui.add(this.deck);
    const edge = new THREE.MeshBasicMaterial({ color: '#dfe6f2' });
    this.deckStack = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, 0.006, CARD_H), [edge, edge,
      new THREE.MeshBasicMaterial({ map: cardBackTexture() }), new THREE.MeshBasicMaterial({ color: '#13307a' }), edge, edge]);
    this.deckStack.position.y = 0.003; this.deck.add(this.deckStack);
    this.deck.add(bracket(CARD_W + 0.006, CARD_H + 0.006, { opacity: 0.4 }));
    this.deckLabel = new Label({ width: 0.07, height: 0.01, px: 384, font: '700 40px system-ui', color: 'rgba(255,255,255,0.8)', spacing: 8 });
    this.deckLabel.rotation.x = TILT + 0.3; this.deckLabel.position.set(0, 0.004, -CARD_H / 2 - 0.008); this.deck.add(this.deckLabel);
    // trainer slot
    this.trainerSlot = new Slot(this, { titleSide: 'bottom' }); this.trainerSlot.position.set(L.trainer[0], 0, L.trainer[1]); ui.add(this.trainerSlot);
    this.trainerSlot.br.userData.mat.opacity = 0.5; this.trainerSlot.label.set('TRAINER', { color: 'rgba(255,255,255,0.75)' });
    // hand
    this.handGroup = new THREE.Group(); this.handGroup.position.set(L.hand.x, 0.012, L.hand.z); this.handGroup.rotation.x = TILT; ui.add(this.handGroup);
    this.handLabel = new Label({ width: 0.06, height: 0.01, px: 384, font: '700 40px system-ui', color: 'rgba(255,255,255,0.8)', spacing: 8 }).set('HAND');
    this.handLabel.position.set(0, CARD_H * 0.8 / 2 + 0.008, 0); this.handGroup.add(this.handLabel);
    this.handCards = [];
    // actions next to the active card
    this.actionsGroup = new THREE.Group(); this.actionsGroup.position.set(L.actions.x, 0.01, L.actions.z); ui.add(this.actionsGroup);
    this.actionButtons = [0, 1, 2, 3].map((i) => {
      const b = new Button3D('', { w: 0.082, h: 0.022, interactables: this.ix, onSelect: () => this.h.action(b.userData.spec, b) });
      b.rotation.x = TILT; b.position.set(0, i * 0.0005, i * L.actions.step); this.actionsGroup.add(b); b.visible = false; return b;
    });
    // score panel
    this.scorePanel = new THREE.Group(); this.scorePanel.position.set(L.score[0], 0.012, L.score[1]); this.scorePanel.rotation.x = TILT; ui.add(this.scorePanel);
    const sp = new Label({ width: 0.075, height: 0.05, px: 512, font: '700 50px system-ui', bg: 'rgba(16,22,34,0.78)', radius: 0.14, align: 'left', lineHeight: 2.6, padding: 0.09, border: 'rgba(255,255,255,0.25)' });
    sp.set('You\nOpponent'); this.scorePanel.add(sp); this.scoreText = sp;
    const ballGeo = new THREE.SphereGeometry(0.0034, 14, 10);
    this.scoreBalls = [0, 1].map((row) => [0, 1, 2].map((i) => {
      const m = new THREE.Mesh(ballGeo, new THREE.MeshStandardMaterial({ color: '#59606e', roughness: 0.3 }));
      m.position.set(0.012 + i * 0.0095, row === 0 ? 0.0105 : -0.0105, 0.003); this.scorePanel.add(m); return m;
    }));
    // turn panels, angled toward the local reader. Compact, high-contrast text.
    const panel = () => new Label({ width: 0.13, height: 0.058, px: 640, font: '700 46px system-ui, sans-serif', bg: 'rgba(16,22,34,0.76)', radius: 0.14, lineHeight: 1.3, border: 'rgba(255,255,255,0.22)', padding: 0.05 });
    this.leftPanel = panel(); this.leftPanel.position.set(-L.panelX, L.panelY, L.panelZ); this.leftPanel.rotation.set(-0.25, 0.55, 0); ui.add(this.leftPanel);
    this.rightPanel = panel(); this.rightPanel.position.set(L.panelX, L.panelY, L.panelZ); this.rightPanel.rotation.set(-0.25, -0.55, 0); ui.add(this.rightPanel);
    // system buttons under the right panel
    this.sysButtons = new THREE.Group(); this.sysButtons.position.set(L.panelX + 0.01, 0.012, L.panelZ + 0.09); this.sysButtons.rotation.y = -0.55; ui.add(this.sysButtons);
    this.btnReposition = new Button3D('REPOSITION', { w: 0.07, h: 0.018, interactables: this.ix, onSelect: () => this.h.reposition(), enabled: () => this.h.canReposition() });
    this.btnHints = new Button3D('HINTS ON', { w: 0.07, h: 0.018, interactables: this.ix, onSelect: () => this.h.toggleHints() });
    this.btnExit = new Button3D('MENU', { w: 0.07, h: 0.018, interactables: this.ix, onSelect: () => this.h.exit() });
    [this.btnReposition, this.btnHints, this.btnExit].forEach((b, i) => { b.rotation.x = TILT; b.position.set(0, 0, i * 0.023); this.sysButtons.add(b); });
    // move callout attached to the front lip of the stadium, on a soft dark band
    this.callout = new Label({ width: 0.24, height: 0.042, px: 1024, font: '800 64px system-ui, sans-serif', spacing: 12, lineHeight: 1.22, bg: 'rgba(10,14,22,0.5)', radius: 0.3 });
    this.callout.position.set(0, 0.028, ARENA.radius + 0.02); this.callout.rotation.x = -0.35; this.callout.visible = false; ui.add(this.callout);
    // banner + rematch
    this.banner = new Label({ width: 0.26, height: 0.06, px: 1024, font: '800 110px system-ui, sans-serif', spacing: 18, color: '#ffffff', bg: 'rgba(10,14,22,0.6)', radius: 0.3 });
    this.banner.position.set(0, 0.215, -0.02); this.banner.visible = false; ui.add(this.banner); // above both figures' HP bars
    this.btnRematch = new Button3D('REMATCH', { w: 0.09, h: 0.026, interactables: this.ix, priority: 2, onSelect: () => this.h.rematch() });
    this.btnRematch.position.set(0, 0.05, ARENA.radius + 0.01); this.btnRematch.rotation.x = -0.45; this.btnRematch.visible = false; ui.add(this.btnRematch); // front lip, clear of the figures
    // inspect preview: rises out of the held card to sit upright beside the
    // stadium's front, leaving the arena centre visible
    this.btnNewMatch=new Button3D('NEW MATCHUP',{w:.104,h:.023,interactables:this.ix,priority:2,onSelect:()=>this.h.newMatch()});
    this.btnNewMatch.position.copy(this.btnRematch.position);this.btnNewMatch.position.x=.108;
    this.btnNewMatch.rotation.copy(this.btnRematch.rotation);this.btnNewMatch.visible=false;ui.add(this.btnNewMatch);
    this.preview = makeCardMesh(null, { scale: 2.0 }); this.preview.visible = false; ui.add(this.preview);
    this.previewHome = { pos: new THREE.Vector3(L.preview.x, L.preview.y, L.preview.z), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(L.preview.tilt, L.preview.yaw, 0, 'YXZ')), scale: 2.0 };
    // hint bubble
    this.hint = new Label({ width: 0.11, height: 0.024, px: 640, font: '700 46px system-ui, sans-serif', bg: 'rgba(90,60,200,0.9)', radius: 0.45, border: 'rgba(255,255,255,0.8)' });
    this.hint.visible = false; this.hint.rotation.x = TILT; ui.add(this.hint);
    // short explanation shown beside whatever the player just touched
    this.toastLabel = new Label({ width: 0.12, height: 0.02, px: 768, font: '700 50px system-ui, sans-serif', bg: 'rgba(14,18,28,0.92)', radius: 0.45, border: 'rgba(255,196,90,0.95)', depthTest: false });
    this.toastLabel.renderOrder = 25; this.toastLabel.visible = false; this.root.add(this.toastLabel);
  }

  toast(text, obj) {
    const t = this.toastLabel; t.set(text); t.visible = true; t.userData.until = performance.now() + 1900;
    obj.updateWorldMatrix(true, false);
    const p = new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld); this.root.worldToLocal(p);
    t.position.set(p.x, p.y + 0.04, p.z); t.userData.anchorY = p.y + 0.04;
  }

  slotTarget(slot, where) {
    return { hit: slot.hitMesh, kind: 'card', priority: 0,
      enabled: () => this.h.slotEnabled(where()),
      onHover: (on) => { slot.hovered = on; },
      onPress: (on) => { slot.pressed = on; },
      onSelect: () => this.h.tapSlot(where()),
      hold: this.holdSpec(slot.card.visible ? slot.card : slot, 0.75, () => this.h.holdSlot(where(), slot), () => this.h.canInspectSlot(where())) };
  }

  setCardMode(mode) { this.cardMode = mode; }

  // ---------------------------------------------------------- sync to state
  slotFor(where) { return where.where === 'active' ? this.activeSlot : this.benchSlots[where.index]; }

  setSlotCard(slot, card, label) {
    const showVirtual = card && (this.cardMode !== 'physical');
    slot.card.visible = !!showVirtual;
    if (card && slot.card.userData.id !== card.id) slot.card.setCard(card.id);
    slot.label.set(label);
    slot.label.visible = !!label;
  }

  renderState(st, ui) {
    const me = st.players[this.localSeat];
    const L = LAYOUT;
    const a = me.active;
    this.setSlotCard(this.activeSlot, a, a ? `ACTIVE   HP ${a.hp}/${a.maxHp}` : 'ACTIVE');
    me.bench.forEach((c, i) => {
      const sl = this.benchSlots[i];
      const mark = c?.hex ? '  HEX ' + c.hex : '';
      this.setSlotCard(sl, c, c ? `HP ${c.hp}/${c.maxHp}${mark}` : '');
      sl.plus.visible = !c && ui.benchOpen;
    });
    this.benchLabel.visible = true;
    const deckCount = me.deckCount ?? me.deck?.length ?? 0;
    this.deckStack.visible = deckCount > 0;
    this.deckStack.scale.y = Math.max(0.2, deckCount / 4);
    this.deckLabel.set(deckCount ? `DECK ${deckCount}` : 'DECK EMPTY');
    this.renderHand(me.hand || [], ui);
    this.scoreText.set(`${st.players[this.localSeat].name}\n${st.players[1 - this.localSeat].name}`);
    for (const seat of [0, 1]) {
      const show = seat !== this.localSeat || ui.shared;
      const p = st.players[seat];
      const cards = this.displays[seat].userData.cards;
      const list = [p.active, ...p.bench];
      const xs = [0, -0.06, 0.06, -0.12];
      const ys = [L.displayY - 0.006, L.displayY, L.displayY, L.displayY];
      cards.forEach((cm, i) => {
        const c = list[i];
        cm.visible = show && !!c && !(ui.hideActive?.[seat] && i === 0);
        cm.userData.uid=c?.uid;
        if (c && cm.userData.id !== c.id) cm.setCard(c.id);
        cm.position.set(xs[i], ys[i], i === 0 ? 0.004 : 0);
      });
    }
  }

  renderHand(hand, ui) {
    while (this.handCards.length < hand.length) {
      const c = makeCardMesh(null, { scale: 0.8 });
      const hit = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W * 0.8, CARD_H * 0.8), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
      c.add(hit); this.handGroup.add(c);
      const glow = bracket(CARD_W * 0.8 + 0.006, CARD_H * 0.8 + 0.006, { color: '#7ff0ff' }); glow.rotation.x = 0; glow.position.z = 0.001; glow.visible = false; c.add(glow);
      c.userData.glow = glow;
      this.ix.add({ hit, kind: 'card', enabled: () => c.visible && this.h.handEnabled(c.userData.uid),
        onHover: (on) => { c.userData.hover = on; },
        onPress: (on) => { c.userData.pressed = on; },
        onSelect: () => this.h.tapHand(c.userData.uid),
        hold: this.holdSpec(c, 0.7, () => this.h.inspect(c.userData.id, c)) });
      this.handCards.push(c);
    }
    const n = hand.length;
    // Keep the rightmost card clear of the left bench as expanded decks draw.
    const step = Math.min(LAYOUT.hand.step,.133/Math.max(1,n-1));
    this.handCards.forEach((c, i) => {
      const card = hand[i];
      c.visible = !!card;
      if (!card) return;
      c.userData.uid = card.uid; if (c.userData.id !== card.id) c.setCard(card.id);
      c.position.x = (i - (n - 1) / 2) * step; c.position.z = i * 0.0006;
      c.rotation.z = -(i - (n - 1) / 2) * 0.06;
      c.userData.glow.visible = ui.selectedHand === card.uid;
    });
    this.handLabel.visible = n > 0;
  }

  setActions(buttons) {
    this.actionButtons.forEach((b, i) => {
      const spec = buttons[i];
      b.visible = !!spec;
      if (!spec) return;
      b.userData.spec = spec;
      b.setText(spec.text, spec.sub || '');
      b.setDim(!!spec.dim);
    });
  }

  // ------------------------------------------------------------- preview
  // Rises from `source` (an Object3D, usually the held card) to its home spot.
  async showPreview(id, source) {
    const p = this.preview; p.setCard(id); p.visible = true;
    const home = this.previewHome;
    const from = { pos: home.pos.clone(), quat: home.quat.clone(), scale: 0.3 };
    if (source) { // express the source card's pose in the preview's parent frame
      source.updateWorldMatrix(true, false); this.ui.updateWorldMatrix(true, false);
      const m = new THREE.Matrix4().copy(this.ui.matrixWorld).invert().multiply(source.matrixWorld);
      const s = new THREE.Vector3(); m.decompose(from.pos, from.quat, s);
      from.scale = s.x * (source.userData.front ? 1 : 1);
    }
    this.previewSource = source; this.previewFrom = from;
    const token = (this.previewToken = (this.previewToken || 0) + 1);
    await tween(0.26, (t) => {
      if (token !== this.previewToken) return;
      const k = ease.out(t);
      p.position.lerpVectors(from.pos, home.pos, k);
      p.position.y += Math.sin(k * Math.PI) * 0.015; // a small arc up out of the table
      p.quaternion.slerpQuaternions(from.quat, home.quat, k);
      p.scale.setScalar(lerp(from.scale, home.scale, k));
    });
  }
  async hidePreview() {
    const p = this.preview; if (!p.visible) return;
    const from = this.previewFrom; const home = this.previewHome;
    const token = (this.previewToken = (this.previewToken || 0) + 1);
    const startPos = p.position.clone(), startQuat = p.quaternion.clone(), startScale = p.scale.x;
    await tween(0.16, (t) => {
      if (token !== this.previewToken) return;
      const k = ease.in(t);
      if (from) { p.position.lerpVectors(startPos, from.pos, k); p.quaternion.slerpQuaternions(startQuat, from.quat, k); p.scale.setScalar(lerp(startScale, from.scale, k)); }
      else p.scale.setScalar(lerp(startScale, 0.01, k));
    });
    if (token === this.previewToken) { p.visible = false; p.position.copy(home.pos); p.quaternion.copy(home.quat); p.scale.setScalar(home.scale); }
  }

  // ------------------------------------------------------------ creatures
  async spawnCreature(seat, card, { animate = true } = {}) {
    const old = this.creatures[seat];
    const token = Symbol(); (this.spawnTokens ||= [null,null])[seat] = token;
    if (old && old.userData.uid === card.uid && old.visible) return old;
    const source = importedSpecies.includes(card.id) ? await prepareModel(card.id) : null;
    if (this.spawnTokens[seat] !== token || this.disposed) return;
    if (old) disposeCreature(old);
    const c = makeCreature(card.id, source); c.userData.uid = card.uid;
    // measured once at spawn: the HP bar floats above the tallest point
    // (ears, raised arms) plus room for the idle bob and attack stretch
    c.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(c.body);
    c.userData.top = box.max.y - c.getWorldPosition(new THREE.Vector3()).y;
    c.traverse((o) => { if (o.isMesh && o !== c.shadow) o.castShadow = true; }); // real shadow on desktop; the blob stays as contact grounding
    this.anchor[seat].add(c); this.creatures[seat] = c;
    if (animate) await c.appear(); else c.visible = true;
    return c;
  }
  removeCreature(seat) { if(this.spawnTokens)this.spawnTokens[seat]=null; const c = this.creatures[seat]; if (c) disposeCreature(c); this.creatures[seat] = null; }
  creatureLocal(seat, dy = 0.03) {
    const p = new THREE.Vector3(0, dy, 0); this.anchor[seat].localToWorld(p); return this.root.worldToLocal(p);
  }
  // A point on the attacker->defender line, `t` of the way from the defender
  // toward the attacker: where contact effects bloom.
  contactPoint(atkSeat, defSeat, t = 0.3, dy = 0.03) {
    const a = this.creatureLocal(atkSeat, dy), d = this.creatureLocal(defSeat, dy);
    return d.clone().lerp(a, t);
  }

  async showCallout(text) {
    const c = this.callout; c.set(text.toUpperCase()); c.visible = true;
    await tween(0.1, (p) => { c.material.opacity = p; c.scale.setScalar(0.92 + 0.08 * ease.out(p)); });
  }
  hideCallout() { this.callout.visible = false; }

  // Short white-hot local light at an impact, tinted to the move.
  flashLight(pos, color, peak = 0.003, dur = 0.22) {
    const L = this.impactLight; L.position.copy(pos); L.color.set(color);
    const token = (this.lightToken = (this.lightToken || 0) + 1);
    L.intensity = peak;
    return tween(dur, (t) => { if (token === this.lightToken) L.intensity = peak * (1 - t) ** 2; });
  }

  popScore(row, i) {
    const m = this.scoreBalls[row]?.[i]; if (!m) return;
    tween(0.4, (t) => m.scale.setScalar(1 + 0.9 * Math.sin(t * Math.PI) * (1 - t * 0.5)));
  }

  showHint(text, where) {
    if (!text) { this.hint.visible = false; return; }
    this.hint.set(text); this.hint.visible = true;
    const p = new THREE.Vector3();
    if (where === 'bench0') p.set(LAYOUT.benchX[0] - 0.02, 0.05, LAYOUT.benchZ - 0.02);
    else if (where === 'actions') p.set(LAYOUT.actions.x + 0.085, 0.045, LAYOUT.actions.z);
    else p.set(0, 0.05, LAYOUT.activeZ);
    this.hint.position.copy(p);
    this.hint.userData.base = p.y;
  }

  setTurn(seat) { this.activeTurnSeat = seat; }

  update(dt, t, camWorld) {
    for (const [seat, arc] of this.arena.userData.seatArcs.entries()) {
      const target = seat === this.activeTurnSeat ? .49 + .12 * Math.sin(t * 3.6) : .13;
      arc.material.emissiveIntensity = damp(arc.material.emissiveIntensity, target, 9, dt);
    }
    for (const c of this.creatures) c?.update(dt, t);
    this.placeHpBars(dt, camWorld);
    for (const b of this.hpBars) faceCameraY(b, camWorld);
    faceCameraY(this.banner, camWorld);
    if (this.hint.visible) this.hint.position.y = this.hint.userData.base + Math.sin(t * 3) * 0.003;
    [this.activeSlot, ...this.benchSlots, this.trainerSlot].forEach((s) => s.update(t, dt));
    for (const c of this.handCards) {
      const target = c.userData.pressed ? -0.002 : c.userData.hover ? 0.008 : 0;
      c.position.y = damp(c.position.y, target, 14, dt);
    }
    Button3D.tickAll(dt);
    this.effects.tick();
    this.updateHoldMeter(dt, camWorld);
    const t2 = this.toastLabel;
    if (t2.visible) { this.faceViewer(t2, camWorld); const left = (t2.userData.until - performance.now()) / 1000; t2.material.opacity = Math.min(1, Math.max(0, left / 0.3)); if (left <= 0) t2.visible = false; }
  }

  // The far creature's bar floats just above its head. The near creature's
  // bar would otherwise project straight onto the far creature from a seated
  // eye height, so it sits low and to the viewer's left instead.
  placeHpBars(dt, camWorld) {
    if (!this._cam) { this._cam = new THREE.Vector3(); }
    this.root.updateWorldMatrix(true, false);
    const cam = this.root.worldToLocal(this._cam.copy(camWorld));
    const nearSeat = cam.z >= 0 ? 0 : 1;
    for (const seat of [0, 1]) {
      const bar = this.hpBars[seat]; const c = this.creatures[seat];
      const top = (c?.userData.top ?? 0.07) + ARENA.height;
      const near = seat === nearSeat;
      const tx = near ? -0.074 : 0, ty = near ? ARENA.height + 0.05 : top + 0.016, tz = LAYOUT.creatureZ + (near ? 0.012 : 0);
      if (bar.userData.placed == null) { bar.position.set(tx, ty, tz); bar.userData.placed = true; }
      bar.position.x = damp(bar.position.x, tx, 10, dt);
      bar.position.y = damp(bar.position.y, ty, 10, dt);
      bar.position.z = damp(bar.position.z, tz, 10, dt);
    }
  }

  updateHoldMeter(dt, camWorld) {
    const m = this.holdMeter; const over = m.userData.over;
    m.alpha = damp(m.alpha, m.userData.active ? 1 : 0, m.userData.active ? 30 : 16, dt);
    m.visible = m.alpha > 0.02 && !!over;
    if (!m.visible) return;
    over.updateWorldMatrix(true, false);
    const p = new THREE.Vector3().setFromMatrixPosition(over.matrixWorld);
    this.root.worldToLocal(p); p.y += 0.022; m.position.copy(p);
    // face the reader, level on screen
    this.faceViewer(m, camWorld);
    m.children.forEach((ch) => { ch.material.opacity = (ch.userData.baseOpacity ??= ch.material.opacity) * m.alpha; });
  }

  // Screen-aligned: copy the viewer's orientation (so text stays level even
  // off-centre with the head pitched down); falls back to facing the eye point.
  faceViewer(obj, camWorld) {
    const vq = this.effects.viewQuat;
    if (!vq) { obj.lookAt(camWorld); return; }
    vq(_qv); obj.parent.getWorldQuaternion(_qp).invert();
    obj.quaternion.copy(_qp.multiply(_qv));
  }

  // Free everything this board created. Card face/back textures are owned
  // by cards.js (shared across boards and rematches) and are kept.
  dispose() {
    this.disposed=true;
    this.effects.disposeKeepers();
    for (const b of [...liveButtons]) { let o = b; while (o && o !== this.root) o = o.parent; if (o) b.dispose(); }
    this.root.traverse((o) => {
      if (o.isSprite) return;
      o.skeleton?.dispose();
      if (!o.geometry?.userData.shared) o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const mat of mats) {
        if (mat.map && !mat.map.userData.shared) mat.map.dispose();
        mat.dispose();
      }
    });
    this.root.removeFromParent();
  }
}

// Creature meshes are per instance; their shadow texture is shared.
function disposeCreature(c) {
  c.removeFromParent();
  c.traverse((o) => {
    o.skeleton?.dispose();
    if (!o.geometry?.userData.shared) o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    mats.forEach((m) => {
      if (m.map && !m.map.userData.shared) m.map.dispose();
      m.dispose();
    });
  });
}

export { cardFaceTexture };
