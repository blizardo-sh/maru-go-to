import { expect, test } from 'bun:test';
import { invitationSchema, recoverySchema } from '../src/server/validation';

const token = 'isolated-password-policy-fixture-token';
test('invitation and recovery require 8–128 password characters without trimming or changing accepted values', () => {
  for (const [length, accepted] of [[7, false], [8, true], [128, true], [129, false]] as const) {
    const password = 'x'.repeat(length);
    expect(invitationSchema.safeParse({ token, name: 'Password fixture', password }).success).toBe(accepted);
    expect(recoverySchema.safeParse({ token, password }).success).toBe(accepted);
  }
  const password = ' abcd12 ';
  expect(password).toHaveLength(8);
  expect(invitationSchema.parse({ token, name: 'Password fixture', password }).password).toBe(password);
  expect(recoverySchema.parse({ token, password }).password).toBe(password);
});
