import { ratingOptions } from '@app/client/review-ratings';
import { api, json } from '@app/client/api';
import { learningHeaders } from '@app/client/guidedApi';
import type { AnalysisResult, Rating, ReviewSchedule, ReviewItem, TargetEvaluationResult, TrainingContext } from '@app/shared/types';
import { renderReading } from './album-reading';
import { misplacedTokens } from './builder-mistakes';
import { preparedWorkspace, moveWorkspaceToken, placeWorkspaceToken, type WorkspaceToken } from '@app/client/workspace';
import { shuffledTokens, isCurrentAnalysis } from '@app/client/study';
import type { Course, Exercise, Word } from '@app/shared/types';
import type { Rect } from './canvas';
import { StudySurface, type StudyAction } from './study-surface';

const hiragana = (value: string) => value.replace(/[ァ-ヶ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60));

export class AlbumWorkspace {
  tokens: WorkspaceToken[] = [];
  manualText: string | null = null;
  exploring = false;
  editing: string | 'add' | 'manual' | null = null;
  afterId?: string;
  search = '';
  failure = '';
  scroll = 0;
  result = '';
  verdict: 'correct' | 'incorrect' | null = null;
  revision = 0;
  checking = false;
  error = '';
  page = 0;
  readonly original: WorkspaceToken[];
  readonly bankOrder: string[];
  private saved: string | null;
  constructor(readonly key: string, readonly course: Course, readonly exercise: Exercise, readonly words: Word[], private changed: () => void) {
    this.original = exercise.tokens.map(token => ({ ...token, wordId: course.forms.find(form => form.id === token.formId)!.wordId }));
    this.bankOrder = shuffledTokens(this.original.map(token => token.id));
    this.saved = null;
    try { this.restore(); } catch (error) { this.error = error instanceof Error ? error.message : 'Черновик недоступен.'; }
  }
  restore() {
    this.saved = localStorage.getItem(this.key);
    if (this.saved) {
      const saved = JSON.parse(this.saved);
      if (!Array.isArray(saved.tokens) || saved.tokens.length > 100 || new Set(saved.tokens.map((t: WorkspaceToken) => t.id)).size !== saved.tokens.length || saved.tokens.some((token: WorkspaceToken) => typeof token.id !== 'string' || !this.words.some(word => word.id === token.wordId) || token.formId !== null && !this.course.forms.some(form => form.id === token.formId && form.wordId === token.wordId)) || saved.manualText !== null && typeof saved.manualText !== 'string') throw new Error('Черновик повреждён. Не очищайте данные браузера.');
      this.tokens = saved.tokens; this.manualText = saved.manualText; this.exploring = !!saved.exploring;
    }
    this.error = ''; this.result = ''; this.editing = null;
  }
  async evaluate(owner: string, item: Extract<ReviewItem, { mode: 'grammar' }>, current: () => boolean, assessed: (result: TargetEvaluationResult, ids: string[], forms: Record<string, string>) => void) {
    const revision = this.revision, ids = this.tokens.map(t => t.id), forms = this.forms; this.verdict = null; this.failure = ''; this.result = ''; this.checking = true; this.changed();
    try { const result = await api<TargetEvaluationResult>('/api/reviews/evaluate', { ...json('POST', { reviewId: item.id, version: item.version, publicationId: item.publicationId, revision, tokenIds: ids, tokenForms: forms, exploring: this.exploring }), headers: learningHeaders(owner, item.publicationId) });
      if (!current() || revision !== this.revision || result.revision !== revision) return; this.result = result.feedback; this.verdict = result.outcome === 'correct' || result.outcome === 'incorrect' ? result.outcome : null; assessed(result, ids, forms);
    } catch (e) { if (current() && revision === this.revision) { this.verdict = null; this.failure = e instanceof Error ? e.message : 'Проверка недоступна. Повторите.'; } }
    finally { this.checking = false; this.changed(); }
  }
  async analyze(owner: string, item: Extract<ReviewItem, { mode: 'grammar' }>, context: TrainingContext, current: () => boolean) {
    const revision = this.revision, text = this.text; this.checking = true; this.changed();
    try { const result = await api<AnalysisResult>('/api/analyze', { ...json('POST', { text, revision, exerciseId: item.exercise.id, ...context, publicationId: item.publicationId, wordIds: this.manualText !== null ? this.words.filter(w => text.includes(w.surface) || text.includes(w.kana)).map(w => w.id) : this.tokens.map(t => t.formId ?? t.wordId) }), headers: learningHeaders(owner, item.publicationId) });
      if (current() && revision === this.revision && isCurrentAnalysis(result, this.revision, this.text)) this.result = result.status === 'ok' ? ['Перевод: '+result.translationRu,'Грамматика: '+({correct:'верно',incorrect:'есть ошибка',uncertain:'неопределённо',incomplete:'фраза не завершена'}[result.grammar]),'Естественность: '+({natural:'естественно',awkward:'неестественно',uncertain:'неопределённо'}[result.naturalness]),result.explanationRu,...(result.materialViolations.length?['Есть элементы вне выбранного материала: '+result.materialViolations.join(' · ')]:[]),...result.warnings,'Свободный ввод не оценивает исходный навык.'].join('\n\n') : result.status === 'unavailable' ? result.reason : 'Анализ недоступен.';
    } catch (e) { if (current() && revision === this.revision) this.result = e instanceof Error ? e.message : 'Анализ недоступен. Повторите.'; }
    finally { this.checking = false; this.changed(); }
  }
  get forms() { return Object.fromEntries(this.tokens.filter(token => token.formId).map(token => [token.id, token.formId!])); }
  value(token: WorkspaceToken) { return token.formId ? this.course.forms.find(form => form.id === token.formId)! : this.words.find(word => word.id === token.wordId)!; }
  get text() { return this.manualText ?? this.tokens.map(token => this.value(token).surface).join('') + (this.tokens.length ? this.exercise.sentenceEnd : ''); }
  get prepared() { return this.manualText === null && preparedWorkspace(this.exercise, this.course, this.tokens); }
  update(tokens: WorkspaceToken[], research = false, manualText: string | null = null) {
    try {
      if (localStorage.getItem(this.key) !== this.saved) throw new Error('Черновик изменён в другой вкладке. Загрузите его перед редактированием.');
      const exploring = manualText !== null || (research || this.exploring) && !preparedWorkspace(this.exercise, this.course, tokens);
      const next = JSON.stringify({ tokens, manualText, exploring }); localStorage.setItem(this.key, next);
      this.revision++; this.saved = next; this.tokens = tokens; this.manualText = manualText; this.exploring = exploring; this.result = ''; this.failure = ''; this.verdict = null; this.error = ''; this.changed();
    } catch (error) { this.error = error instanceof Error ? error.message : 'Не удалось сохранить черновик на устройстве.'; this.changed(); }
  }
  reset() { this.exploring = false; this.update([]); }
  add(id: string, target?: string, after = true) { if (!target && this.tokens.some(token => token.id === id)) return; this.update(placeWorkspaceToken(this.tokens, this.original, id, target, after)); }
  move(id: string, step: -1 | 1) { this.update(moveWorkspaceToken(this.tokens, id, step)); }
  remove(id: string) { this.update(this.tokens.filter(token => token.id !== id), true); this.editing = null; }
  choose(word: Word) {
    const forms = this.course.forms.filter(form => form.wordId === word.id), form = forms.find(form => form.surface === word.surface) ?? forms[0];
    const token: WorkspaceToken = { id: this.editing && this.editing !== 'add' ? this.editing : crypto.randomUUID(), wordId: word.id, formId: form?.id ?? null };
    if (this.editing !== 'add') this.update(this.tokens.map(value => value.id === token.id ? token : value), true);
    else { const next = [...this.tokens], index = this.afterId ? this.tokens.findIndex(token => token.id === this.afterId) + 1 : next.length; next.splice(index, 0, token); this.update(next, true); }
    this.editing = null;
  }
  form(id: string, formId: string) { this.update(this.tokens.map(token => token.id === id ? { ...token, formId } : token), true); this.editing = null; }
}

export function renderWorkspace(surface: StudySurface, model: AlbumWorkspace, options: {
  schedule?: ReviewSchedule; prompt?: Rect; safe: (action: StudyAction) => StudyAction; drawField: (rect: Rect, value: string, placeholder: string, changed: (value: string) => void) => void;
  changed: () => void; composing: boolean; busy: boolean; revealed: boolean; check: () => void; analyze: () => void; grade: (rating: Rating) => void;
}) {
  const a = surface.body, safe = options.safe, footer = (actions: StudyAction[]) => surface.footer(actions.map(action => safe({ ...action, fontSize: action.id.startsWith('grade-') ? 14 : 16 })));
  const label = (token: WorkspaceToken) => hiragana(model.value(token).kana);
  if (model.error) {
    surface.text(model.error, a, 18); footer([{ id: 'workspace-reload', text: 'Загрузить черновик', run: () => { try { model.restore(); } catch (error) { model.error = error instanceof Error ? error.message : 'Черновик недоступен.'; } options.changed(); } }]); return;
  }
  if (model.failure) { renderReading(surface,model.failure,model,{back:{id:'workspace-error-close',text:'Вернуться',run:()=>{model.failure='';options.changed();}},safe,changed:options.changed}); return; }
  if (model.editing === 'manual') {
    surface.text('Свободная фраза · без оценки исходного навыка', { ...a, height: 60 }, 18);
    options.drawField({ ...a, y: a.y + 64, height: Math.max(60, a.height - 130) }, model.manualText ?? model.text, 'Японская фраза', value => model.update(model.tokens, true, value));
    footer([{ id: 'builder-bank', text: 'Фрагменты', run: () => { model.editing = null; options.changed(); } }, { id: 'analyze', text: 'Разобрать', enabled: !options.composing && !model.checking && !!model.text.trim(), run: options.analyze }]); return;
  }
  if (model.editing) {
    const token = model.tokens.find(token => token.id === model.editing), forms = token ? model.course.forms.filter(form => form.wordId === token.wordId) : [];
    const controls: StudyAction[] = token ? [
      { id: 'workspace-left', text: '←', accessibleLabel: 'Переместить влево', run: () => model.move(token.id, -1) },
      { id: 'workspace-right', text: '→', accessibleLabel: 'Переместить вправо', run: () => model.move(token.id, 1) },
      { id: 'workspace-remove', text: '−', accessibleLabel: 'Удалить фрагмент', run: () => model.remove(token.id) },
      { id: 'workspace-insert', text: '+', accessibleLabel: 'Вставить после слова', run: () => { model.afterId = token.id; model.editing = 'add'; model.page = 0; options.changed(); } },
    ] : [];
    if (controls.length) surface.row(controls.map(safe), { ...a, height: 44 });
    options.drawField({ ...a, y: a.y + 54, height: 44 }, model.search, token ? 'Найти замену' : 'Найти слово', value => { model.search = value; model.page = 0; options.changed(); });
    const query = hiragana(model.search.toLowerCase());
    const actions: StudyAction[] = [
      ...forms.filter(form => hiragana(`${form.surface} ${form.kana}`).includes(query)).map(form => ({ id: 'form:' + form.id, text: hiragana(form.kana), run: () => model.form(token!.id, form.id) })),
      ...model.words.filter(word => hiragana(`${word.surface} ${word.kana} ${word.meaningRu}`.toLowerCase()).includes(query)).map(word => ({ id: 'replace:' + word.id, text: `${hiragana(word.kana)} · ${word.meaningRu}`, run: () => model.choose(word) })),
    ];
    const available = a.height - 108, count = Math.max(1, Math.floor(available / 58)), max = Math.max(0, Math.ceil(actions.length / count) - 1); model.page = Math.min(model.page, max);
    actions.slice(model.page * count, (model.page + 1) * count).forEach((action, index) => surface.listAction(safe(action), { x: a.x, y: a.y + 108 + index * 58, width: a.width, height: 52 }, true, 22));
    if (!actions.length) surface.text('Подходящих слов нет', { ...a, y: a.y + 108, height: 44 }, 18);
    footer([{ id: 'workspace-prev', text: '↑', enabled: model.page > 0, run: () => { model.page--; options.changed(); } }, { id: 'workspace-close', text: 'К фразе', run: () => { model.editing = null; model.search = ''; options.changed(); } }, { id: 'workspace-next', text: '↓', enabled: model.page < max, run: () => { model.page++; options.changed(); } }]); return;
  }
  const prompt = options.prompt ?? { ...a, y: a.y + 12, height: surface.measure(model.exercise.promptRu, a.width - 16, 18) + 10 };
  surface.text(model.exercise.promptRu, { ...prompt, x: prompt.x + 8, width: prompt.width - 16 }, 18, false, true);
  const area = options.prompt ? a : { ...a, y: a.y + prompt.height + 66, height: a.height - prompt.height - 66 };
  const tools: StudyAction[] = [
    { id: 'builder-input', text: 'Ввод', run: () => { model.editing = 'manual'; options.changed(); } },
    { id: 'workspace-add', text: '+ Слово', run: () => { model.editing = 'add'; model.afterId = undefined; model.search = ''; options.changed(); } },
    { id: 'workspace-reset', text: a.width < 300 ? 'Сброс' : 'Сначала', accessibleLabel: 'Начать фразу заново', run: () => model.reset() },
  ];
  surface.row(tools.map(action => safe({ ...action, fontSize: action.id.startsWith('grade-') ? 14 : 16 })), { x: area.x, y: options.prompt ? area.y : area.y - 50, width: area.width, height: 44 });
  const workspace = options.prompt ? { ...area, y: area.y + 54, height: area.height - 54 } : area;
  const sentence = options.prompt ? { ...prompt, y: prompt.y + surface.measure(model.exercise.promptRu, prompt.width - 16, 18) + 18, height: prompt.height - surface.measure(model.exercise.promptRu, prompt.width - 16, 18) - 18 } : undefined;
  const bank = model.bankOrder.filter(id => !model.tokens.some(token => token.id === id)).map(id => { const token = model.original.find(token => token.id === id)!; return safe({ id: 'token:' + model.original.findIndex(token => token.id === id), text: label(token), accessibleLabel: 'Добавить: ' + label(token), run: () => model.add(id) }); });
  const misplaced = model.verdict === 'incorrect' && !model.exploring ? misplacedTokens(model.exercise, model.course.forms, model.tokens.map(token => token.id)) : [];
  const chosen = model.tokens.map(token => safe({ wrong: misplaced.includes(token.id), selected: model.verdict === 'correct', id: 'placed:' + (model.original.some(value => value.id === token.id) ? model.original.findIndex(value => value.id === token.id) : token.id), text: label(token), accessibleLabel: (misplaced.includes(token.id) ? 'Не на месте. ' : '') + 'Изменить: ' + label(token), run: () => { model.editing = token.id; model.search = ''; model.page = 0; options.changed(); } }));
  surface.sentenceBuilder(bank, chosen, workspace, sentence, model.manualText !== null ? 'Свободная фраза' : model.result || undefined);
  for (const action of [...bank, ...chosen]) {
    const node = surface.root.children.find(child => child.label === action.id); if (!node) continue;
    let start: { x: number; y: number } | null = null, moved = false;
    node.on('pointerdown', event => { start = { ...event.global }; moved = false; });
    node.on('globalpointermove', event => { if (start && Math.hypot(event.global.x - start.x, event.global.y - start.y) > 10) moved = true; });
    const drop = (event: { global: { x: number; y: number } }) => {
      if (!start || !moved || document.hidden || options.busy) { start = null; return; } start = null;
      const target = surface.controls.find(control => control.id.startsWith('placed:') && event.global.x >= control.rect.x && event.global.x <= control.rect.x + control.rect.width && event.global.y >= control.rect.y && event.global.y <= control.rect.y + control.rect.height);
      const selectedId = action.id.slice(action.id.indexOf(':') + 1);
      const token = action.id.startsWith('token:') ? model.original[Number(selectedId)] : model.tokens.find(token => (model.original.some(value => value.id === token.id) ? String(model.original.findIndex(value => value.id === token.id)) : token.id) === selectedId);
      const targetToken = target ? model.tokens.find(token => (model.original.some(value => value.id === token.id) ? String(model.original.findIndex(value => value.id === token.id)) : token.id) === target.id.slice(7)) : undefined;
      if (token) model.update(placeWorkspaceToken(model.tokens, model.original, token.id, targetToken?.id, !!target && event.global.x > target.rect.x + target.rect.width / 2));
    };
    node.removeAllListeners('pointertap'); node.on('pointertap', () => { if (!moved) action.run(); });
    node.on('pointerup', drop); node.on('pointerupoutside', drop);
  }
  footer(model.manualText === null && !model.exploring && !!model.verdict ? ratingOptions(options.schedule).map(option => ({...option, enabled: option.rating === 1 || model.verdict === 'correct', run: () => options.grade(option.rating)})) : [{ id: 'builder-check', text: model.exploring || model.manualText !== null ? 'Разобрать фразу' : 'Проверить', enabled: !options.composing && !model.checking && !!model.text.trim(), run: model.exploring || model.manualText !== null ? options.analyze : options.check }]);
}
