import corpus from '../../../../materials/course.json';
import lesson04 from '../../../../materials/learning/lesson-04.json';
import lesson03 from '../../../../materials/learning/lesson-03.json';
import lesson01 from '../../../../materials/learning/lesson-01.json';
import type { Course, WordForm } from '../../../shared/types';
import type { GuidedLesson } from '../../../shared/learning';
import wordAudio from '../../../../public/audio/manifest.json';

// Throwaway A/B: compare information hierarchy on the unified 96ff337 source.
export const course: Course = { ...corpus as Course, words: corpus.words.map(word => ({ ...word, audioUrl: (wordAudio as Record<string, string>)[word.id] })) as Course['words'], forms: [...corpus.forms as WordForm[], ...lesson04.authored.forms as WordForm[]] };
export const group = lesson04.goals[0]!.parts[0]!;
export const family = group.words.map(introduction => ({ ...introduction, word: course.words.find(word => word.id === introduction.wordId)! }));
const abstractWord = (lesson01 as GuidedLesson).goals.flatMap(goal => goal.parts.flatMap(part => part.words)).find(value => value.wordId === 'marugoto.starter-a1.word.5806ccc1a4aa0772')!;
export const longGroup = [...family.slice(0, 4), { ...abstractWord, word: course.words.find(value => value.id === abstractWord.wordId)! }];
export const construction = course.skills.find(skill => skill.id.endsWith('.ga_ability'))!;
export const exercise = course.exercises.find(item => item.skillId === construction.id)!;
export const constructionIntro = (lesson03 as GuidedLesson).goals.flatMap(goal => goal.parts).find(part => part.construction?.exerciseId === exercise.id)?.construction;
export const states = { initial: 'До ответа', answer: 'Ответ', correct: 'Верно', wrong: 'Ошибка', saving: 'Сохранение', error: 'Сбой / повтор', long: 'Длинный материал', empty: 'Пусто' };
export type DemoState = keyof typeof states;
export type Screen = { id: string; section: string; name: string; family: string; states: DemoState[] };
const all: DemoState[] = ['initial', 'answer', 'correct', 'wrong', 'saving', 'error', 'long'];
const read: DemoState[] = ['initial', 'long', 'empty', 'error'];
export const screens: Screen[] = [
  { id: 'counter-answer', section: 'Счёт', name: 'Счёт · картинка → суффикс', family: 'counter', states: all },
  { id: 'counter-rule', section: 'Счёт', name: 'Счёт · знакомство с правилом', family: 'counter', states: ['initial', 'long', 'error'] },
  { id: 'counter-image', section: 'Счёт', name: 'Счёт · суффикс → картинка', family: 'counter', states: all },
  { id: 'counter-reading', section: 'Счёт', name: 'Счёт · чтение количества', family: 'counter', states: all },
  { id: 'counter-listening', section: 'Счёт', name: 'Счёт · на слух → количество', family: 'counter', states: all },
  { id: 'counter-recall', section: 'Счёт', name: 'Счёт · вспомнить количество', family: 'counter', states: all },
  { id: 'counter-age', section: 'Счёт', name: 'Счёт · возраст / большие числа', family: 'counter', states: all },
  { id: 'word-group', section: 'Изучение', name: 'Слова · знакомство с группой', family: 'group', states: ['initial', 'long', 'saving', 'error'] },
  { id: 'word-ja', section: 'Изучение', name: 'Слова · японский → русский', family: 'quiz', states: all },
  { id: 'word-listening', section: 'Изучение', name: 'Слова · аудирование', family: 'quiz', states: all },
  { id: 'word-ru', section: 'Изучение', name: 'Слова · русский → японский', family: 'quiz', states: all },
  { id: 'construction-intro', section: 'Изучение', name: 'Конструкция · объяснение', family: 'construction', states: ['initial', 'long', 'error'] },
  { id: 'construction-recall', section: 'Изучение', name: 'Конструкция · понимание текста', family: 'construction', states: all },
  { id: 'construction-listening', section: 'Изучение', name: 'Конструкция · аудирование', family: 'construction', states: all },
  { id: 'workspace', section: 'Изучение', name: 'Конструкция · сборка / разбор', family: 'workspace', states: ['initial', 'answer', 'correct', 'wrong', 'saving', 'error', 'long'] },
  { id: 'video', section: 'Изучение', name: 'Видео · диалог / субтитры', family: 'video', states: ['initial', 'answer', 'error', 'long'] },
  { id: 'repeat-ja', section: 'Повторение', name: 'Повторение · японский → русский', family: 'repeat', states: all },
  { id: 'repeat-ru', section: 'Повторение', name: 'Повторение · русский → японский', family: 'repeat', states: all },
  { id: 'repeat-listening', section: 'Повторение', name: 'Повторение · аудирование', family: 'repeat', states: all },
  { id: 'repeat-home', section: 'Повторение', name: 'Повторение · начало / нет заданий', family: 'landing', states: ['initial', 'empty', 'error'] },
  { id: 'completion', section: 'Повторение', name: 'Завершение · часть / урок / колода', family: 'completion', states: ['initial', 'answer', 'empty', 'error'] },
  { id: 'textbook', section: 'Разделы', name: 'Учебник · все 18 уроков', family: 'textbook', states: read },
  { id: 'video-library', section: 'Разделы', name: 'Учебник · материалы / видео', family: 'textbook', states: ['initial', 'answer', 'error'] },
  { id: 'reference-words', section: 'Справочник', name: 'Справочник · слова', family: 'reference', states: read },
  { id: 'reference-skills', section: 'Справочник', name: 'Справочник · конструкции', family: 'reference', states: read },
  { id: 'reference-particles', section: 'Справочник', name: 'Справочник · частицы', family: 'reference', states: read },
  { id: 'reference-hiragana', section: 'Справочник', name: 'Справочник · хирагана', family: 'kana', states: ['initial', 'long'] },
  { id: 'reference-katakana', section: 'Справочник', name: 'Справочник · катакана', family: 'kana', states: ['initial', 'long'] },
  { id: 'lists', section: 'Справочник', name: 'Личные списки · импорт / редактор', family: 'form', states: ['initial', 'answer', 'empty', 'saving', 'error', 'long'] },
  { id: 'settings', section: 'Аккаунт', name: 'Настройки · звук / написание', family: 'form', states: ['initial', 'saving', 'error'] },
  { id: 'admin', section: 'Аккаунт', name: 'Администратор · приглашения', family: 'form', states: ['initial', 'answer', 'empty', 'saving', 'error', 'long'] },
  { id: 'login', section: 'Аккаунт', name: 'Вход', family: 'form', states: ['initial', 'saving', 'error'] },
  { id: 'register', section: 'Аккаунт', name: 'Регистрация по приглашению', family: 'form', states: ['initial', 'answer', 'saving', 'error'] },
  { id: 'invite', section: 'Аккаунт', name: 'Персональное приглашение', family: 'form', states: ['initial', 'answer', 'saving', 'error'] },
  { id: 'recovery', section: 'Аккаунт', name: 'Восстановление пароля', family: 'form', states: ['initial', 'answer', 'saving', 'error'] },
  { id: 'system', section: 'Состояния', name: 'Загрузка / конфликт / офлайн', family: 'system', states: ['initial', 'saving', 'error', 'empty'] },
];
export const sectionNames = [...new Set(screens.map(screen => screen.section))];
