import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { course } from '../src/shared/course';
import type { GuidedLesson } from '../src/shared/learning';
import { getWordIllustration } from '../src/shared/word-illustrations';
import { defaultCatalog } from '../src/shared/catalog';
const manifest = defaultCatalog.illustrations;
import generation from '../public/word-illustrations/generation.json';

const lessons: GuidedLesson[] = readdirSync(new URL('../materials/learning/', import.meta.url))
  .filter(name => /^lesson-\d\d\.json$/.test(name))
  .sort()
  .map(name => JSON.parse(readFileSync(new URL(`../materials/learning/${name}`, import.meta.url), 'utf8')));
const knownWords = new Map([...course.words, ...lessons.flatMap(lesson => lesson.authored?.words ?? [])].map(word => [word.id, word]));
const core = new Set(lessons.flatMap(lesson => lesson.goals.flatMap(goal => goal.parts.flatMap(part => part.words.map(word => word.wordId)))));

test('every core word in all 18 lessons has a reviewed illustration or an explicit semantic reason for none', () => {
  expect(lessons).toHaveLength(18);
  expect(core).toEqual(new Set(Object.keys(defaultCatalog.quiz.choices)));
  const mapped = new Set<string>();
  for (const asset of manifest.assets) {
    expect(asset.review).toBe('visually-checked');
    for (const cell of asset.cells) for (const wordId of cell.wordIds) {
      expect(knownWords.has(wordId)).toBe(true);
      expect(mapped.has(wordId)).toBe(false);
      mapped.add(wordId);
    }
  }
  const excluded = new Set<string>();
  for (const word of manifest.notIllustrated) {
    expect(core.has(word.wordId)).toBe(true);
    expect(excluded.has(word.wordId) || mapped.has(word.wordId)).toBe(false);
    expect(knownWords.get(word.wordId)?.surface).toBe(word.surface);
    expect(word.reason.length).toBeGreaterThan(30);
    excluded.add(word.wordId);
  }
  expect([...core].filter(wordId => mapped.has(wordId)).length + excluded.size).toBe(core.size);
  for (const wordId of core) expect(mapped.has(wordId) || excluded.has(wordId)).toBe(true);
  for (const [index, lesson] of lessons.entries()) {
    const ids = new Set(lesson.goals.flatMap(goal => goal.parts.flatMap(part => part.words.map(word => word.wordId))));
    const report = manifest.coverage[index]!;
    expect(report.lesson).toBe(index + 1);
    expect(report.total).toBe(ids.size);
    expect(report.illustrated).toBe([...ids].filter(id => mapped.has(id)).length);
  }
});

test('local artwork, real alpha, authored viewports and byte budgets are valid', () => {
  let webpBytes = 0;
  for (const asset of manifest.assets) {
    expect(asset.src).toMatch(/^\/(?:word-illustrations\/[a-z-]+-v1\.webp|word-illustrations\/cat\.png)$/);
    const bytes = readFileSync(new URL(`../public${asset.src}`, import.meta.url));
    expect(bytes.length).toBe(asset.bytes);
    if (asset.src.endsWith('.webp')) {
      expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
      expect(bytes.toString('ascii', 8, 16)).toBe('WEBPVP8X');
      expect(bytes[20]! & 0x10).toBe(0x10);
      expect(bytes.readUIntLE(24, 3) + 1).toBe(asset.width);
      expect(bytes.readUIntLE(27, 3) + 1).toBe(asset.height);
      expect(bytes.length).toBeLessThanOrEqual(400_000);
      webpBytes += bytes.length;
    } else {
      expect(bytes.toString('ascii', 1, 4)).toBe('PNG');
      expect(bytes.readUInt32BE(16)).toBe(asset.width);
      expect(bytes.readUInt32BE(20)).toBe(asset.height);
      expect(bytes[25]).toBe(6);
    }
    expect(asset.cells).toHaveLength(asset.columns * asset.rows);
    for (const cell of asset.cells) {
      expect(cell.column).toBeGreaterThanOrEqual(0);
      expect(cell.column).toBeLessThan(asset.columns);
      expect(cell.row).toBeGreaterThanOrEqual(0);
      expect(cell.row).toBeLessThan(asset.rows);
      const [x, y, width, height] = cell.bounds;
      expect([x, y, width, height].every(value => Number.isFinite(value))).toBe(true);
      expect(x!).toBeGreaterThanOrEqual(0);
      expect(y!).toBeGreaterThanOrEqual(0);
      expect(width!).toBeGreaterThan(0);
      expect(height!).toBeGreaterThan(0);
      expect(x! + width!).toBeLessThanOrEqual(asset.width);
      expect(y! + height!).toBeLessThanOrEqual(asset.height);
    }
  }
  expect(webpBytes).toBeLessThanOrEqual(6_500_000);
  const bytesBySrc = new Map(manifest.assets.map(asset => [asset.src, asset.bytes]));
  for (const lesson of lessons) for (const goal of lesson.goals) for (const part of goal.parts) {
    const visibleSources = new Set(part.words.flatMap(word => {
      const illustration = getWordIllustration(word.wordId);
      return illustration ? [illustration.src] : [];
    }));
    const requestedBytes = [...visibleSources].reduce((sum, src) => sum + bytesBySrc.get(src)!, 0);
    expect(requestedBytes).toBeLessThanOrEqual(1_500_000);
  }
});

test('family politeness variants retain the relationship; unrelated/new words get no arbitrary picture', () => {
  const father = 'marugoto.starter-a1.word.2d31dd8d68a3ada0';
  const mother = 'marugoto.starter-a1.word.07ab7fc730f6f2bb';
  expect(getWordIllustration(father)?.src).not.toBe(getWordIllustration(mother)?.src);
  expect(getWordIllustration('marugoto.starter-a1.word.fa352771e8199249')).toEqual(getWordIllustration(father));
  expect(getWordIllustration('marugoto.starter-a1.word.24948b79aebe026a')).toEqual(getWordIllustration(mother));
  expect(getWordIllustration('marugoto.starter-a1.word.ab938f825a16029d')).toBeUndefined();
  expect(getWordIllustration('marugoto.starter-a1.word.e2c5c1b293069cce')).toBeUndefined();
  expect(getWordIllustration('unknown-personal-word')).toBeUndefined();
});

test('art provenance is explicit, local-path-free and has no per-word API generation at runtime', () => {
  expect(generation.toolMode).toBe('built-in');
  expect(generation.newAtlasCalls).toBe(20);
  expect(generation.assets.filter(asset => asset.mode === 'built-in')).toHaveLength(20);
  expect(JSON.stringify(generation)).not.toMatch(/\/Users\/|\/private\/tmp\//);
  expect(JSON.stringify(manifest)).not.toMatch(/\/Users\/|\/private\/tmp\//);
});
