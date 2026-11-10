import type { CourseCatalog } from '../shared/catalog';
import { useEffect, useReducer, useState } from 'react';
import { katakana } from '../shared/kana';
import { kanaMnemonic, kanaMnemonicFrame } from '../shared/kana-mnemonics';
import { KanaFlow } from './canvas/kana-flow';
import { ratingOptions } from './review-ratings';
import { useCardSpeech } from './useCardSpeech';
import type { SceneSound } from './sceneSound';

export function KanaTrainer({ owner, script, catalog, sound, volume, onClose }: { owner: string; script: 'hiragana' | 'katakana'; catalog: CourseCatalog; sound: SceneSound; volume: number; onClose: () => void }) {
 const [,redraw]=useReducer(value=>value+1,0),[flow]=useState(()=>new KanaFlow(redraw));
 useEffect(()=>{void flow.boot(owner,catalog,script);},[owner,catalog,script,flow]);
 // A refreshed catalog must not discard an open card. boot resets on owner changes.
 useEffect(()=>()=>flow.clear(),[flow]);
 useEffect(()=>{if(flow.last)sound.cue(flow.last.kind,flow.last.attemptId);},[flow.last,sound]);
 const item=flow.item,selected=flow.entries(catalog),audio=item?catalog.kanaAudio?.entries[item.glyph]:undefined;
 const speech=useCardSpeech(audio&&'audioUrl' in audio?audio.audioUrl:undefined,false,flow.active,volume,sound);
 const mnemonic=item?kanaMnemonic(item.glyph):undefined,frame=mnemonic?kanaMnemonicFrame(mnemonic):undefined;
 return <section className="kana-trainer" data-testid="kana-trainer" data-script={flow.script} aria-busy={flow.busy}>
  <header className="spread"><div><small>Карточки · FSRS · прогресс в аккаунте</small><h2>Хирагана и катакана</h2></div><button className="quiet" onClick={onClose}>Закрыть</button></header>
  {flow.error?<div role="alert"><p>{flow.error}</p><button onClick={()=>void(flow.conflict?flow.reloadConflict():flow.retry())}>{flow.conflict?'Обновить карточки':'Повторить сохранение'}</button></div>:flow.active&&item?<>
   <div className="spread"><p>{flow.introducing?'Знакомство':flow.mode==='practice'?'Свободная тренировка':'Карточки'} · {flow.introducing?flow.introIndex+1:flow.completed+1} / {flow.total}</p><button disabled={flow.busy} onClick={()=>{flow.active=false;redraw();}}>К рядам</button></div>
   <article className="kana-flashcard sheet" data-testid="kana-question" data-revealed={flow.revealed}>
    <div className="kana-glyph" lang={item.direction==='sign-reading'?'ja':undefined}>{item.direction==='sign-reading'?item.glyph:item.reading}</div>
    {flow.revealed?<><h3 lang="ja">{item.glyph} — {item.reading}</h3>{mnemonic&&<figure className="kana-mnemonic"><div role="img" aria-label={mnemonic.title} className="kana-mnemonic-art" style={{backgroundImage:`url(/assets/kana/${mnemonic.atlas}.png)`,backgroundSize:`600% ${1024/frame!.height*100}%`,backgroundPosition:`${frame!.x/(1536-frame!.width)*100}% ${frame!.y/(1024-frame!.height)*100}%`,aspectRatio:`${frame!.width}/${frame!.height}`}}/><figcaption><strong>{mnemonic.title}.</strong> {mnemonic.hint}</figcaption></figure>}{audio&&'audioUrl' in audio&&<button disabled={speech.playing} onClick={()=>void speech.play()}>▶ Прослушать</button>}{speech.error&&<p role="status">{speech.error}</p>}</>:<p>Вспомните ответ, затем раскройте карточку.</p>}
   </article>
   {flow.introducing?<button className="primary" onClick={()=>flow.nextIntroduction()}> {flow.introIndex+1<flow.total?'Следующий знак':'Проверить себя'} </button>:flow.revealed?<div className="review-ratings">{ratingOptions(flow.mode==='practice'?{kind:'practice'}:item.schedule).map(option=><button key={option.id} disabled={flow.busy} onClick={()=>void flow.grade(option.rating)}>{option.label}<small>{option.interval}</small></button>)}</div>:<button className="primary" disabled={flow.busy} onClick={()=>flow.reveal()}>Раскрыть карточку</button>}
  </>:flow.active?<div className="empty"><h3>{flow.total?'Карточки пройдены':'На сейчас карточек нет'}</h3><p>{flow.mode==='practice'?'Расписание повторений сохранено.':'Ответы сохранены в аккаунте.'}</p>{flow.nextDue&&<p>Ближайший повтор: {new Date(flow.nextDue).toLocaleString('ru-RU')}</p>}<button onClick={()=>flow.finish()}>К рядам</button><button disabled={!flow.dueCount||flow.busy} onClick={()=>void flow.start(catalog,'review')}>Повторить · {flow.dueCount}</button></div>:<>
   <p>При первом знакомстве показываем картинку и объяснение. В повторении сначала вспоминаем знак, затем открываем ответ.</p>
   <div className="row">{(['hiragana','katakana'] as const).map(value=><button key={value} aria-pressed={flow.script===value} disabled={flow.busy||!!flow.queue.length} onClick={()=>flow.configure({script:value},catalog)}>{value==='hiragana'?'Хирагана':'Катакана'}</button>)}</div>
   <label>Направление <select value={flow.direction} disabled={flow.busy||!!flow.queue.length} onChange={event=>flow.configure({direction:event.target.value as typeof flow.direction},catalog)}><option value="sign-reading">Знак → чтение</option><option value="reading-sign">Чтение → знак</option></select></label>
   <div className="row">{(['basic','voiced','yoon'] as const).map(group=><button key={group} aria-pressed={flow.group===group} disabled={flow.busy||!!flow.queue.length} onClick={()=>flow.configure({group},catalog)}>{({basic:'Основные',voiced:'С озвончением',yoon:'Ёон'}[group])}</button>)}</div>
   <fieldset disabled={flow.busy||!!flow.queue.length}><legend>Выберите один или несколько рядов</legend><label><input type="checkbox" checked={flow.rows.length===catalog.kana[flow.group].length} onChange={event=>flow.configure({rows:event.target.checked?catalog.kana[flow.group].map((_,i)=>i):[]},catalog)}/>Все ряды</label><div className="kana-row-picker">{catalog.kana[flow.group].map((row,index)=><label key={index}><input type="checkbox" checked={flow.rows.includes(index)} onChange={event=>flow.configure({rows:event.target.checked?[...flow.rows,index]:flow.rows.filter(value=>value!==index)},catalog)}/><span lang="ja">{row.cells.flatMap(entry=>entry?[flow.script==='katakana'?katakana(entry.kana):entry.kana]:[]).join(' ')}</span></label>)}</div></fieldset>
   <p>Выбрано знаков: {selected.length}. Новых: {flow.selectedNew}. К повторению во всех рядах обеих азбук: {flow.dueCount}.</p>
   {flow.queue.length?<div className="row"><button onClick={()=>{flow.active=true;redraw();}}>Продолжить</button><button onClick={()=>flow.finish()}>Завершить занятие</button></div>:<div className="row"><button className="primary" disabled={!flow.dueCount||flow.busy} onClick={()=>void flow.start(catalog,'review')}>Повторить · {flow.dueCount}</button><button disabled={!flow.selectedNew||flow.busy} onClick={()=>void flow.start(catalog,'learn')}>Учить выбранные · до 20 знаков</button><button disabled={!selected.length||flow.busy} onClick={()=>void flow.start(catalog,'practice')}>Свободная тренировка</button></div>}
   <p className="muted">Выбор рядов не отменяет назначенные повторы. Свободная тренировка не меняет интервалы.</p>
   <details><summary>Статистика знаков</summary><ul>{flow.stats.filter(item=>item.attempts).map(item=><li key={item.glyph}>{item.glyph} — {item.attempts} ответов, {item.errors} «Снова»{item.due&&` · повтор ${new Date(item.due).toLocaleString('ru-RU')}`}</li>)}</ul></details>
  </>}
 </section>;
}
