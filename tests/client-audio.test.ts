import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

test('audio build skips annotation and template strings and preserves stable cache names', () => {
  const source = `import importlib.util\nspec=importlib.util.spec_from_file_location('audio', 'scripts/generate-audio.py')\nm=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(m)\nassert m.spoken_text({'kana':'は','audioText':'わ'}) == 'わ'\nassert m.spoken_text({'kana':'は'}) == 'は'\nassert m.safe_reading('にほんご')\nassert m.safe_reading('コーヒー')\nassert not m.safe_reading('～にん')\nassert not m.safe_reading('にほんご（日本語）')\nassert not m.safe_reading('')\nassert m.audio_name('ねこ') == m.audio_name('ねこ')\nassert m.audio_name('ねこ') != m.audio_name('いぬ')\n`;
  const result = spawnSync('python3', ['-c', source], { encoding: 'utf8' });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});
