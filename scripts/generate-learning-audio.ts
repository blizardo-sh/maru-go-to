import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { learningAudioTextPattern, type GuidedLesson, type LearningExample } from '../src/shared/learning';

const voice = 'Kyoko', rate = 150;
export const learningAudioName = (text: string, speaker = voice, speed = rate) => createHash('sha256').update(`${speaker}:${speed}:${text}`).digest('hex').slice(0, 20) + '.m4a';

// Only reviewed explicit overrides opt in; no automatic particle substitution or unchanged examples.
export function learningAudioPlan(routes: GuidedLesson[]) {
  const entries: { lessonId: string; partId: string; targetId: string; pointer: string; surface: string; kana: string; spokenText: string; previousAudioUrl: string; audioUrl: string }[] = [];
  for (const route of routes) route.goals.forEach((goal, goalIndex) => goal.parts.forEach((part, partIndex) => {
    const add = (example: LearningExample, targetId: string, pointer: string) => {
      if (example.audioText === undefined) return;
      const spokenText = example.audioText;
      if (typeof spokenText !== 'string' || !spokenText.length || spokenText.length > 300 || spokenText !== spokenText.trim() || !learningAudioTextPattern.test(spokenText)) throw new Error(`Invalid prepared pronunciation: ${targetId}`);
      entries.push({ lessonId: route.lessonId, partId: part.id, targetId, pointer, surface: example.surface, kana: example.kana, spokenText, previousAudioUrl: example.audioUrl, audioUrl: '/audio/learning/' + learningAudioName(spokenText) });
    };
    const base = `/goals/${goalIndex}/parts/${partIndex}`;
    part.words.forEach((word, index) => add(word.example, word.wordId, `${base}/words/${index}/example/audioUrl`));
    if (part.construction) add(part.construction.example, part.construction.exerciseId, `${base}/construction/example/audioUrl`);
  }));
  return entries;
}

if (import.meta.main) {
  const root = new URL('../', import.meta.url), output = new URL('public/audio/learning/', root);
  const routes = readdirSync(new URL('materials/learning/', root)).filter(name => /^lesson-\d{2}\.json$/.test(name)).sort().map(name => JSON.parse(readFileSync(new URL('materials/learning/' + name, root), 'utf8')) as GuidedLesson);
  const entries = learningAudioPlan(routes);
  if (Bun.argv.includes('--plan')) { console.log(JSON.stringify({ voice, rate, selectedExamples: entries.length, distinctReadings: new Set(entries.map(entry => entry.spokenText)).size, entries }, null, 2)); }
  else {
    if (!entries.length) throw new Error('No reviewed audioText overrides; nothing will be generated.');
    const temporary = mkdtempSync(join(tmpdir(), 'marugoto-learning-audio-'));
    try {
      const input = join(temporary, 'speech.json'), cache = join(temporary, 'audio'); mkdirSync(cache);
      const readings = [...new Set(entries.map(entry => entry.spokenText))];
      const existing = new Set<string>();
      for (const text of readings) {
        const name = learningAudioName(text), source = [new URL(name, output), new URL('public/audio/' + name, root)].find(file => existsSync(file) && statSync(file).size > 100);
        if (source) { copyFileSync(source, join(cache, name)); existing.add(name); }
      }
      writeFileSync(input, JSON.stringify({ words: readings.map(text => ({ id: learningAudioName(text), audioText: text })) }));
      console.info(JSON.stringify({ phase: 'offline learning audio', voice, rate, selectedExamples: entries.length, distinctReadings: readings.length, cached: existing.size }));
      const generated = Bun.spawnSync([process.env.PYTHON ?? 'python3', new URL('scripts/generate-audio.py', root).pathname, '--course', input, '--output', cache, '--voice', voice, '--rate', String(rate), '--jobs', '2'], { stdout: 'inherit', stderr: 'inherit' });
      if (generated.exitCode) throw new Error('Learning speech generation failed; the public manifest was not changed.');
      const files = readings.map(text => {
        const name = learningAudioName(text), source = join(cache, name), decoded = join(temporary, 'decoded.wav');
        const info = Bun.spawnSync(['/usr/bin/afinfo', source]);
        const durationSeconds = Number(new TextDecoder().decode(info.stdout).match(/estimated duration:\s+([0-9.]+)/)?.[1]);
        const decode = Bun.spawnSync(['/usr/bin/afconvert', '-f', 'WAVE', '-d', 'LEI16', source, decoded]);
        if (info.exitCode || decode.exitCode || !(durationSeconds > 0 && durationSeconds < 60) || statSync(source).size <= 100 || statSync(decoded).size <= 44) throw new Error(`Invalid decoded learning recording: ${name}`);
        rmSync(decoded);
        return { audioUrl: '/audio/learning/' + name, spokenText: text, bytes: statSync(source).size, durationSeconds, sha256: createHash('sha256').update(readFileSync(source)).digest('hex') };
      });
      mkdirSync(output, { recursive: true });
      for (const file of files) { const name = file.audioUrl.split('/').at(-1)!; if (!existsSync(new URL(name, output))) copyFileSync(join(cache, name), new URL(name, output)); }
      const manifest = { voice, rate, pronunciationReview: 'not-human-reviewed', entries };
      const report = { voice, rate, pronunciationReview: 'not-human-reviewed', selectedExamples: entries.length, distinctReadings: files.length, generatedReadings: files.length - existing.size, cachedReadings: existing.size, decodedFiles: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), minDurationSeconds: Math.min(...files.map(file => file.durationSeconds)), maxDurationSeconds: Math.max(...files.map(file => file.durationSeconds)), files, limits: 'Explicit reviewed whole-phrase readings only; automated decoding and duration checks do not certify Japanese pronunciation.' };
      writeFileSync(new URL('prepared-manifest.json', output), JSON.stringify(manifest, null, 2) + '\n');
      writeFileSync(new URL('prepared-generation-report.json', output), JSON.stringify(report, null, 2) + '\n');
      console.info(JSON.stringify({ ...report, files: undefined }));
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  }
}
