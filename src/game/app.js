// Game controller: placement -> card registration -> battle.
// Turns player input into action requests, and confirmed battle events into
// presentation. Visuals never change HP on their own: the HP shown always
// comes from a confirmed event or the confirmed state.
import * as THREE from 'three';
import { CARDS, MOVES, QUICK_BATTLE } from '../rules/data.js';
import { createMatch, validate, unavailableReason, isCreature, findInPlay } from '../rules/engine.js';
import { chooseAction } from '../rules/ai.js';
import { createLocalSession, createHostSession, createGuestSession } from '../net/match.js';
import { WsLink } from '../net/wslink.js';
import { Board, Button3D, LAYOUT } from '../view/board.js';
import { wait, tween, hitStop } from '../view/util.js';
import { play, announce, cryName } from '../view/audio.js';
import { Placement } from './placement.js';
import { DemoPlayer } from '../demo/demos.js';

const NAME = (id) => CARDS[id]?.name || '?';
// How each move's single impact looks and sounds (keyed by the move's effect).
const IMPACT_LOOK = {
  vine:{sound:'vine',tint:'#7ebe66',light:'#b5ec80'},drain:{sound:'heal',tint:'#7fe6ac',light:'#99ffbb'},
  water:{sound:'water',tint:'#67dbff',light:'#a2eeff'},ember:{sound:'ember',tint:'#ff9549',light:'#ffbc73'},
  psychic:{sound:'charge',tint:'#ed84ff',light:'#ffb8fa'},ghost:{sound:'hex',tint:'#9174df',light:'#ca9bf7'},
  contact:{sound:'rock',tint:'#ffdeba',light:'#ffe8c7'},
  fang:     { effect: 'fang',     sound: 'fang',     tint: '#b04dff', light: '#c27bff' },
  electric: { effect: 'electric', sound: 'electric', tint: '#ffe14a', light: '#fff1a0' },
  spores:   { effect: null,       sound: 'fang',     tint: '#a08cc0', light: '#b7d39a' },
  rock:     { effect: null,       sound: 'rock',     tint: '#d8c3a0', light: '#ffe2b0' },
};
const UP = (s) => s.toUpperCase();

export class Game {
  constructor(ctx, { mode, room = '', hints = true, setup = QUICK_BATTLE, demo = null }) {
    this.setup=setup;
    // Solo demo playback: desktop Quick Battle only; never in XR or shared rooms.
    this.demo = demo && mode === 'quick' && !ctx.isXR ? new DemoPlayer(demo, setup) : null;
    if (this.demo) hints = false;
    this.ctx = ctx; this.mode = mode; this.room = room;
    this.seat = mode === 'guest' ? 1 : 0;
    this.shared = mode !== 'quick';
    this.hints = hints && mode === 'quick';
    this.tutorial = this.hints ? 0 : 99;
    this.phase = 'init';
    this.queue = []; this.presenting = false; this.pendingReq = null;
    this.ui = { mode: 'idle', selectedHand: null };
    this.flashMsg = null; this.flashUntil = 0; this.now = 0;
    this.paused = this.shared; this.connText = this.shared ? 'Connecting…' : '';
    this.scriptedReplyDone = mode !== 'quick' || !!setup.teams || !!this.demo;
    this.reg = null;
    this.previewOpen = false;
    this.stats = { impacts: [] }; // presentation log, read by the browser test harness
    this.cardMode = ctx.isXR ? 'physical' : 'virtual';

    this.board = new Board({ interactables: ctx.interactables, localSeat: this.seat, cardMode: this.cardMode, handlers: this.handlers() });
    this.board.root.visible = false;
    this.board.hpBars.forEach((h) => { h.visible = false; });
    ctx.scene.add(this.board.root);
    this.board.btnHints.setText(this.hints ? 'HINTS ON' : 'HINTS OFF');
    this.board.btnHints.visible = mode === 'quick';
    this.buildRegistrationUI();
    this.connect();
    this.beginPlacement(true);
  }

  // ------------------------------------------------------------- session
  connect() {
    if (this.mode === 'quick') {
      this.session = createLocalSession(createMatch(this.setup));
      this.ai = this.session.ai; this.aiPending = false;
      this.ai.on('update', () => { this.aiPending = false; });
      this.ai.on('reject', () => { this.aiPending = false; });
    } else {
      const link = new WsLink(this.room, this.mode);
      this.link = link;
      if (this.mode === 'host') {
        const key = `tcb-host-${this.room}`;
        let saved = null; try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch { saved = null; }
        const state = saved?.state || createMatch(this.setup);
        this.session = createHostSession(state, link, { epoch: saved?.epoch, onChange: (s) => {
          try { localStorage.setItem(key, JSON.stringify({ state: s, epoch: this.session.authority.epoch })); } catch { /* ignore */ }
        } });
        try { localStorage.setItem(key, JSON.stringify({ state, epoch: this.session.authority.epoch })); } catch { /* ignore */ }
      } else {
        this.session = createGuestSession(link);
      }
      link.onStatus((s) => this.onLinkStatus(s));
    }
    this.client = this.session.client;
    this.client.on('update', (u) => { if (u.reqId && u.reqId === this.pendingReq) this.pendingReq = null; this.queue.push(u); });
    this.client.on('reject', (r) => { if (r.reqId === this.pendingReq) this.pendingReq = null; this.flash(r.error, true); });
  }

  onLinkStatus(s) {
    const host = this.mode === 'host';
    if (s === 'open' && !host) this.client.hello();
    if (s === 'peer-joined') { this.paused = false; this.connText = ''; if (!host) this.client.hello(); play('confirm', this.board.root); }
    if (s === 'waiting') { this.paused = true; this.connText = host ? `Waiting for your friend to join\nRoom ${this.room}` : `Waiting for the host\nRoom ${this.room}`; }
    if (s === 'peer-left') { this.paused = true; this.connText = 'Opponent disconnected\nPaused until they reconnect'; }
    if (s === 'disconnected') { this.paused = true; this.connText = 'Connection lost\nReconnecting…'; }
    this.refreshUI();
  }

  st() { return this.client.state; }

  // ------------------------------------------------------------ placement
  beginPlacement(first) {
    const { ctx } = this;
    if (!ctx.isXR) {
      // Browser preview: the arena sits at the centre of the virtual table.
      if (first) { this.applyPlacement({ pos: new THREE.Vector3(0, ctx.tableY, 0), yaw: 0, scale: 1 }); this.afterPlacement(); return; }
    }
    this.phaseBeforePlace = first ? null : this.phase;
    this.phase = 'place';
    this.closePreview();
    this.board.root.visible = false;
    const initial = first ? null : { pos: this.board.root.position.clone(), yaw: this.board.root.rotation.y, scale: this.board.root.scale.x };
    const start = () => {
      this.placement = new Placement({
        scene: ctx.scene, interactables: ctx.interactables, pointers: ctx.pointers, surface: ctx.surface, head: ctx.head,
        twoPoint: this.shared, localSeat: this.seat, initial,
        onConfirm: (r) => { this.placement = null; this.applyPlacement(r, true); this.afterPlacement(); },
      });
    };
    if (first && ctx.isXR && ctx.anchor && !this.shared) {
      // Try to restore last session's table anchor; otherwise place manually.
      ctx.anchor.restore(ctx.renderer.xr.getSession()).then((r) => {
        if (r) { this.restoredScale = r.scale; this.phase = 'restoring'; this.restoreStarted = this.now; }
        else start();
      });
      this.startPlacement = start;
      return;
    }
    start();
  }

  applyPlacement({ pos, yaw, scale }, createAnchor = false) {
    const r = this.board.root;
    r.position.copy(pos); r.rotation.set(0, yaw, 0); r.scale.setScalar(scale);
    if (createAnchor && this.ctx.isXR && this.ctx.anchor) this.ctx.anchor.create(this.ctx.renderer.xr.getFrame(), pos, yaw, scale);
  }

  afterPlacement() {
    this.board.root.visible = true;
    play('confirm', this.board.root);
    if (this.phaseBeforePlace) {
      this.phase = this.phaseBeforePlace; this.phaseBeforePlace = null;
      this.syncAll(this.st(), false); this.refreshUI(); return;
    }
    this.phase = 'register';
    this.startRegistration();
  }

  // --------------------------------------------------------- registration
  buildRegistrationUI() {
    const b = new Button3D('USE VIRTUAL CARDS', { w: 0.1, h: 0.022, interactables: this.ctx.interactables, priority: 2,
      onSelect: () => this.useVirtualCards(), enabled: () => this.phase === 'register' && this.reg?.mode === 'physical' });
    b.rotation.x = -Math.PI / 2 + 0.75; b.position.set(LAYOUT.deck[0] + 0.005, 0.02, LAYOUT.activeZ - 0.075);
    this.board.ui.add(b); this.btnVirtual = b; b.visible = false;
  }

  startRegistration() {
    const st = this.st();
    if (!st) { this.waitingForState = true; this.refreshUI(); return; }
    this.waitingForState = false;
    const me = st.players[this.seat];
    const items = [];
    if (me.active) items.push({ where: { where: 'active' }, card: me.active, done: false });
    me.bench.forEach((c, i) => c && items.push({ where: { where: 'bench', index: i }, card: c, done: false }));
    this.reg = { mode: this.cardMode === 'virtual' && !this.ctx.isXR ? 'physical' : this.cardMode, items, selected: null };
    // In the browser preview the cards are always drawn as stand-ins.
    this.board.setCardMode('physical');
    this.btnVirtual.visible = true;
    this.refreshUI();
  }

  useVirtualCards() {
    this.reg.mode = 'virtual'; this.cardMode = 'virtual'; this.board.setCardMode('virtual');
    this.btnVirtual.visible = false;
    play('select', this.board.root);
    this.refreshUI();
  }

  regItem(where) { return this.reg?.items.find((it) => !it.done && it.where.where === where.where && it.where.index === where.index); }

  regTapSlot(where) {
    if (!this.reg) return; // still waiting for the first confirmed state
    const item = this.regItem(where);
    if (this.reg.mode === 'physical') {
      if (!item) return;
      item.done = true; play('confirm', this.board.root); this.board.slotFor(where).flash();
    } else {
      const sel = this.reg.items.find((it) => `reg-${it.card.uid}` === this.reg.selected);
      if (!sel) { this.flash('Pinch a card from your hand first', true); return; }
      if (!item || item.card.uid !== sel.card.uid) { this.flash(`${NAME(sel.card.id)} goes in ${sel.where.where === 'active' ? 'ACTIVE' : 'the left BENCH'}`, true); return; }
      item.done = true; this.reg.selected = null; play('confirm', this.board.root); this.board.slotFor(where).flash();
    }
    if (this.reg.items.every((it) => it.done)) this.enterBattle();
    else this.refreshUI();
  }

  async enterBattle() {
    this.phase = 'battle';
    const fx = this.board.effects;
    fx.viewQuat = (q) => { const c = this.ctx.renderer.xr.isPresenting ? this.ctx.renderer.xr.getCamera() : this.ctx.camera; c.getWorldQuaternion(q); };
    if(!fx.keepers)fx.prewarm(this.ctx.renderer, this.ctx.scene, this.ctx.camera);
    // upload the first-use canvases now rather than on the first attack frame
    const b = this.board; b.callout.set('READY'); b.toastLabel.set(' ');
    for (const t of [b.callout.tex, b.toastLabel.tex, b.banner.tex]) { try { this.ctx.renderer.initTexture(t); } catch { /* optional */ } }
    this.btnVirtual.visible = false;
    if (!this.ctx.isXR) this.board.setCardMode('virtual');
    else this.board.setCardMode(this.cardMode);
    this.refreshUI();
    await this.syncAll(this.st(), true);
    this.updateHint();
  }

  // ------------------------------------------------------------ handlers
  handlers() {
    return {
      canInspect: () => (this.phase === 'battle' || this.phase === 'register') && !this.previewOpen,
      inspect: (id, source) => this.openPreview(id, null, source),
      canInspectSlot: (where) => this.phase === 'battle' && !!this.cardAt(where) && !this.previewOpen,
      slotEnabled: (where) => this.slotEnabled(where),
      tapSlot: (where) => this.tapSlot(where),
      holdSlot: (where, slot) => { const c = this.cardAt(where); if (c && this.phase === 'battle') this.openPreview(c.id, where, slot?.card.visible ? slot.card : slot); },
      handEnabled: () => (this.phase === 'battle' && !this.previewOpen) || (this.phase === 'register' && this.reg?.mode === 'virtual'),
      tapHand: (uid) => this.tapHand(uid),
      action: (spec, btn) => { this.touch(btn); this.onActionButton(spec); },
      reposition: () => this.beginPlacement(false),
      canReposition: () => this.phase !== 'place' && !this.presenting,
      toggleHints: () => { this.hints = !this.hints; this.ctx.saveHints?.(this.hints); this.board.btnHints.setText(this.hints ? 'HINTS ON' : 'HINTS OFF'); this.updateHint(); },
      exit: () => this.ctx.exitToMenu(),
      newMatch: () => this.request({type:'newMatch'}),
      rematch: () => this.request({ type: 'rematch' }),
    };
  }

  cardAt(where) {
    const st = this.st(); if (!st) return null;
    const me = st.players[this.seat];
    return where.where === 'active' ? me.active : me.bench[where.index];
  }

  slotEnabled(where) {
    if (this.phase === 'register') return !!this.regItem(where);
    if (this.phase !== 'battle' || this.previewOpen) return false;
    if (this.cardAt(where)) return true;
    return where.where === 'bench' && this.benchOpen();
  }

  myTurnPlay() { const st = this.st(); return st && st.phase === 'play' && st.current === this.seat; }
  benchOpen() {
    const st = this.st(); if (!this.myTurnPlay()) return false;
    const me = st.players[this.seat];
    return me.hand.some(isCreature) && me.bench.some((c) => !c);
  }
  canAct() { return this.phase === 'battle' && !this.presenting && !this.queue.length && !this.pendingReq && !this.paused; }

  tapSlot(where) {
    this.touch(this.board.slotFor(where));
    if (this.phase === 'register') { this.regTapSlot(where); return; }
    if (!this.canAct()) return;
    const st = this.st(); const me = st.players[this.seat]; const card = this.cardAt(where);
    if (st.phase === 'promote' && st.pendingPromote === this.seat) {
      if (where.where === 'bench' && card) this.request({ type: 'promote', bench: where.index });
      return;
    }
    switch (this.ui.mode) {
      case 'pivot':
        this.tryRequest({type:'attack',move:this.ui.selectedHand,bench:where.where==='bench'?where.index:-1},()=>this.setMode('idle'));return;
      case 'switch': case 'xAttack':
        this.tryRequest({type:'trainer',card:this.ui.selectedHand,bench:where.where==='bench'?where.index:-1,target:card?.uid},()=>this.setMode('idle'));return;
      case 'retreat':
        if (where.where === 'bench' && card) { this.setMode('idle'); this.request({ type: 'retreat', bench: where.index }); }
        else this.flash('Pick a benched Pokémon to swap in', true);
        return;
      case 'potion':
        if (!card) { this.flash('Pick a damaged Pokémon', true); return; }
        this.tryRequest({ type: 'potion', card: this.ui.selectedHand, target: card.uid }, () => this.setMode('idle'));
        return;
      case 'bench':
        if (where.where === 'bench' && !card) { const uid = this.ui.selectedHand; this.setMode('idle'); this.request({ type: 'bench', card: uid, slot: where.index }); }
        else this.flash('Pick an empty bench slot', true);
        return;
      default:
        if (where.where === 'bench' && !card && this.benchOpen()) {
          const creatures = me.hand.filter(isCreature);
          if (creatures.length === 1) this.request({ type: 'bench', card: creatures[0].uid, slot: where.index });
          else { this.flash('Pinch a Pokémon in your hand', false); }
        } else if (card) {
          this.flash('Hold to inspect', false);
        }
    }
  }

  tapHand(uid) {
    this.touch(this.board.handCards.find((c) => c.userData.uid === uid));
    if (this.phase === 'register') { this.reg.selected = this.reg.selected === uid ? null : uid; play('select', this.board.root); this.refreshUI(); return; }
    if (!this.canAct()) return;
    const st = this.st(); const me = st.players[this.seat];
    const card = me.hand.find((c) => c.uid === uid); if (!card) return;
    if (this.ui.selectedHand === uid) { this.setMode('idle'); return; }
    if (!this.myTurnPlay()) { this.flash(unavailableReason(st, this.seat, 'endTurn') || 'Not your turn', true); return; }
    if (card.id === 'potion') {
      const r = unavailableReason(st, this.seat, 'potion'); if (r) { this.flash(r, true); return; }
      this.setMode('potion', uid);
    } else if (CARDS[card.id].kind==='trainer') {
      const action={type:'trainer',card:uid};
      const reason=unavailableReason(st,this.seat,'trainer',action);
      if(reason){this.flash(reason,true);return;}
      this.setMode(card.id,uid);
    } else if (isCreature(card)) {
      const r = unavailableReason(st, this.seat, 'bench'); if (r) { this.flash(r, true); return; }
      this.setMode('bench', uid);
    }
    play('select', this.board.root);
  }

  onActionButton(spec) {
    if (!spec) return;
    if (spec.action.type === 'cancel') { this.setMode('idle'); return; }
    if (!this.canAct()) return;
    if (spec.reason) { this.flash(spec.reason, true); return; }
    if (spec.action.type === 'retreatMenu') { this.setMode('retreat'); play('select', this.board.root); return; }
    if (spec.action.type==='attack' && MOVES[spec.action.move].pivot){this.setMode('pivot',spec.action.move);return;}
    if (spec.action.type==='trainer'){this.tryRequest(spec.action,()=>this.setMode('idle'));return;}
    if (spec.action.type === 'attack' && this.tutorial < 2) { this.tutorial = 2; this.updateHint(); }
    this.request(spec.action);
  }

  setMode(mode, selectedHand = null) { this.ui.mode = mode; this.ui.selectedHand = selectedHand; this.refreshUI(); }

  // Local pre-check gives an instant explanation; the authority re-validates.
  tryRequest(action, onOk) {
    const err = validate(this.st(), this.seat, action);
    if (err) { this.flash(err, true); return false; }
    onOk?.(); this.request(action); return true;
  }
  request(action) {
    if (this.pendingReq || this.presenting || this.queue.length) return;
    if (this.paused && action.type !== 'rematch') { this.flash('Match paused', true); return; }
    const err = validate(this.st(), this.seat, action);
    if (err) { this.flash(err, true); return; }
    this.pendingReq = this.client.request(action);
    this.pendingAt = this.now;
    this.refreshUI();
  }

  // Remember what the player just touched, so an explanation can appear
  // right where they were looking (not only on the side panel).
  touch(obj) { this.touched = obj ? { obj, at: this.now } : null; }
  flash(msg, bad = false) {
    this.flashMsg = msg; this.flashUntil = this.now + 2.6;
    if (bad) play('invalid', this.board.root);
    if (bad && this.touched && this.now - this.touched.at < 1.5) this.board.toast(msg, this.touched.obj);
    this.refreshUI();
  }

  // -------------------------------------------------------------- preview
  // The preview rises out of the held card; any next pinch dismisses it.
  // Opening or closing it never touches game state.
  openPreview(id, where, source) {
    if (!id) return;
    this.previewOpen = true;
    this.board.showPreview(id, source);
    play('select', this.board.root);
    this.previewFrom = where;
    const copy=where && (where.where==='active'||where.where==='bench')?this.cardAt(where):
      this.st()?.players.flatMap(p=>[p.active,...p.bench,...p.hand]).find(c=>c && c.uid===source?.userData.uid && c.maxHp);
    this.previewInfo=copy?NAME(id)+'  '+copy.hp+'/'+copy.maxHp+' HP'+(copy.guard?' · Guard '+copy.guard:'')+(copy.hex?' · Hex '+copy.hex:'')+(copy.charged?' · Charged':''):NAME(id);
    this.ctx.pointers.capture = () => { this.closePreview(); return true; };
    this.board.showHint(null);
    this.refreshUI();
  }
  closePreview() {
    if (!this.previewOpen) return;
    this.previewOpen = false;
    this.board.hidePreview();
    this.ctx.pointers.capture = null;
    if (this.tutorial === 0 && this.previewFrom?.where === 'bench') this.tutorial = 1;
    this.previewFrom = null;
    this.updateHint();
    this.refreshUI();
  }
  updateHint() {
    if (!this.hints || this.phase !== 'battle' || this.previewOpen) { this.board.showHint(null); return; }
    const st = this.st();
    if (this.tutorial === 0 && st.players[this.seat].bench[0]) this.board.showHint('HOLD TO INSPECT', 'bench0');
    else if (this.tutorial <= 1 && this.myTurnPlay()) {
      const m = CARDS[st.players[this.seat].active?.id]?.moves[0];
      this.tutorial = 1;
      this.board.showHint(m ? `PINCH ${UP(MOVES[m].name)}` : null, 'actions');
    } else this.board.showHint(null);
  }

  // -------------------------------------------------------- presentation
  async pump() {
    if (this.presenting || !this.queue.length) return;
    if (this.phase !== 'battle') {
      // Not showing the battle right now: keep the latest confirmed state;
      // syncAll() snaps the arena to it when the battle view returns.
      this.queue.length = 0;
      if (this.waitingForState && this.phase === 'register') this.startRegistration();
      this.refreshUI();
      return;
    }
    this.presenting = true;
    try {
      while (this.queue.length) {
        const u = this.queue.shift();
        if (!u.snapshot) for (const e of u.events) await this.presentEvent(e, u.state);
        await this.syncAll(u.state, true);
      }
    } finally {
      this.presenting = false;
      this.refreshUI();
      this.updateHint();
    }
  }

  // On-table callout, read aloud when the optional announcer is on.
  callout(text) { announce(text); return this.board.showCallout(text); }

  async presentEvent(e, finalState) {
    const b = this.board; const root = b.root;
    switch (e.type) {
      case 'attack': {
        // Choreography: callout + anticipation start together; the attacker
        // reaches contact and fires ONE impact event that starts the sound,
        // the effect at its peak, the local light, the defender's recoil and
        // the HP animation on the same frame. HP comes from the event only.
        const def = 1 - e.seat; const atkC = b.creatures[e.seat]; const defC = b.creatures[def];
        const move = MOVES[e.move];
        const look = IMPACT_LOOK[move.effect] || IMPACT_LOOK.fang;
        play('select', root);
        play('windup', root, b.creatureLocal(e.seat, .03));
        play(cryName(e.id, 'attack'), root, b.creatureLocal(e.seat, .03), { delay: .05 });
        const callout = this.callout(`${UP(NAME(e.id))} USED\n${UP(move.name)}!`);
        if (e.bonus) b.hpBars[e.seat].chargeIcon.visible = false;
        const localAnchor = (creature, key, seat) => creature
          ? root.worldToLocal(creature.getAnchor(key).getWorldPosition(new THREE.Vector3()))
          : b.creatureLocal(seat,.035);
        const launchAnchor = move.effect === 'rock' ? 'handR' : 'front';
        const to = localAnchor(defC,'center',def);
        let impacted = false; const jobs = [];
        const impact = (point) => {
          if (impacted) return; impacted = true;
          this.stats.impacts.push({ move: e.move, t: this.now, to: e.to });
          const dealt = e.damage || 0, heavy = dealt >= 30 || e.to === 0;
          play(look.sound, root, point, { gain: .8 + Math.min(dealt, 60) / 150 });
          if (heavy) play('thump', root, point);
          if (dealt > 0) play(cryName(e.targetId, 'hurt'), root, point, { delay: .14 });
          hitStop(heavy ? .09 : .06);
          jobs.push(b.effects.burst(move.effect, point, b.creatureLocal(def, 0), heavy));
          if (heavy && !this.ctx.isXR) globalThis.dispatchEvent?.(new CustomEvent('tabletop-shake', { detail: .0035 })); // desktop only: never move a headset view
          if (look.effect) jobs.push(b.effects[look.effect](point));
          jobs.push(b.effects.damage(point,e));
          if(e.blocked || e.dispelled?.guard)defC?.setGuarded(false);
          jobs.push(b.flashLight(point, look.light));
          if (defC) jobs.push(defC.hit(look.tint));
          jobs.push(b.hpBars[def].animateTo(e.to));
        };
        // contact point: between the defender and the attacker's body at contact
        const contact = () => {
          if (!atkC) return to.clone();
          const p = localAnchor(atkC,move.effect==='fang'?'mouth':'handR',e.seat);
          return to.clone().lerp(p, 0.35);
        };
        const onContact = () => {
          const from = localAnchor(atkC,launchAnchor,e.seat);
          if (move.effect === 'spores') { play('spores', root, from); jobs.push(b.effects.spores(from, to, () => impact(to))); }
          else if (move.effect === 'rock') { play('whoosh', root, from); jobs.push(b.effects.rock(from, to, () => impact(to))); }
          else if(e.move!=='sparkJab' && atkC?.launchPoint && ['vine','water','ember','psychic','ghost','drain','electric'].includes(move.effect)){
            play('whoosh', root, from);
            jobs.push(b.effects.projectile(move.effect,from,to,()=>impact(to)));
          } else impact(contact());
        };
        if (atkC) await atkC.attack(onContact); else onContact();
        while (jobs.length) await jobs.shift();
        impact(to); // safety net: an attack always lands exactly once
        while (jobs.length) await jobs.shift();
        await callout;
        await wait(0.12);
        b.hideCallout();
        break;
      }
      case 'charge': {
        const c = b.creatures[e.seat]; const pos = b.creatureLocal(e.seat, 0.03);
        await this.callout(`${UP(NAME(e.id))} USED\n${UP(MOVES[e.move].name)}!`);
        play('charge', root, pos);
        play(cryName(e.id, 'attack'), root, pos, { gain: .8 });
        if(MOVES[e.move].kind==='guard')c?.setGuarded(true);
        await Promise.all([b.effects.charge(pos), MOVES[e.move].kind==='guard'?c?.guard():c?.chargeUp()]);
        b.hpBars[e.seat].chargeIcon.set(MOVES[e.move].kind==='guard'?'◆':'⚡');b.hpBars[e.seat].chargeIcon.visible = true;
        await wait(0.3); b.hideCallout();
        break;
      }
      case 'ko': {
        if(e.active===false){this.setScore(e.score);this.flash(NAME(e.id)+' was knocked out on the bench');break;}
        const c = b.creatures[e.seat]; const pos = b.creatureLocal(e.seat, 0.02);
        await wait(0.15);
        play(cryName(e.id, 'faint'), root, pos);
        play('ko', root, pos, { delay: .12 });
        play('cheer', root, null, { delay: .5 });
        await Promise.all([c?.knockout(), b.effects.knockout(pos)]);
        b.removeCreature(e.seat); b.hpBars[e.seat].visible = false;
        this.setScore(e.score);
        await this.callout(`${UP(NAME(e.id))}\nIS KNOCKED OUT!`);
        await wait(0.6); b.hideCallout();
        break;
      }
      case 'retreat': case 'promote': {
        const id = e.type === 'retreat' ? e.toId : e.id; const uid = e.type === 'retreat' ? e.to : e.uid;
        const old = b.creatures[e.seat];
        if (old) await tween(0.25, (p) => old.body.scale.setScalar(Math.max(0.001, 1 - p)));
        await this.callout(e.type === 'retreat' ? `${UP(NAME(e.fromId))} RETREATS\n${UP(NAME(id))} IN!` : `GO,\n${UP(NAME(id))}!`);
        const card = findInPlay(finalState.players[e.seat], uid)?.card;
        b.hpBars[e.seat].set(card?.hp ?? CARDS[id].hp, card?.maxHp ?? CARDS[id].hp);
        b.hpBars[e.seat].chargeIcon.visible = !!card?.charged;
        b.hpBars[e.seat].visible = true;
        await b.spawnCreature(e.seat, { uid, id });
        play('confirm', root);
        play(cryName(id, 'enter'), root, b.creatureLocal(e.seat, .03));
        if (e.seat === this.seat && this.cardMode === 'physical') this.flash('Swap your physical cards to match');
        await wait(0.35); b.hideCallout();
        break;
      }
      case 'trainer': this.flash(NAME(e.id)+' played');break;
      case 'chip': {
        if(b.creatures[e.seat]?.userData.uid===e.uid)await b.hpBars[e.seat].animateTo(e.to);
        if(e.source==='Hex') {
          play('hex',root);
          await this.callout(NAME(e.id).toUpperCase()+'  ·  HEX\n'+e.from+' → '+e.to+' HP');
          await wait(.65); b.hideCallout();
        }
        this.flash(e.source+' hit '+NAME(e.id));break;
      }
      case 'heal': {
        play('heal', root);
        const active = finalState.players[e.seat].active;
        if (active?.uid === e.uid) { const pos = b.creatureLocal(e.seat, 0.01); await Promise.all([b.effects.heal(pos), b.hpBars[e.seat].animateTo(e.to)]); }
        else await wait(0.3);
        if (e.seat !== this.seat) this.flash(`${e.source || 'Potion'} healed ${NAME(e.id)}`);
        break;
      }
      case 'bench':
        play('confirm', root);
        if (e.seat === this.seat && this.cardMode === 'physical') this.flash(`Place your ${NAME(e.id)} card in that bench slot`);
        if (e.seat !== this.seat) { this.flash(`Opponent benched ${NAME(e.id)}`); await wait(0.5); }
        break;
      case 'draw':
        if (e.seat === this.seat && e.id) this.flash(`You drew ${NAME(e.id)}`);
        break;
      case 'turn':
        if (e.seat === this.seat) play('select', root);
        break;
      case 'win':
        play('win', root);
        await b.creatures[e.seat]?.celebrate();
        break;
      case 'rematch':
        if(this.cardMode==='physical'){this.reg=null;this.phase='register';b.hpBars.forEach(h=>{h.visible=false;});this.startRegistration();}
        // a fresh match: no old effects, figures, markers, hints or input locks
        b.effects.clear(); b.removeCreature(0); b.removeCreature(1);
        this.closePreview(); this.flashMsg = null; this.shownScore = [0, 0]; this.setScore([0, 0]);
        if (this.tutorial < 99) { this.tutorial = 99; b.showHint(null); }
        b.hpBars.forEach((h) => { h.chargeIcon.visible = false; });
        this.setMode('idle');
        break;
      case 'endTurn':
        await this.callout(`${e.seat === this.seat ? 'YOU' : 'OPPONENT'}\nENDED THE TURN`); await wait(0.5); b.hideCallout();
        break;
      default: break;
    }
  }

  setScore(score) {
    const rows = [this.seat, 1 - this.seat];
    const prev = this.shownScore || [0, 0];
    rows.forEach((seat, r) => this.board.scoreBalls[r].forEach((m, i) => {
      const on = i < score[seat];
      m.material.color.set(on ? (r === 0 ? '#7ff0ff' : '#ffb347') : '#59606e');
      m.material.emissive.set(on ? (r === 0 ? '#1aa6c4' : '#a85a00') : '#000000');
      if (on && i >= prev[seat]) this.board.popScore(r, i); // a newly earned marker pops once
    }));
    this.shownScore = [...score];
  }

  // Make the arena match the confirmed state exactly.
  async syncAll(st, animate) {
    if (!st || this.phase !== 'battle') return;
    const b = this.board; const jobs = [];
    for (const seat of [0, 1]) {
      const a = st.players[seat].active;
      if (!a) { b.removeCreature(seat); b.hpBars[seat].visible = false; continue; }
      b.hpBars[seat].visible = true;
      b.hpBars[seat].set(a.hp, a.maxHp);
      const tags=[a.charged?'⚡':'',a.guard?'◆':'',a.hex?'☾':''].join('');
      b.hpBars[seat].chargeIcon.set(tags);b.hpBars[seat].chargeIcon.visible=!!tags;
      jobs.push(b.spawnCreature(seat, a, { animate }).then(figure=>figure?.setGuarded(a.guard)));
    }
    await Promise.all(jobs);
    this.refreshUI();
  }

  // ------------------------------------------------------------------- UI
  refreshUI() {
    const st = this.st(); const b = this.board;
    if (!st) { b.rightPanel.set(this.connText || 'Connecting…'); b.leftPanel.set(this.shared ? `Room ${this.room}` : ''); return; }
    const me = st.players[this.seat];
    const battle = this.phase === 'battle';
    b.setTurn(battle && st.phase==='play' ? st.current : null);
    const reg = this.phase === 'register' && this.reg;
    const myPromote = st.phase === 'promote' && st.pendingPromote === this.seat;

    let handShown = me.hand || [];
    let uiSel = this.ui.selectedHand;
    if (reg) { handShown = this.reg.mode === 'virtual' ? this.reg.items.filter((it) => !it.done).map((it) => ({ uid: `reg-${it.card.uid}`, id: it.card.id })) : []; uiSel = this.reg.selected; }
    const viewState = reg ? this.registrationView(st) : st;
    b.renderState({ ...viewState, players: viewState.players.map((p, s) => (s === this.seat ? { ...p, hand: handShown } : p)) },
      { benchOpen: battle && this.benchOpen() && (this.ui.mode === 'idle' || this.ui.mode === 'bench'), selectedHand: uiSel, shared: this.shared, hideActive: reg ? [true, true] : null });
    if (battle) this.setScore(st.players.map((p) => p.score));

    // slot highlights
    const slots = [b.activeSlot, ...b.benchSlots];
    slots.forEach((s) => s.setHighlight(null));
    if (reg) {
      this.reg.items.forEach((it) => { if (!it.done) b.slotFor(it.where).setHighlight('target'); });
      slots.forEach((s, i) => {
        const it = this.reg.items.find((x) => (i === 0 ? x.where.where === 'active' : x.where.index === i - 1));
        s.prompt.visible = !!it && !it.done;
        if (s.prompt.visible) s.prompt.set(this.reg.mode === 'physical' ? `Place ${UP(NAME(it.card.id))} here\nthen pinch to confirm` : `Pinch ${UP(NAME(it.card.id))} in your hand,\nthen pinch here`);
        if (it?.done) { s.card.visible = this.reg.mode === 'virtual' || !this.ctx.isXR; s.card.setCard(it.card.id); s.label.set(i === 0 ? `ACTIVE   HP ${it.card.hp}/${it.card.maxHp}` : `HP ${it.card.hp}/${it.card.maxHp}`); }
      });
    } else {
      slots.forEach((s) => { s.prompt.visible = false; });
      if (battle && myPromote) b.benchSlots.forEach((s, i) => me.bench[i] && s.setHighlight('warn'));
      else if (['retreat','pivot','switch'].includes(this.ui.mode)) b.benchSlots.forEach((s, i) => me.bench[i] && s.setHighlight('target'));
      else if (this.ui.mode === 'bench') b.benchSlots.forEach((s, i) => !me.bench[i] && s.setHighlight('target'));
      else if (this.ui.mode === 'potion') slots.forEach((s, i) => { const c = i === 0 ? me.active : me.bench[i - 1]; if (c && c.hp < c.maxHp) s.setHighlight('target'); });
    }

    // action buttons
    let buttons = [];
    const idle = battle && !this.presenting && !this.queue.length && !this.pendingReq && !this.paused;
    if (idle && this.myTurnPlay()) {
      if(this.ui.mode==='pokeBall')buttons=[{text:'DRAW BASIC',action:{type:'trainer',card:this.ui.selectedHand}},{text:'CANCEL',action:{type:'cancel'}}];
      else if (this.ui.mode !== 'idle') buttons = [{ text: 'CANCEL', action: { type: 'cancel' } }];
      else {
        const a = me.active;
        for (const m of CARDS[a.id].moves) {
          const mv = MOVES[m]; const reason = unavailableReason(st, this.seat, 'attack', { move: m });
          const dmg = mv.kind === 'damage' ? `${mv.damage + (a.charged ? MOVES.charge.bonus : 0)}` : `+${mv.bonus}`;
          buttons.push({ text: UP(mv.name), sub: dmg, action: { type: 'attack', move: m }, dim: !!reason, reason });
        }
        const rr = unavailableReason(st, this.seat, 'retreat');
        buttons.push({ text: 'RETREAT', action: { type: 'retreatMenu' }, dim: !!rr, reason: rr });
        buttons.push({ text: 'END TURN', action: { type: 'endTurn' } });
      }
    }
    b.setActions(buttons);

    // panels
    const last = st.log[st.log.length - 1] || '';
    b.leftPanel.set(this.shared ? `TURN ${st.turn}\n${last}\nRoom ${this.room}` : `TURN ${st.turn}\n${last}`);
    let instr;
    if (this.phase === 'place') instr = 'Placing the table…';
    else if (reg) {
      const need = this.reg.items.filter((i) => !i.done).map((i) => `${NAME(i.card.id)} → ${i.where.where === 'active' ? 'ACTIVE' : 'BENCH'}`);
      instr = this.reg.mode === 'physical' ? `Put your cards in the outlines:\n${need.join('\n')}\nPinch each slot to confirm` : `Virtual cards:\n${need.join('\n')}`;
    } else if (this.paused) instr = this.connText;
    else if (st.phase === 'over') instr = `${st.winner === this.seat ? 'You won!' : 'You lost'}\nPinch REMATCH to play again`;
    else if (myPromote) instr = 'Your Pokémon was knocked out\nPick a benched Pokémon to promote';
    else if (st.phase === 'promote') instr = 'Waiting…\nOpponent is promoting';
    else if (this.myTurnPlay()) {
      instr = {pivot:'BATON PASS\nPick a living reserve',switch:'SWITCH\nPick a living reserve',xAttack:'X ATTACK\nPick an uncharged Pokémon',pokeBall:'POKÉ BALL\nConfirm to draw a Basic',retreat: 'RETREAT\nPick a benched Pokémon to swap in', potion: 'POTION\nPick a damaged Pokémon', bench: 'BENCH\nPick an empty bench slot' }[this.ui.mode]
        || (this.presenting || this.pendingReq ? 'YOUR TURN' : 'YOUR TURN\nChoose an action');
    } else instr = "OPPONENT'S TURN\nWaiting…";
    if (this.flashMsg && this.now < this.flashUntil) instr = `${instr.split('\n')[0]}\n${this.flashMsg}`;
    if(this.previewOpen)instr=this.previewInfo+'\n'+(CARDS[b.preview.userData.id]?.moves||[]).map(m=>MOVES[m].name).join(' · ');
    b.rightPanel.set(instr);

    // end of match
    const over = battle && st.phase === 'over' && !this.presenting && !this.queue.length;
    b.btnNewMatch.visible=over && this.seat===0;
    b.banner.visible = over; b.btnRematch.visible = over;
    if (over) b.banner.set(st.winner === this.seat ? 'YOU WIN' : 'YOU LOSE', { color: st.winner === this.seat ? '#7ff0ff' : '#ffb347' });
    b.btnReposition.setDim(!this.handlers().canReposition());
  }

  // During registration, hide everything the player has not confirmed yet.
  registrationView(st) {
    const players = st.players.map((p, s) => {
      if (s !== this.seat) return p;
      return { ...p, active: null, bench: p.bench.map(() => null) };
    });
    return { ...st, players };
  }

  // ---------------------------------------------------------------- frame
  update(dt, frame) {
    this.now += dt;
    if (this.placement) this.placement.update(dt);
    if (this.phase === 'restoring') {
      const pose = this.ctx.anchor.pose(frame);
      if (pose) {
        const e = new THREE.Euler().setFromQuaternion(pose.quat, 'YXZ');
        this.phase = 'init';
        this.applyPlacement({ pos: pose.pos, yaw: e.y, scale: this.restoredScale || 1 });
        this.afterPlacement();
        this.flash('Restored your table position. Use REPOSITION to move it.');
      } else if (this.now - this.restoreStarted > 3) { this.phase = 'init'; this.ctx.anchor.clear(); this.startPlacement(); }
    } else if (this.ctx.isXR && this.ctx.anchor?.anchor && this.phase !== 'place') {
      const pose = this.ctx.anchor.pose(frame);
      if (pose) { this.board.root.position.copy(pose.pos); this.board.root.quaternion.copy(pose.quat); }
    }
    this.pump();
    this.updateDemo();
    // AI turn (Quick Battle): same request path as a human, with a pause so
    // the player can follow what happened. Paused while a demo is playing.
    if (this.mode === 'quick' && this.phase === 'battle' && !this.presenting && !this.queue.length && !this.aiPending && !this.demo?.running) {
      const s = this.ai.state;
      const needs = s && ((s.phase === 'play' && s.current === 1) || (s.phase === 'promote' && s.pendingPromote === 1));
      if (needs) {
        if (this.aiWaitStart == null) this.aiWaitStart = this.now;
        else if (this.now - this.aiWaitStart > 0.7) {
          this.aiWaitStart = null;
          const scripted = !this.scriptedReplyDone && s.phase === 'play' && s.match === 1;
          const a = chooseAction(s, 1, { scriptFirstReply: scripted });
          if (a) {
            if (scripted && a.type === 'attack') this.scriptedReplyDone = true;
            this.aiPending = true; this.ai.request(a);
          }
        }
      } else this.aiWaitStart = null;
    }
    if (this.pendingReq && this.now - this.pendingAt > 5) { this.pendingReq = null; this.flash('No response — try again', true); }
    if (this.flashMsg && this.now >= this.flashUntil) { this.flashMsg = null; this.refreshUI(); }
    this.board.update(dt, this.now, this.ctx.cameraWorld());
  }

  // Demo: confirm the stand-in cards, then play the scripted steps through the
  // same request paths as the local player (seat 0) and the AI (seat 1).
  updateDemo() {
    const d = this.demo; if (!d?.running) return;
    const cue = (c, seat) => this.ctx.demoCue?.(c, seat);
    if (this.phase === 'register' && this.reg) {
      if (this.demoRegAt == null) { this.demoRegAt = this.now + 0.6; this.demoRegStart = this.now; cue('register', this.seat); return; }
      if (this.now - this.demoRegStart > d.busy) { d.fail('Registration never completed', { cue }); this.recoverFromDemo(); return; }
      if (this.now < this.demoRegAt) return;
      const item = this.reg.items.find((it) => !it.done);
      if (item) { this.demoRegAt = this.now + 0.35; this.regTapSlot(item.where); }
      return;
    }
    d.tick(this.now, {
      idle: this.canAct() && !this.aiPending,
      // Intentional pauses freeze demo timers rather than counting as stuck.
      paused: this.paused || this.previewOpen || this.phase !== 'battle',
      stateFor: (seat) => (seat === this.seat ? this.st() : this.ai.state),
      request: (seat, action) => {
        if (seat === this.seat) this.request(action);
        else { this.aiPending = true; this.ai.request(action); }
      },
      cue,
    });
    if (d.status === 'failed') this.recoverFromDemo();
  }

  // A failed demo hands the table back: drop any request the demo left
  // hanging so the player can act, and normal solo AI resumes (it is gated
  // only on demo.running). Presentations already queued play out normally.
  recoverFromDemo() {
    this.pendingReq = null; this.aiPending = false; this.aiWaitStart = null;
    this.flash('Demo stopped — you have control', true);
    this.refreshUI();
  }

  dispose() {
    this.demo?.dispose();
    this.placement?.dispose();
    this.link?.close();
    this.ctx.pointers.capture = null;
    const ix = this.ctx.interactables;
    ix.list = ix.list.filter((t) => { let o = t.hit; while (o) { if (o === this.board.root) return false; o = o.parent; } return true; });
    this.board.dispose();
  }
}
