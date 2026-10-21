import { describe, expect, test } from 'bun:test';
import { evaluate, evaluationCases, requestBody, sampleCount } from '../scripts/evaluate-openrouter';

const model = 'google/gemma-4-26b-a4b-it:free';
const key = 'test-placeholder-key-never-real';
const valid = { translationRu: 'Я студент.', grammar: 'correct', naturalness: 'natural', explanationRu: 'Вежливая именная связка.', warnings: [] };
const response = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));

describe('bounded OpenRouter evaluation', () => {
  test('default smoke covers four categories; full run is explicit and bounded', () => {
    expect(sampleCount([])).toBe(4);
    expect(sampleCount(['--samples', '20'])).toBe(20);
    for (const args of [['--samples', '21'], ['--samples', '0'], ['--samples', '1.5'], ['--other', '4']]) expect(() => sampleCount(args)).toThrow();
    expect(new Set(evaluationCases.slice(0, 4).map(c => c.category)).size).toBe(4);
    expect(evaluationCases).toHaveLength(20);
  });

  test('rejects paid/router models and fixes request to free-only private JSON', () => {
    for (const paid of ['google/gemma-4-26b-a4b-it', 'openrouter/free', `${model}\n`]) expect(() => requestBody(paid, '学生です。')).toThrow();
    const body = requestBody(model, '学校へ行きます。');
    expect(body.model).toBe(model);
    expect(body.provider).toEqual({ require_parameters: true, data_collection: 'deny' });
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body).not.toHaveProperty('models');
    expect(body).not.toHaveProperty('plugins');
  });

  test('uses direct inference, paces requests and validates the actual app output contract', async () => {
    const pauses: number[] = [];
    const calls: string[] = [];
    const send = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url));
      expect(JSON.parse(String(init?.body)).messages[1].content).toContain('text');
      expect(init?.headers).toEqual({ 'content-type': 'application/json', authorization: `Bearer ${key}` });
      return response(valid);
    }) as typeof fetch;
    const report = await evaluate(key, model, 4, send, async ms => { pauses.push(ms); });
    expect(report.attemptedRequests).toBe(4);
    expect(report.validResponses).toBe(4);
    expect(report.manualTranslationAndExplanationReviewRequired).toBe(true);
    expect(report.rubricStatus).toBe('draft-not-teacher-reviewed');
    expect(calls).toEqual(Array(4).fill('https://openrouter.ai/api/v1/chat/completions'));
    expect(pauses).toEqual([3300, 3300, 3300]);
  });

  test('stops at quota exhaustion without retry or paid fallback', async () => {
    let calls = 0;
    const send = (async () => { calls++; return new Response('', { status: 429 }); }) as unknown as typeof fetch;
    const report = await evaluate(key, model, 20, send, async () => {});
    expect(calls).toBe(1);
    expect(report.rows[0]?.status).toBe('http-429');
    expect(report.validResponses).toBe(0);
  });

  test('invalid schema or key echo never reaches the report content', async () => {
    const invalid = await evaluate(key, model, 1, (async () => response({ ...valid, grammar: 'yes' })) as unknown as typeof fetch, async () => {});
    expect(invalid.rows[0]?.status).toBe('invalid-schema');
    const echoed = await evaluate(key, model, 1, (async () => response({ ...valid, explanationRu: key })) as unknown as typeof fetch, async () => {});
    expect(echoed.rows[0]?.status).toBe('invalid-response');
    expect(JSON.stringify(echoed)).not.toContain(key);
  });

  test('rejects missing key and an excessive request budget before network access', async () => {
    await expect(evaluate('', model, 4)).rejects.toThrow();
    await expect(evaluate(key, model, 21)).rejects.toThrow();
  });
});
