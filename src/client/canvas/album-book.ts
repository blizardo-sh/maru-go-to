import { contentPages } from './album-navigation';
import { renderReading } from './album-reading';
import { api, ApiRequestError, json } from '@app/client/api';
import { mainLessonMaterial, type PriorLearningRequest, type PriorLearningResult, type PriorLearningTarget } from '@app/shared/priorLearning';
import { learningHeaders } from '@app/client/guidedApi';
import { learningParts } from '@app/shared/learning';
import { studyWord } from '@app/client/learning';
import type { Snapshot } from '@app/client/types';
import type { LessonVideo } from '@app/shared/types';
import type { Rect } from './canvas';
import type { StudyAction, StudySurface } from './study-surface';

export class AlbumLibrary {
  data: Snapshot | null = null;
  owner = '';
  busy = false;
  error = '';
  search = '';
  offset = 0;
  lessonId: string | null = null;
  tab: 'overview' | 'parts' | 'words' | 'extra' | 'videos' = 'overview';
  detail = '';
  detailTarget: PriorLearningTarget | null = null;
  markMessage = '';
  markError = '';
  pendingMark: PriorLearningRequest | null = null;
  scroll = 0;
  video: LessonVideo | null = null;
  private epoch = 0;
  constructor(private changed: () => void) {}
  clear() { ++this.epoch; this.owner = ''; this.data = null; this.error = ''; this.busy = false; this.search = ''; this.offset = 0; this.lessonId = null; this.detail = ''; this.detailTarget = null; this.markMessage = ''; this.markError = ''; this.pendingMark = null; this.video = null; }
  async mark(input: Omit<PriorLearningRequest, 'requestId'> | undefined, saved: () => void) {
    if (this.busy || !this.data || !this.owner) return;
    if (!this.pendingMark && input) this.pendingMark = { ...input, requestId: crypto.randomUUID() };
    if (!this.pendingMark) return;
    const owner = this.owner, epoch = this.epoch;
    this.busy = true; this.markError = ''; this.markMessage = ''; this.changed();
    try {
      const result = await api<PriorLearningResult>('/api/prior-learning', { ...json('POST', this.pendingMark), headers: learningHeaders(owner, this.data.course.publicationId) });
      if (owner !== this.owner || epoch !== this.epoch) return;
      this.pendingMark = null;
      this.markMessage = result.removedCards ? `Отметка отменена. Убрано карточек: ${result.removedCards}.` : result.addedCards ? `Добавлено: ${result.addedCards} карточек · На сегодня, с учётом типов повторения.` : 'Материал уже изучен. Прежнее расписание сохранено.';
      await this.load(owner);
      if (owner === this.owner) saved();
    } catch (error) {
      if (owner !== this.owner || epoch !== this.epoch) return;
      this.markError = error instanceof Error ? error.message : 'Не удалось сохранить отметку.'; this.busy = false;
      if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) { this.pendingMark = null; await this.load(owner); if (owner === this.owner) saved(); }
      this.changed();
    }
  }
  async load(owner: string) {
    if (this.owner !== owner) this.clear(); const epoch = ++this.epoch; this.owner = owner; this.busy = true; this.error = ''; this.changed();
    try {
      const headers = learningHeaders(owner), course = await api<Snapshot['course']>('/api/course', {headers});
      const pinned = {headers:learningHeaders(owner,course.publicationId)};
      const [settings,progress,lists,learning] = await Promise.all([
        api<Snapshot['settings']>('/api/settings',pinned), api<Snapshot['progress']>('/api/progress',pinned),
        api<{lists:Snapshot['lists']}>('/api/lists',pinned), api<{lessons:Snapshot['learning']}>('/api/learning',pinned),
      ]);
      if (epoch === this.epoch && owner === this.owner) this.data = {course,settings,progress,lists:lists.lists,learning:learning.lessons};
    }
    catch (error) { if (epoch === this.epoch) this.error = error instanceof Error ? error.message : 'Не удалось загрузить материалы.'; }
    finally { if (epoch === this.epoch) { this.busy = false; this.changed(); } }
  }
}

export function bookRows(surface: StudySurface, title: string, items: StudyAction[], state: { offset: number }, options: {
  safe: (action: StudyAction) => StudyAction; changed: () => void; search?: { value: string; draw: (rect: Rect) => void }; back: () => void; centerAction?: StudyAction; tabs?: StudyAction[];
}) {
  const pages = contentPages(surface), a = pages[0]!, font = a.width < 330 ? 15 : 17;
  const headingSize = a.height < 240 ? 17 : 22;
  const heading = surface.measure(title, a.width - 16, headingSize), header = heading + 12 + (options.search ? 50 : 0) + (options.tabs ? 52 : 0);
  surface.text(title, { x: a.x + 8, y: a.y + 6, width: a.width - 16, height: heading }, headingSize);
  if (options.tabs) surface.row(options.tabs.map(options.safe), { x: a.x, y: a.y + heading + 12, width: a.width, height: 44 });
  if (options.search) options.search.draw({ x: a.x, y: a.y + heading + 12, width: a.width, height: 44 });
  const rowHeight = Math.min(Math.max(44, a.height - header), Math.max(44, ...items.map(action => surface.measure(action.text, a.width - 24, font) + 12)));
  const rows = Math.max(1, Math.floor((a.height - header + 8) / (rowHeight + 8))), capacity = rows * pages.length;
  state.offset = Math.floor(Math.max(0, Math.min(state.offset, Math.max(0, items.length - 1))) / capacity) * capacity;
  const visible = items.slice(state.offset, state.offset + capacity), perPage = Math.ceil(visible.length / pages.length);
  pages.forEach((page, side) => {
    const entries = visible.slice(side * perPage, (side + 1) * perPage);
    if (side && entries.length) surface.text(`${state.offset + side * perPage + 1}–${state.offset + side * perPage + entries.length} из ${items.length}`, { ...page, y: page.y + 12, height: 32 }, 17);
    entries.forEach((action, index) => surface.listAction(options.safe(action), { x: page.x, y: page.y + header + index * (rowHeight + 8), width: page.width, height: rowHeight }, false, font));
  });
  if (!items.length) surface.text('Материалов с таким запросом нет.', { ...a, y: a.y + header, height: 80 }, 18);
  const back = options.centerAction ?? { id: 'book-back', text: 'Назад', fontSize: 16, run: options.back };
  surface.footer((items.length > capacity ? [
    { id: 'book-prev', text: '←', accessibleLabel: 'Предыдущая страница', enabled: state.offset > 0, run: () => { state.offset = Math.max(0, state.offset - capacity); options.changed(); } },
    back,
    { id: 'book-next', text: '→', accessibleLabel: 'Следующая страница', enabled: state.offset + capacity < items.length, run: () => { state.offset += capacity; options.changed(); } },
  ] : [back]).map(options.safe));
}

export function renderBook(surface: StudySurface, library: AlbumLibrary, options: {
  safe: (action: StudyAction) => StudyAction; changed: () => void; home: () => void; learn: (id: string) => void;
  saved: () => void;
  train: (id: string) => void; trainGrammar: (id: string) => void; field: (rect: Rect,value: string,changed: (value:string)=>void) => void; video: (material: LessonVideo) => void;
}) {
  const data=library.data!;
  const change=()=>{library.offset=0;library.search='';library.detail='';library.detailTarget=null;library.scroll=0;options.changed();};
  const back=()=>{if(library.detail){library.detail='';library.scroll=0;options.changed();}else if(library.tab!=='overview'){library.tab='overview';change();}else options.home();};
  const known=(target:PriorLearningTarget)=>(target.kind==='word'?data.progress.introducedWordIds:data.progress.introducedSkillIds).includes(target.itemId);
  const markAction=(target:PriorLearningTarget):StudyAction=>{const mark=data.progress.priorLearning?.find(value=>value.kind===target.kind&&value.itemId===target.itemId);return {id:'book-mark:'+target.kind+':'+target.itemId,text:mark?.canUndo?'Отменить отметку':known(target)?'Изучено':'Уже проходил',enabled:!known(target)||!!mark?.canUndo,run:()=>void library.mark({...target,action:mark?.canUndo?'unmark':'mark'},options.saved)};};
  if(library.pendingMark&&library.markError){renderReading(surface,library.markError,library,{action:{id:'book-mark-retry',text:'Повторить сохранение',run:()=>void library.mark(undefined,options.saved)},back:{id:'book-mark-home',text:'К урокам',run:options.home},safe:options.safe,changed:options.changed});return;}
  if(library.detail){renderReading(surface,[library.markError||library.markMessage,library.detail].filter(Boolean).join('\n\n'),library,{...(library.detailTarget?{action:markAction(library.detailTarget)}:{}),back:{id:'book-detail-back',text:'К материалам',run:back},safe:options.safe,changed:options.changed});return;}
  const lesson=data.course.lessons.find(lesson=>lesson.id===library.lessonId), state=data.learning?.find(state=>state.lessonId===lesson?.id);
  let title='Уроки · '+data.course.lessons.length+' уроков',items:StudyAction[]=[];
  if(!lesson) items=data.course.lessons.filter(lesson=>`${lesson.number} ${lesson.title} ${lesson.topic}`.toLowerCase().includes(library.search.toLowerCase())).map(lesson=>{
    const state=data.learning?.find(state=>state.lessonId===lesson.id);
    return {id:'book-lesson:'+lesson.id,text:`${lesson.number}. ${lesson.title} · ${state?.completed?'Пройден':state?.completedSteps?'Продолжить':'Новый'}`,run:()=>{library.lessonId=lesson.id;change();}};
  });
  else {
    title=`${lesson.number}. ${lesson.title}`;
    const route=data.course.learning?.find(route=>route.lessonId===lesson.id), mainIds=new Set(route?.goals.flatMap(goal=>goal.parts.flatMap(part=>part.words.map(word=>word.wordId))));
    if(library.tab==='overview') items=[
      {id:'book-learn',text:state?.completed?'Итог урока':state?.completedSteps?'Продолжить урок':'Начать урок',enabled:!!route,run:()=>options.learn(lesson.id)},
      {id:'book-mark-lesson',text:'Уже проходил основной материал урока',enabled:!!route&&(!state?.completed||mainLessonMaterial(data.course,lesson.id).some(target=>!known(target))),run:()=>void library.mark({kind:'lesson',itemId:lesson.id,action:'mark'},options.saved)},
      {id:'book-parts',text:`Объяснения и части урока · ${state?.totalParts??route?.goals.flatMap(goal=>goal.parts).length??0}`,run:()=>{library.tab='parts';change();}},
      {id:'book-main',text:`Словарь урока · ${mainIds.size} слов и фраз`,run:()=>{library.tab='words';change();}},
      {id:'book-extra',text:'Все слова и конструкции',run:()=>{library.tab='extra';change();}},
      {id:'book-videos',text:`Видео урока · ${lesson.videos?.length??0}`,run:()=>{library.tab='videos';change();}},
      {id:'book-train',text:'Практиковать словарь',run:()=>options.train(lesson.id)},
      {id:'book-grammar',text:'Практиковать конструкции',enabled:data.course.exercises.some(exercise=>exercise.lessonId===lesson.id),run:()=>options.trainGrammar(lesson.id)},
    ];
    else if(library.tab==='parts') items=route?.goals.flatMap(goal=>goal.parts.map(part=>{
      const progress=state?.partProgress?.find(value=>value.partId===part.id);
      return {id:'book-part:'+part.id,text:`${goal.titleRu} · ${part.words.length} слов · ${progress?.completedSteps??0}/${progress?.totalSteps??learningParts({...route,goals:[{...goal,parts:[part]}]})[0]?.length??0}`,run:()=>{library.detail=[goal.titleRu,goal.introductionRu??'',...part.words.map(word=>{const value=data.course.words.find(value=>value.id===word.wordId)!;return `${value.surface} · ${value.kana} — ${value.meaningRu}`;}),part.construction?.explanationRu??''].filter(Boolean).join('\n');options.changed();}};
    }))??[];
    else if(library.tab==='videos') items=(lesson.videos??[]).map(material=>({id:'book-video:'+material.id,text:material.title,run:()=>options.video(material)}));
    else {
      const words=data.course.words.filter(word=>studyWord(word)&&word.lessonIds.includes(lesson.id)&&!word.trainingOnly&&(library.tab==='words'?mainIds.has(word.id):true));
      items=[...words.map(word=>({id:'book-word:'+word.id,text:`${word.surface} · ${word.kana} — ${word.meaningRu}${known({kind:'word',itemId:word.id})?' · Изучено':''}`,run:()=>{library.detailTarget={kind:'word',itemId:word.id};library.detail=`${word.surface} · ${word.kana}\n${word.meaningRu}\n\n${mainIds.has(word.id)?'Основной':'Дополнительный'} материал урока. Отметку можно отменить до первого повторения.`;options.changed();}})),...(library.tab==='extra'?data.course.skills.filter(skill=>skill.reviewStatus!=='draft'&&data.course.exercises.some(exercise=>exercise.lessonId===lesson.id&&exercise.skillId===skill.id&&exercise.reviewStatus!=='draft')).map(skill=>({id:'book-skill:'+skill.id,text:skill.title+(known({kind:'grammar',itemId:skill.id})?' · Изучено':''),run:()=>{library.detailTarget={kind:'grammar',itemId:skill.id};library.detail=skill.title+'\n'+skill.explanationRu+'\n\nОтметку можно отменить до первого повторения.';options.changed();}})):[])];
      items=items.filter(item=>item.text.toLowerCase().includes(library.search.toLowerCase()));
    }
  }
  if(library.markMessage||library.markError)items.unshift({id:'book-mark-status',text:library.markError||library.markMessage,enabled:false,run:()=>{}});
  bookRows(surface,title,items,library,{safe:options.safe,changed:options.changed,back,...(!lesson||library.tab==='words'||library.tab==='extra'?{search:{value:library.search,draw:(rect:Rect)=>options.field(rect,library.search,value=>{library.search=value;library.offset=0;options.changed();})}}:{})});
}
