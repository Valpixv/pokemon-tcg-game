// Pure battle rules. No rendering, no XR, no networking.
// Every input path (pinch, mouse, AI, network request) ends in applyAction().
import { CARDS, MOVES, RULES, teamMatch } from './data.js';

const clone = (o) => structuredClone(o);

export function cardDef(card) { return CARDS[card.id]; }
export function isCreature(card) { return !!card && CARDS[card.id]?.kind === 'creature'; }

function makeCard(state, seat, id) {
  if (!CARDS[id]) throw new Error(`Unknown card ${id}`);
  const def = CARDS[id];
  const uid = `p${seat}c${state.nextUid++}`;
  return def.kind === 'creature'
    ? { uid, id, hp: def.hp, maxHp: def.hp, charged: false }
    : { uid, id };
}

export function createMatch(setup, matchNo = 1) {
  const state = {
    seq: 0, match: matchNo, turn: 1, current: 0, phase: 'play', pendingPromote: null, winner: null, winReason: null,
    expanded:!!setup.teams, nextUid: 1, log: [], setup: clone(setup), players: [],
  };
  setup.players.forEach((p, seat) => {
    const bench = Array(RULES.benchSize).fill(null);
    p.bench.forEach((id, i) => { bench[i] = makeCard(state, seat, id); });
    state.players.push({
      name: p.name,
      active: makeCard(state, seat, p.active),
      bench,
      deck: p.deck.map((id) => makeCard(state, seat, id)),
      hand: p.hand.map((id) => makeCard(state, seat, id)),
      discard: [],
      score: 0,
      potionsUsed: 0,
    });
  });
  startTurn(state, []);
  return state;
}

// ---------------------------------------------------------------- helpers
function log(state, line) { state.log.push(line); if (state.log.length > 8) state.log.shift(); }
export function findInPlay(p, uid) {
  if (p.active && p.active.uid === uid) return { card: p.active, where: 'active' };
  const i = p.bench.findIndex((c) => c && c.uid === uid);
  return i >= 0 ? { card: p.bench[i], where: 'bench', index: i } : null;
}
export function benchCount(p) { return p.bench.filter(Boolean).length; }
export function allInPlay(p) { return [p.active, ...p.bench].filter(Boolean); }

function startTurn(state, events) {
  const p = state.players[state.current];
  p.potionsUsed = 0;
  events.push({ type: 'turn', seat: state.current, turn: state.turn });
  if (p.deck.length) {
    const c = p.deck.shift();
    p.hand.push(c);
    events.push({ type: 'draw', seat: state.current, uid: c.uid, id: c.id });
  } else {
    events.push({ type: 'draw', seat: state.current, uid: null, id: null, empty: true });
  }
}

function swap(p,index,seat,events) {
  const out=p.active, inc=p.bench[index];
  p.bench[index]=out;p.active=inc;
  events.push({type:'retreat',seat,from:out.uid,fromId:out.id,to:inc.uid,toId:inc.id,bench:index});
}

function nextPlayer(state,events) {
  state.phase='play';state.pendingPromote=null;
  state.current=1-state.current;state.turn++;startTurn(state,events);
}

function endTurn(state,events) {
  const seat=state.current;
  for(const c of allInPlay(state.players[seat])){
    if(!c.hex || !c.hp)continue;
    const from=c.hp;c.hp=Math.max(0,c.hp-c.hex);delete c.hex;
    events.push({type:'chip',seat,uid:c.uid,id:c.id,from,to:c.hp,source:'Hex'});
    log(state,`Hex hit ${CARDS[c.id].name} for ${from-c.hp}`);
  }
  const order=[1-seat,seat];
  for(const owner of order){
    const p=state.players[owner];
    for(const card of allInPlay(p).filter(c=>c.hp===0)){
      const active=p.active===card;
      if(active)p.active=null;else p.bench[p.bench.indexOf(card)]=null;
      p.discard.push(card);state.players[1-owner].score++;
      events.push({type:'ko',seat:owner,active,uid:card.uid,id:card.id,by:1-owner,score:state.players.map(x=>x.score)});
      log(state,`${CARDS[card.id].name} was knocked out`);
    }
  }
  // If both sides meet a win condition simultaneously, the defending seat wins.
  for(const winner of order){
    if(state.players[winner].score>=RULES.knockoutsToWin || !allInPlay(state.players[1-winner]).length){
      win(state,events,winner,state.players[winner].score>=RULES.knockoutsToWin?'knockouts':'no Pokémon left');return;
    }
  }
  const missing=order.filter(owner=>!state.players[owner].active);
  if(missing.length){
    state.phase='promote';state.pendingPromote=missing.shift();state.promotions=missing;
    events.push({type:'promoteRequired',seat:state.pendingPromote});return;
  }
  nextPlayer(state,events);
}

// --------------------------------------------------------- availability
// Returns null when the action type is available, or a short explanation.
export function unavailableReason(state, seat, type, extra = {}) {
  if (state.phase === 'over') return type === 'rematch' || (type === 'newMatch' && seat === 0) ? null : 'The match is over';
  if (type === 'rematch') return 'Finish the match first';
  if (state.phase === 'promote') {
    if (state.pendingPromote !== seat) return 'Waiting for opponent to promote';
    return type === 'promote' ? null : 'Promote a benched Pokémon first';
  }
  if (type === 'promote') return 'Nothing to promote';
  if (state.current !== seat) return 'Not your turn';
  const p = state.players[seat];
  switch (type) {
    case 'attack': {
      if (!p.active) return 'No active Pokémon';
      const move = MOVES[extra.move];
      if (!move || !CARDS[p.active.id].moves.includes(extra.move)) return 'That move is not available';
      if (move.kind === 'charge' && p.active.charged) return 'Already charged';
      if (move.kind === 'guard' && p.active.guard) return 'Already guarding';
      if (move.pivot && !benchCount(p)) return 'Bench a Pokémon to pivot';
      return null;
    }
    case 'trainer': {
      const card=p.hand.find(c=>c.uid===extra.card);
      if (!card || !['switch','pokeBall','xAttack'].includes(card.id)) return 'Pick a Trainer from your hand';
      if (p.potionsUsed) return 'One Trainer per turn';
      if (card.id==='switch' && !benchCount(p)) return 'Choose a living reserve';
      if (card.id==='pokeBall' && !(p.searchable ?? p.deck.some(isCreature))) return 'No Basic Pokémon in deck';
      return null;
    }
    case 'retreat': return benchCount(p) ? null : 'Bench a Pokémon to retreat';
    case 'bench': {
      if (!p.hand.some(isCreature)) return 'No Pokémon in hand';
      if (benchCount(p) >= RULES.benchSize) return 'Bench is full';
      return null;
    }
    case 'potion': {
      if (!p.hand.some((c) => c.id === 'potion')) return 'No Potion in hand';
      if (p.potionsUsed >= RULES.potionsPerTurn) return state.setup?.teams || state.expanded ? 'One Trainer per turn':'One Potion per turn';
      if (!allInPlay(p).some((c) => c.hp < c.maxHp)) return 'No damaged Pokémon';
      return null;
    }
    case 'endTurn': return null;
    default: return 'Unknown action';
  }
}

export function legalActions(state, seat) {
  const out = [];
  const add = (a) => { if (validate(state, seat, a) === null) out.push(a); };
  if (state.phase === 'over') return [{ type: 'rematch' }];
  const p = state.players[seat];
  if (state.phase === 'promote') {
    p.bench.forEach((c, i) => c && add({ type: 'promote', bench: i }));
    return out;
  }
  if (state.current !== seat) return out;
  if (p.active) for (const move of CARDS[p.active.id].moves) {
    if (MOVES[move].pivot) p.bench.forEach((c,bench)=>c && add({type:'attack',move,bench}));
    else add({type:'attack',move});
  }
  p.bench.forEach((c, i) => c && add({ type: 'retreat', bench: i }));
  for (const h of p.hand) {
    if (isCreature(h)) p.bench.forEach((c, i) => !c && add({ type: 'bench', card: h.uid, slot: i }));
    if (h.id === 'switch') p.bench.forEach((c,bench)=>c && add({type:'trainer',card:h.uid,bench}));
    if (h.id === 'pokeBall') add({type:'trainer',card:h.uid});
    if (h.id === 'xAttack') for(const c of allInPlay(p)) add({type:'trainer',card:h.uid,target:c.uid});
    if (h.id === 'potion') for (const t of allInPlay(p)) add({ type: 'potion', card: h.uid, target: t.uid });
  }
  add({ type: 'endTurn' });
  return out;
}

// Returns null if legal, otherwise an explanation string.
export function validate(state, seat, a) {
  if (!a || typeof a.type !== 'string') return 'Bad action';
  if (seat !== 0 && seat !== 1) return 'Bad seat';
  const r = unavailableReason(state, seat, a.type, a);
  if (r) return r;
  const p = state.players[seat];
  switch (a.type) {
    case 'attack': return MOVES[a.move].pivot && !p.bench[a.bench] ? 'Pick a living reserve' : null;
    case 'trainer': {
      const id=p.hand.find(c=>c.uid===a.card).id;
      if(id==='switch' && !p.bench[a.bench]) return 'Pick a living reserve';
      if(id==='xAttack'){
        const target=findInPlay(p,a.target)?.card;
        if(!target || target.charged) return 'Pick an uncharged friendly Pokémon';
      }
      return null;
    }
    case 'retreat': return p.bench[a.bench] ? null : 'Pick a benched Pokémon';
    case 'promote': return p.bench[a.bench] ? null : 'Pick a benched Pokémon';
    case 'bench': {
      const c = p.hand.find((h) => h.uid === a.card);
      if (!isCreature(c)) return 'Pick a Pokémon from your hand';
      if (!(a.slot >= 0 && a.slot < RULES.benchSize) || p.bench[a.slot]) return 'Pick an empty bench slot';
      return null;
    }
    case 'potion': {
      const c = p.hand.find((h) => h.uid === a.card);
      if (!c || c.id !== 'potion') return 'Pick a Potion';
      const t = findInPlay(p, a.target);
      if (!t) return 'Pick one of your Pokémon';
      if (t.card.hp >= t.card.maxHp) return `${CARDS[t.card.id].name} is at full HP`;
      return null;
    }
    default: return null;
  }
}

// ------------------------------------------------------------------ apply
export function applyAction(prev, seat, action) {
  const err = validate(prev, seat, action);
  if (err) return { ok: false, error: err, state: prev, events: [] };
  let state = clone(prev);
  const events = [];
  const me = state.players[seat];
  const foe = state.players[1 - seat];

  switch (action.type) {
    case 'attack': {
      const atk = me.active;
      const move = MOVES[action.move];
      const aName = CARDS[atk.id].name;
      if (move.kind === 'charge' || move.kind === 'guard') {
        if(move.kind==='guard') atk.guard=move.bonus; else atk.charged=true;
        events.push({ type: 'charge', seat, uid: atk.uid, id: atk.id, move: action.move });
        log(state, `${aName} used ${move.name}`);
        endTurn(state, events);
        break;
      }
      const target = foe.active;
      const bonus = atk.charged ? (MOVES.charge.bonus || 0) : 0;
      atk.charged = false;
      // Authority facts for presentation: what the dispel stripped (null when the
      // move has no dispel or nothing was there), what guard absorbed, and any
      // delayed mark left on a surviving target. Extra fields only; older
      // consumers can ignore them.
      let dispelled=null;
      if(move.dispel){
        if(target.guard || target.charged) dispelled={guard:target.guard||0,charged:!!target.charged};
        target.guard=0;target.charged=false;
      }
      const blocked=Math.min(target.guard||0,move.damage+bonus);
      target.guard=0;
      const damage=move.damage+bonus-blocked;
      const from = target.hp;
      target.hp = Math.max(0, target.hp - damage);
      const mark=move.delayed && target.hp ? move.delayed : 0;
      events.push({ type: 'attack', seat, uid: atk.uid, id: atk.id, move: action.move, target: target.uid, targetId: target.id, damage, bonus, from, to: target.hp, blocked, dispelled, mark });
      log(state, `${aName} used ${move.name}: ${damage} dmg`);
      if(blocked)log(state,`Guard blocked ${blocked} damage`);
      if(move.drain && atk.hp<atk.maxHp){
        const old=atk.hp;atk.hp=Math.min(atk.maxHp,atk.hp+Math.min(from-target.hp,move.drain));
        events.push({type:'heal',seat,uid:atk.uid,id:atk.id,from:old,to:atk.hp,source:move.name});
      }
      if(mark) target.hex=mark;
      if(move.recoil){
        const old=atk.hp;atk.hp=Math.max(0,atk.hp-move.recoil);
        events.push({type:'chip',seat,uid:atk.uid,id:atk.id,from:old,to:atk.hp,source:'Recoil'});
      }
      if(move.pivot) swap(me,action.bench,seat,events);
      endTurn(state, events);
      break;
    }
    case 'retreat': {
      const out = me.active, inc = me.bench[action.bench];
      me.bench[action.bench] = out; me.active = inc;
      events.push({ type: 'retreat', seat, from: out.uid, fromId: out.id, to: inc.uid, toId: inc.id, bench: action.bench });
      log(state, `${CARDS[out.id].name} retreated for ${CARDS[inc.id].name}`);
      endTurn(state, events);
      break;
    }
    case 'promote': {
      const inc = me.bench[action.bench];
      me.bench[action.bench] = null; me.active = inc;

      events.push({ type: 'promote', seat, uid: inc.uid, id: inc.id, bench: action.bench });
      log(state, `${CARDS[inc.id].name} was promoted`);
      if(state.promotions?.length){state.pendingPromote=state.promotions.shift();events.push({type:'promoteRequired',seat:state.pendingPromote});}
      else nextPlayer(state,events);
      break;
    }
    case 'bench': {
      const i = me.hand.findIndex((h) => h.uid === action.card);
      const c = me.hand.splice(i, 1)[0];
      me.bench[action.slot] = c;
      events.push({ type: 'bench', seat, uid: c.uid, id: c.id, slot: action.slot });
      log(state, `${CARDS[c.id].name} joined the bench`);
      break;
    }
    case 'trainer': {
      const i=me.hand.findIndex(c=>c.uid===action.card),card=me.hand.splice(i,1)[0];
      me.discard.push(card);me.potionsUsed++;
      log(state,`${me.name} used ${CARDS[card.id].name}`);events.push({type:'trainer',id:card.id,seat});
      if(card.id==='switch')swap(me,action.bench,seat,events);
      if(card.id==='xAttack') findInPlay(me,action.target).card.charged=true;
      if(card.id==='pokeBall'){
        const basic=me.deck.splice(me.deck.findIndex(isCreature),1)[0];me.hand.push(basic);
        events.push({type:'draw',seat,id:basic.id,uid:basic.uid});
      }
      break;
    }
    case 'potion': {
      const i = me.hand.findIndex((h) => h.uid === action.card);
      const c = me.hand.splice(i, 1)[0];
      me.discard.push(c);
      me.potionsUsed += 1;
      const t = findInPlay(me, action.target).card;
      const from = t.hp;
      t.hp = Math.min(t.maxHp, t.hp + CARDS.potion.heal);
      events.push({ type: 'heal', seat, uid: t.uid, id: t.id, card: c.uid, from, to: t.hp });
      log(state, `Potion healed ${CARDS[t.id].name} +${t.hp - from}`);
      break;
    }
    case 'endTurn': {
      events.push({ type: 'endTurn', seat });
      log(state, `${me.name} ended the turn`);
      endTurn(state, events);
      break;
    }
    case 'newMatch': case 'rematch': {
      const seq = state.seq;
      let setup=prev.setup;
      if(action.type==='newMatch'){
        const seed=(Math.imul(prev.setup.seed??prev.match,1664525)+1013904223)>>>0;
        setup=teamMatch(seed);
        if(setup.teams.join('/')===prev.setup.teams?.join('/'))setup=teamMatch(seed,setup.teams[1],setup.teams[0]);
      }
      state=createMatch(setup,(prev.match||1)+1);
      state.seq = seq;
      events.push({ type: 'rematch' });
      break;
    }
  }
  state.seq += 1;
  return { ok: true, state, events };
}

function win(state, events, seat, reason) {
  state.phase = 'over'; state.winner = seat; state.winReason = reason;
  events.push({ type: 'win', seat, reason });
  log(state, `${state.players[seat].name} won`);
}

// --------------------------------------------------------------- privacy
// Hidden information: the other player's hand and both decks' order.
export function viewFor(state, seat) {
  const v = clone(state);
  v.players.forEach((p, s) => {
    if(s===seat)p.searchable=p.deck.some(isCreature);
    p.deckCount = p.deck.length; p.deck = [];
    p.handCount = p.hand.length;
    if (s !== seat) p.hand = [];
  });
  delete v.setup;
  return v;
}
export function eventsFor(events, seat) {
  return events.map((e) => (e.type === 'draw' && e.seat !== seat ? { ...e, uid: null, id: null, hidden: true } : e));
}
