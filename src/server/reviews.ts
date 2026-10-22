import { isDeepStrictEqual } from 'node:util';
import { matchesPreparedAnswer } from '../shared/answers';
import { createEmptyCard, fsrs, type Card } from 'ts-fsrs';
import type { Course, Progress, TrainingContext, ReviewItem, ReviewMode, ReviewQueue, ReviewResult, ReviewSubmission, TargetEvaluationRequest, TargetEvaluationResult, Word } from '../shared/types';
import type { Database } from './db';
import { allWords, normalizeSentence, sentenceFor, validSegments } from './material';
import { withPersonalPractice } from './personal-practice';
import { advanceCounter, counterDefinitions, counterKinds, counterTarget, counterWords, levelFor, makeCounterCard, numbersFor, objectFor, parseCounterTarget, type CounterCard, type CounterProgress } from '../shared/counters';
import { counterAudio } from './counter-audio';
const scheduler=fsrs({enable_fuzz:false});
export function nextCard(card:Card|null,rating:1|2|3|4,now=new Date()):Card {return scheduler.next(card??createEmptyCard(now),now,rating).card;}
function restoreCard(data:any):Card {return {...data,due:new Date(data.due),...(data.last_review?{last_review:new Date(data.last_review)}:{})};}
export const reviewId=(mode:ReviewMode,targetId:string,exerciseId='')=>Buffer.from(JSON.stringify([mode,targetId,exerciseId])).toString('base64url');
function decodeReview(id:string):[ReviewMode,string,string]{
 try {const data=JSON.parse(Buffer.from(id,'base64url').toString('utf8'));if(!Array.isArray(data)||data.length!==3||data.some(v=>typeof v!=='string'))throw 0;return data as [ReviewMode,string,string];}catch{throw new ReviewError('INVALID_REVIEW','Неверная карточка.',400);}
}
export class ReviewError extends Error {constructor(public code:string,message:string,public status:400|403|404|409=400){super(message);}}
export function gradeGrammar(course:Course,submission:Extract<ReviewSubmission,{mode:'grammar'}>,exerciseId:string){
 const evaluation=evaluateTarget(course,exerciseId,{...submission,revision:0});const correct=evaluation.outcome==='correct';
 return {correct,rating:correct&&!submission.revealed&&submission.rating!==1?3 as const:1 as const,feedback:correct?(submission.revealed?'Верно после раскрытия. Навык нужно повторить.':'Верно: смысл и целевая конструкция сохранены.'):evaluation.feedback};
}
async function snapshot(database:Pick<Database,'sql'>,userId:string,course:Course){
 const words=await allWords(database,userId,course);
 const states=await database.sql`select item_id,mode,version,card,due,introduced_at from review_states where user_id=${userId}`;
 const [{words_today,skills_today}]=await database.sql`select count(*) filter(where grammar=false)::int as words_today,count(*) filter(where grammar=true)::int as skills_today from (select item_id,(mode='grammar') as grammar,min(introduced_at) as first_at from review_states where user_id=${userId} and mode<>'counter' group by item_id,(mode='grammar')) introductions where first_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'`;
 const counterRows=await database.sql`select counter_id,level,history from counter_progress where user_id=${userId}`;
 const counters:CounterProgress[]=counterRows.map((row:any)=>({counterId:row.counter_id,level:row.level,history:row.history}));
 return {words,states,counters,wordsToday:words_today as number,skillsToday:skills_today as number};
}
const modes=['ja-ru','ru-ja','listening','grammar','counter'] as const;
const wordModes=['ja-ru','ru-ja','listening'] as const;
type Snapshot=Awaited<ReturnType<typeof snapshot>>;
function introduced(snap:Snapshot,grammar=false){return new Set<string>(snap.states.filter((state:any)=>state.mode!=='counter'&&(state.mode==='grammar')===grammar).map((state:any)=>state.item_id));}
function availableCounterWords(snap:Snapshot){return counterWords(snap.words,introduced(snap));}
function counterItemFor(snap:Snapshot,targetId:string,now:Date):ReviewItem|undefined{
 const parsed=parseCounterTarget(targetId);if(!parsed)return;
 const progress=snap.counters.find(progress=>progress.counterId===parsed.definition.id);
 if(parsed.quantity!==null&&levelFor(parsed.quantity)>(progress?.level??0))return;
 const words=availableCounterWords(snap),eligible=words.filter(word=>objectFor(word)?.counters.includes(parsed.definition.id));if(!eligible.length)return;
 const state=snap.states.find((state:any)=>state.mode==='counter'&&state.item_id===targetId);
 const word=eligible[(state?.version??0)%eligible.length]!,seed=crypto.randomUUID();
 const counter=makeCounterCard(targetId,word.id,words,seed,!progress);if(!counter)return;
 counter.audioUrl=counterAudio(counter.definition,counter.quantity);
 counter.examples.forEach((example,index)=>{example.audioUrl=counterAudio(counter.definition,[1,3,8][index]!);});
 if(counter.kind==='listening-image'&&!counter.audioUrl)return;
 return {id:reviewId('counter',targetId,`${word.id}|${seed}`),targetId,mode:'counter',version:state?.version??0,due:new Date(state?.due??now).toISOString(),isNew:!state,counter};
}
function counterTrainingQueue(snap:Snapshot,now:Date):ReviewQueue{
 const words=availableCounterWords(snap);const buckets=counterKinds.map(kind=>{
  const targets=counterDefinitions.filter(counter=>words.some(word=>objectFor(word)?.counters.includes(counter.id))).flatMap(counter=>{
   const level=snap.counters.find(progress=>progress.counterId===counter.id)?.level??0;
   return kind==='image-counter'||kind==='counter-image'?[counterTarget(counter.id,kind,null)]:Array.from({length:level+1},(_,index)=>numbersFor(counter,index)).flat().map(n=>counterTarget(counter.id,kind,n));
  });
  return targets.map(target=>counterItemFor(snap,target,now)).filter((item):item is ReviewItem=>!!item).map(item=>({item,key:Math.random()})).sort((a,b)=>Number(b.item.isNew)-Number(a.item.isNew)||a.key-b.key).map(entry=>entry.item);
 });
 const all=buckets.flat();return {items:interleaveReviews(buckets).slice(0,20),remainingNew:all.filter(item=>item.isNew).length,remainingDue:all.filter(item=>!item.isNew&&new Date(item.due)<=now).length};
}
function submittedCounter(snap:Snapshot,targetId:string,challenge:string):CounterCard{
 const [wordId,seed,extra]=challenge.split('|');const parsed=parseCounterTarget(targetId);
 if(!parsed||!seed||!wordId||extra!==undefined||!/^[a-f0-9-]{36}$/i.test(seed))throw new ReviewError('INVALID_REVIEW','Неверное счётное задание.');
 const level=snap.counters.find(progress=>progress.counterId===parsed.definition.id)?.level??0;
 if(parsed.quantity!==null&&(levelFor(parsed.quantity)>level||!numbersFor(parsed.definition,levelFor(parsed.quantity)).includes(parsed.quantity)))throw new ReviewError('MATERIAL_UNAVAILABLE','Эта числовая ступень ещё не открыта.',403);
 const card=makeCounterCard(targetId,wordId,availableCounterWords(snap),seed);if(!card||card.kind==='listening-image'&&!counterAudio(card.definition,card.quantity))throw new ReviewError('MATERIAL_UNAVAILABLE','Счётное задание недоступно.',403);
 return card;
}
function exercisesFor(course:Course,words:Word[],personalIds?:Set<string>){
 const preparedIds=new Set(course.words.filter(word=>word.lessonIds.length).map(word=>word.id));const wordMap=new Map(words.filter(word=>validSegments(word)&&(preparedIds.has(word.id)||word.reviewStatus!=='draft'&&(!personalIds||personalIds.has(word.id)))).map(word=>[word.id,word]));const formMap=new Map(course.forms.map(form=>[form.id,form]));
 return course.exercises.filter(exercise=>{
  const skill=course.skills.find(item=>item.id===exercise.skillId);
  const personal=exercise.tokens.some(token=>!preparedIds.has(formMap.get(token.formId)?.wordId??''));
  // Publishing a guided skill must not expose its unreviewed sibling examples in repeat sessions.
  const checked=!course.learning||personal||exercise.reviewStatus!=='draft'&&skill?.reviewStatus!=='draft'&&exercise.tokens.every(token=>formMap.get(token.formId)?.reviewStatus!=='draft');
  return !!skill&&checked&&exercise.tokens.every(token=>wordMap.has(formMap.get(token.formId)?.wordId??''));
 });
}
export function reviewPriority(state:{due:Date|string;introduced_at:Date|string;card?:{difficulty?:number}},now=new Date()){
 const days=86400000;const overdue=Math.max(0,now.getTime()-new Date(state.due).getTime())/days;const age=Math.max(0,now.getTime()-new Date(state.introduced_at).getTime())/days;
 return overdue+Math.max(0,1-age/14)*.25+(state.card?.difficulty??0)/40;
}
// One exponential draw per item gives weighted ordering without replacement.
export function reviewDrawKey(priority:number,draw=Math.random()){return -Math.log(1-draw)/(1+priority);}
function itemFor(course:Course,snap:Snapshot,mode:Exclude<ReviewMode,'counter'>,targetId:string,now:Date,options=exercisesFor(withPersonalPractice(course,snap.words),snap.words)):Exclude<ReviewItem,{mode:'counter'}>{
 const state=snap.states.find((candidate:any)=>candidate.mode===mode&&candidate.item_id===targetId);const first=snap.states.filter((candidate:any)=>candidate.item_id===targetId&&(candidate.mode==='grammar')===(mode==='grammar')).sort((a:any,b:any)=>new Date(a.introduced_at).getTime()-new Date(b.introduced_at).getTime())[0];
 const base={id:'',targetId,version:state?.version??0,due:new Date(state?.due??first?.introduced_at??now).toISOString(),isNew:!first};
 if(mode==='grammar'){const exercises=options.filter(exercise=>exercise.skillId===targetId);const exercise=exercises[base.version%exercises.length]!;return {...base,id:reviewId(mode,targetId,exercise.id),mode,exercise,skill:course.skills.find(skill=>skill.id===targetId)!};}
 return {...base,id:reviewId(mode,targetId),mode,word:snap.words.find(word=>word.id===targetId)!};
}
function dueItems(course:Course,snap:Snapshot,mode:ReviewMode,now:Date):ReviewItem[]{
 if(mode==='counter')return snap.states.filter((state:any)=>state.mode==='counter'&&new Date(state.due)<=now).map((state:any)=>counterItemFor(snap,state.item_id,now)).filter((item:ReviewItem|undefined):item is ReviewItem=>!!item).sort((a:ReviewItem,b:ReviewItem)=>new Date(a.due).getTime()-new Date(b.due).getTime());
 const learned=introduced(snap,mode==='grammar');const exercises=exercisesFor(withPersonalPractice(course,snap.words),snap.words,introduced(snap));
 const ids=mode==='grammar'?[...new Set(exercises.map(exercise=>exercise.skillId))]:snap.words.filter(word=>word.reviewStatus!=='draft'&&validSegments(word)&&(mode!=='listening'||!!word.audioUrl)).map(word=>word.id);
 const items=ids.filter(id=>learned.has(id)).map(id=>itemFor(course,snap,mode,id,now,exercises)).filter(item=>new Date(item.due)<=now);
 const priority=(item:ReviewItem)=>{const state=snap.states.find((candidate:any)=>candidate.item_id===item.targetId&&candidate.mode===mode)??snap.states.find((candidate:any)=>candidate.item_id===item.targetId);return reviewPriority({...state,due:item.due},now);};
 return items.map(item=>({item,key:reviewDrawKey(priority(item))})).sort((a,b)=>a.key-b.key).map(entry=>entry.item);
}
export function interleaveReviews(buckets:ReviewItem[][],lastWordId?:string):ReviewItem[]{
 const pending=buckets.map(bucket=>[...bucket]);const result:ReviewItem[]=[];let next=0;
 while(pending.some(bucket=>bucket.length)){
  let chosen=-1;let position=0;
  for(let offset=0;offset<pending.length;offset++){const index=(next+offset)%pending.length;const item=pending[index]?.[0];if(item&&(item.mode==='grammar'||item.targetId!==lastWordId)){chosen=index;break;}}
  if(chosen<0)for(let offset=0;offset<pending.length;offset++){const index=(next+offset)%pending.length;const candidate=pending[index]!.findIndex(item=>item.mode==='grammar'||item.targetId!==lastWordId);if(candidate>=0){chosen=index;position=candidate;break;}}
  if(chosen<0)chosen=pending.findIndex(bucket=>bucket.length>0);
  const [item]=pending[chosen]!.splice(position,1);result.push(item!);lastWordId=item!.mode==='grammar'?undefined:item!.targetId;next=(chosen+1)%pending.length;
 }
 return result;
}
export async function reviewQueue(database:Database,userId:string,course:Course,mode:ReviewMode|'mixed'):Promise<ReviewQueue>{
 const snap=await snapshot(database,userId,course);const now=new Date();const items=mode==='mixed'?interleaveReviews(modes.map(itemMode=>dueItems(course,snap,itemMode,now))):dueItems(course,snap,mode,now);
 return {items:items.slice(0,30),remainingDue:items.length,remainingNew:0};
}
export async function introducedExerciseAvailable(database:Database,userId:string,course:Course,exerciseId:string):Promise<boolean>{
 const snap=await snapshot(database,userId,course);const exercise=exercisesFor(withPersonalPractice(course,snap.words),snap.words,introduced(snap)).find(item=>item.id===exerciseId);return !!exercise&&introduced(snap,true).has(exercise.skillId);
}
export async function trainingQueue(database:Database,userId:string,course:Course,context:TrainingContext):Promise<ReviewQueue>{
 const snap=await snapshot(database,userId,course);const now=new Date();let words:Word[];
 if(context.counters)return counterTrainingQueue(snap,now);
 if(context.lessonId){if(!course.lessons.some(lesson=>lesson.id===context.lessonId))throw new ReviewError('NOT_FOUND','Урок не найден.',404);words=snap.words.filter(word=>word.lessonIds.includes(context.lessonId!));}
 else {const [list]=await database.sql`select id from word_lists where id=${context.listId!} and user_id=${userId}`;if(!list)throw new ReviewError('NOT_FOUND','Личный список не найден.',404);const rows=await database.sql`select id from personal_words where list_id=${context.listId!} and user_id=${userId}`;const ids=new Set(rows.map((row:any)=>row.id));words=snap.words.filter(word=>ids.has(word.id));}
 words=words.filter(word=>word.reviewStatus!=='draft'&&validSegments(word));const wordIds=introduced(snap);const skillIds=introduced(snap,true);const freshWords=words.filter(word=>!wordIds.has(word.id));
 const priority=(id:string,grammar=false)=>Math.max(0,...snap.states.filter((state:any)=>state.item_id===id&&(state.mode==='grammar')===grammar).map((state:any)=>reviewPriority(state,now)));
 const selected=(freshWords.length?freshWords:words.map(word=>({word,key:reviewDrawKey(priority(word.id))})).sort((a,b)=>a.key-b.key).map(entry=>entry.word)).slice(0,10);
 const wordItems=selected.map((word,index)=>{const available=wordModes.filter(mode=>mode!=='listening'||word.audioUrl);const count=snap.states.filter((state:any)=>state.item_id===word.id&&state.mode!=='grammar').reduce((sum:number,state:any)=>sum+state.version,0);const mode=available[(count||(wordIds.size+index))%available.length]!;return itemFor(course,snap,mode,word.id,now);});
 const extended=withPersonalPractice(course,snap.words);const exercises=exercisesFor(extended,snap.words,context.listId?new Set(words.map(word=>word.id)):wordIds).filter(exercise=>context.lessonId?exercise.lessonId===context.lessonId:exercise.tokens.some(token=>extended.forms.some(form=>form.id===token.formId&&words.some(word=>word.id===form.wordId))));
 const skills=[...new Set(exercises.map(exercise=>exercise.skillId))].map(id=>({id,key:reviewDrawKey(priority(id,true))})).sort((a,b)=>Number(skillIds.has(a.id))-Number(skillIds.has(b.id))||a.key-b.key).map(entry=>entry.id);
 const grammar=skills.slice(0,2).map(id=>itemFor(course,snap,'grammar',id,now,exercises));
 return {items:interleaveReviews([wordItems,grammar]),remainingNew:freshWords.length+skills.filter(id=>!skillIds.has(id)).length,remainingDue:modes.flatMap(mode=>dueItems(course,snap,mode,now)).filter(item=>item.mode==='grammar'?skills.includes(item.targetId):words.some(word=>word.id===item.targetId)).length};
}
export async function learningReviewItem(sql:Database['sql'],userId:string,course:Course,mode:Exclude<ReviewMode,'counter'>,targetId:string,exerciseId?:string):Promise<Exclude<ReviewItem,{mode:'counter'}>>{
 const snap=await snapshot({sql},userId,course);
 const item=itemFor(course,snap,mode,targetId,new Date());
 if(mode==='grammar'&&exerciseId&&item.mode==='grammar')return {...item,id:reviewId(mode,targetId,exerciseId),exercise:course.exercises.find(exercise=>exercise.id===exerciseId)!};
 return item;
}
export function evaluateTarget(course:Course,exerciseId:string,input:Pick<TargetEvaluationRequest,'tokenIds'|'tokenForms'|'revision'|'exploring'>):TargetEvaluationResult{
 const result=(outcome:TargetEvaluationResult['outcome'],feedback:string):TargetEvaluationResult=>({revision:input.revision,outcome,feedback});
 const exercise=course.exercises.find(item=>item.id===exerciseId);if(!exercise)throw new ReviewError('NOT_FOUND','Упражнение не найдено.',404);
 const original=new Map(exercise.tokens.map(token=>[token.id,token]));const forms=new Map(course.forms.map(form=>[form.id,form]));
 const identity=(id:string)=>{const form=forms.get(id);return form?JSON.stringify([form.wordId,form.surface,form.kana]):null;};
 const originalKeys=exercise.tokens.map(token=>identity(token.formId)!);const selected=input.tokenIds.map(id=>identity(input.tokenForms?.[id]??original.get(id)?.formId??''));
 if(new Set(input.tokenIds).size!==input.tokenIds.length)return result('incomplete','Каждый элемент должен встречаться один раз.');
 if(input.tokenIds.some(id=>!original.has(id)))return result('exploration','Добавлены другие элементы: исходный навык не оценивается.');
 const remaining=[...originalKeys];
 for(const key of selected){const index=remaining.indexOf(key??'');if(index<0)return result('exploration','Состав или форма изменены: это отдельная фраза. Исходный навык не оценивается.');remaining.splice(index,1);}
 const accepted=matchesPreparedAnswer(exercise,course.forms,input.tokenIds,input.tokenForms);
 // Deleting a known topic sets exploration in the editor; only an authored equivalent subset may override it.
 if(accepted&&(!input.exploring||selected.length<exercise.tokens.length))return result('correct','Сохранены требуемый смысл и целевая конструкция.');
 if(input.exploring)return result('exploration','Вы исследуете другую фразу. Исходный навык не оценивается.');
 const inventory=JSON.stringify([...selected].sort());
 if(!exercise.acceptedOrders.some(order=>JSON.stringify(order.map(id=>identity(original.get(id)!.formId)).sort())===inventory))return result('incomplete','Соберите допустимый ответ целиком; промежуточная правка не меняет повторение.');
 const sentence=normalizeSentence(selected.map((_,index)=>forms.get(input.tokenForms?.[input.tokenIds[index]!]??original.get(input.tokenIds[index]!)?.formId??'')?.surface??'').join(''));
 if(course.exercises.some(other=>other.id!==exercise.id&&other.promptRu!==exercise.promptRu&&other.acceptedOrders.some(order=>normalizeSentence(sentenceFor(course,other,order))===sentence)))return result('exploration','Это другое подготовленное высказывание. Исходный навык не оценивается.');
 return result('incorrect','Пока не совпадает с подготовленным смыслом и целевой конструкцией; это не общая оценка грамматики фразы.');
}
export async function evaluateReview(database:Database,userId:string,course:Course,input:TargetEvaluationRequest):Promise<TargetEvaluationResult>{
 const [mode,targetId,exerciseId]=decodeReview(input.reviewId);if(mode!=='grammar')throw new ReviewError('INVALID_REVIEW','Это не задание на конструкцию.');
 const snap=await snapshot(database,userId,course);const exerciseCourse=withPersonalPractice(course,snap.words);
 if(!exercisesFor(exerciseCourse,snap.words).some(exercise=>exercise.id===exerciseId&&exercise.skillId===targetId))throw new ReviewError('MATERIAL_UNAVAILABLE','Задание недоступно.',403);
 return evaluateTarget(exerciseCourse,exerciseId,input);
}
export async function submitReview(database:Database,userId:string,course:Course,input:ReviewSubmission):Promise<ReviewResult>{
 return database.sql.begin(async tx=>{
  await tx`select pg_advisory_xact_lock(hashtext(${userId}))`;
  return submitReviewLocked(tx,userId,course,input);
 });
}
// The caller owns the user lock and transaction so guided progress and its grade commit together.
export async function submitReviewLocked(tx:Database['sql'],userId:string,course:Course,input:ReviewSubmission):Promise<ReviewResult>{
 const [mode,targetId,exerciseId]=decodeReview(input.reviewId);if(mode!==input.mode)throw new ReviewError('INVALID_REVIEW','Режим карточки не совпадает.',400);
 const snap=await snapshot({sql:tx},userId,course);
 const exerciseCourse=withPersonalPractice(course,snap.words);
 const exercise=mode==='grammar'?exercisesFor(exerciseCourse,snap.words).find(e=>e.id===exerciseId&&e.skillId===targetId):undefined;
 const word=mode!=='grammar'&&mode!=='counter'?snap.words.find(w=>w.id===targetId&&w.reviewStatus!=='draft'&&validSegments(w)):undefined;
 const payload=JSON.stringify(input);
  const [prior]=await tx`select user_id,payload,result from review_attempts where attempt_id=${input.attemptId}`;
  if(prior){if(prior.user_id!==userId||!isDeepStrictEqual(prior.payload,JSON.parse(payload)))throw new ReviewError('ATTEMPT_CONFLICT','Идентификатор попытки уже использован.',409);return prior.result as ReviewResult;}
  const counter=mode==='counter'?submittedCounter(snap,targetId,exerciseId):null;
  if(mode==='grammar'?!exercise:mode==='counter'?!counter:!word||(mode==='listening'&&!word.audioUrl))throw new ReviewError('MATERIAL_UNAVAILABLE','Материал недоступен.',403);
  if(input.mode==='grammar'){
   const evaluation=evaluateTarget(exerciseCourse,exerciseId,{...input,revision:0});
   if(evaluation.outcome==='exploration')throw new ReviewError('EXPLORATION_NOT_SCHEDULED','Исследование другой фразы не оценивает исходный навык.',409);
   if(evaluation.outcome==='incomplete')throw new ReviewError('INCOMPLETE_NOT_SCHEDULED','Незавершённое задание не меняет повторение.',409);
  }
  if(input.mode==='grammar'&&input.tokenForms){
   for(const id of input.tokenIds){const choice=input.tokenForms[id];if(!choice)continue;const changed=exerciseCourse.forms.find(form=>form.id===choice);if(!changed)throw new ReviewError('INVALID_FORM','Эта словоформа недоступна.',403);}
  }
  const [existing]=await tx`select version,card,due from review_states where user_id=${userId} and item_id=${targetId} and mode=${mode} for update`;
  const currentVersion=existing?.version??0;if(input.version>currentVersion)throw new ReviewError('VERSION_CONFLICT','Версия карточки опережает сервер.',409);
  const now=new Date();let scheduled=input.version===currentVersion&&(!existing||new Date(existing.due)<=now);
  if(input.mode==='counter'&&counter!.kind!=='recall'&&!input.choice)throw new ReviewError('INCOMPLETE_NOT_SCHEDULED','Сначала выберите ответ.',409);
  const correct=counter&&input.mode==='counter'?(counter.kind==='recall'?input.rating===3:counter.acceptedKeys.includes(input.choice??'')):false;
  const grade=input.mode==='grammar'?gradeGrammar(exerciseCourse,input,exerciseId):input.mode==='counter'?{correct,rating:correct&&!input.helped&&input.rating===3?3 as const:1 as const,feedback:correct?'Верно. Вспомнили уверенно — уберите карточку, иначе повторите.':'Повторим: '+counter!.answer.kana}:null;
  const rating=grade?.rating??(input as Extract<ReviewSubmission,{rating:number}>).rating;
  const card=scheduled?nextCard(existing?restoreCard(existing.card):null,rating,now):restoreCard(existing.card);
  const result:ReviewResult={attemptId:input.attemptId,status:scheduled?'scheduled':'additional-practice',version:scheduled?currentVersion+1:currentVersion,nextDue:card.due.toISOString(),...(grade?{correct:grade.correct,feedback:grade.feedback}:{})};
  if(scheduled)await tx`insert into review_states(user_id,item_id,mode,version,card,due) values(${userId},${targetId},${mode},${result.version},${card},${card.due}) on conflict(user_id,item_id,mode) do update set version=excluded.version,card=excluded.card,due=excluded.due,updated_at=now()`;
  if(counter&&input.mode==='counter'){
   await tx`insert into counter_progress(user_id,counter_id) values(${userId},${counter.definition.id}) on conflict do nothing`;
   const [previous]=await tx`select attempt_id from review_attempts where user_id=${userId} and mode='counter' and payload->>'reviewId'=${input.reviewId} limit 1`;
   if(!previous&&counter.quantity!==null){
    const [row]=await tx`select level,history from counter_progress where user_id=${userId} and counter_id=${counter.definition.id} for update`;
    const next=advanceCounter({counterId:counter.definition.id,level:row.level,history:row.history},{quantity:counter.quantity,kind:counter.kind,confident:grade!.rating===3});
    await tx`update counter_progress set level=${next.level},history=${next.history},updated_at=now() where user_id=${userId} and counter_id=${counter.definition.id}`;
   }
  }
  await tx`insert into review_attempts(attempt_id,user_id,item_id,mode,expected_version,payload,result,scheduled) values(${input.attemptId},${userId},${targetId},${mode},${input.version},${input},${result},${scheduled})`;
  return result;

}
export async function progressFor(database:Database,userId:string,course:Course):Promise<Progress>{
 const snap=await snapshot(database,userId,course);const rows=await database.sql`select mode,count(*)::int as reviewed from review_attempts where user_id=${userId} and scheduled=true and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' group by mode`;
 const byMode={} as Progress['byMode'];for(const mode of modes){const queue=await reviewQueue(database,userId,course,mode);byMode[mode]={due:queue.remainingDue,learned:snap.states.filter((s:any)=>s.mode===mode).length,reviewedToday:rows.find((r:any)=>r.mode===mode)?.reviewed??0};}
 const introducedWordIds=[...introduced(snap)];const introducedSkillIds=[...introduced(snap,true)];
 return {counters:snap.counters,introducedWordIds,introducedSkillIds,completedLessons:course.lessons.filter(lesson=>course.words.filter(word=>word.lessonIds.includes(lesson.id)&&word.reviewStatus!=='draft'&&validSegments(word)).every(word=>introducedWordIds.includes(word.id))&&course.skills.filter(skill=>skill.lessonIds.includes(lesson.id)).every(skill=>introducedSkillIds.includes(skill.id))).length,totalLessons:course.lessons.length,wordsIntroducedToday:snap.wordsToday,skillsIntroducedToday:snap.skillsToday,byMode};
}
