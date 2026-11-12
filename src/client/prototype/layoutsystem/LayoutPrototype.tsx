import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Cat } from '../../Cat';
import { CounterPicture, WordIllustration } from './Pictures';
import { Japanese } from '../../Japanese';
import { MixedText, spelling, wordSpelling, type Spelling } from './JapaneseText';
import { kanaAudio, kanaSoundKeys } from './kanaAudio';
import { basicKana, voicedKana, yoonKana, smallKana, katakana, particleSkills, exampleValue, type KanaEntry } from '../../referenceData';
import { counterDefinitions, counterObjects, counterAnswer } from '../../../shared/counters';
import type { Orthography } from '../../../shared/types';
import propsManifest from '../../../../public/scenes/props/manifest.json';
import { construction, constructionIntro, course, exercise, family, longGroup, group, screens, sectionNames, states, type DemoState } from './catalog';
import './layout.css';

type Variant = 'A' | 'B';
const names = { A: 'Иллюстрированная карточка', B: 'Учебный разворот' };
const artWord = family[1]!.word;
const groups = ['Слова', 'Конструкции', 'Частицы', 'Хирагана', 'Катакана', 'Личные списки'];
const sections = ['Учебник', 'Повторение', 'Справочник'];
const orderedScreens = ['word-group', 'word-ja', 'word-listening', 'word-ru', 'construction-intro', 'construction-recall', 'workspace', 'video', 'completion'];
const counterAudio: Record<string, string> = { 'にん': '/audio/a287e5fb3fab6f6231b3.m4a', 'ひとり': '/audio/a44ccb280d4ff2727068.m4a', 'よにん': '/audio/ab47074ceec2ec5458a0.m4a', 'いっぽん': '/audio/800097595e086f91b0b7.m4a', 'はたち': '/audio/d2f8af4e445e77e9cf54.m4a', 'ひゃくにじゅっさい': '/audio/67153358591b7a0b9397.m4a' };

export function LayoutPrototype() {
  const params = new URLSearchParams(location.search);
  const [variant, setVariant] = useState<Variant>(params.get('variant') === 'B' ? 'B' : 'A');
  const [screenId, setScreenId] = useState(params.get('screen') ?? 'counter-answer');
  const screen = screens.find(value => value.id === screenId) ?? screens[0]!;
  const [state, setState] = useState<DemoState>(screen.states.includes(params.get('state') as DemoState) ? params.get('state') as DemoState : screen.id === 'counter-answer' ? 'answer' : screen.states[0]!);
  const [mode, setMode] = useState<Orthography>('furigana');
  const [scene, setScene] = useState('mountains');
  const [lessonId, setLessonId] = useState(params.get('lesson') ?? course.lessons[3]!.id);
  const [goalId, setGoalId] = useState(params.get('goal') ?? '');
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [deckProgress, setDeckProgress] = useState({ completed: 0, total: 20 });
  const [kanaScript, setKanaScript] = useState<'hiragana' | 'katakana'>('hiragana');
  const currentLesson = course.lessons.find(value => value.id === lessonId) ?? course.lessons[3]!;
  const currentRoute = course.learning!.find(value => value.lessonId === currentLesson.id)!;
  const currentGoal = currentRoute.goals.find(value => value.id === goalId) ?? currentRoute.goals[0]!;
  const currentPart = currentGoal.parts[0]!;
  const studyWords = currentPart.words.map(introduction => ({ ...introduction, word: course.words.find(word => word.id === introduction.wordId)! }));
  const [notice, setNotice] = useState('');
  const [playing, setPlaying] = useState(false);
  const [rule, setRule] = useState<{ title: string; text: string } | null>(null);
  const [menu, setMenu] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(() => !matchMedia('(max-width: 740px), (max-height: 480px)').matches);
  useEffect(() => {
    const narrow = matchMedia('(max-width: 740px), (max-height: 480px)');
    const update = () => setControlsOpen(!narrow.matches);
    narrow.addEventListener('change', update);
    return () => narrow.removeEventListener('change', update);
  }, []);
  const audio = useRef<HTMLAudioElement | null>(null);
  const heard = useRef(new Set<string>());
  const modal = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const go = (id: string, next: DemoState = 'initial') => { const target = screens.find(value => value.id === id)!; setScreenId(id); setState(target.states.includes(next) ? next : target.states[0]!); setNotice(''); setMenu(false); setSelectedChoice(null); };
  useEffect(() => {
    const query = new URLSearchParams({ prototype: 'layout-system', variant, screen: screen.id, state, lesson: currentLesson.id, goal: currentGoal.id });
    history.replaceState(null, '', `/?${query}`);
    audio.current?.pause(); setPlaying(false); setNotice(''); body.current?.scrollTo({ top: 0 });
  }, [variant, screen.id, state, currentLesson.id, currentGoal.id]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.target instanceof HTMLElement && event.target.closest('input,select,textarea,[contenteditable],dialog')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setVariant(current => current === 'A' ? 'B' : 'A'); }
    };
    window.addEventListener('keydown', onKey); return () => { window.removeEventListener('keydown', onKey); audio.current?.pause(); };
  }, []);
  useEffect(() => { if (rule) modal.current?.showModal(); else modal.current?.close(); }, [rule]);
  const play = async (src?: string) => {
    audio.current?.pause(); setNotice('');
    if (!src) { setNotice('Запись пока недоступна. Это состояние макета — шаг не потерян.'); return; }
    const current = new Audio(src); audio.current = current; current.volume = .45;
    current.onended = () => setPlaying(false); current.onerror = () => { setPlaying(false); setNotice('Запись не загрузилась. Прослушайте ещё раз.'); };
    try { await current.play(); heard.current.add(src); setPlaying(true); } catch { setPlaying(false); setNotice('Нажмите «Прослушать» ещё раз, чтобы включить звук.'); }
  };
  const answered = ['answer', 'correct', 'wrong', 'saving', 'error'].includes(state);
  const documentPage = ['textbook', 'reference', 'kana', 'form'].includes(screen.family);
  const title = screen.family === 'counter' ? 'Счётные суффиксы' : screen.family === 'repeat' ? 'Повторение слов' : screen.family === 'group' || screen.family === 'quiz' ? currentLesson.title : screen.family === 'construction' || screen.family === 'workspace' ? `${currentLesson.title} · конструкция` : screen.family === 'video' ? `Диалог: ${currentLesson.title}` : screen.family === 'landing' ? 'Повторение' : screen.name.split(' · ')[0]!;
  const navIndex = screen.section === 'Повторение' || screen.section === 'Счёт' ? 1 : screen.section === 'Справочник' ? 2 : 0;
  const learningOrder = ['word-group', 'word-ja', 'word-listening', 'word-ru', ...(currentPart.construction ? ['construction-intro', 'construction-recall', 'construction-listening', 'workspace'] : []), ...(currentGoal.videoIds?.length ? ['video'] : []), 'completion'];
  const next = () => { const index = learningOrder.indexOf(screen.id); go(learningOrder[(index + 1) % learningOrder.length]!); };
  const activeConstruction = currentPart.construction ?? constructionIntro;
  const activeExercise = course.exercises.find(value => value.id === activeConstruction?.exerciseId) ?? exercise;
  const activeSkill = course.skills.find(value => value.id === activeExercise.skillId) ?? construction;
  const hint = (text: string) => setNotice(`${text} — демонстрация, данные не сохраняются.`);
  const ruleButton = (title: string, text: string) => <button className="ls-text-button" onClick={() => setRule({ title, text })}>Полное правило ↗</button>;
  const example = (ja = group.words[1]!.example.surface, ru = group.words[1]!.example.meaningRu, src = group.words[1]!.example.audioUrl) => <Example mode={mode} ja={ja} ru={ru} onPlay={() => { void play(src); }} />;
  const finish = <div className="ls-actions"><button onClick={() => setState('wrong')}>Ещё раз ↶</button><button className="primary" disabled={screen.family === 'counter' && state === 'wrong'} onClick={() => setState('correct')}>Помню ✓</button></div>;
  const counter = counterDefinitions.find(value => value.id === (screen.id === 'counter-age' ? 'sai' : screen.id === 'counter-reading' ? 'hon' : 'nin'))!;
  const quantity = screen.id === 'counter-age' ? state === 'long' ? 120 : 20 : state === 'long' ? 1_234_567 : screen.id === 'counter-listening' ? 4 : 1;
  const object = counterObjects.find(value => value.id === (screen.id === 'counter-reading' ? 'pencil' : 'person'))!;
  const counterValue = counterAnswer(counter, screen.id === 'counter-answer' || screen.id === 'counter-rule' ? null : quantity);

  function CounterScreen() {
    const intro = screen.id === 'counter-rule';
    const asking = !answered && !intro;
    const picture = asking && screen.id === 'counter-listening'
      ? <div className="ls-question-art" aria-hidden="true">♪<span>Послушайте количество</span></div>
      : asking && screen.id === 'counter-image'
        ? <div className="ls-question-art" aria-hidden="true"><Japanese value={counterAnswer(counter, null)} mode={mode} /></div>
        : <CounterPicture object={object} quantity={quantity} label={counter.title} age={counter.id === 'sai'} showQuantity={['counter-recall','counter-reading','counter-listening'].includes(screen.id) || quantity !== 1} />;
    const readingTask = screen.id === 'counter-reading' || screen.id === 'counter-age';
    const suffixOptions = readingTask ? [0, 1, 2, 3].map(offset => counterAnswer(counter, quantity + (quantity + 3 <= counter.maximum ? offset : -offset))) : ['nin', 'hon', 'mai', 'ko'].map(id => counterAnswer(counterDefinitions.find(value => value.id === id)!, null));
    const mainValue = asking ? screen.id === 'counter-listening'
      ? <button className="ls-listen" onClick={() => { void play(counterAudio['よにん']); }}>▶ Прослушать</button>
      : screen.id === 'counter-reading'
        ? <div className="ls-reading"><Japanese value={counterValue} mode="kanji" /></div>
        : screen.id === 'counter-image' ? undefined : undefined
      : <div className="ls-reading"><Japanese value={counterValue} mode={mode} />{mode === 'kanji' && <span lang="ja">{counterValue.kana}</span>}{counterAudio[counterValue.kana] && <button className="ls-icon" title={`Прослушать ${counterValue.kana}`} aria-label={`Прослушать ${counterValue.kana}`} onClick={() => { void play(counterAudio[counterValue.kana]); }}>▶</button>}</div>;
    const content = <StudyLayout mode={mode} variant={variant} picture={picture} label={intro ? 'Знакомимся со счётным словом' : asking ? screen.name.split(' · ')[1]! : state === 'wrong' ? 'Ещё раз — разберём ответ' : 'Ответ'} title={asking ? screen.id === 'counter-listening' ? 'Сколько человек вы услышали?' : screen.id === 'counter-image' ? 'Что считают с 人?' : screen.id === 'counter-recall' ? 'Как сказать это количество?' : screen.id === 'counter-reading' ? 'Выберите чтение' : screen.id === 'counter-age' ? 'Как назвать этот возраст?' : 'Какое счётное слово подходит?' : counter.title} main={mainValue} explanation={!asking ? <><p><MixedText text={counter.id === 'nin' ? 'Счётное слово для людей. Особые чтения: один — ひとり, двое — ふたり.' : counter.explanation} mode={mode} /></p>{ruleButton(counter.title, counter.explanation)}</> : <p className="ls-secondary">{screen.id === 'counter-answer' ? 'Один человек на картинке. Выберите подходящий суффикс.' : 'Выберите один вариант. Ответ появится после выбора.'}</p>} example={!asking ? <Example mode={mode} value={counter.id === 'nin' ? group.words[0]!.example : counterAnswer(counter, quantity)} ja={counter.id === 'nin' ? 'わたしのかぞくはさんにんです。' : counterAnswer(counter, quantity).kana} ru={counter.id === 'nin' ? 'В моей семье три человека.' : `${quantity.toLocaleString('ru-RU')} · ${counter.title}`} onPlay={() => counter.id === 'nin' ? void play(group.words[0]!.example.audioUrl) : void play(counterAudio[counterAnswer(counter, quantity).kana])} /> : undefined} actions={intro ? <button className="primary" onClick={() => go('counter-answer')}>К практике →</button> : asking ? screen.id === 'counter-recall' ? <GestureHint answered={false} /> : <div className="ls-options" data-picture-options={screen.id === 'counter-image' || screen.id === 'counter-listening'}>{suffixOptions.map((option, index) => <button key={option.surface} onClick={() => setState(index === 0 ? 'correct' : 'wrong')}>{screen.id === 'counter-image' || screen.id === 'counter-listening' ? <><CounterPicture object={screen.id === 'counter-listening' ? counterObjects[0]! : counterObjects[index === 0 ? 0 : index + 3]!} quantity={screen.id === 'counter-listening' ? [4, 2, 3, 1][index]! : 1} label={screen.id === 'counter-listening' || index === 0 ? 'человек' : ['','карандаш','бутылка','яйцо'][index]!} showQuantity={screen.id === 'counter-listening'} /></> : <Japanese value={option} mode={readingTask ? 'kana' : mode} />}</button>)}</div> : <GestureHint answered /> } />;
    return intro ? content : <Paper answered={answered} onReveal={screen.id === 'counter-recall' ? () => setState('answer') : undefined} onGrade={value => setState(state === 'wrong' ? 'wrong' : value)}>{content}</Paper>;
  }

  function GroupScreen() {
    return <><div className="ls-section-intro"><h2>{state === 'long' ? 'Проверка длинного материала · уроки 1 и 4' : 'Слова этой части'}</h2><p>Послушайте, посмотрите на пример, затем попробуйте вспомнить.</p></div><nav className="ls-goal-nav" aria-label="Цели выбранного урока">{currentRoute.goals.map(goal => <button key={goal.id} aria-pressed={goal.id === currentGoal.id} onClick={() => setGoalId(goal.id)}>{goal.titleRu}</button>)}</nav><div className="ls-word-overview">{(state === 'long' ? longGroup : studyWords).map(({ word, example: value, explanationRu }) => <article className="ls-word-tile" key={word.id}><div className="ls-word-art"><WordIllustration wordId={word.id} /></div><div className="ls-word-information"><div className="ls-word-title"><h3><Japanese value={wordSpelling(word)} mode={mode} /></h3><button className="ls-icon" aria-label={`Прослушать ${word.kana}`} onClick={() => { void play(word.audioUrl); }}>▶</button></div><p>{word.meaningRu}</p><p className="ls-secondary">{explanationRu}</p></div><Example mode={mode} value={value} ja={value.surface} ru={value.meaningRu} onPlay={() => { void play(value.audioUrl); }} /></article>)}</div><footer className="ls-end-actions"><button className="primary" onClick={() => go('word-ja')}>Начать практику →</button><span>{studyWords.length} слов · три способа вспомнить</span></footer></>;
  }

  function WordQuiz() {
    const listening = screen.id.endsWith('listening'); const reverse = screen.id === 'word-ru';
    const artWord = studyWords[1]?.word ?? studyWords[0]!.word;
    const candidates = [...studyWords.map(value => value.word), ...course.words.filter(value => value.lessonIds.includes(currentLesson.id) && value.id !== artWord.id)].filter((value, index, all) => all.findIndex(item => item.id === value.id) === index).slice(0,4);
    return <StudyLayout mode={mode} variant={variant} picture={answered ? <WordIllustration wordId={artWord.id} /> : <div className="ls-question-art" aria-hidden="true">{listening ? '♪' : reverse ? 'あ' : 'ことば'}<span>{listening ? 'Слушаем слово' : 'Вспоминаем без подсказки'}</span></div>} label={listening ? 'Понимание на слух' : reverse ? 'Русский → японский' : 'Японский → русский'} title={listening ? 'Что вы услышали?' : 'Выберите перевод'} main={listening ? <button className="ls-listen" onClick={() => { void play(artWord.audioUrl); }}>▶ {playing ? 'Слушаем…' : 'Прослушать слово'}</button> : <div className="ls-headword">{reverse ? artWord.meaningRu : <Japanese value={wordSpelling(artWord)} mode={mode} />}</div>} explanation={<p className="ls-secondary">{answered ? <>{state === 'wrong' && 'Правильный ответ: '}<Japanese value={wordSpelling(artWord)} mode={mode} /> — {artWord.meaningRu}.{state === 'wrong' && ' Задание вернётся после других слов.'}</> : 'Один правильный ответ. Картинка появится после выбора.'}</p>} actions={<div className="ls-options" data-answered={answered}>{candidates.map((candidate, index) => <button key={candidate.id} data-correct={answered && candidate.id === artWord.id} data-wrong={state === 'wrong' && candidate.id === (selectedChoice ?? candidates.find(value => value.id !== artWord.id)?.id)} disabled={answered} onClick={() => { setSelectedChoice(candidate.id); setState(candidate.id === artWord.id ? 'correct' : 'wrong'); }}><span>{reverse ? <Japanese value={wordSpelling(candidate)} mode={mode} /> : candidate.meaningRu}</span>{answered && candidate.id === artWord.id && <span>✓</span>}</button>)}</div>} example={answered ? <div className="ls-feedback" role="status"><strong>{state === 'wrong' ? 'Ещё немного практики' : 'Верно!'}</strong><span>{state === 'saving' ? 'Сохраняем ответ…' : 'Короткая реакция → следующее задание'}</span><button className="ls-text-button" onClick={next}>Показать следующий шаг →</button></div> : undefined} />;
  }

  function Repetition() {
    const listening = screen.id.endsWith('listening'), reverse = screen.id === 'repeat-ru';
    const reveal = () => {
      if (listening && artWord.audioUrl && !heard.current.has(artWord.audioUrl)) { void play(artWord.audioUrl); return; }
      setState('answer');
    };
    return <Paper answered={answered} onReveal={reveal} onGrade={setState}>
      <StudyLayout mode={mode} variant={variant}
        picture={answered ? <WordIllustration wordId={artWord.id} /> : <div className="ls-question-art" aria-hidden="true">{listening ? '♪' : 'ことば'}<span>Сначала вспомните сами</span></div>}
        label={answered ? 'Сверьте свой ответ' : 'Вспомните без вариантов'}
        title={answered ? artWord.meaningRu : listening ? 'Какое слово прозвучало?' : reverse ? artWord.meaningRu : 'Что значит это слово?'}
        main={listening && !answered ? <button className="ls-listen" onClick={() => { void play(artWord.audioUrl); }}>▶ Прослушать</button> : <div className="ls-headword">{(!reverse || answered) && <Japanese value={wordSpelling(artWord)} mode={mode} />}{answered && <button className="ls-icon" title={`Прослушать ${artWord.kana}`} aria-label={`Прослушать ${artWord.kana}`} onClick={() => { void play(artWord.audioUrl); }}>▶</button>}</div>}
        explanation={answered ? <p><MixedText text={group.words[1]!.explanationRu} mode={mode} /></p> : undefined}
        example={answered ? example() : undefined} actions={<GestureHint answered={answered} />} />
    </Paper>;
  }

  function ConstructionScreen() {
    const exercise = activeExercise, construction = activeSkill, constructionIntro = activeConstruction;
    const value = exampleValue(course, exercise), intro = screen.id === 'construction-intro';
    const listening = screen.id === 'construction-listening';
    const reveal = () => {
      if (listening && constructionIntro?.example.audioUrl && !heard.current.has(constructionIntro.example.audioUrl)) { void play(constructionIntro.example.audioUrl); return; }
      setState('answer');
    };
    const content = <StudyLayout mode={mode} variant={variant}
      picture={listening && !answered ? <div className="ls-question-art" aria-hidden="true">♪</div> : <div className="ls-language-plate">{exercise.tokens.map(token => course.forms.find(form => form.id === token.formId)!.surface).map(text => <span key={text}><Japanese value={spelling(text)} mode={mode} /></span>)}</div>}
      label={intro ? 'Как устроена фраза' : listening ? 'Понимание на слух' : 'Понимание японской фразы'}
      title={intro ? construction.title : 'Вспомните смысл'}
      main={listening && !answered ? <button className="ls-listen" onClick={() => { void play(constructionIntro?.example.audioUrl); }}>▶ Прослушать фразу</button> : <div className="ls-headword"><Japanese value={value} mode={mode} /></div>}
      explanation={intro || answered ? <><p><MixedText text={construction.explanationRu.split('. ')[0] + '.'} mode={mode} /></p>{ruleButton(construction.title, construction.explanationRu)}</> : undefined}
      example={intro || answered ? <Example mode={mode} value={value} ja={value.surface} ru={exercise.translationRu ?? exercise.promptRu} onPlay={constructionIntro?.example.audioUrl ? () => { void play(constructionIntro?.example.audioUrl); } : undefined} /> : undefined}
      actions={intro ? <button className="primary" onClick={() => go('construction-recall')}>К практике →</button> : <GestureHint answered={answered} />} />;
    return intro ? content : <Paper answered={answered} onReveal={reveal} onGrade={setState}>{content}</Paper>;
  }

  function Textbook() {
    if (screen.id === 'video-library') return <><div className="ls-section-intro"><small>Урок {currentLesson.number}</small><h2>{currentLesson.title}</h2><p>{currentGoal.titleRu}</p></div><VideoScreen library currentLesson={currentLesson} currentGoal={currentGoal} state={state} mode={mode} next={next} /></>;
    return <><div className="ls-section-intro"><h2>Учебник</h2><p>18 уроков · 9 тем · Marugoto Starter A1</p></div><section className="ls-counter-entry"><CounterPicture object={counterObjects[0]!} quantity={3} label="Три человека" /><div><h3>Счётные суффиксы</h3><p>Считаем людей, предметы и возраст. Колода до 20 карточек.</p><small>人 и 歳 доступны · остальные откроются с изученными словами</small></div><button onClick={() => go('counter-rule')}>Тренировать счёт →</button></section><div className="ls-lesson-list">{course.lessons.map((lesson, index) => <article className="ls-lesson" key={lesson.id}><Topic topic={Number(lesson.topic)} /><div><small>Урок {lesson.number} · {index === 3 ? 'Изучение начато · 24%' : index === 0 ? 'Урок пройден' : 'Новый урок'}</small><h3>{lesson.title}</h3><p>{course.words.filter(word => word.lessonIds.includes(lesson.id)).length} слов и фраз · Can-do {lesson.canDoIds.join(', ')}</p><details><summary>Материал урока</summary><p>{lesson.number === 4 ? 'Коротко рассказать о своей семье. Назвать человека на фото, возраст и место проживания.' : `Слова, конструкции и примеры урока «${lesson.title}».`}</p><button className="ls-text-button" onClick={() => { setLessonId(lesson.id); setGoalId(''); go('video-library'); }}>Диалоги и дополнительные материалы →</button></details></div><button className="primary" onClick={() => { setLessonId(lesson.id); setGoalId(''); go('word-group'); }}>{index === 3 ? 'Продолжить' : index === 0 ? 'Итог урока' : 'Начать урок'}</button></article>)}</div></>;
  }

  function Reference() {
    const wordScreen = screen.id === 'reference-words'; const particles = screen.id === 'reference-particles';
    return <><ReferenceNav current={screen.id} go={go} /><div className="ls-section-intro"><h2>{wordScreen ? 'Изученные слова' : particles ? 'Частицы и падежные показатели' : 'Изученные конструкции'}</h2><p>Просмотр справки не меняет расписание повторений.</p>{!wordScreen && !particles && <button className="primary" onClick={() => go('construction-trainer')}>Тренировать изученные конструкции →</button>}</div>{state === 'empty' ? <Empty title="Здесь появится изученное" text="После первой оценённой попытки материал доступен в вашем справочнике." action={() => go('textbook')} /> : wordScreen ? <><label className="ls-search">Найти слово<input type="search" placeholder="Написание или перевод" /></label><div className="ls-reference-list">{(state === 'long' ? longGroup : family).map(({ word, explanationRu, example: value }) => <article className="ls-reference-word" key={word.id}><div className="ls-word-art"><WordIllustration wordId={word.id} /></div><div><h3><Japanese value={wordSpelling(word)} mode={mode} /></h3><p>{word.meaningRu}</p><small>Урок 4 · Семья</small><p className="ls-secondary">{explanationRu}</p></div><button className="ls-icon" aria-label={`Прослушать ${word.kana}`} onClick={() => { void play(word.audioUrl); }}>▶</button><Example mode={mode} value={value} ja={value.surface} ru={value.meaningRu} onPlay={() => { void play(value.audioUrl); }} /></article>)}</div></> : <div className="ls-rule-list">{(particles ? Object.keys(particleSkills).map(particle => { const skill = course.skills.find(skill => particleSkills[particle]!.some(name => skill.id.endsWith(`.${name}`))); return { id: skill?.id ?? '', title: particle, explanationRu: skill?.explanationRu ?? '' }; }) : course.skills.slice(0, state === 'long' ? 18 : 6)).map(item => <article key={item.title}><h3><MixedText text={item.title} mode={mode} /></h3><p>{item.explanationRu.split('. ')[0]}.</p>{course.exercises.filter(entry => entry.skillId === item.id).slice(0,1).map(entry => <Example mode={mode} key={entry.id} ja={exampleValue(course, entry).surface} ru={entry.translationRu ?? entry.promptRu} />)}<button className="ls-text-button" onClick={() => setRule({ title: item.title, text: item.explanationRu })}>Полное правило ↗</button></article>)}</div>}</>;
  }

  function Kana() {
    const isKata = screen.id === 'reference-katakana'; const convert = isKata ? katakana : (value: string) => value;
    return <><ReferenceNav current={screen.id} go={go} /><div className="ls-section-intro"><h2>{isKata ? 'Катакана' : 'Хирагана'}</h2><p>46 основных знаков. Чтение под знаком, сочетания — отдельными таблицами.</p><button className="primary" onClick={() => { setKanaScript(isKata ? 'katakana' : 'hiragana'); go('kana-trainer'); }}>Тренировать азбуку →</button></div>{[['Основные знаки', basicKana], ['Дакутэн и хандакутэн', voicedKana], ['Ёон', yoonKana], ['Малые знаки', smallKana]].map(([label, entries]) => <section className="ls-kana-section" key={label as string}><h3>{label as string}</h3><div className="ls-kana-grid">{(entries as typeof basicKana).flatMap(row => row.cells).filter(entry => entry !== null).map((entry, index) => <button key={`${entry.kana}:${index}`} aria-label={`${convert(entry.kana)} — ${entry.reading}`} onClick={() => hint(`Знак ${convert(entry.kana)} · ${entry.reading}`)}><strong lang="ja">{convert(entry.kana)}</strong><span>{entry.reading || 'малый знак'}</span></button>)}</div></section>)}<p className="ls-secondary">В роли частиц は читается wa, へ — e, を — o. Написание сохраняется.</p></>;
  }

  function FormScreen() {
    const account = ['login', 'register', 'invite', 'recovery'].includes(screen.id);
    const registration = screen.id === 'register'; const recovery = screen.id === 'recovery';
    const submit = (text: string) => { setState('answer'); hint(text); };
    const field = (label: string, value = '', type = 'text') => <label><span>{label}</span><input type={type} defaultValue={value} minLength={type === 'password' ? 8 : undefined} maxLength={type === 'password' ? 128 : undefined} placeholder={type === 'password' ? 'Не менее 8 символов' : undefined} /></label>;
    return <div className="ls-form-layout"><aside className="ls-form-aside"><Topic topic={screen.id === 'lists' ? 1 : 2} /><h2>{screen.id === 'settings' ? 'Учиться в своём ритме' : screen.id === 'admin' ? 'Учимся вместе' : screen.id === 'lists' ? 'К следующему занятию' : recovery ? 'Снова с нами' : 'Добро пожаловать'}</h2><p>{screen.id === 'admin' ? 'Ссылка приглашает обычного ученика с личным прогрессом.' : screen.id === 'lists' ? 'Личные подборки дополняют учебник. Завершённые слова попадают в повторение.' : 'Прогресс сохраняется для каждого ученика отдельно.'}</p></aside><div className="ls-form-content"><h2>{screen.name.split(' · ')[0]}</h2>{account ? <form onSubmit={event => { event.preventDefault(); submit(recovery ? 'Пароль изменён' : registration ? 'Регистрация завершена' : 'Вход выполнен'); }}><p className="ls-secondary">{registration ? 'Введите свои данные. Приглашение действует ещё 7 дней; осталось 5 регистраций.' : recovery ? 'Задайте новый пароль. Эта ссылка используется один раз.' : screen.id === 'invite' ? 'Вас пригласили изучать японский. Завершите создание аккаунта.' : 'Продолжите изучение с сохранённого шага.'}</p>{(registration || screen.id === 'invite') && field('Имя')}{!recovery && field('Email', screen.id === 'invite' ? 'student@example.test' : '', 'email')}{field(recovery ? 'Новый пароль' : 'Пароль', '', 'password')}<button className="primary" type="submit" disabled={state === 'saving'}>{state === 'saving' ? 'Подождите…' : registration || screen.id === 'invite' ? 'Создать аккаунт' : recovery ? 'Сохранить пароль' : 'Войти'}</button><small>Пароль 8–128 символов.{registration && ' Email без письма подтверждения.'}</small></form> : screen.id === 'settings' ? <form onSubmit={event => { event.preventDefault(); submit('Настройки сохранены'); }}><section><h3>Написание и движение</h3><label>Японское написание<select value={mode} onChange={event => setMode(event.target.value as Orthography)}><option value="kana">Кана</option><option value="furigana">С фуриганой</option><option value="kanji">Кандзи</option></select></label><label className="ls-check"><input type="checkbox" defaultChecked />Движение кота-помощника</label><small>Уменьшение движения на устройстве имеет приоритет.</small></section><section><h3>Звук</h3><label className="ls-check"><input type="checkbox" />Звуки сцены во время занятия</label>{['Музыка', 'Звуки окружения', 'Эффекты действий', 'Японская озвучка'].map((label, i) => <label className="ls-volume" key={label}><span>{label}</span><input type="range" min="0" max="100" defaultValue={i === 3 ? 80 : 35} /><output>{i === 3 ? '80%' : '35%'}</output></label>)}</section><button className="primary" disabled={state === 'saving'}>Сохранить настройки</button><section><h3>Ваш аккаунт</h3><p>Анна · student@example.test</p><button type="button" onClick={() => go('login')}>Выйти</button><small>Для смены пароля обратитесь к администратору.</small></section></form> : screen.id === 'admin' ? <><form onSubmit={event => { event.preventDefault(); submit('Создана демонстрационная ссылка'); }}><h3>Новая регистрационная ссылка</h3><div className="ls-field-pair">{field('Регистраций', '5', 'number')}{field('Срок, дней', '7', 'number')}</div><p className="ls-secondary">При двух ограничениях ссылка закроется по первому достигнутому пределу.</p><button className="primary">Создать ссылку</button></form>{state === 'answer' && <div className="ls-local-note"><strong>Скопируйте ссылку сейчас</strong><input readOnly value="https://example.test/register?token=prototype-only-not-a-real-link" /><button onClick={() => hint('Ссылка скопирована только в демонстрации')}>Скопировать</button></div>}<section><h3>Выданные ссылки</h3>{state === 'empty' ? <p>Регистрационных ссылок пока нет.</p> : ['Действует · осталось 3 из 5', 'Срок истёк · 2 регистрации', 'Отозвана · 1 регистрация'].map((value, index) => <div className="ls-admin-row" key={value}><div><strong>{value}</strong><small>Создана 22.10.2026 · лимит 5 · 7 дней</small></div><button disabled={index > 0} onClick={() => hint('Ссылка отозвана')}>Отозвать</button></div>)}</section><details><summary>Персональное приглашение и восстановление</summary>{field('Email ученика', '', 'email')}<div className="ls-actions"><button onClick={() => go('invite')}>Пригласить</button><button onClick={() => go('recovery')}>Восстановить доступ</button></div></details></> : <><form onSubmit={event => { event.preventDefault(); submit('Список добавлен'); }}><h3>Добавить список</h3>{field('Название', 'К следующему занятию')}<label>Слова, по одному в строке<textarea defaultValue={'日本語; にほんご; японский язык\n猫; ねこ; кошка'} /></label><small>Слово; чтение; русский перевод. Неизвестное чтение можно оставить пустым.</small><button className="primary">Добавить список</button></form>{state !== 'empty' && <section><div className="ls-spread"><h3>Мой список · 2 слова</h3><button onClick={() => go('word-group')}>Тренировать</button></div>{family.slice(0, 2).map(({ word }) => <details key={word.id}><summary><Japanese value={wordSpelling(word)} mode={mode} /> — {word.meaningRu}</summary>{field('Написание', word.surface)}{field('Чтение', word.kana)}{field('Перевод', word.meaningRu)}<label className="ls-check"><input type="checkbox" defaultChecked />Чтение проверено</label><button onClick={() => hint('Слово сохранено')}>Сохранить слово</button></details>)}</section>}</>}{state === 'answer' && account && <Status text="Готово. Это демонстрация; настоящий аккаунт не создан." />}{state === 'error' && <Status kind="error" text={account ? 'Ссылка истекла или данные введены неверно. Проверьте email и пароль.' : 'Не удалось сохранить. Введённые данные остались в форме.'} onRetry={() => setState('initial')} />}</div></div>;
  }

  function Contents() {
    if (screen.family === 'counter') return CounterScreen();
    if (screen.family === 'group') return GroupScreen();
    if (screen.family === 'quiz') return WordQuiz();
    if (screen.family === 'repeat') return Repetition();
    if (screen.family === 'construction') return ConstructionScreen();
    if (screen.family === 'workspace') return <Workspace activeExercise={activeExercise} activeSkill={activeSkill} activeConstruction={activeConstruction} state={state} mode={mode} ruleButton={ruleButton} next={next} />;
    if (screen.family === 'video') return <VideoScreen currentLesson={currentLesson} currentGoal={currentGoal} state={state} mode={mode} next={next} />;
    if (screen.family === 'textbook') return Textbook();
    if (screen.family === 'reference') return Reference();
    if (screen.family === 'kana') return Kana();
    if (screen.family === 'kana-drill') return <KanaDrill initialScript={kanaScript} variant={variant} mode={mode} state={state} onProgress={setDeckProgress} play={play} />;
    if (screen.family === 'construction-drill') return <ConstructionDrill variant={variant} mode={mode} state={state} onProgress={setDeckProgress} play={play} go={go} />;
    if (screen.family === 'form') return FormScreen();
    if (screen.family === 'landing') return <RepeatLanding mode={mode} variant={variant} empty={state === 'empty'} go={go} />;
    if (screen.family === 'completion') return <StudyLayout mode={mode} variant={variant} picture={<WordIllustration wordId={family[0]!.word.id} />} label={state === 'answer' ? 'Урок завершён' : 'Часть завершена'} title="Хорошая работа!" main={<div className="ls-stats"><div><strong>5</strong><span>новых слов</span></div><div><strong>1</strong><span>конструкция</span></div></div>} explanation={<p>Подтверждённые ответы сохранены. Неуверенные задания вернутся по сроку; можно продолжить следующую часть без дневного ограничения.</p>} actions={<div className="ls-actions"><button className="primary" onClick={() => go('word-group')}>Следующая часть →</button><button onClick={() => go('textbook')}>В учебник</button></div>} />;
    return <Empty title={state === 'saving' ? 'Загружаем ваш шаг…' : state === 'error' ? 'Не удалось продолжить' : state === 'empty' ? 'Маршрут готовится' : 'Ваш шаг сохранён'} text={state === 'error' ? 'Другой экран уже сохранил ответ. Обновите шаг; неподтверждённый ответ останется доступен для повторной отправки.' : 'Здесь виден статус загрузки и возобновления. Содержимое не прыгает между состояниями.'} action={() => go('word-group')} />;
  }

  return <div className="layout-demo game-shell" data-variant={variant} data-document={documentPage} data-screen={screen.id} data-state={state}>
    <picture className="ls-backdrop"><source media="(max-width: 540px)" srcSet={`/scenes/${scene}-mobile-v1.webp`} /><img src={`/scenes/${scene}-v1.webp`} alt="" /></picture>
    <header className="ls-hud"><nav aria-label="Разделы приложения">{sections.map((label, index) => <button key={label} aria-current={navIndex === index ? 'page' : undefined} onClick={() => go(['textbook', 'repeat-home', 'reference-words'][index]!)}>{navIndex === index && <span aria-hidden="true">❧</span>}{label}</button>)}<button className="ls-icon" aria-label="Настройки звука" onClick={() => go('settings')}>♫</button><button className="ls-icon" aria-label="Открыть меню аккаунта" onClick={() => setMenu(value => !value)}>⚙</button></nav>{menu && <div className="ls-account-menu"><button onClick={() => go('settings')}>Настройки</button><button onClick={() => go('admin')}>Администратор</button><button onClick={() => go('login')}>Войти / выйти</button></div>}</header>
    <main className="ls-stage"><section className="ls-board" aria-label="Рабочая доска"><header className="ls-context"><div><small>{screen.family.endsWith('-drill') ? 'Отдельная тренировка' : screen.family === 'counter' ? 'Колода · 20 карточек' : documentPage ? 'まるごと · японский к занятию' : `Урок ${currentLesson.number} · часть 1 из ${currentGoal.parts.length}`}</small><h1>{title}</h1></div><div className="ls-context-actions">{!documentPage && <span>{screen.family.endsWith('-drill') ? `${deckProgress.completed} / ${deckProgress.total}` : '4 / 20'}</span>}<button onClick={() => go('textbook')}>{documentPage ? 'Учебник' : 'Завершить'}</button></div>{!documentPage && <progress value={screen.family.endsWith('-drill') ? deckProgress.completed : 4} max={screen.family.endsWith('-drill') ? Math.max(1, deckProgress.total) : 20} aria-label="Прогресс занятия" />}</header><div className="ls-board-body" ref={body}>{Contents()}{!['form', 'video', 'textbook', 'reference'].includes(screen.family) && state === 'error' && <Status kind="error" text="Ответ остаётся на этой карточке. Не удалось сохранить — повторите отправку." onRetry={() => setState('saving')} />}{state === 'saving' && screen.family !== 'form' && <Status text="Сохраняем ответ… Следующий шаг появится после подтверждения." />}{notice && <Status text={notice} />}</div></section><div className="ls-still-life" aria-hidden="true"><Prop id="tea" /><Prop id="teapot" /><Prop id="dorayaki" /><Prop id="brushes" /></div><div className="ls-cat"><Cat playful pose={state === 'correct' ? 'success' : state === 'wrong' ? 'encourage' : screen.family === 'completion' ? 'wave' : 'neutral'} activity={playing ? 'listening' : state === 'correct' ? 'saved-good' : state === 'wrong' ? 'saved-again' : screen.family === 'completion' ? 'complete' : 'idle'} reactionKey={`${screen.id}:${state}`} /></div></main>
    <aside className="ls-demo-dock" aria-label="Панель макета"><button aria-label="Предыдущий вариант" onClick={() => setVariant(current => current === 'A' ? 'B' : 'A')}>←</button><div className="ls-demo-title"><strong>{variant} · {names[variant]}</strong><span>Макет — прогресс не сохраняется</span></div><button aria-label="Следующий вариант" onClick={() => setVariant(current => current === 'A' ? 'B' : 'A')}>→</button><details className="ls-demo-controls" open={controlsOpen} onToggle={event => setControlsOpen(event.currentTarget.open)}><summary>Экраны</summary><div className="ls-demo-options"><label><span>Экран</span><select value={screen.id} onChange={event => go(event.target.value)}>{sectionNames.map(section => <optgroup key={section} label={section}>{screens.filter(item => item.section === section).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>)}</select></label><label><span>Состояние</span><select value={state} onChange={event => setState(event.target.value as DemoState)}>{screen.states.map(value => <option key={value} value={value}>{states[value]}</option>)}</select></label><details className="ls-demo-more"><summary>Ещё</summary><label>Написание<select value={mode} onChange={event => setMode(event.target.value as Orthography)}><option value="kana">Кана</option><option value="furigana">Фуригана</option><option value="kanji">Кандзи</option></select></label><label>Место<select value={scene} onChange={event => setScene(event.target.value)}><option value="mountains">Горы</option><option value="room">Комната</option><option value="garden">Сад</option><option value="river">Река</option><option value="tokyo">Токио</option></select></label></details></div></details></aside>
    <dialog className="ls-rule-dialog" ref={modal} onCancel={() => setRule(null)}><div className="ls-spread"><small>Полное правило</small><button aria-label="Закрыть правило" onClick={() => setRule(null)}>✕</button></div><h2><MixedText text={rule?.title ?? ''} mode={mode} /></h2><p><MixedText text={rule?.text ?? ''} mode={mode} /></p><p className="ls-secondary">Материал из существующего курса. В макете ни просмотр правила, ни ответы не меняют прогресс.</p><button className="primary" onClick={() => setRule(null)}>Вернуться к карточке</button></dialog>
  </div>;
}

function Workspace({ activeExercise, activeSkill, activeConstruction, state, mode, ruleButton, next }: { activeExercise: typeof exercise; activeSkill: typeof construction; activeConstruction: typeof constructionIntro; state: DemoState; mode: Orthography; ruleButton: (title: string, text: string) => ReactNode; next: () => void }) {
    const exercise = activeExercise, construction = activeSkill;
    const bank = exercise.tokens.map(token => course.forms.find(form => form.id === token.formId)!.surface);
    const [selected, setSelected] = useState<string[]>(state === 'initial' ? [] : [...bank]);
    const [picker, setPicker] = useState(false);
    return <div className="ls-workspace"><header><small>Соберите фразу</small><h2>{exercise.promptRu}</h2><p className="ls-secondary">Меняйте слова и частицы. Разбор обновляется после паузы.</p></header><div className="ls-workspace-columns"><section><h3>Ваша фраза</h3><div className="ls-token-tray" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const token = event.dataTransfer.getData('text/plain'); if (bank.includes(token)) setSelected(items => [...items, token]); }}>{selected.length ? selected.map((token, index) => <button key={`${token}:${index}`} draggable onClick={() => setSelected(items => items.filter((_, position) => position !== index))} onDragStart={event => event.dataTransfer.setData('text/plain', token)}><Japanese value={spelling(token)} mode={mode} /></button>) : <span>Перетащите или нажмите слово снизу</span>}<button aria-label="Добавить или заменить элемент" onClick={() => setPicker(true)}>＋</button></div><div className="ls-token-bank">{bank.map(token => <button draggable key={token} onDragStart={event => event.dataTransfer.setData('text/plain', token)} onClick={() => setSelected(items => [...items, token])}><Japanese value={spelling(token)} mode={mode} /></button>)}</div><label>Своя фраза<textarea defaultValue={state === 'long' ? 'わたしはともだちとにほんのレストランでひるごはんをたべます。' : ''} placeholder="Можно набрать фразу целиком" /></label></section><aside className="ls-analysis"><small>Разбор</small><h3>{state === 'saving' ? 'Разбираем фразу…' : state === 'error' ? 'Разбор недоступен' : state === 'wrong' ? 'Проверим частицу' : selected.length ? 'Фраза собрана' : 'Начните со слова'}</h3><p>{state === 'error' ? 'Ваша фраза осталась на месте. Попробуйте ещё раз.' : activeConstruction?.explanationRu ?? construction.explanationRu}</p>{selected.length > 0 && <dl>{activeConstruction?.breakdown.map(piece => <div key={piece.text}><dt><Japanese value={spelling(piece.text)} mode={mode} /></dt><dd>{piece.explanationRu}</dd></div>)}</dl>}{ruleButton(construction.title, construction.explanationRu)}</aside></div><footer className="ls-end-actions"><button className="primary" onClick={next}>Дальше →</button><span>Свободные изменения не ухудшают повторения</span></footer>{picker && <div className="ls-picker"><h3>Добавить слово или частицу</h3><label>Найти<input type="search" placeholder="日本語 или японский" /></label><div className="ls-actions">{['に', 'が', 'も', '英語'].map(token => <button key={token} onClick={() => { setSelected(items => [...items, token]); setPicker(false); }}><Japanese value={spelling(token)} mode={mode} /></button>)}</div><button onClick={() => setPicker(false)}>Закрыть</button></div>}</div>;
  }


function VideoScreen({ library = false, currentLesson, currentGoal, state, mode, next }: { library?: boolean; currentLesson: (typeof course.lessons)[number]; currentGoal: { titleRu: string; videoIds?: string[] }; state: DemoState; mode: Orthography; next: () => void }) {
    const allMaterials = currentLesson.videos ?? [];
    const materials = library ? allMaterials : allMaterials.filter(value => currentGoal.videoIds?.includes(value.id));
    const [index, setIndex] = useState(0); const [time, setTime] = useState(7);
    const selected = materials[index];
    if (!selected) return <Empty title="У этой цели нет видеосценки" text="Можно продолжить урок: просмотр видео остаётся необязательным." action={next} />;
    const caption = selected.captions.find(value => time >= value.startSeconds && (value.endSeconds === null || time < value.endSeconds))?.text;
    return <div className="ls-video-layout">{library && <aside className="ls-video-index"><h3>Сценки урока · {materials.length}</h3>{materials.map((video, i) => <button key={video.id} aria-pressed={i === index} onClick={() => { setIndex(i); setTime(7); }}>{video.title}</button>)}</aside>}<div className="ls-video-main"><div className="ls-section-intro"><small>Marugoto Plus · Can-do {selected.canDoId}</small><h2>{selected.title}</h2><p className="ls-secondary">Урок {currentLesson.number} · {currentGoal.titleRu}</p></div><video key={selected.id} src={selected.mediaUrl} controls preload="none" onTimeUpdate={event => setTime(event.currentTarget.currentTime)} /><div className="ls-caption">{caption ? <Japanese value={spelling(caption)} mode={mode} /> : <span className="ls-secondary">Японская реплика появится здесь во время просмотра.</span>}</div><div className="ls-video-source"><a href={selected.sourceUrl} target="_blank" rel="noreferrer">Оригинал на Marugoto Plus ↗</a><small>The Japan Foundation Japanese-Language Institute, Kansai.</small></div>{state === 'error' && <Status kind="error" text="Не удалось воспроизвести. Можно открыть оригинал или продолжить урок." />}<footer className="ls-end-actions"><button className="primary" onClick={() => { if (index + 1 < materials.length) { setIndex(index + 1); setTime(0); } else next(); }}>{index + 1 < materials.length ? 'Следующий диалог →' : 'Продолжить урок →'}</button><span>Видео необязательно · просмотр не меняет повторения</span></footer></div></div>;
  }


function StudyLayout({ variant, picture, label, title, main, explanation, example, actions, mode = 'furigana' }: { variant: Variant; mode?: Orthography; picture: ReactNode; label: string; title: string; main?: ReactNode; explanation?: ReactNode; example?: ReactNode; actions?: ReactNode }) {
  return variant === 'A' ? <article className="ls-study ls-illustrated"><div className="ls-hero-art">{picture}</div><div className="ls-study-information"><header><small>{label}</small><h2><MixedText text={title} mode={mode} /></h2></header>{main && <div className="ls-main-value">{main}</div>}{explanation && <div className="ls-explanation">{explanation}</div>}{example && <div className="ls-study-example">{example}</div>}<footer className="ls-study-actions">{actions}</footer></div></article> : <article className="ls-study ls-spread-layout"><div className="ls-editorial-art"><div className="ls-hero-art">{picture}</div><span className="ls-editorial-caption">まるごと · маленькие открытия каждый день</span></div><div className="ls-editorial-main"><header><small>{label}</small><h2><MixedText text={title} mode={mode} /></h2></header>{main && <div className="ls-main-value">{main}</div>}{explanation && <div className="ls-explanation">{explanation}</div>}<div className="ls-study-actions">{actions}</div></div>{example && <aside className="ls-editorial-note"><span>Пример в речи</span>{example}</aside>}</article>;
}
function Example({ ja, ru, onPlay, mode, value }: { ja: string; ru: string; onPlay?: () => void; mode: Orthography; value?: Spelling }) {
  const [translated, setTranslated] = useState(false);
  return <div className="ls-example"><button aria-label="Переключить перевод примера" aria-pressed={translated} onClick={() => setTranslated(value => !value)}><span lang="ja" aria-hidden={translated} style={{ visibility: translated ? 'hidden' : 'visible' }}><Japanese value={value ?? spelling(ja)} mode={mode} /></span><span lang="ru" aria-hidden={!translated} style={{ visibility: translated ? 'visible' : 'hidden' }}>{ru}</span></button>{onPlay && <button className="ls-icon" title="Прослушать пример" aria-label={`Прослушать пример: ${ja}`} onClick={onPlay}>▶</button>}</div>;
}
function Status({ kind, text, onRetry }: { kind?: string; text: string; onRetry?: () => void }) { return <div className="ls-status" data-kind={kind} role={kind === 'error' ? 'alert' : 'status'}><p>{text}</p>{onRetry && <button onClick={onRetry}>Попробовать ещё раз</button>}</div>; }
function Empty({ title, text, action }: { title: string; text: string; action: () => void }) { return <div className="ls-empty"><h2>{title}</h2><p>{text}</p><button className="primary" onClick={action}>В учебник →</button></div>; }
function Topic({ topic }: { topic: number }) { return <span className="ls-topic" data-topic={topic} aria-hidden="true" />; }
function ReferenceNav({ current, go }: { current: string; go: (value: string) => void }) { return <nav className="ls-reference-nav" aria-label="Разделы справочника">{groups.map((label, index) => { const id = ['reference-words', 'reference-skills', 'reference-particles', 'reference-hiragana', 'reference-katakana', 'lists'][index]!; return <button key={id} aria-pressed={current === id} onClick={() => go(id)}>{label}</button>; })}</nav>; }
function Prop({ id }: { id: string }) { const tile = propsManifest.tiles.find(value => value.id === id)!; const bounds = tile.contentBounds; return <svg className="ls-prop" data-prop={id} aria-hidden="true" viewBox={`${tile.rect.x + bounds.x * 384} ${tile.rect.y + bounds.y * 384} ${bounds.width * 384} ${bounds.height * 384}`}><image href={propsManifest.src} width="1536" height="768" /></svg>; }
function GestureHint({ answered }: { answered: boolean }) {
  return <p className="ls-gesture-hint">{answered ? '← Ещё раз · Помню →' : 'Нажмите карточку, чтобы открыть ответ'}<small>{answered ? 'Сдвиньте бумагу или используйте стрелки клавиатуры' : 'На клавиатуре — Enter или пробел'}</small></p>;
}

function RepeatLanding({ mode, variant, empty, go }: { mode: Orthography; variant: Variant; empty: boolean; go: (id: string) => void }) {
  const [selected, setSelected] = useState(['words', 'counters', 'constructions']);
  const types = [{ id: 'words', label: 'Слова', count: 12 }, { id: 'counters', label: 'Счётные суффиксы', count: 5 }, { id: 'constructions', label: 'Конструкции', count: 3 }];
  const due = empty ? 0 : types.filter(type => selected.includes(type.id)).reduce((sum, type) => sum + type.count, 0);
  return <StudyLayout mode={mode} variant={variant} picture={<div className="ls-landing-art"><WordIllustration wordId={family[0]!.word.id} /><p>Кана тренируется отдельно.<br />Снятая галочка сохраняет прогресс.</p></div>} label={`${due} заданий по сроку · 8 выполнено сегодня`} title={empty ? 'Всё повторили' : 'Что сегодня повторим?'}

    explanation={<fieldset className="ls-review-types"><legend>Включить в занятие</legend>{types.map(type => <label key={type.id}><input type="checkbox" checked={selected.includes(type.id)} onChange={event => setSelected(current => event.target.checked ? [...current, type.id] : current.filter(id => id !== type.id))} /><span>{type.label}</span><small>{empty ? 0 : type.count}</small></label>)}</fieldset>}
    actions={empty ? <button className="primary" onClick={() => go('textbook')}>Изучить новое →</button> : <button className="primary" disabled={!selected.length} onClick={() => go(selected.includes('words') ? 'repeat-ja' : selected.includes('counters') ? 'counter-recall' : 'construction-recall')}>{selected.length ? 'Начать повторение →' : 'Выберите хотя бы один тип'}</button>} />;
}

type DrillProgress = { completed: number; total: number };
type KanaCard = { kana: string; reading: string; format: 'reading' | 'listening' };
const drillRows = [['Основные', basicKana], ['Дакутэн', voicedKana], ['Ёон', yoonKana], ['Малые', smallKana]].flatMap(([group, rows]) => (rows as typeof basicKana).map((row, index) => ({ ...row, group: group as string, id: `${group}:${index}` })));
function KanaDrill({ initialScript, variant, mode, state, onProgress, play }: { initialScript: 'hiragana' | 'katakana'; variant: Variant; mode: Orthography; state: DemoState; onProgress: (value: DrillProgress) => void; play: (src?: string) => Promise<void> }) {
  const [script, setScript] = useState<'hiragana' | 'katakana'>(initialScript);
  const [selectedRows, setSelectedRows] = useState(drillRows.filter(row => row.group === 'Основные').map(row => row.id));
  const [formats, setFormats] = useState<KanaCard['format'][]>(['reading', 'listening']);
  const [queue, setQueue] = useState<KanaCard[]>([]);
  const [stage, setStage] = useState<'setup' | 'practice' | 'done'>(state === 'empty' ? 'done' : 'setup');
  const [answer, setAnswer] = useState<{ selected: string; correct: boolean } | null>(null);
  const [count, setCount] = useState(0), [total, setTotal] = useState(0);
  const convert = script === 'katakana' ? katakana : (value: string) => value;
  const selected = drillRows.filter(row => selectedRows.includes(row.id)).flatMap(row => row.cells.filter((entry): entry is KanaEntry => !!entry));
  const listeningAvailable = selected.filter(entry => !!kanaAudio[entry.kana]);
  const current = queue[0];
  useEffect(() => onProgress({ completed: count, total }), [count, total, onProgress]);
  function begin() {
    const cards = selected.flatMap(entry => formats.filter(format => format !== 'listening' || !!kanaAudio[entry.kana]).map(format => ({ ...entry, format })));
    setQueue(cards); setTotal(cards.length); setCount(0); setAnswer(null); setStage('practice');
  }
  function advance(grade: DemoState) {
    if (!current || !answer) return;
    const rest = queue.slice(1), retry = !answer.correct || grade === 'wrong';
    if (retry) rest.splice(Math.min(3, rest.length), 0, current); else setCount(value => value + 1);
    setQueue(rest); setAnswer(null); if (!rest.length) setStage('done');
  }
  if (stage === 'setup') return <div className="ls-drill-setup"><div className="ls-section-intro"><h2>Тренировка азбуки</h2><p>Выберите всю азбуку или нужные ряды. Ошибки возвращаются в этой колоде; в «Повторение» кана не добавляется.</p></div><div className="ls-actions"><button aria-pressed={script === 'hiragana'} onClick={() => setScript('hiragana')}>Хирагана</button><button aria-pressed={script === 'katakana'} onClick={() => setScript('katakana')}>Катакана</button></div><fieldset><legend>Ряды</legend><div className="ls-spread"><button className="ls-text-button" onClick={() => setSelectedRows(drillRows.map(row => row.id))}>Вся азбука</button><button className="ls-text-button" onClick={() => setSelectedRows([])}>Снять выбор</button></div><div className="ls-kana-row-choices">{drillRows.map(row => <label key={row.id}><input type="checkbox" checked={selectedRows.includes(row.id)} onChange={event => setSelectedRows(current => event.target.checked ? [...current, row.id] : current.filter(label => label !== row.id))} /><span lang="ja">{convert(row.label)}</span><small>{row.cells.filter(Boolean).map(entry => convert(entry!.kana)).join(' ')}</small></label>)}</div></fieldset><fieldset className="ls-drill-formats"><legend>Как тренировать</legend><label><input type="checkbox" checked={formats.includes('reading')} onChange={event => setFormats(current => event.target.checked ? [...current, 'reading'] : current.filter(value => value !== 'reading'))} />Увидеть знак → выбрать чтение</label><label><input type="checkbox" checked={formats.includes('listening')} onChange={event => setFormats(current => event.target.checked ? [...current, 'listening'] : current.filter(value => value !== 'listening'))} />Услышать → выбрать знак</label></fieldset><p className="ls-secondary">В выбранных рядах {listeningAvailable.length} озвученных знаков из {selected.length}. Малый っ не имеет отдельного звука и проверяется только по виду.</p><button className="primary" disabled={!selected.length || !formats.length || formats.every(value => value === 'listening') && !listeningAvailable.length} onClick={begin}>Начать тренировку →</button></div>;
  if (stage === 'done' || !current) return <Empty title="Азбука на сегодня повторена" text="Результаты этой колоды не добавляются в интервальные повторения. Можно выбрать другие ряды." action={() => setStage('setup')} />;
  const target = current.format === 'reading' ? current.reading || 'Удвоение согласного' : convert(current.kana);
  const pool = drillRows.flatMap(row => row.cells.filter((entry): entry is KanaEntry => !!entry)).filter(entry => current.format !== 'listening' || kanaSoundKeys[entry.kana] !== kanaSoundKeys[current.kana]).map(entry => current.format === 'reading' ? entry.reading : convert(entry.kana));
  const options = [...new Set(pool)].filter(value => value && value !== target).slice(0,3); options.splice(current.kana.codePointAt(0)! % 4, 0, target);
  return <Paper answered={!!answer} onGrade={advance}><StudyLayout mode={mode} variant={variant} picture={<div className="ls-kana-prompt" lang="ja">{current.format === 'listening' && !answer ? '♪' : convert(current.kana)}</div>} label={current.format === 'reading' ? 'Знак → чтение' : 'На слух → знак'} title={answer ? answer.correct ? 'Верно' : 'Этот знак вернётся' : current.format === 'reading' ? 'Как читается знак?' : 'Какой знак прозвучал?'} main={current.format === 'listening' ? <button className="ls-listen" onClick={() => { void play(kanaAudio[current.kana]); }}>▶ Прослушать знак</button> : undefined} explanation={answer ? <p><span lang="ja">{convert(current.kana)}</span> — {current.reading || 'удвоение следующего согласного'}</p> : <p className="ls-secondary">Тренируем выбранную азбуку; написание знака остаётся её частью.</p>} actions={answer ? <GestureHint answered /> : <div className="ls-options">{options.map(value => <button key={value} onClick={() => setAnswer({ selected: value, correct: value === target })}>{current.format === 'listening' ? <span lang="ja">{value}</span> : value}</button>)}</div>} /></Paper>;
}

function ConstructionDrill({ variant, mode, state, onProgress, play, go }: { variant: Variant; mode: Orthography; state: DemoState; onProgress: (value: DrillProgress) => void; play: (src?: string) => Promise<void>; go: (id: string) => void }) {
  const learned = [construction];
  const [started, setStarted] = useState(false), [selected, setSelected] = useState([construction.id]);
  const [step, setStep] = useState(0), [revealed, setRevealed] = useState(false);
  const [queue, setQueue] = useState(['text', 'listening', 'build']);
  const [built, setBuilt] = useState<string[]>([]), [buildCorrect, setBuildCorrect] = useState(true);
  useEffect(() => onProgress({ completed: step, total: 3 }), [step, onProgress]);
  if (state === 'empty') return <Empty title="Пока нет изученных конструкций" text="После первой оценённой попытки конструкция появится в справочнике и станет доступна для этой тренировки." action={() => go('textbook')} />;
  if (!started) return <div className="ls-drill-setup"><div className="ls-section-intro"><h2>Изученные конструкции</h2><p>Текст, понимание на слух и сборка — в одной колоде. Ответы учитываются в повторениях знакомых конструкций.</p></div>{learned.map(skill => <label className="ls-learned-construction" key={skill.id}><input type="checkbox" checked={selected.includes(skill.id)} onChange={event => setSelected(event.target.checked ? [skill.id] : [])} /><span><strong><MixedText text={skill.title} mode={mode} /></strong><small><MixedText text={skill.explanationRu} mode={mode} /></small></span></label>)}<p className="ls-secondary">Пример личного справочника: доступна одна уже изученная конструкция. Новые конструкции открываются через уроки.</p><button className="primary" disabled={!selected.length} onClick={() => setStarted(true)}>Начать тренировку →</button></div>;
  const current = queue[0], value = exampleValue(course, exercise);
  if (!current) return <Empty title="Конструкция закреплена" text="В приложении эти ответы обновят существующий прогресс конструкции. В макете изменения остаются локальными." action={() => { setStarted(false); setStep(0); setQueue(['text','listening','build']); }} />;
  function advance(grade: DemoState) { const rest = queue.slice(1); if (grade === 'wrong' || current === 'build' && !buildCorrect) rest.splice(Math.min(2, rest.length),0,current!); else setStep(value => value + 1); setQueue(rest); setRevealed(false); setBuilt([]); setBuildCorrect(true); }
  return <Paper answered={revealed} onReveal={current === 'build' ? undefined : () => setRevealed(true)} onGrade={advance}><StudyLayout mode={mode} variant={variant} picture={<div className="ls-language-plate">{current === 'listening' && !revealed ? <span aria-hidden="true">♪</span> : <Japanese value={spelling('日本語')} mode={mode} />}</div>} label={current === 'text' ? 'Понимание текста' : current === 'listening' ? 'Понимание на слух' : 'Сборка фразы'} title={current === 'build' ? 'Соберите японскую фразу' : 'Вспомните смысл'} main={current === 'build' && !revealed ? <div className="ls-build-sentence"><p>{exercise.promptRu}</p><div className="ls-token-tray">{built.length ? built.map((id, index) => { const token = exercise.tokens.find(value => value.id === id)!; const form = course.forms.find(value => value.id === token.formId)!; return <button key={`${id}:${index}`} onClick={() => setBuilt(items => items.filter((_, position) => position !== index))}><Japanese value={form} mode={mode} /></button>; }) : <span>Нажмите слова ниже, чтобы собрать фразу</span>}</div></div> : current === 'listening' && !revealed ? <button className="ls-listen" onClick={() => { void play(constructionIntro?.example.audioUrl); }}>▶ Прослушать фразу</button> : <div className="ls-headword">{current === 'build' && !revealed ? exercise.promptRu : <Japanese value={value} mode={mode} />}</div>} explanation={revealed ? <p>{current === 'build' && !buildCorrect ? 'Порядок требует исправления. Эта сборка вернётся после других заданий. ' : ''}{exercise.translationRu ?? exercise.promptRu}</p> : undefined} example={current === 'build' && !revealed ? <div className="ls-token-bank">{exercise.tokens.map(token => { const form = course.forms.find(value => value.id === token.formId)!; return <button key={token.id} disabled={built.includes(token.id)} onClick={() => { const next = [...built, token.id]; setBuilt(next); if (next.length === exercise.tokens.length) { setBuildCorrect(exercise.acceptedOrders.some(order => order.join() === next.join())); setRevealed(true); } }}><Japanese value={form} mode={mode} /></button>; })}</div> : undefined} actions={current === 'build' && !revealed ? <p className="ls-secondary">Нажимайте слова, чтобы собрать фразу</p> : <GestureHint answered={revealed} />} /></Paper>;
}
function Paper({ children, answered, onGrade, onReveal }: { children: ReactNode; answered: boolean; onGrade: (value: DemoState) => void; onReveal?: () => void }) {
  const [offset, setOffset] = useState(0);
  const start = useRef<number | null>(null), moved = useRef(false);
  const interactive = (target: EventTarget) => target instanceof Element && !!target.closest('button,input,select,textarea,a,summary,details,video,audio,[contenteditable]');
  return <div className="ls-paper-well">
    <div className="ls-dropzones" aria-hidden="true" data-direction={offset < -30 ? 'again' : offset > 30 ? 'remember' : undefined}><span>← Ещё раз</span><span>Помню →</span></div>
    <div className="ls-paper" style={{ transform: `translateX(${offset}px) rotate(${offset / 24}deg)`, transition: start.current === null ? 'transform 220ms ease-out' : 'none' } as CSSProperties}
      tabIndex={0} role="group" aria-label={answered ? 'Карточка. Стрелка влево — ещё раз, вправо — помню.' : onReveal ? 'Карточка. Нажмите или используйте Enter, чтобы раскрыть ответ.' : 'Карточка. Выберите ответ или соберите фразу.'}
      onClick={event => { if (!answered && onReveal && !moved.current && !interactive(event.target)) onReveal(); }}
      onKeyDown={event => {
        if (interactive(event.target)) return;
        if (!answered && onReveal && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onReveal(); }
        if (answered && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onGrade(event.key === 'ArrowRight' ? 'correct' : 'wrong'); }
      }}
      onPointerDown={event => { moved.current = false; if (!answered || interactive(event.target)) return; start.current = event.clientX; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (start.current === null) return; const distance = event.clientX - start.current; moved.current ||= Math.abs(distance) > 6; setOffset(Math.max(-180, Math.min(180, distance))); }}
      onPointerUp={() => { start.current = null; if (Math.abs(offset) > 90) onGrade(offset > 0 ? 'correct' : 'wrong'); setOffset(0); }}
      onPointerCancel={() => { start.current = null; moved.current = false; setOffset(0); }}>
      {Math.abs(offset) > 30 && <strong className="ls-paper-stamp">{offset > 0 ? 'ПОМНЮ' : 'ЕЩЁ РАЗ'}</strong>}
      {children}
    </div>
  </div>;
}
