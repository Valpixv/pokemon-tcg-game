// Opponent AI. It only ever picks from legalActions(), so it goes through the
// exact same validation as a human pinch or a network request.
import { CARDS, MOVES } from './data.js';
import { legalActions } from './engine.js';

function moveDamage(card, moveId) {
  const m = MOVES[moveId];
  return m.kind === 'damage' ? m.damage + (card.charged ? MOVES.charge.bonus : 0) : 0;
}

// opts.scriptFirstReply: on the very first damaging opportunity, use the
// creature's first damaging move (so a first-time player sees both effects).
export function chooseAction(state, seat, opts = {}, rand = Math.random) {
  const legal = legalActions(state, seat);
  if (!legal.length) return null;
  if (legal[0].type === 'rematch') return null; // humans start rematches

  const me = state.players[seat];
  const foe = state.players[1 - seat];
  const of = (type) => legal.filter((a) => a.type === type);

  // 1. Promotion after a knockout: healthiest reserve.
  const promos = of('promote');
  if (promos.length) {
    promos.sort((a, b) => me.bench[b.bench].hp - me.bench[a.bench].hp);
    return promos[0];
  }

  // 2. Fill the bench with creatures from hand.
  const benches = of('bench');
  if (benches.length) return benches[0];

  const active = me.active;
  const attacks = of('attack');
  const damaging = attacks.filter((a) => MOVES[a.move].kind === 'damage');

  if (opts.scriptFirstReply && damaging.length) return damaging[0];

  // 3. Potion on a target that actually benefits (never a full-HP one —
  //    legalActions already excludes those). Prefer the active creature.
  const potions = of('potion');
  if (potions.length) {
    const scored = potions.map((a) => {
      const t = [me.active, ...me.bench].find((c) => c && c.uid === a.target);
      return { a, missing: t.maxHp - t.hp, isActive: t === active };
    }).filter((x) => x.missing >= 10)
      .sort((x, y) => (y.isActive - x.isActive) || (y.missing - x.missing));
    if (scored.length) return scored[0].a;
  }

  const foeActive = foe.active;
  const trainers=of('trainer');
  const trainerId=a=>me.hand.find(h=>h.uid===a.card)?.id;
  const boost=trainers.find(a=>trainerId(a)==='xAttack' && a.target===active.uid);
  if(boost)return boost;
  const draw=trainers.find(a=>trainerId(a)==='pokeBall');
  if(draw)return draw;
  const output=a=>Math.max(0,moveDamage(active,a.move)-(MOVES[a.move].dispel?0:foeActive.guard||0));
  const safe=damaging.filter(a=>(MOVES[a.move].recoil||0)<active.hp);
  const choices=safe.length?safe:damaging;
  // 4. Take a knockout when available.
  const ko = choices.find(a=>output(a)>=foeActive.hp);
  if (ko) return ko;

  // 5. Retreat a creature about to fall if a healthier reserve exists.
  const threat = Math.max(...CARDS[foeActive.id].moves.map((m) => moveDamage(foeActive, m)), 0);
  const freeSwap=trainers.find(a=>trainerId(a)==='switch' && active.hp<=threat && me.bench[a.bench].hp>threat);
  if(freeSwap)return freeSwap;
  const retreats = of('retreat');
  if (retreats.length && active.hp <= threat && rand() < 0.5) {
    const best = retreats.map((a) => ({ a, c: me.bench[a.bench] })).sort((x, y) => y.c.hp - x.c.hp)[0];
    if (best.c.hp > threat) return best.a;
  }

  // 6. Sometimes charge up when it will not let us take a knockout this turn.
  const charge = attacks.find((a) => MOVES[a.move].kind === 'charge');
  if (charge && active.hp > threat && rand() < 0.35) return charge;

  // 7. Hit as hard as possible.
  const guard=attacks.find(a=>MOVES[a.move].kind==='guard');
  if(guard && active.hp<=threat && !foeActive.charged && rand()<.24)return guard;
  const utility=a=>{
    const m=MOVES[a.move];
    return output(a)+Math.min(m.drain||0,active.maxHp-active.hp)+(foeActive.hex?0:m.delayed||0)
      -(m.recoil||0)*1.15-(m.recoil && active.hp-m.recoil<=threat?10:0)+(m.dispel && foeActive.charged?14:0)
      +(m.pivot && active.hp<=threat && me.bench[a.bench].hp>threat?18:0);
  };
  if(choices.length)return choices.sort((a,b)=>utility(b)-utility(a))[0];
  return legal.find((a) => a.type === 'endTurn') || legal[0];
}
