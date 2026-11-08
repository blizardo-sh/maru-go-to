import type { LearningTask } from '@app/shared/learning-tasks';
import type { LearningAdvance, LearningState } from '@app/shared/learning';
import type { Orthography } from '@app/shared/types';
import { readTaskDraft, saveTaskDraft, taskDraftKey } from '@app/client/task-draft';
import type { StudyAction, StudySurface } from './study-surface';
import type { Rect } from './canvas';
import { bookRows } from './album-book';
import { renderReading,renderJapaneseReading } from './album-reading';
export class TaskView {
  passage:import('./canvas').JapaneseValue[]=[];
  key=''; offset=0; scroll=0; detail=''; writing=false; draft=''; error='';
  bind(owner:string,state:LearningState) {
    const key=taskDraftKey(owner,state);if(key===this.key)return;
    this.key=key;this.passage=[];this.offset=0;this.scroll=0;this.detail='';this.writing=false;this.error='';
    try {this.draft=readTaskDraft(key);} catch {this.draft='';this.error='Не удалось прочитать черновик на устройстве.';}
  }
  save(text:string) {this.draft=text;try{saveTaskDraft(this.key,text);this.error='';}catch{this.error='Черновик не сохранён. Освободите место на устройстве перед продолжением.';}}
}
export function renderTask(surface:StudySurface,task:LearningTask,state:LearningState,view:TaskView,options:{orthography:Orthography;safe:(action:StudyAction)=>StudyAction;changed:()=>void;play:(url:string)=>void;field:(rect:Rect,value:string,changed:(value:string)=>void)=>void;advance:(action:LearningAdvance['action'],details?:Partial<LearningAdvance>)=>void}) {
  const step=state.step;if(step?.kind!=='learning-task')return;
  const show=(text:string)=>{view.detail=text;view.scroll=0;options.changed();};
  const phrase=(line:{surface:string;kana:string;segments:{surface:string;reading?:string}[]})=>options.orthography==='kana'?line.kana:options.orthography==='kanji'?line.surface:line.segments.map(segment=>segment.reading?`${segment.surface}（${segment.reading}）`:segment.surface).join('');
  const showPassage=(values:import('./canvas').JapaneseValue[])=>{view.passage=values;view.scroll=0;options.changed();};
  if(view.passage.length){renderJapaneseReading(surface,view.passage,view,{title:task.titleRu,vertical:task.kind==='reading'&&task.layout==='vertical-menu',back:{id:'task-back',text:'К заданию',run:()=>{view.passage=[];options.changed();}},safe:options.safe,changed:options.changed});return;}
  if(view.detail){renderReading(surface,view.detail,view,{title:task.titleRu,back:{id:'task-back',text:'К заданию',run:()=>{view.detail='';options.changed();}},safe:options.safe,changed:options.changed});return;}
  if(view.writing){
    const a=surface.body;surface.text('Собственный ответ', {...a,height:40},20);
    surface.text(view.error||'Напишите короткий ответ по-японски. Черновик сохраняется только для этого задания.',{...a,y:a.y+46,height:Math.max(44,a.height-110)},17);
    options.field({x:a.x,y:a.y+a.height-52,width:a.width,height:44},view.draft,text=>{view.save(text);options.changed();});
    surface.footer([options.safe({id:'task-writing-back',text:'Готово',enabled:!view.error,run:()=>{view.writing=false;options.changed();}})]);return;
  }
  const evidence=state.taskEvidence?.[task.id];
  const items:StudyAction[]=[{id:'task-instruction',text:'Условие задания',run:()=>show(task.instructionRu)}];
  if(task.kind==='production'){
    if(step.phase==='attempt')items.push(
      {id:'task-supports',text:'Опоры для ответа',run:()=>show(task.supports.join('\n\n'))},
      ...(task.response==='written'?[{id:'task-write',text:view.draft?'Изменить черновик':'Написать ответ',run:()=>{view.writing=true;options.changed();}}]:[]),
      {id:'task-attempt',text:task.response==='spoken'?'Я произнёс свой ответ · К образцу':'Сверить мой ответ с образцом',enabled:!view.error&&(task.response==='spoken'||!!view.draft.trim()),run:()=>options.advance('attempt',{attempted:true,...(task.response==='written'?{taskAnswer:view.draft}:{})})});
    else items.push(
      {id:'task-model',text:'Образец ответа',run:()=>showPassage([task.model])},{id:'task-rubric',text:'Критерии и перевод образца',run:()=>show([task.model.meaningRu,...task.rubric].join('\n\n'))},
      {id:'task-audio',text:'▶ Послушать образец',run:()=>options.play(task.model.audioUrl)},
      ...(['achieved','with-help','retry'] as const).map((rating,index)=>({id:'task-rate:'+rating,text:['По самооценке: получилось','По самооценке: с опорой','Нужно ещё потренироваться'][index]!,run:()=>options.advance('assess',{selfAssessment:rating})})),
      ...(evidence?.rating==='retry'?[{id:'task-retry-note',text:'Попробуйте ответить ещё раз, затем оцените по критериям.',run:()=>show(task.supports.join('\n'))}]:[]));
  }else if(step.phase==='feedback')items.push({id:'task-feedback',text:'Ответ проверен · Объяснение',run:()=>show(task.explanationRu)},{id:'task-next',text:'Дальше',run:()=>options.advance('continue')});
  else items.push(
    {id:'task-passage',text:task.kind==='listening'?'Открыть текст записи':'Прочитать текст / диалог',run:()=>showPassage(task.passage)},
    ...task.passage.map((line,index)=>({id:'task-audio:'+index,text:`▶ Слушать фрагмент ${index+1}`,run:()=>options.play(line.audioUrl)})),
    {id:'task-question',text:task.questionRu,run:()=>show(task.questionRu)},
    ...task.options.map(option=>({id:'task-option:'+option.id,text:option.text,run:()=>options.advance('answer',{taskAnswer:option.id})})),
    ...(evidence?.correct===false?[{id:'task-wrong',text:'Пока неверно · Открыть объяснение',run:()=>show(task.explanationRu)}]:[]));
  if(view.error)items.push({id:'task-error',text:view.error,run:()=>{}});
  bookRows(surface,task.titleRu,items,view,{safe:options.safe,changed:options.changed,back:()=>show(task.instructionRu)});
}
