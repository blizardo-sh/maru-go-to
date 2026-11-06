import { Graphics } from 'pixi.js';
import type { PrototypeLayout } from './prototype-layouts';
import { green, type StudyAction, type StudySurface } from './study-surface';
import { contentPages } from './album-navigation';
import { lessonPagePlan, stageSummary, type LessonStage } from './lesson-overview';

type Lesson = { id: string; number: number; title: string; finished: boolean; started: boolean; parts: LessonStage[] };
export function renderAlbumMenu(surface: StudySurface, view: PrototypeLayout, state: { page: number; capacity?: number }, options: {
  lessons: Lesson[]; safe: (action: StudyAction) => StudyAction; learn: (id: string) => void; changed: () => void; confirmEmail?: () => void;
}) {
  const pages = contentPages(surface, true), width = Math.min(...pages.map(p => p.width)), font = width < 430 ? 16 : 17, compact = width >= 430;
  const titleHeight = view.low ? 28 : width < 430 ? 62 : 38;
  const header = titleHeight + (options.confirmEmail ? 50 : 0), footerHeight = view.low ? 46 : 54;
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
    surface.text(side ? (items.length === 1 ? `Урок ${items[0]!.number}` : `Уроки ${range}`) : 'Уроки японского', { ...page, y: page.y + 2, height: 36 }, view.low ? 19 : width < 330 ? 23 : 25);
    if (!view.low && !side) surface.text(`${options.lessons.filter(l => l.finished).length} из ${options.lessons.length} пройдено`, { x: page.x + (width < 430 ? 0 : page.width - 135), y: page.y + (width < 430 ? 36 : 13), width: 135, height: 22 }, 12).style.fill = '#65533f';
    if (!side && options.confirmEmail) surface.action({id:'confirm-email',text:'Подтвердить почту для восстановления',fontSize:14,run:options.confirmEmail},{x:page.x,y:page.y+titleHeight,width:page.width,height:44});
    const available = page.height - header - (plan.pages > 1 ? footerHeight : 0);
    const pitch = Math.min(rowHeight + 20, available / Math.max(1, perPage));
    items.forEach((lesson, index) => {
      const r = { x: page.x, y: page.y + header + index * pitch, width: page.width, height: rowHeight };
      const summary = stageSummary(lesson.parts), status = lesson.finished ? 'Пройден' : lesson.started ? 'Продолжить' : 'Начать';
      surface.action(options.safe({ id: `lesson:${lesson.id}`, text: '', bare: true, accessibleLabel: `Урок ${lesson.number}. ${lesson.title}. ${status}. Этапы: ${summary.finished} из ${summary.count}. ${summary.percent}%`, run: () => options.learn(lesson.id) }), r);
      surface.text(String(lesson.number).padStart(2, '0'), { x: r.x + 10, y: r.y + 7, width: 30, height: 30 }, 18).style.fill = lesson.id === next?.id ? green : '#65533f';
      surface.text(lesson.title, { x: r.x + 48, y: r.y + 7, width: r.width - (compact ? 132 : 68), height: rowHeight - 20 }, font);
      const barX = r.x + 48, barY = r.y + rowHeight - 14, barWidth = Math.max(40, r.width - (compact ? 64 : 136)), count = Math.max(1, lesson.parts.length), segment = barWidth / count;
      const bar = new Graphics();
      lesson.parts.forEach((part, i) => {
        const x = barX + i * segment, w = Math.max(1, segment - 2), fraction = part.totalSteps ? part.completedSteps / part.totalSteps : 0;
        bar.rect(x, barY, w, 5).fill('#d3c19c');
        if (fraction) bar.rect(x, barY, w * fraction, 5).fill(green);
        if (i) bar.moveTo(x - 1, barY - 2).lineTo(x - 1, barY + 7).stroke({ color: '#846a43', width: 1 });
      });
      bar.moveTo(r.x + 4, r.y + pitch - 3).lineTo(r.x + r.width - 4, r.y + pitch - 3).stroke({ color: '#ae9571', width: .7, alpha: .45 });
      surface.root.addChild(bar);
      surface.text(`${summary.finished}/${summary.count} · ${summary.percent}%`, { x: r.x + r.width - 82, y: compact ? r.y + 10 : barY - 5, width: 68, height: 20 }, 12).style.fill = green;
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
