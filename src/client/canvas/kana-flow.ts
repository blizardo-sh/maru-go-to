import { katakana } from '@app/shared/kana';
import { shuffledTokens } from '@app/client/study';
import type { CourseCatalog } from '@app/shared/catalog';
import { KanaConflict, kanaStats, pendingKana, saveKana, startKanaSession, type KanaDirection, type KanaScript, type KanaStat, type KanaAttempt } from './kana-store';
export type KanaQuestion={glyph:string;reading:string;prompt:string;options:string[];accepted:string[]};
export class KanaFlow {
  script:KanaScript='hiragana';direction:KanaDirection='sign-reading';group:'basic'|'voiced'|'yoon'='basic';rows:number[]=[];
  stats:KanaStat[]=[];queue:KanaQuestion[]=[];sessionId='';turn=0;total=0;completed=0;active=false;busy=false;error='';showStats=false;
  last:{attemptId:string;kind:'good'|'again'}|null=null;
  private unresolved:KanaAttempt|null=null;
  private owner='';private epoch=0;
  constructor(private changed:()=>void){}
  clear(){this.epoch++;this.owner='';this.script='hiragana';this.direction='sign-reading';this.group='basic';this.stats=[];this.queue=[];this.sessionId='';this.turn=0;this.total=0;this.completed=0;this.active=false;this.busy=false;this.error='';this.showStats=false;this.last=null;this.rows=[];this.unresolved=null;}
  get item(){return this.queue[0];}
  async boot(owner:string,catalog:CourseCatalog){
    if(this.owner!==owner){this.clear();this.owner=owner;try{const saved=JSON.parse(localStorage.getItem('japanese-kana-settings:'+owner)??'null');if(saved){if(!['hiragana','katakana'].includes(saved.script)||!['sign-reading','reading-sign'].includes(saved.direction)||!['basic','voiced','yoon'].includes(saved.group)||!Array.isArray(saved.rows)||saved.rows.some((row:unknown)=>!Number.isInteger(row)))throw new Error('Настройки каны повреждены.');this.script=saved.script;this.direction=saved.direction;this.group=saved.group;this.rows=saved.rows;}else this.rows=catalog.kana.basic.map((_,index)=>index);}catch(error){this.error=error instanceof Error?error.message:'Настройки каны недоступны.';this.changed();return;}}
    const epoch=this.epoch;this.busy=true;this.error='';this.changed();try{const pending=pendingKana(owner);if(pending)await saveKana(owner,pending);const stats=await kanaStats(owner);if(epoch===this.epoch){this.stats=stats;this.active=!!this.queue.length;}}catch(error){if(epoch===this.epoch){if(error instanceof KanaConflict)this.abandonStaleSession();this.error=error instanceof Error?error.message:'Статистика каны недоступна.';}}finally{if(epoch===this.epoch){this.busy=false;this.changed();}}
  }
  configure(change:Partial<Pick<KanaFlow,'script'|'direction'|'group'|'rows'>>,catalog:CourseCatalog){
    if(this.busy||this.queue.length)return;const next={script:this.script,direction:this.direction,group:this.group,rows:this.rows,...change};if(change.group)next.rows=catalog.kana[change.group].map((_,index)=>index);
    try{localStorage.setItem('japanese-kana-settings:'+this.owner,JSON.stringify(next));Object.assign(this,next);this.error='';}catch{this.error='Не удалось сохранить выбор наборов каны.';}this.changed();
  }
  entries(catalog:CourseCatalog){return catalog.kana[this.group].flatMap((row,index)=>this.rows.includes(index)?row.cells.filter((entry):entry is NonNullable<typeof entry>=>!!entry&&!!entry.reading):[]).map(entry=>({...entry,kana:this.script==='katakana'?katakana(entry.kana):entry.kana}));}
  async start(catalog:CourseCatalog){
    if(this.busy||document.hidden)return;const entries=this.entries(catalog);if(entries.length<2)return;const epoch=this.epoch;this.busy=true;this.error='';this.changed();
    try{
      const session=await startKanaSession(this.owner);if(epoch!==this.epoch)return;
      const ids=shuffledTokens(entries.map(entry=>entry.kana));
      this.queue=ids.map(glyph=>{const entry=entries.find(entry=>entry.kana===glyph)!,accepted=this.direction==='sign-reading'?[entry.reading]:entries.filter(value=>value.reading===entry.reading).map(value=>value.kana),values=[...new Set(entries.map(value=>this.direction==='sign-reading'?value.reading:value.kana))],other=shuffledTokens(values.filter(value=>!accepted.includes(value))).slice(0,3);return {glyph,reading:entry.reading,prompt:this.direction==='sign-reading'?glyph:entry.reading,accepted,options:shuffledTokens([accepted[0]!,...other])};});
      this.sessionId=session;this.turn=0;this.total=this.queue.length;this.completed=0;this.active=true;this.last=null;
    }catch(error){if(epoch===this.epoch){if(error instanceof KanaConflict)this.abandonStaleSession();this.error=error instanceof Error?error.message:'Не удалось начать занятие.';}}finally{if(epoch===this.epoch){this.busy=false;this.changed();}}
  }
  async choose(choice:string){
    const item=this.item;if(!item||!this.active||this.busy||document.hidden||!item.options.includes(choice))return;
    const owner=this.owner,epoch=this.epoch,payload={attemptId:crypto.randomUUID(),sessionId:this.sessionId,turn:this.turn,script:this.script,glyph:item.glyph,direction:this.direction,choice,correct:item.accepted.includes(choice)};
    this.unresolved=payload;this.busy=true;this.error='';this.changed();
    try{await saveKana(owner,payload);if(epoch!==this.epoch||owner!==this.owner)return;this.confirm(payload.correct,payload.attemptId);this.unresolved=null;const stats=await kanaStats(owner);if(epoch===this.epoch)this.stats=stats;}
    catch(error){if(epoch===this.epoch){if(error instanceof KanaConflict)this.abandonStaleSession();this.error=error instanceof Error?error.message:'Ответ не сохранён. Повторите.';}}
    finally{if(epoch===this.epoch){this.busy=false;this.changed();}}
  }
  private confirm(correct:boolean,attemptId:string){const item=this.item!;this.queue=this.queue.slice(1);if(!correct)this.queue.push(item);else this.completed++;this.turn++;this.last={attemptId,kind:correct?'good':'again'};}
  async retry(){const owner=this.owner,epoch=this.epoch;this.busy=true;this.changed();try{const pending=pendingKana(owner)??this.unresolved;if(pending){await saveKana(owner,pending);if(epoch===this.epoch&&this.sessionId===pending.sessionId&&this.turn===pending.turn&&this.item?.glyph===pending.glyph){this.confirm(pending.correct,pending.attemptId);this.unresolved=null;}}const stats=await kanaStats(owner);if(epoch===this.epoch){this.stats=stats;this.error='';}}catch(error){if(epoch===this.epoch){if(error instanceof KanaConflict)this.abandonStaleSession();this.error=error instanceof Error?error.message:'Ответ не сохранён.';}}finally{if(epoch===this.epoch){this.busy=false;this.changed();}}}
  private abandonStaleSession(){this.queue=[];this.active=false;this.sessionId='';this.turn=0;this.completed=0;this.total=0;this.unresolved=null;this.last=null;}
  hide(){this.active=false;this.changed();}
}
