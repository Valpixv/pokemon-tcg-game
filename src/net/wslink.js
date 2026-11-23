// Browser WebSocket link to the room relay (served by the same dev server).
// Reconnects automatically; reports peer presence.
export class WsLink {
  constructor(code, role) {
    this.code = code; this.role = role; this.handlers = []; this.statusHandlers = []; this.queue = [];
    this.ws = null; this.closed = false; this.peer = false; this.retry = 0;
    this.connect();
  }
  url() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/relay?room=${encodeURIComponent(this.code)}&role=${this.role}`;
  }
  connect() {
    if (this.closed) return;
    const ws = new WebSocket(this.url()); this.ws = ws;
    ws.onopen = () => { this.retry = 0; this.status('open'); const q = this.queue; this.queue = []; q.forEach((m) => this.send(m)); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.sys) {
        if (m.sys.type === 'joined') { this.peer = m.sys.peerPresent; this.status(this.peer ? 'peer-joined' : 'waiting'); }
        else if (m.sys.type === 'peer-joined') { this.peer = true; this.status('peer-joined'); }
        else if (m.sys.type === 'peer-left') { this.peer = false; this.status('peer-left'); }
        return;
      }
      this.handlers.forEach((f) => f(m));
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.peer = false; this.status('disconnected');
      if (!this.closed) setTimeout(() => this.connect(), Math.min(4000, 500 * 2 ** this.retry++));
    };
  }
  status(s) { this.state = s; this.statusHandlers.forEach((f) => f(s)); }
  onMessage(f) { this.handlers.push(f); }
  onStatus(f) { this.statusHandlers.push(f); }
  send(m) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m));
    else if (m.t === 'req') { /* drop: requests are re-issued by the player, never replayed */ }
    else this.queue.push(m);
  }
  close() { this.closed = true; this.ws?.close(); }
}
