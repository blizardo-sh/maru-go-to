import { katakana } from '@app/shared/kana';
import { shuffledTokens } from '@app/client/study';
import { ApiRequestError } from '@app/client/api';
import { discardKanaConflict, loadKana, pendingKanaReviews, saveKanaReview } from '@app/client/kana-api';
import { kanaItemKey, type KanaStudyItem, type KanaDirection, type KanaScript, type KanaSubmission, type KanaMode } from '@app/shared/kana-study';
import type { CourseCatalog } from '@app/shared/catalog';
import type { Rating } from '@app/shared/types';
export class KanaFlow {
 script:KanaScript='hiragana';direction:KanaDirection='sign-reading';group:'basic'|'voiced'|'yoon'='basic';rows:number[]=[0];
 stats:KanaStudyItem[]=[];queue:KanaStudyItem[]=[];sessionId='';turn=0;total=0;completed=0;active=false;busy=false;error='';showStats=false;revealed=false;
 introducing=false;introIndex=0;
 mode:KanaMode='learn';dueCount=0;nextDue:string|null=null;conflict=false;
 last:{attemptId:string;kind:'good'|'again'}|null=null;
 private unresolved:KanaSubmission|null=null;private rejected:KanaSubmission|null=null;
 private owner='';private epoch=0;private wake?:ReturnType<typeof setTimeout>;
 constructor(private changed:()=>void){}
 clear(){clearTimeout(this.wake);this.epoch++;this.owner='';this.script='hiragana';this.direction='sign-reading';this.group='basic';this.stats=[];this.queue=[];this.sessionId='';this.turn=0;this.total=0;this.completed=0;this.active=false;this.busy=false;this.error='';this.showStats=false;this.last=null;this.rows=[0];this.unresolved=null;this.revealed=false;this.dueCount=0;this.nextDue=null;this.conflict=false;this.rejected=null;this.introducing=false;this.introIndex=0;}
 get item(){return this.queue[this.introducing?this.introIndex:0];}
 nextIntroduction(){if(this.busy||!this.introducing)return;this.introIndex++;this.turn++;if(this.introIndex>=this.queue.length){this.introducing=false;this.revealed=false;this.introIndex=0;}this.changed();}
 get selectedNew(){return this.stats.filter(item=>!item.due&&this.selectedGlyphs.has(item.glyph)).length;}
 private selectedGlyphs=new Set<string>();
 async boot(owner:string,catalog:CourseCatalog,initialScript?:KanaScript){
  if(this.owner!==owner){this.clear();this.owner=owner;try{const saved=JSON.parse(localStorage.getItem('japanese-kana-settings:'+owner)??'null');if(saved&&['hiragana','katakana'].includes(saved.script)&&['sign-reading','reading-sign'].includes(saved.direction)&&['basic','voiced','yoon'].includes(saved.group)&&Array.isArray(saved.rows)&&saved.rows.every((row:unknown)=>Number.isInteger(row)&&Number(row)>=0)){this.script=saved.script;this.direction=saved.direction;this.group=saved.group;this.rows=saved.rows;}}catch{this.error='Не удалось прочитать настройки каны.';this.changed();return;}if(initialScript)this.script=initialScript;}
  this.entries(catalog);await this.retry();
 }
 configure(change:Partial<Pick<KanaFlow,'script'|'direction'|'group'|'rows'>>,catalog:CourseCatalog){
  if(this.busy||this.queue.length)return;
  const next={script:this.script,direction:this.direction,group:this.group,rows:this.rows,...change};if(change.group)next.rows=[0];
  try{localStorage.setItem('japanese-kana-settings:'+this.owner,JSON.stringify(next));Object.assign(this,next);this.total=0;this.completed=0;this.entries(catalog);this.error='';if(change.script||change.direction)void this.retry();}catch{this.error='Не удалось сохранить выбор рядов.';}this.changed();
 }
 entries(catalog:CourseCatalog){const entries=catalog.kana[this.group].flatMap((row,index)=>this.rows.includes(index)?row.cells.filter((entry):entry is NonNullable<typeof entry>=>!!entry?.reading):[]).map(entry=>({...entry,kana:this.script==='katakana'?katakana(entry.kana):entry.kana}));this.selectedGlyphs=new Set(entries.map(entry=>entry.kana));return entries;}
 async start(catalog:CourseCatalog,mode:KanaMode='learn'){
  if(this.busy||this.unresolved||document.hidden)return;this.entries(catalog);const epoch=this.epoch;this.busy=true;this.error='';this.changed();
  try{
   const data=await loadKana(this.owner,this.script,this.direction,mode==='review');if(epoch!==this.epoch)return;
   const eligible=data.items.filter(item=>mode==='review'||this.selectedGlyphs.has(item.glyph)&&(mode==='practice'||!item.due));
   const shuffled=mode==='review'?eligible:shuffledTokens(eligible.map(kanaItemKey)).map(key=>eligible.find(item=>kanaItemKey(item)===key)!);
   this.queue=shuffled.slice(0,20);this.dueCount=data.dueCount;this.nextDue=data.nextDue;this.mode=mode;this.introducing=mode==='learn'&&this.queue.length>0;this.introIndex=0;this.sessionId=crypto.randomUUID();this.turn=0;this.total=this.queue.length;this.completed=0;this.active=true;this.last=null;this.revealed=this.introducing;
  }catch(error){if(epoch===this.epoch)this.error=error instanceof Error?error.message:'Не удалось начать занятие.';}finally{if(epoch===this.epoch){this.busy=false;this.changed();}}
 }
 reveal(){if(!this.busy&&this.item&&this.active&&!document.hidden){this.revealed=true;this.changed();}}
 async grade(rating:Rating){
  const item=this.item;if(!item||this.introducing||!this.active||!this.revealed||this.busy||document.hidden)return;
  this.unresolved={attemptId:crypto.randomUUID(),script:item.script,direction:item.direction,glyph:item.glyph,version:item.version,rating,mode:this.mode};await this.retry();
 }
 async retry(){
  if(this.busy)return;const owner=this.owner,epoch=this.epoch;this.busy=true;this.error='';this.changed();
  try{
   const pending=pendingKanaReviews(owner);if(this.unresolved&&!pending.some(item=>item.attemptId===this.unresolved!.attemptId))pending.push(this.unresolved);
   for(const input of pending){let result;try{result=await saveKanaReview(owner,input);}catch(error){if(epoch===this.epoch&&error instanceof ApiRequestError&&error.code==='KANA_CONFLICT')this.rejected=input;throw error;}if(epoch!==this.epoch)return;
    if(this.unresolved?.attemptId===input.attemptId){this.queue=this.queue.slice(1);if(this.mode==='practice'&&input.rating===1)this.queue.push(result.item);else this.completed++;this.turn++;this.revealed=false;this.last={attemptId:input.attemptId,kind:input.rating===1?'again':'good'};this.unresolved=null;}
   }
   const data=await loadKana(owner,this.script,this.direction);if(epoch!==this.epoch)return;this.stats=data.items;this.dueCount=data.dueCount;this.nextDue=data.nextDue;this.conflict=false;
   clearTimeout(this.wake);if(data.nextDue){this.wake=setTimeout(()=>{if(!this.busy&&!document.hidden)void this.retry();},Math.max(1000,Math.min(2147483647,Date.parse(data.nextDue)-Date.now()+100)));this.wake.unref?.();}
  }catch(error){if(epoch===this.epoch){this.conflict=error instanceof ApiRequestError&&error.code==='KANA_CONFLICT';this.error=error instanceof Error?error.message:'Ответ не сохранён. Повторите.';}}finally{if(epoch===this.epoch){this.busy=false;this.changed();}}
 }
 async reloadConflict(){if(!this.conflict)return;if(this.rejected)discardKanaConflict(this.owner,this.rejected);this.rejected=null;this.unresolved=null;this.queue=[];this.active=false;this.total=0;this.completed=0;this.conflict=false;await this.retry();}
 finish(){if(this.busy||this.unresolved)return;this.queue=[];this.active=false;this.total=0;this.completed=0;this.revealed=false;this.introducing=false;this.introIndex=0;this.changed();}
 hide(){this.active=false;clearTimeout(this.wake);this.changed();}
}
