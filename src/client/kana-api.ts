import { api, json } from './api';
import type { KanaOverview, KanaResult, KanaSubmission, KanaScript, KanaDirection } from '../shared/kana-study';
const prefix = (owner: string) => `japanese-kana-fsrs-pending:${owner}:`;
export function pendingKanaReviews(owner: string): KanaSubmission[] {
 const values: KanaSubmission[] = [];
 for (let i=0;i<localStorage.length;i++) {
  const key=localStorage.key(i); if (!key?.startsWith(prefix(owner))) continue;
  const value=JSON.parse(localStorage.getItem(key)!);
  if (!value || typeof value.attemptId!=='string' || typeof value.glyph!=='string' || !Number.isInteger(value.version)) throw new Error('Не удалось прочитать несохранённый ответ каны. Не очищайте данные браузера.');
  values.push(value);
 }
 return values;
}
export const loadKana = (owner: string, script: KanaScript, direction: KanaDirection, due = false) => api<KanaOverview>(`/api/kana?${new URLSearchParams({script,direction,due:String(due)})}`, {headers:{'X-Learning-Learner-Id':owner}});
export async function saveKanaReview(owner: string, input: KanaSubmission) {
 const key=prefix(owner)+input.attemptId, serialized=JSON.stringify(input), existing=localStorage.getItem(key);
 if(existing&&existing!==serialized)throw new Error('Сохраняется первоначальный ответ каны.');
 localStorage.setItem(key,serialized);
 const result=await api<KanaResult>('/api/kana/reviews',{...json('POST',input),headers:{'X-Learning-Learner-Id':owner}});
 if(result.attemptId!==input.attemptId||result.item.glyph!==input.glyph||result.item.script!==input.script||result.item.direction!==input.direction||!Number.isInteger(result.item.version))throw new Error('Сервер не подтвердил ответ каны. Повторите сохранение.');
 localStorage.removeItem(key);return result;
}
export function discardKanaConflict(owner:string,input:KanaSubmission) { localStorage.removeItem(prefix(owner)+input.attemptId); }
