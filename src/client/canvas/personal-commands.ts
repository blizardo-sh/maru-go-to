import { api, ApiRequestError, json } from '@app/client/api';
import { learningHeaders } from '@app/client/guidedApi';
export type PersonalCommand = { id: string; path: string; method: 'POST' | 'PATCH'; payload: Record<string, unknown>; expectedId: string; publicationId?: string; draftSignature?: string };
const key = (owner: string) => 'japanese-personal-pending:' + owner;
export function personalCommands(owner: string): PersonalCommand[] {
  const commands: unknown = JSON.parse(localStorage.getItem(key(owner)) ?? '[]');
  if (!Array.isArray(commands) || commands.some(command => !command || typeof command.id !== 'string' || typeof command.expectedId !== 'string' || !['POST','PATCH'].includes(command.method) || typeof command.path !== 'string' || !/^\/api\/lists(?:\/[^/?#]+(?:\/words(?:\/[^/?#]+)?)?)?$/.test(command.path) || !command.payload || typeof command.payload !== 'object' || Array.isArray(command.payload))) throw new Error('Не удалось прочитать несохранённые личные данные. Не очищайте данные браузера.');
  return commands;
}
export async function sendPersonal(owner: string, command: PersonalCommand) {
  const queue = personalCommands(owner), prior = queue.find(item => item.id === command.id);
  if (prior && JSON.stringify(prior) !== JSON.stringify(command)) throw new Error('Повторяется первоначальное сохранение.');
  if (!prior) queue.push(command);
  localStorage.setItem(key(owner), JSON.stringify(queue));
  const remove = () => localStorage.setItem(key(owner), JSON.stringify(personalCommands(owner).filter(item => item.id !== command.id)));
  try {
    const saved = await api<{ id: string }>(command.path, { ...json(command.method, command.payload), headers: learningHeaders(owner, command.publicationId) });
    if (saved.id !== command.expectedId) throw new Error('Сервер не подтвердил эти личные данные.');
    remove(); return saved;
  } catch (error) {
    if (error instanceof ApiRequestError && ['VALIDATION','INVALID_LIST','INVALID_READING','LIST_CONFLICT','WORD_CONFLICT'].includes(error.code ?? '')) remove();
    throw error;
  }
}
