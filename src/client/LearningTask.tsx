import { useEffect, useRef, useState } from 'react';
import type { LearningAdvance, LearningState } from '../shared/learning';
import type { LearningTask as Task } from '../shared/learning-tasks';
import type { Snapshot } from './types';
import { ExampleLine } from './ExampleLine';
import { readTaskDraft, saveTaskDraft, taskDraftKey } from './task-draft';
export function LearningTask({task,state,owner,data,active,blocked,advance}:{active:boolean;task:Task;state:LearningState;owner:string;data:Snapshot;blocked:boolean;advance:(action:LearningAdvance['action'],details?:Partial<LearningAdvance>)=>unknown}){
 const key=taskDraftKey(owner,state),[draft,setDraft]=useState(()=>{try{return readTaskDraft(key);}catch{return '';}}),[error,setError]=useState('');
 const article=useRef<HTMLElement>(null);
 useEffect(()=>{
  const node=article.current,stop=()=>node?.querySelectorAll('audio').forEach(audio=>audio.pause());
  const visibility=()=>{if(document.hidden)stop();};
  node?.querySelectorAll('audio').forEach(audio=>{audio.volume=data.settings.speechVolume;});
  if(!active||document.hidden)stop();document.addEventListener('visibilitychange',visibility);
  return ()=>{stop();document.removeEventListener('visibilitychange',visibility);};
 },[active,state.step?.id,owner,data.settings.speechVolume]);
 const step=state.step;if(step?.kind!=='learning-task')return null;
 const evidence=state.taskEvidence?.[task.id];
 const line=(value:import('../shared/learning').LearningExample,index=0)=><div key={index}><ExampleLine example={value} mode={data.settings.orthography}/><audio controls preload="none" src={value.audioUrl}/></div>;
 return <article ref={article} className="work-board stack" onPlay={event=>{article.current?.querySelectorAll('audio').forEach(audio=>{if(audio!==event.target)audio.pause();});}}><h2>{task.titleRu}</h2><p>{task.instructionRu}</p>{task.kind==='production'?step.phase==='attempt'?<>
  <ul>{task.supports.map(text=><li key={text}>{text}</li>)}</ul>{task.response==='written'&&<label>Ваш ответ<textarea value={draft} maxLength={4000} disabled={blocked} onChange={event=>{setDraft(event.target.value);try{saveTaskDraft(key,event.target.value);setError('');}catch{setError('Черновик не сохранён на устройстве.');}}}/></label>}
  <button disabled={blocked||!!error||task.response==='written'&&!draft.trim()} onClick={()=>advance('attempt',{attempted:true,...(task.response==='written'?{taskAnswer:draft}:{})})}>Я подготовил ответ · К образцу</button>
 </>:<><h3>Образец</h3>{line(task.model)}<ul>{task.rubric.map(text=><li key={text}>{text}</li>)}</ul><p>Сверьте свой ответ. Это самооценка, а не автоматическая проверка речи.</p>{(['achieved','with-help','retry'] as const).map((rating,index)=><button key={rating} disabled={blocked} onClick={()=>advance('assess',{selfAssessment:rating})}>{['Получилось','С опорой','Попробую ещё'][index]}</button>)}</>:step.phase==='feedback'?<><p role="status">Ответ проверен. {task.explanationRu}</p><button disabled={blocked} onClick={()=>advance('continue')}>Дальше</button></>:<>
  <details open={task.kind==='reading'}><summary>Текст / диалог</summary><div style={task.layout==='vertical-menu'?{writingMode:'vertical-rl',minHeight:240,letterSpacing:'0.12em'}:undefined}>{task.passage.map((value,index)=>task.layout==='vertical-menu'?<p key={index}><ExampleLine example={value} mode={data.settings.orthography}/></p>:line(value,index))}</div></details>{task.kind==='listening'&&task.passage.map((value,index)=><audio key={index} aria-label={`Фрагмент ${index+1}`} controls preload="none" src={value.audioUrl}/>)}
  <h3>{task.questionRu}</h3>{task.options.map(option=><button key={option.id} disabled={blocked} onClick={()=>advance('answer',{taskAnswer:option.id})}>{option.text}</button>)}{evidence?.correct===false&&<p role="status">Пока неверно. {task.explanationRu}</p>}
 </>}{error&&<p role="alert">{error}</p>}</article>;
}
