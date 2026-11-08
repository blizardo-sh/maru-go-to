import { dictionaryMeanings, lexemeIds } from '@app/shared/meanings';
import { bookForLesson, unitLabel } from '@app/shared/books';
import { sectionCards } from './album-navigation';
import { renderReading } from './album-reading';
import { catalogFor } from '@app/shared/catalog';
import { katakana, examplesFor, exampleValue } from '@app/client/referenceData';
import { studyWord } from '@app/client/learning';
import type { Snapshot } from '@app/client/types';
import type { Rect } from './canvas';
import type { StudyAction, StudySurface } from './study-surface';
import { AlbumLibrary, bookRows } from './album-book';
import { personalCommands, sendPersonal, type PersonalCommand } from './personal-commands';

export class AlbumReference {
  section = '';
  offset = 0;
  search = '';
  detail = '';
  detailAudio: {meaning:string;url:string}[]=[];
  scroll = 0;
  private savedDraft: string | null = null;
  kanaGroup: 'basic'|'voiced'|'yoon'|'small' = 'basic';
  listId = '';
  wordId = '';
  form: 'create' | 'append' | 'rename' | 'word' | null = null;
  values: Record<string,string> = {};
  error = '';
  busy = false;
  private owner = '';
  private revision = 0;
  constructor(readonly library: AlbumLibrary, private changed: () => void) {}
  clear() { this.owner = ''; this.section = ''; this.offset = 0; this.search = ''; this.detail = ''; this.listId = ''; this.wordId = ''; this.form = null; this.values = {}; this.error = ''; this.busy = false; this.revision++; }
  bind(owner: string) { if(this.owner!==owner){this.clear();this.owner=owner;const saved=localStorage.getItem('japanese-personal-draft:'+owner);this.savedDraft=saved;if(saved){const draft=JSON.parse(saved);this.values=draft.values??{};this.listId=draft.listId??'';this.wordId=draft.wordId??'';this.form=draft.form??null;}} }
  draft(field: string,value: string) {
    try { if(localStorage.getItem('japanese-personal-draft:'+this.owner)!==this.savedDraft)throw new Error('Черновик изменён в другой вкладке. Загрузите его перед редактированием.'); const values={...this.values,[field]:value};const raw=JSON.stringify({values,listId:this.listId,wordId:this.wordId,form:this.form});localStorage.setItem('japanese-personal-draft:'+this.owner,raw);this.savedDraft=raw;this.values=values;this.error='';this.revision++; }
    catch(error) {this.error=error instanceof Error?error.message:'Черновик не сохранён. Проверьте хранилище устройства.';}this.changed();
  }
  reloadDraft(){const owner=this.owner;this.owner='';this.bind(owner);this.changed();}
  async save() {
    if(this.busy||document.hidden)return;const owner=this.owner,revision=this.revision,signature=JSON.stringify({form:this.form,listId:this.listId,wordId:this.wordId,values:this.values});this.busy=true;this.error='';this.changed();
    try {
      const draftRaw=localStorage.getItem('japanese-personal-draft:'+owner);
      if(draftRaw!==this.savedDraft)throw new Error('Черновик изменён в другой вкладке. Загрузите его перед сохранением.');
      const pending=personalCommands(owner),sameDraft=!pending.length||pending.every(command=>command.draftSignature===signature);
      if(pending.length) for(const command of pending)await sendPersonal(owner,command);
      else {
        const data=this.library.data!,list=data.lists.find(list=>list.id===this.listId),word=list?.words.find(word=>word.id===this.wordId);
        const id=crypto.randomUUID(),path='/api/lists'+(list?'/'+encodeURIComponent(list.id):'');
        const command:PersonalCommand={id,path,method:'POST',expectedId:list?.id??id,publicationId:data.course.publicationId,draftSignature:signature,payload:{}};
        if(this.form==='create')command.payload={requestId:id,name:this.values.name?.trim(),text:this.values.text?.trim()};
        else if(this.form==='append'){command.path+='/words';command.payload={requestId:id,text:this.values.text?.trim()};}
        else if(this.form==='rename'){command.method='PATCH';command.payload={name:this.values.name?.trim(),expectedName:list!.name};}
        else if(this.form==='word'){command.method='PATCH';command.path+='/words/'+encodeURIComponent(word!.id);command.expectedId=word!.id;command.payload={surface:this.values.surface?.trim(),kana:this.values.kana?.trim(),meaningRu:this.values.meaningRu?.trim(),pos:this.values.pos??'',expected:{surface:word!.surface,kana:word!.kana,meaningRu:word!.meaningRu,pos:word!.pos}};}
        else return;
        await sendPersonal(owner,command);
      }
      if(owner!==this.owner||revision!==this.revision)return;
      await this.library.load(owner);
      if(owner!==this.owner||revision!==this.revision)return;
      if(!sameDraft||localStorage.getItem('japanese-personal-draft:'+owner)!==draftRaw){this.error='Первоначальные данные сохранены. Изменённый черновик сохранён отдельно; загрузите его перед следующим сохранением.';return;}
      this.form=null;this.values={};localStorage.removeItem('japanese-personal-draft:'+owner);this.savedDraft=null;
    } catch(error){if(owner===this.owner)this.error=error instanceof Error?error.message:'Не удалось сохранить. Повторите.';}
    finally{if(owner===this.owner){this.busy=false;this.changed();}}
  }
}

export function renderReference(surface:StudySurface,reference:AlbumReference,options:{safe:(a:StudyAction)=>StudyAction;changed:()=>void;home:()=>void;field:(id:string,rect:Rect,value:string,placeholder:string,changed:(value:string)=>void)=>void;train:(listId:string)=>void;trainGrammar:(listId:string)=>void;play:(url?:string)=>void}){
  const data=reference.library.data!,catalog=catalogFor(data.course),a=surface.body;
  const change=()=>{reference.offset=0;reference.search='';reference.detail='';reference.scroll=0;options.changed();};
  const back=()=>{if(reference.form){reference.form=null;options.changed();}else if(reference.detail){reference.detail='';reference.scroll=0;options.changed();}else if(reference.listId){reference.listId='';change();}else if(reference.section){reference.section='';change();}else options.home();};
  if(reference.error){surface.text(reference.error,a,18);surface.footer([{id:reference.error.includes('черновик')?'personal-reload-draft':'personal-retry',text:reference.error.includes('черновик')?'Загрузить':'Повторить',fontSize:16,run:()=>{if(reference.error.includes('черновик'))reference.reloadDraft();else void reference.save();}},{id:'personal-edit',text:'К черновику',fontSize:16,run:()=>{reference.error='';options.changed();}}].map(options.safe));return;}
  if(reference.form){
    const fields=reference.form==='word'?[['surface','Написание'],['kana','Чтение'],['meaningRu','Перевод'],['pos','Часть речи: noun / verb / adjective / other']]:reference.form==='rename'?[['name','Название']]:reference.form==='append'?[['text','Слово; чтение; перевод — по одному в строке']]:[['name','Название списка'],['text','Слово; чтение; перевод — по одному в строке']];
    const title=reference.form==='word'?'Подтвердить личное слово':reference.form==='rename'?'Название списка':reference.form==='append'?'Добавить слова':'Создать список';
    surface.text(title,{...a,y:a.y+8,height:44},a.height<240?16:20);
    const gap=10,available=a.height-60,heights=fields.map(([id])=>id==='text'?Math.max(80,available-64*(fields.length-1)):54);let y=a.y+56;
    fields.forEach(([id,label],index)=>{const height=heights[index]!,columns=reference.form==='word'&&a.height<300?2:1;options.field(id!,{x:a.x+(index%columns)*(a.width+gap)/columns,y:columns===1?y:a.y+56+Math.floor(index/columns)*54,width:(a.width-gap*(columns-1))/columns,height:height-gap},reference.values[id!]??'',label!,value=>reference.draft(id!,value));y+=height;});
    surface.footer([{id:'personal-cancel',text:'Назад',fontSize:16,run:back},{id:'personal-save',text:reference.busy?'Сохраняем…':'Сохранить',fontSize:16,enabled:!reference.busy,run:()=>void reference.save()}].map(options.safe));return;
  }
  if(reference.detail){renderReading(surface,reference.detail,reference,{actions:reference.section==='words'?reference.detailAudio.map((audio,index)=>({id:'reference-meaning-audio:'+index,text:'▶ '+(index+1),accessibleLabel:'Послушать: '+audio.meaning,run:()=>options.play(audio.url)})):[],back:{id:'reference-detail-back',text:'Назад',run:back},safe:options.safe,changed:options.changed});return;}
  if(reference.section==='hiragana'||reference.section==='katakana'){
    const convert=reference.section==='katakana'?katakana:(value:string)=>value, rows=catalog.kana[reference.kanaGroup];
    surface.text(reference.section==='katakana'?'Катакана':'Хирагана',{...a,y:a.y+8,height:32},22);
    surface.row(([['basic','Основные'],['voiced','Дакутэн'],['yoon','Ёон'],['small','Малые']] as const).map(([group,text])=>options.safe({id:'kana-table:'+group,text,fontSize:12,selected:reference.kanaGroup===group,run:()=>{reference.kanaGroup=group;reference.offset=0;options.changed();}})),{x:a.x,y:a.y+48,width:a.width,height:44});
    const count=Math.max(1,Math.floor((a.height-102)/66)),visible=rows.slice(reference.offset,reference.offset+count),columns=Math.max(...rows.map(row=>row.cells.length)),width=a.width/columns;
    visible.forEach((row,index)=>row.cells.forEach((entry,column)=>{const rect={x:a.x+column*width,y:a.y+102+index*66,width:width-2,height:62};if(!entry)surface.text('—',rect,16,false,true);else surface.action(options.safe({id:'kana-cell:'+convert(entry.kana),text:convert(entry.kana)+(entry.reading?'\n'+entry.reading:''),fontSize:16,accessibleLabel:convert(entry.kana)+' · '+(entry.reading||'малый знак'),run:()=>{const audio=catalog.kanaAudio?.entries[convert(entry.kana)];if(audio&&audio.soundKey!==null)options.play(audio.audioUrl);else{reference.detail=audio?.unavailableReason??'Для этого малого знака нет отдельной озвучки.';options.changed();}}}),rect,true,16);}));
    surface.footer([{id:'book-prev',text:'↑',enabled:reference.offset>0,run:()=>{reference.offset=Math.max(0,reference.offset-count);options.changed();}},{id:'book-back',text:'Назад',fontSize:16,run:back},{id:'book-next',text:'↓',enabled:reference.offset+count<rows.length,run:()=>{reference.offset+=count;options.changed();}}].map(options.safe));return;
  }
  let title='Справочник',items:StudyAction[]=[];
  if(!reference.section)items=[['words','Изученные слова'],['skills','Изученные конструкции'],['particles','Частицы'],['hiragana','Хирагана'],['katakana','Катакана'],['lists','Личные списки']].map(([id,text])=>({id:'reference:'+id,text:text!,run:()=>{reference.section=id!;change();}}));
  else if(reference.section==='words'){
    const known=new Set(data.progress.introducedWordIds),ids=lexemeIds(data.course,known),words=[...new Map([...data.course.words,...data.lists.flatMap(list=>list.words)].map(word=>[word.id,word])).values()].filter(word=>ids.has(word.id));title='Изученные слова · '+words.length;
    items=words.map(word=>({id:'reference-word:'+word.id,text:`${word.surface} · ${word.kana} — ${dictionaryMeanings(data.course,word,known).map(value=>value.meaningRu).join('; ')}`,run:()=>{reference.detail=`${word.surface} · ${word.kana}\n`+dictionaryMeanings(data.course,word,known).map(value=>`${value.meaningRu} · ${value.learned?'Изучено':'Новое значение'}${value.meaningContext?'\n'+value.meaningContext.surface+' · '+value.meaningContext.kana+'\n'+value.meaningContext.meaningRu:''}`).join('\n\n')+'\n\n'+word.lessonIds.map(id=>{const lesson=data.course.lessons.find(l=>l.id===id);if(!lesson)return '';const book=bookForLesson(data.course,lesson);return `${book.shortTitle} · ${unitLabel(book)} ${lesson.number}`;}).join('; ');reference.detailAudio=dictionaryMeanings(data.course,word,known).filter(value=>!!value.audioUrl).map(value=>({meaning:value.meaningRu,url:value.audioUrl!}));options.changed();}}));
  }else if(reference.section==='skills'){
    const skills=data.course.skills.filter(skill=>data.progress.introducedSkillIds.includes(skill.id));title='Изученные конструкции · '+skills.length;
    items=skills.map(skill=>({id:'reference-skill:'+skill.id,text:skill.title,run:()=>{reference.detail=[skill.title,skill.explanationRu,...examplesFor(data.course,skill.id).slice(0,2).map(exercise=>exampleValue(data.course,exercise).surface+'\n'+(exercise.translationRu??exercise.promptRu))].join('\n\n');options.changed();}}));
  }else if(reference.section==='particles'){
    title='Частицы';items=Object.entries(catalog.particleSkills).map(([particle,ids])=>({id:'reference-particle:'+particle,text:particle+' — '+(data.course.words.find(word=>word.pos==='particle'&&word.surface===particle)?.meaningRu??'частица'),run:()=>{reference.detail=ids.flatMap(id=>data.course.skills.filter(skill=>skill.id===id)).map(skill=>skill.title+'\n'+skill.explanationRu).join('\n\n');options.changed();}}));
  }else if(reference.section==='hiragana'||reference.section==='katakana'){
    title=reference.section==='hiragana'?'Хирагана':'Катакана';const convert=reference.section==='katakana'?katakana:(v:string)=>v;
    items=Object.entries(catalog.kana).flatMap(([group,rows])=>rows.map((row,index)=>({id:`reference-kana:${group}:${index}`,text:row.cells.map(entry=>entry?`${convert(entry.kana)} · ${entry.reading||'малый знак'}`:'—').join('    '),run:()=>{reference.detail=row.cells.filter(Boolean).map(entry=>`${convert(entry!.kana)} — ${entry!.reading||'малый знак'}`).join('\n');options.changed();}})));
  }else if(reference.section==='lists'){
    title='Личные списки';const list=data.lists.find(list=>list.id===reference.listId);
    const form=(kind:NonNullable<AlbumReference['form']>,values:Record<string,string>)=>{reference.form=kind;reference.values=values;options.changed();};
    if(!list)items=[{id:'personal-create',text:'Создать / импортировать список',run:()=>form('create',{name:'К следующему занятию',text:''})},...data.lists.map(list=>({id:'personal-list:'+list.id,text:`${list.name} · ${list.words.length} слов`,run:()=>{reference.listId=list.id;change();}}))];
    else {title=list.name;items=[
      {id:'personal-train',text:'Практиковать список',enabled:list.words.some(studyWord),run:()=>options.train(list.id)},
      {id:'personal-grammar',text:'Конструктор для списка',enabled:list.words.some(word=>studyWord(word)&&word.pos==='noun'),run:()=>options.trainGrammar(list.id)},
      {id:'personal-append',text:'Добавить / импортировать слова',run:()=>form('append',{text:''})},
      {id:'personal-rename',text:'Изменить название',run:()=>form('rename',{name:list.name})},
      ...list.words.map(word=>({id:'personal-word:'+word.id,text:`${word.surface} · ${word.kana||'Уточните чтение'} — ${word.meaningRu}${word.reviewStatus==='draft'?' · Черновик':''}`,run:()=>{reference.wordId=word.id;form('word',{surface:word.surface,kana:word.kana,meaningRu:word.meaningRu,pos:word.pos});}})),
    ];}
  }
  if (!reference.section) {
    if (surface.body.height < 360) bookRows(surface, 'Справочник', items, reference, { safe: options.safe, changed: options.changed, back });
    else sectionCards(surface, 'Справочник', 'Слова, грамматика и японские азбуки', items, options.safe);
    return;
  }
  items=items.filter(item=>item.text.toLowerCase().includes(reference.search.toLowerCase()));
  bookRows(surface,title,items,reference,{safe:options.safe,changed:options.changed,back,search:{value:reference.search,draw:rect=>options.field('search',rect,reference.search,'Поиск',value=>{reference.search=value;reference.offset=0;options.changed();})}});
}
