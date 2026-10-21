import { expect, test } from 'bun:test';
import { defaultSettings } from '../src/server/material';
import { settingsSchema } from '../src/server/validation';
import { defaultSoundSettings } from '../src/shared/sound';

test('old JSON settings receive sound defaults while keeping the learner material and limits', () => {
  const { sceneSoundEnabled, musicVolume, ambienceVolume, sfxVolume, speechVolume, ...legacy } = structuredClone(defaultSettings);
  legacy.lessonStatuses = { 'lesson-one': 'completed' }; legacy.newWordsPerDay = 8;
  const parsed = settingsSchema.parse(legacy);
  expect(parsed).toMatchObject({ ...defaultSoundSettings, lessonStatuses: legacy.lessonStatuses, newWordsPerDay: 8 });
  expect(parsed.freeScopes).toEqual(legacy.freeScopes);
});

test('scene mute and volumes stay independent from Japanese speech and other learners', () => {
  const learnerA = settingsSchema.parse({ ...structuredClone(defaultSettings), sceneSoundEnabled: false, musicVolume: 0, ambienceVolume: .3, sfxVolume: .6, speechVolume: .9 });
  const learnerB = settingsSchema.parse(structuredClone(defaultSettings));
  expect(learnerA).toMatchObject({ sceneSoundEnabled: false, musicVolume: 0, ambienceVolume: .3, sfxVolume: .6, speechVolume: .9 });
  expect(learnerB).toMatchObject(defaultSoundSettings);
  expect(defaultSettings).toMatchObject(defaultSoundSettings);
});

test('sound preferences reject out of range and malformed values at the API boundary', () => {
  for (const key of ['musicVolume', 'ambienceVolume', 'sfxVolume', 'speechVolume']) for (const value of [-.1, 1.01, NaN, Infinity, '0.5', null]) expect(settingsSchema.safeParse({ ...defaultSettings, [key]: value }).success).toBe(false);
  expect(settingsSchema.safeParse({ ...defaultSettings, sceneSoundEnabled: 'false' }).success).toBe(false);
  expect(settingsSchema.safeParse({ ...defaultSettings, musicVolume: 0, ambienceVolume: 1, sfxVolume: 0, speechVolume: 1 }).success).toBe(true);
});

test.skipIf(!process.env.JAPANESE_INTEGRATION_DATABASE_URL)('legacy JSONB preferences merge defaults and sound preferences persist separately per learner', async () => {
  const url = process.env.JAPANESE_INTEGRATION_DATABASE_URL!; const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/japanese_app_test') throw new Error('Sound settings test requires disposable localhost /japanese_app_test.');
  const { connectDatabase } = await import('../src/server/db'); const { settingsFor } = await import('../src/server/material');
  const database = connectDatabase(url); const ids = [crypto.randomUUID(), crypto.randomUUID()];
  try {
    for (const id of ids) await database.sql`insert into users (id,name,email) values (${id},${'Sound fixture'},${`sound-${id}@example.test`})`;
    const { sceneSoundEnabled, musicVolume, ambienceVolume, sfxVolume, speechVolume, ...legacy } = structuredClone(defaultSettings);
    legacy.newWordsPerDay = 7;
    await database.sql`insert into preferences(user_id,settings) values(${ids[0]!},${legacy})`;
    expect(await settingsFor(database, ids[0]!)).toMatchObject({ ...defaultSoundSettings, newWordsPerDay: 7 });
    const saved = settingsSchema.parse({ ...legacy, sceneSoundEnabled: false, musicVolume: .08, ambienceVolume: .22, sfxVolume: 0, speechVolume: .65 });
    await database.sql`update preferences set settings=${saved} where user_id=${ids[0]!}`;
    expect(await settingsFor(database, ids[0]!)).toMatchObject({ sceneSoundEnabled: false, musicVolume: .08, ambienceVolume: .22, sfxVolume: 0, speechVolume: .65, newWordsPerDay: 7 });
    expect(await settingsFor(database, ids[1]!)).toEqual(defaultSettings);
    expect(defaultSettings).toMatchObject(defaultSoundSettings);
  } finally { for (const id of ids) await database.sql`delete from users where id=${id}`; await database.sql.close(); }
});
