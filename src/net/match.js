// Match synchronisation. One peer owns an Authority (the only place rules
// run and HP changes). Everyone else - local player, AI, remote headset - is
// a MatchClient that sends action requests and applies confirmed results.
//
// Guarantees:
//  * a request id is applied at most once (repeated pinch / repeated message)
//  * a client ignores any update whose seq it has already applied
//  * reconnecting clients receive a snapshot (state only, no events), so the
//    last hit can never be replayed or applied twice
import { applyAction, viewFor, eventsFor } from '../rules/engine.js';

export class Authority {
  constructor(state, { onChange, epoch } = {}) {
    this.state = state;
    this.epoch = epoch || Math.random().toString(36).slice(2, 10);
    this.senders = new Map(); // seat -> fn(msg)
    this.seen = new Map();    // reqId -> result summary
    this.onChange = onChange;
  }
  attach(seat, send) { this.senders.set(seat, send); }
  detach(seat) { this.senders.delete(seat); }

  handle(seat, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') { this.sendSnapshot(seat); return; }
    if (msg.t !== 'req') return;
    const key = `${seat}:${msg.reqId}`;
    if (this.seen.has(key)) return; // duplicate delivery: already handled
    const res = applyAction(this.state, seat, msg.action);
    this.seen.set(key, res.ok);
    if (this.seen.size > 500) this.seen.delete(this.seen.keys().next().value);
    if (!res.ok) { this.send(seat, { t: 'reject', reqId: msg.reqId, error: res.error, action: msg.action }); return; }
    this.state = res.state;
    for (const s of this.senders.keys()) {
      this.send(s, { t: 'update', reqId: s === seat ? msg.reqId : null, seq: this.state.seq, events: eventsFor(res.events, s), state: viewFor(this.state, s) });
    }
    this.onChange?.(this.state);
  }
  sendSnapshot(seat) { this.send(seat, { t: 'snapshot', seq: this.state.seq, state: viewFor(this.state, seat) }); }
  send(seat, msg) { const f = this.senders.get(seat); if (f) f({ ...msg, epoch: this.epoch }); }
}

let reqCounter = 0;
export class MatchClient {
  constructor(seat, send) {
    this.seat = seat;
    this.send = send;
    this.lastSeq = -1;
    this.state = null;
    this.listeners = { update: [], reject: [] };
  }
  on(evt, fn) { this.listeners[evt].push(fn); return () => { this.listeners[evt] = this.listeners[evt].filter((f) => f !== fn); }; }
  emit(evt, data) { for (const f of this.listeners[evt]) f(data); }

  request(action) {
    const reqId = `${this.seat}-${Date.now().toString(36)}-${(reqCounter++).toString(36)}`;
    this.send({ t: 'req', reqId, action });
    return reqId;
  }
  hello() { this.send({ t: 'hello', lastSeq: this.lastSeq }); }

  receive(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'reject') { this.emit('reject', msg); return; }
    if (msg.t !== 'update' && msg.t !== 'snapshot') return;
    // A new authority epoch (host restarted without saved state) resets ordering.
    if (msg.epoch !== this.epoch) { this.epoch = msg.epoch; this.lastSeq = -1; }
    // Rematch keeps seq monotonic, so seq alone orders every update.
    if (msg.seq <= this.lastSeq) return; // already applied: never replay
    const gap = msg.t === 'update' && this.lastSeq >= 0 && msg.seq !== this.lastSeq + 1;
    const snapshot = msg.t === 'snapshot' || gap;
    this.lastSeq = msg.seq;
    this.state = msg.state;
    this.emit('update', { state: msg.state, events: snapshot ? [] : msg.events, snapshot, reqId: msg.reqId || null });
  }
}

// ---------------------------------------------------------------- sessions
const later = (fn) => (typeof queueMicrotask === 'function' ? queueMicrotask(fn) : Promise.resolve().then(fn));

// Offline Quick Battle: authority, local player (seat 0) and AI (seat 1) in-process.
export function createLocalSession(state) {
  const authority = new Authority(state);
  const local = new MatchClient(0, (m) => later(() => authority.handle(0, m)));
  const ai = new MatchClient(1, (m) => later(() => authority.handle(1, m)));
  authority.attach(0, (m) => later(() => local.receive(m)));
  authority.attach(1, (m) => later(() => ai.receive(m)));
  local.hello(); ai.hello();
  return { kind: 'local', authority, client: local, ai, status: 'connected' };
}

// In-memory duplex link, used by the Node simulation and the two-tab path.
export function memoryLinkPair() {
  const a = { handlers: [], send: null, onMessage(f) { this.handlers.push(f); } };
  const b = { handlers: [], send: null, onMessage(f) { this.handlers.push(f); } };
  a.send = (m) => later(() => b.handlers.forEach((f) => f(JSON.parse(JSON.stringify(m)))));
  b.send = (m) => later(() => a.handlers.forEach((f) => f(JSON.parse(JSON.stringify(m)))));
  return [a, b];
}

// Host = seat 0 and authoritative. `link` carries messages to/from the guest.
export function createHostSession(state, link, { onChange, epoch } = {}) {
  const authority = new Authority(state, { onChange, epoch });
  const local = new MatchClient(0, (m) => later(() => authority.handle(0, m)));
  authority.attach(0, (m) => later(() => local.receive(m)));
  authority.attach(1, (m) => link.send(m));
  link.onMessage((m) => authority.handle(1, m));
  local.hello();
  return { kind: 'host', authority, client: local };
}

export function createGuestSession(link) {
  const client = new MatchClient(1, (m) => link.send(m));
  link.onMessage((m) => client.receive(m));
  client.hello();
  return { kind: 'guest', client };
}
