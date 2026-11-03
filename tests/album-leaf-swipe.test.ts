import { expect, test } from 'bun:test';
import { Container } from 'pixi.js';
import { AlbumLeaf } from '../src/client/canvas/album-leaf';

function scenario(run:(h:any)=>void){
 const oldRequest=globalThis.requestAnimationFrame,oldCancel=globalThis.cancelAnimationFrame;
 const frames=new Map<number,FrameRequestCallback>();let id=0,renders=0,settled=0;const grades:number[]=[];
 globalThis.requestAnimationFrame=callback=>{frames.set(++id,callback);return id;};globalThis.cancelAnimationFrame=id=>{frames.delete(id);};
 const handlers=new Map<string,(e:any)=>void>();let captured=false;
 const canvas={addEventListener(name:string,handler:any){handlers.set(name,handler);},setAttribute(){},getBoundingClientRect(){return{x:0,y:0,width:800};},focus(){},setPointerCapture(){captured=true;},hasPointerCapture(){return captured;},releasePointerCapture(){captured=false;}};
 const leaf=new AlbumLeaf(canvas as any,()=>({width:800,height:500}),()=>{renders++;},()=>{},()=>false,()=>{settled++;});
 const page=new Container(),ink=new Container();let revealed=true;
 const binding={page,ink,bounds:{x:410,y:30,width:380,height:450},revealBounds:{x:10,y:30,width:780,height:450},viewportWidth:800,canReveal:()=>!revealed,canGrade:()=>revealed,reveal:()=>{revealed=true;},grade:(rating:number)=>grades.push(rating),controls:()=>[{x:600,y:350,width:100,height:50}]};leaf.bind(binding);
 const send=(name:string,x:number,y:number,timeStamp:number)=>handlers.get(name)!({button:0,pointerId:1,clientX:x,clientY:y,timeStamp,preventDefault(){},stopImmediatePropagation(){}});
 const flush=(now=performance.now()+1000)=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(callback=>callback(now));};
 try{run({leaf,binding,send,flush,grades,frames,get renders(){return renders;},get settled(){return settled;}});}finally{leaf.bind();page.destroy({children:true});ink.destroy();globalThis.requestAnimationFrame=oldRequest;globalThis.cancelAnimationFrame=oldCancel;}
}
test('short deliberate flicks work from either edge of the answer page',()=>scenario(({send,flush,grades}:any)=>{
 send('pointerdown',425,220,0);send('pointermove',401,220,50);send('pointerup',401,220,60);flush();expect(grades).toEqual([1]);
 send('pointerdown',775,220,1000);send('pointermove',799,220,1050);send('pointerup',799,220,1060);flush();expect(grades).toEqual([1,3]);
}));
test('question page, controls, slow short drags and vertical motion never grade',()=>scenario(({send,flush,grades}:any)=>{
 for(const [x,y,dx,dy,ms]of [[200,220,100,0,60],[640,370,100,0,60],[450,220,24,0,600],[450,220,24,60,60],[450,220,8,0,10]] as const){
  send('pointerdown',x,y,0);send('pointermove',x+dx,y+dy,ms);send('pointerup',x+dx,y+dy,ms+1);flush();
 }expect(grades).toEqual([]);
}));
test('pointer bursts render once per animation frame',()=>scenario(h=>{
 h.send('pointerdown',600,220,0);const before=h.renders;
 for(let i=1;i<=12;i++)h.send('pointermove',600-i*3,220,i*4);
 expect(h.renders-before).toBe(0);expect(h.frames.size).toBe(1);h.flush();expect(h.renders-before).toBe(1);
}));
test('a deliberate slow swipe needs less travel near the viewport boundary',()=>scenario(h=>{
 h.leaf.bind({...h.binding,bounds:{x:10,y:30,width:780,height:450}});
 h.send('pointerdown',30,220,0);h.send('pointermove',8,220,250);h.send('pointerup',8,220,260);h.flush();expect(h.grades).toEqual([1]);
 h.send('pointerdown',770,220,1000);h.send('pointermove',792,220,1250);h.send('pointerup',792,220,1260);h.flush();expect(h.grades).toEqual([1,3]);
}));
test('saving sees the animation as busy; redraw is released only after settlement',()=>scenario(h=>{
 let busyAtSave=false,submissions=0;
 h.leaf.bind({...h.binding,accept:()=>{busyAtSave=h.leaf.busy;submissions++;return true;}});
 h.leaf.commit(3);h.leaf.commit(3);expect(busyAtSave).toBe(true);expect(submissions).toBe(1);
 h.flush(performance.now()+100);expect(h.leaf.busy).toBe(true);expect(h.settled).toBe(0);
 h.flush();expect(h.leaf.busy).toBe(false);expect(h.settled).toBe(1);
}));
