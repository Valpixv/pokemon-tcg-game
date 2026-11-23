// Editable game data. Every number the simulation, card faces, buttons and
// battle log use comes from here: change Bite to 15 damage and all of
// them follow.

export const MOVES = {
  fangSnap:   { name: 'Bite',   kind: 'damage', damage: 20, effect: 'fang',     text: 'A quick, biting lunge.' },
  sparkJab:   { name: 'Pika Punch',   kind: 'damage', damage: 20, effect: 'electric', text: 'A punch charged with electricity.' },
  charge:     { name: 'Charge',      kind: 'charge', bonus: 10,  effect: 'charge',   text: '+10 damage to the next attack. Does not stack.' },
  sporeCloud: { name: 'Suffocating Gas', kind: 'damage', damage: 20, effect: 'spores',   text: 'Envelops the target in a cloud of gas.' },
  rockToss:   { name: 'Rock Throw',   kind: 'damage', damage: 30, effect: 'rock',     text: 'Throws a rock at the target.' },
};

// Creature cards and trainer cards. `type` picks the card border colour.
export const CARDS = {
  gloomwing: { kind: 'creature', name: 'Zubat', art: 'zubat', dex: '041', type: 'shadow',   hp: 40, moves: ['fangSnap'],          hover: true,  blurb: 'It navigates dark caves by sending out ultrasonic waves.' },
  puffmire:  { kind: 'creature', name: 'Koffing', art: 'koffing', dex: '109',  type: 'spore',    hp: 60, moves: ['sporeCloud'],        hover: true,  blurb: 'Lighter-than-air gases keep its cratered body afloat.' },
  voltpip:   { kind: 'creature', name: 'Pikachu', art: 'pikachu', dex: '025',   type: 'electric', hp: 60, moves: ['sparkJab', 'charge'], hover: false, blurb: 'It stores electricity in the red pouches on its cheeks.' },
  pebblit:   { kind: 'creature', name: 'Geodude', art: 'geodude', dex: '074',   type: 'stone',    hp: 50, moves: ['rockToss'],          hover: false, blurb: 'Its powerful arms pull it over even the steepest mountain paths.' },
  potion:    { kind: 'trainer',  name: 'Potion', art: 'potion',    type: 'trainer',  heal: 20, text: 'Heal 20 damage from one of your Pokémon. One per turn.' },
};

export const TYPE_COLORS = {
  shadow:   { border: '#7a5cc9', fill: '#2b2140', accent: '#ffb347' },
  spore:    { border: '#79b85a', fill: '#24331d', accent: '#d7b8ff' },
  electric: { border: '#f4d23c', fill: '#3a3412', accent: '#fff6b0' },
  stone:    { border: '#b8946a', fill: '#352a1f', accent: '#9ff3e6' },
  trainer:  { border: '#cfd6e0', fill: '#283240', accent: '#7fe0ff' },
};

export const RULES = {
  benchSize: 3,
  knockoutsToWin: 3,
  potionsPerTurn: 1,
};

// Quick Battle setup. The opening matchup is preset; everything after it
// runs through the normal rules.
export const QUICK_BATTLE = {
  players: [
    { name: 'You',      active: 'gloomwing', bench: ['puffmire'], deck: ['potion', 'pebblit', 'gloomwing', 'potion'], hand: [] },
    { name: 'Opponent', active: 'voltpip',   bench: ['pebblit'],  deck: ['potion', 'voltpip', 'puffmire', 'potion'],  hand: [] },
  ],
};
const damageMove = (name,damage,effect,text,extra={}) => ({name,kind:'damage',damage,effect,text,...extra});
Object.assign(MOVES,{
  vineWhip: damageMove('Vine Whip',20,'vine','Strike with twin vines.'),
  absorb: damageMove('Absorb',10,'drain','Heal up to 10 HP after hitting.',{drain:10}),
  ember: damageMove('Ember',20,'ember','Launch a burning ember.'),
  takeDown: damageMove('Take Down',40,'contact','Also take 10 recoil damage.',{recoil:10}),
  waterGun: damageMove('Water Gun',20,'water','Fire a jet of water.'),
  withdraw:{name:'Withdraw',kind:'guard',bonus:10,effect:'guard',text:'Block 10 from the next hit. Persists on retreat.'},
  quickAttack: damageMove('Quick Attack',20,'contact','Bound forward and strike.'),
  batonPass: damageMove('Baton Pass',10,'contact','Choose a reserve. Hit, then switch.',{pivot:true}),
  lick: damageMove('Lick',20,'ghost','Strike with spectral energy.'),
  hex: damageMove('Hex',10,'ghost','Mark this card for 15 at the end of its next turn, even on the bench.',{delayed:15}),
  confusion: damageMove('Confusion',10,'psychic','Clear guard and charge before damage.',{dispel:true}),
  scratch: damageMove('Scratch',20,'contact','Rake with sharp claws.'),
  defenseCurl:{name:'Defense Curl',kind:'guard',bonus:20,effect:'guard',text:'Block 20 from the next hit. Persists on retreat.'},
  thunderShock: damageMove('Thunder Shock',20,'electric','Discharge through both magnetic poles.')
});
const additions=[
  ['bulbasaur','Bulbasaur','001','grass',60,['vineWhip','absorb'],'Trade burst damage for healing.'],
  ['charmander','Charmander','004','fire',50,['ember','takeDown'],'Risk recoil to finish a weakened rival.'],
  ['squirtle','Squirtle','007','water',60,['waterGun','withdraw'],'Protect its shell before a heavy hit.'],
  ['eevee','Eevee','133','normal',50,['quickAttack','batonPass'],'Attack while bringing a reserve forward.'],
  ['gastly','Gastly','092','ghost',50,['lick','hex'],'Its curse follows a retreating target.'],
  ['psyduck','Psyduck','054','water',60,['waterGun','confusion'],'Strip a defensive or electric boost.'],
  ['sandshrew','Sandshrew','027','stone',60,['scratch','defenseCurl'],'Absorb one heavy hit behind curled scales.'],
  ['magnemite','Magnemite','081','electric',50,['thunderShock','charge'],'Store a charge for the next discharge.']
];
for(const [id,name,dex,type,hp,moves,blurb] of additions) CARDS[id]={name,dex,type,hp,moves,blurb,art:id,kind:'creature'};
Object.assign(CARDS,{
  switch:{kind:'trainer',type:'trainer',name:'Switch',art:'escape-rope',text:'Swap with a living reserve and keep your turn. One Trainer per turn.'},
  pokeBall:{kind:'trainer',type:'trainer',name:'Poké Ball',art:'poke-ball',text:'Take the first Basic Pokémon from your deck into your hand. One Trainer per turn.'},
  xAttack:{kind:'trainer',type:'trainer',name:'X Attack',art:'x-attack',bonus:10,text:'Give one friendly Pokémon Charge (+10 on its next hit). Cannot stack. One Trainer per turn.'}
});
for(const [type,border,fill] of [['grass','#78b345','#35572f'],['fire','#f29a54','#873f32'],['water','#63bfdc','#29518a'],['ghost','#a797d6','#342950'],['normal','#dec197','#6d5749']]){
  TYPE_COLORS[type]={border,fill,accent:'#fff'};
}
export const TEAMS={
  rush:{name:'Flame Dash',text:'Push for knockouts, then pivot away from danger.',roster:['charmander','eevee','gloomwing'],trainer:'switch'},
  tide:{name:'Shell Guard',text:'Guard a heavy hit and strip enemy boosts.',roster:['squirtle','sandshrew','psyduck'],trainer:'potion'},
  bloom:{name:'Night Garden',text:'Heal your lead and mark enemies that retreat.',roster:['bulbasaur','gastly','puffmire'],trainer:'pokeBall'},
  coil:{name:'Magnetic Field',text:'Bank a charge and bring in a heavy finisher.',roster:['magnemite','voltpip','pebblit'],trainer:'xAttack'}
};
export function teamMatch(seed,home,away) {
  let n=seed>>>0;
  const pick=max=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return Math.floor(n/4294967296*max)};
  const keys=Object.keys(TEAMS);
  home=TEAMS[home]?home:keys[pick(keys.length)];
  const others=keys.filter(k=>k!==home);
  away=TEAMS[away]?away:others[pick(others.length)];
  const players=[home,away].map((id,seat)=>{
    const {roster,trainer}=TEAMS[id];
    const deck=[roster[2],roster[0],roster[1],'switch','potion','pokeBall','xAttack'];
    for(let i=deck.length-1;i>0;i--){const j=pick(i+1);[deck[i],deck[j]]=[deck[j],deck[i]];}
    return {name:seat?'Opponent':'You',active:roster[0],bench:[roster[1]],hand:[trainer,roster[2]],deck};
  });
  return {teams:[home,away],seed:seed>>>0,players};
}
