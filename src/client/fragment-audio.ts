import recordings from '../../materials/fragment-audio.json';
import type { Course } from '../shared/types';
import type { WorkspaceToken } from './workspace';

export function fragmentAudio(course: Course, token: WorkspaceToken): string | undefined {
 const word=course.words.find(word=>word.id===token.wordId);
 const form=token.formId?course.forms.find(form=>form.id===token.formId&&form.wordId===token.wordId):undefined;
 if(!word || token.formId&&!form)return;
 if((!form || form.kana===word.kana)&&word.audioUrl)return word.audioUrl;
 return (recordings as Record<string,string>)[(form?.kana??word.audioText??word.kana).trim()];
}
