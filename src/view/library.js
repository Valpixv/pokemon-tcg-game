import {CARDS,MOVES,TEAMS} from '../rules/data.js';
import {cardFaceTexture} from './cards.js';

export function setupLibrary(artReady,startTeam) {
  const get=id=>document.getElementById(id),dialog=get('library'),body=get('libraryBody');
  const element=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
  const button=(label,fn)=>{const b=element('button',label);b.onclick=fn;return b;};
  const portrait=id=>{const img=element('img');img.src=import.meta.env.BASE_URL+'pokemon/'+CARDS[id].art+'.png';img.alt=CARDS[id].name;return img;};
  const open=title=>{get('libraryTitle').textContent=title;body.replaceChildren();if(!dialog.open)dialog.showModal();};
  get('closeLibrary').onclick=()=>dialog.close();
  Object.entries(TEAMS).forEach(([key,t])=>get('hostTeam').add(new Option(t.name,key)));
  get('btnTeams').onclick=()=>{
    open('Choose a team');const grid=element('div');grid.className='teams';body.append(grid);
    const seed=document.createElement('input');seed.type='number';seed.min='0';seed.max='4294967295';seed.placeholder='Random';seed.style.width='110px';
    const label=element('label','Match seed ');label.append(seed);
    const play=id=>{if(!seed.reportValidity())return;dialog.close();startTeam(id,seed.value===''?undefined:seed.valueAsNumber);};
    for(const [id,t] of Object.entries(TEAMS)){
      const b=button('',()=>play(id));
      t.roster.forEach(c=>b.append(portrait(c)));b.append(element('strong',t.name),element('small',t.text));grid.append(b);
    }
    const footer=element('footer');footer.append(button('Surprise me',()=>play(null)),label);body.append(footer);
  };
  let query='',type='',page=0;
  function details(id){
    const c=CARDS[id];open(c.name);const panel=element('div');panel.className='details';
    const canvas=cardFaceTexture(id).image.cloneNode();canvas.getContext('2d').drawImage(cardFaceTexture(id).image,0,0);
    const info=element('section');
    info.append(element('p',c.blurb||c.text));
    for(const m of c.moves||[])info.append(element('strong',MOVES[m].name),element('p',MOVES[m].text));
    const presets=Object.values(TEAMS).filter(t=>t.roster.includes(id)||c.kind==='trainer');
    info.append(element('p',presets.map(t=>t.name).join(' · ')),button('Back to cards',collection));
    panel.append(canvas,info);body.append(panel);
  }
  function collection(){
    open('Card collection');const tools=element('div');tools.className='tools';
    const search=element('input');search.type='search';search.placeholder='Search cards';search.setAttribute('aria-label','Search cards');search.value=query;
    const select=element('select');select.ariaLabel='Card type';select.add(new Option('All types',''));
    const names={shadow:'Flying',spore:'Poison',stone:'Ground / Rock',ghost:'Ghost',normal:'Normal',electric:'Electric',water:'Water',fire:'Fire',grass:'Grass',trainer:'Trainer'};
    Object.entries(names).forEach(([k,v])=>select.add(new Option(v,k)));select.value=type;tools.append(search,select);
    const grid=element('div');grid.className='collection';const footer=element('footer');body.append(tools,grid,footer);
    const draw=()=>{
      const ids=Object.keys(CARDS).filter(k=>(!type||CARDS[k].type===type)&&CARDS[k].name.toLowerCase().includes(query.toLowerCase()));
      const pages=Math.max(1,Math.ceil(ids.length/6));page=Math.min(page,pages-1);
      grid.replaceChildren();for(const id of ids.slice(page*6,page*6+6)){
        const b=button('',()=>details(id));b.append(portrait(id),element('span',CARDS[id].name));grid.append(b);
      }
      if(!ids.length)grid.append(element('p','No matching cards.'));
      const prev=button('Previous',()=>{page--;draw();}),next=button('Next',()=>{page++;draw();});
      prev.disabled=page===0;next.disabled=page+1===pages;footer.replaceChildren(prev,element('span',`${page+1} / ${pages}`),next);
    };
    search.oninput=()=>{query=search.value;page=0;draw();};select.onchange=()=>{type=select.value;page=0;draw();};draw();
    const credits=element('a','Model credits and licenses');credits.className='credits';credits.href=import.meta.env.BASE_URL+'models/CREDITS.txt';credits.target='_blank';credits.rel='noopener';body.append(credits);
  }
  get('btnCollection').onclick=async()=>{await artReady;collection();};
}
