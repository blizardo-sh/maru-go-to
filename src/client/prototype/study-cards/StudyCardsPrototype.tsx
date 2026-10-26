// Three throwaway study compositions on the real host route. No accounts or saved progress.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Snapshot } from '../../types';
import type { Orthography } from '../../../shared/types';
import { Japanese } from '../../Japanese';
import { WordIllustration } from '../../WordIllustration';
import { catalogFor } from '../../../shared/catalog';
import { Cat } from '../../Cat';
import { GestureCard } from '../../GestureCard';
import { ExampleLine } from '../../ExampleLine';
import { WordQuiz } from '../../GuidedLearning';
import type { SceneSound } from '../../sceneSound';
import './study-cards.css';

const variants = ['A', 'B', 'C'] as const;
type Variant = typeof variants[number];
type Screen = 'quiz' | 'listening' | 'intro' | 'review' | 'workspace' | 'baseline';
type Phase = 'question' | 'correct' | 'wrong' | 'answer';
const names = { A: 'Фокус на карточке', B: 'Учебный разворот', C: 'Тихая мастерская' };
const screenNames: Record<Screen, string> = { quiz: 'Тест: перевод', listening: 'Тест: аудирование', intro: 'Знакомство со словами', review: 'Карточка повторения', workspace: 'Сборка фразы', baseline: 'Как сейчас' };
const silentSound: SceneSound = { unlock() {}, setSpeechPlaying() {}, cue() {}, state: 'muted' };
function initial<T extends string>(key: string, values: readonly T[], fallback: T): T { const value = new URLSearchParams(location.search).get(key); return values.find(item => item === value) ?? fallback; }

export function StudyCardsPrototype() {
  const [data, setData] = useState<Snapshot | null>(null);
  useEffect(() => { const cat = new Image(); cat.src = '/mascot/neutral.png'; void Promise.all([fetch('/__study-card-data').then(response => response.json()), cat.decode().catch(() => {})]).then(([snapshot]) => setData(snapshot)); }, []);
  return data ? <Comparison data={data} /> : <main className="sd-loading"><h1>Учебник</h1><p>Загружаем материал урока…</p></main>;
}
function Comparison({ data }: { data: Snapshot }) {
  const [variant, setVariant] = useState(() => initial('variant', variants, 'A'));
  const [screen, setScreen] = useState<Screen>(() => initial('screen', Object.keys(screenNames) as Screen[], 'quiz'));
  const [tab, setTab] = useState(() => new URLSearchParams(location.search).get('screen') === 'review' ? 'Повторение' : new URLSearchParams(location.search).get('screen') === 'intro' ? 'Учебник' : 'Тренировки');
  const [phase, setPhase] = useState<Phase>(() => initial('state', ['question', 'correct', 'wrong', 'answer'], 'question'));
  const [mode, setMode] = useState<Orthography>(() => initial('orthography', ['kana', 'furigana', 'kanji'], 'furigana'));
  const [index, setIndex] = useState(0), [selected, setSelected] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false), [heard, setHeard] = useState(false), [audioError, setAudioError] = useState('');
  const [tokens, setTokens] = useState<string[]>([]), [rule, setRule] = useState(false), [activeWord, setActiveWord] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null), timer = useRef<number | undefined>(undefined), dialog = useRef<HTMLDialogElement | null>(null);
  const { course } = data;
  const route = course.learning!.find(route => route.lessonId.endsWith('.04'))!;
  const group = route.goals[0]!.parts[0]!;
  const family = group.words.map(intro => ({ ...intro, word: course.words.find(word => word.id === intro.wordId)! }));
  const sister = course.words.find(word => word.kana === 'いもうと' && word.lessonIds.includes(route.lessonId))!;
  const quizWords = [sister, family[2]!.word, family[3]!.word, family[1]!.word], target = quizWords[index % quizWords.length]!;
  const choices = [family[2]!.word, family[3]!.word, sister, family[1]!.word];
  const targetIntro = route.goals.flatMap(goal => goal.parts.flatMap(part => part.words)).find(word => word.wordId === target.id)!;
  const exercise = course.exercises.find(exercise => exercise.skillId.endsWith('.ga_ability'))!;
  const construction = course.learning!.flatMap(lesson => lesson.goals.flatMap(goal => goal.parts)).find(part => part.construction?.exerciseId === exercise.id)!.construction!;
  const skill = course.skills.find(skill => skill.id === exercise.skillId)!;
  const tokenValue = (id: string) => { const form = course.forms.find(form => form.id === exercise.tokens.find(token => token.id === id)!.formId)!; return { ...form, id: form.wordId }; };
  console.assert(choices.length === 4 && new Set(choices.map(word => word.id)).size === 4 && choices.some(word => word.id === target.id), 'Prototype choices must have exactly one correct answer');
  const correct = phase === 'correct', answered = phase === 'correct' || phase === 'wrong';
  const pageTitle = screen === 'workspace' ? 'О себе' : 'Семья';
  const context = screen === 'workspace' ? 'Урок 3' : screen === 'review' ? 'Повторение' : 'Урок 4';
  const count = screen === 'intro' ? `Знакомство · ${family.length} слов` : screen === 'workspace' ? 'Конструкция' : `Слово ${index + 1} из ${quizWords.length}`;
  useEffect(() => {
    const params = new URLSearchParams(location.search); params.set('variant', variant); params.set('screen', screen); params.set('state', phase); params.set('orthography', mode); history.replaceState(null, '', `?${params}`);
    console.info('STUDY_PROTOTYPE', { variant, screen, phase, orthography: mode, wordId: target.id, selected, tokens, persistence: false });
  }, [variant, screen, phase, mode, index, selected, tokens]);
  useEffect(() => () => { window.clearTimeout(timer.current); audio.current?.pause(); }, []);
  useEffect(() => { if (rule) dialog.current?.showModal(); }, [rule]);
  useEffect(() => { setHeard(false); setAudioError(''); audio.current?.pause(); }, [screen, index]);
  function stopTimer() { window.clearTimeout(timer.current); }
  function changeVariant(next: Variant) { stopTimer(); setVariant(next); }
  function cycle(direction: number) { changeVariant(variants[(variants.indexOf(variant) + direction + variants.length) % variants.length]!); }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('input,select,textarea,[contenteditable=true],.gesture-card,dialog')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); cycle(event.key === 'ArrowRight' ? 1 : -1); }
      if (/^[1-4]$/.test(event.key) && ['quiz', 'listening'].includes(screen)) choose(choices[Number(event.key) - 1]!.id);
    }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  function open(next: Screen) { setTab(next === 'review' ? 'Повторение' : next === 'intro' ? 'Учебник' : 'Тренировки'); stopTimer(); setScreen(next); setPhase('question'); setSelected(null); setTokens([]); setRule(false); }
  function next() { stopTimer(); setIndex(value => (value + 1) % quizWords.length); setPhase('question'); setSelected(null); setHeard(false); }
  async function play(src: string | undefined) {
    audio.current?.pause(); setAudioError(''); if (!src) { setAudioError('Для этого материала нет записи.'); return; }
    const current = new Audio(src); audio.current = current; current.onplaying = () => { setPlaying(true); setHeard(true); }; current.onpause = current.onended = () => setPlaying(false);
    try { await current.play(); } catch { setAudioError('Запись не загрузилась. Нажмите ещё раз.'); setPlaying(false); }
  }
  function choose(id: string) {
    if (answered || screen === 'listening' && !heard) return;
    audio.current?.pause(); setSelected(id); const good = id === target.id; setPhase(good ? 'correct' : 'wrong');
    stopTimer(); timer.current = window.setTimeout(next, good ? 850 : 1700);
  }
  function phasePreview(value: Phase) { stopTimer(); setPhase(value); setSelected(value === 'wrong' ? choices.find(word => word.id !== target.id)!.id : value === 'correct' ? target.id : null); }
  const cat = <Cat playful pose={answered ? correct ? 'success' : 'encourage' : playing ? 'thinking' : 'neutral'} activity={answered ? correct ? 'saved-good' : 'saved-again' : playing ? 'listening' : 'idle'} reactionKey={`${screen}:${index}:${phase}`} />;
  const result = answered ? <div className="sd-result" role="status"><WordIllustration catalog={catalogFor(course)} wordId={target.id} /><div><strong>{correct ? 'Верно' : 'Запомним и попробуем ещё'}</strong><p><Japanese value={target} forms={course.forms} mode={mode} /> — {target.meaningRu}</p></div></div> : <div className="sd-result" aria-hidden="true" />;
  const quiz = <div className="sd-quiz" data-answered={answered}>
    <section className="sd-question"><h2>{screen === 'listening' ? 'Что прозвучало?' : 'Выберите русский перевод'}</h2>{screen === 'listening' ? <button className="sd-listen" onClick={() => { void play(target.audioUrl); }} disabled={playing}><Play />{playing ? 'Слушаем…' : heard ? 'Ещё раз' : 'Послушать слово'}</button> : <p className="sd-prompt"><Japanese value={target} forms={course.forms} mode={mode} /></p>}</section>
    <div className="sd-options" role="group" aria-label="Варианты ответа">{choices.map((word, i) => <button key={word.id} data-choice={word.id} data-result={answered && word.id === target.id ? 'correct' : answered && word.id === selected ? 'wrong' : undefined} onClick={() => choose(word.id)} disabled={answered || screen === 'listening' && !heard}><span>{word.meaningRu}</span><kbd aria-label={`Клавиша ${i + 1}`}>{answered && word.id === target.id ? <svg width="18" height="18" viewBox="0 0 24 24" aria-label="Верно"><path d="m4 12 5 5L20 6" fill="none" stroke="currentColor" strokeWidth="2" /></svg> : answered && word.id === selected ? '↻' : i + 1}</kbd></button>)}</div>{result}
    {audioError && <p role="status">{audioError}</p>}
  </div>;
  const introduction = <div className="sd-intro"><header><h2>Слова этой части</h2><p>Послушайте слова. Перевод примера — по нажатию.</p></header><div className="sd-word-list">{family.map((item, i) => <article className="sd-word" data-active={i === activeWord} key={item.word.id}><WordIllustration catalog={catalogFor(course)} wordId={item.word.id} /><div className="sd-word-title">{variant === 'C' ? <button className="sd-word-select" aria-pressed={i === activeWord} onClick={() => setActiveWord(i)}><Japanese value={item.word} forms={course.forms} mode={mode} /></button> : <Japanese value={item.word} forms={course.forms} mode={mode} />}<button aria-label={`Прослушать ${item.word.kana}`} onClick={() => { void play(item.word.audioUrl); }}><Play /></button></div><p>{item.word.meaningRu}</p><p className="sd-word-note">{item.explanationRu}</p><ExampleLine example={item.example} mode={mode} play={() => { void play(item.example.audioUrl); }} /></article>)}</div>{variant === 'C' && <aside className="sd-word-detail"><WordIllustration catalog={catalogFor(course)} wordId={family[activeWord]!.word.id} /><h3><Japanese value={family[activeWord]!.word} forms={course.forms} mode={mode} /></h3><p>{family[activeWord]!.explanationRu}</p><ExampleLine example={family[activeWord]!.example} mode={mode} play={() => { void play(family[activeWord]!.example.audioUrl); }} /></aside>}<button className="sd-primary sd-start" onClick={() => open('quiz')}>К практике</button></div>;
  const review = <div className="sd-review"><GestureCard key={`${index}:${variant}`} enabled={phase === 'answer'} onAdvance={async () => { await new Promise(resolve => window.setTimeout(resolve, 260)); next(); }} mode="ja-ru" reviewId={target.id} phase={phase === 'answer' ? 'answer' : 'question'}><div className="sd-review-face">{phase === 'answer' ? <><WordIllustration catalog={catalogFor(course)} wordId={target.id} /><div><h2>{target.meaningRu}</h2><p className="sd-prompt"><Japanese value={target} forms={course.forms} mode={mode} /></p><ExampleLine example={targetIntro.example} mode={mode} play={() => { void play(targetIntro.example.audioUrl); }} /></div></> : <button className="sd-card-face" data-card-face onClick={() => setPhase('answer')}><span>Вспомните перевод</span><span className="sd-prompt"><Japanese value={target} forms={course.forms} mode={mode} /></span></button>}</div></GestureCard></div>;
  const workspace = <div className="sd-workspace"><section className="sd-task"><h2>Соберите фразу</h2><p>{exercise.promptRu}</p></section><div className="sd-work"><div className="sd-sentence" aria-label="Ваша фраза">{tokens.length ? tokens.map((id, i) => <button key={id} onClick={() => { setTokens(tokens.filter((_, n) => n !== i)); setPhase('question'); }}><Japanese value={tokenValue(id)} forms={course.forms} mode={mode} /></button>) : <p>Нажимайте слова снизу</p>}</div><div className="sd-bank">{[...exercise.tokens].reverse().map(token => <button key={token.id} disabled={tokens.includes(token.id)} onClick={() => { setTokens([...tokens, token.id]); setPhase('question'); }}><Japanese value={tokenValue(token.id)} forms={course.forms} mode={mode} /></button>)}</div><div className="sd-work-actions"><button className="sd-primary" disabled={!tokens.length} onClick={() => setPhase(exercise.acceptedOrders.some(order => order.join('|') === tokens.join('|')) ? 'correct' : 'wrong')}>Проверить фразу</button><button onClick={() => { setTokens([]); setPhase('question'); }}>Сначала</button></div>{answered && <p role="status">{correct ? 'Верно. Можно назвать «わたしは» или опустить тему целиком.' : 'Проверьте порядок: が стоит перед できます.'}</p>}</div><aside className="sd-rule"><h3>Как устроена фраза</h3><p>が обозначает то, что вы умеете.</p><button className="sd-rule-link" onClick={() => setRule(true)}>Полное правило</button></aside></div>;
  const baseline = <div className="game-shell sd-baseline"><div className="page"><div className="study-session stack"><header className="session-header"><div className="session-heading"><small>Урок 4</small><h1>Семья</h1></div><span>Слово {index + 1} из {quizWords.length}</span></header><div className="session-stage work-board"><div className="session-scroll"><WordQuiz value={{ ...target, audioUrl: target.audioUrl! }} mode="ja-ru" choices={choices.map(word => word.id)} wordId={target.id} data={{ ...data, settings: { ...data.settings, orthography: mode } }} active busy={false} sound={silentSound} onActivity={() => {}} stepId={target.id} selection={answered ? { choice: selected ?? target.id, correct, confirmed: true } : null} choose={choose} /></div></div></div></div></div>;
  const content = screen === 'intro' ? introduction : screen === 'review' ? review : screen === 'workspace' ? workspace : quiz;
  return <div className="sd-root" data-variant={variant} data-screen={screen}>
    {variant !== 'C' && <div className="sd-room" aria-hidden="true" />}
    <header className="sd-shell"><span className="sd-brand">まるごと</span><nav aria-label="Разделы макета">{([['Учебник', 'intro'], ['Тренировки', 'quiz'], ['Повторение', 'review'], ['Справочник', 'intro']] as const).map(([label, next]) => <button key={label} aria-current={tab === label ? 'page' : undefined} onClick={() => { open(next); setTab(label); }} title={label}><NavIcon kind={label} /><span>{label}</span></button>)}</nav></header>
    <main className="sd-main">{screen === 'baseline' ? baseline : <div className="sd-stage"><header className="sd-context"><div><span>{context}</span><h1>{pageTitle}</h1></div><span>{count}</span><button onClick={() => open('intro')}>К словам</button><progress max={quizWords.length} value={screen === 'intro' ? 0 : index} aria-label="Прогресс демонстрации" /></header><div className="sd-content">{content}</div></div>}<div className="sd-companion"><div className="sd-cat-window" aria-hidden="true" />{cat}{variant === 'C' && <p>{answered ? correct ? 'Получилось!' : 'Давай ещё попробуем' : playing ? 'Слушаем внимательно' : 'Я рядом'}</p>}</div></main>
    {rule && <dialog ref={dialog} className="sd-rule-dialog" onClose={() => setRule(false)} aria-label="Правило конструкции"><h2>{skill.title}</h2><p>{construction.explanationRu}</p><ExampleLine example={construction.example} mode={mode} play={() => { void play(construction.example.audioUrl); }} /><button className="sd-primary" onClick={() => setRule(false)}>Понятно</button></dialog>}
    <aside className="sd-switcher" aria-label="Управление прототипом"><div className="sd-switch-variants"><button aria-label="Предыдущий вариант" onClick={() => cycle(-1)}>←</button><strong>{variant} · {names[variant]}</strong><button aria-label="Следующий вариант" onClick={() => cycle(1)}>→</button></div><label><span className="sr-only">Экран</span><select value={screen} onChange={event => open(event.target.value as Screen)}>{Object.entries(screenNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label><label><span className="sr-only">Состояние</span><select value={phase} onChange={event => phasePreview(event.target.value as Phase)}><option value="question">До ответа</option>{screen !== 'intro' && (screen === 'review' ? <option value="answer">Ответ открыт</option> : <><option value="correct">Верно</option><option value="wrong">Ошибка</option></>)}</select></label><label><span className="sr-only">Написание</span><select value={mode} onChange={event => setMode(event.target.value as Orthography)}><option value="furigana">С фуриганой</option><option value="kana">Кана</option><option value="kanji">Кандзи</option></select></label><small>Прототип · данные не сохраняются</small></aside>
  </div>;
}
function Play() { return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4L21 12L7 20Z" fill="currentColor" /></svg>; }
function NavIcon({ kind }: { kind: string }) { const paths: Record<string, ReactNode> = { Учебник: <path d="M4 5h7v15H4zM11 5h9v15h-9M7 9h1M15 9h2" />, Тренировки: <path d="m8 4 1 5-5 3 5 3-1 5 5-3 6 3-1-6 4-2-5-3 1-5-5 3Z" />, Повторение: <path d="M5 8a8 8 0 1 1-1 7M5 3v6h6" />, Справочник: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></> }; return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{paths[kind]}</svg>; }
