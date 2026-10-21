import { providerOutput, ANALYSIS_SYSTEM_PROMPT } from '../src/server/analysis';

// shortcut: expectations are a draft rubric, use a teacher-reviewed set before claiming linguistic quality.
export const evaluationCases = [
  { id: 'correct', text: 'わたしは学生です。', category: 'correct', expected: ['correct'] },
  { id: 'particle-error', text: 'わたしは学生をです。', category: 'incorrect', expected: ['incorrect'] },
  { id: 'unfinished', text: 'わたしは', category: 'incomplete', expected: ['incomplete', 'uncertain'] },
  { id: 'valid-particle-edit', text: '学校へ行きます。', category: 'valid-edit', expected: ['correct'] },
  { id: 'negative', text: 'わたしは学生ではありません。', category: 'correct', expected: ['correct'] },
  { id: 'question', text: '田中さんは先生ですか。', category: 'correct', expected: ['correct'] },
  { id: 'past', text: 'きのう、パンを食べました。', category: 'correct', expected: ['correct'] },
  { id: 'destination', text: '学校に行きます。', category: 'valid-edit', expected: ['correct'] },
  { id: 'action-location', text: '学校で日本語を勉強します。', category: 'correct', expected: ['correct'] },
  { id: 'like', text: 'パンが好きです。', category: 'correct', expected: ['correct'] },
  { id: 'wish', text: '水を飲みたいです。', category: 'correct', expected: ['correct'] },
  { id: 'possession', text: 'これはわたしの本です。', category: 'correct', expected: ['correct'] },
  { id: 'double-polite', text: '学校へ行きましたです。', category: 'incorrect', expected: ['incorrect'] },
  { id: 'object-particle', text: 'パンに食べます。', category: 'incorrect', expected: ['incorrect'] },
  { id: 'copula', text: 'わたしは学生ですではありません。', category: 'incorrect', expected: ['incorrect'] },
  { id: 'adjective', text: 'この本はおもしろいです。', category: 'correct', expected: ['correct'] },
  { id: 'unfinished-object', text: 'この本を', category: 'incomplete', expected: ['incomplete', 'uncertain'] },
  { id: 'unfinished-if', text: '雨が降ったら', category: 'incomplete', expected: ['incomplete', 'uncertain'] },
  { id: 'contrast-topic', text: 'りんごは食べます。', category: 'context-sensitive', expected: ['correct', 'uncertain'] },
  { id: 'subject-focus', text: 'わたしが学生です。', category: 'context-sensitive', expected: ['correct', 'uncertain'] },
];

export function sampleCount(args: string[]) {
  if (args.length === 0) return 4;
  const count = Number(args[1]);
  if (args.length !== 2 || args[0] !== '--samples' || !Number.isInteger(count) || count < 1 || count > evaluationCases.length) {
    throw new Error('Use --samples 1..20 (default: 4).');
  }
  return count;
}

export function requestBody(model: string, text: string) {
  if (!/^[a-z0-9.-]+\/[a-z0-9._-]+:free$/.test(model)) throw new Error('Only an explicit :free model is allowed.');
  return {
    model, temperature: 0, max_tokens: 800,
    provider: { require_parameters: true, data_collection: 'deny' },
    messages: [{ role: 'system', content: ANALYSIS_SYSTEM_PROMPT }, { role: 'user', content: JSON.stringify({ text }) }],
    response_format: { type: 'json_object' },
  };
}

type Output = ReturnType<typeof providerOutput.parse>;
type EvaluationRow = { id: string; text: string; category: string; expected: string[]; elapsedMs: number; status: string; output?: Output; draftGrammarMatch?: boolean };

export async function evaluate(
  key: string, model: string, count: number,
  send: typeof fetch = fetch, pause: (ms: number) => Promise<unknown> = Bun.sleep,
) {
  if (key.length < 20 || /\s/.test(key)) throw new Error('A valid OPENROUTER_API_KEY is required in the environment.');
  requestBody(model, '');
  if (!Number.isInteger(count) || count < 1 || count > evaluationCases.length) throw new Error('Request budget must be 1..20.');
  const rows: EvaluationRow[] = [];
  for (const test of evaluationCases.slice(0, count)) {
    // Keep the isolated runner below OpenRouter's shared 20 requests/minute; other app traffic shares that limit.
    if (rows.length) await pause(3300);
    const start = performance.now();
    let result: Omit<EvaluationRow, 'id' | 'text' | 'category' | 'expected' | 'elapsedMs'>;
    try {
      const response = await send('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(requestBody(model, test.text)), signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) result = { status: `http-${response.status}` };
      else {
        const body = await response.text();
        if (body.length > 50000) result = { status: 'oversized-response' };
        else {
          const envelope = JSON.parse(body);
          const content = envelope.choices?.[0]?.message?.content;
          if (typeof content !== 'string' || content.includes(key)) result = { status: 'invalid-response' };
          else {
            const output = providerOutput.safeParse(JSON.parse(content));
            result = output.success ? { status: 'ok', output: output.data, draftGrammarMatch: test.expected.includes(output.data.grammar) } : { status: 'invalid-schema' };
          }
        }
      }
    } catch { result = { status: 'network-timeout-or-invalid-json' }; }
    const row = { ...test, elapsedMs: Math.round(performance.now() - start), ...result };
    rows.push(row);
    if (result.status === 'http-429' || result.status === 'http-402') break;
  }
  const elapsed = rows.map(row => row.elapsedMs).sort((a, b) => a - b);
  return {
    model, attemptedRequests: rows.length, validResponses: rows.filter(row => row.status === 'ok').length,
    draftGrammarMatches: rows.filter(row => row.draftGrammarMatch).length,
    p95AttemptMs: elapsed[Math.ceil(elapsed.length * .95) - 1],
    rubricStatus: 'draft-not-teacher-reviewed', manualTranslationAndExplanationReviewRequired: true,
    note: 'Direct provider calls; no prepared lookups, retries or paid fallbacks. This smoke test does not establish 95% linguistic quality. Shared account traffic may also consume quota.',
    rows,
  };
}

if (import.meta.main) {
  try {
    const report = await evaluate(process.env.OPENROUTER_API_KEY ?? '', process.env.OPENROUTER_MODEL ?? 'google/gemma-4-26b-a4b-it:free', sampleCount(process.argv.slice(2)));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.validResponses === report.attemptedRequests ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Evaluation failed.');
    process.exitCode = 1;
  }
}
