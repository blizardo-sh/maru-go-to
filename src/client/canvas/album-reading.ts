import { Container, Graphics, Rectangle } from 'pixi.js';
import { japanese, label, type JapaneseValue } from './canvas';
import { jp } from './study-surface';
import type { StudyAction, StudySurface } from './study-surface';

// Long reference and analysis text scrolls inside the existing page; practice choices never use this view.
export function renderReading(surface: StudySurface, text: string, state: { scroll: number }, options: { title?: string; actions?: StudyAction[]; back: StudyAction; safe: (action: StudyAction) => StudyAction; changed: () => void }) {
  const a = surface.body, heading = options.title ? surface.measure(options.title, a.width - 16, 20) + 16 : 8;
  if (options.title) surface.text(options.title, { x: a.x + 8, y: a.y + 8, width: a.width - 16, height: heading - 8 }, 20);
  const actions = options.actions ?? [], actionSpace = actions.length ? 52 : 0;
  const viewport = { x: a.x + 8, y: a.y + heading, width: a.width - 16, height: a.height - heading - 8 - actionSpace };
  const height = surface.measure(text, viewport.width, 17), maximum = Math.max(0, height - viewport.height);
  state.scroll = Math.max(0, Math.min(state.scroll, maximum));
  const copy = surface.text(text, { ...viewport, y: viewport.y - state.scroll, height: Math.max(height, viewport.height) }, 17);
  const mask = new Graphics().rect(viewport.x, viewport.y, viewport.width, viewport.height).fill('#ffffff');
  surface.root.addChild(mask); copy.mask = mask; copy.label = 'scrolling-copy';
  const move = (delta: number) => { state.scroll = Math.max(0, Math.min(maximum, state.scroll + delta)); options.changed(); };
  const touch = new Graphics().rect(viewport.x, viewport.y, viewport.width, viewport.height).fill({ color: '#ffffff', alpha: .001 });
  touch.eventMode = 'static'; touch.hitArea = new Rectangle(viewport.x, viewport.y, viewport.width, viewport.height);
  touch.on('wheel', event => { move(event.deltaY); }); surface.root.addChild(touch);
  if (actions.length) surface.row(actions.map(options.safe), { x: a.x, y: a.y + a.height - 44, width: a.width, height: 44 });
  surface.footer([
    { id: 'reading-up', text: '↑', accessibleLabel: 'Прокрутить текст вверх', enabled: state.scroll > 0, run: () => move(-viewport.height * .7) },
    { ...options.back, fontSize: 16 },
    { id: 'reading-down', text: '↓', accessibleLabel: 'Прокрутить текст вниз', enabled: state.scroll < maximum, run: () => move(viewport.height * .7) },
  ].map(options.safe));
}

export function renderJapaneseReading(surface:StudySurface,values:JapaneseValue[],state:{scroll:number},options:{title:string;vertical?:boolean;back:StudyAction;safe:(action:StudyAction)=>StudyAction;changed:()=>void}){
  const a=surface.body,heading=surface.measure(options.title,a.width-16,20)+16;
  surface.text(options.title,{x:a.x+8,y:a.y+8,width:a.width-16,height:heading-8},20);
  const viewport={x:a.x+8,y:a.y+heading,width:a.width-16,height:a.height-heading-8};
  const group=new Container();let height=0;
  if(options.vertical){
    values.forEach((value,column)=>{
      const x=viewport.width-(column+1)*Math.min(76,viewport.width/values.length);let y=8;
      const segments=surface.script==='kana'?[{surface:value.kana}]:value.segments;
      for(const segment of segments){
        const chars=Array.from(segment.surface),ruby=surface.script==='furigana'&&segment.reading?Array.from(segment.reading):[];
        const span=Math.max(chars.length*29,ruby.length*13);
        chars.forEach((char,index)=>{const top=y+(span-chars.length*29)/2+index*29,glyph=label(group,char,x,top,24,{fontFamily:jp});if(char==='ー'){glyph.anchor.set(.5);glyph.position.set(x+12,top+14);glyph.rotation=Math.PI/2;}});
        ruby.forEach((char,index)=>label(group,char,x+27,y+(span-ruby.length*13)/2+index*13,12,{fontFamily:jp}));
        y+=span;
      }
      height=Math.max(height,y+12);
    });
  }else for(const value of values){const result=japanese(group,value,surface.script,{x:0,y:height,width:viewport.width,height:10000},24,jp);height+=result.height+20;if(result.overflow)surface.problems.push('Reading ruby exceeds its width');}
  const maximum=Math.max(0,height-viewport.height);state.scroll=Math.max(0,Math.min(maximum,state.scroll));group.position.set(viewport.x,viewport.y-state.scroll);surface.root.addChild(group);
  const mask=new Graphics().rect(viewport.x,viewport.y,viewport.width,viewport.height).fill('#ffffff');surface.root.addChild(mask);group.mask=mask;
  surface.texts.push({value:values.map(value=>surface.script==='kana'?value.kana:value.surface).join('\n'),rect:viewport,size:24});
  const move=(delta:number)=>{state.scroll=Math.max(0,Math.min(maximum,state.scroll+delta));options.changed();};
  const touch=new Graphics().rect(viewport.x,viewport.y,viewport.width,viewport.height).fill({color:'#ffffff',alpha:.001});touch.eventMode='static';touch.hitArea=new Rectangle(viewport.x,viewport.y,viewport.width,viewport.height);touch.on('wheel',event=>move(event.deltaY));surface.root.addChild(touch);
  surface.footer([{id:'reading-up',text:'↑',accessibleLabel:'Предыдущий фрагмент',enabled:state.scroll>0,run:()=>move(-viewport.height*.7)},options.back,{id:'reading-down',text:'↓',accessibleLabel:'Следующий фрагмент',enabled:state.scroll<maximum,run:()=>move(viewport.height*.7)}].map(options.safe));
}
