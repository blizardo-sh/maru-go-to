import { Container, Graphics, Sprite } from 'pixi.js';
import { M6Textures } from './m6-textures';
import { riverMasks } from './m6-motion';
import type { SceneId } from '@app/client/scenes';
import room from '../../../public/scenes/room-v1.webp';
import roomMobile from '../../../public/scenes/room-mobile-v1.webp';
import garden from '../../../public/scenes/garden-v1.webp';
import gardenMobile from '../../../public/scenes/garden-mobile-v1.webp';
import mountains from '../../../public/scenes/mountains-v1.webp';
import mountainsMobile from '../../../public/scenes/mountains-mobile-v1.webp';
import river from '../../../public/scenes/river-v1.webp';
import riverMobile from '../../../public/scenes/river-mobile-v1.webp';
import tokyo from '../../../public/scenes/tokyo-v1.webp';
import tokyoMobile from '../../../public/scenes/tokyo-mobile-v1.webp';
import foliage from '../../../public/scenes/layers/foliage-v1.webp';
import sakura from '../../../public/scenes/layers/sakura-v1.webp';
const files = { room: [room, roomMobile], garden: [garden, gardenMobile], mountains: [mountains, mountainsMobile], river: [river, riverMobile], tokyo: [tokyo, tokyoMobile] } as const;
export const sceneNames: Record<SceneId, string> = {room:'Комната',garden:'Сад',mountains:'Горы',river:'Река',tokyo:'Токио'};
// Coordinates in original plates. Water never includes banks, rail, desk, or book.
const gardenWater = { desktop: [300,470,490,430,670,445,840,495,790,562,620,590,450,580,300,550], mobile: [0,485,170,474,300,490,385,545,303,619,110,639,0,620] };
export class LivingScene {
  readonly root = new Container();
  private layers = new Container();
  private textures = new M6Textures();
  private epoch = 0;
  private disposed = false;
  private request = '';
  private active: string[] = [];
  private water?: Sprite;
  private branch?: Sprite;
  private cloud?: Sprite;
  private light?: Graphics;
  private details?: Graphics;
  private w = 1600; private h = 900; private mobile = false;
  id: SceneId = 'room'; state: 'loading'|'ready'|'unavailable' = 'loading';
  constructor(private render: () => void) { this.root.eventMode='none';this.root.addChild(this.layers); }
  async load(id: SceneId, width: number, height: number, retry = false) {
    const mobile=width<700, request=`${id}:${mobile}:${width}:${height}`;
    if (request===this.request&&!retry)return;
    this.request=request;const epoch=++this.epoch;this.state='loading';
    const url=files[id][mobile?1:0], overlay=id==='garden'?sakura:id==='tokyo'?null:foliage, wanted=overlay?[url,overlay]:[url];
    this.textures.retain([...this.active,...wanted]);
    try {
      const [plate,leaves]=await Promise.all([this.textures.load(url),overlay?this.textures.load(overlay):Promise.resolve(null)]);
      if (this.disposed||epoch!==this.epoch)return;
      this.layers.removeChildren().forEach(c=>c.destroy({children:true,context:true,style:true}));
      this.water=undefined;this.branch=undefined;this.cloud=undefined;
      this.id=id;this.mobile=mobile;this.w=mobile?540:1600;this.h=mobile?960:900;
      const scale=Math.max(width/this.w,height/this.h);this.layers.scale.set(scale);this.layers.position.set((width-this.w*scale)/2,(height-this.h*scale)/2);
      this.layers.addChild(new Sprite(plate));
      if(id==='river'||id==='garden') {
        const points=id==='river'?riverMasks[mobile?'mobile':'desktop'].water:gardenWater[mobile?'mobile':'desktop'];
        const mask=new Graphics().poly([...points]).fill(0xffffff), water=new Sprite(plate);this.layers.addChild(mask,water);water.mask=mask;this.water=water;
      }
      if(id==='mountains') {
        const mask=new Graphics().poly(mobile?[0,35,540,35,540,150,0,150]:[520,70,1100,70,1100,150,920,150,850,125,770,150,520,150]).fill(0xffffff);
        const cloud=new Sprite(plate);this.layers.addChild(mask,cloud);cloud.mask=mask;cloud.alpha=.18;this.cloud=cloud;
      }
      if(leaves) { const branch=new Sprite(leaves);branch.anchor.set(.95,.12);branch.position.set(this.w+6,3);branch.width=mobile?170:320;branch.scale.y=branch.scale.x;this.layers.addChild(branch);this.branch=branch; }
      this.light=new Graphics();this.details=new Graphics();this.layers.addChild(this.light,this.details);
      this.active=wanted;this.state='ready';this.textures.retain(wanted);this.tick(0,true);
    } catch { if(!this.disposed&&epoch===this.epoch){this.state='unavailable';this.textures.retain(this.active);} }
    finally { if(!this.disposed&&epoch===this.epoch)this.render(); }
  }
  tick(t: number, reduced: boolean) {
    if(this.disposed||this.state!=='ready')return; if(reduced)t=0;
    if(this.water){this.water.x=reduced?0:Math.sin(t*.9)*2.2;this.water.y=reduced?0:Math.sin(t*.64)*.85;}
    if(this.branch)this.branch.rotation=reduced?0:Math.sin(t*.6)*.018;
    if(this.cloud){this.cloud.x=reduced?0:Math.sin(t*.12)*7;this.cloud.y=reduced?0:Math.sin(t*.09)*2;}
    const g=this.light!,d=this.details!,w=this.w,h=this.h;g.clear();d.clear();
    if(this.id==='room'||this.id==='mountains') {
      g.ellipse(w*.2,h*.27,w*.14,h*.24).fill({color:0xffe8ad,alpha:.018+(Math.sin(t*.18)+1)*.015});
      if(this.id==='mountains') for(let i=0;i<8;i++)g.ellipse(w*.5+(reduced?0:Math.sin(t*.1)*7),h*.4,w*(.25-i*.018),h*(.075-i*.006)).fill({color:0xe8e7dc,alpha:.0035});
      if(this.id==='room'&&!reduced) {
        // Steam follows the illustrated tea, never floats across the river or exercise.
        if(!this.mobile) for(let i=0;i<2;i++){const p=(t*.12+i*.5)%1,x=104+Math.sin(t*.7+i)*8,y=680-p*70;d.moveTo(x,y+17).bezierCurveTo(x-7,y+10,x+8,y+4,x,y-8).stroke({color:0xfff4df,width:2,alpha:Math.sin(p*Math.PI)*.22});}
        for(let i=0;i<3;i++){const p=(t*.018+i*.31)%1;d.circle(w*(.09+.09*i)+Math.sin(t*.13+i)*8,h*(.1+p*.3),1.6).fill({color:0xffefcb,alpha:.12});}
      }
    }
    if(this.id==='garden'&&!reduced)for(let i=0;i<3;i++){const p=(t*.035+i*.33)%1,x=w*(.06+.12*i)+Math.sin(t*.4+i)*18,y=h*(.03+p*.48);d.ellipse(x,y,3.8,1.9).fill({color:0xf6c4b2,alpha:Math.sin(p*Math.PI)*.75});}
    if(this.id==='river'&&!reduced)for(let i=0;i<2;i++){const p=(t*.025+i*.5)%1;d.circle(w*(.035+i*.04)+Math.sin(t*.2+i)*5,h*(.36+p*.2),1.5).fill({color:0xe4dd9a,alpha:Math.sin(p*Math.PI)*.22});}
    if(this.id==='tokyo') {
      const points=this.mobile?[[.31,.47],[.56,.49],[.74,.51],[.9,.48]]:[[.28,.49],[.49,.46],[.57,.48],[.64,.51]];
      points.forEach(([x,y],i)=>g.rect(w*x!,h*y!,this.mobile?3:5,this.mobile?5:8).fill({color:0xffda91,alpha:.22+.12*Math.sin(t*.16+i)}));
      if(!this.mobile)g.ellipse(1460,345,48,72).fill({color:0xffcf7b,alpha:.025+.013*Math.sin(t*.21)});
    }
  }
  snapshot(){return{id:this.id,state:this.state,waterMasked:!!this.water?.mask,wholePlateMoves:false,addedLightStripes:false,program:this.id==='room'?['branches','local-light','tea-steam','3-dust']:this.id==='garden'?['sakura','3-petals','masked-water']:this.id==='mountains'?['masked-clouds','branches','local-light']:this.id==='river'?['masked-water','foliage','2-bank-particles']:['windows','lamp'],maxParticles:this.id==='garden'||this.id==='room'?3:this.id==='river'?2:0,...this.textures.snapshot()};}
  dispose(){if(this.disposed)return;this.disposed=true;++this.epoch;this.root.destroy({children:true,context:true,style:true});this.textures.dispose();}
}
