import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { basicKana, katakana, smallKana, voicedKana, yoonKana } from '../src/shared/kana';

// Use the existing offline voice/cache, without overwriting the vocabulary/counter manifest.
const root = new URL('../', import.meta.url), output = new URL('public/audio/', root);
const entries = [...basicKana, ...voicedKana, ...yoonKana, ...smallKana].flatMap(row => row.cells.flatMap(cell => cell ? [cell] : []));
const sounds = new Map<string, string>();
for (const entry of entries) if (entry.reading && !sounds.has(entry.reading)) sounds.set(entry.reading, entry.kana);
const nameFor = (text: string) => createHash('sha256').update(`Kyoko:150:${text}`).digest('hex').slice(0, 20) + '.m4a';
const temporary = mkdtempSync(join(tmpdir(), 'marugoto-kana-audio-'));
try {
  const input = join(temporary, 'speech.json'), cache = join(temporary, 'audio');
  mkdirSync(cache);
  for (const text of sounds.values()) { const name = nameFor(text), source = new URL(name, output); if (existsSync(source)) copyFileSync(source, join(cache, name)); }
  writeFileSync(input, JSON.stringify({ words: [...sounds].map(([id, kana]) => ({ id, kana })) }));
  const generated = Bun.spawnSync(['python3', new URL('scripts/generate-audio.py', root).pathname, '--course', input, '--output', cache, '--jobs', '2'], { stdout: 'inherit', stderr: 'inherit' });
  if (generated.exitCode) throw new Error('Kana generation failed; the public manifest was not changed.');
  const generatedManifest = JSON.parse(readFileSync(join(cache, 'manifest.json'), 'utf8')) as Record<string, string>;
  const durations: number[] = [];
  for (const [key, text] of sounds) {
    const name = nameFor(text), source = join(cache, name);
    if (generatedManifest[key] !== '/audio/' + name || statSync(source).size <= 100) throw new Error(`Missing pronunciation: ${key}`);
    const info = Bun.spawnSync(['/usr/bin/afinfo', source]);
    const duration = Number(new TextDecoder().decode(info.stdout).match(/estimated duration:\s+([0-9.]+)/)?.[1]);
    const pcm = join(temporary, 'decoded.wav');
    const decode = Bun.spawnSync(['/usr/bin/afconvert', '-f', 'WAVE', '-d', 'LEI16', source, pcm]);
    if (info.exitCode || decode.exitCode || !(duration > 0) || statSync(pcm).size <= 44) throw new Error(`Invalid pronunciation file: ${key}`);
    rmSync(pcm); durations.push(duration); if (!existsSync(new URL(name, output))) copyFileSync(source, new URL(name, output));
  }
  const manifest: Record<string, { soundKey: string | null; audioUrl?: string; unavailableReason?: string }> = {};
  for (const entry of entries) for (const kana of [entry.kana, katakana(entry.kana)]) manifest[kana] = entry.reading ? { soundKey: entry.reading, audioUrl: generatedManifest[entry.reading]! } : { soundKey: null, unavailableReason: 'Малый っ/ッ обозначает удвоение следующего согласного и не имеет отдельного звука. Для него доступно узнавание знака.' };
  writeFileSync(new URL('kana-manifest.json', output), JSON.stringify({ voice: 'Kyoko', rate: 150, pronunciationReview: 'not-human-reviewed', entries: manifest }, null, 2) + '\n');
  const report = { source: 'existing offline macOS speech synthesis pipeline', voice: 'Kyoko', rate: 150, pronunciationReview: 'not-human-reviewed', displayedEntries: Object.keys(manifest).length, audibleEntries: Object.values(manifest).filter(entry => entry.audioUrl).length, distinctSounds: sounds.size, decodedFiles: durations.length, minDurationSeconds: Math.min(...durations), maxDurationSeconds: Math.max(...durations), canonicalization: 'Katakana, small kana and modern homophones share their hiragana reading; small tsu has no isolated audio.', pronunciationLimits: 'Automated file decoding and duration checks do not replace a human Japanese pronunciation review.' };
  writeFileSync(new URL('kana-generation-report.json', output), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally { rmSync(temporary, { recursive: true, force: true }); }
