import { Vector3 } from 'three';

// Camera cues have no effect on ordinary games or tracked headset poses.
if (new URLSearchParams(location.search).has('demo') &&
    new URLSearchParams(location.search).get('camera') !== 'manual') {
  const eye = new Vector3(), aim = new Vector3(), fromEye = new Vector3(), fromAim = new Vector3();
  let shot = null, activeScene;
  function frame() {
    const debug = window.__debug, game = window.__game;
    if (!shot || !debug || game !== shot.game || debug.renderer.xr.isPresenting) return;
    const raw = Math.min(1, Math.max(0,(game.now-shot.start)/shot.duration));
    const blend = raw*raw*(3-2*raw);
    debug.controls.target.lerpVectors(fromAim, aim, blend);
    debug.camera.position.lerpVectors(fromEye, eye, blend);
    debug.camera.lookAt(debug.controls.target);
    debug.camera.updateMatrixWorld();
    if(raw===1)shot=null;
  }
  addEventListener('tabletop-demo-cue', ({detail}) => {
    const debug=window.__debug, game=window.__game;
    if (!debug || !game?.board || debug.renderer.xr.isPresenting) return;
    if(detail.cue==='done'||detail.cue==='failed'){shot=null;debug.setSeatView(game.seat);return;}
    const board=game.board, seat=detail.targetSeat===1?1:0;
    const near=board.anchor[0].getWorldPosition(new Vector3());
    const far=board.anchor[1].getWorldPosition(new Vector3());
    const middle=near.clone().lerp(far,.5);
    const target=board.anchor[seat].getWorldPosition(new Vector3());
    target.y+=.035;
    const portrait=debug.camera.aspect<1;
    const cue=String(detail.cue);
    if (/inspect|register|establish|wide|title|result|start|win/i.test(cue)) {
      aim.copy(middle); aim.z+=.075;
      eye.copy(aim).add(new Vector3(.065,portrait?.59:.41,portrait?.53:.45));
    } else {
      aim.copy(middle).lerp(target,.28); aim.y+=.019;
      // Cross the field at a shallow angle to separate the two silhouettes.
      eye.copy(aim).add(new Vector3(portrait?.32:.24,.145,portrait?.25:.18));
    }
    fromEye.copy(debug.camera.position); fromAim.copy(debug.controls.target);
    shot={game,start:game.now,duration:.55};
    if(activeScene!==debug.scene){
      activeScene=debug.scene;
      const previous=activeScene.onBeforeRender;
      activeScene.onBeforeRender=function(...args){previous.apply(this,args);frame();};
    }
  });
}
