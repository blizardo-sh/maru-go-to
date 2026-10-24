import { useEffect, useRef, useState } from 'react';
import type { ReviewItem, ReviewResult } from '../shared/types';
import type { Snapshot } from './types';
import type { SceneSound } from './sceneSound';
import type { CardActivity, SavedFeedback } from './companion';
import { WordQuiz } from './GuidedLearning';
import { useReviewSave } from './useReviewSave';
import { TrainingVisual } from './TrainingPreparation';

export function TrainingQuiz({ item, data, userId, active, sound, onActivity, onFeedback, onSaved, onNext }: { item: Extract<ReviewItem,{mode:'ja-ru'|'ru-ja'|'listening'}>; data:Snapshot; userId:string; active:boolean; sound:SceneSound; onActivity:(value:CardActivity)=>void; onSaved:()=>void; onFeedback:(value:SavedFeedback)=>void; onNext:(feedback?:SavedFeedback,result?:ReviewResult)=>void }) {
  const [choices]=useState(()=>[...item.choices!].map(id=>({id,key:Math.random()})).sort((a,b)=>a.key-b.key).map(value=>value.id));
  const [choice,setChoice]=useState<string>(),[confirmed,setConfirmed]=useState<{owner:string;result:ReviewResult;feedback:SavedFeedback}>();
  const callbacks=useRef({active,userId,onNext,sound,onActivity,onFeedback});callbacks.current={active,userId,onNext,sound,onActivity,onFeedback};
  const advanced=useRef(false),reacted=useRef(false);
  const saving=useReviewSave(userId,onSaved,(_,result)=>setConfirmed({owner:userId,result,feedback:{attemptId:result.attemptId,kind:result.correct?'good':'again'}}));
  useEffect(()=>{if(!confirmed)return;let timer:number|undefined;function resume(){window.clearTimeout(timer);const current=callbacks.current;if(document.hidden||!current.active||current.userId!==confirmed!.owner||advanced.current)return;if(!reacted.current){reacted.current=true;current.sound.cue(confirmed!.feedback.kind,confirmed!.result.attemptId);current.onFeedback(confirmed!.feedback);current.onActivity({reviewId:item.id,activity:'revealed',key:confirmed!.result.attemptId});}timer=window.setTimeout(()=>{const current=callbacks.current;if(document.hidden||!current.active||current.userId!==confirmed!.owner||advanced.current)return;advanced.current=true;current.onNext(confirmed!.feedback,confirmed!.result);},confirmed!.feedback.kind==='good'?850:1700);}resume();document.addEventListener('visibilitychange',resume);return()=>{window.clearTimeout(timer);document.removeEventListener('visibilitychange',resume);};},[confirmed,active,userId]);
  function choose(id:string){if(!active||document.hidden||choice||saving.pending)return;setChoice(id);void saving.save({attemptId:crypto.randomUUID(),reviewId:item.id,version:item.version,...(item.publicationId?{publicationId:item.publicationId}:{}),mode:item.mode,rating:3,choiceWordId:id,helped:false});}
  return <div className="stack"><WordQuiz value={{...item.word,audioUrl:item.word.audioUrl??''}} wordId={item.word.id} mode={item.mode} choices={choices} application={item.application} visual={<TrainingVisual value={item.visual}/>} data={data} active={active} busy={saving.busy||saving.pending} sound={sound} onActivity={onActivity} stepId={item.id} selection={choice?{choice,confirmed:!!confirmed,correct:confirmed?.result.correct??false}:null} choose={choose}/>{saving.error&&<div className="notice error" role="alert"><p>{saving.error}</p><button disabled={!active} onClick={saving.retry}>Повторить сохранение</button></div>}</div>;
}
