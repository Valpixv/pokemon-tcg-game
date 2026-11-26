import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {WebSocketServer} from 'ws';
import {openTab} from '../tools/cdp-tab.mjs';

// A fake local DevTools endpoint. `mode` controls how the tab socket behaves.
async function devtools(mode){
 const closed=[],sockets=[];
 const server=createServer((req,res)=>{
  const {port}=server.address();
  if(req.url.startsWith('/json/new')){res.end(JSON.stringify({id:'T1',webSocketDebuggerUrl:`ws://127.0.0.1:${port}/devtools/page/T1`}));return;}
  if(req.url.startsWith('/json/close/')){closed.push(req.url.split('/').pop());res.end('Target is closing');return;}
  res.statusCode=404;res.end();
 });
 const wss=new WebSocketServer({noServer:true});
 server.on('upgrade',(req,socket,head)=>{
  sockets.push(socket);
  if(mode==='stall')return; // accept TCP, never answer the handshake
  if(mode==='refuse'){socket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n');return;}
  wss.handleUpgrade(req,socket,head,ws=>{
   ws.on('message',raw=>{
    const m=JSON.parse(raw);
    if(m.method==='Tab.closeNow'){ws.terminate();return;} // closes with a call outstanding
    if(m.method==='Runtime.evaluate'){ws.send(JSON.stringify({id:m.id,result:{result:{value:m.params.expression}}}));return;}
    if(m.method==='Never.answer')return;
    ws.send(JSON.stringify({id:m.id,result:{}}));
   });
  });
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {cdp:'http://127.0.0.1:'+server.address().port,closed,
  async stop(){for(const s of sockets)s.destroy();wss.close();server.closeAllConnections();await new Promise(r=>server.close(r));}};
}

test('stalled handshake rejects within the startup bound with scene and phase',{timeout:20000},async()=>{
 const d=await devtools('stall');
 try{
  const t0=Date.now();
  await assert.rejects(openTab(d.cdp,{scene:'short opening',openTimeout:300}),
   /Capture short opening failed during opening socket: handshake timed out/);
  assert.ok(Date.now()-t0<10000,'bounded, not hung');
  assert.deepEqual(d.closed,['T1'],'abandoned tab is closed');
 }finally{await d.stop();}
});

test('refused handshake rejects instead of hanging',{timeout:20000},async()=>{
 const d=await devtools('refuse');
 try{
  await assert.rejects(openTab(d.cdp,{scene:'wide garden',openTimeout:5000}),
   /Capture wide garden failed during opening socket: socket (error|closed) before open/);
 }finally{await d.stop();}
});

test('unreachable DevTools reports the tab-creation phase',{timeout:20000},async()=>{
 await assert.rejects(openTab('http://127.0.0.1:9',{scene:'short finish',httpTimeout:1000}),
  /Capture short finish failed during creating tab/);
});

test('tab closing mid-call rejects every outstanding request immediately',{timeout:20000},async()=>{
 const d=await devtools('normal');
 try{
  const tab=await openTab(d.cdp,{scene:'short showcase',callTimeout:20000,evaluateTimeout:20000});
  assert.equal(await tab.ev('1+1'),'1+1');
  tab.phase='recording';
  const t0=Date.now();
  const pending=tab.send('Never.answer');
  const closing=tab.send('Tab.closeNow');
  await assert.rejects(pending,/Capture short showcase failed during recording: tab disconnected .* awaiting Never\.answer/);
  await assert.rejects(closing,/awaiting Tab\.closeNow/);
  assert.ok(Date.now()-t0<10000,'did not wait for the 20s call timeout');
  assert.equal(tab.closed,true);
  await assert.rejects(tab.send('Page.enable'),/tab already disconnected before Page\.enable/);
  await tab.close(); // still safe after the socket is gone
 }finally{await d.stop();}
});

test('unanswered call times out with its method and phase',{timeout:20000},async()=>{
 const d=await devtools('normal');
 try{
  const tab=await openTab(d.cdp,{scene:'wide exchange',callTimeout:200});
  tab.phase='page setup';
  await assert.rejects(tab.send('Never.answer'),/failed during page setup: Never\.answer timed out after 200ms/);
  await tab.close();
  assert.deepEqual(d.closed,['T1']);
 }finally{await d.stop();}
});
