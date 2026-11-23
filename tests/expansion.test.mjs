import assert from 'node:assert/strict';
import test from 'node:test';
import {teamMatch,TEAMS} from '../src/rules/data.js';
import {applyAction,createMatch,viewFor,eventsFor} from '../src/rules/engine.js';
import {chooseAction} from '../src/rules/ai.js';
const setup=(a,b)=>createMatch(teamMatch(19,a,b));
const act=(s,seat,action)=>{const r=applyAction(s,seat,action);assert.ok(r.ok,r.error);return r.state;};
test('preset shuffle reproduces a match, preserving private draws and search',()=>{
  assert.deepEqual(teamMatch(7),teamMatch(7));
  const s=setup('bloom','tide'),p=s.players[0],card=p.hand.find(c=>c.id==='pokeBall');
  const r=applyAction(s,0,{type:'trainer',card:card.uid});assert.ok(r.ok);
  const draw=r.events.find(e=>e.type==='draw');assert.ok(draw.id);
  assert.equal(eventsFor(r.events,1).find(e=>e.type==='draw').id,null);
  assert.equal(viewFor(r.state,1).players[0].searchable,undefined);
  assert.equal(r.state.current,0);assert.equal(r.state.players[0].potionsUsed,1);
});
test('X Attack, Switch and wrong targets preserve turn and card identity',()=>{
  let s=setup('coil','rush');let p=s.players[0];let card=p.hand.find(c=>c.id==='xAttack');
  assert.equal(applyAction(s,0,{type:'trainer',card:card.uid,target:'bad'}).state,s);
  s=act(s,0,{type:'trainer',card:card.uid,target:p.active.uid});assert.equal(s.players[0].active.charged,true);
  s=act(s,0,{type:'attack',move:'thunderShock'});assert.equal(s.players[1].active.hp,20);
  p=s.players[1];card=p.hand.find(c=>c.id==='switch');
  assert.equal(applyAction(s,1,{type:'trainer',card:card.uid,bench:2}).state,s);
  s=act(s,1,{type:'trainer',card:card.uid,bench:0});assert.equal(s.players[1].bench[0].hp,20);assert.equal(s.current,1);
});
test('guard, dispel, drain, pivot and bench-bound Hex',()=>{
  let s=setup('tide','bloom');s=act(s,0,{type:'attack',move:'withdraw'});
  s=act(s,1,{type:'attack',move:'vineWhip'});assert.equal(s.players[0].active.hp,50);assert.equal(s.players[0].active.guard,0);
  s=act(s,0,{type:'attack',move:'waterGun'});s=act(s,1,{type:'attack',move:'absorb'});assert.equal(s.players[1].active.hp,50);
  s.players[0].active.id='psyduck';s.players[1].active.guard=20;s.players[1].active.charged=true;
  s=act(s,0,{type:'attack',move:'confusion'});assert.equal(s.players[1].active.hp,40);assert.equal(s.players[1].active.charged,false);
  s.players[1].active.id='gastly';s=act(s,1,{type:'attack',move:'hex'});s.players[0].active.id='eevee';
  const prev=s.players[0].active.hp;s=act(s,0,{type:'attack',move:'batonPass',bench:0});assert.equal(s.players[0].bench[0].hp,prev-15);assert.equal(s.players[0].bench[0].hex,undefined);
});
test('double knockout awards both scores, promotes in order and starts exactly one turn',()=>{
  let s=setup('rush','tide');s.players[0].active.hp=10;s.players[1].active.hp=30;
  s=act(s,0,{type:'attack',move:'takeDown'});assert.deepEqual(s.players.map(p=>p.score),[1,1]);
  s=act(s,1,{type:'promote',bench:0});assert.equal(s.pendingPromote,0);
  s=act(s,0,{type:'promote',bench:0});assert.equal(s.turn,2);assert.equal(s.current,1);
});
test('every ordered preset pairing finishes for multiple reproducible seeds',()=>{
  const report={};
  for(const a of Object.keys(TEAMS))for(const b of Object.keys(TEAMS)){
    const turns=[];let wins=0;
    for(let seed=1;seed<=32;seed++){
      let s=createMatch(teamMatch(seed,a,b)),n=seed;
      const rand=()=>((n=(Math.imul(1664525,n)+1013904223)>>>0)/4294967296);
      for(let i=0;i<160 && s.phase!=='over';i++){
        const seat=s.phase==='promote'?s.pendingPromote:s.current;
        const action=chooseAction(viewFor(s,seat),seat,{},rand);
        assert.ok(action);s=act(s,seat,action);
      }
      assert.equal(s.phase,'over',a+' vs '+b);turns.push(s.turn);wins+=s.winner===0;
      const repeated=act(s,0,{type:'rematch'});assert.deepEqual(repeated.setup,s.setup);
      const fresh=act(s,0,{type:'newMatch'});assert.notEqual(fresh.setup.seed,s.setup.seed);
    }
    turns.sort((x,y)=>x-y);report[a+'/'+b]={wins,median:(turns[15]+turns[16])/2,max:turns.at(-1)};
  }
  console.log('Matchup results',JSON.stringify(report));
});

test('failed search and repeated boost preserve the trainer and allow a different target',()=>{
  const state=setup('bloom','rush'),p=state.players[0],ball=p.hand.find(c=>c.id==='pokeBall');
  p.deck=p.deck.filter(c=>!c.hp);
  for(const s of [state,viewFor(state,0)]){
    const r=applyAction(s,0,{type:'trainer',card:ball.uid});
    assert.equal(r.ok,false);assert.equal(r.state,s);assert.ok(p.hand.includes(ball));
  }
  const boosted=setup('coil','tide'),me=boosted.players[0],x=me.hand.find(c=>c.id==='xAttack');
  me.active.charged=true;
  const r=applyAction(boosted,0,{type:'trainer',card:x.uid,target:me.active.uid});
  assert.equal(r.ok,false);assert.equal(r.state,boosted);
  const good=act(boosted,0,{type:'trainer',card:x.uid,target:me.bench[0].uid});
  assert.ok(good.players[0].bench[0].charged);
});
test('simultaneous final knockouts go to defender and rematch clears both effects',()=>{
  let s=setup('rush','bloom');s.players.forEach(p=>{p.score=2;p.active.hp=10;});
  s=act(s,0,{type:'attack',move:'takeDown'});assert.equal(s.winner,1);
  const next=act(s,0,{type:'rematch'});assert.deepEqual(next.players.map(p=>p.score),[0,0]);
  assert.equal(next.players[0].active.hp,50);assert.equal(next.turn,1);
});
