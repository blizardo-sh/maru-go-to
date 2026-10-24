import type { Course, ReviewItem, ReviewSubmission } from '../shared/types';
import { stagedLearning, trainingEntry, wordPracticeFormats, type StudyPreparation } from '../shared/training';
import type { Database } from './db';
import { counterTarget, parseCounterTarget } from '../shared/counters';
import { counterAudio } from './counter-audio';

export function studySpec(course:Course,item:ReviewItem):StudyPreparation {
 const base={key:'',kind:'word' as StudyPreparation['kind'],targetId:item.targetId,scope:'default',required:[] as string[],passed:[] as string[],introduced:false,referenceSeen:false,title:'',explanationRu:''};
 if(item.mode==='grammar'){
  const prepared=item.construction??course.learning?.flatMap(route=>route.goals.flatMap(goal=>goal.parts.flatMap(part=>part.construction?[part.construction]:[]))).find(value=>value.exerciseId===item.exercise.id);
  return {...base,key:'grammar:'+item.targetId,kind:'grammar',required:['ja-ru',...(prepared?.example.audioUrl?['listening']:[]),'grammar'],title:item.skill.title,explanationRu:prepared?.explanationRu??item.skill.explanationRu,...(prepared?.example?{example:prepared.example}:{})};
 }
 if(item.mode==='counter'){
  const card=item.counter,quantity=card.quantity,definition=card.definition;
  const targetId=definition.id+'/'+(quantity??'type');
  const required=quantity===null?['image-counter','counter-image']:['reading-choice',...(counterAudio(definition,quantity,course.catalog,course.media)?['listening-image']:[]),'recall'];
  return {...base,key:'counter:'+targetId,kind:'counter',targetId,required,title:definition.title,explanationRu:definition.explanation,word:card.word,examples:card.examples.map(value=>({...value,meaningRu:definition.title,audioUrl:value.audioUrl??''}))};
 }
 const challenge=JSON.parse(Buffer.from(item.id,'base64url').toString())[2] as string;
 const scope=challenge.startsWith('training:')?challenge.split('|')[0]!:base.scope;
 const entry=trainingEntry(course,item.word.id),prepared=entry??course.learning?.flatMap(route=>route.goals.flatMap(goal=>goal.parts.flatMap(part=>part.words))).find(value=>value.wordId===item.word.id);
 return {...base,key:'word:'+item.targetId,scope,required:wordPracticeFormats(item.word,scope.startsWith('training:')&&!!entry?.application),title:item.word.meaningRu,word:item.word,explanationRu:prepared?.explanationRu??'Проверьте написание, чтение и русский смысл. Для этой записи используются подтверждённые сведения.',...(prepared?.example?{example:prepared.example}:{})};
}
export async function studyPreparations(sql:Database['sql'],userId:string,course:Course,items:ReviewItem[],states?:any[]):Promise<ReviewItem[]> {
 if(!stagedLearning(course))return items;
 const progress=await sql`select kind,item_id,introductions,passed from study_progress where user_id=${userId}`;
 const existing:any[]=states??(await sql`select item_id,mode from review_states where user_id=${userId}`)??[];
 return items.map(item=>{
  const spec=studySpec(course,item),row=progress.find((row:any)=>row.kind===spec.kind&&row.item_id===spec.targetId);
  // Accepted historical schedules must never force the learner to restart the course.
  const known=existing.some((state:any)=>spec.kind==='word'?state.mode!=='grammar'&&state.mode!=='counter'&&state.item_id===spec.targetId:spec.kind==='grammar'?state.mode==='grammar'&&state.item_id===spec.targetId:state.mode==='counter'&&(()=>{const parsed=parseCounterTarget(state.item_id,course.catalog);return parsed&&parsed.definition.id+'/'+(parsed.quantity??'type')===spec.targetId;})());
  spec.passed=[...new Set<string>([...(row?.passed??[]),...(known?spec.required.filter(format=>format!=='application'):[])])];
  const ready=spec.required.every(format=>spec.passed.includes(format));
  spec.introduced=ready||!!row?.introductions.includes(spec.scope);
  spec.referenceSeen=ready||spec.introduced||!!row?.introductions.includes('reference:'+spec.scope);
  return {...item,preparation:spec};
 });
}
export async function introduceStudy(sql:Database['sql'],userId:string,spec:StudyPreparation,stage:'reference'|'learning') {
 const [row]=await sql`select introductions,passed from study_progress where user_id=${userId} and kind=${spec.kind} and item_id=${spec.targetId} for update`;
 const introductions=[...new Set<string>([...(row?.introductions??[]),'reference:'+spec.scope,...(stage==='learning'?[spec.scope]:[])])];
 await sql`insert into study_progress(user_id,kind,item_id,introductions,passed) values(${userId},${spec.kind},${spec.targetId},${introductions},${row?.passed??[]}) on conflict(user_id,kind,item_id) do update set introductions=excluded.introductions,updated_at=now()`;
}
export function studyFormat(item:ReviewItem,input:ReviewSubmission) {
 return item.mode==='counter'?item.counter.kind:item.mode==='grammar'?input.practiceFormat??'grammar':item.application?'application':item.mode;
}
export async function passStudy(sql:Database['sql'],userId:string,spec:StudyPreparation,format:string,correct:boolean) {
 const passed=spec.passed.filter(value=>value!==format);if(correct)passed.push(format);
 await sql`update study_progress set passed=${passed},updated_at=now() where user_id=${userId} and kind=${spec.kind} and item_id=${spec.targetId}`;
 return spec.required.every(value=>passed.includes(value));
}
export function enrollmentTargets(spec:StudyPreparation):{id:string;mode:ReviewItem['mode']}[] {
 if(spec.kind==='word')return spec.required.filter(format=>format!=='application').map(mode=>({id:spec.targetId,mode:mode as 'ja-ru'|'ru-ja'|'listening'}));
 if(spec.kind==='grammar')return [{id:spec.targetId,mode:'grammar'}];
 const [id,quantity]=spec.targetId.split('/');
 return spec.required.map(kind=>({id:counterTarget(id as import('../shared/counters').CounterId,kind as import('../shared/counters').CounterKind,quantity==='type'?null:Number(quantity)),mode:'counter'}));
}
