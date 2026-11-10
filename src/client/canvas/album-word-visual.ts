import { Assets, Rectangle, Sprite, Texture } from 'pixi.js';
import { visualWordTitle, type VisualWordCard, type VisualWordMode } from '@app/shared/word-cards';
import type { StudyAction, StudySurface } from './study-surface';
import type { PrototypeLayout } from './prototype-layouts';

const atlases=new Map<string,Texture|'loading'|'error'>();
let activeAtlas='';
function keepRecentAtlases(){
 const loaded=[...atlases].filter((entry):entry is [string,Texture]=>entry[1] instanceof Texture);
 for(const [src] of loaded.slice(0,Math.max(0,loaded.length-4)))if(src!==activeAtlas){atlases.delete(src);void Assets.unload(src).catch(()=>{});}
}
export const visualWordImageReady=(card:VisualWordCard)=>atlases.get(card.image.src) instanceof Texture;
export function renderVisualWord(surface:StudySurface,view:PrototypeLayout,card:VisualWordCard,mode:VisualWordMode,revealed:boolean,actions:StudyAction[],audio:StudyAction|null,changed:()=>void) {
 const pair=view.prompt?surface.pairedPanels(view.prompt):null,a=surface.body;
 const prompt=pair?.left??{...a,height:revealed?Math.min(146,a.height*.36):a.height};
 const answer=pair?.right??{...a,y:a.y+prompt.height+8,height:a.height-prompt.height-8};
 const pictureArea=mode==='picture-word'&&!revealed?prompt:answer;
 const showImage=mode==='picture-word'||revealed;
 activeAtlas=card.image.src;
 let texture=atlases.get(card.image.src);
 if(texture instanceof Texture){atlases.delete(card.image.src);atlases.set(card.image.src,texture);}
 if(showImage&&!texture){atlases.set(card.image.src,'loading');void Assets.load<Texture>(card.image.src).then(value=>{atlases.set(card.image.src,value);keepRecentAtlases();changed();}).catch(()=>{atlases.set(card.image.src,'error');changed();});texture='loading';}
 const title=visualWordTitle(mode);
 const heading=audio&&!pair?48:32;
 surface.text(title,{...prompt,width:prompt.width-(audio&&!pair?48:0),height:heading},16,false,true);
 if(audio&&!pair)surface.action({...audio,text:'▶',accessibleLabel:'Прослушать слово'},{x:prompt.x+prompt.width-44,y:prompt.y,width:44,height:44});
 if(mode==='word-meaning'||revealed)surface.japanese(card,{...prompt,y:prompt.y+heading,height:prompt.height-heading-4},60,'center','furigana');
 if(showImage){
  const width=pictureArea.width-20,textSize=pictureArea.height<280?14:16;
  const caption=revealed?card.captionRu:'Назовите изученное слово по-японски.';
  const captionHeight=surface.measure(caption,width,textSize);
  const separateMeaning=revealed&&!caption.includes(card.meaningRu);
  const meaningHeight=separateMeaning?surface.measure(card.meaningRu,width,textSize)+8:0;
  if(separateMeaning)surface.text(card.meaningRu,{x:pictureArea.x+10,y:pictureArea.y,width,height:meaningHeight-8},textSize,false,true);
  const area={x:pictureArea.x+10,y:pictureArea.y+meaningHeight+(mode==='picture-word'&&!revealed?34:0),width,height:pictureArea.height-captionHeight-meaningHeight-12-(mode==='picture-word'&&!revealed?34:0)};
  if(texture instanceof Texture){const [x,y,w,h]=card.image.viewBox.split(/\s+/).map(Number) as [number,number,number,number];const cropped=new Texture({source:texture.source,frame:new Rectangle(x,y,w,h)});const sprite=new Sprite(cropped);sprite.scale.set(Math.min(area.width/w,area.height/h));sprite.position.set(area.x+(area.width-sprite.width)/2,area.y+(area.height-sprite.height)/2);sprite.once('destroyed',()=>cropped.destroy(false));surface.root.addChild(sprite);}
  else surface.text(texture==='error'?'Картинку не удалось загрузить':'Загружаем картинку…',{...area,y:area.y+Math.max(0,(area.height-48)/2),height:48},16,false,true);
  surface.text(caption,{x:pictureArea.x+10,y:pictureArea.y+pictureArea.height-captionHeight,width,height:captionHeight},textSize,false,true);
 }
 if(pair&&!revealed)surface.text('Вспомните и раскройте ответ.',{...answer,y:answer.y+answer.height*.4,height:80},18,false,true);
 if(revealed&&pair&&audio)surface.row([audio],pair.leftActions);
 if(showImage&&texture==='error')surface.footer([{id:'word-art-retry',text:'Загрузить картинку',run:()=>{atlases.delete(card.image.src);changed();}}]);
 else surface.footer(actions.map(action=>({...action,fontSize:15,enabled:action.enabled!==false&&(!showImage||texture instanceof Texture)})));
}
