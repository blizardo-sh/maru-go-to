import type { Course, Word } from './types';
import type { GuidedLesson, LearningStep } from './learning';

// Reviewed, distinct meanings from each lesson's core material. This small fallback
// also keeps a one-word part usable without borrowing vocabulary from another lesson.
const anchors = [
  ['おはようございます', 'こんにちは', 'こんばんは', 'さようなら', 'ありがとうございます', 'ひらがな'],
  ['せんせい', 'ページ', 'なまえ', 'くに', 'ロシア', '日本'],
  ['わたし', 'がくせい', 'エンジニア', 'にほんご', 'えいご', 'めいし'],
  ['ちち', 'はは', 'あに', 'あね', '東京', '日本'],
  ['魚', '肉', 'やさい', 'くだもの', 'コーヒー', 'パン'],
  ['すし', 'カレー', 'コーラ', 'メニュー', '一つ', '二つ'],
  ['テレビ', 'エアコン', 'ソファ', 'ねこ', 'いす', 'ベッド'],
  ['うえ', 'した', 'なか', 'ほん', 'はこ', 'とけい'],
  ['おきます', 'ねます', 'あさ', 'よる', 'しちじ', 'くじ'],
  ['金よう日', '土よう日', '日よう日', 'パーティー', 'しごと', 'たんじょう日'],
  ['ギター', '読書', 'えいが', 'スポーツ', 'うち', 'さんぽ'],
  ['カレンダー', 'チケット', 'こうえん', '来月', '行きます', 'むりょう'],
  ['タクシー', 'ホテル', 'くうこう', 'バス', 'でんしゃ', '北口'],
  ['まち', 'じんじゃ', 'ぎんこう', 'きっさてん', 'みぎ', 'ひだり'],
  ['バッグ', 'とけい', 'チョコレート', 'はし', 'きょねん', '買います'],
  ['ティーシャツ', 'いろ', 'サイズ', '千', 'くつ', 'たかい'],
  ['きのう', 'デパート', 'はなび', 'そうじ', 'カラオケ', 'つかれます'],
  ['りょこう', 'きょねん', 'おてら', 'すし', 'きょうと', 'ひこうき'],
];
const equivalent = [
  ['ちち', 'おとうさん'], ['はは', 'おかあさん'], ['あに', 'おにいさん'], ['あね', 'おねえさん'],
  ['うち', 'いえ'], ['なまえ', 'おなまえ'], ['しごと', 'おしごと'], ['そして', 'それから'],
  ['ありがとう', 'ありがとうございます', 'どうもありがとう', 'どうもありがとうございます', 'おつかれさまでした'],
  ['さようなら', 'じゃあまた', 'じゃあ、また'],
  ['はじめまして', 'どうぞよろしく', 'どうぞよろしくおねがいします'],
  ['なんさい', 'おいくつですか'], ['これ', 'この'], ['あれ', 'あの'], ['それ', 'その'],
  ['ください', 'おねがいします', 'どうぞ', 'どうぞおねがいします'],
  ['すみません', 'ごめんなさい', 'しつれいします', 'ごめんください', 'おじゃまします'],
  ['買います', 'かえます'], ['プレゼント', 'おみやげ'], ['たのしい', 'おもしろい'],
  ['でんしゃ', 'ちかてつ', 'しんかんせん'],
];
const normalized = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const reading = (text: string) => normalized(text).replace(/[ァ-ヶ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60));
const meanings = (word: Word) => word.meaningRu.normalize('NFKC').toLowerCase().replace(/\([^)]*\)/g, '').split(/[,;/]/).map(normalized).filter(Boolean);
export function confusableLearningWords(left: Word, right: Word): boolean {
  if (left.id === right.id || normalized(left.surface) === normalized(right.surface) || reading(left.audioText ?? left.kana) === reading(right.audioText ?? right.kana)) return true;
  if (meanings(left).some(meaning => meanings(right).includes(meaning))) return true;
  const spellings = (word: Word) => [normalized(word.surface), reading(word.kana), reading(word.audioText ?? word.kana)];
  return equivalent.some(group => {
    const keys = group.map(reading);
    return spellings(left).some(key => keys.includes(key)) && spellings(right).some(key => keys.includes(key));
  });
}

// Stable across GET/reload and independent of the learner's SRS state.
export function learningWordChoices(course: Course, route: GuidedLesson, step: Extract<LearningStep, { kind: 'word-practice' }>): string[] {
  const target = course.words.find(word => word.id === step.wordId);
  const lesson = course.lessons.find(lesson => lesson.id === route.lessonId);
  if (!target || !lesson) throw new Error('Missing quiz target.');
  const pool = course.words.filter(word => word.lessonIds.includes(route.lessonId) && word.reviewStatus !== 'draft');
  const selected = [target];
  for (const surface of anchors[lesson.number - 1] ?? []) {
    const candidate = pool.find(word => word.surface === surface);
    if (candidate && selected.every(word => !confusableLearningWords(word, candidate))) selected.push(candidate);
    if (selected.length === 4) break;
  }
  if (selected.length !== 4) throw new Error(`Missing reviewed quiz choices: ${route.lessonId}/${step.wordId}`);
  // The target position varies by question, without rerandomizing a saved question.
  let hash = 2166136261;
  for (const char of step.id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const offset = (hash >>> 0) % 4;
  return [...selected.slice(offset), ...selected.slice(0, offset)].map(word => word.id);
}
