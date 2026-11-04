import type { JapaneseValue, Rect } from './canvas';
import type { PrototypeLayout } from './prototype-layouts';
import { StudySurface, type StudyAction, type StudyChoice } from './study-surface';

// One presentation for guided recall and ordinary review; controllers own all grading rules.
export function renderAlbumRecall(surface: StudySurface, view: PrototypeLayout, value: JapaneseValue & { meaningRu: string }, mode: 'ja-ru' | 'ru-ja' | 'listening', revealed: boolean, audio: StudyAction | null, actions: StudyAction[], choices?: StudyChoice[], choose?: (id: string) => void, note?: string) {
  const a = surface.body, f = surface.layout.font, split = view.prompt;
  let title = note ?? (mode === 'ja-ru' ? 'Вспомните перевод' : mode === 'ru-ja' ? 'Вспомните по-японски' : 'Вспомните смысл услышанного');
  if (!split && !(choices?.length && !revealed)) {
    const width = a.width - 24, x = a.x + 12, titleHeight = surface.measure(title, width, 16);
    surface.text(title, { x, y: a.y, width, height: titleHeight }, 16, false, true);
    const listen = mode === 'listening', buttonHeight = listen && a.height > 320 ? 80 : 44, buttonWidth = listen ? 96 : 176;
    const audioY = a.y + Math.max(titleHeight + 12, listen ? (a.height - 300) / 2 : 0);
    if (audio) surface.action({ ...audio, text: listen ? '▶' : '▶ Прослушать', bare: false, fontSize: 16 }, { x: a.x + (a.width - buttonWidth) / 2, y: audioY, width: buttonWidth, height: buttonHeight });
    const top = audioY + buttonHeight + 18, available = a.y + a.height - top - 8;
    let size = Math.min(f, 22), glossHeight = surface.measure(value.meaningRu, width, size);
    while (size > 14 && glossHeight > available * .5) glossHeight = surface.measure(value.meaningRu, width, --size);
    const hint = 'Коснитесь карточки, чтобы раскрыть ответ';
    const hintHeight = surface.measure(hint, width, 15), gap = 18;
    const showJapanese = revealed || mode === 'ja-ru';
    const showGloss = revealed || mode === 'ru-ja';
    const otherHeight = showGloss ? glossHeight : hintHeight;
    const japaneseHeight = showJapanese ? Math.max(40, Math.min(150, available - otherHeight - gap)) : 0;
    const total = japaneseHeight + (showJapanese ? gap : 0) + otherHeight;
    const y = top + Math.max(0, (available - total) * .35);
    const drawnHeight = showJapanese ? surface.japanese(value, { x, y, width, height: japaneseHeight }, 60, 'top').height : 0;
    surface.text(showGloss ? value.meaningRu : hint, { x, y: y + drawnHeight + (showJapanese ? gap : 0), width, height: otherHeight }, showGloss ? size : 15, false, true);
    surface.footer(actions); return;
  }
  if (choices?.length && !revealed) {
    const plan = surface.quiz(title, mode === 'listening' ? '♪' : mode === 'ru-ja' ? value.meaningRu : value.surface, choices, undefined, { question: split, alignQuestion: true, paper: false, titleSize: 16, ruby: mode === 'ja-ru' ? value : undefined });
    surface.choices(choices, plan.choices, choose!, plan.columns, plan.size);
    if (audio) surface.action({ ...audio, text: '▶', bare: false, accessibleLabel: audio.accessibleLabel ?? audio.text }, { x: plan.question.x + (plan.question.width - 64) / 2, y: plan.question.y + plan.question.height - 46, width: 64, height: 44 });
    surface.footer(actions); return;
  }
  const pair = split ? surface.pairedPanels(split) : undefined;
  let titleHeight = split ? Math.max(32, surface.measure(title, Math.min(split.width, a.width) - 24, 16)) : 50;
  const promptHeight = mode === 'ru-ja' ? surface.measure(value.meaningRu, a.width - 24, f) : 100;
  const questionHeight = mode === 'listening' ? Math.min(150, a.height * .35) : Math.min(a.height - 110, Math.max(a.height * .43, promptHeight + titleHeight + 16));
  const question: Rect = pair?.left ?? { ...a, height: questionHeight };
  const answer: Rect = pair?.right ?? { ...a, y: a.y + question.height + 12, height: a.height - question.height - 12 };
  // Long dictionary glosses need a bounded translation row in a low spread.
  // Keep the question and Japanese answer in the same row, before and after reveal.
  let translationSize = f;
  let translationHeight = surface.measure(value.meaningRu, answer.width - 24, translationSize);
  let compactListening = false;
  const rowMinimum = Math.max(40, surface.measure(value.surface, answer.width - 24, 18, true) + 12);
  if (split && mode === 'listening' && answer.height - titleHeight - 28 - translationHeight < rowMinimum) {
    compactListening = true;
    if (!note) title = 'Смысл услышанного';
    titleHeight = Math.max(24, surface.measure(title, question.width - 24, 16));
    while (translationSize > 14 && answer.height - titleHeight - 28 - translationHeight < rowMinimum) {
      translationSize -= 1;
      translationHeight = surface.measure(value.meaningRu, answer.width - 24, translationSize);
    }
  }
  surface.text(title, { ...question, x: question.x + 12, width: question.width - 24, height: titleHeight }, 16, false, true);
  const answerTop = split ? titleHeight + 8 : 0;
  const translationSpace = split && mode === 'listening' ? translationHeight + 12 : 0;
  const answerBody = { x: answer.x + 12, y: answer.y + answerTop, width: answer.width - 24, height: answer.height - answerTop - (split ? 8 : 0) - translationSpace };
  const prompt = split ? { ...answerBody, x: question.x + 12 } : { x: question.x + 12, y: question.y + 58, width: question.width - 24, height: question.height - 66 };
  // Fit a complete Russian gloss to its row without moving the paired centres.
  const fitGloss = (height: number) => {
    let size = f;
    while (size > 14 && surface.measure(value.meaningRu, answerBody.width, size) > height) size--;
    return size;
  };
  if (mode === 'ja-ru') translationSize = fitGloss(answerBody.height);
  const centredPrompt = (text: string, size: number, japanese = false) => {
    const height = surface.measure(text, prompt.width, size, japanese);
    surface.text(text, { ...prompt, y: prompt.y + (split ? (prompt.height - height) / 2 : 0) }, size, japanese, true);
  };
  if (mode === 'ja-ru') surface.japanese(value, prompt, 66);
  else if (mode === 'ru-ja') centredPrompt(value.meaningRu, fitGloss(prompt.height));
  else if (audio) surface.action({ ...audio, text: '▶', bare: false }, { x: prompt.x + (prompt.width - 96) / 2, y: prompt.y + (prompt.height - 72) / 2, width: 96, height: 72 });
  if (split) surface.text('Ответ', { x: answer.x + 12, y: answer.y, width: answer.width - 24, height: 32 }, 16, false, true);
  if (revealed) {
    if (mode === 'ru-ja') surface.japanese(value, answerBody, 58);
    else {
      const meaningHeight = surface.measure(value.meaningRu, answerBody.width, translationSize);
      if (mode === 'listening') surface.japanese(value, { ...answerBody, height: split ? answerBody.height : answerBody.height - meaningHeight - 12 }, 52);
      const y = mode === 'ja-ru' ? answerBody.y + (answerBody.height - meaningHeight) / 2 : answerBody.y + answerBody.height + (split ? 12 : -meaningHeight);
      surface.text(value.meaningRu, { ...answerBody, y, height: meaningHeight }, translationSize, false, true);
    }
  } else {
    const hint = compactListening ? 'Вспомните и раскройте ответ.' : 'Сначала попробуйте вспомнить, затем откройте ответ.', hintSize = compactListening ? 16 : 18, height = surface.measure(hint, answerBody.width, hintSize);
    surface.text(hint, { ...answerBody, y: answerBody.y + (answerBody.height - height) / 2, height }, hintSize, false, true);
  }
  if (audio && mode !== 'listening') surface.action({ ...audio, bare: false }, pair!.leftActions);
  surface.footer(actions);
}
