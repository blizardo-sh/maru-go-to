import type { LearnerSettings } from './types';
export function settingsKey(value:LearnerSettings):string {
 const sort=(value:unknown):unknown=>Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,v])=>[key,sort(v)])):value;
 return JSON.stringify(sort(value));
}
