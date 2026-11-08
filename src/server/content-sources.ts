import type { Course, SourceRef } from '../shared/types';

/** Publication v3 stores provenance once. This is a storage format, never a Course API response. */
export type PooledSources<T> = T extends (infer V)[] ? PooledSources<V>[] : T extends object ? {
  [K in keyof T as K extends 'sourceRefs' ? 'sourceRefIds' : K]: K extends 'sourceRefs' ? number[] : PooledSources<T[K]>
} : T;
export interface SourcePool { course: PooledSources<Course>; sourceRefs: SourceRef[] }

// Keep the historical canonicalization unchanged: v1/v2 IDs depend on it.
export const canonical = (value: unknown): string => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.entries(value).filter(([,entry]) => entry !== undefined).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([key,entry]) => JSON.stringify(key) + ':' + canonical(entry)).join(',') + '}' : JSON.stringify(value);
function fail(): never { throw new Error('Invalid content source dictionary.'); }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 20000;
const maxSources = 20000, maxReferences = 100000, maxDepth = 64;
function checkSource(value: unknown): asserts value is SourceRef {
  if (!record(value) || !['katsudoo','rikai','combined'].includes(value.part as string) || !text(value.url) ||
      Object.keys(value).some(key => !['part','url','label','page','row','entry'].includes(key)) ||
      ['label','entry'].some(key => value[key] !== undefined && !text(value[key])) ||
      ['page','row'].some(key => value[key] !== undefined && (!Number.isSafeInteger(value[key]) || (value[key] as number) < 1))) fail();
}

export function poolSources(course: Course): SourcePool {
  const sourceRefs: SourceRef[] = [], ids = new Map<string, number>();
  let references = 0;
  function visit(value: unknown, depth = 0): unknown {
    if (depth > maxDepth) fail();
    if (Array.isArray(value)) return value.map(entry => visit(entry, depth + 1));
    if (!record(value)) return value;
    if ('sourceRefIds' in value) fail();
    // Sorted traversal makes dictionary indices independent of JSONB object key order.
    return Object.fromEntries(Object.keys(value).sort().map(key => {
      if (key !== 'sourceRefs') return [key, visit(value[key], depth + 1)];
      const refs = value[key];
      if (!Array.isArray(refs) || (references += refs.length) > maxReferences) fail();
      return ['sourceRefIds', refs.map(ref => {
        checkSource(ref); const key = canonical(ref);
        let id = ids.get(key);
        if (id === undefined) { id = sourceRefs.length; if (id >= maxSources) fail(); ids.set(key, id); sourceRefs.push(structuredClone(ref)); }
        return id;
      })];
    }));
  }
  return { course: visit(course) as PooledSources<Course>, sourceRefs };
}

export function expandSources(pool: SourcePool): Course {
  if (!Array.isArray(pool.sourceRefs) || pool.sourceRefs.length > maxSources) fail();
  const keys = new Set<string>();
  for (const source of pool.sourceRefs) { checkSource(source); const key = canonical(source); if (keys.has(key)) fail(); keys.add(key); }
  let references = 0;
  function visit(value: unknown, depth = 0): unknown {
    if (depth > maxDepth) fail();
    if (Array.isArray(value)) return value.map(entry => visit(entry, depth + 1));
    if (!record(value)) return value;
    if ('sourceRefs' in value) fail();
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
      if (key !== 'sourceRefIds') return [key, visit(entry, depth + 1)];
      if (!Array.isArray(entry) || (references += entry.length) > maxReferences) fail();
      return ['sourceRefs', entry.map(id => {
        if (!Number.isSafeInteger(id) || id < 0 || id >= pool.sourceRefs.length) fail();
        // Separate copies retain the old mutation semantics of individual records.
        return { ...pool.sourceRefs[id]! };
      })];
    }));
  }
  return visit(pool.course) as Course;
}

export function rejectPooledSources(value: unknown, depth = 0): void {
  if (depth > maxDepth) fail();
  if (Array.isArray(value)) for (const entry of value) rejectPooledSources(entry, depth + 1);
  else if (record(value)) {
    if ('sourceRefIds' in value) fail();
    for (const entry of Object.values(value)) rejectPooledSources(entry, depth + 1);
  }
}
