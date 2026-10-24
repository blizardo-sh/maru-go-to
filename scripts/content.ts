import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { loadCourse } from '../src/server/course';
import { connectDatabase } from '../src/server/db';
import { activatePublication, contentId, defaultMediaRoot, packContent, publishContent, validateContentBundle, validatePublicationMedia } from '../src/server/publications';

const [command, file] = process.argv.slice(2);
if (command === 'pack') {
  if (!file) throw new Error('Usage: bun scripts/content.ts pack bundle.json');
  const bundle = packContent(loadCourse());
  writeFileSync(file, JSON.stringify(bundle));
  console.info(JSON.stringify({ id: contentId(bundle), assets: bundle.assets.length, file }));
} else if (command === 'verify-media' || command === 'verify-publication' || command === 'publish') {
  if (!file || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink() || lstatSync(file).size > 12 * 1024 * 1024) throw new Error('Expected a regular content bundle, at most 12 MiB.');
  const bundle: unknown = JSON.parse(readFileSync(file, 'utf8'));
  validateContentBundle(bundle, defaultMediaRoot());
  if (command === 'verify-media') console.info(JSON.stringify({ id: contentId(bundle), assets: bundle.assets.length }));
  else {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
    const database = connectDatabase(process.env.DATABASE_URL);
    try {
      if (command === 'verify-publication') { await validatePublicationMedia(database.sql, bundle); console.info(JSON.stringify({ id: contentId(bundle), assets: bundle.assets.length })); }
      else console.info(JSON.stringify(await publishContent(database, bundle, { mediaRoot: defaultMediaRoot() })));
    }
    finally { await database.sql.close(); }
  }
} else if (command === 'rollback' && file) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const database = connectDatabase(process.env.DATABASE_URL);
  try { await activatePublication(database, file); console.info(JSON.stringify({ id: file })); }
  finally { await database.sql.close(); }
} else throw new Error('Usage: content.ts pack <bundle.json> | verify-media <bundle.json> | verify-publication <bundle.json> | publish <bundle.json> | rollback <publication-id>');
