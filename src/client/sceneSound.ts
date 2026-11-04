import { useEffect, useMemo, useRef, useState } from 'react';
import type { LearnerSettings } from '../shared/types';
import { defaultSoundSettings } from '../shared/sound';
import type { SceneId } from './scenes';

export type SoundCue = 'reveal' | 'move' | 'good' | 'again' | 'complete' | 'pet';
export type SoundState = 'paused' | 'muted' | 'loading' | 'playing' | 'blocked' | 'unavailable';
type SoundSettings = Pick<LearnerSettings, 'sceneSoundEnabled' | 'musicVolume' | 'ambienceVolume' | 'sfxVolume'>;
type Manifest = { version: 1; scenes: Record<SceneId, { music: string; ambience: string }>; sfx: Record<Exclude<SoundCue, 'pet'>, string> & { pet?: string } };
export type SceneSound = { unlock: (scene?: SceneId) => void; setSpeechPlaying: (playing: boolean) => void; cue: (type: SoundCue, eventId: string) => void; state: SoundState };

export class SceneSoundController {
  context: AudioContext | null = null;
  private music: GainNode | null = null;
  private ambience: GainNode | null = null;
  private effects: GainNode | null = null;
  private duck: GainNode | null = null;
  private master: GainNode | null = null;
  private settings: SoundSettings = defaultSoundSettings;
  private scene: SceneId = 'room';
  private active = false;
  private visible = true;
  private speechPlaying = false;
  disposed = false;
  private manifest: Promise<Manifest> | null = null;
  private manifestValue: Manifest | null = null;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private loops = new Map<'music' | 'ambience', { src: string; audio: HTMLAudioElement; source: MediaElementAudioSourceNode; playing: boolean }>();
  private cues = new Set<string>();
  private oneShots = new Set<AudioBufferSourceNode>();
  private loading = 0;
  private lifecycle = 0;
  private pendingCues = 0;
  private startedEffects = 0;
  private decodedBytes = 0;

  constructor(private onState: (value: SoundState) => void, private manifestUrl = '/m6/audio/manifest.json') {
    if (!['/audio/game/manifest.json', '/m6/audio/manifest.json'].includes(manifestUrl)) throw new Error('Invalid sound manifest');
    void this.getManifest().catch(() => {});
  }
  configure(settings: SoundSettings, scene: SceneId, active: boolean, visible: boolean) {
    if (this.scene !== scene || this.active !== active || this.visible !== visible || this.settings.sceneSoundEnabled !== settings.sceneSoundEnabled) { ++this.lifecycle; this.stopEffects(); }
    this.settings = { ...settings }; this.scene = scene; this.active = active; this.visible = visible;
    this.gains(); this.sync();
  }
  unlock(scene?: SceneId) {
    if (this.disposed) return;
    if (scene) { this.scene = scene; this.active = true; }
    try {
      if (!this.context) {
        const context = new AudioContext(); this.context = context;
        this.music = context.createGain(); this.ambience = context.createGain(); this.effects = context.createGain(); this.duck = context.createGain(); this.master = context.createGain();
        this.music.connect(this.duck); this.ambience.connect(this.duck); this.duck.connect(this.master); this.effects.connect(this.master); this.master.connect(context.destination);
        this.gains();
      }
      // Called directly from Start/toggle, before any network request or intro delay.
      void this.context.resume().then(() => this.sync()).catch(() => { if (!this.disposed) this.onState('blocked'); });
      if (this.manifestValue && this.running()) { this.installLoops(this.manifestValue); for (const { audio } of this.loops.values()) if (audio.error) audio.load(); this.playLoops(); }
    } catch { this.onState('unavailable'); }
  }
  setSpeechPlaying(value: boolean) { if (value !== this.speechPlaying) ++this.lifecycle; this.speechPlaying = value; if (value) this.stopEffects(); this.gains(); }
  private stopEffects() { for (const source of this.oneShots) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); } this.oneShots.clear(); }
  private running() { return this.active && this.visible && this.settings.sceneSoundEnabled && !this.disposed; }
  private gains() {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.music?.gain.setTargetAtTime(this.settings.musicVolume, now, .04);
    this.ambience?.gain.setTargetAtTime(this.settings.ambienceVolume, now, .04);
    this.effects?.gain.setTargetAtTime(this.settings.sfxVolume, now, .02);
    this.duck?.gain.setTargetAtTime(this.speechPlaying ? .15 : 1, now, .04);
    this.master?.gain.setTargetAtTime(this.settings.sceneSoundEnabled ? 1 : 0, now, .015);
  }
  private sync() {
    const context = this.context;
    if (this.disposed) return;
    if (!context) { this.onState(this.settings.sceneSoundEnabled ? 'paused' : 'muted'); return; }
    if (!this.running()) { for (const { audio } of this.loops.values()) audio.pause(); this.stopEffects(); void context.suspend().catch(() => {}); this.onState(this.settings.sceneSoundEnabled ? 'paused' : 'muted'); return; }
    if (context.state !== 'running') { void context.resume().then(() => { if (this.running()) this.prepare(); else this.sync(); }).catch(() => { if (!this.disposed) this.onState('blocked'); }); }
    else this.prepare();
  }
  private getManifest() {
    if (!this.manifest) this.manifest = fetch(this.manifestUrl).then(async response => { if (!response.ok) throw new Error('Sound unavailable'); const value: Manifest = await response.json(); if (value.version !== 1 || !value.scenes || !value.sfx) throw new Error('Sound unavailable'); this.manifestValue = value; return value; }).catch(error => { this.manifest = null; throw error; });
    return this.manifest;
  }
  private buffer(src: string) {
    if ((!src.startsWith('/audio/game/') && !src.startsWith('/m6/audio/')) || src.includes('..') || /[?#\\]/.test(src)) return Promise.reject(new Error('Invalid sound asset'));
    let result = this.buffers.get(src);
    if (!result) {
      result = fetch(src).then(async response => { if (!response.ok) throw new Error('Sound unavailable'); const buffer = await this.context!.decodeAudioData(await response.arrayBuffer()); if (!this.disposed && this.buffers.has(src)) this.decodedBytes += buffer.length * buffer.numberOfChannels * 4; return buffer; }).catch(error => { this.buffers.delete(src); throw error; });
      this.buffers.set(src, result);
    }
    return result;
  }
  private prepare() {
    const request = ++this.loading; const scene = this.scene;
    if (!this.loops.get('music')?.playing) this.onState('loading');
    void this.getManifest().then(manifest => {
      if (!this.running() || request !== this.loading || scene !== this.scene) return;
      this.installLoops(manifest); this.playLoops();
    }).catch(() => { if (!this.disposed && request === this.loading) this.onState('unavailable'); });
  }
  private installLoops(manifest: Manifest) {
    const files = manifest.scenes[this.scene];
    this.loop('music', files.music, this.music!); this.loop('ambience', files.ambience, this.ambience!);
  }
  private loop(channel: 'music' | 'ambience', src: string, gain: GainNode) {
    if (this.loops.get(channel)?.src === src) return;
    if ((!src.startsWith('/audio/game/') && !src.startsWith('/m6/audio/')) || src.includes('..') || /[?#\\]/.test(src)) throw new Error('Invalid sound asset');
    const previous = this.loops.get(channel); if (previous) { previous.audio.onplaying = null; previous.audio.onpause = null; previous.audio.onwaiting = null; previous.audio.onerror = null; previous.audio.pause(); previous.audio.removeAttribute('src'); previous.audio.load(); previous.source.disconnect(); }
    const audio = new Audio(); audio.preload = 'none'; audio.loop = true; audio.src = src;
    const source = this.context!.createMediaElementSource(audio); source.connect(gain);
    const loop = { src, audio, source, playing: false }; this.loops.set(channel, loop);
    audio.onplaying = () => { loop.playing = true; if (!this.running()) audio.pause(); else if (this.context?.state === 'running') this.onState('playing'); };
    audio.onpause = () => { loop.playing = false; };
    audio.onwaiting = () => { loop.playing = false; if (this.running() && !this.loops.get('music')?.playing) this.onState('loading'); };
    audio.onerror = () => { loop.playing = false; if (this.running()) this.onState('unavailable'); };
  }
  private playLoops() {
    if (!this.running()) return;
    for (const loop of this.loops.values()) {
      if (loop.playing && this.context?.state === 'running') this.onState('playing');
      if (!loop.audio.paused) continue;
      void loop.audio.play().then(() => { if (!this.running()) loop.audio.pause(); }).catch(error => { if (this.running() && error?.name !== 'AbortError') this.onState(error?.name === 'NotAllowedError' ? 'blocked' : 'unavailable'); });
    }
  }
  cue(type: SoundCue, eventId: string) {
    const key = `${type === 'good' || type === 'again' ? 'ack' : type}:${eventId}`;
    if (this.cues.has(key)) return;
    this.cues.add(key);
    if (!this.running() || this.speechPlaying || !this.context || this.context.state !== 'running' || this.settings.sfxVolume === 0) return;
    const scene = this.scene, lifecycle = this.lifecycle;
    if (this.pendingCues >= 4) return;
    ++this.pendingCues;
    void (async () => {
      try {
        const manifest = await this.getManifest(); const buffer = await this.buffer(type === 'pet' ? manifest.sfx.pet ?? manifest.sfx.again : manifest.sfx[type]);
        if (!this.running() || lifecycle !== this.lifecycle || this.speechPlaying || this.settings.sfxVolume === 0 || scene !== this.scene || this.context?.state !== 'running' || this.oneShots.size >= 4) return;
        const source = this.context.createBufferSource(); source.buffer = buffer; if (type === 'good' && source.playbackRate) { let hash = 0; for (const char of eventId) hash = Math.imul(hash, 31) + char.charCodeAt(0) | 0; source.playbackRate.value = [.97, 1, 1.03][(hash >>> 0) % 3]!; } source.connect(this.effects!); this.oneShots.add(source); source.onended = () => { this.oneShots.delete(source); source.disconnect(); }; source.start(); ++this.startedEffects;
      } catch { if (!this.disposed && lifecycle === this.lifecycle) this.onState('unavailable'); }
      finally { --this.pendingCues; }
    })();
  }
  snapshot() { return { context: this.context?.state ?? 'locked', loops: this.loops.size, playingLoops: [...this.loops.values()].filter(loop => loop.playing).length, oneShots: this.oneShots.size, pendingCues: this.pendingCues, startedEffects: this.startedEffects, buffers: this.buffers.size, decodedBytes: this.decodedBytes, sampleRate: this.context?.sampleRate, events: this.cues.size, speechPlaying: this.speechPlaying, active: this.running(), gains: { music: this.music?.gain.value, ambience: this.ambience?.gain.value, effects: this.effects?.gain.value, duck: this.duck?.gain.value }, lifecycle: this.lifecycle }; }
  dispose() { ++this.lifecycle; this.disposed = true; this.buffers.clear(); this.decodedBytes = 0; this.stopEffects(); for (const { audio, source } of this.loops.values()) { audio.pause(); audio.removeAttribute('src'); audio.load(); source.disconnect(); } this.loops.clear(); void this.context?.close().catch(() => {}); }
}

export function useSceneSound({ learnerId, settings, scene, active }: { learnerId: string | null; settings?: LearnerSettings; scene: SceneId; active: boolean }): SceneSound {
  const [state, setState] = useState<SoundState>('paused');
  const controller = useRef<SceneSoundController | null>(null); const owner = useRef<{ id: string | null; unlocked: boolean } | string | null>(null);
  const config = useRef({ learnerId, settings, scene, active }); config.current = { learnerId, settings, scene, active };
  function ownership() {
    // Fast Refresh may preserve the earlier string ref and a closed controller.
    if (typeof owner.current === 'string' || owner.current === null) owner.current = { id: owner.current, unlocked: !!controller.current?.context };
    return owner.current;
  }
  function current() {
    if (ownership().id !== config.current.learnerId) { controller.current?.dispose(); controller.current = null; owner.current = { id: config.current.learnerId, unlocked: false }; }
    if (controller.current?.disposed) controller.current = null;
    if (!config.current.learnerId) return null;
    if (!controller.current) controller.current = new SceneSoundController(setState);
    return controller.current;
  }
  useEffect(() => {
    const sync = () => { const recreated = !controller.current || controller.current.disposed || ownership().id !== config.current.learnerId; const value = current(); if (value && config.current.settings) { value.configure(config.current.settings, config.current.scene, config.current.active, !document.hidden); if (recreated && ownership().unlocked && config.current.active && !document.hidden && config.current.settings.sceneSoundEnabled) value.unlock(config.current.scene); } };
    sync(); document.addEventListener('visibilitychange', sync); return () => document.removeEventListener('visibilitychange', sync);
  }, [learnerId, settings, scene, active]);
  useEffect(() => () => { const previous = controller.current; controller.current = null; previous?.dispose(); }, []);
  const controls = useMemo(() => ({ unlock: (scene?: SceneId) => { const value = current(); if (value) { ownership().unlocked = true; value.unlock(scene); } }, setSpeechPlaying: (value: boolean) => { controller.current?.setSpeechPlaying(value); }, cue: (type: SoundCue, eventId: string) => { controller.current?.cue(type, eventId); } }), []);
  return { ...controls, state };
}
