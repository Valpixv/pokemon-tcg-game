import * as THREE from 'three';
import { CARDS, MOVES, TYPE_COLORS } from '../rules/data.js';
import { roundRect } from './util.js';

export const CARD_W = 0.063, CARD_H = 0.088;
const PX_W = 320, PX_H = Math.round(PX_W * CARD_H / CARD_W);
const PRINT_SCALE = 2;
const art = new Map();
const faceCache = new Map();
let backTex = null;

// Decode the bundled illustrations before constructing any cached face textures.
export async function initCardArt() {
  await Promise.all(Object.entries(CARDS).map(async ([id, card]) => {
    const image = new Image();
    const loaded = new Promise((resolve) => { image.onload = resolve; image.onerror = resolve; });
    image.src = `${import.meta.env.BASE_URL}pokemon/${card.art}.png`;
    // decode() can stay pending while the tab is in the background; the load
    // event still fires, so whichever comes first lets the game start.
    await Promise.race([image.decode().catch(() => {}), loaded]);
    art.set(id, image);
  }));
}

function wrap(ctx, text, x, y, maxW, lh) {
  const words = text.split(' '); let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, x, y); line = w; y += lh; } else line = t;
  }
  if (line) ctx.fillText(line, x, y);
}

export function cardFaceTexture(id) {
  if (faceCache.has(id)) return faceCache.get(id);
  const def = CARDS[id]; const col = TYPE_COLORS[def.type];
  const c = document.createElement('canvas'); c.width = PX_W * PRINT_SCALE; c.height = PX_H * PRINT_SCALE;
  const g = c.getContext('2d'); g.scale(PRINT_SCALE, PRINT_SCALE);
  g.fillStyle = '#e6b643'; roundRect(g, 0, 0, PX_W, PX_H, 18); g.fill();
  const paper = g.createLinearGradient(0,0,PX_W,PX_H);
  paper.addColorStop(0,'#fff8dd'); paper.addColorStop(.52,'#fff6de'); paper.addColorStop(1,'#fff4dc');
  g.fillStyle = paper; roundRect(g,9,9,PX_W-18,PX_H-18,11); g.fill();
  g.fillStyle = '#302a36'; g.font = 'bold 12px system-ui';
  g.fillText(def.dex ? 'BASIC' : 'TRAINER  /  ITEM',22,29);
  g.font = 'bold 29px system-ui'; g.fillText(def.name,21,59);
  if (def.hp) {
    g.fillStyle = '#28343a'; roundRect(g,220,34,78,29,8); g.fill();
    g.fillStyle = '#fff8dc'; g.textAlign = 'center'; g.font = 'bold 20px system-ui';
    g.fillText(`HP ${def.hp}`,259,55); g.textAlign = 'left';
  }
  const sky = g.createRadialGradient(145,130,6,145,160,172);
  sky.addColorStop(0,'#fffae7'); sky.addColorStop(.62,col.border); sky.addColorStop(1,col.fill);
  g.fillStyle = sky; g.fillRect(20,71,280,191);
  const image = art.get(id);
  g.imageSmoothingEnabled = def.kind !== 'trainer';
  const scale = Math.min(268 / image.naturalWidth, 183 / image.naturalHeight);
  const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
  g.drawImage(image, (PX_W - w) / 2, 166.5 - h / 2, w, h);
  g.imageSmoothingEnabled = true;
  g.strokeStyle = '#594858'; g.lineWidth = 3; g.strokeRect(20,71,280,191);
  g.fillStyle = '#302a36'; g.font = 'bold 12px system-ui';
  g.fillText(def.dex ? `NO. ${def.dex}    •    BASIC POKÉMON` : 'ITEM CARD',22,281);
  const moves=def.moves || [];
  if(moves.length<2){
    g.font='15px system-ui';
    wrap(g,def.blurb||def.text,22,305,276,19);
  }
  let y=moves.length===2?310:365;
  for(const mid of moves){
    const move=MOVES[mid];
    g.fillStyle='#302a36';g.fillRect(22,y-16,276,1);
    g.font='bold 20px system-ui';g.fillText(move.name,23,y+5);
    g.textAlign='right';g.fillText(move.kind==='damage'?move.damage:`+${move.bonus}`,297,y+5);g.textAlign='left';
    g.font='13px system-ui';wrap(g,move.text,23,y+24,274,15);
    y+=72;
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  t.userData.shared = true; // owned by this module, reused by every board and rematch
  faceCache.set(id, t);
  return t;
}

export function cardBackTexture() {
  if (backTex) return backTex;
  const c = document.createElement('canvas'); c.width = PX_W; c.height = PX_H; const g = c.getContext('2d');
  g.fillStyle = '#1b3f9e'; roundRect(g, 0, 0, PX_W, PX_H, 18); g.fill();
  const grd = g.createRadialGradient(PX_W / 2, PX_H / 2, 10, PX_W / 2, PX_H / 2, PX_H * 0.6);
  grd.addColorStop(0, '#3b7bff'); grd.addColorStop(1, '#13307a');
  g.fillStyle = grd; roundRect(g, 14, 14, PX_W - 28, PX_H - 28, 10); g.fill();
  g.translate(PX_W/2,PX_H/2);
  g.strokeStyle = 'rgba(195,229,255,.45)'; g.lineWidth = 3;
  for (const r of [78,98,120]) { g.beginPath(); g.ellipse(0,0,r,r*.77,-.55,0,Math.PI*2); g.stroke(); }
  // Upright seam and central release button when viewed from the reverse.
  for (const [color,start] of [['#ed4048',Math.PI],['#fff8e8',0]]) {
    g.fillStyle = color; g.beginPath(); g.arc(0,0,62,start,start+Math.PI); g.closePath(); g.fill();
  }
  g.fillStyle = '#19253d'; g.fillRect(-62,-5,124,10);
  for (const [radius,color] of [[17,'#19253d'],[11,'#fff8e8']]) {
    g.fillStyle = color; g.beginPath(); g.arc(0,0,radius,0,Math.PI*2); g.fill();
  }
  backTex = new THREE.CanvasTexture(c); backTex.colorSpace = THREE.SRGBColorSpace; backTex.anisotropy = 4;
  backTex.userData.shared = true;
  return backTex;
}

const cardGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
// Double-sided card: face on +Z, blue back on -Z.
export function makeCardMesh(id, { scale = 1 } = {}) {
  const g = new THREE.Group();
  const front = new THREE.Mesh(cardGeo, new THREE.MeshBasicMaterial({ map: id ? cardFaceTexture(id) : cardBackTexture(), alphaTest: 0.45, toneMapped: false }));
  const back = new THREE.Mesh(cardGeo, new THREE.MeshBasicMaterial({ map: cardBackTexture(), alphaTest: 0.45, toneMapped: false }));
  back.rotation.y = Math.PI;
  g.add(front, back);
  g.scale.setScalar(scale);
  g.userData.front = front;
  g.setCard = (nid) => { front.material.map = nid ? cardFaceTexture(nid) : cardBackTexture(); front.material.needsUpdate = true; g.userData.id = nid; };
  g.userData.id = id;
  return g;
}
