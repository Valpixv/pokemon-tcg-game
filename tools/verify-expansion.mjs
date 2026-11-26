import {preview} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const port=Number(process.env.VERIFY_PREVIEW_PORT || 5268);
const base='http://127.0.0.1:'+port,cdp='http://127.0.0.1:'+Number(process.env.VERIFY_CDP_PORT || 9348),directory='docs/captures/expansion';
await mkdir(directory,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port,strictPort:true}});
const harness=(await readFile('tools/harness.js','utf8')).replaceAll('export ','');
const evidence={assets:new Set(),errors:[],external:[],models:{},checks:[]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const RPC_TIMEOUT=Number(process.env.VERIFY_RPC_TIMEOUT || 120000);
// Legacy card IDs that must now render the local Cobblemon rigs rather than procedural meshes.
const LEGACY_RIGS={gloomwing:'zubat',voltpip:'pikachu'};
async function client(){
  const t=await(await fetch(cdp+'/json/new?about:blank',{method:'PUT'})).json();
  const ws=new WebSocket(t.webSocketDebuggerUrl);
  // Fail explicitly instead of hanging when the tab socket never opens, closes, or stops answering.
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CDP socket open timed out')),RPC_TIMEOUT);
    ws.onopen=()=>{clearTimeout(timer);resolve()};ws.onerror=()=>{clearTimeout(timer);reject(Error('CDP socket failed to open'))};});
  let seq=0,closed=null;const pending=new Map(),seen=new Set();
  function failAll(reason){closed=reason;for(const p of pending.values())p.reject(Error(reason));pending.clear()}
  ws.onclose=e=>failAll('CDP socket closed (code '+e.code+')');ws.onerror=()=>failAll('CDP socket error');
  function send(method,params={}){
    if(closed)return Promise.reject(Error(closed+' before '+method));
    const id=++seq;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP '+method+' timed out after '+RPC_TIMEOUT+'ms'))},RPC_TIMEOUT);
      pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});
      try{ws.send(JSON.stringify({id,method,params}))}catch(e){pending.get(id)?.reject(e);pending.delete(id)}
    });
  }
  const quiet=p=>p.catch(e=>{if(!closed)evidence.errors.push('CDP '+e.message)});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}
    if(m.method==='Fetch.requestPaused'){const {requestId,request}=m.params;if(new URL(request.url).origin===base)quiet(send('Fetch.continueRequest',{requestId}));else{evidence.external.push(request.url);quiet(send('Fetch.failRequest',{requestId,errorReason:'InternetDisconnected'}))}}
    if(m.method==='Network.responseReceived'){const r=m.params.response;if(r.status===200&&r.url.startsWith(base)){evidence.assets.add(r.url.slice(base.length));seen.add(r.url.slice(base.length))}}
    if(m.method==='Runtime.exceptionThrown')evidence.errors.push(m.params.exceptionDetails.exception?.description);
  };
  async function ev(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
  async function until(expr){for(let i=0;i<150;i++){if(await ev(expr))return;await sleep(80)}throw Error('Timed out: '+expr+' '+JSON.stringify(await ev('({url:location.href,phase:window.__game?.phase,state:!!window.__game?.st(),conn:window.__game?.connText})'))+' '+evidence.errors)}
  async function nav(url){await send('Page.navigate',{url:base+url});await until("document.readyState==='complete' && !!window.__step");}
  async function ready(){await until('!!window.__game?.st()');await ev('window.__step(.12)');await until('!!window.__game?.reg');await ev('(async()=>{'+harness+';window.H={ready,register,tap,step,screen,seat,snapshot,counts,press,release,profile};await ready()})()');}
  async function battle(){await ready();await ev('H.register()');await until('__game.phase==="battle" && __game.board.creatures.every(Boolean)');await ev('H.step(1.5)');}
  async function pic(name){const r=await send('Page.captureScreenshot',{format:'jpeg',quality:88});await writeFile(directory+'/'+name+'.jpg',Buffer.from(r.data,'base64'))}
  await send('Runtime.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  await send('Emulation.setDeviceMetricsOverride',{width:960,height:680,deviceScaleFactor:1,mobile:false});
  return {ev,nav,battle,ready,until,pic,seen,close:async()=>{try{await fetch(cdp+'/json/close/'+t.id)}finally{ws.onclose=null;ws.close()}}};
}
const c=await client();let guest;
const profileName=process.argv[2];
if(profileName && !['before','after','release'].includes(profileName))throw Error('Use before, after, or release for a profile run');
async function profileBattle(){
  const samples=[];
  for(const matchup of (profileName==='release'?['rush','bloom','original']:['rush','bloom'])){
    await c.nav(matchup==='original'?'/?mode=quick&preview':'/?mode=quick&preview&team='+matchup+'&away=tide&seed=1024');await c.battle();
    if(matchup==='rush')await c.ev(`(async()=>{const g=__game,p=g.st().players[0];
      g.tapHand(p.hand.find(c=>c.id==='switch').uid);g.tapSlot({where:'bench',index:0});await H.step(2);})()`);
    await c.until('(async()=>{await H.step(.15);return __game.canAct()})()');
    samples.push(await c.ev(`(async()=>{const g=__game,r=__debug.renderer,gl=r.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
      const move=g.board.actionButtons[0];await H.press(move);await H.step(1/60);H.release();
      const profile=await H.profile(1.3);
      return {move:move.text,confirmed:g.stats.impacts.at(-1)?.move,viewport:[innerWidth,innerHeight],browser:navigator.userAgent,
        gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),...profile};
    })()`));
  }
  assert.deepEqual(samples.map(s=>s.confirmed),profileName==='release'?['quickAttack','vineWhip','fangSnap']:['quickAttack','vineWhip']);
  await writeFile(directory+'/profile-'+profileName+'.json',JSON.stringify(samples,null,2));console.log(samples);
}
try{
  if(profileName)await profileBattle();else{
  // Cold production tab (cache disabled, fresh target): legacy IDs must fetch their own local rig files
  // and build independently animated imported rigs, not procedural fallbacks.
  {
    const cold=await client();
    try{
      await cold.nav('/?mode=quick&preview');await cold.until('!!window.__game?.board?.spawnCreature');
      const legacy=await cold.ev(`(async()=>{const b=__game.board,out={};
        for(const id of ${JSON.stringify(Object.keys(LEGACY_RIGS))}){
          const a=await b.spawnCreature(0,{id,uid:'cold-a-'+id},{animate:false}),z=await b.spawnCreature(1,{id,uid:'cold-b-'+id},{animate:false});
          let mesh;a.traverse(o=>{if(o.isSkinnedMesh)mesh=o});
          const r={rig:!!a.rig,skinned:!!mesh,texture:!!a.mats?.find(m=>m.map)?.map?.image};
          if(a.rig&&mesh){
            const v=new mesh.position.constructor(),pos=()=>{a.updateMatrixWorld(true);const xyz=[];for(let i=0;i<mesh.geometry.attributes.position.count;i++){mesh.getVertexPosition(i,v);xyz.push(v.x,v.y,v.z)}return xyz};
            a.update(0,.2);const i0=pos();a.update(0,.67);r.animated=pos().some((x,i)=>Math.abs(x-i0[i])>.0001);a.update(0,.2);
            r.separate=z.rig&&z.rig.rig!==a.rig.rig&&z.mats[0]!==a.mats[0];
            const nb=z.rig.nodes.values().next().value,old=nb.rotation.x;a.rig.nodes.values().next().value.rotation.x+=.2;
            r.independentPose=nb.rotation.x===old;a.rig.nodes.values().next().value.rotation.x-=.2;
          }
          a.removeFromParent?.();z.removeFromParent?.();out[id]=r;
        }return out;})()`);
      for(const [id,folder] of Object.entries(LEGACY_RIGS)){
        const r=legacy[id];
        assert.deepEqual(r,{rig:true,skinned:true,texture:true,animated:true,separate:true,independentPose:true},id+' is not an independent animated local rig: '+JSON.stringify(r));
        for(const file of ['model.json','skin.png','idle.json'])
          assert.ok([...cold.seen].some(u=>u.split('?')[0]==='/models/'+folder+'/'+file),id+' did not load /models/'+folder+'/'+file+' in cold tab');
      }
      (evidence.legacy={}).cold={result:legacy,assets:[...cold.seen].filter(u=>Object.values(LEGACY_RIGS).some(f=>u.startsWith('/models/'+f+'/')))};
      evidence.checks.push('cold production tab: gloomwing/voltpip load local zubat/pikachu model, skin and idle and animate independently');
    }finally{await cold.close()}
  }
  evidence.demos={};
  for (const name of ['opening-exchange','team-showcase','knockout-promotion','hex-on-bench']) {
    await c.nav('/?preview&demo='+name+'&seed=19');
    await c.until('!!window.__game?.demo');
    await c.ev('window.__paused=true');
    await c.until("(async()=>{await __step(.3);return __game.demo.status!=='running'})()");
    const result=await c.ev("({status:__game.demo.status,error:__game.demo.error,actions:__game.demo.log.map(x=>x.action),impacts:__game.stats.impacts.map(x=>x.move),hp:__game.st().players.map(p=>p.active?.hp ?? 0)})");
    assert.equal(result.status,'done',result.error);
    assert.equal(result.impacts.length,name==='knockout-promotion'?3:name==='hex-on-bench'?1:2);
    if(name==='opening-exchange'){
      assert.deepEqual(result.hp,[20,40]);
      assert.deepEqual(result.impacts,['fangSnap','sparkJab']);
    }
    evidence.demos[name]=result;
    console.log(name,result);
  }
  await c.nav('/?preview');await c.ev("document.getElementById('btnCollection').click()");await c.until("document.querySelector('.collection button')");
  await c.ev("document.querySelector('.collection button').click()");await c.until("document.querySelector('.details canvas')");await c.ev("document.querySelector('#closeLibrary').click();document.querySelector('#btnTeams').click();document.querySelector('#library input[type=number]').value='1024';document.querySelectorAll('.teams button')[2].click()");
  await c.battle();console.log('Menu and register',await c.ev('H.snapshot()'));await c.pic('garden-near');await c.ev('H.seat(1);H.step(.2)');await c.pic('garden-far');await c.ev('H.seat(0);H.step(.2)');
  await c.ev('H.tap(__game.board.benchSlots[0],.9)');assert.equal(await c.ev('__game.previewOpen'),true);await c.ev('H.tap(__game.board.benchSlots[0]);');await c.ev('H.tap(__game.board.actionButtons[0],.05,{after:.30})');await c.pic('vine-whip');
  for(let i=0;i<12;i++){await c.ev('H.step(.8)');await sleep(40)}
  assert.ok(await c.ev("__game.stats.impacts.some(x=>x.move==='vineWhip')"));evidence.checks.push('preset menu, collection, registration, inspection, Vine Whip and opponent reply');
  await c.ev('H.tap(__game.board.actionButtons.find(b=>b.text==="RETREAT"));');await c.ev('H.tap(__game.board.benchSlots[0])');
  for(let i=0;i<12;i++){await c.ev('H.step(.85)');await sleep(30)}
  assert.equal(await c.ev('__game.st().players[0].active.id'),'gastly');await c.pic('retreat');
  // Exercise the same authority and presentation queue used by normal play.
  for(let run=0;run<2;run++){
  let promoted=false;
  for(let i=0;i<340;i++){
    const result=await c.ev(`(async()=>{const g=__game,s=g.st(),p=s.players[0];
    if(g.canAct()&&s.phase==='promote'&&s.pendingPromote===0){g.tapSlot({where:'bench',index:p.bench.findIndex(Boolean)});}
    else if(g.canAct()&&s.current===0&&s.phase==='play'){
      const creature=p.hand.find(c=>c.hp>0),slot=p.bench.findIndex(c=>!c);
      if(creature&&slot>=0){g.tapHand(creature.uid);g.tapSlot({where:'bench',index:slot});}
      else g.onActionButton(g.board.actionButtons[0].userData.spec);
    }
    await H.step(2);return {phase:g.st().phase,score:g.st().players.map(p=>p.score),promote:s.phase==='promote',over:g.board.btnRematch.visible};})()`);
    if(result.promote && !promoted)await c.pic('promotion');
    promoted ||= result.promote;
    if(result.over){console.log('Finished expanded match',result);break}
    if(i===339)throw Error('Expanded match stalled '+JSON.stringify(result));
  }
  assert.ok(promoted);const placement=await c.ev('__game.board.root.matrix.toArray()');
  const countsBefore=await c.ev('H.counts()');
  await c.ev(run===0?'H.tap(__game.board.btnRematch)':'H.tap(__game.board.btnNewMatch)');await c.until('__game.st().match==='+String(run+2));
  await c.ev('H.step(2)');assert.deepEqual(await c.ev('__game.board.root.matrix.toArray()'),placement);
  (evidence.rematches||=[]).push({before:countsBefore,after:await c.ev('H.counts()')});
  }
  evidence.checks.push('second finished match and fresh seeded matchup retain placement');
  evidence.checks.push('retreat, promotion, complete match, rematch retains table');
  // Use the production board factory for portrait-sized multi-angle inspection.
  const roster=await c.ev(`(async()=>{const b=__game.board,{scene,camera,renderer}=__debug;renderer.setAnimationLoop(null);const stage=new scene.constructor();stage.background=scene.background.clone().set('#548453');scene.children.filter(o=>o.isLight).forEach(o=>stage.add(o.clone()));const cam=camera.clone();cam.fov=32;cam.aspect=1.3;cam.updateProjectionMatrix();renderer.setSize(260,200,false);renderer.setPixelRatio(1);
  const sheet=document.createElement('canvas');sheet.width=1300;sheet.height=2640;const ctx=sheet.getContext('2d');const metrics={};
  for(const [index,id] of ['bulbasaur','charmander','squirtle','eevee','gastly','psyduck','sandshrew','magnemite','gloomwing','puffmire','voltpip','pebblit'].entries()){
    const a=await b.spawnCreature(0,{id,uid:'model'+index},{animate:false});const copy=await b.spawnCreature(1,{id,uid:'other'+index},{animate:false});stage.add(a);a.phase=0;a.update(0,.2);
    const name=({gloomwing:'zubat',puffmire:'koffing',voltpip:'pikachu',pebblit:'geodude'}[id]||id);
    const portrait=new Image();portrait.src='/pokemon/'+name+'.png';await portrait.decode();
    ctx.fillStyle='#dce8d3';ctx.fillRect(0,index*220,260,220);ctx.drawImage(portrait,30,index*220+20,200,200);
    ctx.fillStyle='#15283a';ctx.font='14px system-ui';ctx.fillText(name+' artwork',10,index*220+15);
    if(${JSON.stringify(Object.keys(LEGACY_RIGS))}.includes(id)&&!a.rig)throw Error('Procedural fallback for legacy id: '+id);
    if(a.rig){
    let mesh;
    a.traverse(o=>{if(o.isSkinnedMesh)mesh=o;});
    const vertex=new mesh.position.constructor();
    function positions(){
      a.updateMatrixWorld(true);
      const xyz=[];
      for(let i=0;i<mesh.geometry.attributes.position.count;i++){
        mesh.getVertexPosition(i,vertex);xyz.push(vertex.x,vertex.y,vertex.z);
      }
      return xyz;
    }
    const initial=positions();a.update(0,.67);
    if(!positions().some((v,i)=>Math.abs(v-initial[i])>.0001))throw Error('Static idle: '+id);
    a.update(0,.2);
    if(copy.rig.rig===a.rig.rig || copy.mats[0]===a.mats[0])throw Error('Shared instance state');
    const peerBone=copy.rig.nodes.values().next().value,old=peerBone.rotation.x,oldColor=copy.mats[0].emissive.getHex();
    a.rig.nodes.values().next().value.rotation.x+=.2;a.flash(.6);
    if(peerBone.rotation.x!==old || copy.mats[0].emissive.getHex()!==oldColor)throw Error('Shared pose or flash');
    a.rig.nodes.values().next().value.rotation.x-=.2;a.flash(0);
    }
    for(const [j,angle] of [0,.64,Math.PI/2,Math.PI].entries()){
      const distance=id==='gloomwing'?.27:id==='voltpip'?.19:.17;const y=id==='gloomwing'?.067:a.hover?.052:.036;cam.position.set(distance*Math.sin(angle),y+.028,distance*Math.cos(angle));cam.lookAt(0,y,0);renderer.render(stage,cam);
      const x=(j+1)*260,row=index*220;ctx.drawImage(renderer.domElement,x,row+20,260,200);ctx.fillStyle='#15283a';ctx.fillRect(x,row,260,20);ctx.fillStyle='#fff';ctx.font='14px system-ui';ctx.fillText(name+' / '+['front','three-quarter','side','rear'][j],x+10,row+15);
    }
    const skin=a.mats.find(m=>m.map)?.map.image;metrics[id]={calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,texture:skin?[skin.width,skin.height]:null,rgbaBytes:skin?skin.width*skin.height*4:0};
  }
  return {image:sheet.toDataURL('image/jpeg',.89),metrics};})()`);
  await writeFile(directory+'/roster.jpg',Buffer.from(roster.image.split(',')[1],'base64'));evidence.models=roster.metrics;
  // Register using virtual hand cards, cancel a private deck search, then commit it.
  await c.nav('/?mode=quick&preview&team=bloom&away=coil&seed=1024');await c.ready();
  const search=await c.ev(`(async()=>{const g=__game,b=g.board;await H.tap(g.btnVirtual);
    for(const item of [...g.reg.items]){
      const hand=b.handCards.find(c=>c.visible && c.userData.uid==='reg-'+item.card.uid);
      await H.tap(hand);await H.tap(b.slotFor(item.where));
    }
    await H.step(2);const me=()=>g.st().players[0],ball=me().hand.find(c=>c.id==='pokeBall');
    g.tapHand(ball.uid);g.onActionButton({action:{type:'cancel'}});
    const kept=me().hand.some(c=>c.uid===ball.uid);g.tapHand(ball.uid);
    const before=me().deckCount;g.onActionButton(b.actionButtons[0].userData.spec);await H.step(2);
    return {phase:g.phase,kept,before,after:me().deckCount,spent:me().potionsUsed};
  })()`);
  assert.equal(search.phase,'battle');assert.ok(search.kept);assert.equal(search.before-1,search.after);assert.equal(search.spent,1);
  evidence.checks.push('expanded virtual registration, canceled and confirmed Poké Ball search');
  // Run the other presets and repeat the original reference match via pointer input.
  for(const team of ['rush','tide','coil','demo']){
    await c.nav('/?mode=quick&preview'+(team==='demo'?'':'&team='+team+'&seed=3'));await c.battle();
    if(team==='rush'){
      const switched=await c.ev(`(async()=>{const g=__game,p=g.st().players[0],card=p.hand.find(c=>c.id==='switch');
        g.tapHand(card.uid);g.tapSlot({where:'active'});const kept=g.st().players[0].hand.some(c=>c.uid===card.uid);
        g.tapSlot({where:'bench',index:0});await H.step(2);return [kept,g.st().players[0].active.id,g.st().current];})()`);
      assert.deepEqual(switched,[true,'eevee',0]);evidence.checks.push('invalid and valid Switch through target picker');
    }
    await c.ev('H.tap(__game.board.actionButtons[0])');for(let i=0;i<10;i++){await c.ev('H.step(1.5)');await sleep(30)}
    if(team==='demo'){const s=await c.ev('H.snapshot()');assert.deepEqual(s.bars,['20/40','40/60']);}
  }
  evidence.checks.push('all four presets, eight models, individual poses/materials, original 20/40 versus 40/60');
  const room='V'+Date.now().toString(36).slice(-5).toUpperCase();guest=await client();
  await c.nav('/?mode=host&team=coil&away=tide&preview&room='+room);
  await guest.nav('/?mode=guest&preview&room='+room);await c.battle();await guest.battle();
  await c.ev(`(async()=>{const g=__game,p=g.st().players[0];g.tapHand(p.hand.find(x=>x.id==='xAttack').uid);g.tapSlot({where:'active'});await H.step(1)})()`);
  await guest.until('__game.st().players[0].active.charged===true');
  await c.ev('(async()=>{await H.step(2);await H.tap(__game.board.actionButtons[0]);})()');await guest.until('__game.st().players[1].active.hp===30');
  await guest.nav('/?mode=guest&preview&room='+room);await guest.ready();
  assert.ok(await guest.ev('__game.st().players[0].hand.length===0 && __game.st().players[1].active.hp===30 && __game.stats.impacts.length===0'));
  evidence.checks.push('expanded host/guest targeted trainer, confirmed damage, reconnect privacy and snapshot');
  assert.deepEqual(evidence.external,[]);assert.deepEqual(evidence.errors,[]);
  const rigged=Object.entries(evidence.models).filter(([,m])=>m.texture).map(([id])=>id);
  for(const id of ['bulbasaur','charmander','squirtle','eevee','gastly','psyduck','sandshrew','magnemite',...Object.keys(LEGACY_RIGS)])assert.ok(rigged.includes(id),'Missing skinned rig: '+id);
  evidence.checks.push('all twelve species in four views beside local artwork, original eight plus gloomwing/voltpip as independent animated skins');
  await writeFile(directory+'/verification.json',JSON.stringify({...evidence,assets:[...evidence.assets]},null,2));
  console.log(evidence.checks,evidence.models);
  }
}finally{
  await guest?.close();await c.close();await server.close();
}

