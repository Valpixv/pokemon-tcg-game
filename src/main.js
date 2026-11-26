import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Interactables, Pointers, attachMouse } from './input/pointer.js';
import { initCardArt } from './view/cards.js';
import { initAudio, resumeAudio, settings as audioSettings, setVoice, setCrowd } from './view/audio.js';
import { tick } from './view/util.js';
import { makeRoom, TABLE_Y, seatEye } from './view/room.js';
import { arSupported, startAR, XRInput, XRSurface, TableAnchor } from './xr/xr.js';
import { setupLibrary } from './view/library.js';
import { QUICK_BATTLE, teamMatch } from './rules/data.js';
import { Game } from './game/app.js';
import { DEMOS, demoSetup } from './demo/demos.js';

// ------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.setClearColor(0x000000, 0);
// Neutral tone mapping keeps card and type colours true below ~0.8 and only
// rolls off highlights (impact flashes, white rims) instead of clipping them.
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
// Desktop-only contact shadows from the key light; switched off in the headset.
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 30);
scene.add(camera);
scene.add(new THREE.HemisphereLight('#ffffff', '#6b5a48', 1.25));
const sun = new THREE.DirectionalLight('#fff6ea', 1.7); sun.position.set(0.6, 2.5, 1.2); scene.add(sun);
sun.target.position.set(0, TABLE_Y, 0); scene.add(sun.target);
{ // shadow frustum hugs the table so a 1024 map stays sharp
  const sc = sun.shadow.camera; sc.left = sc.bottom = -0.36; sc.right = sc.top = 0.36; sc.near = 1.4; sc.far = 3.2;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.0015; sun.shadow.radius = 3;
}
const setShadows = (on) => { renderer.shadowMap.enabled = on; sun.castShadow = on; };
setShadows(true);
// Soft image-based light so standard materials pick up gentle reflections.
{ const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.35; pmrem.dispose(); }

const room = makeRoom(); scene.add(room);
room.traverse((o) => { if (o.isMesh && o.userData.receiveShadow !== false) o.receiveShadow = true; });
const previewBg = new THREE.Color('#d8d2c8');
scene.background = previewBg;

const interactables = new Interactables();
const pointers = new Pointers(interactables);
const mouse = attachMouse(pointers, renderer.domElement, camera);

const controls = new OrbitControls(camera, renderer.domElement);
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.enablePan = false; controls.minDistance = 0.25; controls.maxDistance = 1.6;
controls.target.set(0, TABLE_Y, 0.05);
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

function setSeatView(seat) {
  const eye = seatEye(seat);
  camera.position.copy(eye);
  controls.target.set(0, TABLE_Y, seat === 0 ? 0.16 : -0.16);
  room.userData.mannequin.visible = seat === 0; // the preview camera sits in the far chair
  controls.update();
}
setSeatView(0);

const artReady = initCardArt();
initAudio(camera);

function fitRenderer() {
  if (renderer.xr.isPresenting) return;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', fitRenderer);
matchMedia('(resolution: 1dppx)').addEventListener?.('change', fitRenderer);

// --------------------------------------------------------------- state
let game = null;
let xrInput = null, xrSurface = null, anchor = null;
const camWorld = new THREE.Vector3();
const hintsKey = 'tcb-hints';
const loadHints = () => { try { return localStorage.getItem(hintsKey) !== 'off'; } catch { return true; } };
const saveHints = (on) => { try { localStorage.setItem(hintsKey, on ? 'on' : 'off'); } catch { /* ignore */ } };

const $ = (id) => document.getElementById(id);
$('skipHints').checked = !loadHints();
$('skipHints').addEventListener('change', (e) => saveHints(!e.target.checked));
// Optional sound layers; both stay off until the player turns them on.
$('voiceOn').checked = audioSettings.voice;
$('voiceOn').addEventListener('change', (e) => setVoice(e.target.checked));
$('crowdOn').checked = audioSettings.crowd;
$('crowdOn').addEventListener('change', (e) => { resumeAudio(); setCrowd(e.target.checked); });

function cameraWorld() {
  if (renderer.xr.isPresenting) renderer.xr.getCamera().getWorldPosition(camWorld);
  else camera.getWorldPosition(camWorld);
  return camWorld;
}

const desktopSurface = (origin, dir) => {
  if (Math.abs(dir.y) < 1e-4) return null;
  const t = (TABLE_Y - origin.y) / dir.y; if (t <= 0) return null;
  const p = origin.clone().addScaledVector(dir, t);
  return Math.hypot(p.x, p.z) < 0.55 ? p : null;
};

async function start(mode, roomCode = '', setup=QUICK_BATTLE, demo = null) {
  resumeAudio();
  $('status').textContent = '';
  const forcePreview = new URLSearchParams(location.search).has('preview');
  let isXR = false;
  if (!demo && !forcePreview && await arSupported()) {
    try {
      await startAR(renderer, null);
      isXR = true;
    } catch (err) {
      $('status').textContent = `Could not start passthrough (${err.message}). Opening the browser preview.`;
    }
  }
  await artReady;
  $('menu').style.display = 'none';
  setShadows(!isXR);
  if (isXR) {
    scene.background = null; room.visible = false;
    if (!xrInput) { xrInput = new XRInput(renderer, scene, pointers); xrSurface = new XRSurface(renderer, xrInput); anchor = new TableAnchor(renderer); }
    renderer.xr.getSession().addEventListener('end', () => backToMenu(false));
  } else {
    scene.background = previewBg; room.visible = true;
    $('hud').style.display = 'block';
    setSeatView(mode === 'guest' ? 1 : 0);
  }
  const ctx = {
    renderer, scene, camera, interactables, pointers, isXR, tableY: TABLE_Y,
    surface: isXR ? (o, d) => xrSurface.raycast(o, d) : desktopSurface,
    head: () => cameraWorld().clone(),
    cameraWorld, anchor: isXR ? anchor : null,
    saveHints, exitToMenu: () => backToMenu(true),
    // Desktop-only demo cue, announced just before each scripted request.
    demoCue: isXR ? null : (cue, targetSeat) => dispatchEvent(new CustomEvent('tabletop-demo-cue', { detail: { cue, targetSeat } })),
  };
  game = new Game(ctx, { mode, room: roomCode, hints: loadHints(), setup, demo });
  game.board.root.traverse((o) => { if (o.isMesh) o.receiveShadow = true; }); // arena turf and table props catch figure shadows
  window.__game = game; // handy for debugging in the console
  window.__debug = { camera, scene, renderer, interactables, pointers, setSeatView, controls };
}

function backToMenu(endSession) {
  if (game) { game.dispose(); game = null; }
  if (endSession && renderer.xr.isPresenting) renderer.xr.getSession().end();
  scene.background = previewBg; room.visible = true;
  $('menu').style.display = 'grid'; $('hud').style.display = 'none';
  setSeatView(0);
}

const randomCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
$('btnQuick').onclick = () => start('quick');
$('btnShared').onclick = () => { $('shared').style.display = 'block'; };
$('btnHost').onclick = () => { const code = randomCode(); $('code').value = code; start('host', code, $('hostTeam').value?teamMatch(crypto.getRandomValues(new Uint32Array(1))[0],$('hostTeam').value):QUICK_BATTLE); };
$('btnJoin').onclick = () => { const code = $('code').value.trim().toUpperCase(); if (code.length < 3) { $('status').textContent = 'Enter the room code shown on the host headset.'; return; } start('guest', code); };
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoin').click(); });
$('seat0').onclick = () => setSeatView(0);
$('seat1').onclick = () => setSeatView(1);
$('toMenu').onclick = () => backToMenu(true);
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === '1') setSeatView(0);
  if (e.key === '2') setSeatView(1);
});

setupLibrary(artReady,(team,seed)=>start('quick','',teamMatch(seed??crypto.getRandomValues(new Uint32Array(1))[0],team)));

// URL shortcuts for testing: ?mode=quick | ?mode=host&room=ABCD | ?mode=guest&room=ABCD
{
  const q = new URLSearchParams(location.search);
  const m = q.get('mode');
  // ?demo=opening-exchange | ?demo=team-showcase[&seed=19&team=coil&away=rush]
  const demo = q.get('demo');
  if (DEMOS[demo]) start('quick', '', demoSetup(demo, { seed: q.has('seed') ? Number(q.get('seed')) : undefined, team: q.get('team'), away: q.get('away') }), demo);
  else if (m === 'quick' || m === 'host' || m === 'guest') start(m,(q.get('room')||'').toUpperCase(),q.has('team')?teamMatch(Number(q.get('seed')||1),q.get('team'),q.get('away')):QUICK_BATTLE);
}

// ------------------------------------------------------------------ loop
let last = performance.now();
// Desktop-only camera shake on heavy hits (never applied while presenting XR).
let shake = 0, shakeT = 0; const shakeOffset = new THREE.Vector3();
addEventListener('tabletop-shake', (e) => { shake = Math.max(shake, e.detail || 0.003); });
function step(dt, frame) {
  tick(dt);
  mouse.refresh(); if (renderer.xr.isPresenting) mouse.valid = false;
  if (xrInput && renderer.xr.isPresenting) { xrSurface.setFrame(frame); xrInput.update(dt); }
  pointers.update(dt);
  game?.update(dt, frame);
}
renderer.setAnimationLoop((t, frame) => {
  const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!renderer.xr.isPresenting && (renderer.getPixelRatio() !== Math.min(devicePixelRatio, 2) || renderer.domElement.clientWidth !== innerWidth || renderer.domElement.clientHeight !== innerHeight)) fitRenderer();
  if (!window.__paused) step(dt, frame); // __paused: test hook that freezes the simulation for captures
  if (!renderer.xr.isPresenting) controls.update();
  const shaking = shake > 1e-5 && !renderer.xr.isPresenting;
  if (shaking) { // deterministic, no Math.random (captures seed it for AI choices)
    shakeT += dt; shakeOffset.set(Math.sin(shakeT * 91) * shake, Math.sin(shakeT * 73 + 1) * shake, Math.sin(shakeT * 67 + 2) * shake * 0.5);
    camera.position.add(shakeOffset); shake *= Math.exp(-dt * 14);
  }
  renderer.render(scene, camera);
  if (shaking) camera.position.sub(shakeOffset);
});
// Test hook: advance the simulation deterministically (e.g. when the tab is
// throttled in the background). Not used by the game itself.
window.__step = async (seconds, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) { step(dt, null); for (let k = 0; k < 8; k++) await null; } // let promise chains run
  renderer.render(scene, camera);
};
