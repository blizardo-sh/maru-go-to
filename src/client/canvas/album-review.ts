import type { Progress } from '@app/shared/types';
import { contentPages } from './album-navigation';
import type { StudyAction, StudySurface } from './study-surface';

export function renderReviewOverview(surface: StudySurface, state: { total: number; remainingDue: number; progress: Progress | null }, options: {
  safe: (action: StudyAction) => StudyAction; start: () => void; lessons: () => void; reference: () => void; refresh: () => void;
}) {
  const pages = contentPages(surface), left = pages[0]!, right = pages.at(-1)!, compact = left.height < 420;
  const progress = state.progress, learned = progress?.introducedWordIds.length ?? 0, skills = progress?.introducedSkillIds.length ?? 0;
  const title = state.total ? 'Пора повторить' : 'Пока нет карточек';
  const description = state.total
    ? `Карточек по расписанию: ${state.remainingDue}. В этом занятии — ${state.total}.`
    : learned || skills ? 'Для выбранных типов сейчас нет заданий по расписанию.' : 'Пройдите первую часть урока — изученный материал появится здесь.';
  const text = [description, compact ? 'Слова, конструкции и счёт добавляются после изучения в уроках.' : 'Слова, конструкции и счёт открываются по мере изучения. Здесь вы вспоминаете их и отмечаете, что помните.'];
  const size = compact ? 15 : 18, heading = compact ? 23 : 28;
  let y = left.y + 8;
  const h = surface.measure(title, left.width - 16, heading);
  surface.text(title, { x: left.x + 8, y, width: left.width - 16, height: h }, heading); y += h + 16;
  for (const paragraph of text) {
    const h = surface.measure(paragraph, left.width - 16, size);
    surface.text(paragraph, { x: left.x + 8, y, width: left.width - 16, height: h }, size); y += h + 14;
  }
  // Keep the same due queue on the overview and after Start; opening it never grades a card.
  const summary = `Изучено слов и фраз: ${learned}\nКонструкций: ${skills}`;
  const summaryY = pages.length > 1 ? right.y + 8 : y;
  const summaryHeight = surface.measure(summary, right.width - 16, size);
  surface.text(summary, { x: right.x + 8, y: summaryY, width: right.width - 16, height: summaryHeight }, size);
  if (summaryY + summaryHeight + 68 <= right.y + right.height) surface.action(options.safe({ id: 'review-collection', text: 'Изученные материалы', run: options.reference }), { x: right.x, y: summaryY + summaryHeight + 20, width: right.width, height: 48 }, false, 17);
  surface.footer([
    options.safe(state.total ? { id: 'review-start', text: 'Начать повторение', run: options.start } : { id: 'review-lessons', text: 'К урокам', fontSize: 16, run: options.lessons }),
    ...(!state.total ? [options.safe({ id: 'review-refresh', text: 'Обновить', fontSize: 16, run: options.refresh })] : []),
  ]);
}
