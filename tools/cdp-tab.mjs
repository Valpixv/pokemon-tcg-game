// Bounded Chrome DevTools Protocol tab for the capture tools.
// Every step either finishes or rejects with the scene and phase that failed:
// tab creation and the WebSocket handshake are time-limited, a socket that closes
// rejects all outstanding calls at once, and calls after closure fail immediately.

export async function openTab(cdp,{scene,openTimeout=15000,callTimeout=30000,evaluateTimeout=360000,httpTimeout=10000}={}){
 let phase='creating tab',closed=false,seq=0,target=null,ws=null;
 const calls=new Map();
 const fail=(reason,at=phase)=>Error(`Capture ${scene} failed during ${at}: ${reason}`);
 async function closeTarget(){
  if(target)await fetch(cdp+'/json/close/'+target.id,{signal:AbortSignal.timeout(httpTimeout)}).catch(()=>{});
 }
 try{
  const res=await fetch(cdp+'/json/new?about:blank',{method:'PUT',signal:AbortSignal.timeout(httpTimeout)});
  if(!res.ok)throw Error('DevTools answered HTTP '+res.status);
  target=await res.json();
  if(!target?.webSocketDebuggerUrl)throw Error('DevTools returned no debugger URL');
 }catch(e){throw fail(e.message)}

 phase='opening socket';
 ws=new WebSocket(target.webSocketDebuggerUrl);
 try{
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('handshake timed out after '+openTimeout+'ms')),openTimeout);
   ws.onopen=()=>{clearTimeout(timer);resolve()};
   ws.onerror=()=>{clearTimeout(timer);reject(Error('socket error before open'))};
   ws.onclose=e=>{clearTimeout(timer);reject(Error('socket closed before open (code '+e.code+')'))};
  });
 }catch(e){
  closed=true;try{ws.close()}catch{}
  await closeTarget();
  throw fail(e.message);
 }

 phase='connected';
 ws.onerror=null;
 ws.onclose=e=>{
  closed=true;
  for(const [,c] of calls){clearTimeout(c.timer);c.reject(fail('tab disconnected (code '+e.code+') awaiting '+c.method,c.phase))}
  calls.clear();
 };
 ws.onmessage=e=>{
  let m;try{m=JSON.parse(e.data)}catch{return}
  const c=m.id&&calls.get(m.id);if(!c)return;
  calls.delete(m.id);clearTimeout(c.timer);
  m.error?c.reject(fail(c.method+': '+m.error.message,c.phase)):c.resolve(m.result);
 };

 function send(method,params={}){
  if(closed||ws.readyState!==WebSocket.OPEN)return Promise.reject(fail('tab already disconnected before '+method));
  return new Promise((resolve,reject)=>{
   const id=++seq,at=phase,limit=method==='Runtime.evaluate'?evaluateTimeout:callTimeout;
   const timer=setTimeout(()=>{calls.delete(id);reject(fail(method+' timed out after '+limit+'ms',at))},limit);
   calls.set(id,{method,phase:at,timer,resolve,reject});
   try{ws.send(JSON.stringify({id,method,params}))}
   catch(e){calls.delete(id);clearTimeout(timer);reject(fail(method+': '+e.message,at))}
  });
 }
 async function ev(expression){
  const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});
  if(r.exceptionDetails)throw fail(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
  return r.result.value;
 }
 async function close(){
  closed=true;try{ws.close()}catch{}
  await closeTarget();
 }
 return {target,send,ev,close,
  get phase(){return phase},set phase(p){phase=p},
  get closed(){return closed},
  fail:reason=>fail(reason)};
}
