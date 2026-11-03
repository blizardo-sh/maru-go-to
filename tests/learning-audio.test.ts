import { expect, test } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import { registerContract } from '../src/server/openapi';
import { validateLearning } from '../src/shared/learning';
import { learningFixture } from './helpers/learning-fixture';
import { learningAudioName, learningAudioPlan } from '../scripts/generate-learning-audio';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import type { GuidedLesson } from '../src/shared/learning';

test('explicit prepared pronunciation rejects invalid text instead of silently trusting an audio override', () => {
  for (const audioText of ['', '  ', 'watashi wa', 'https://example.test/audio', 'は'.repeat(301), ' ははわげんきです。', 'ははわげんきです。 ']) {
    const course = learningFixture();
    Object.assign(course.learning[0]!.goals[0]!.parts[0]!.words[0]!.example, { audioText });
    expect(() => validateLearning(course, course.learning)).toThrow('example pronunciation');
  }
});

test('published prepared examples use their exact recording and preserve the untouched examples', () => {
  const root = new URL('../', import.meta.url);
  const routes: GuidedLesson[] = readdirSync(new URL('materials/learning/', root)).filter(name => /^lesson-\d{2}\.json$/.test(name)).sort().map(name => JSON.parse(readFileSync(new URL('materials/learning/' + name, root), 'utf8')));
  const selected = learningAudioPlan(routes);
  const manifest = JSON.parse(readFileSync(new URL('public/audio/learning/prepared-manifest.json', root), 'utf8'));
  const report = JSON.parse(readFileSync(new URL('public/audio/learning/prepared-generation-report.json', root), 'utf8'));
  expect(selected.length).toBeGreaterThan(0);
  expect(manifest).toMatchObject({ voice: 'Kyoko', rate: 150, pronunciationReview: 'not-human-reviewed' });
  expect(manifest.entries).toHaveLength(selected.length);
  for (const entry of selected) {
    const recorded = manifest.entries.find((value: typeof entry) => value.lessonId === entry.lessonId && value.pointer === entry.pointer);
    expect(recorded).toMatchObject({ spokenText: entry.spokenText, surface: entry.surface, kana: entry.kana, audioUrl: entry.audioUrl });
    const exampleUrl = entry.pointer.split('/').slice(1).reduce((value: any, key) => value[key], routes.find(route => route.lessonId === entry.lessonId));
    expect(exampleUrl).toBe(entry.audioUrl);
    const file = new URL('public' + entry.audioUrl, root), bytes = readFileSync(file);
    expect(bytes.subarray(4, 8).toString()).toBe('ftyp'); expect(statSync(file).size).toBeGreaterThan(100);
    const checked = report.files.find((value: { audioUrl: string }) => value.audioUrl === entry.audioUrl);
    expect(checked?.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(checked?.durationSeconds).toBeGreaterThan(0); expect(checked?.durationSeconds).toBeLessThan(60);
    // URL changes never remove the prior asset needed by an active older client.
    expect(statSync(new URL('public' + recorded.previousAudioUrl, root)).size).toBeGreaterThan(100);
  }
  expect(report.decodedFiles).toBe(new Set(selected.map(entry => entry.audioUrl)).size);
  expect(report.pronunciationReview).toBe('not-human-reviewed');
});

test('OpenAPI publishes prepared example pronunciation as optional, bounded text', () => {
  const app = new OpenAPIHono(); registerContract(app, false);
  const document = app.getOpenAPI31Document({ openapi: '3.1.0', info: { title: 'test', version: '1' } });
  const schema = JSON.parse(JSON.stringify(document)).paths['/api/course'].get.responses['200'].content['application/json'].schema;
  const example = schema.properties.learning.items.properties.goals.items.properties.parts.items.properties.words.items.properties.example;
  expect(example.properties.audioText).toMatchObject({ type: 'string', minLength: 1, maxLength: 300 });
  expect(example.required).not.toContain('audioText');
});

test('prepared particle pronunciation leaves lexical spelling and the displayed reading intact', () => {
  const course = learningFixture();
  const example = course.learning[0]!.goals[0]!.parts[0]!.words[0]!.example;
  Object.assign(example, { surface: 'ははははなします。', kana: 'ははははなします。', segments: [{ surface: 'ははははなします。' }], audioText: 'ははわはなします。' });
  expect(() => validateLearning(course, course.learning)).not.toThrow();
  expect(example.surface).toBe('ははははなします。'); expect(example.kana).toBe(example.surface);
  delete example.audioText;
  expect(() => validateLearning(course, course.learning)).not.toThrow();
});

test('offline plan selects only explicit whole phrases, preserves source spelling and invalidates cache by actual speech settings', () => {
  const course = learningFixture(), part = course.learning[0]!.goals[0]!.parts[0]!;
  expect(learningAudioPlan(course.learning)).toEqual([]);
  Object.assign(part.words[0]!.example, { audioText: 'ははわはなします。' });
  Object.assign(part.words[1]!.example, { audioText: 'ははわはなします。' });
  const before = structuredClone(course.learning), plan = learningAudioPlan(course.learning);
  expect(plan).toHaveLength(2); expect(new Set(plan.map(entry => entry.audioUrl)).size).toBe(1);
  expect(plan[0]).toMatchObject({ surface: part.words[0]!.example.surface, kana: part.words[0]!.example.kana, spokenText: 'ははわはなします。', previousAudioUrl: part.words[0]!.example.audioUrl, pointer: '/goals/0/parts/0/words/0/example/audioUrl' });
  expect(course.learning).toEqual(before);
  const name = learningAudioName('ははわはなします。'); expect(name).toMatch(/^[a-f0-9]{20}\.m4a$/);
  expect(learningAudioName('ははははなします。')).not.toBe(name);
  expect(learningAudioName('ははわはなします。', 'Kyoko', 151)).not.toBe(name);
  expect(learningAudioName('ははわはなします。', 'AnotherVoice', 150)).not.toBe(name);
  Object.assign(part.words[0]!.example, { audioText: 'runtime arbitrary English' });
  expect(() => learningAudioPlan(course.learning)).toThrow('Invalid prepared pronunciation');
});
