import type { Word, WordList, WordUpdate, Course } from '../shared/types';
import { ReviewError } from './reviews';
import type { Database } from './db';
import { validSegments } from './material';
export async function listsFor(database:Database,userId:string):Promise<WordList[]>{
 const lists=await database.sql`select id,name from word_lists where user_id=${userId} order by created_at`;
 const rows=await database.sql`select list_id,data from personal_words where user_id=${userId} order by created_at`;
 return lists.map((l:any)=>({id:l.id,name:l.name,words:rows.filter((w:any)=>w.list_id===l.id).map((w:any)=>w.data as Word)}));
}
export function parseWordList(text:string,course:Course,requestId?:string):Word[]{
 const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
 if(lines.length>500)throw new Error('Не больше 500 слов в одном списке.');
 return lines.map((line,index)=>{
  const parts=line.includes('\t')?line.split('\t'):line.includes(';')?line.split(';'):line.split(/\s*[—–=]\s*/u);
  const surface=parts[0]?.trim()??'';const kana=parts.length>=3?parts[1]!.trim():'';const meaning=parts.length>=3?parts.slice(2).join(' — ').trim():parts[1]?.trim()??'';
  if(!surface||!meaning||surface.length>100||meaning.length>500||kana.length>200)throw new Error('Используйте «японский → табуляция → перевод» или «японский — перевод», с чтением третья колонка.');
  const match=course.words.find(w=>(w.surface===surface||w.kana===surface)&&w.meaningRu===meaning);
  if(match)return {...structuredClone(match),id:`personal.${requestId ? requestId+'.'+index : crypto.randomUUID()}`,lessonIds:[],sourceRefs:[]};
  const reading=kana||(/^[\p{Script=Hiragana}\p{Script=Katakana}ー\s]+$/u.test(surface)?surface:'');
  return {id:`personal.${requestId ? requestId+'.'+index : crypto.randomUUID()}`,lessonIds:[],surface,kana:reading,meaningRu:meaning,segments:[{surface,...(reading&&reading!==surface?{reading}:{})}],kind:'word' as const,pos:'',reviewStatus:'draft' as const,sourceRefs:[]};
 });
}
const wordShape=(word:Word)=>JSON.stringify({surface:word.surface,kana:word.kana,meaningRu:word.meaningRu,segments:word.segments.map(segment=>({surface:segment.surface,reading:segment.reading??null})),pos:word.pos});
export async function addList(database:Database,userId:string,name:string,text:string,course:Course,requestId?:string){
 const words=parseWordList(text,course,requestId),id=requestId??crypto.randomUUID();
 return database.sql.begin(async tx=>{
  await tx`select pg_advisory_xact_lock(hashtext(${'personal-list:'+id}))`;
  const [prior]=await tx`select user_id,name from word_lists where id=${id}`;
  if(prior){
   if(prior.user_id!==userId||prior.name!==name)throw new ReviewError('LIST_CONFLICT','Список уже изменён. Обновите данные перед сохранением.',409);
   const previous=await tx`select data from personal_words where list_id=${id} and user_id=${userId} order by id`;
   if(previous.map((r:any)=>wordShape(r.data)).sort().join('\n')!==words.map(wordShape).sort().join('\n'))throw new ReviewError('LIST_CONFLICT','Список уже изменён. Обновите данные перед сохранением.',409);
   return {id,name,words:previous.map((r:any)=>r.data as Word)};
  }
  await tx`insert into word_lists(id,user_id,name) values(${id},${userId},${name})`;
  for(const word of words)await tx`insert into personal_words(id,list_id,user_id,data) values(${word.id},${id},${userId},${word})`;
  return {id,name,words};
 });
}
export async function appendList(database:Database,userId:string,listId:string,text:string,course:Course,requestId:string){
 let words:Word[];try{words=parseWordList(text,course,requestId);}catch(error){throw new ReviewError('INVALID_LIST',error instanceof Error?error.message:'Проверьте импортируемые слова.',400);}
 return database.sql.begin(async tx=>{
  const [list]=await tx`select name from word_lists where id=${listId} and user_id=${userId} for update`;if(!list)throw new ReviewError('NOT_FOUND','Личный список не найден.',404);
  for(const word of words){const [prior]=await tx`select user_id,list_id,data from personal_words where id=${word.id}`;
   if(prior){if(prior.user_id!==userId||prior.list_id!==listId||wordShape(prior.data)!==wordShape(word))throw new ReviewError('LIST_CONFLICT','Первоначальный импорт уже изменён.',409);}
   else await tx`insert into personal_words(id,list_id,user_id,data) values(${word.id},${listId},${userId},${word})`;
  }
  return {id:listId,name:list.name,words:(await tx`select data from personal_words where list_id=${listId} and user_id=${userId} order by created_at`).map((row:any)=>row.data as Word)};
 });
}
export async function renameList(database:Database,userId:string,listId:string,name:string,expectedName:string){
 return database.sql.begin(async tx=>{const [prior]=await tx`select name from word_lists where id=${listId} and user_id=${userId} for update`;if(!prior)throw new ReviewError('NOT_FOUND','Личный список не найден.',404);if(prior.name!==expectedName&&prior.name!==name)throw new ReviewError('LIST_CONFLICT','Название изменено в другой вкладке.',409);await tx`update word_lists set name=${name} where id=${listId} and user_id=${userId}`;return {id:listId,name};});
}
export async function updateWord(database:Database,userId:string,listId:string,wordId:string,update:WordUpdate,expected?:Pick<Word,'surface'|'kana'|'meaningRu'|'pos'>){
 return database.sql.begin(async tx=>{
 const [row]=await tx`select data from personal_words where id=${wordId} and list_id=${listId} and user_id=${userId} for update`;
 if(!row)return null;
 if(expected&&Object.entries(expected).some(([key,value])=>row.data[key]!==value)&&Object.entries(update).some(([key,value])=>JSON.stringify(row.data[key])!==JSON.stringify(value)))throw new ReviewError('WORD_CONFLICT','Слово изменено в другой вкладке. Загрузите его перед сохранением.',409);
 const word:Word={...row.data,...update};
 if(word.surface!==row.data.surface||word.kana!==row.data.kana){delete word.audioUrl;delete word.audioText;}
 if(update.surface!==undefined||update.kana!==undefined){if(!update.segments)word.segments=[{surface:word.surface,...(word.kana!==word.surface&&word.kana?{reading:word.kana}:{})}];}
 if(!validSegments(word))throw new Error('Подтвердите чтение и разметку: фрагменты должны точно совпадать с написанием и каной.');
 word.reviewStatus='reviewed';
 await tx`update personal_words set data=${word},updated_at=now() where id=${wordId} and user_id=${userId}`;
 return word;
 });
}
