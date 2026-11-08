import { expect, test } from 'bun:test';
import { loadCourse } from '../src/server/course';
import { expandSources, poolSources } from '../src/server/content-sources';
import { contentId, packContent, publicationCourse, validateContentBundle } from '../src/server/publications';
import { learnerCourse } from '../src/server/client-course';
import { learningParts } from '../src/shared/learning';
import { wordTargets } from '../src/shared/meanings';

const course = loadCourse();
test('v3 dictionary round-trips every field and produces stable IDs after JSONB key ordering', () => {
  const before = JSON.stringify(course), pooled = poolSources(course);
  expect(expandSources(pooled)).toEqual(course);
  expect(JSON.stringify(course)).toBe(before);
  expect(pooled.sourceRefs.length).toBeLessThan(course.words.length + course.forms.length);
  const reorder = (value: any): any => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reorder(entry)])) : value;
  const bundle = { formatVersion: 3 as const, ...pooled, assets: [] };
  expect(contentId({ ...bundle, ...poolSources(reorder(course)) })).toBe(contentId(bundle));
  const decoded = expandSources(pooled), ref = decoded.words[0]!.sourceRefs[0]!;
  ref.label = 'Changed only on this instance';
  expect(expandSources(pooled)).toEqual(course);
  expect(JSON.stringify(course)).toBe(before);
});

test('dictionary rejects mixed encodings, bad indices, duplicates and unbounded expansion', () => {
  const valid = poolSources(course);
  for (const id of [-1, 0.5, '0', valid.sourceRefs.length, null]) {
    const copy = structuredClone(valid); (copy.course.words[0]!.sourceRefIds as unknown[])[0] = id;
    expect(() => expandSources(copy)).toThrow('source dictionary');
  }
  const copy: any = structuredClone(valid); copy.course.words[0].sourceRefs = [];
  expect(() => expandSources(copy)).toThrow('source dictionary');
  expect(() => poolSources(copy.course)).toThrow('source dictionary');
  expect(() => expandSources({ ...valid, sourceRefs: [...valid.sourceRefs, valid.sourceRefs[0]!] })).toThrow('source dictionary');
  expect(() => expandSources({ ...valid, sourceRefs: [{ ...valid.sourceRefs[0]!, page: 0 }] })).toThrow('source dictionary');
  expect(() => expandSources({ sourceRefs: [valid.sourceRefs[0]!], course: { sourceRefIds: Array(100001).fill(0) } as any })).toThrow('source dictionary');
});

test('v1/v2 remain immutable and format 3 cannot masquerade as an older publication', () => {
  const packed = packContent(course);
  expect(packed.formatVersion).toBe(3);
  const old = { formatVersion: 2 as const, course: publicationCourse(packed), assets: packed.assets };
  const before = JSON.stringify(old), id = contentId(old);
  validateContentBundle(old);
  expect(contentId(old)).toBe(id); expect(JSON.stringify(old)).toBe(before);
  expect(publicationCourse(packed)).toEqual(old.course);
  expect(() => validateContentBundle({ ...packed, formatVersion: 2 })).toThrow();
  expect(() => validateContentBundle({ ...old, course: packed.course })).toThrow();
  expect(() => validateContentBundle({ ...old, formatVersion: 1 })).toThrow('format 2');
});

test('learner projection preserves all study records and visible references without mutating the snapshot', () => {
  const before = JSON.stringify(course), compact = learnerCourse(course);
  expect(JSON.stringify(compact).length).toBeLessThan(before.length * 0.75);
  expect(compact.lessons).toEqual(course.lessons); expect(compact.skills).toEqual(course.skills);
  expect(compact.catalog).toEqual(course.catalog); expect(compact.exercises).toEqual(course.exercises);
  expect(compact.books).toEqual(course.books);
  expect(wordTargets(compact).map(({ sourceRefs, ...word }) => word)).toEqual(wordTargets(course).map(({ sourceRefs, ...word }) => word));
  expect(compact.forms.map(({ sourceRefs, ...form }) => form)).toEqual(course.forms.map(({ sourceRefs, ...form }) => form));
  expect(compact.learning!.map(learningParts)).toEqual(course.learning!.map(learningParts));
  expect(compact.learning!.every(route => !route.authored)).toBe(true);
  expect('sourceImports' in compact).toBe(false);
  expect(compact.words.every(word => word.sourceRefs.length === 0)).toBe(true);
  expect(learnerCourse({ ...course, publicationId: 'a'.repeat(64), media: ['/audio/test.m4a'] })).toMatchObject({ publicationId: 'a'.repeat(64), media: ['/audio/test.m4a'] });
  expect(JSON.stringify(course)).toBe(before);
});
