import { api, ApiRequestError, json } from '@app/client/api';
import { learningHeaders } from '@app/client/guidedApi';
import type { InvitationAcceptResult, InvitationDetails, RegistrationLink, RegistrationLinkCreateResult } from '@app/shared/types';
import type { Rect } from './canvas';
import type { StudyAction, StudySurface } from './study-surface';
import { bookRows } from './album-book';

export class AccessFlow {
  mode:'invite'|'recover'|null=location.pathname==='/invite'?'invite':location.pathname==='/recover'?'recover':null;
  token=new URLSearchParams(location.hash.slice(1)).get('token')??'';
  invitation:InvitationDetails|null=null;
  busy=false;error='';complete='';email='';name='';
  private epoch=0;
  constructor(private changed:()=>void){}
  get revision(){return this.epoch;}
  locationChanged(){this.epoch++;this.mode=location.pathname==='/invite'?'invite':location.pathname==='/recover'?'recover':null;this.token=new URLSearchParams(location.hash.slice(1)).get('token')??'';this.invitation=null;this.error='';this.complete='';this.email='';this.name='';this.busy=false;this.changed();}
  async load(){
    if(!this.mode||this.mode==='recover')return;if(!this.token){this.error='В ссылке нет токена. Попросите новую ссылку у администратора.';this.changed();return;}
    const epoch=this.epoch,token=this.token;this.busy=true;this.error='';this.changed();
    try{const invitation=await api<InvitationDetails>('/api/invitations/details',json('POST',{token}));if(epoch!==this.epoch)return;this.invitation=invitation;if(invitation.kind==='invite')this.email=invitation.email;}
    catch(error){if(epoch===this.epoch)this.error=error instanceof Error?error.message:'Ссылка недоступна.';}finally{if(epoch===this.epoch){this.busy=false;this.changed();}}
  }
  async submit(password:string):Promise<InvitationAcceptResult|null>{
    if(this.busy||document.hidden)return null;
    if(!this.token){this.error='В ссылке нет токена. Попросите новую ссылку.';this.changed();return null;}
    if(password.length<8||password.length>128){this.error='Пароль должен содержать от 8 до 128 символов.';this.changed();return null;}
    if(this.mode==='invite'&&(!this.invitation||!this.name.trim())){this.error='Проверьте ссылку и укажите имя.';this.changed();return null;}
    const epoch=this.epoch,token=this.token,mode=this.mode;this.busy=true;this.error='';this.changed();
    try{
      let result:InvitationAcceptResult|null=null;
      if(mode==='recover'){await api('/api/recovery/complete',json('POST',{token,password}));if(epoch!==this.epoch)return null;this.complete='Пароль изменён. Войдите с новым паролем.';}
      else{result=await api<InvitationAcceptResult>('/api/invitations/accept',json('POST',{token,name:this.name.trim(),password,...(this.invitation!.kind==='registration'?{email:this.email.trim().toLowerCase()}:{})}));if(epoch!==this.epoch)return null;this.email=result.email;this.complete='Аккаунт создан. Войдите с вашим email и паролем. Повторная регистрация не нужна.';}
      history.replaceState(null,'',mode==='recover'?'/recover':'/invite');this.token='';return result;
    }catch(error){if(epoch===this.epoch)this.error=error instanceof Error?error.message:'Не удалось подтвердить действие. Проверьте соединение.';return null;}
    finally{if(epoch===this.epoch){this.busy=false;this.changed();}}
  }
  login(){this.epoch++;this.mode=null;this.token='';this.error='';this.complete='';history.replaceState(null,'','/album.html');this.changed();}
}

export class AdminAccess {
  owner='';busy=false;error='';links:RegistrationLink[]=[];users:{id:string;name:string;email:string}[]=[];
  screen:'menu'|'personal'|'registration'|'links'|'users'|'created'='menu';kind:'invite'|'recovery'='invite';email='';limit='5';duration='7';unit:'minutes'|'hours'|'days'='days';limited=true;timed=true;created='';expires='';offset=0;
  private epoch=0;
  constructor(private changed:()=>void){}
  clear(){this.epoch++;this.owner='';this.busy=false;this.error='';this.links=[];this.users=[];this.created='';this.email='';this.screen='menu';this.offset=0;}
  async load(owner:string){if(this.owner!==owner){this.clear();this.owner=owner;}try{if(localStorage.getItem('japanese-admin-pending:'+owner)){await this.create();if(this.error)return;}}catch{this.error='Хранилище запросов доступа недоступно.';this.changed();return;}const epoch=this.epoch;this.busy=true;this.error='';this.changed();try{const [links,users]=await Promise.all([api<{links:RegistrationLink[]}>('/api/admin/registration-links',{headers:learningHeaders(owner)}),api<{users:AdminAccess['users']}>('/api/admin/users',{headers:learningHeaders(owner)})]);if(epoch===this.epoch){this.links=links.links;this.users=users.users;}}catch(error){if(epoch===this.epoch)this.error=error instanceof Error?error.message:'Доступ администратора недоступен.';}finally{if(epoch===this.epoch){this.busy=false;this.changed();}}}
  async create(){
    if(this.busy||document.hidden)return;const owner=this.owner,epoch=this.epoch,key='japanese-admin-pending:'+owner;this.busy=true;this.error='';this.changed();
    try{
      const raw=localStorage.getItem(key);let pending:{id:string;path:string;payload:Record<string,unknown>};
      if(raw){pending=JSON.parse(raw);if(!pending||typeof pending.id!=='string'||!['/api/admin/links','/api/admin/registration-links'].includes(pending.path)||!pending.payload||typeof pending.payload!=='object')throw new Error('Первоначальный запрос доступа повреждён. Не очищайте данные браузера.');}
      else if(this.screen==='personal')pending={id:crypto.randomUUID(),path:'/api/admin/links',payload:{kind:this.kind,email:this.email.trim().toLowerCase()}};
      else{const count=Number(this.limit),duration=Number(this.duration),expires=new Date(Date.now()+duration*({minutes:60000,hours:3600000,days:86400000}[this.unit]));if(!this.limited&&!this.timed||this.limited&&(!Number.isSafeInteger(count)||count<1||count>2147483647)||this.timed&&(!Number.isSafeInteger(duration)||duration<1||!Number.isFinite(expires.getTime())))throw new Error('Оставьте хотя бы одно ограничение и укажите положительные целые значения.');pending={id:crypto.randomUUID(),path:'/api/admin/registration-links',payload:{registrationLimit:this.limited?count:null,expiresAt:this.timed?expires.toISOString():null}};}
      localStorage.setItem(key,JSON.stringify(pending));
      const result=await api<{url:string;expiresAt?:string;link?:RegistrationLink}>(pending.path,{...json('POST',pending.payload),headers:{...learningHeaders(owner),'Idempotency-Key':pending.id}});
      const url=new URL(result.url);if(url.origin!==location.origin||!['/invite','/recover'].includes(url.pathname)||!url.hash.startsWith('#token=')||result.link&&result.link.id!==pending.id)throw new Error('Сервер не подтвердил созданную ссылку. Повторите первоначальный запрос.');
      if(localStorage.getItem(key)===JSON.stringify(pending))localStorage.removeItem(key);
      if(epoch===this.epoch){this.created=result.url;this.expires=result.expiresAt??result.link?.expiresAt??'';if(result.link)this.links=[result.link,...this.links.filter(link=>link.id!==result.link!.id)];this.screen='created';}
    }catch(error){if(error instanceof ApiRequestError&&['VALIDATION','NOT_FOUND','COMMAND_CONFLICT'].includes(error.code??''))localStorage.removeItem(key);if(epoch===this.epoch)this.error=error instanceof Error?error.message:'Не удалось создать ссылку. Повторите первоначальное сохранение.';}finally{if(epoch===this.epoch){this.busy=false;this.changed();}}
  }
  async revoke(id:string){if(this.busy||document.hidden)return;const owner=this.owner,epoch=this.epoch;this.busy=true;this.error='';this.changed();try{const result=await api<{link:RegistrationLink}>(`/api/admin/registration-links/${encodeURIComponent(id)}/revoke`,{...json('POST',{}),headers:learningHeaders(owner)});if(epoch===this.epoch)this.links=this.links.map(link=>link.id===id?result.link:link);}catch(error){if(epoch===this.epoch)this.error=error instanceof Error?error.message:'Не удалось отозвать ссылку.';}finally{if(epoch===this.epoch){this.busy=false;this.changed();}}}
}

export function renderAdminAccess(surface:StudySurface,admin:AdminAccess,options:{safe:(action:StudyAction)=>StudyAction;changed:()=>void;home:()=>void;prompt?:Rect;field:(id:string,rect:Rect,value:string,label:string,changed:(value:string)=>void,readOnly?:boolean)=>void}){
 const a=surface.body,summary=options.prompt?surface.pairedPanels(options.prompt).left:a,footer=(actions:StudyAction[])=>surface.footer(actions.map(action=>options.safe({...action,fontSize:16})));
 const back=()=>{admin.screen='menu';admin.created='';admin.error='';admin.offset=0;options.changed();};
 if(admin.error){surface.text(admin.error,a,18);footer([{id:'admin-error-back',text:'Вернуться',run:back},{id:'admin-refresh',text:'Повторить',run:()=>void admin.load(admin.owner)}]);return;}
 if(admin.screen==='created'){
  surface.text('Скопируйте ссылку сейчас. Полный адрес не хранится в списке выданных ссылок.',{...summary,height:summary.height},18);
  options.field('admin-url',{...a,y:a.y+(options.prompt?12:94),height:options.prompt?88:110},admin.created,'Созданная ссылка',()=>{},true);
  if(admin.expires)surface.text('Действует до '+new Date(admin.expires).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}),{...a,y:a.y+(options.prompt?108:216),height:64},16);
  footer([{id:'admin-created-back',text:'К доступу',run:back},{id:'admin-copy',text:'Скопировать',run:()=>{void navigator.clipboard.writeText(admin.created).catch(()=>{admin.error='Копирование недоступно. Выделите адрес в поле и скопируйте вручную.';options.changed();});}}]);return;
 }
 if(admin.screen==='personal'){
  surface.text('Персональная ссылка',{...summary,height:48},20);
  surface.action(options.safe({id:'admin-kind',text:admin.kind==='invite'?'Приглашение':'Восстановление пароля',run:()=>{admin.kind=admin.kind==='invite'?'recovery':'invite';options.changed();}}),{...summary,y:summary.y+54,height:44},false,17);
  options.field('admin-email',{...a,y:a.y+(options.prompt?12:110),height:48},admin.email,'Email ученика',value=>{admin.email=value;});footer([{id:'admin-personal-back',text:'Назад',run:back},{id:'admin-create',text:'Создать',run:()=>void admin.create()}]);return;
 }
 if(admin.screen==='registration'){
  const actions:StudyAction[]=[{id:'admin-limited',text:'Регистрации: '+(admin.limited?'ограничено':'без ограничения'),run:()=>{admin.limited=!admin.limited;options.changed();}},{id:'admin-timed',text:'Срок: '+(admin.timed?'ограничен':'без ограничения'),run:()=>{admin.timed=!admin.timed;options.changed();}},{id:'admin-unit',text:'Единица срока: '+({minutes:'минуты',hours:'часы',days:'дни'}[admin.unit]),run:()=>{admin.unit=admin.unit==='days'?'hours':admin.unit==='hours'?'minutes':'days';options.changed();}}];
  surface.text('Регистрационная ссылка',{...summary,height:48},summary.height<240?16:20);actions.forEach((action,index)=>surface.action(options.safe(action),{...summary,y:summary.y+(summary.height<240?30:54)+index*(summary.height<240?48:54),height:44},false,14));
  options.field('admin-limit',{...a,y:a.y+(options.prompt?12:220),height:44},admin.limit,'Лимит регистраций',value=>{admin.limit=value;});options.field('admin-duration',{...a,y:a.y+(options.prompt?66:274),height:44},admin.duration,'Срок действия',value=>{admin.duration=value;});footer([{id:'admin-registration-back',text:'Назад',run:back},{id:'admin-create',text:'Создать',enabled:admin.limited||admin.timed,run:()=>void admin.create()}]);return;
 }
 let title='Доступ учеников',items:StudyAction[]=[];
 if(admin.screen==='menu')items=[{id:'admin-personal',text:'Приглашение / восстановление',run:()=>{admin.screen='personal';options.changed();}},{id:'admin-registration',text:'Общая регистрационная ссылка',run:()=>{admin.screen='registration';options.changed();}},{id:'admin-links',text:'Выданные ссылки · '+admin.links.length,run:()=>{admin.screen='links';admin.offset=0;options.changed();}},{id:'admin-users',text:'Ученики · '+admin.users.length,run:()=>{admin.screen='users';admin.offset=0;options.changed();}}];
 else if(admin.screen==='links'){title='Выданные ссылки';items=admin.links.map(link=>({id:'admin-link:'+link.id,text:`${({active:'Действует',exhausted:'Регистрации исчерпаны',expired:'Срок истёк',revoked:'Отозвана'}[link.status])} · ${link.registrationsCount}/${link.registrationLimit??'∞'} · ${link.expiresAt?new Date(link.expiresAt).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'}):'без срока'} · Отозвать`,enabled:link.status!=='revoked',run:()=>void admin.revoke(link.id)}));}
 else {title='Ученики';items=admin.users.map(user=>({id:'admin-user:'+user.id,text:user.name+' · '+user.email,run:()=>{admin.email=user.email;admin.kind='recovery';admin.screen='personal';options.changed();}}));}
 bookRows(surface,title,items,admin,{safe:options.safe,changed:options.changed,back:admin.screen==='menu'?options.home:back});
}
