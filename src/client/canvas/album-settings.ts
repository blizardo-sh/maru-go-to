import {Graphics} from 'pixi.js';
import {api,ApiRequestError,json} from '@app/client/api';
import {learningHeaders} from '@app/client/guidedApi';
import {settingsKey} from '@app/shared/settings';
import type {LearnerSettings} from '@app/shared/types';
import type {StudyAction,StudySurface} from './study-surface';
import {bookRows} from './album-book';
const pendingKey=(owner:string)=>'japanese-settings-pending:'+owner;
async function digest(settings:LearnerSettings){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(settingsKey(settings))))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
export async function storeSettings(owner:string,value:LearnerSettings,previous:LearnerSettings){
 const saved=localStorage.getItem(pendingKey(owner)),pending=saved?JSON.parse(saved):{value,expected:await digest(previous)};
 if(saved&&settingsKey(pending.value)!==settingsKey(value))throw new Error('Сначала повторите первоначальное сохранение настроек.');
 localStorage.setItem(pendingKey(owner),JSON.stringify(pending));
 try{const result=await api<LearnerSettings>('/api/settings',{...json('PUT',pending.value),headers:{...learningHeaders(owner),'If-Match':pending.expected}});if(settingsKey(result)!==settingsKey(pending.value))throw new Error('Сервер не подтвердил эти настройки.');if(localStorage.getItem(pendingKey(owner))===JSON.stringify(pending))localStorage.removeItem(pendingKey(owner));return result;}
 catch(error){if(error instanceof ApiRequestError&&['SETTINGS_CONFLICT','VALIDATION'].includes(error.code??''))localStorage.removeItem(pendingKey(owner));throw error;}
}
export function pendingSettings(owner:string):{value:LearnerSettings;expected:string}|null{const saved=localStorage.getItem(pendingKey(owner));if(!saved)return null;const pending=JSON.parse(saved);if(!pending.value||typeof pending.value.orthography!=='string'||typeof pending.expected!=='string'||!/^[a-f0-9]{64}$/.test(pending.expected))throw new Error('Несохранённые настройки повреждены. Не очищайте данные браузера.');return pending;}
export const volumeLabels={musicVolume:'Музыка',ambienceVolume:'Окружение',sfxVolume:'Эффекты действий',speechVolume:'Японская озвучка'} as const;
export function renderFullSettings(surface:StudySurface,value:LearnerSettings,state:{offset:number;volume:keyof typeof volumeLabels|null;level:number},options:{safe:(action:StudyAction)=>StudyAction;changed:()=>void;save:(value:LearnerSettings)=>void;home:()=>void;reduced:boolean;scene?:StudyAction;retryMedia?:StudyAction;pending?:LearnerSettings}){
 const a=surface.body;
 if(state.volume){
  const pair=surface.leftPage?surface.pairedPanels(surface.leftPage):null, summary=pair?.left??a, compact=a.height<260;
  const key=state.volume;surface.text(volumeLabels[key],{...summary,y:summary.y+(compact?0:16),height:44},24,false,true);surface.text(Math.round(state.level*100)+'%',{...summary,y:summary.y+(compact?44:78),height:64},40,false,true);
  let chosen=state.level;
  const slider=surface.action(options.safe({id:'volume-range',text:'',bare:true,accessibleLabel:'Громкость '+Math.round(state.level*100)+'%. Выбрать уровень нажатием; точная настройка кнопками ниже.',run:()=>{state.level=chosen;options.changed();}}),{x:a.x,y:a.y+(pair?12:140),width:a.width,height:44});
  slider.addChild(new Graphics().roundRect(8,18,a.width-16,8,4).fill('#d5c5a0').roundRect(8,18,(a.width-16)*state.level,8,4).fill('#304d30').circle(8+(a.width-16)*state.level,22,10).fill('#304d30'));
  slider.on('pointerdown',event=>{chosen=Math.max(0,Math.min(1,Math.round((event.global.x-surface.layout.paper.x-a.x-8)/(a.width-16)*100)/100));});
  surface.row([{id:'volume-down',text:'−1%',run:()=>{state.level=Math.max(0,Math.round(state.level*100-1)/100);options.changed();}},{id:'volume-up',text:'+1%',run:()=>{state.level=Math.min(1,Math.round(state.level*100+1)/100);options.changed();}}].map(options.safe),{x:a.x,y:a.y+(pair?66:194),width:a.width,height:44});
  surface.footer([{id:'volume-back',text:'Назад',fontSize:16,run:()=>{state.volume=null;options.changed();}},{id:'volume-save',text:options.pending?'Повторить':'Сохранить',fontSize:16,run:()=>options.save(options.pending??{...value,[key]:state.level})}].map(options.safe));return;
 }
 const actions:StudyAction[]=[
  ...(options.pending?[{id:'settings-retry',text:'Повторить несохранённые настройки',run:()=>options.save(options.pending!)}]:[]),
  {id:'orthography',text:'Написание: '+({furigana:'с фуриганой',kana:'кана',kanji:'без фуриганы'}[value.orthography]),run:()=>options.save({...value,orthography:value.orthography==='furigana'?'kana':value.orthography==='kana'?'kanji':'furigana'})},
  {id:'motion',text:'Движение: '+((value.animations?'включено':'выключено')+(options.reduced?' · уменьшено системой':'')),run:()=>options.save({...value,animations:!value.animations})},
  {id:'sound',text:'Звуки сцены: '+(value.sceneSoundEnabled?'включены':'выключены'),run:()=>options.save({...value,sceneSoundEnabled:!value.sceneSoundEnabled})},
  ...Object.entries(volumeLabels).map(([key,label])=>({id:'volume:'+key,text:label+' · '+Math.round(value[key as keyof typeof volumeLabels]*100)+'%',run:()=>{state.volume=key as keyof typeof volumeLabels;state.level=value[state.volume];options.changed();}})),
  ...(options.scene?[options.scene]:[]),
  ...(options.retryMedia?[options.retryMedia]:[]),
 ];
 bookRows(surface,'Настройки',actions,state,{safe:options.safe,changed:options.changed,back:options.home});
}
