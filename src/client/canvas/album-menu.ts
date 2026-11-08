import { Graphics } from 'pixi.js';
import type { PrototypeLayout } from './prototype-layouts';
import { green, type StudyAction, type StudySurface } from './study-surface';
import { contentPages } from './album-navigation';
import { lessonPagePlan, stageSummary, type LessonStage } from './lesson-overview';
import { unitLabel, type Textbook } from '@app/shared/books';

type Lesson = { completionBasis?: 'performed'|'self-assessed'|'recognized'; id: string; number: number; title: string; topic?: string; availability?: 'full' | 'vocabulary' | 'preparing'; finished: boolean; started: boolean; parts: LessonStage[] };
export function renderAlbumMenu(surface: StudySurface, view: PrototypeLayout, state: { page: number; capacity?: number }, options: {
  lessons: Lesson[]; safe: (action: StudyAction) => StudyAction; learn: (id: string) => void; changed: () => void; confirmEmail?: () => void;
  book?: Textbook; chooseBook?: () => void; continueLesson?: Lesson;
}) {
  const pages = contentPages(surface, true), width = Math.min(...pages.map(p => p.width)), font = width < 430 ? 16 : 17, compact = width >= 430;
  const bookHeader = options.book ? (view.low ? 0 : 144) : 0;
  const titleHeight = (view.low ? options.book ? 50 : 28 : width < 430 ? 62 : 48) + bookHeader;
  const header = titleHeight + (options.confirmEmail ? 50 : 0), footerHeight = view.low ? 46 : 54;
  const unit = options.book ? unitLabel(options.book) : 'Урок';
  const rowHeight = Math.max(48, ...options.lessons.map(lesson => surface.measure(lesson.title, width - (compact ? 132 : 68), font) + (compact ? 23 : 40)));
  let plan = lessonPagePlan(options.lessons.length, pages.length, pages[0]!.height - header, rowHeight);
  if (plan.pages > 1) plan = lessonPagePlan(options.lessons.length, pages.length, pages[0]!.height - header - footerHeight, rowHeight);
  // Balance the remaining leaves while keeping every row within its measured area.
  if (plan.pages > 1) plan = { ...plan, capacity: Math.ceil(options.lessons.length / plan.pages) };
  if (state.capacity && state.capacity !== plan.capacity) state.page = Math.floor(state.page * state.capacity / plan.capacity);
  state.page = Math.max(0, Math.min(state.page, plan.pages - 1)); state.capacity = plan.capacity;
  const start = state.page * plan.capacity, lessons = options.lessons.slice(start, start + plan.capacity);
  const perPage = Math.ceil(lessons.length / pages.length), next = options.lessons.find(lesson => !lesson.finished);
  pages.forEach((page, side) => {
    const items = lessons.slice(side * perPage, (side + 1) * perPage);
    const range = items.length ? `${items[0]!.number}–${items.at(-1)!.number}` : '';
    if (options.book && !side) {
      if(view.low)surface.row([
        options.safe({id:'books-open',text:options.book.shortTitle+' · Книги',accessibleLabel:options.book.shortTitle+' · Выбрать учебник',fontSize:14,run:()=>options.chooseBook?.()}),
        options.safe({id:'book-continue',text:'Продолжить',fontSize:14,enabled:!!options.continueLesson,run:()=>options.continueLesson&&options.learn(options.continueLesson.id)}),
      ],{...page,height:44});
      else surface.action(options.safe({ id: 'books-open', text: `${options.book.shortTitle} · Выбрать учебник`, run: () => options.chooseBook?.() }), { ...page, height: 44 }, false, 16);
      const continuation = options.continueLesson;
      if (!view.low) surface.action(options.safe({ id: 'book-continue', text: continuation ? `Продолжить · ${unit.toLowerCase()} ${continuation.number}` : 'Выбрать урок', enabled: !!continuation, run: () => continuation && options.learn(continuation.id) }), { ...page, y: page.y + 50, height: 44 }, false, 16);
      if (!view.low) surface.text(`Мой прогресс: ${options.lessons.filter(l => l.finished).length} из ${options.book.unitCount}\nМатериалы: ${options.lessons.filter(l => l.availability === 'full').length} готовы полностью`, { ...page, y: page.y + 100, height: 42 }, 13);
    }
    if (!view.low || !options.book || side) surface.text(side ? `${unit === 'Тема' ? 'Темы' : 'Уроки'} ${range}` : options.book?.title ?? 'Уроки японского', { ...page, y: page.y + bookHeader + 2, height: 46 }, options.book ? 16 : view.low ? 19 : width < 330 ? 23 : 25);
    if (!options.book && !view.low && !side) surface.text(`${options.lessons.filter(l => l.finished).length} из ${options.lessons.length} пройдено`, { x: page.x + (width < 430 ? 0 : page.width - 135), y: page.y + (width < 430 ? 36 : 13), width: 135, height: 22 }, 12).style.fill = '#65533f';
    if (!side && options.confirmEmail) surface.action({id:'confirm-email',text:'Подтвердить почту для восстановления',fontSize:14,run:options.confirmEmail},{x:page.x,y:page.y+titleHeight,width:page.width,height:44});
    const available = page.height - header - (plan.pages > 1 ? footerHeight : 0);
    const pitch = Math.min(rowHeight + 20, available / Math.max(1, perPage));
    items.forEach((lesson, index) => {
      const r = { x: page.x, y: page.y + header + index * pitch, width: page.width, height: rowHeight };
      const summary = stageSummary(lesson.parts), available = !lesson.availability || lesson.availability === 'full', status = !available ? lesson.availability === 'vocabulary' ? 'Доступен словарь' : 'Готовится' : lesson.finished ? lesson.completionBasis==='recognized'?'Ранее проходил':lesson.completionBasis==='self-assessed'?'По самооценке':'Пройдено' : lesson.started ? 'В процессе' : 'Урок доступен';
      surface.action(options.safe({ id: `lesson:${lesson.id}`, text: '', bare: true, accessibleLabel: `${options.book?.shortTitle ?? 'A1'}. ${unit} ${lesson.number}. ${lesson.title}. ${status}${available ? `. Этапы: ${summary.finished} из ${summary.count}. ${summary.percent}%` : ''}`, run: () => options.learn(lesson.id) }), r);
      surface.text(String(lesson.number).padStart(2, '0'), { x: r.x + 10, y: r.y + 7, width: 30, height: 30 }, 18).style.fill = lesson.id === next?.id ? green : '#65533f';
      surface.text(lesson.title, { x: r.x + 48, y: r.y + 7, width: r.width - (compact ? 132 : 68), height: rowHeight - 20 }, font);
      const barX = r.x + 48, barY = r.y + rowHeight - 14, barWidth = Math.max(40, r.width - (compact ? 64 : 136)), count = Math.max(1, lesson.parts.length), segment = barWidth / count;
      const bar = new Graphics();
      (available ? lesson.parts : []).forEach((part, i) => {
        const x = barX + i * segment, w = Math.max(1, segment - 2), fraction = part.totalSteps ? part.completedSteps / part.totalSteps : 0;
        bar.rect(x, barY, w, 5).fill('#d3c19c');
        if (fraction) bar.rect(x, barY, w * fraction, 5).fill(green);
        if (i) bar.moveTo(x - 1, barY - 2).lineTo(x - 1, barY + 7).stroke({ color: '#846a43', width: 1 });
      });
      bar.moveTo(r.x + 4, r.y + pitch - 3).lineTo(r.x + r.width - 4, r.y + pitch - 3).stroke({ color: '#ae9571', width: .7, alpha: .45 });
      surface.root.addChild(bar);
      surface.text(available ? `${summary.finished}/${summary.count} · ${summary.percent}%` : status, { x: available ? r.x + r.width - 82 : barX, y: available && compact ? r.y + 10 : barY - 5, width: available ? 68 : r.width - 55, height: 20 }, 12).style.fill = green;
    });
  });
  if (plan.pages > 1) {
    const page = pages.at(-1)!, r = { x: page.x, y: page.y + page.height - 46, width: page.width, height: 44 };
    const change = (value: number) => { state.page = value; options.changed(); };
    if (plan.pages <= 5 && (r.width - 10 * (plan.pages - 1)) / plan.pages >= 62) surface.row(Array.from({ length: plan.pages }, (_, index) => options.safe({ id: `lessons-page:${index}`, text: `${index * plan.capacity + 1}–${Math.min(options.lessons.length, (index + 1) * plan.capacity)}`, fontSize: 14, accessibleLabel: `Уроки ${index * plan.capacity + 1}–${Math.min(options.lessons.length, (index + 1) * plan.capacity)}`, selected: index === state.page, run: () => change(index) })), r);
    else surface.row([
      { id: 'lessons-prev', text: '←', accessibleLabel: 'Предыдущая страница уроков', enabled: state.page > 0, run: () => change(state.page - 1) },
      { id: 'lessons-range', text: `${start + 1}–${start + lessons.length}`, fontSize: 14, enabled: false, run: () => {} },
      { id: 'lessons-next', text: '→', accessibleLabel: 'Следующая страница уроков', enabled: state.page < plan.pages - 1, run: () => change(state.page + 1) },
    ].map(options.safe), r);
  }
}
