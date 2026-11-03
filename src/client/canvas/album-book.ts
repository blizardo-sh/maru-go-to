import { contentPages } from './album-navigation';
import { renderReading } from './album-reading';
import { api } from '@app/client/api';
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
  scroll = 0;
  video: LessonVideo | null = null;
  private epoch = 0;
  constructor(private changed: () => void) {}
  clear() { ++this.epoch; this.owner = ''; this.data = null; this.error = ''; this.busy = false; this.search = ''; this.offset = 0; this.lessonId = null; this.detail = ''; this.video = null; }
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
  train: (id: string) => void; trainGrammar: (id: string) => void; field: (rect: Rect,value: string,changed: (value:string)=>void) => void; video: (material: LessonVideo) => void;
}) {
  const data=library.data!;
  const change=()=>{library.offset=0;library.search='';library.detail='';library.scroll=0;options.changed();};
  const back=()=>{if(library.detail){library.detail='';library.scroll=0;options.changed();}else if(library.tab!=='overview'){library.tab='overview';change();}else options.home();};
  if(library.detail){renderReading(surface,library.detail,library,{back:{id:'book-detail-back',text:'К материалам',run:back},safe:options.safe,changed:options.changed});return;}
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
      {id:'book-parts',text:`Объяснения и части урока · ${state?.totalParts??route?.goals.flatMap(goal=>goal.parts).length??0}`,run:()=>{library.tab='parts';change();}},
      {id:'book-main',text:`Словарь урока · ${mainIds.size} слов и фраз`,run:()=>{library.tab='words';change();}},
      {id:'book-extra',text:'Дополнительный словарь и конструкции',run:()=>{library.tab='extra';change();}},
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
      items=[...words.map(word=>({id:'book-word:'+word.id,text:`${word.surface} · ${word.kana} — ${word.meaningRu}`,run:()=>{library.detail=`${word.surface} · ${word.kana}\n${word.meaningRu}`;options.changed();}})),...(library.tab==='extra'?data.course.skills.filter(skill=>data.course.exercises.some(exercise=>exercise.lessonId===lesson.id&&exercise.skillId===skill.id)).map(skill=>({id:'book-skill:'+skill.id,text:skill.title,run:()=>{library.detail=skill.title+'\n'+skill.explanationRu;options.changed();}})):[])];
      items=items.filter(item=>item.text.toLowerCase().includes(library.search.toLowerCase()));
    }
  }
  bookRows(surface,title,items,library,{safe:options.safe,changed:options.changed,back,...(!lesson||library.tab==='words'||library.tab==='extra'?{search:{value:library.search,draw:(rect:Rect)=>options.field(rect,library.search,value=>{library.search=value;library.offset=0;options.changed();})}}:{})});
}
