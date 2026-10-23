import { expect, test } from 'bun:test';
import { validateLearning } from '../src/shared/learning';
import { learningFixture } from './helpers/learning-fixture';

function supplementarySource(url: string) {
  const course = learningFixture(), route = course.learning[0]!;
  const word = course.words.find(word => word.id === route.goals[0]!.parts[0]!.words[0]!.wordId)!;
  route.authored = { words: [{ ...word, id: 'fixture.supplementary', sourceRefs: [{ part: 'rikai', url, label: 'First-party supplementary vocabulary' }] }], forms: [], skills: [], exercises: [] };
  return course;
}

test('reviewed supplementary vocabulary accepts the two exact additional first-party JF HTTPS hosts', () => {
  for (const url of ['https://www.irodori.jpf.go.jp/assets/data/wordlist_Y.pdf', 'https://www.hirogaru-nihongo.jpf.go.jp/']) {
    const course = supplementarySource(url);
    expect(() => validateLearning(course, course.learning)).not.toThrow();
  }
});

test('supplementary provenance rejects arbitrary, non-HTTPS and lookalike hosts without a JF wildcard', () => {
  for (const url of ['http://www.irodori.jpf.go.jp/a.pdf', 'https://irodori.jpf.go.jp/a.pdf', 'https://hirogaru-nihongo.jpf.go.jp/', 'https://www.irodori.jpf.go.jp.attacker.example/a.pdf', 'https://www.hirogaru-nihongo.jpf.go.jp@attacker.example/', 'https://other.jpf.go.jp/a.pdf', 'https://example.test/']) {
    const course = supplementarySource(url);
    expect(() => validateLearning(course, course.learning)).toThrow('authored provenance');
  }
});
