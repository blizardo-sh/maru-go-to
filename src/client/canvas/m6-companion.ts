import { Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import type { PrototypeLayout } from './prototype-layouts';
import type { CardActivity, SavedFeedback } from '@app/client/companion';
import metadata from '../../../assets/canvas/m6-repertoire-v1/manifest.json';
import walkUrl from '../../../assets/canvas/m6-v4/whole-cat-atlas.webp';
import { WholeCatAnimation } from './m6-whole-cat';
import { wholeCatMotion } from './m6-whole-motion';
import { M6Textures } from './m6-textures';
import { M6Events, variantFor } from './m6-events';
const files=import.meta.glob<string>('../../../assets/canvas/m6-repertoire-v1/*.webp',{eager:true,query:'?url',import:'default'});
type Family=keyof typeof metadata.families;
export type M6Reaction='idle'|'card'|'entry'|'listening'|'revealed'|'good'|'again'|'wrong'|'thinking'|'checking'|'draft-correct'|'editing'|'neutral'|'pet'|'complete';
const families: Partial<Record<M6Reaction,Family>>={card:'point',listening:'listen',revealed:'point',again:'support',wrong:'support',thinking:'think',checking:'think','draft-correct':'nod',editing:'eyes',pet:'pet',complete:'farewell'};
const messages: Partial<Record<M6Reaction,string>>={good:'Получилось!',again:'Вернёмся к слову.',revealed:'Сравни с ответом.','draft-correct':'Черновик верный.',checking:'Проверяем…',pet:'Я рядом.',complete:'Спасибо за занятие!'};
export class M6Companion {
  readonly root=new Container();
  private sprite:Sprite; private shadow=new Graphics(); private accent=new Graphics();
  private pool=new M6Textures();private frameTextures:Texture[]=[];private walk?:WholeCatAnimation;
  private epoch=0;private disposed=false;private family='';private wanted='';private active='';private started=0;private lastIdle=0;private idleIndex=0;
  private origin={x:0,y:0};private size=128;private followAmount=0;
  private activity:M6Reaction='idle';private variant=0;private message='';private currentFrame=0;private state:'ready'|'loading'|'unavailable'='ready';
  private presentationActive=false;private retryStill=false;private external='';private visible=true;private speech=false;
  constructor(private neutral:Texture,private render:()=>void,private reduced:()=>boolean,private ledger:M6Events,private petSound:()=>void) {
    this.sprite=new Sprite(neutral);this.sprite.anchor.set(.5,244/256);this.root.addChild(this.shadow,this.sprite,this.accent);
    this.root.eventMode='static';this.root.cursor='pointer';this.root.accessible=true;this.root.accessibleType='button';this.root.accessiblePointerEvents='none';
    this.root.on('pointertap',()=>{if(!this.presentationActive||!this.ledger.owner)return;if(this.cinematic)this.skip();else if(!this.speech){this.petSound();this.react('pet');}});
  }
  setActive(value:boolean){if(!value&&this.presentationActive)this.quiet();this.presentationActive=value;}
  get unavailable(){return this.state==='unavailable';}
  get cinematic(){return this.activity==='entry'||this.activity==='complete';}
  bind(cat:Sprite,feet:number,view:PrototypeLayout){cat.visible=false;this.size=view.low?0:view.wide||view.width>=600?128:88;this.visible=this.size>0;this.root.visible=this.visible;this.origin={x:cat.x+this.size/2,y:feet};this.sprite.width=this.size;this.sprite.height=this.size;this.walk?.resize(this.size);this.root.hitArea=new Rectangle(-Math.max(44,this.size)/2,-Math.max(44,this.size),Math.max(44,this.size),Math.max(44,this.size));this.position(0);}
  context(owner:string|null,scope:string){this.root.eventMode=owner?'static':'none';this.root.accessible=!!owner;this.root.cursor=owner?'pointer':'default';if(this.ledger.bind(owner,scope)){this.external='';this.quiet();if(owner&&!/^(lessons|settings|book|reference|admin):/.test(scope))this.react('card');}}
  activityEvent(value:CardActivity){if(this.ledger.activity(value)){this.external=value.activity;if (['good','again','complete','card','entry'].includes(this.activity) && ['idle','revealed','draft-correct','editing'].includes(value.activity)) return;this.react(value.activity==='idle'?'idle':value.activity);}}
  saved(value:SavedFeedback){if(!this.ledger.saved(value))return false;this.variant=variantFor(value.attemptId);if(this.presentationActive&&!this.speech)this.react(value.kind);return true;}
  complete(key:string){if(!this.ledger.complete(key))return false;if(this.presentationActive&&!this.speech)this.react('complete');return true;}
  update(key:string,activity:M6Reaction){if(key===this.external)return;this.external=key;this.react(activity);}
  setSpeech(value:boolean){if(value===this.speech)return;this.speech=value;if(value)this.react('listening');else if(this.activity==='listening')this.quiet();}
  react(activity:M6Reaction){
    if(this.disposed||!this.presentationActive)return;
    if(this.speech&&activity!=='listening')return;
    this.retryStill=false;this.activity=activity;this.message=messages[activity]??'';this.started=performance.now()/1000;this.lastIdle=this.started;this.family='';this.followAmount=0;
    this.root.accessibleTitle=this.cinematic?'Пропустить сценку с котом':'Погладить кота';this.root.accessibleHint=this.root.accessibleTitle;
    const family=activity==='good'?(['joy-paws','joy-hop','joy-pose'] as const)[this.variant]!:families[activity];
    if(activity==='entry')void this.loadFamily('stand');else if(family)void this.loadFamily(family);else this.clearFamily();
    this.render();
  }
  private clearFrames(){this.walk?.dispose();this.walk=undefined;this.frameTextures.forEach(t=>t.destroy(false));this.frameTextures=[];}
  private clearFamily(){this.family='';++this.epoch;this.clearFrames();this.sprite.texture=this.neutral;this.sprite.visible=true;this.wanted='';this.active='';this.pool.retain([]);this.state='ready';}
  private async loadFamily(family:Family|'walk'){
    if(this.family===family)return;this.family=family;const epoch=++this.epoch,url=family==='walk'?walkUrl:files[`../../../assets/canvas/m6-repertoire-v1/${family}.webp`]!;
    this.wanted=url;this.pool.retain([this.active,url].filter(Boolean));this.state='loading';
    try{const texture=await this.pool.load(url);if(this.disposed||epoch!==this.epoch)return;
      this.clearFrames();if(family==='walk'){this.walk=new WholeCatAnimation(texture);this.walk.resize(this.size);this.root.addChildAt(this.walk.root,2);this.sprite.visible=false;}
      else {const data=metadata.families[family];this.frameTextures=Array.from({length:data.frames},(_,i)=>new Texture({source:texture.source,frame:new Rectangle(i%data.columns*192,Math.floor(i/data.columns)*192,192,192)}));this.sprite.texture=this.frameTextures[0]!;this.sprite.visible=true;this.sprite.width=this.size;this.sprite.height=this.size;}
      this.active=url;this.state='ready';this.pool.retain([url]);this.render();
    }catch{if(!this.disposed&&epoch===this.epoch){this.state='unavailable';this.clearFrames();this.sprite.texture=this.neutral;this.sprite.visible=true;this.pool.retain([]);this.render();}}
  }
  tick(now:number){
    if(this.disposed||!this.visible||!this.presentationActive)return;const reduced=this.reduced(),t=Math.max(0,now-this.started);
    if(this.retryStill){const data=metadata.families[this.family as Family];if(data&&this.frameTextures.length){this.currentFrame=Math.floor(data.frames/2);this.sprite.texture=this.frameTextures[this.currentFrame]!;}this.position(0);return;}
    if(reduced){if(this.activity==='entry'){this.quiet();return;}const data=metadata.families[this.family as Family];if(data&&this.frameTextures.length){this.currentFrame=this.activity==='complete'?data.frames-1:Math.floor(data.frames/2);this.sprite.texture=this.frameTextures[this.currentFrame]!;}this.position(0);return;}
    if(this.state==='unavailable'){this.position(0);return;}
    if(this.activity==='entry'){
      const family=t<.65?'stand':t<3.7?'walk':'sit';void this.loadFamily(family);
      if(t>=4.35){this.quiet();return;}
      this.animate(family==='stand'?t:family==='walk'?t-.65:t-3.7);this.position(family==='stand'?-this.size*.15:family==='walk'?wholeCatMotion(t-.65).x*this.size/400-this.size*.15:0);
    }else if(this.activity!=='idle'){
      const family=this.family as Family, duration=metadata.families[family]?.seconds??1.2;
      this.animate(t);this.position(0);
      if(t>=duration){if(this.activity==='checking'||this.activity==='editing'||this.activity==='listening'&&this.speech){const data=metadata.families[family];if(data&&this.frameTextures.length){this.currentFrame=Math.floor(data.frames/2);this.sprite.texture=this.frameTextures[this.currentFrame]!;}return;}this.quiet();return;}
    }else{
      if(now-this.lastIdle>9){const sequence:Family[]=['blink','breathe','eyes','ears','blink','tail','stretch'];const family=sequence[this.idleIndex++%sequence.length]!;this.started=now;this.lastIdle=now;void this.loadFamily(family);}
      if(this.frameTextures.length){this.animate(now-this.started);const duration=metadata.families[this.family as Family]?.seconds??1;if(now-this.started>=duration)this.clearFamily();}
      this.position(0);
    }
  }
  private animate(t:number){if(this.walk){this.walk.update(t,false);return;}const data=metadata.families[this.family as Family];if(!data||!this.frameTextures.length)return;this.currentFrame=Math.min(data.frames-1,Math.floor(t/data.seconds*(data.frames-1)));this.sprite.texture=this.frameTextures[this.currentFrame]!;}
  private position(offset:number){
    let y=0;if(this.activity==='good'&&this.variant===1&&!this.reduced()){const p=(performance.now()/1000-this.started)/1.35;if(p>.32&&p<.72)y=-Math.sin((p-.32)/.4*Math.PI)*this.size*.08;}
    this.root.position.set(this.origin.x+offset,this.origin.y+y);this.shadow.clear().ellipse(0,-1,this.size*.26*(y? .8:1),this.size*.035).fill({color:0x563a27,alpha:.14});this.shadow.y=-y;
    this.accent.clear();if(this.activity==='good'&&!this.reduced()){const p=Math.min(1,(performance.now()/1000-this.started)/1.1),alpha=Math.sin(p*Math.PI)*.65;
      for(let i=0;i<3;i++){const x=this.size*(.33+i*.045),y=-this.size*(.6+i*.09);this.accent.moveTo(x,y).lineTo(x+this.size*.065,y-this.size*.045).stroke({color:0xc49a52,width:1.6,alpha});}}
  }
  follow(amount:number){if(this.activity==='idle'&&!this.reduced()&&Math.abs(amount)>.15&&Math.abs(this.followAmount)<.15){this.started=performance.now()/1000;this.lastIdle=this.started;void this.loadFamily('eyes');}this.followAmount=amount;}
  skip(){if(this.cinematic)this.quiet();}
  retry(){if(this.state==='unavailable'){const family=this.family as Family;this.family='';this.retryStill=true;void this.loadFamily(family);}}
  quiet(){if(this.disposed)return;this.retryStill=false;this.activity='idle';this.message='';this.lastIdle=performance.now()/1000;this.clearFamily();this.root.accessibleTitle='Погладить кота';this.root.accessibleHint='Погладить кота';this.position(0);}
  snapshot(){return{activity:this.activity,message:this.message,bubble:false,variant:this.variant,cinematic:this.cinematic,wholeCharacter:true,separateBodyParts:false,family:this.family,currentFrame:this.currentFrame,state:this.state,bounds:this.root.visible&&!this.sprite.destroyed&&!this.sprite.texture.destroyed?this.sprite.getBounds().rectangle:null,...this.ledger.snapshot(),...this.pool.snapshot()};}
  dispose(){if(this.disposed)return;this.disposed=true;++this.epoch;this.clearFrames();this.root.destroy({children:true,context:true,style:true});this.pool.dispose();}
}
