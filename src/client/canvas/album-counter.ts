import { ratingOptions } from '@app/client/review-ratings';
import { Sprite, type Texture } from 'pixi.js';
import { readingVariants, type CounterCard } from '@app/shared/counters';
import type { Course, Rating, ReviewSchedule } from '@app/shared/types';
import type { Rect } from './canvas';
import { StudySurface, type StudyAction, type StudyChoice } from './study-surface';

export interface CounterDraft { helped: boolean; revealed: boolean; rule: boolean; example: number; wrong: string[]; correct: boolean | null }
export const newCounterDraft = (): CounterDraft => ({ helped: false, revealed: false, rule: false, example: 0, wrong: [], correct: null });
export function counterPicture(surface: StudySurface, picture: Texture | undefined, rect: Rect, quantity: number | null, age: boolean, label: string) {
  if (picture) {
    const image = new Sprite(picture), height = rect.height - (quantity === null ? 0 : 36);
    image.scale.set(Math.min(rect.width / picture.width, height / picture.height));
    image.position.set(rect.x + (rect.width - image.width) / 2, rect.y + (height - image.height) / 2); surface.root.addChild(image);
  }
  if (quantity !== null) surface.text(`${age ? 'Возраст · ' : '× '}${quantity.toLocaleString('ru-RU')}${age ? ' лет' : ''}`, { ...rect, y: rect.y + rect.height - 34, height: 32 }, 20, false, true);
  surface.texts.push({ value: label, rect, size: 0 });
}
export function renderCounterCard(surface: StudySurface, card: CounterCard, course: Course, draft: CounterDraft, options: {
  schedule?: ReviewSchedule; prompt?: Rect; pictures: Map<number, Texture>; intro: boolean; busy: boolean; heard: boolean; mediaError: string;
  result?: { choice: string; correct: boolean };
  changed: () => void; play: (url?: string) => void; introduce: () => void; choose: (id: string, helped: boolean) => void;
  grade: (rating: Rating, helped: boolean) => void; next?: () => void; safe: (action: StudyAction) => StudyAction;
}) {
  const a = surface.body, safe = options.safe, footer = (actions: StudyAction[]) => surface.footer(actions.map(safe));
  const openRule = () => { draft.helped = true; draft.rule = true; options.changed(); };
  if (options.intro || draft.rule) {
    const title = `${card.definition.surface} · ${card.definition.title} · ступень ${card.level + 1}`;
    surface.text(title, { ...a, height: 56 }, 20);
    const textHeight = surface.measure(card.definition.explanation, a.width - 16, 17);
    surface.text(card.definition.explanation, { x: a.x + 8, y: a.y + 60, width: a.width - 16, height: textHeight }, 17);
    const example = card.examples[draft.example % card.examples.length]!;
    const y = a.y + 68 + textHeight, h = Math.max(44, a.height - 126 - textHeight);
    surface.japanese(example, { x: a.x + 8, y, width: a.width - 16, height: h }, 40);
    footer([
      { id: 'counter-example', text: 'Пример →', run: () => { draft.example++; options.changed(); } },
      { id: 'counter-example-audio', text: '▶', accessibleLabel: 'Прослушать пример', enabled: !!example.audioUrl, run: () => options.play(example.audioUrl) },
      { id: options.intro ? 'counter-intro' : 'counter-close-rule', text: 'К карточке', run: () => { if (options.intro) options.introduce(); else { draft.rule = false; options.changed(); } } },
    ]); return;
  }
  const titles = { 'image-counter': 'Какой суффикс подходит?', 'counter-image': 'Что считают этим суффиксом?', 'reading-choice': 'Выберите чтение количества', 'listening-image': 'Послушайте количество', recall: 'Вспомните количество' };
  const age = card.definition.id === 'sai';
  if (card.kind === 'recall') {
    const prompt = options.prompt ?? { ...a, height: Math.min(170, a.height * .45) };
    counterPicture(surface, options.pictures.get(card.object.tile), prompt, card.quantity, age, card.word.meaningRu);
    const answer = options.prompt ? a : { ...a, y: a.y + prompt.height + 8, height: a.height - prompt.height - 8 };
    if (draft.revealed) surface.japanese(card.answer, { ...answer, height: answer.height - 44 }, 56);
    else surface.text('Назовите количество по-японски', answer, 19, false, true);
    if (draft.revealed) surface.action(safe({id:'counter-rule',text:'Правило',fontSize:16,run:openRule}),{x:answer.x,y:answer.y+answer.height-44,width:Math.min(140,answer.width-54),height:44});
    if (draft.revealed) surface.action(safe({ id: 'counter-audio', text: '▶', accessibleLabel: 'Прослушать ответ', run: () => options.play(card.audioUrl) }), { x: answer.x + answer.width - 44, y: answer.y + answer.height - 44, width: 44, height: 44 });
    footer(draft.revealed ? ratingOptions(options.schedule).map(option => ({...option, fontSize: 14, enabled: option.rating === 1 || !draft.helped, run: () => options.grade(option.rating, draft.helped)})) : [
      { id: 'show-answer', text: 'Раскрыть', run: () => { draft.revealed = true; options.changed(); } },
      { id: 'counter-rule', text: 'Правило', run: openRule },
    ]); return;
  }
  const heard = card.kind !== 'listening-image' || options.heard && !options.mediaError;
  const result = options.result;
  const choices: StudyChoice[] = card.options.map(option => ({ id: option.key,
    text: (result && card.acceptedKeys.includes(option.key) ? '✓ ' : result && result.choice === option.key ? '✗ ' : '') + (option.object ? `${option.label}${card.kind === 'listening-image' ? ` · ${option.age ? 'возраст' : '×'} ${option.quantity?.toLocaleString('ru-RU')}` : ''}` : option.label),
    picture: option.object ? options.pictures.get(option.object.tile) : undefined,
    japanese: !option.object, wrong: result ? !result.correct && result.choice === option.key : draft.wrong.includes(option.key), selected: (!!result || draft.correct === true) && card.acceptedKeys.includes(option.key),
    accessibleLabel: option.label + (result && result.choice === option.key ? ' — ваш ответ' : '') + (result && card.acceptedKeys.includes(option.key) ? ' — правильный ответ' : draft.wrong.includes(option.key) ? ' — первый ответ неверен' : ''),
    enabled: !options.busy && heard && !result && draft.correct !== true, run: () => {} }));
  // The listening face never discloses the target picture or quantity before a choice.
  const correctAnswer = card.options.filter(option => card.acceptedKeys.includes(option.key)).map(option => option.label).join(' / ');
  const failure = 'Неверно. Выберите другой вариант.', correction = 'Неверно. Правильный ответ: ' + correctAnswer;
  const success = draft.helped || draft.wrong.length ? 'Верно. Повторим ещё раз.' : 'Верно!';
  const titleHeight = Math.max(...[titles[card.kind],failure,correction,success].map(text=>surface.measure(text,(options.prompt?.width??surface.body.width)-24,16)));
  const title = result ? result.correct ? success : correction : draft.correct === false ? failure : draft.correct === true ? success : titles[card.kind];
  // quiz reserves a separate image slot instead of painting over the prompt.
  const picture = card.kind === 'image-counter' || card.kind === 'reading-choice' ? options.pictures.get(card.object.tile) : undefined;
  const plan = surface.quiz(title, card.kind === 'listening-image' ? '♪' : card.kind === 'image-counter' ? card.word.kana : card.answer.surface, choices, picture, { question: options.prompt, paper: false, titleSize: 16, titleHeight });
  surface.choices(choices, plan.choices, id => options.choose(id, draft.helped), plan.columns, plan.size);
  const alternatives = card.quantity === null ? [] : readingVariants(card.definition.id, card.quantity, course.catalog).slice(1);
  footer([
    { id: 'counter-rule', text: 'Правило', run: openRule },
    ...(card.kind === 'listening-image' || draft.correct === true || result ? [{ id: 'audio', text: '▶', accessibleLabel: 'Прослушать количество', run: () => options.play(card.audioUrl) }] : []),
    ...(options.next ? [{ id: 'counter-next', text: 'Дальше →', enabled: !!result || draft.correct === true, run: options.next }] : []),
  ]);
  if (draft.correct === true && alternatives.length) {
    const r = plan.question; surface.text('Также: ' + alternatives.join(' · '), { x: r.x, y: r.y + r.height - 32, width: r.width, height: 32 }, 15, true, true);
  }
}
