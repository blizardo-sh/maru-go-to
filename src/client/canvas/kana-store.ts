export type KanaDirection = 'sign-reading' | 'reading-sign';
export type KanaScript = 'hiragana' | 'katakana';
export type KanaAttempt = { attemptId: string; sessionId: string; turn: number; script: KanaScript; glyph: string; direction: KanaDirection; choice: string; correct: boolean };
export type KanaStat = { key: string; owner: string; script: KanaScript; glyph: string; direction: KanaDirection; attempts: number; errors: number; lastAt: string };
export class KanaConflict extends Error {}
type KanaReceipt = { attemptId: string; sessionId: string; turn: number };
type StoredSession = { id: string; owner: string; turn: number; last?: { payload: KanaAttempt; receipt: KanaReceipt } };
const request = <T>(value: IDBRequest<T>) => new Promise<T>((resolve,reject)=>{value.onsuccess=()=>resolve(value.result);value.onerror=()=>reject(value.error);});
const complete = (transaction: IDBTransaction) => new Promise<void>((resolve,reject)=>{transaction.oncomplete=()=>resolve();transaction.onabort=()=>reject(transaction.error??new Error('Хранилище каны отменило сохранение.'));transaction.onerror=()=>{};});
async function open() {
  const opening=indexedDB.open('japanese-kana-v1',1);
  opening.onupgradeneeded=()=>{const db=opening.result;const stats=db.createObjectStore('stats',{keyPath:'key'});stats.createIndex('owner','owner');db.createObjectStore('sessions',{keyPath:'id'});};
  const db=await request(opening);db.onversionchange=()=>db.close();return db;
}
export async function startKanaSession(owner:string) {
  const db=await open();try{const tx=db.transaction('sessions','readwrite'),done=complete(tx),id=crypto.randomUUID();tx.objectStore('sessions').add({id,owner,turn:0} satisfies StoredSession);await done;return id;}finally{db.close();}
}
export async function kanaStats(owner:string):Promise<KanaStat[]> {
  const db=await open();try{const tx=db.transaction('stats','readonly'),done=complete(tx),stats=await request<KanaStat[]>(tx.objectStore('stats').index('owner').getAll(owner));await done;return stats;}finally{db.close();}
}
export async function commitKana(owner:string,payload:KanaAttempt):Promise<KanaReceipt> {
  const db=await open();try{
    const tx=db.transaction(['sessions','stats'],'readwrite',{durability:'strict'}),done=complete(tx),sessions=tx.objectStore('sessions'),stats=tx.objectStore('stats');
    // Both tabs serialize on the session turn and update the counter in the same transaction.
    const session=await request<StoredSession|undefined>(sessions.get(payload.sessionId));
    const fail=async(message:string,conflict=false):Promise<never>=>{tx.abort();await done.catch(()=>{});throw conflict?new KanaConflict(message):new Error(message);};
    if(!session||session.owner!==owner)return fail('Занятие каны принадлежит другой учётной записи или недоступно.',true);
    if(session.last?.payload.attemptId===payload.attemptId){if(JSON.stringify(session.last.payload)!==JSON.stringify(payload))return fail('Повторяется первоначальная попытка каны.');await done;return session.last.receipt;}
    if(session.turn!==payload.turn)return fail('Этот шаг каны уже изменён в другой вкладке. Начните новое занятие; статистика сохранена.',true);
    const key=JSON.stringify([owner,payload.script,payload.glyph,payload.direction]);
    const previous=await request<KanaStat|undefined>(stats.get(key));
    const stat:KanaStat={key,owner,script:payload.script,glyph:payload.glyph,direction:payload.direction,attempts:(previous?.attempts??0)+1,errors:(previous?.errors??0)+Number(!payload.correct),lastAt:new Date().toISOString()};
    const receipt={attemptId:payload.attemptId,sessionId:payload.sessionId,turn:payload.turn+1};
    stats.put(stat);sessions.put({...session,turn:receipt.turn,last:{payload,receipt}});await done;return receipt;
  }finally{db.close();}
}
const pendingKey=(owner:string)=>'japanese-kana-pending:'+owner;
export function pendingKana(owner:string):KanaAttempt|null {
  const value=localStorage.getItem(pendingKey(owner));if(!value)return null;const payload=JSON.parse(value);
  if(!payload||typeof payload.attemptId!=='string'||typeof payload.sessionId!=='string'||!Number.isInteger(payload.turn)||payload.turn<0||!['hiragana','katakana'].includes(payload.script)||!['sign-reading','reading-sign'].includes(payload.direction)||typeof payload.glyph!=='string'||typeof payload.choice!=='string'||typeof payload.correct!=='boolean')throw new Error('Несохранённая попытка каны повреждена. Не очищайте данные браузера.');return payload;
}
export async function saveKana(owner:string,payload:KanaAttempt) {
  const previous=pendingKana(owner);if(previous&&JSON.stringify(previous)!==JSON.stringify(payload))throw new Error('Сначала сохраните первоначальный ответ каны.');
  localStorage.setItem(pendingKey(owner),JSON.stringify(payload));
  let receipt:KanaReceipt;
  try{receipt=await commitKana(owner,payload);}catch(error){
    // A rejected session turn cannot be delivered later. Keep ambiguous storage failures pending.
    if(error instanceof KanaConflict&&localStorage.getItem(pendingKey(owner))===JSON.stringify(payload))localStorage.removeItem(pendingKey(owner));
    throw error;
  }
  if(receipt.attemptId!==payload.attemptId||receipt.sessionId!==payload.sessionId||receipt.turn!==payload.turn+1)throw new Error('Хранилище не подтвердило попытку каны.');
  if(localStorage.getItem(pendingKey(owner))===JSON.stringify(payload))localStorage.removeItem(pendingKey(owner));return receipt;
}
