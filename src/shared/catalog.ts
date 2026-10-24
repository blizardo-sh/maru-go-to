import { validateThematicMaterial } from './training';
import data from '../../materials/catalog.json';
import type { CounterDefinition, CounterObject } from './counters';
import type { KanaRow, KanaAudioManifest } from './kana';
import type { Course } from './types';

/** Authored teaching data; algorithms and learner state stay outside the catalog. */
export interface CourseCatalog {
  learningPolicy?: 'master-before-repeat';
  thematic?: Omit<import('./training').ThematicMaterial,'words'|'forms'>;
  schemaVersion: 1;
  quiz: { choices: Record<string, string[]>; equivalent: string[][]; courtesyMarkers: string[] };
  counters: { definitions: CounterDefinition[]; objects: CounterObject[] };
  kana: { basic: KanaRow[]; voiced: KanaRow[]; yoon: KanaRow[]; small: KanaRow[] };
  kanaAudio?: KanaAudioManifest;
  counterAtlas?: { src: string; width: number; height: number; cells: Record<string, number[]> };
  particleSkills: Record<string, string[]>;
  personalPractice: { skillId: string; thisFormId: string; topicFormId: string; copulaFormId: string; promptRu: string; translationRu: string; contextRu: string };
  illustrations: typeof import('../../public/word-illustrations/manifest.json');
  pronunciationOverrides: Record<string, string>;
}

/** Legacy isolated fixtures may omit a catalog. Published courses always supply theirs. */
export const defaultCatalog = data as CourseCatalog;
export const catalogFor = (course?: Pick<Course, 'catalog'>): CourseCatalog => course?.catalog ?? defaultCatalog;

/** Validate author files before publishing; this does not certify their Japanese. */
export function validateCatalog(course: Course): void {
  validateThematicMaterial(course);
  const c = course.catalog;
  const ensure: (value: unknown, label: string) => asserts value = (value, label) => { if (!value) throw new Error(`Invalid catalog: ${label}`); };
  const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  const local = (value: unknown) => text(value) && /^\/[a-z0-9][a-z0-9/_.-]*$/i.test(value) && !value.split('/').some(part => part === '..' || part === '.');
  ensure(c && c.schemaVersion === 1, 'schema');
  ensure(record(c.quiz) && record(c.quiz.choices), 'quiz');
  const words = new Map(course.words.map(word => [word.id, word]));
  for (const [id, choices] of Object.entries(c.quiz.choices)) ensure(words.has(id) && Array.isArray(choices) && choices.length === 3 && new Set([id,...choices]).size === 4 && choices.every(choice => words.has(choice)), `choices ${id}`);
  ensure(Array.isArray(c.quiz.equivalent) && c.quiz.equivalent.every(group => Array.isArray(group) && group.length >= 2 && group.every(text)), 'equivalent answers');
  ensure(Array.isArray(c.quiz.courtesyMarkers) && c.quiz.courtesyMarkers.every(text), 'courtesy markers');
  ensure(record(c.counters) && Array.isArray(c.counters.definitions) && c.counters.definitions.length > 0 && Array.isArray(c.counters.objects), 'counters');
  const ids = new Set<string>();
  for (const definition of c.counters.definitions) {
    ensure(definition && defaultCatalog.counters.definitions.some(supported => supported.id === definition.id) && !ids.has(definition.id) && [definition.surface,definition.kana,definition.title,definition.explanation].every(text) && Number.isSafeInteger(definition.maximum) && definition.maximum >= 8 && definition.maximum <= (definition.id === 'tsu' ? 10 : definition.id === 'sai' ? 120 : 9_999_999), 'counter definition'); ids.add(definition.id);
  }
  const objects = new Set<string>();
  for (const object of c.counters.objects) { ensure(object && text(object.id) && !objects.has(object.id) && Array.isArray(object.kanas) && object.kanas.length > 0 && object.kanas.every(text) && Array.isArray(object.counters) && object.counters.length > 0 && object.counters.every(id => ids.has(id)) && Number.isSafeInteger(object.tile) && object.tile >= 0, 'counter object'); objects.add(object.id); }
  ensure(c.counterAtlas && local(c.counterAtlas.src) && Number.isFinite(c.counterAtlas.width) && c.counterAtlas.width > 0 && Number.isFinite(c.counterAtlas.height) && c.counterAtlas.height > 0 && record(c.counterAtlas.cells), 'counter atlas');
  for (const id of objects) { const bounds = c.counterAtlas.cells[id]; ensure(Array.isArray(bounds) && bounds.length === 4 && bounds.every(Number.isFinite) && bounds[0]! >= 0 && bounds[1]! >= 0 && bounds[2]! > 0 && bounds[3]! > 0 && bounds[0]!+bounds[2]! <= c.counterAtlas.width && bounds[1]!+bounds[3]! <= c.counterAtlas.height, `counter bounds ${id}`); }
  ensure(record(c.kana), 'kana');
  const kana: string[] = [];
  for (const name of ['basic','voiced','yoon','small'] as const) {
    const rows = c.kana[name]; ensure(Array.isArray(rows) && rows.length > 0, `kana ${name}`);
    for (const row of rows) { ensure(row && text(row.label) && Array.isArray(row.cells), 'kana row'); for (const entry of row.cells) if (entry !== null) { ensure(entry && text(entry.kana) && typeof entry.reading === 'string', 'kana entry'); kana.push(entry.kana); } }
  }
  ensure(c.kanaAudio && record(c.kanaAudio.entries), 'kana audio');
  for (const glyph of kana.flatMap(value => [value,[...value].map(char => {const code=char.codePointAt(0)!;return code>=0x3041&&code<=0x3096?String.fromCodePoint(code+0x60):char;}).join('')])) { const entry = c.kanaAudio.entries[glyph]; ensure(entry && (entry.soundKey === null ? text(entry.unavailableReason) : text(entry.soundKey) && local(entry.audioUrl)), `kana audio ${glyph}`); }
  ensure(record(c.particleSkills), 'particle index');
  for (const [surface, ids] of Object.entries(c.particleSkills)) ensure(text(surface) && Array.isArray(ids) && ids.length > 0 && ids.every(id => course.skills.some(skill => skill.id === id)) && course.words.some(word => word.pos === 'particle' && word.surface === surface), `particle ${surface}`);
  const template = c.personalPractice; ensure(template && course.skills.some(skill => skill.id === template.skillId) && [template.thisFormId,template.topicFormId,template.copulaFormId].every(id => course.forms.some(form => form.id === id)) && [template.promptRu,template.translationRu,template.contextRu].every(text), 'personal template');
  ensure(c.illustrations && Array.isArray(c.illustrations.assets), 'illustrations');
  for (const asset of c.illustrations.assets) { ensure(asset && local(asset.src) && Number.isFinite(asset.width) && asset.width > 0 && Number.isFinite(asset.height) && asset.height > 0 && Array.isArray(asset.cells), 'illustration asset'); for (const cell of asset.cells) ensure(Array.isArray(cell.wordIds) && cell.wordIds.every(id => words.has(id)) && Array.isArray(cell.bounds) && cell.bounds.length === 4 && cell.bounds.every(Number.isFinite) && cell.bounds[0]! >= 0 && cell.bounds[1]! >= 0 && cell.bounds[2]! > 0 && cell.bounds[3]! > 0 && cell.bounds[0]!+cell.bounds[2]! <= asset.width && cell.bounds[1]!+cell.bounds[3]! <= asset.height, 'illustration cell'); }
  ensure(Array.isArray(c.illustrations.notIllustrated) && c.illustrations.notIllustrated.every(entry => entry && words.has(entry.wordId) && text(entry.surface) && text(entry.reason)), 'unillustrated references');
  ensure(record(c.pronunciationOverrides) && Object.entries(c.pronunciationOverrides).every(([key,value]) => text(key) && text(value)), 'pronunciations');
}
