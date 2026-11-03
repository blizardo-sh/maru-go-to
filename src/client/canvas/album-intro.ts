import type { JapaneseValue, Rect } from './canvas';
import type { StudyAction, StudySurface } from './study-surface';

// Keep all explanatory copy available on short pages without shrinking the text.
export function introductionPages(text: string, height: number, measure: (value: string) => number) {
  const pages: string[] = [];
  let page = '';
  for (const token of text.match(/\S+\s*/gu) ?? []) {
    if (page && measure((page + token).trim()) > height) { pages.push(page.trim()); page = ''; }
    page += token;
  }
  if (page.trim()) pages.push(page.trim());
  return pages.length ? pages : [''];
}

export function renderAlbumIntro(surface: StudySurface, value: JapaneseValue & { meaningRu: string }, explanation: string, example: { surface: string; meaningRu: string }, options: {
  prompt?: Rect; page: number; changed: (page: number) => void; wordAudio: StudyAction; exampleAudio: StudyAction;
}) {
  const pair = options.prompt ? surface.pairedPanels(options.prompt) : undefined, a = surface.body;
  const width = a.width - 24, glossSize = 18, glossHeight = surface.measure(value.meaningRu, width, glossSize);
  const wordHeight = pair ? a.height : Math.min(a.height - 146, 56 + 104 + 10 + glossHeight);
  const left = pair?.left ?? { ...a, height: wordHeight };
  const glossFits = left.height >= 56 + 100 + 10 + glossHeight;
  const phraseHeight = Math.min(120, left.height - 56 - (glossFits ? glossHeight + 10 : 0));
  const phrase = { x: left.x + 12, y: left.y + 56, width, height: phraseHeight };
  const rendered = surface.japanese(value, phrase, 48, 'top');
  if (glossFits) surface.text(value.meaningRu, { ...phrase, y: phrase.y + rendered.height + 10, height: glossHeight }, glossSize, false, true);
  const usedHeight = 56 + rendered.height + (glossFits ? glossHeight + 10 : 0);
  const right = pair?.right ?? { ...a, y: a.y + usedHeight + 16, height: a.height - usedHeight - 16 };
  const body = { x: right.x + 12, y: right.y + 56, width, height: right.height - 56 };
  const pages = introductionPages(`${glossFits ? '' : value.meaningRu + '\n\n'}${explanation}\n\n${example.surface}\n${example.meaningRu}`, body.height, text => surface.measure(text, width, 18));
  const page = Math.min(options.page, pages.length - 1);
  surface.text(pages[page]!, body, 18);
  const audioWidth = Math.min(150, (width - 10) / 2);
  for (const [rect, action] of [[left, options.wordAudio], [right, options.exampleAudio]] as const) {
    surface.action({ ...action, bare: false, text: rect.width < 300 ? '▶' : action.text }, { x: rect.x + 12, y: rect.y, width: audioWidth, height: 44 }, false, 16);
  }
  if (pages.length > 1) surface.action({ id: 'intro-tab', text: `${page + 1}/${pages.length} →`, accessibleLabel: `Продолжение пояснения, страница ${page + 1} из ${pages.length}`, run: () => options.changed((page + 1) % pages.length) }, { x: right.x + right.width - 12 - audioWidth, y: right.y, width: audioWidth, height: 44 }, false, 16);
}
