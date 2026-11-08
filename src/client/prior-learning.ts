import type { PriorCommand, PriorResult, PriorScope } from '../shared/prior-learning';
import { api, json } from './api';
import { learningHeaders } from './guidedApi';
const prefix=(owner:string)=>'japanese-prior-request-v1:'+owner+':';
function queued(owner:string):PriorCommand[]{
 const result:PriorCommand[]=[];
 for(let i=0;i<localStorage.length;i++){
  const key=localStorage.key(i)!;if(!key.startsWith(prefix(owner)))continue;
  const value=JSON.parse(localStorage.getItem(key)!);
  if(typeof value?.requestId!=='string'||key!==prefix(owner)+value.requestId||!value.selection&&!value.undo)throw Error('Не удалось прочитать несохранённую отметку. Не очищайте данные браузера.');
  result.push(value);
 }
 return result;
}
export class PriorLearningClient {
  owner=''; pending:PriorCommand|null=null; last:string|null=null; result:PriorResult|null=null; busy=false; error=''; private revision=0; private storageError='';
  bind(owner:string){
    if(this.owner===owner)return;this.owner=owner;this.revision++;this.busy=false;this.pending=null;this.last=null;this.result=null;this.error='';this.storageError='';
    try{const value=JSON.parse(localStorage.getItem('japanese-prior-v1:'+owner)??'null');this.last=value?.last??null;if(value?.pending)localStorage.setItem(prefix(owner)+value.pending.requestId,JSON.stringify(value.pending));this.pending=queued(owner)[0]??null;}
    catch{this.error=this.storageError='Не удалось прочитать сохранённую отметку. Не очищайте данные браузера.';}
  }
  private persist(){
    if(this.pending)localStorage.setItem(prefix(this.owner)+this.pending.requestId,JSON.stringify(this.pending));
    localStorage.setItem('japanese-prior-v1:'+this.owner,JSON.stringify({last:this.last}));
  }
  async send(publicationId:string|undefined,selection?:PriorScope,undo?:string){
    if(this.busy||this.storageError)return;this.busy=true;this.error='';const owner=this.owner,revision=this.revision;
    try{
      if(!this.pending){this.pending=queued(owner)[0]??{requestId:crypto.randomUUID(),publicationId,...(selection?{selection}:{}),...(undo?{undo}:{})};}
      this.persist();const input=this.pending;
      const result=await api<PriorResult>('/api/prior-learning',{...json('POST',input),headers:{...learningHeaders(owner,input.publicationId),'Content-Type':'application/json'}});
      if(result.requestId!==input.requestId)throw Error('Сервер не подтвердил отметку. Она сохранена на устройстве.');
      if(this.owner!==owner||this.revision!==revision)return;
      localStorage.removeItem(prefix(owner)+input.requestId);this.result=result;this.last=input.undo?null:input.requestId;this.pending=queued(owner)[0]??null;this.persist();
    }catch(error){if(this.owner===owner&&this.revision===revision)this.error=error instanceof Error?error.message:'Не удалось сохранить отметку.';}
    finally{if(this.owner===owner&&this.revision===revision)this.busy=false;}
  }
}
