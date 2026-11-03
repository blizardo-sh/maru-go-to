import { expect, test } from 'bun:test';
import { Container } from 'pixi.js';
import { AlbumLeaf } from '../src/client/canvas/album-leaf';

test('either page reveals once; media controls and disabled controls do not reveal or grade', () => {
  const cancel = globalThis.cancelAnimationFrame; globalThis.cancelAnimationFrame = () => {};
  try {
  const handlers = new Map<string,(e:any)=>void>(); let captured=false, revealed=false, reveals=0, grades=0;
  const canvas = { addEventListener(name:string,handler:any){handlers.set(name,handler);},setAttribute(){},getBoundingClientRect(){return {x:0,y:0,width:800};},focus(){},setPointerCapture(){captured=true;},hasPointerCapture(){return captured;},releasePointerCapture(){captured=false;} };
  const leaf = new AlbumLeaf(canvas as any,()=>({width:800,height:500}),()=>{},()=>{},()=>true);
  const page=new Container(),ink=new Container();
  leaf.bind({page,ink,bounds:{x:410,y:30,width:380,height:450},revealBounds:{x:10,y:30,width:780,height:450},viewportWidth:800,canReveal:()=>!revealed,canGrade:()=>revealed,reveal:()=>{revealed=true;reveals++;},grade:()=>{grades++;},controls:()=>[{x:70,y:80,width:70,height:70}]});
  const tap=(x:number,y:number)=>{const e={button:0,pointerId:1,clientX:x,clientY:y,preventDefault(){},stopImmediatePropagation(){}};handlers.get('pointerdown')!(e);handlers.get('pointerup')!(e);};
  tap(100,100);expect(reveals).toBe(0);
  tap(200,220);expect(reveals).toBe(1);
  tap(600,220);expect(reveals).toBe(1);expect(grades).toBe(0);
  leaf.bind();page.destroy({children:true});ink.destroy();
  } finally {globalThis.cancelAnimationFrame = cancel;}
});
