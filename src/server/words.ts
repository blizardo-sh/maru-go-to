import type { Word, WordList, WordUpdate, Course } from '../shared/types';
import type { Database } from './db';
import { validSegments } from './material';
export async function listsFor(database:Database,userId:string):Promise<WordList[]>{
 const lists=await database.sql`select id,name from word_lists where user_id=${userId} order by created_at`;
 const rows=await database.sql`select list_id,data from personal_words where user_id=${userId} order by created_at`;
 return lists.map((l:any)=>({id:l.id,name:l.name,words:rows.filter((w:any)=>w.list_id===l.id).map((w:any)=>w.data as Word)}));
}
export function parseWordList(text:string,course:Course):Word[]{
 const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
 if(lines.length>500)throw new Error('Не больше 500 слов в одном списке.');
 return lines.map(line=>{
  const parts=line.includes('\t')?line.split('\t'):line.includes(';')?line.split(';'):line.split(/\s*[—–=]\s*/u);
  const surface=parts[0]?.trim()??'';const kana=parts.length>=3?parts[1]!.trim():'';const meaning=parts.length>=3?parts.slice(2).join(' — ').trim():parts[1]?.trim()??'';
  if(!surface||!meaning||surface.length>100||meaning.length>500||kana.length>200)throw new Error('Используйте «японский → табуляция → перевод» или «японский — перевод», с чтением третья колонка.');
  const match=course.words.find(w=>(w.surface===surface||w.kana===surface)&&w.meaningRu===meaning);
  if(match)return {...structuredClone(match),id:`personal.${crypto.randomUUID()}`,lessonIds:[],sourceRefs:[]};
  const reading=kana||(/^[\p{Script=Hiragana}\p{Script=Katakana}ー\s]+$/u.test(surface)?surface:'');
  return {id:`personal.${crypto.randomUUID()}`,lessonIds:[],surface,kana:reading,meaningRu:meaning,segments:[{surface,...(reading&&reading!==surface?{reading}:{})}],kind:'word' as const,pos:'',reviewStatus:'draft' as const,sourceRefs:[]};
 });
}
export async function addList(database:Database,userId:string,name:string,text:string,course:Course){
 const words=parseWordList(text,course);const id=crypto.randomUUID();
 await database.sql.begin(async tx=>{await tx`insert into word_lists(id,user_id,name) values(${id},${userId},${name})`;
 for(const word of words)await tx`insert into personal_words(id,list_id,user_id,data) values(${word.id},${id},${userId},${word})`;});
 return {id,name,words};
}
export async function updateWord(database:Database,userId:string,listId:string,wordId:string,update:WordUpdate){
 return database.sql.begin(async tx=>{
 const [row]=await tx`select data from personal_words where id=${wordId} and list_id=${listId} and user_id=${userId} for update`;
 if(!row)return null;
 const word:Word={...row.data,...update};
 if(word.surface!==row.data.surface||word.kana!==row.data.kana){delete word.audioUrl;delete word.audioText;}
 if(update.surface!==undefined||update.kana!==undefined){if(!update.segments)word.segments=[{surface:word.surface,...(word.kana!==word.surface&&word.kana?{reading:word.kana}:{})}];}
 if(!validSegments(word))throw new Error('Подтвердите чтение и разметку: фрагменты должны точно совпадать с написанием и каной.');
 word.reviewStatus='reviewed';
 await tx`update personal_words set data=${word},updated_at=now() where id=${wordId} and user_id=${userId}`;
 return word;
 });
}
