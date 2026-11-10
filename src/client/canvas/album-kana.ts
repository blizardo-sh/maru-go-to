import { Assets, Rectangle, Sprite, Texture } from 'pixi.js';
import { katakana } from '@app/shared/kana';
import { kanaMnemonic, kanaMnemonicFrame } from '@app/shared/kana-mnemonics';
import { ratingOptions } from '@app/client/review-ratings';
import type { CourseCatalog } from '@app/shared/catalog';
import type { StudyAction, StudySurface } from './study-surface';
import { bookRows } from './album-book';
import type { KanaFlow } from './kana-flow';
import type { Rect } from './canvas';
const atlases = new Map<string, Texture | null>();
function mnemonicPicture(surface:StudySurface, glyph:string, rect:Rect, changed:()=>void){
 const mnemonic=kanaMnemonic(glyph);if(!mnemonic)return;
 if(!atlases.has(mnemonic.atlas)){atlases.set(mnemonic.atlas,null);void Assets.load<Texture>(`/assets/kana/${mnemonic.atlas}.png`).then(texture=>{atlases.set(mnemonic.atlas,texture);changed();}).catch(()=>{changed();});}
 const atlas=atlases.get(mnemonic.atlas);if(!atlas)return;
 const frame=kanaMnemonicFrame(mnemonic),{width,height}=frame;
 const texture=new Texture({source:atlas.source,frame:new Rectangle(frame.x,frame.y,width,height)});
 const sprite=new Sprite(texture);sprite.scale.set(Math.min(rect.width/width,rect.height/height));sprite.position.set(rect.x+(rect.width-sprite.width)/2,rect.y+(rect.height-sprite.height)/2);surface.root.addChild(sprite);
 sprite.once('destroyed',()=>texture.destroy(false));
}
export function renderKana(surface:StudySurface,flow:KanaFlow,catalog:CourseCatalog,state:{offset:number},options:{safe:(action:StudyAction)=>StudyAction;changed:()=>void;home:()=>void;prompt?:Rect;play?:(url:string)=>void}){
 const a=surface.body,footer=(actions:StudyAction[])=>surface.footer(actions.map(action=>options.safe({...action,fontSize:15})));
 if(flow.error){surface.text(flow.error,a,18);footer([{id:'kana-retry',text:flow.conflict?'Обновить карточки':'Повторить',run:()=>void(flow.conflict?flow.reloadConflict():flow.retry())},{id:'kana-home',text:'К разделам',run:options.home}]);return;}
 if(flow.showStats){bookRows(surface,'Кана · сохранено в аккаунте',flow.stats.filter(item=>item.attempts).map(item=>({id:'kana-stat:'+item.glyph,text:`${item.glyph} · ${item.attempts} ответов, ${item.errors} «Снова»${item.due?' · '+new Date(item.due).toLocaleDateString('ru-RU'): ' · практика'}`,run:()=>{}})),state,{safe:options.safe,changed:options.changed,back:()=>{flow.showStats=false;state.offset=0;options.changed();}});return;}
 if(flow.active&&flow.item){
  const item=flow.item, pair=options.prompt?surface.pairedPanels(options.prompt):null;
  const left=pair?.left??{...a,height:Math.min(140,a.height*.34)},right=pair?.right??{...a,y:a.y+left.height+8,height:a.height-left.height-8};
  surface.text(`${flow.introducing?'Знакомство':flow.mode==='practice'?'Практика':flow.mode==='learn'?'Новые знаки':'Повторение'} · ${flow.introducing?flow.introIndex+1:flow.completed+1} / ${flow.total}`,{...left,height:28},16,false,true);
  const prompt=item.direction==='sign-reading'?item.glyph:item.reading,size=Math.min(100,Math.max(28,Math.floor((left.height-38)/1.45)));
  surface.text(prompt,{...left,y:left.y+32,height:left.height-38},size,item.direction==='sign-reading',true);
  if(flow.revealed){
   const mnemonic=kanaMnemonic(item.glyph),answer=`${item.glyph} — ${item.reading}`;
   surface.text(answer,{...right,height:40},28,true,true);
   const hint=mnemonic?`${mnemonic.title}. ${mnemonic.hint}`:'Составной звук: прочитайте оба знака слитно.';
   const textSize=right.height<250?14:16,hintHeight=surface.measure(hint,right.width-16,textSize);
   const art={x:right.x+8,y:right.y+46,width:right.width-16,height:Math.max(0,right.height-hintHeight-58)};
   if(art.height>=40)mnemonicPicture(surface,item.glyph,art,options.changed);
   surface.text(hint,{x:right.x+8,y:right.y+right.height-hintHeight,width:right.width-16,height:hintHeight},textSize,false,true);
   if(flow.introducing)footer([{id:'kana-intro-next',text:flow.introIndex+1<flow.total?'Следующий знак':'Проверить себя',run:()=>flow.nextIntroduction()}]);
   else footer(ratingOptions(flow.mode==='practice'?{kind:'practice'}:item.schedule).map(option=>({id:option.id,text:flow.mode==='practice'?option.label:option.text,enabled:!flow.busy,run:()=>void flow.grade(option.rating)})));
  }else{
   surface.text('Вспомните ответ.\nМнемоника появится после раскрытия.',{...right,y:right.y+Math.max(0,(right.height-80)/2),height:80},17,false,true);
   footer([{id:'kana-reveal',text:'Раскрыть',accessibleLabel:'Раскрыть карточку',run:()=>flow.reveal()},{id:'kana-pause',text:'К рядам',run:()=>{flow.active=false;options.changed();}}]);
  }
  const audio=catalog.kanaAudio?.entries[item.glyph];
  if(pair&&flow.revealed)surface.row([{id:'kana-pause',text:'К рядам',run:()=>{flow.active=false;options.changed();}},...(audio&&'audioUrl' in audio&&options.play?[{id:'kana-audio',text:'▶ Прослушать',run:()=>options.play!(audio.audioUrl)}]:[])].map(options.safe),pair.leftActions);
  return;
 }
 if(flow.active&&!flow.item){
  surface.text(flow.total?'Карточки пройдены':'На сейчас карточек нет',{...a,height:42},24,false,true);
  surface.text(flow.mode==='practice'?'Свободная тренировка завершена. Расписание сохранено.':`Ответы сохранены в аккаунте.${flow.nextDue?' Ближайший повтор: '+new Date(flow.nextDue).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})+'.':''}`,{...a,y:a.y+58,height:a.height-58},18);
  footer([{id:'kana-new',text:'К рядам',run:()=>flow.finish()},{id:'kana-due',text:`Повторить · ${flow.dueCount}`,enabled:flow.dueCount>0,run:()=>void flow.start(catalog,'review')}]);return;
 }
 const pair=options.prompt?surface.pairedPanels(options.prompt):null,left=pair?.left??a,right=pair?.right??a,compact=!pair;
 surface.text(compact||left.height<350?'Кана · карточки':'Кана · карточки и мнемоники',{...left,height:36},compact||left.height<350?18:24,false,true);
 const row=(actions:StudyAction[],y:number,rect=left)=>surface.row(actions.map(options.safe),{x:rect.x,y:rect.y+y,width:rect.width,height:44});
 row((['hiragana','katakana'] as const).map(script=>({id:'kana-script:'+script,text:script==='hiragana'?'Хирагана':'Катакана',selected:flow.script===script,enabled:!flow.queue.length,run:()=>{state.offset=0;flow.configure({script},catalog);}})),40);
 row([{id:'kana-direction',text:flow.direction==='sign-reading'?'Знак → чтение ⇄':'Чтение → знак ⇄',enabled:!flow.queue.length,run:()=>flow.configure({direction:flow.direction==='sign-reading'?'reading-sign':'sign-reading'},catalog)}],90);
 if(pair){
  const message=left.height<350?`К повторению: ${flow.dueCount}\nНовых в рядах: ${flow.selectedNew}`:`К повторению: ${flow.dueCount}\nНовых в выбранных рядах: ${flow.selectedNew}\n\nВыберите один или несколько рядов. «Учить» добавит до 20 новых карточек.\n\n«Повторы» покажут все назначенные знаки обеих азбук. «Практика» сохраняет сроки.`;
  surface.text(message,{...left,y:left.y+150,height:left.height-150},left.height<430?15:17);
  surface.row([{id:'kana-stats',text:'Статистика',run:()=>{flow.showStats=true;state.offset=0;options.changed();}},{id:'kana-home',text:'К тренажёрам',run:options.home}].map(options.safe),pair.leftActions);
 }
 const top=compact?140:0;
 row((['basic','voiced','yoon'] as const).map(group=>({id:'kana-group:'+group,text:(compact||right.width<400?{basic:'База',voiced:'゛ / ゜',yoon:'Ёон'}:{basic:'Основные',voiced:'С озвончением',yoon:'Ёон'})[group],accessibleLabel:({basic:'Основные знаки',voiced:'Дакутэн и хандакутэн',yoon:'Ёон'}[group])+(flow.group===group?', выбран':''),selected:flow.group===group,enabled:!flow.queue.length,fontSize:14,run:()=>{state.offset=0;flow.configure({group},catalog);}})),top,right);
 row([{id:'kana-all',text:flow.rows.length===catalog.kana[flow.group].length?'Снять выбор':'Все ряды',enabled:!flow.queue.length,run:()=>flow.configure({rows:flow.rows.length===catalog.kana[flow.group].length?[]:catalog.kana[flow.group].map((_,i)=>i)},catalog)},...(compact?[{id:'kana-stats',text:'Статистика',run:()=>{flow.showStats=true;state.offset=0;options.changed();}}]:[])],top+50,right);
 const rows=catalog.kana[flow.group],columns=right.width<250?1:2,gap=6,begin=top+102;
 const available=Math.floor((right.height-begin)/50)*columns,capacity=Math.max(columns,available>=rows.length?available:Math.floor((right.height-begin-50)/50)*columns);state.offset=Math.min(state.offset,Math.floor((rows.length-1)/capacity)*capacity);
 rows.slice(state.offset,state.offset+capacity).forEach((value,i)=>{
  const index=state.offset+i,selected=flow.rows.includes(index),glyphs=value.cells.flatMap(entry=>entry?[flow.script==='katakana'?katakana(entry.kana):entry.kana]:[]).join(right.width<330?'':' ');
  surface.action(options.safe({id:'kana-row:'+index,text: `${selected&&right.width>=330?'✓ ':''}${glyphs}`,accessibleLabel:`Ряд ${glyphs}${selected?', выбран':''}`,selected,enabled:!flow.queue.length,run:()=>flow.configure({rows:selected?flow.rows.filter(row=>row!==index):[...flow.rows,index]},catalog)}),{x:right.x+(i%columns)*(right.width+gap)/columns,y:right.y+begin+Math.floor(i/columns)*50,width:(right.width-gap*(columns-1))/columns,height:44},true,17);
 });
 if(rows.length>capacity)row([{id:'kana-prev',text:'←',enabled:state.offset>0,run:()=>{state.offset-=capacity;options.changed();}},{id:'kana-next',text:'→',enabled:state.offset+capacity<rows.length,run:()=>{state.offset+=capacity;options.changed();}}],right.height-44,right);
 footer(flow.queue.length?[{id:'kana-resume',text:'Продолжить',run:()=>{flow.active=true;options.changed();}},{id:'kana-end',text:'Завершить',run:()=>flow.finish()}]:[
  {id:'kana-due',text:a.width<330?'Повторы':`Повторы · ${flow.dueCount}`,accessibleLabel:`Повторить · ${flow.dueCount} карточек`,enabled:flow.dueCount>0,run:()=>void flow.start(catalog,'review')},
  {id:'kana-start',text:a.width<330?'Учить':`Учить · ${flow.selectedNew}`,accessibleLabel:`Учить · ${flow.selectedNew} новых знаков`,enabled:flow.selectedNew>0,run:()=>void flow.start(catalog,'learn')},
  {id:'kana-practice',text:'Практика',enabled:flow.entries(catalog).length>0,run:()=>void flow.start(catalog,'practice')},
 ]);
}
