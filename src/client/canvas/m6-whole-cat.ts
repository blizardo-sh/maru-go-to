import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import metadata from '../../../assets/canvas/m6-v4/manifest.json';
import {wholeCatMotion} from './m6-whole-motion';

// Every frame is one complete illustration. No separately rotating body parts.
export class WholeCatAnimation {
  readonly root = new Container();
  private sprite: Sprite;
  private frames: Texture[];
  private frame = metadata.frames.length-1;
  nominalSize = 128;
  phase = '';
  constructor(atlas: Texture) {
    this.frames=metadata.frames.map(item=>new Texture({source:atlas.source,frame:new Rectangle(...item.frame as [number,number,number,number])}));
    this.sprite=new Sprite(this.frames[this.frame]);this.sprite.anchor.set(...metadata.pivot as [number,number]);
    this.root.addChild(this.sprite);this.resize(128);
  }
  resize(size: number) {
    this.nominalSize=size;this.sprite.width=size;this.sprite.height=size;
    this.root.hitArea=new Rectangle(-size/2,-size*metadata.pivot[1]!,size,size);
  }
  update(seconds: number, reduced: boolean) {
    const motion=wholeCatMotion(seconds,reduced);this.frame=motion.frame;
    this.sprite.texture=this.frames[this.frame]!;
    this.phase=motion.phase;return motion;
  }
  snapshot() {return {wholeCharacter:true,separateBodyParts:false,currentFrame:this.frame,frames:this.frames.length,sourceTextures:1,nominalSize:this.nominalSize,phase:this.phase};}
  dispose() {this.root.destroy({children:true});this.frames.forEach(frame=>frame.destroy(false));this.frames=[];}
}
