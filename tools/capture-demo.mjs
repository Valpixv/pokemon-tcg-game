import {writeFile,mkdir,readFile,mkdtemp,realpath,rm} from 'node:fs/promises';
import {preview} from 'vite';
import {setTimeout as sleep} from 'node:timers/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {openTab} from './cdp-tab.mjs';

// A small WebM writer for the timestamped VP8/Opus packets returned by Chromium.
const cat=parts=>Buffer.concat(parts);
function number(n){let h=n.toString(16);if(h.length%2)h='0'+h;return Buffer.from(h,'hex')}
function node(id,...payload){const body=cat(payload);let bytes=1;while(body.length>=2**(7*bytes)-1)bytes++;const size=number(2**(7*bytes)+body.length);return cat([number(id),size,body]);}
const integer=(id,n)=>node(id,number(n)),str=(id,s)=>node(id,Buffer.from(s));
function decimal(id,n){const b=Buffer.alloc(8);b.writeDoubleBE(n);return node(id,b);}
function webm(width,height,seconds,packets){
 const head=node(0x1a45dfa3,integer(0x4286,1),integer(0x42f7,1),integer(0x42f2,4),integer(0x42f3,8),str(0x4282,'webm'),integer(0x4287,4),integer(0x4285,2));
 const info=node(0x1549a966,integer(0x2ad7b1,1000000),decimal(0x4489,seconds*1000),str(0x4d80,'Chromium WebCodecs'),str(0x5741,'Tabletop Battle'));
 const video=node(0xae,integer(0xd7,1),integer(0x73c5,1),integer(0x83,1),str(0x86,'V_VP8'),node(0xe0,integer(0xb0,width),integer(0xba,height)));
 const opus=Buffer.from('4f707573486561640101000080bb0000000000','hex');
 const audio=node(0xae,integer(0xd7,2),integer(0x73c5,2),integer(0x83,2),str(0x86,'A_OPUS'),node(0x63a2,opus),node(0xe1,decimal(0xb5,48000),integer(0x9f,1)));
 const clusters=[];let start=-1,blocks=[];
 function flush(){if(blocks.length)clusters.push(node(0x1f43b675,integer(0xe7,start),...blocks));blocks=[];}
 for(const packet of packets.sort((a,b)=>a.t-b.t||a.track-b.track)){
  if(start<0||packet.t-start>=2000){flush();start=packet.t;}
  const h=Buffer.alloc(4);h[0]=0x80|packet.track;h.writeInt16BE(packet.t-start,1);h[3]=packet.key?128:0;
  blocks.push(node(0xa3,h,Buffer.from(packet.data,'base64')));
 }
 flush();return cat([head,node(0x18538067,info,node(0x1654ae6b,video,audio),...clusters)]);
}

const port=Number(process.env.CAPTURE_PORT || 5291),debugPort=Number(process.env.CAPTURE_CDP_PORT || 9361);
const out=process.env.CAPTURE_OUT||'docs/video';
const harnessSource=await readFile('tools/harness.js','utf8');
const app=await preview({
  preview:{host:'127.0.0.1',port,strictPort:true}, logLevel:'error',
  plugins:[{name:'film-harness',configurePreviewServer(server){
    server.middlewares.use('/tools/harness.js',(_req,res)=>{
      res.setHeader('Content-Type','text/javascript');res.end(harnessSource);
    });
  }}]
});
const scratch=await realpath(tmpdir());
const profile=await mkdtemp(join(scratch,'pokemon-battle-film-profile-'));
const browser=spawn(process.env.EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',[
 '--headless=new','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--disable-background-timer-throttling','--enable-unsafe-swiftshader','--use-angle=swiftshader','--autoplay-policy=no-user-gesture-required','--no-first-run',
 '--remote-debugging-port='+debugPort,'--user-data-dir='+profile, 'about:blank'
],{windowsHide:true,stdio:'ignore'});
const origin='http://127.0.0.1:'+port,cdp='http://127.0.0.1:'+debugPort;
await mkdir(out,{recursive:true});
const shotSource=await readFile('tools/capture-shot.js','utf8');
const SEED=1024,failures=[];
// Acceptance rules for each shot; any problem marks the export as rejected (exit code 1).
function accept(kind,duration,e){
 const p=[],attack=['opening','exchange','showcase','garden','finish'].includes(kind);
 if(!e.audioActive)p.push('silent shot');
 if(kind==='inspection'&&!e.inspected)p.push('preview never opened');
 if(kind==='registration'&&e.final.phase!=='battle')p.push('registration did not reach battle');
 if(attack){
  if(!e.impacts.length)p.push('no attack landed');
  e.impactRms.forEach((r,i)=>{if(r<.002)p.push('silent attack '+e.impacts[i]+' at '+e.impactTimes[i]+'s');});
  const last=e.impactTimes.at(-1);if(last!=null&&last>duration-1.5)p.push('last impact '+last+'s leaves <1.5s to resolve');
  e.final.active.forEach((a,i)=>{const hp=a?a.split(' ').pop():null,bar=e.final.bars[i];
   if(hp?bar!==hp:!bar?.startsWith('0/'))p.push('seat '+i+' HP bar '+bar+' does not match '+(a||'empty active'));});
 }
 if(kind==='finish'){
  if(e.initial.matchPhase!=='play')p.push('finish starts at '+e.initial.matchPhase);
  if(!e.impacts.includes('takeDown'))p.push('finisher did not land');
  if(e.final.matchPhase!=='over'||e.overAt==null)p.push('match not won on camera');
  else if(e.overAt<1||e.overAt>duration-2)p.push('victory at '+e.overAt+'s (needs 1s lead-in and 2s hold)');
 }
 if(e.clipped)p.push('audio clipped');
 return p;
}
async function film(short){
 const width=short?1080:1920,height=short?1920:1080;
 const scenes=short?[['opening',8],['inspection',7],['showcase',7],['finish',8]]:[['opening',6],['registration',10],['inspection',9],['exchange',12],['showcase',14],['garden',12],['finish',13]];
 const packets=[],log=[];let offset=0;
 for(const [kind,duration] of scenes){
  // Bounded tab: startup, handshake and closure all reject with this scene and phase.
  // Software rendering takes about 30s of wall time per filmed second at 1920x1080, so the
  // recording call's limit scales with the scene (75s per second, never under 6 min).
  const tab=await openTab(cdp,{scene:(short?'short ':'wide ')+kind,evaluateTimeout:Math.max(360000,duration*75000)});
  const {send,ev}=tab;
  try{
   const team=kind==='showcase'?'&team=rush&away=tide&seed=1024':kind==='garden'?'&team=bloom&away=coil&seed=1024':'';
   tab.phase='page setup';
   await send('Page.enable');
   // Deterministic AI choices and effect jitter: seed Math.random per shot before any app code runs.
   await send('Page.addScriptToEvaluateOnNewDocument',{source:'(()=>{let s='+(SEED^kind.length*2654435761)+'>>>0;Math.random=()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};})()'});
   await send('Emulation.setDeviceMetricsOverride',{width:width/2,height:height/2,deviceScaleFactor:1,mobile:false});
   const scripted = kind==='finish'?'knockout-promotion':kind==='garden'?'hex-on-bench':null;
   const route = scripted ? '/?preview&camera=manual&demo='+scripted : '/?mode=quick&preview'+team;
   tab.phase='navigating';
   await send('Page.navigate',{url:origin+route});
   tab.phase='waiting for app';
   let ready=false;
   for(let i=0;i<250&&!(ready=await ev('!!window.__game?.reg'));i++)await sleep(100);
   if(!ready)throw tab.fail('app did not register within 25s');
   tab.phase='recording';
   console.log('Recording',short?'short':'wide',kind);
   const shot=await ev('('+shotSource+')('+JSON.stringify({width,height,kind,duration,short})+')');
   for(const p of shot.packets)packets.push({...p,t:Math.max(0,p.t)+offset*1000});
   const problems=accept(kind,duration,shot.evidence);
   log.push({kind,start:offset,duration,accepted:!problems.length,problems,...shot.evidence});offset+=duration;
   console.log(kind,offset,problems.length?'REJECTED: '+problems.join('; '):'accepted',shot.evidence.impacts);
   failures.push(...problems.map(p=>(short?'short ':'wide ')+kind+': '+p));
  }finally{await tab.close();}
 }
 const name=short?'tabletop-short':'tabletop-demo';
 await writeFile(out+'/'+name+'.webm',webm(width,height,offset,packets));
 await writeFile(out+'/'+name+'.json',JSON.stringify({width,height,seconds:offset,shots:log},null,2));
}
try{let up=false;for(let i=0;i<50&&!up;i++){try{up=(await fetch(cdp+'/json/version',{signal:AbortSignal.timeout(2000)})).ok;}catch{}if(!up)await sleep(200);}
 if(!up)throw Error('Capture browser failed during startup: DevTools did not answer on port '+debugPort+' within 10s');
 const mode=process.argv[2]||'both';if(mode!=='wide')await film(true);if(mode!=='short')await film(false);
}catch(e){console.error('CAPTURE FAILED: '+e.message);process.exitCode=1;
}finally{
 browser.kill();
 await app.close();
 const exact=await realpath(profile);
 if(exact===profile && dirname(exact)===scratch){
  await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:250})
    .catch(err=>console.warn('Temporary browser profile remains:',profile,err.code));
 }
}
if(failures.length){console.error('EXPORT REJECTED\n - '+failures.join('\n - '));process.exitCode=1;}
else if(!process.exitCode)console.log('EXPORT ACCEPTED');
