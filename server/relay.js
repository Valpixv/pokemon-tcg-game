// Minimal room relay for "Play at the Same Table".
// It never interprets game messages: the host headset is authoritative,
// the relay only forwards messages between the two peers of a room.
import { WebSocketServer } from 'ws';

export function attachRelay(httpServer, log = () => {}) {
  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Map(); // code -> { host, guest }

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/relay') return; // leave Vite HMR alone
    wss.handleUpgrade(req, socket, head, (ws) => {
      const code = (url.searchParams.get('room') || '').toUpperCase().slice(0, 8);
      const role = url.searchParams.get('role') === 'host' ? 'host' : 'guest';
      if (!code) { ws.close(4000, 'missing room'); return; }
      let room = rooms.get(code);
      if (!room) { room = { host: null, guest: null }; rooms.set(code, room); }
      if (role === 'guest' && !room.host && !room.hostSeen) {
        // Allow guest to wait for host; nothing special needed.
      }
      const old = room[role];
      if (old && old.readyState === 1) old.close(4001, 'replaced');
      room[role] = ws;
      if (role === 'host') room.hostSeen = true;
      log(`[relay] ${role} joined room ${code}`);
      const other = () => room[role === 'host' ? 'guest' : 'host'];
      const sendSys = (target, msg) => { if (target && target.readyState === 1) target.send(JSON.stringify({ sys: msg })); };
      sendSys(ws, { type: 'joined', role, peerPresent: !!(other() && other().readyState === 1) });
      sendSys(other(), { type: 'peer-joined', role });

      ws.on('message', (data) => {
        const o = other();
        if (o && o.readyState === 1) o.send(data.toString());
      });
      ws.on('close', () => {
        if (room[role] === ws) {
          room[role] = null;
          sendSys(other(), { type: 'peer-left', role });
          log(`[relay] ${role} left room ${code}`);
          if (!room.host && !room.guest) rooms.delete(code);
        }
      });
    });
  });
  return wss;
}

export function relayPlugin() {
  return {
    name: 'table-relay',
    configureServer(server) { if (server.httpServer) attachRelay(server.httpServer, (m) => server.config.logger.info(m)); },
    configurePreviewServer(server) { if (server.httpServer) attachRelay(server.httpServer, (m) => server.config.logger.info(m)); },
  };
}
