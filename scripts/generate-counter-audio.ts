import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { counterAnswer, counterDefinitions, numbersFor } from '../src/shared/counters';

// Use the existing content-addressed speech cache for both vocabulary and whole counted expressions.
const root = new URL('../', import.meta.url);
const course = JSON.parse(readFileSync(new URL('materials/course.json', root), 'utf8'));
const expressions = counterDefinitions.flatMap(counter => [null, ...Array.from({ length: 7 }, (_, level) => numbersFor(counter, level)).flat()].map(quantity => ({
  id: `counter.${counter.id}.${quantity ?? 'suffix'}`, kana: counterAnswer(counter, quantity).kana,
})));
if (new Set(expressions.map(expression => expression.id)).size !== expressions.length) throw new Error('Повторяются идентификаторы счётных выражений.');
const temporary = mkdtempSync(join(tmpdir(), 'marugoto-counter-audio-'));
try {
  const input = join(temporary, 'speech.json');
  writeFileSync(input, JSON.stringify({ words: [...course.words, ...expressions] }));
  const result = Bun.spawnSync(['python3', new URL('scripts/generate-audio.py', root).pathname, '--course', input, '--output', new URL('public/audio', root).pathname, '--jobs', '2'], { stdout: 'inherit', stderr: 'inherit' });
  if (result.exitCode) throw new Error('Не удалось подготовить всю озвучку. Смотрите generation-report.json.');
  const manifest = JSON.parse(readFileSync(new URL('public/audio/manifest.json', root), 'utf8'));
  if (expressions.some(expression => !manifest[expression.id])) throw new Error('В аудиоманифесте отсутствуют счётные выражения.');
} finally { rmSync(temporary, { recursive: true, force: true }); }
