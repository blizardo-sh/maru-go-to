import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basicKana, katakana, smallKana, voicedKana, yoonKana, type KanaAudioManifest } from '../src/shared/kana';

const directory = new URL('../public/audio/', import.meta.url);
const manifest: KanaAudioManifest = JSON.parse(readFileSync(new URL('kana-manifest.json', directory), 'utf8'));
const cells = [...basicKana, ...voicedKana, ...yoonKana, ...smallKana].flatMap(row => row.cells.flatMap(cell => cell ? [cell] : []));
describe('whitelisted kana recordings', () => {
  test('every selectable modern row entry has its exact sound group or an explicit nonphoneme explanation', () => {
    const expected = cells.flatMap(cell => [cell.kana, katakana(cell.kana)]);
    expect(Object.keys(manifest.entries).sort()).toEqual(expected.sort()); expect(expected).toHaveLength(228);
    for (const cell of cells) {
      const entry = manifest.entries[cell.kana]!;
      expect(manifest.entries[katakana(cell.kana)]).toEqual(entry);
      if (!cell.reading) { expect(entry.soundKey).toBeNull(); expect(entry).not.toHaveProperty('audioUrl'); expect('unavailableReason' in entry && entry.unavailableReason.length).toBeGreaterThan(20); }
      else { expect(entry.soundKey).toBe(cell.reading); expect('audioUrl' in entry).toBe(true); }
    }
  });
  test('homophones and small variants cannot be distinct competing sound answers', () => {
    for (const group of [['お', 'を', 'ぉ', 'オ', 'ヲ', 'ォ'], ['じ', 'ぢ', 'ジ', 'ヂ'], ['ず', 'づ', 'ズ', 'ヅ'], ['わ', 'ゎ', 'ワ', 'ヮ'], ['や', 'ゃ', 'ヤ', 'ャ']]) {
      expect(new Set(group.map(kana => manifest.entries[kana]!.soundKey)).size).toBe(1);
      expect(new Set(group.map(kana => 'audioUrl' in manifest.entries[kana]! ? manifest.entries[kana]!.audioUrl : null)).size).toBe(1);
    }
    expect(manifest.entries['は']!.soundKey).toBe('ha'); expect(manifest.entries['へ']!.soundKey).toBe('he');
    expect(manifest.entries['っ']!.soundKey).toBeNull(); expect(manifest.entries['ッ']!.soundKey).toBeNull();
  });
  test('all audible entries resolve to bounded local media files; generation report records decoding rather than human review', () => {
    const paths = new Set(Object.values(manifest.entries).flatMap(entry => 'audioUrl' in entry ? [entry.audioUrl] : [])); expect(paths.size).toBe(101);
    for (const path of paths) {
      expect(path).toMatch(/^\/audio\/[a-f0-9]{20}\.m4a$/); const file = new URL(path.slice('/audio/'.length), directory);
      expect(existsSync(file)).toBe(true); expect(statSync(file).size).toBeGreaterThan(100); expect(statSync(file).size).toBeLessThan(100_000);
      expect(readFileSync(file).subarray(4, 8).toString()).toBe('ftyp');
    }
    const report = JSON.parse(readFileSync(new URL('kana-generation-report.json', directory), 'utf8'));
    expect(report).toMatchObject({ displayedEntries: 228, audibleEntries: 226, distinctSounds: 101, decodedFiles: 101, pronunciationReview: 'not-human-reviewed' });
    expect(report.minDurationSeconds).toBeGreaterThan(0); expect(report.maxDurationSeconds).toBeLessThan(10);
    expect(manifest.pronunciationReview).toBe('not-human-reviewed');
  });
});
