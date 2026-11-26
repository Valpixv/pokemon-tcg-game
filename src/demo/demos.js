// Deterministic solo demo playback.
// A demo is a fixed setup plus a list of steps. Each step names the seat that
// acts and a description of the wanted action; the concrete action is picked
// from legalActions() against the confirmed state at that moment, and is then
// sent through the game's normal request path (same validation as a pinch or
// the AI). Nothing here touches game state directly. Pure module: no DOM.
import { MOVES, QUICK_BATTLE, TEAMS, teamMatch } from '../rules/data.js';
import { legalActions } from '../rules/engine.js';

export const DEMOS = {
  // Quick Battle opening: you strike first, the opponent answers.
  'opening-exchange': {
    setup: () => QUICK_BATTLE,
    steps: () => [
      { seat: 0, cue: 'attack', want: { type: 'attack', kind: 'damage' } },
      { seat: 1, cue: 'opponent-attack', want: { type: 'attack', kind: 'damage' } },
    ],
  },
  // Team preset: each side plays its signature trainer (when legal), then attacks.
  'team-showcase': {
    setup: (o = {}) => teamMatch(o.seed ?? 19, o.team || 'coil', o.away || 'rush'),
    steps: (setup) => {
      const trainerOf = (seat) => setup.players[seat].hand.find(isTrainerId);
      return [
        { seat: 0, cue: 'trainer', optional: true, want: { type: 'trainer', cardId: trainerOf(0) } },
        { seat: 0, cue: 'attack', want: { type: 'attack', kind: 'damage' } },
        { seat: 1, cue: 'opponent-trainer', optional: true, want: { type: 'trainer', cardId: trainerOf(1) } },
        { seat: 1, cue: 'opponent-attack', want: { type: 'attack', kind: 'damage' } },
      ];
    },
  },
  // Take Down knocks out the opposing active, the opponent promotes its only
  // reserve, answers, and a second Take Down empties its side for the win.
  // Fixed setup (no shuffle); every step still resolves from legalActions().
  'knockout-promotion': {
    setup: () => ({
      players: [
        { name: 'You',      active: 'charmander', bench: ['squirtle'],  deck: ['potion', 'potion', 'potion'], hand: [] },
        { name: 'Opponent', active: 'gloomwing',  bench: ['gloomwing'], deck: ['potion', 'potion', 'potion'], hand: [] },
      ],
    }),
    steps: () => [
      { seat: 0, cue: 'knockout', want: { type: 'attack', move: 'takeDown' } },
      { seat: 1, cue: 'opponent-promote', want: { type: 'promote' } },
      { seat: 1, cue: 'opponent-attack', want: { type: 'attack', kind: 'damage' } },
      { seat: 0, cue: 'finisher', want: { type: 'attack', move: 'takeDown' } },
      { seat: 0, cue: 'win', await: 'win' }, // no request: waits for the authority's win
    ],
  },
  // Gastly's Hex chips Bulbasaur and marks it. The opponent retreats it to the
  // bench, which ends their turn; the mark resolves during that end-of-turn
  // step on the same card, now benched (retreat itself deals nothing). The
  // final step only observes the confirmed result. Fixed setup (no shuffle).
  'hex-on-bench': {
    setup: () => ({
      players: [
        { name: 'You',      active: 'gastly',    bench: ['squirtle'],   deck: ['potion', 'potion', 'potion'], hand: [] },
        { name: 'Opponent', active: 'bulbasaur', bench: ['charmander'], deck: ['potion', 'potion', 'potion'], hand: [] },
      ],
    }),
    steps: () => [
      { seat: 0, cue: 'hex', want: { type: 'attack', move: 'hex' } },
      { seat: 1, cue: 'opponent-retreat', want: { type: 'retreat' } },
      // seat = the cursed side; ready once its turn has ended and play is back to you.
      { seat: 1, cue: 'hex-resolved', await: 'hex-resolved', id: 'bulbasaur' },
    ],
  },
};

const TRAINER_IDS = new Set(Object.values(TEAMS).map((t) => t.trainer));
function isTrainerId(id) { return TRAINER_IDS.has(id); }

export function demoSetup(name, opts = {}) { return DEMOS[name] ? DEMOS[name].setup(opts) : null; }

function onTurn(st, seat) { return !!st && st.phase === 'play' && st.current === seat; }

// Whether the confirmed state is at the point this step is waiting for.
export function stepReady(st, step) {
  if (!st) return false;
  if (step.await === 'win') return st.phase === 'over' && st.winner === step.seat;
  if (step.await === 'hex-resolved') { // marked card is benched, damaged, and its mark spent
    if (!onTurn(st, 1 - step.seat)) return false;
    const p = st.players[step.seat];
    return p.active?.id !== step.id && p.bench.some((c) => c && c.id === step.id && !c.hex && c.hp < c.maxHp);
  }
  if (step.want?.type === 'promote') return st.phase === 'promote' && st.pendingPromote === step.seat;
  return onTurn(st, step.seat);
}

// First legal action matching the step, or null.
export function resolveStep(st, step) {
  if (step.await || !stepReady(st, step)) return null;
  const w = step.want; const hand = st.players[step.seat].hand || [];
  return legalActions(st, step.seat).find((a) => {
    if (a.type !== w.type) return false;
    if (w.move && a.move !== w.move) return false;
    if (w.kind && MOVES[a.move]?.kind !== w.kind) return false;
    if (w.cardId && hand.find((c) => c.uid === a.card)?.id !== w.cardId) return false;
    return true;
  }) || null;
}

// Drives a demo from the game loop. env = {
//   idle: boolean            no request pending / nothing presenting,
//   paused: boolean          intentional pause (menu, preview, connection);
//                            freezes every timer instead of counting as stuck,
//   stateFor(seat)           confirmed state as that seat sees it,
//   request(seat, action)    send through the normal request path,
//   cue(cue, targetSeat)     announce the next step (before it is sent) }
// Timeouts: `stall` = idle but the step never becomes playable; `busy` = never
// idle (presentation/request never settles). `busy` is generous so legitimately
// long animation chains are not cut off; paused time counts toward neither.
export class DemoPlayer {
  constructor(name, setup, { gap = 1.1, lead = 0.6, stall = 10, busy = 30 } = {}) {
    if (!DEMOS[name]) throw new Error(`Unknown demo ${name}`);
    this.name = name; this.steps = DEMOS[name].steps(setup);
    this.gap = gap; this.lead = lead; this.stall = stall; this.busy = busy;
    this.i = 0; this.status = 'running'; this.error = null;
    this.readyAt = null; this.cued = -1; this.fireAt = 0; this.waitSince = null;
    this.busyFor = 0; this.lastNow = null;
    this.log = []; // {cue, targetSeat, action, t} — evidence for the browser harness
  }

  get running() { return this.status === 'running'; }

  fail(msg, env) {
    if (!this.running) return;
    this.status = 'failed'; this.error = msg; env?.cue?.('failed', null);
  }

  // Stop silently (game torn down / navigated away). Idempotent; no cue.
  dispose() { if (this.running) this.status = 'disposed'; }

  tick(now, env) {
    if (!this.running) return;
    const dt = this.lastNow == null ? 0 : Math.max(0, now - this.lastNow);
    this.lastNow = now;
    if (env.paused) { // shift pending deadlines so the pause is invisible to timing
      if (this.readyAt != null) this.readyAt += dt;
      if (this.waitSince != null) this.waitSince += dt;
      this.fireAt += dt;
      return;
    }
    if (!env.idle) {
      this.readyAt = null; this.waitSince = null; this.busyFor += dt;
      if (this.busyFor > this.busy) this.fail(`Step ${this.i} never reached an idle table (busy ${this.busy}s)`, env);
      return;
    }
    this.busyFor = 0;
    if (this.readyAt == null) { this.readyAt = now + this.gap; return; }
    if (now < this.readyAt) return;
    const step = this.steps[this.i];
    if (!step) { this.status = 'done'; env.cue?.('done', null); return; }
    const st = env.stateFor(step.seat);
    if (!stepReady(st, step)) {
      if (this.waitSince == null) this.waitSince = now;
      else if (now - this.waitSince > this.stall) this.fail(`Step ${this.i} (${step.cue}) never became playable`, env);
      return;
    }
    this.waitSince = null;
    if (step.await) { // observation step: announce the confirmed outcome, send nothing
      this.log.push({ cue: step.cue, targetSeat: step.seat, action: null, t: now });
      this.i++; this.readyAt = null; env.cue?.(step.cue, step.seat); return;
    }
    const action = resolveStep(st, step);
    if (!action) {
      if (step.optional) { this.i++; this.readyAt = null; return; }
      this.fail(`Step ${this.i} (${step.cue}) has no legal action`, env); return;
    }
    if (this.cued !== this.i) { this.cued = this.i; this.fireAt = now + this.lead; env.cue?.(step.cue, step.seat); return; }
    if (now < this.fireAt) return;
    this.log.push({ cue: step.cue, targetSeat: step.seat, action, t: now });
    this.i++; this.readyAt = null;
    env.request(step.seat, action);
  }
}
