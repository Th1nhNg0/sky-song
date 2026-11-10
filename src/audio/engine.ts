import { isTrackAudible } from '../music/project';
import { getInstrument } from '../music/instruments';
import type { InstrumentDefinition, Project } from '../music/types';
import {
  createBus,
  createMixGraph,
  reverbSendLevel,
  scheduleClick,
  type MixGraph,
  type VoiceGraph,
} from './graph';
import { getReverbImpulse } from './random';
import { ensureSoundPacksLoaded, trackSendLevel } from './sampleBank';
import { createNoteVoice, type SynthVoice } from './synth';

export interface ScheduledVoiceSpec {
  trackId: string;
  instrument: InstrumentDefinition;
  keyIndex: number;
  pad: number;
  startTime: number;
  durationSeconds: number;
  velocity: number;
  seed: string;
}

export interface PlaybackEngine {
  now(): number;
  scheduleVoice(spec: ScheduledVoiceSpec): void;
  scheduleClick(time: number, accent: boolean): void;
  stopAll(fadeSeconds?: number): void;
  /** Removes voices and clicks that have not started by the given time. */
  cancelPending?(afterTime: number): void;
  outputLatencySeconds?(): number;
}

interface ActiveVoice {
  voice: SynthVoice;
  startedAt: number;
  endTime: number;
  trackId: string;
}

export interface EngineOptions {
  reverbAmount?: number;
  masterVolume?: number;
  latencyHint?: 'interactive' | 'balanced' | 'playback';
}

export interface PadPlayOptions {
  durationSeconds?: number;
  velocity?: number;
  instrument: InstrumentDefinition;
  keyIndex: number;
  pad: number;
}

export interface PreviewHandle {
  stop: () => void;
}

/** Realtime Web Audio host for the shared synth voices. */
export class AudioEngine implements PlaybackEngine {
  ctx: AudioContext | null = null;
  graph: MixGraph | null = null;
  reverbAmount: number;
  masterVolume: number;
  private latencyHint: EngineOptions['latencyHint'];
  private buses = new Map<string, { bus: VoiceGraph; instrumentId: string }>();
  private active: ActiveVoice[] = [];
  private previewVoices: SynthVoice[] = [];
  private pendingClicks: { time: number; cancel: () => void }[] = [];
  private initPromise: Promise<void> | null = null;
  private unlockListenersAttached = false;
  lastError: string | null = null;

  constructor(options: EngineOptions = {}) {
    this.reverbAmount = options.reverbAmount ?? 0.24;
    this.masterVolume = options.masterVolume ?? 0.8;
    this.latencyHint = options.latencyHint ?? 'interactive';
  }

  get ready(): boolean {
    return Boolean(this.ctx && this.graph && this.ctx.state === 'running');
  }

  get state(): string {
    return this.ctx?.state ?? 'uninitialized';
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 0;
  }

  async init(): Promise<void> {
    if (this.ctx && this.graph) {
      if (this.ctx.state === 'suspended') {
        try {
          await this.ctx.resume();
        } catch {
          // Resume can fail without a gesture; callers surface the lock prompt.
        }
      }
      return;
    }
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) {
        this.lastError = 'This browser does not support the Web Audio API.';
        throw new Error(this.lastError);
      }
      try {
        await ensureSoundPacksLoaded();
        const ctx = new AudioCtor({ latencyHint: this.latencyHint });
        const graph = createMixGraph(ctx, {
          reverbAmount: this.reverbAmount,
          masterVolume: this.masterVolume,
        });
        graph.convolver.buffer = getReverbImpulse(ctx);
        this.ctx = ctx;
        this.graph = graph;
        if (ctx.state === 'suspended') {
          try {
            await ctx.resume();
          } catch {
            // The UI shows an unlock gate if the context stays suspended.
          }
        }
        this.attachUnlockListeners();
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : 'Could not start audio.';
        throw error;
      }
    })();
    return this.initPromise;
  }

  private attachUnlockListeners() {
    if (this.unlockListenersAttached || typeof window === 'undefined') return;
    this.unlockListenersAttached = true;
    const unlock = () => {
      void this.resume();
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
  }

  async resume(): Promise<boolean> {
    try {
      await this.init();
      if (this.ctx && this.ctx.state !== 'running') {
        await this.ctx.resume();
      }
      return this.ctx?.state === 'running';
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Audio could not be resumed.';
      return false;
    }
  }

  now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  outputLatencySeconds(): number {
    if (!this.ctx) return 0;
    const output = 'outputLatency' in this.ctx ? this.ctx.outputLatency : 0;
    return (output || 0) + (this.ctx.baseLatency || 0);
  }

  setReverbAmount(amount: number): void {
    this.reverbAmount = Math.min(1, Math.max(0, amount));
    if (!this.graph || !this.ctx) return;
    const at = this.ctx.currentTime;
    this.graph.reverbReturn.gain.setTargetAtTime(0.6 + this.reverbAmount * 1.1, at, 0.05);
    for (const { bus, instrumentId } of this.buses.values()) {
      const instrument = getInstrument(instrumentId);
      bus.send.gain.setTargetAtTime(trackSendLevel(this.reverbAmount, instrument), at, 0.05);
    }
    this.graph.previewBus.send.gain.setTargetAtTime(reverbSendLevel(this.reverbAmount, 0.22), at, 0.05);
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.min(1, Math.max(0, volume));
    if (!this.graph || !this.ctx) return;
    this.graph.masterIn.gain.setTargetAtTime(this.masterVolume * 0.9, this.ctx.currentTime, 0.05);
  }

  private getBus(trackId: string, instrumentId: string): VoiceGraph {
    if (!this.ctx || !this.graph) throw new Error('Audio engine is not initialized.');
    const existing = this.buses.get(trackId);
    const instrument = getInstrument(instrumentId);
    if (existing) {
      if (existing.instrumentId !== instrumentId) {
        existing.instrumentId = instrumentId;
        existing.bus.send.gain.setTargetAtTime(
          trackSendLevel(this.reverbAmount, instrument),
          this.ctx.currentTime,
          0.05,
        );
      }
      return existing.bus;
    }
    const bus = createBus(this.ctx, this.graph, trackSendLevel(this.reverbAmount, instrument));
    bus.trackGain.gain.value = 0.0001;
    this.buses.set(trackId, { bus, instrumentId });
    return bus;
  }

  /** Creates/updates track buses so mute, solo, volume and instrument changes apply live. */
  syncTracks(project: Project): void {
    if (!this.ctx || !this.graph) return;
    const at = this.ctx.currentTime;
    const liveIds = new Set(project.tracks.map((track) => track.id));
    for (const [trackId, entry] of this.buses) {
      if (!liveIds.has(trackId)) {
        entry.bus.trackGain.gain.setTargetAtTime(0.0001, at, 0.03);
        entry.bus.send.gain.setTargetAtTime(0, at, 0.03);
        this.buses.delete(trackId);
      }
    }
    for (const track of project.tracks) {
      const bus = this.getBus(track.id, track.instrumentId);
      const audible = isTrackAudible(project, track);
      const target = audible ? Math.max(0.0001, track.volume) : 0.0001;
      bus.trackGain.gain.setTargetAtTime(target, at, 0.02);
      bus.send.gain.setTargetAtTime(
        trackSendLevel(this.reverbAmount, getInstrument(track.instrumentId)),
        at,
        0.05,
      );
    }
  }

  private prune(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.active = this.active.filter((entry) => entry.endTime > now - 0.2);
    if (this.active.length > 240) {
      const steal = this.active.slice(0, this.active.length - 200);
      for (const entry of steal) entry.voice.stop(now);
      this.active = this.active.slice(steal.length);
    }
  }

  scheduleVoice(spec: ScheduledVoiceSpec): void {
    if (!this.ctx || !this.graph) return;
    this.prune();
    const bus = this.getBus(spec.trackId, spec.instrument.id);
    const voice = createNoteVoice(this.ctx, {
      instrument: spec.instrument,
      keyIndex: spec.keyIndex,
      pad: spec.pad,
      startTime: spec.startTime,
      durationSeconds: spec.durationSeconds,
      velocity: spec.velocity,
      seed: spec.seed,
      destination: bus.input,
    });
    this.active.push({
      voice,
      startedAt: spec.startTime,
      endTime: voice.endTime,
      trackId: spec.trackId,
    });
  }

  scheduleClick(time: number, accent: boolean): void {
    if (!this.ctx || !this.graph) return;
    const now = this.ctx.currentTime;
    this.pendingClicks = this.pendingClicks.filter((click) => click.time > now);
    this.pendingClicks.push({ time, cancel: scheduleClick(this.ctx, this.graph.clickBus, time, accent) });
  }

  cancelPending(afterTime: number): void {
    if (!this.ctx) return;
    const stopAt = this.ctx.currentTime;
    this.active = this.active.filter((entry) => {
      if (entry.startedAt <= afterTime) return true;
      entry.voice.stop(stopAt);
      return false;
    });
    this.pendingClicks = this.pendingClicks.filter((click) => {
      if (click.time <= afterTime) return true;
      click.cancel();
      return false;
    });
  }

  stopAll(fadeSeconds = 0.04): void {
    if (!this.ctx) return;
    const at = this.ctx.currentTime + Math.max(0.005, fadeSeconds);
    for (const entry of this.active) {
      entry.voice.stop(at);
    }
    for (const voice of this.previewVoices) {
      voice.stop(at);
    }
    for (const click of this.pendingClicks) click.cancel();
    this.active = [];
    this.previewVoices = [];
    this.pendingClicks = [];
  }

  /** Plays a pad immediately (live performance / audition). */
  playPad(options: PadPlayOptions): PreviewHandle {
    const { instrument, keyIndex, pad } = options;
    if (!this.ctx || !this.graph) {
      return { stop: () => undefined };
    }
    const duration = options.durationSeconds ?? 0.6;
    const voice = createNoteVoice(this.ctx, {
      instrument,
      keyIndex,
      pad,
      startTime: this.ctx.currentTime + 0.005,
      durationSeconds: duration,
      velocity: options.velocity ?? 0.85,
      seed: `live:${instrument.id}:${pad}:${performance.now().toFixed(1)}`,
      destination: this.graph.previewBus.input,
    });
    this.previewVoices.push(voice);
    if (this.previewVoices.length > 48) {
      const old = this.previewVoices.splice(0, this.previewVoices.length - 40);
      for (const item of old) item.stop();
    }
    return { stop: () => voice.stop() };
  }

  /** Short phrase so every catalog entry can be heard before choosing it. */
  audition(instrumentId: string, keyIndex: number): PreviewHandle {
    const instrument = getInstrument(instrumentId);
    const pads = instrument.pads.length;
    const phrase = pads >= 8 ? [0, Math.floor(pads / 2), Math.min(pads - 1, Math.floor(pads / 2) + 2), pads - 1] : [0, 1, pads - 1];
    const handles: PreviewHandle[] = [];
    const start = this.now() + 0.04;
    if (!this.ctx) return { stop: () => undefined };
    phrase.forEach((pad, index) => {
      const at = start + index * 0.22;
      const delay = Math.max(0, at - this.ctx!.currentTime);
      window.setTimeout(() => {
        const handle = this.playPad({
          instrument,
          keyIndex,
          pad,
          velocity: 0.8,
          durationSeconds: 0.5,
        });
        handles.push(handle);
      }, delay * 1000);
    });
    return {
      stop: () => {
        for (const handle of handles) handle.stop();
      },
    };
  }

  async dispose(): Promise<void> {
    this.stopAll();
    this.buses.clear();
    if (this.ctx) {
      try {
        await this.ctx.close();
      } catch {
        // ignore
      }
    }
    this.ctx = null;
    this.graph = null;
    this.initPromise = null;
  }

  getDebugInfo(): {
    state: string;
    sampleRate: number;
    activeVoices: number;
    previewVoices: number;
    tracks: string[];
    reverbAmount: number;
    masterVolume: number;
  } {
    return {
      state: this.state,
      sampleRate: this.sampleRate,
      activeVoices: this.active.length,
      previewVoices: this.previewVoices.length,
      tracks: [...this.buses.keys()],
      reverbAmount: this.reverbAmount,
      masterVolume: this.masterVolume,
    };
  }
}
