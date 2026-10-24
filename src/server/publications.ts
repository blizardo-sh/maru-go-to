import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { Course } from '../shared/types';
import { validateCourse } from '../shared/course';
import { learningParts, validateLearning } from '../shared/learning';
import { validateCatalog } from '../shared/catalog';
import { learningWordChoices } from '../shared/learningChoices';
import type { Database } from './db';
import { ReviewError } from './reviews';

export interface ContentAsset { path: string; sha256: string; bytes: number }
export interface ContentBundle { formatVersion: 1; course: Course; assets: ContentAsset[] }
const canonical = (value: unknown): string => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.entries(value).filter(([,entry]) => entry !== undefined).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([key,entry]) => JSON.stringify(key) + ':' + canonical(entry)).join(',') + '}' : JSON.stringify(value);
export const contentId = (bundle: ContentBundle) => createHash('sha256').update(canonical(bundle)).digest('hex');
export const defaultMediaRoot = () => process.env.CONTENT_MEDIA_ROOT ?? new URL('../../public', import.meta.url).pathname;
const publicRoot = new URL('../../public', import.meta.url).pathname;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const idPattern = /^[a-f0-9]{64}$/;
// The leading slash is an URL path, never an absolute filesystem argument.
const safePath = (path: string) => /^\/(audio|word-illustrations|counters)\/[a-zA-Z0-9/_.-]+\.(m4a|mp3|ogg|wav|png|webp|jpg|jpeg|svg|avif)$/.test(path) && path.slice(1).split('/').every(part => part && part !== '.' && part !== '..');
export function validateContentBundle(value: unknown, mediaRoot?: string): asserts value is ContentBundle {
 const bundle = value as ContentBundle;
 if (!bundle || bundle.formatVersion !== 1 || !bundle.course || !Array.isArray(bundle.assets) || bundle.assets.length > 20000 || bundle.course.publicationId !== undefined || !Array.isArray(bundle.course.words) || bundle.course.words.some(word => !word.lessonIds.length)) throw new Error('Invalid content bundle.');
 validateCourse(bundle.course); validateLearning(bundle.course, bundle.course.learning ?? [], true); validateCatalog(bundle.course);
 for (const route of bundle.course.learning ?? []) for (const step of learningParts(route).flat()) if (step.kind === 'word-practice') learningWordChoices(bundle.course, route, step);
 const paths = new Set<string>(); let total = 0;
 for (const asset of bundle.assets) {
  if (!asset || typeof asset.path !== 'string' || !safePath(asset.path) || paths.has(asset.path) || !idPattern.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > 100 * 1024 * 1024) throw new Error('Invalid content asset.');
  paths.add(asset.path); total += asset.bytes;
  if (total > 500 * 1024 * 1024) throw new Error('Content media exceeds the package limit.');
  if (mediaRoot !== undefined) {
   const root = realpathSync(mediaRoot), file = join(root, asset.path.slice(1));
   if (!existsSync(file) || !lstatSync(file).isFile() || !realpathSync(file).startsWith(root + sep) || lstatSync(file).isSymbolicLink()) throw new Error(`Missing or unsafe content asset: ${asset.path}`);
   const bytes = readFileSync(file);
   if (bytes.byteLength !== asset.bytes || digest(bytes) !== asset.sha256) throw new Error(`Changed content asset: ${asset.path}`);
  }
 }
 const referenced = (value: unknown): void => {
  if (typeof value === 'string' && /^\/(audio|word-illustrations|counters)\//.test(value) && (!safePath(value) || !paths.has(value))) throw new Error(`Unlisted content asset: ${value}`);
  if (Array.isArray(value)) value.forEach(referenced);
  else if (value && typeof value === 'object') for (const [key,entry] of Object.entries(value)) {
   if ((key === 'audioUrl' || key === 'src') && typeof entry === 'string' && (!safePath(entry) || !paths.has(entry))) throw new Error(`Unlisted content asset: ${entry}`);
   referenced(entry);
  }
 };
 referenced(bundle.course);
}
export function packContent(course: Course, mediaRoot = publicRoot): ContentBundle {
 const assets: ContentAsset[] = [];
 const scan = (directory: string) => {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
   const file = join(directory, entry.name); if (entry.isSymbolicLink()) throw new Error('Symlink in authored media.');
   if (entry.isDirectory()) scan(file);
   else if (entry.isFile()) { const path = '/' + file.slice(resolve(mediaRoot).length + 1).split(sep).join('/'); if (safePath(path)) { const bytes = readFileSync(file); assets.push({ path, bytes: bytes.length, sha256: digest(bytes) }); } }
  }
 };
 for (const prefix of ['audio', 'word-illustrations', 'counters']) scan(join(resolve(mediaRoot), prefix));
 const copied = structuredClone(course); delete copied.publicationId; delete copied.media;
 const bundle: ContentBundle = { formatVersion: 1, course: copied, assets: assets.sort((a,b) => a.path.localeCompare(b.path)) };
 validateContentBundle(bundle, mediaRoot); return bundle;
}
const caches = new WeakMap<Database, Map<string, Course>>();
export async function getPublication(database: Database, id: string): Promise<Course> {
 if (!idPattern.test(id)) throw new ReviewError('INVALID_PUBLICATION', 'Некорректная версия учебника.');
 let cache = caches.get(database); if (!cache) { cache = new Map(); caches.set(database, cache); }
 const cached = cache.get(id); if (cached) return cached;
 const [row] = await database.sql`select bundle from content_publications where id=${id}`;
 if (!row) throw new ReviewError('PUBLICATION_NOT_FOUND', 'Версия учебника недоступна. Обновите страницу.', 409);
 const bundle = row.bundle as ContentBundle; validateContentBundle(bundle);
 if (contentId(bundle) !== id) throw new Error('Stored content digest does not match its ID.');
 const course = { ...bundle.course, publicationId: id, media: bundle.assets.map(asset => asset.path) };
 cache.set(id, course); if (cache.size > 8) cache.delete(cache.keys().next().value!); return course;
}
export async function currentPublication(database: Database): Promise<Course> {
 const [row] = await database.sql`select publication_id from content_active where singleton=1`;
 if (!row) throw new ReviewError('NO_PUBLICATION', 'Учебник ещё не опубликован.', 409);
 return getPublication(database, row.publication_id);
}
export async function legacyPublication(database: Database): Promise<Course> {
 const [row] = await database.sql`select id from content_publications where legacy=true`;
 return row ? getPublication(database, row.id) : currentPublication(database);
}
export async function publishContent(database: Database, bundle: ContentBundle, options: { mediaRoot: string; activate?: boolean }): Promise<{ id: string }> {
 validateContentBundle(bundle, options.mediaRoot); const id = contentId(bundle);
 await database.sql.begin(async tx => {
  await tx`select pg_advisory_xact_lock(hashtext('content-publication'))`;
  await tx`insert into content_publications(id,format_version,bundle) values(${id},1,${bundle}) on conflict(id) do nothing`;
  if (options.activate !== false) await tx`insert into content_active(singleton,publication_id) values(1,${id}) on conflict(singleton) do update set publication_id=excluded.publication_id,updated_at=now()`;
 }); return { id };
}
export async function activatePublication(database: Database, id: string, mediaRoot=defaultMediaRoot()): Promise<void> {
 await getPublication(database, id);
 const [row] = await database.sql`select bundle,bundled from content_publications where id=${id}`;
 // Only bootstrap snapshots may use files baked into the app image.
 const root = row!.bundled && row!.bundle.assets.some((asset:ContentAsset) => !existsSync(join(mediaRoot,asset.path.slice(1)))) ? publicRoot : mediaRoot;
 validateContentBundle(row!.bundle,root);
 await database.sql.begin(async tx => {
  await tx`select pg_advisory_xact_lock(hashtext('content-publication'))`;
  await tx`insert into content_active(singleton,publication_id) values(1,${id}) on conflict(singleton) do update set publication_id=excluded.publication_id,updated_at=now()`;
 });
}
export async function ensureInitialPublications(database: Database, initial: ContentBundle, legacy: ContentBundle): Promise<void> {
 validateContentBundle(initial, publicRoot); validateContentBundle(legacy, publicRoot);
 const initialId = contentId(initial), legacyId = contentId(legacy);
 await database.sql.begin(async tx => {
  await tx`select pg_advisory_xact_lock(hashtext('content-publication'))`;
  const [existing] = await tx`select id from content_publications where legacy=true`;
  if (!existing) await tx`insert into content_publications(id,format_version,bundle,legacy,bundled) values(${legacyId},1,${legacy},true,true) on conflict(id) do update set legacy=true,bundled=true`;
  await tx`insert into content_publications(id,format_version,bundle,bundled) values(${initialId},1,${initial},true) on conflict(id) do update set bundled=true`;
  await tx`insert into content_active(singleton,publication_id) values(1,${initialId}) on conflict(singleton) do nothing`;
 });
}
