async function captureShot({width,height,kind,duration,short}){
 const H=await import('/tools/harness.js');await H.ready();
 const g=window.__game,b=g.board,{renderer,camera,controls}=window.__debug;
 renderer.setAnimationLoop(null);
 const step=window.__step;
 const until=async(predicate)=>{for(let i=0;i<400;i++){if(predicate())return;await step(.1);await new Promise(r=>setTimeout(r,5));}throw Error('Game state timed out: '+kind);};
 if(g.demo){await until(()=>g.phase==='battle'&&b.creatures.every(Boolean)&&g.canAct());}
 else if(kind!=='registration'){
   await H.register();await until(()=>g.phase==='battle'&&b.creatures.every(Boolean)&&g.canAct());
 }
 const ATTACK_SHOTS=['opening','exchange','showcase','garden','finish'];
 // fill=false goes straight to the attack button so attacks land early in short shots.
 function advance(fill){
   const s=g.st(),p=s.players[0];
   if(!g.canAct())return;
   if(s.phase==='promote'&&s.pendingPromote===0)g.tapSlot({where:'bench',index:p.bench.findIndex(Boolean)});
   else if(s.phase==='play'&&s.current===0){
     const card=fill&&p.hand.find(c=>c.hp>0),slot=p.bench.findIndex(c=>!c);
     if(card&&slot>=0){g.tapHand(card.uid);g.tapSlot({where:'bench',index:slot});}
     else g.onActionButton(b.actionButtons[0].userData.spec);
   }
 }
 if(kind==='finish'){
  // Start at the last legal request in the knockout demo, with time to read both figures.
  await until(()=>g.demo.steps[g.demo.i]?.cue==='finisher' && g.canAct());
  g.demo.readyAt=g.now+1.45;
 }
 const initial=H.snapshot();
 const impactBase=g.stats.impacts.length; // evidence counts only this shot's impacts
 const root=b.root.getWorldPosition(camera.position.clone());
 const aim=camera.position.clone();
 function frameCamera(t){
   let x=.16,z=.44,y=.25,lookZ=.025,lookY=.025;
   const orbit=Math.sin(t*.32);
   if(kind==='registration'){x=.08+orbit*.025;z=.55;y=.49;lookZ=.17;}
   else if(kind==='inspection'){
     const pos=b.preview.getWorldPosition(camera.position.clone());
     x=.05;z=.49;y=.29;lookZ=.08;
     if(b.preview.visible){aim.copy(pos);aim.x+=short?0:.025;camera.position.set(aim.x+.015,aim.y+.115,aim.z+(short?.22:.25));camera.lookAt(aim);return;}
   }else if(kind==='opening'||kind==='exchange'||kind==='finish'){x=(short?.21:.25)+orbit*.025;y=.137;z=.16+orbit*.03;}
   else{x=.19+orbit*.07;y=.19;z=.26;}
   if(short&&kind==='registration'){z+=.08;y+=.06;}
   if(short&&['opening','exchange','finish','garden','showcase'].includes(kind)){
     x=.125+orbit*.018;z=.32;y=.20;lookZ=0;lookY=.042;
   }
   if(short&&kind==='opening'){
     // The imported bat spans both shoulders. Film across the table so the target
     // stays in view during the lunge, with room for both fully extended wingtips.
     // Pulled back on the same bearing and aimed 2 cm toward the near seat, so Zubat's
     // recoil, left wingtip and HP label stay inside the 9:16 frame.
     x=.40;z=.252+orbit*.012;y=.275;lookY=.044;lookZ=.02;
   }
   if(kind==='finish'&&g.st().phase==='over'){
     const reveal=Math.min(1,Math.max(0,(t-(overAt??t))/.85));
     z+=reveal*.16;y+=reveal*.10;lookY+=reveal*.055;
   }
   aim.set(root.x,root.y+lookY,root.z+lookZ);camera.position.set(root.x+x,root.y+y,root.z+z);
   camera.lookAt(aim);
 }
 camera.aspect=width/height;camera.fov=short?53:43;camera.updateProjectionMatrix();
 controls.enabled=false;
 renderer.setPixelRatio(1);renderer.setSize(width/2,height/2,false);
 const screen=document.createElement('canvas');screen.width=width;screen.height=height;const ctx=screen.getContext('2d');
 const packets=[];let fatal;
 function collect(track){return chunk=>{const bytes=new Uint8Array(chunk.byteLength);chunk.copyTo(bytes);let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));
 packets.push({track,t:Math.round(chunk.timestamp/1000),key:chunk.type==='key',data:btoa(s)});};}
 const fps=24,RATE=48000,MIX=.52;
 const samples=new Float32Array(duration*RATE);
 let filmT=0;
 // Faithful offline mix: every buffer source the game starts is placed on the film
 // timeline honouring start(when, offset, duration), playbackRate and all channels.
 const playSound=AudioBufferSourceNode.prototype.start;
 AudioBufferSourceNode.prototype.start=function(when=0,offset=0,dur){
  const buf=this.buffer;
  if(buf){
   const rate=(this.playbackRate?.value||1)*buf.sampleRate/RATE;
   const delay=when>0?Math.max(0,when-this.context.currentTime):0;
   const at=Math.round((filmT+delay)*RATE);
   const first=offset*buf.sampleRate,last=Math.min(buf.length,dur!=null?first+dur*buf.sampleRate:buf.length);
   const chans=[];for(let c=0;c<buf.numberOfChannels;c++)chans.push(buf.getChannelData(c));
   for(let i=0;at+i<samples.length;i++){
    const pos=first+i*rate;if(pos>=last-1)break;
    const k=Math.floor(pos),f=pos-k;let v=0;
    for(const ch of chans)v+=ch[k]+(ch[k+1]-ch[k])*f;
    samples[at+i]+=v/chans.length*MIX;
   }
  }
  return playSound.apply(this,arguments);
 };
 const titles={opening:'Zubat vs Pikachu',registration:'Register your cards',inspection:'Inspect the reserve',exchange:'Bite and Pika Punch',showcase:'Flame Dash vs Shell Guard',garden:'Hex follows the retreating card',finish:'The deciding turn'};
 const impactTimes=[];let overAt=null,didInspect=false;
 // Last moment a new action may be issued, so its animation and audio resolve on screen.
 const actionCutoff=kind==='finish'?duration-2.5:duration-3;
 try{
  const video=new VideoEncoder({output:collect(1),error:e=>fatal=e});
  video.configure({codec:'vp8',width,height,bitrate:3800000,framerate:fps,latencyMode:'realtime'});
  await document.fonts.ready;
  for(let n=0;n<fps*duration;n++){
    filmT=n/fps;
    if(kind==='registration'&&n===fps*2)g.tapSlot({where:'active'});
    if(kind==='registration'&&n===fps*5)g.tapSlot({where:'bench',index:0});
    if(kind==='inspection'&&n===fps){await H.press(b.benchSlots[0]);}
    if(kind==='inspection'&&n===fps*2){H.release();didInspect=g.previewOpen;}
    if(kind==='inspection'&&n===fps*(duration-1)&&g.previewOpen)g.closePreview();
    if(!g.demo&&ATTACK_SHOTS.includes(kind)&&n>=fps&&n%6===0&&filmT<=actionCutoff&&g.st().phase!=='over'){
      const shotImpacts=g.stats.impacts.length-impactBase;
      // finish plays to the end; garden may bench a card; others attack once each side.
      const want=kind==='finish'||shotImpacts<2;
      if(want)advance(kind==='garden');
    }
    await step(1/fps,1/fps);
    while(impactTimes.length<g.stats.impacts.length-impactBase)impactTimes.push(+filmT.toFixed(3));
    if(overAt==null&&g.st().phase==='over')overAt=+filmT.toFixed(3);
    frameCamera(filmT);renderer.render(window.__debug.scene,camera);
    ctx.drawImage(renderer.domElement,0,0,width,height);
    const grad=ctx.createLinearGradient(0,height*.78,0,height);grad.addColorStop(0,'transparent');grad.addColorStop(1,'rgba(6,17,22,.9)');ctx.fillStyle=grad;ctx.fillRect(0,height*.78,width,height*.22);
    const margin=Math.round(width*.048);
    ctx.fillStyle='#a9e9c7';ctx.font='600 '+(short?26:22)+'px Segoe UI';ctx.fillText('POKÉMON TABLETOP BATTLE   /   DESKTOP PREVIEW',margin,height*.905);
    ctx.fillStyle='#fff';ctx.font='700 '+(short?49:53)+'px Segoe UI';const endTitle = kind==='finish' && overAt!=null && filmT>overAt+.6;
   const result = endTitle ? g.st() : null;
   const caption = result ? (result.winner===0?'Near seat wins':'Far seat wins')+'  ·  '+result.players.map(p=>p.score).join(' – ') : titles[kind];
   ctx.fillText(caption,margin,height*.959);
    const vf=new VideoFrame(screen,{timestamp:Math.round(n*1e6/fps),duration:Math.round(1e6/fps)});video.encode(vf,{keyFrame:n%(fps*2)===0});vf.close();
    if(video.encodeQueueSize>5)await video.flush();if(fatal)throw fatal;
  }
  await video.flush();video.close();
 }finally{AudioBufferSourceNode.prototype.start=playSound;}
 let peak=0;for(let i=0;i<samples.length;i++){const v=samples[i];if(v>1)samples[i]=1;else if(v<-1)samples[i]=-1;peak=Math.max(peak,Math.abs(v));}
 // Audible check per impact: RMS over [t-0.15s, t+0.8s].
 const rms=(a,z)=>{a=Math.max(0,Math.round(a*RATE));z=Math.min(samples.length,Math.round(z*RATE));let s=0;for(let i=a;i<z;i++)s+=samples[i]*samples[i];return z>a?Math.sqrt(s/(z-a)):0;};
 const impactRms=impactTimes.map(t=>+rms(t-.15,t+.8).toFixed(5));
 const audio=new AudioEncoder({output:collect(2),error:e=>fatal=e});
 audio.configure({codec:'opus',sampleRate:RATE,numberOfChannels:1,bitrate:64000});
 for(let i=0;i<samples.length;i+=960){const af=new AudioData({format:'f32',numberOfFrames:960,numberOfChannels:1,sampleRate:RATE,timestamp:Math.round(i/RATE*1e6),data:samples.subarray(i,i+960)});audio.encode(af);af.close();if(audio.encodeQueueSize>20)await audio.flush();}
 await audio.flush();audio.close();if(fatal)throw fatal;
 return {packets,evidence:{initial,final:H.snapshot(),inspected:didInspect,
  impacts:g.stats.impacts.slice(impactBase).map(x=>x.move),impactTimes,impactRms,overAt,
  audioActive:peak>0,audioPeak:+peak.toFixed(4),clipped:peak>1}};
}
