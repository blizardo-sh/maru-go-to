// M8: historical assertions replayed against root sources and main build, isolated synthetic clone.
import './guard.mjs';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { SceneSoundController } from '../../src/client/sceneSound';
import { defaultSoundSettings } from '../../src/shared/sound';

let starts = 0, stops = 0, disconnects = 0;
class Node {
  gain = { value: 0, setTargetAtTime(value: number) { this.value = value; } };
  buffer = null; onended: (() => void) | null = null;
  connect() {} disconnect() { disconnects++; } start() { starts++; } stop() { stops++; }
}
class Context {
  state = 'running'; sampleRate = 48000; currentTime = 0; destination = new Node();
  createGain() { return new Node(); } createBufferSource() { return new Node(); } createMediaElementSource() { return new Node(); }
  async resume() { this.state = 'running'; } async suspend() { this.state = 'suspended'; } async close() { this.state = 'closed'; }
  async decodeAudioData() { return { length:1200, numberOfChannels:1 }; }
}
class Media {
  paused = true; loop = false; src = ''; preload = ''; error = null;
  onplaying: (() => void) | null = null; onpause: (() => void) | null = null;
  async play() { this.paused = false; this.onplaying?.(); } pause() { this.paused = true; this.onpause?.(); }
  load() {} removeAttribute() { this.src = ''; }
}
Object.assign(globalThis, { AudioContext: Context, Audio: Media });
const scenes = Object.fromEntries(['room','garden','mountains','river','tokyo'].map(scene => [scene, { music:'/audio/game/music-cozy.m4a', ambience:'/audio/game/ambience-river.m4a' }]));
const manifest = { version: 1, scenes, sfx: Object.fromEntries(['reveal','move','good','again','complete','pet'].map(cue => [cue, '/m6/audio/' + cue + '.wav'])) };
let held: Promise<void> | null = null;
globalThis.fetch = (async (url: string) => {
  if (url.endsWith('manifest.json')) return { ok: true, json: async () => manifest };
  if (held) await held;
  return { ok: true, arrayBuffer: async () => new ArrayBuffer(20) };
}) as typeof fetch;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const results: string[] = [];
function make() { const sound = new SceneSoundController(() => {}, '/m6/audio/manifest.json'); sound.configure(defaultSoundSettings, 'river', true, true); sound.unlock(); return sound; }
async function delayed(interrupt: (sound: SceneSoundController) => void) {
  const sound = make(); await flush();
  let release!: () => void; held = new Promise<void>(resolve => { release = resolve; });
  const before = starts; sound.cue('good', 'held'); await flush(); interrupt(sound); release(); held = null; await flush();
  assert.equal(starts, before, 'A stale cue must not return after its owner resumes'); sound.dispose();
}
const sound = make(); await flush(); assert.equal(sound.snapshot().loops, 2);
sound.cue('good', 'receipt'); await flush(); const once = starts;
sound.cue('good', 'receipt'); sound.cue('again', 'receipt'); await flush(); assert.equal(starts, once); results.push('duplicate/conflicting ACK cues deduplicate');
sound.setSpeechPlaying(true); assert.equal(sound.snapshot().oneShots, 0); assert.equal(sound.snapshot().gains.duck, .15);
sound.configure({ ...defaultSoundSettings, musicVolume:.07, ambienceVolume:.03 },'river',true,true); sound.setSpeechPlaying(false);
assert.equal(sound.snapshot().gains.music,.07); assert.equal(sound.snapshot().gains.ambience,.03); assert.equal(sound.snapshot().gains.duck,1); results.push('speech stops effects; release preserves changed levels');
sound.dispose(); await flush(); assert.equal(sound.snapshot().context,'closed'); assert.equal(sound.snapshot().loops,0); assert.equal(sound.snapshot().buffers,0);
await delayed(value => { value.configure(defaultSoundSettings,'river',true,false); value.configure(defaultSoundSettings,'river',true,true); }); results.push('late cue discarded across hide/show');
await delayed(value => { value.configure(defaultSoundSettings,'garden',true,true); value.configure(defaultSoundSettings,'river',true,true); }); results.push('late cue discarded across A→B→A scene switch');
await delayed(value => { value.setSpeechPlaying(true); value.setSpeechPlaying(false); }); results.push('late cue discarded across speech interruption');
await delayed(value => value.configure({ ...defaultSoundSettings,sfxVolume:0 },'river',true,true)); results.push('late zero-volume cue suppressed');
await delayed(value => { const shared={...defaultSoundSettings}; value.configure(shared,'river',true,true); shared.sceneSoundEnabled=false; value.configure(shared,'river',true,true); shared.sceneSoundEnabled=true; value.configure(shared,'river',true,true); }); results.push('mutable caller settings cannot preserve a pre-mute cue');
await delayed(value => value.dispose()); results.push('late owner disposal cannot play');
const poly = make(); await flush(); for (let i=0;i<25;i++) poly.cue('pet','pet-'+i); await flush(); assert.ok(poly.snapshot().oneShots<=4); assert.equal(poly.snapshot().pendingCues,0); poly.dispose(); results.push('effect polyphony and concurrent decoding bounded at four');
assert.ok(stops>0 && disconnects>0);
const report = {date:'2026-11-02',passed:true,checks:results,scope:'root SceneSoundController fake audio graph; obsolete preview-motion assertions excluded; no hearing or device claim'};
writeFileSync('checks-m8-m6-full-sound.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
