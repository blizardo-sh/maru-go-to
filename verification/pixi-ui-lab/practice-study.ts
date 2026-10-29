import fixture from './practice-fixtures.json';
import { advanceDeck } from '@rehearsal/client/study';
import type { ReviewItem, Word } from '@rehearsal/shared/types';

export type Variant = 'choice' | 'recall';
export type Outcome = { wordId: string; mode: string; firstError: boolean; hint: boolean; self: boolean | null; retry: boolean; delayed: boolean };
const words = new Map(fixture.words.map(word => [word.id, word as Word]));
const card = (wordId: string, mode: string, id: string): ReviewItem => {
  if (mode !== 'ja-ru' && mode !== 'ru-ja' && mode !== 'listening') throw new Error('Unsupported demo mode');
  // Synthetic demo identity; never submitted or used to calculate an FSRS due date.
  return { id, targetId: wordId, version: 0, due: '1970-01-01T00:00:00.000Z', isNew: false, mode, word: words.get(wordId)! };
};
export class PracticeStudy {
  variant: Variant = 'choice';
  phase: 'choose' | 'intro' | 'question' | 'summary' = 'choose';
  introIndex = 0;
  queue: ReviewItem[] = [];
  records: Record<Variant, Outcome[]> = { choice: [], recall: [] };
  revealed = false;
  hinted = false;
  firstError = false;
  selected: string | null = null;
  correct: boolean | null = null;
  self: boolean | null = null;
  delayed = false;
  private turn = 0;
  get intro() { return fixture.introduced[this.introIndex]!; }
  get introWord() { return { ...words.get(this.intro.wordId)!, introduction: this.intro }; }
  get current() { return this.queue[0]; }
  get word() { const current = this.current; return current && current.mode !== 'grammar' && current.mode !== 'counter' ? current.word : undefined; }
  get recall() { return this.variant === 'recall' && (this.delayed || !this.current?.id.startsWith('warmup:')); }
  get choices() {
    if (!this.current || !this.word) return [];
    const authored = fixture.baseline.find(item => item.id === this.current!.id);
    const ids = this.variant === 'choice' && authored ? authored.choices : [this.word.id, ...fixture.familiar.filter(id => id !== this.word!.id).slice(0, 3)];
    const offset = this.turn % ids.length;
    return [...ids.slice(offset), ...ids.slice(0, offset)].map(id => words.get(id)!);
  }
  start(variant: Variant) { this.variant = variant; this.phase = 'intro'; this.introIndex = 0; this.records[variant] = []; this.delayed = false; this.reset(); }
  introduce(delta: number) { this.introIndex = Math.max(0, Math.min(fixture.introduced.length - 1, this.introIndex + delta)); }
  begin() {
    this.queue = this.variant === 'choice' ? fixture.baseline.map(item => card(item.wordId, item.mode, item.id)) : [
      ...fixture.introduced.map(intro => card(intro.wordId, 'ja-ru', `warmup:${intro.wordId}`)),
      ...fixture.introduced.flatMap((intro, index) => [card(intro.wordId, 'ja-ru', `recall:${intro.wordId}`), card(fixture.familiar[index]!, 'ru-ja', `known:${index}`)]),
    ];
    this.phase = 'question'; this.reset();
  }
  hint() { if (!this.recall || !this.current || this.revealed || this.correct === true) return false; this.hinted = true; return true; }
  reveal() { if (!this.recall || !this.current || this.hinted) return false; this.revealed = true; return true; }
  assess(remembered: boolean) { if (!this.revealed || this.correct !== null) return false; this.self = remembered; this.correct = remembered; return true; }
  choose(id: string) {
    if (!this.current || this.correct === true || this.recall && !this.hinted || !this.choices.some(word => word.id === id)) return false;
    if (this.selected === null && id !== this.word!.id) this.firstError = true;
    this.selected = id; this.correct = id === this.word!.id; return true;
  }
  next() {
    if (!this.current || this.correct === null || this.correct === false && this.self === null) return false;
    const retry = this.firstError || this.hinted || this.self === false;
    this.records[this.variant].push({ wordId: this.word!.id, mode: this.current.mode, firstError: this.firstError, hint: this.hinted, self: this.self, retry, delayed: this.delayed });
    this.queue = advanceDeck(this.queue, retry); this.turn++; this.reset();
    if (!this.queue.length) this.phase = 'summary'; return true;
  }
  recheck() {
    this.delayed = true; this.variant = 'recall';
    this.queue = fixture.introduced.map(intro => card(intro.wordId, 'ja-ru', `delayed:${intro.wordId}`));
    this.phase = 'question'; this.reset();
  }
  reset() { this.revealed = false; this.hinted = false; this.firstError = false; this.selected = null; this.correct = null; this.self = null; }
  snapshot() { return { variant: this.variant, phase: this.phase, introIndex: this.introIndex, wordId: this.word?.id, mode: this.current?.mode, queue: this.queue.map(item => item.targetId), choices: this.choices.map(word => word.id), recall: this.recall, revealed: this.revealed, hinted: this.hinted, selected: this.selected, correct: this.correct, records: this.records, delayed: this.delayed }; }
}
export const practiceFixture = fixture;
