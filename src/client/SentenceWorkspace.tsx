import { useEffect, useRef, useState } from 'react';
import type { AnalysisResult, LearnerSettings, ReviewItem, TargetEvaluationRequest, TargetEvaluationResult, Word } from '../shared/types';
import type { Snapshot, StudySource } from './types';
import { editorWordIds, sourceKey, trainingContext } from './learning';
import type { SceneSound } from './sceneSound';
import type { CardActivity, SavedFeedback } from './companion';
import { matchesPreparedAnswer } from '../shared/answers';
import { api, json, type submitReview } from './api';
import { GestureCard } from './GestureCard';
import { DisplayControl, Japanese } from './Japanese';
import { isCurrentAnalysis, shuffledTokens } from './study';
import { useReviewSave } from './useReviewSave';
import { learningHeaders } from './guidedApi';

type Token = { id: string; wordId: string; formId: string | null };
type Editor = { kind: 'token'; id: string } | { kind: 'add'; afterId?: string } | { kind: 'manual' } | null;


export function SentenceWorkspace({ item, data, source, userId, onNext, onSaved, saveSettings, settingsBusy, active = true, onActivity, sound, sendReview, requiredPractice = false }: { item: Extract<ReviewItem, { mode: 'grammar' }>; data: Snapshot; source: StudySource; userId: string; onNext: (reaction?: SavedFeedback) => void; onSaved: () => void; saveSettings: (value: LearnerSettings) => Promise<void>; settingsBusy: boolean; active?: boolean; onActivity: (value: CardActivity) => void; sound: SceneSound; sendReview?: typeof submitReview; requiredPractice?: boolean }) {
  const { exercise, skill } = item;
  const formMap = new Map(data.course.forms.map(form => [form.id, form]));
  const wordMap = new Map([...data.course.words, ...data.lists.flatMap(list => list.words)].map(word => [word.id, word]));
  const original: Token[] = exercise.tokens.map(token => ({ id: token.id, formId: token.formId, wordId: formMap.get(token.formId)!.wordId }));
  const [bankOrder] = useState(() => shuffledTokens(exercise.tokens.map(token => token.id)));
  const [tokens, setTokens] = useState<Token[]>([]); const [exploring, setExploring] = useState(false);
  const [manualText, setManualText] = useState<string | null>(null); const [composing, setComposing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const [editor, setEditor] = useState<Editor>(null); const [search, setSearch] = useState('');
  const [evaluation, setEvaluation] = useState<TargetEvaluationResult | null>(null); const [analysis, setAnalysis] = useState<AnalysisResult | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [retryRevision, setRetryRevision] = useState(0);
  const revision = useRef(0); const dialog = useRef<HTMLDialogElement>(null); const analysisDetails = useRef<HTMLDetailsElement>(null);
  const saving = useReviewSave(userId, onSaved, (submission, result) => { const kind = result.correct && submission.mode === 'grammar' && submission.rating !== 1 && !submission.revealed ? 'good' : 'again'; sound.cue(kind, result.attemptId); onNext({ attemptId: result.attemptId, kind }); }, sendReview);
  const locked = !active || saving.busy || saving.pending;
  function valueFor(token: Token) { return token.formId ? formMap.get(token.formId)! : wordMap.get(token.wordId)!; }
  const text = manualText ?? tokens.map(token => valueFor(token).surface).join('') + (tokens.length ? exercise.sentenceEnd : '');
  const wordIds = tokens.map(token => token.formId ?? token.wordId);
  const tokenForms = Object.fromEntries(tokens.filter(token => token.formId).map(token => [token.id, token.formId!]));
  const allowedWordIds = editorWordIds(data, source);
  for (const token of original) allowedWordIds.add(token.wordId);
  const courseIds = new Set(data.course.words.map(word => word.id));
  function formsFor(wordId: string) { return allowedWordIds.has(wordId) ? data.course.forms.filter(form => form.wordId === wordId) : []; }
  const availableWords = [...wordMap.values()].filter(word => allowedWordIds.has(word.id) && (courseIds.has(word.id) || word.reviewStatus !== 'draft'));
  const signature = JSON.stringify({ tokens, manualText, exploring, context: sourceKey(source), allowedWordIds: [...allowedWordIds].sort() });
  function invalidate() { revision.current++; setEvaluation(null); setAnalysis(null); setLoading(true); setError(''); }
  function update(next: Token[], research = false) {
    if (locked) return;
    const forms = Object.fromEntries(next.filter(token => token.formId).map(token => [token.id, token.formId!]));
    const prepared = next.every(token => token.formId !== null) && matchesPreparedAnswer(exercise, data.course.forms, next.map(token => token.id), forms);
    invalidate(); setTokens(next); setManualText(null); setExploring(current => (research || current) && !prepared);
  }
  function closeEditor() { setEditor(null); setSearch(''); setComposing(false); }
  function openEditor(value: Editor) { if (locked) return; setSearch(''); setEditor(value); }
  useEffect(() => { const current = dialog.current; if (!current) return; if (!active) { if (current.open) current.close(); return; } if (editor && !current.open) current.showModal(); else if (!editor && current.open) current.close(); }, [editor, active]);
  useEffect(() => { if (!active) { setEditor(null); setComposing(false); setDragging(false); } }, [active]);
  useEffect(() => {
    const current = ++revision.current; const controller = new AbortController(); if (!active) return () => controller.abort(); setEvaluation(null); setAnalysis(null); setError(''); setLoading(true);
    if (composing) return () => controller.abort();
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const request: TargetEvaluationRequest = { reviewId: item.id, version: item.version, revision: current, tokenIds: tokens.map(token => token.id), tokenForms, exploring };
          const unmapped = manualText !== null || tokens.some(token => token.formId === null);
          const target = unmapped ? { revision: current, outcome: 'exploration' as const, feedback: 'Исследование фразы: исходное задание не оценивается.' } : await api<TargetEvaluationResult>('/api/reviews/evaluate', { ...json('POST', request), headers: requiredPractice ? learningHeaders(userId) : undefined, signal: controller.signal });
          if (current !== revision.current || target.revision !== current) return;
          setEvaluation(target);
          if (text.trim() && target.outcome !== 'incomplete') {
            const ids = manualText !== null ? availableWords.filter(word => text.includes(word.surface) || text.includes(word.kana)).map(word => word.id) : wordIds;
            const result = await api<AnalysisResult>('/api/analyze', { ...json('POST', { text, wordIds: ids, revision: current, ...trainingContext(source), exerciseId: exercise.id }), headers: requiredPractice ? learningHeaders(userId) : undefined, signal: controller.signal });
            if (isCurrentAnalysis(result, revision.current, text)) setAnalysis(result);
          }
        } catch (failure) { if (!controller.signal.aborted && current === revision.current) setError(failure instanceof Error ? failure.message : 'Разбор не загрузился. Повторите попытку.'); }
        finally { if (!controller.signal.aborted && current === revision.current) setLoading(false); }
      })();
    }, 700);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [signature, composing, retryRevision, item.id, item.version, active]);
  useEffect(() => { if ((analysis || evaluation && evaluation.outcome !== 'incomplete') && analysisDetails.current) analysisDetails.current.open = true; }, [analysis, evaluation]);
  function addOriginal(id: string) { const token = original.find(value => value.id === id); if (token && !tokens.some(value => value.id === id)) update([...tokens, token]); }
  function dropToken(id: string, targetId?: string, after = false) {
    setDropTarget(null); setDragging(false);
    if (locked || id === targetId) return;
    const next = tokens.filter(token => token.id !== id);
    const targetIndex = targetId ? next.findIndex(token => token.id === targetId) : -1;
    const position = targetIndex < 0 ? next.length : targetIndex + (after ? 1 : 0);
    const token = tokens.find(value => value.id === id) ?? original.find(value => value.id === id);
    if (!token) return;
    next.splice(position, 0, token); if (next.length !== tokens.length || next.some((value, index) => value.id !== tokens[index]?.id)) { update(next); sound.cue('move', crypto.randomUUID()); }
  }
  function move(id: string, step: -1 | 1) { const index = tokens.findIndex(token => token.id === id); if (!tokens[index + step]) return; const next = [...tokens]; [next[index], next[index + step]] = [next[index + step]!, next[index]!]; if (!locked) { update(next); sound.cue('move', crypto.randomUUID()); } }
  function remove(id: string) { update(tokens.filter(token => token.id !== id), true); closeEditor(); }
  function choose(word: Word) {
    const forms = formsFor(word.id); if (data.course.forms.some(form => form.wordId === word.id) && forms.length === 0) return; const form = forms.find(value => value.surface === word.surface) ?? forms[0];
    const token: Token = { id: editor?.kind === 'token' ? editor.id : crypto.randomUUID(), wordId: word.id, formId: form?.id ?? null };
    if (editor?.kind === 'token') update(tokens.map(value => value.id === editor.id ? token : value), true);
    else { const next = [...tokens]; const position = editor?.kind === 'add' && editor.afterId ? tokens.findIndex(value => value.id === editor.afterId) + 1 : tokens.length; next.splice(position, 0, token); update(next, true); }
    closeEditor();
  }
  function reset() { if (locked) return; invalidate(); setTokens([]); setManualText(null); setExploring(false); closeEditor(); }
  function advance(rating: 1 | 3) {
    if (loading || !evaluation || locked || composing || editor) return;
    if (evaluation.outcome === 'incomplete' || evaluation.outcome === 'exploration') { if (!requiredPractice) onNext(); return; }
    return saving.save({ attemptId: crypto.randomUUID(), reviewId: item.id, version: item.version, mode: 'grammar', tokenIds: tokens.map(token => token.id), tokenForms, revealed: false, exploring, rating });
  }
  const targetVerdict = evaluation && (evaluation.outcome === 'correct' || evaluation.outcome === 'incorrect') ? evaluation : null;
  const answerFeedback = !locked && !loading && !error && analysis?.status === 'ok' ? evaluation?.outcome === 'correct' ? 'good' : evaluation?.outcome === 'incorrect' ? 'again' : 'neutral' : 'neutral';
  const phase: CardActivity['activity'] = !active || error || saving.error ? 'neutral' : dragging || editor || composing ? 'editing' : saving.busy || saving.pending || loading && (tokens.length > 0 || !!manualText?.trim()) ? 'checking' : answerFeedback === 'good' ? 'draft-correct' : tokens.length > 0 || !!manualText?.trim() ? 'neutral' : 'idle';
  const activityKey = `${item.id}:${item.version}:${revision.current}:${phase}`;
  useEffect(() => { onActivity({ reviewId: item.id, activity: phase, key: activityKey }); }, [phase, activityKey, item.id, onActivity]);
  const activeToken = editor?.kind === 'token' ? tokens.find(token => token.id === editor.id) : undefined;
  const activeWord = activeToken ? wordMap.get(activeToken.wordId) : undefined;
  const matches = availableWords.filter(word => !search || `${word.surface} ${word.kana} ${word.meaningRu}`.toLowerCase().includes(search.toLowerCase())).slice(0, 45);
  return <GestureCard active={active} enabled={!loading && !!evaluation && (!requiredPractice || evaluation.outcome === 'correct' || evaluation.outcome === 'incorrect') && !locked && !editor && !composing} onAdvance={advance} mode="grammar" reviewId={item.id} actions={<><DisplayControl mode={data.settings.orthography} onChange={orthography => { void saveSettings({ ...data.settings, orthography }); }} disabled={settingsBusy || locked} /><button disabled={locked} onClick={reset}>К исходному заданию</button><button disabled={locked} onClick={() => openEditor({ kind: 'manual' })}>Ввести фразу</button></>}>
    <header className="workspace-heading"><small>Конструкция · {skill.title}</small><h2>{exercise.promptRu}</h2>{exercise.contextRu && <p className="muted">{exercise.contextRu}</p>}</header>
    <p className="muted">Добавляйте элементы снизу и перетаскивайте их. Нажмите на слово, чтобы изменить его.</p>
    {manualText !== null ? <button className="manual-phrase" onClick={() => openEditor({ kind: 'manual' })}><span lang="ja" className="jp">{manualText || 'Введите фразу'}</span></button> : <>
      <div className="token-area" role="group" aria-label="Ваше предложение" onDragOver={event => { event.preventDefault(); setDropTarget(null); }} onDrop={event => { event.preventDefault(); dropToken(event.dataTransfer.getData('text/plain')); }}>
        {tokens.map((token, index) => <button className="sentence-token" key={token.id} data-token-id={token.id} data-drop-position={dropTarget?.id === token.id ? dropTarget.after ? 'after' : 'before' : undefined} aria-label={`Изменить элемент ${index + 1}: ${valueFor(token).surface}`} disabled={locked} draggable={!locked} onDragStart={event => { setDragging(true); event.stopPropagation(); event.dataTransfer.setData('text/plain', token.id); event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { setDragging(false); setDropTarget(null); }} onDragOver={event => { event.preventDefault(); event.stopPropagation(); setDropTarget({ id: token.id, after: event.clientX >= event.currentTarget.getBoundingClientRect().left + event.currentTarget.getBoundingClientRect().width / 2 }); }} onDrop={event => { event.preventDefault(); event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); dropToken(event.dataTransfer.getData('text/plain'), token.id, event.clientX >= rect.left + rect.width / 2); }} onClick={() => openEditor({ kind: 'token', id: token.id })} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); move(token.id, event.key === 'ArrowLeft' ? -1 : 1); } else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); remove(token.id); } }}><Japanese value={valueFor(token)} mode={data.settings.orthography} /></button>)}
        <button className="add-token quiet" aria-label="Добавить элемент" disabled={locked || tokens.length >= 100} onClick={() => openEditor({ kind: 'add' })}>+</button>
      </div>
      <div className="bank" role="group" aria-label="Доступные элементы">{bankOrder.filter(id => !tokens.some(token => token.id === id)).map(id => { const token = original.find(value => value.id === id)!; return <button key={id} data-token-id={id} disabled={locked} draggable={!locked} onDragStart={event => { setDragging(true); event.dataTransfer.setData('text/plain', id); }} onDragEnd={() => { setDragging(false); setDropTarget(null); }} onClick={() => addOriginal(id)}><Japanese value={valueFor(token)} mode={data.settings.orthography} /></button>; })}</div>
    </>}
    <div className="analysis-state status" role="status" data-feedback={answerFeedback} data-outcome={targetVerdict?.outcome}><span key={`${revision.current}:${answerFeedback}`} className="answer-feedback-marker" data-feedback={answerFeedback}>{saving.busy ? 'Сохраняем ответ…' : composing ? 'Закончите ввод…' : loading ? 'Разбираем текущую фразу…' : evaluation?.outcome === 'incomplete' ? 'Сборка продолжается. Расписание не меняется.' : evaluation?.outcome === 'exploration' ? 'Исследование: этот вариант не изменит повторение исходного задания.' : targetVerdict ? `${answerFeedback === 'good' ? '✓ ' : answerFeedback === 'again' ? '↻ ' : ''}${targetVerdict.feedback}` : 'Разбор актуален. Можно продолжить менять фразу или перейти дальше.'}</span></div>
    {evaluation && !targetVerdict && <p data-outcome={evaluation.outcome} className="muted">{evaluation.feedback}</p>}
    {(analysis || evaluation && evaluation.outcome !== 'incomplete') && <details ref={analysisDetails} className="analysis-drawer"><summary>Разбор фразы</summary>
    {analysis?.status === 'ok' && <section className="analysis" tabIndex={0} data-card-scroll aria-label="Разбор текущей фразы"><h3>{analysis.translationRu}</h3><dl><div><dt>Грамматика</dt><dd>{{ correct: 'Допустима', incorrect: 'Есть грамматическая ошибка', uncertain: 'Нужна проверка', incomplete: 'Незаконченное предложение' }[analysis.grammar]}</dd></div><div><dt>Естественность</dt><dd>{{ natural: 'Естественно', awkward: 'Звучит непривычно', uncertain: 'Нужна проверка' }[analysis.naturalness]}</dd></div></dl><p>{analysis.explanationRu}</p>{analysis.materialViolations.map((message, index) => <p className="muted" key={index}>{message}</p>)}{analysis.warnings.map((message, index) => <small key={index}>{message}</small>)}</section>}
    {analysis?.status === 'unavailable' && <div className="notice" role="status"><h3>Свободный разбор недоступен</h3><p>{analysis.reason}</p><small>Проверка исходного задания продолжает работать.</small></div>}
    {evaluation && evaluation.outcome !== 'incomplete' && analysis?.status !== 'ok' && <p>{skill.explanationRu}</p>}
    </details>}
    {error && <div className="notice error" role="alert"><p>{error}</p><button onClick={() => setRetryRevision(value => value + 1)}>Повторить разбор</button></div>}
    {saving.error && <div className="notice error" role="alert"><p>{saving.error}</p><button onClick={saving.retry}>Повторить сохранение</button></div>}
    <dialog ref={dialog} className="token-dialog" onCancel={closeEditor} onClose={closeEditor} onClick={event => { if (event.target === event.currentTarget) closeEditor(); }} aria-label={editor?.kind === 'token' ? 'Изменить элемент' : editor?.kind === 'manual' ? 'Ввести фразу' : 'Добавить элемент'}>
      <div className="stack"><div className="spread"><h2>{editor?.kind === 'token' ? 'Изменить элемент' : editor?.kind === 'manual' ? 'Ввести фразу' : 'Добавить элемент'}</h2><button className="quiet" onClick={closeEditor} aria-label="Закрыть редактор">×</button></div>
        {editor?.kind === 'manual' ? <><label><span>Ваша фраза</span><textarea autoFocus lang="ja" value={manualText ?? text} maxLength={1000} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} onChange={event => { invalidate(); setManualText(event.target.value); setExploring(true); }} /></label><small>Самостоятельный ввод исследует фразу и не меняет расписание исходного задания.</small></> : <>
          {activeToken && activeWord && <><p><Japanese value={valueFor(activeToken)} mode={data.settings.orthography} /> — {activeWord.meaningRu}</p><label><span>Форма элемента</span><select autoFocus value={activeToken.formId ?? ''} disabled={locked} onChange={event => { const form = formMap.get(event.target.value)!; update(tokens.map(token => token.id === activeToken.id ? { ...token, formId: form.id } : token), true); }}>{!activeToken.formId && <option value="">Словарная форма</option>}{[...new Map([...(activeToken.formId ? [formMap.get(activeToken.formId)!] : []), ...formsFor(activeToken.wordId)].map(form => [form.id, form])).values()].map(form => <option key={form.id} value={form.id}>{data.settings.orthography === 'kana' ? form.kana : form.surface}</option>)}</select></label><div className="row"><button disabled={tokens[0]?.id === activeToken.id} onClick={() => move(activeToken.id, -1)}>Левее</button><button disabled={tokens.at(-1)?.id === activeToken.id} onClick={() => move(activeToken.id, 1)}>Правее</button><button onClick={() => remove(activeToken.id)}>Удалить</button><button onClick={() => openEditor({ kind: 'add', afterId: activeToken.id })}>Добавить после</button></div></>}
          <label><span>{activeToken ? 'Заменить словом или частицей' : 'Найти слово или частицу'}</span><input autoFocus={!activeToken} value={search} onChange={event => setSearch(event.target.value)} /></label><div className="picker-words">{matches.map(word => <button key={word.id} data-word-id={word.id} disabled={data.course.forms.some(form => form.wordId === word.id) && formsFor(word.id).length === 0} onClick={() => choose(word)}><Japanese value={word} mode={data.settings.orthography} /><small>{word.meaningRu}</small></button>)}</div><small>{source.kind === 'review' ? 'Для замен доступны изученные слова и исходные элементы задания.' : 'Для замен доступны слова этого урока или списка, уже изученный материал и исходные элементы задания.'}</small>{matches.length === 0 && <p className="muted">В материале этой тренировки нет подходящих слов.</p>}
        </>}
      </div>
    </dialog>
  </GestureCard>;
}
