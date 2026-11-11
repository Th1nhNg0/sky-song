import { isTrackAudible } from '../music/project';
import { getInstrument } from '../music/instruments';
import type { InstrumentDefinition, Project } from '../music/types';
import { clamp } from '../util';
import {
  createBus,
  createMixGraph,
  reverbSendLevel,
  scheduleClick,
  type MixGraph,
  type VoiceGraph,
} from './graph';
import { DEFAULT_REVERB_SPACE, getReverbImpulse, getReverbSpace, type ReverbSpaceId } from './reverb';
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
  reverbSpace?: ReverbSpaceId;
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

/** How long a request to start sound is waited on. Without a gesture some browsers never answer it. */
const WAKE_PATIENCE_MS = 1200;
/** How long the reverb is faded down for while one space's impulse replaces another's. */
const SPACE_SWAP_MS = 70;
/** What a phone counts as a gesture: lifting a finger or a click, never the touch going down. */
const UNLOCK_EVENTS = ['pointerup', 'touchend', 'click', 'keydown'] as const;

/** iPhones silence Web Audio while the ringer switch is off, unless the page says it plays media. */
function claimPlaybackSession(): void {
  if (typeof navigator === 'undefined') return;
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (!session) return;
  try {
    session.type = 'playback';
  } catch {
    // Older Safari: the ringer switch keeps its say.
  }
}

/** Realtime Web Audio host for the shared synth voices. */
export class AudioEngine implements PlaybackEngine {
  ctx: AudioContext | null = null;
  graph: MixGraph | null = null;
  reverbAmount: number;
  reverbSpace: ReverbSpaceId;
  masterVolume: number;
  private spaceSwap: number | null = null;
  private latencyHint: EngineOptions['latencyHint'];
  private buses = new Map<string, { bus: VoiceGraph; instrumentId: string }>();
  private active: ActiveVoice[] = [];
  private previewVoices: SynthVoice[] = [];
  private pendingClicks: { time: number; cancel: () => void }[] = [];
  private unlockListenersAttached = false;
  lastError: string | null = null;

  constructor(options: EngineOptions = {}) {
    this.reverbAmount = options.reverbAmount ?? 0.24;
    this.reverbSpace = options.reverbSpace ?? DEFAULT_REVERB_SPACE;
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

  /**
   * Builds the audio graph. Nothing here waits, so when a tap calls it the context is
   * created and started inside that tap: the only moment a phone lets sound begin.
   */
  private create(): void {
    if (this.ctx && this.graph) return;
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) {
      this.lastError = 'This browser does not support the Web Audio API.';
      throw new Error(this.lastError);
    }
    try {
      claimPlaybackSession();
      const ctx = new AudioCtor({ latencyHint: this.latencyHint });
      const graph = createMixGraph(ctx, {
        reverbAmount: this.reverbAmount,
        masterVolume: this.masterVolume,
      });
      graph.convolver.buffer = getReverbImpulse(ctx, this.reverbSpace);
      this.ctx = ctx;
      this.graph = graph;
      this.attachUnlockListeners();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Could not start audio.';
      throw error;
    }
  }

  /** Asks a context that is not running to start: suspended at first, or interrupted by a call. */
  private async wake(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running') return;
    try {
      await Promise.race([ctx.resume(), new Promise((resolve) => setTimeout(resolve, WAKE_PATIENCE_MS))]);
    } catch {
      // Resume can fail without a gesture; callers surface the lock prompt.
    }
  }

  async init(): Promise<void> {
    this.create();
    await this.wake();
  }

  /** Any later gesture starts a context the browser held back, or one a phone call interrupted. */
  private attachUnlockListeners() {
    if (this.unlockListenersAttached || typeof window === 'undefined') return;
    this.unlockListenersAttached = true;
    const unlock = () => {
      if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
    };
    for (const type of UNLOCK_EVENTS) window.addEventListener(type, unlock, { capture: true, passive: true });
  }

  async resume(): Promise<boolean> {
    try {
      await this.init();
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
    this.reverbAmount = clamp(amount, 0, 1);
    if (!this.graph || !this.ctx) return;
    const at = this.ctx.currentTime;
    if (this.spaceSwap === null) this.graph.reverbReturn.gain.setTargetAtTime(this.reverbReturnLevel(), at, 0.05);
    for (const { bus, instrumentId } of this.buses.values()) {
      const instrument = getInstrument(instrumentId);
      bus.send.gain.setTargetAtTime(reverbSendLevel(this.reverbAmount, instrument.reverbSend), at, 0.05);
    }
    this.graph.previewBus.send.gain.setTargetAtTime(reverbSendLevel(this.reverbAmount, 0.22), at, 0.05);
  }

  private reverbReturnLevel(): number {
    return (0.6 + this.reverbAmount * 1.1) * getReverbSpace(this.reverbSpace).level;
  }

  /** Moves the song into another space. Tails still ringing in the old one are faded out, not cut. */
  setReverbSpace(space: ReverbSpaceId): void {
    if (space === this.reverbSpace) return;
    this.reverbSpace = space;
    const { ctx, graph } = this;
    if (!ctx || !graph) return;
    const wet = graph.reverbReturn.gain;
    wet.cancelScheduledValues(ctx.currentTime);
    wet.setTargetAtTime(0, ctx.currentTime, SPACE_SWAP_MS / 5000);
    if (this.spaceSwap !== null) window.clearTimeout(this.spaceSwap);
    this.spaceSwap = window.setTimeout(() => {
      this.spaceSwap = null;
      if (this.ctx !== ctx) return;
      graph.convolver.buffer = getReverbImpulse(ctx, this.reverbSpace);
      wet.setTargetAtTime(this.reverbReturnLevel(), ctx.currentTime, 0.05);
    }, SPACE_SWAP_MS);
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = clamp(volume, 0, 1);
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
          reverbSendLevel(this.reverbAmount, instrument.reverbSend),
          this.ctx.currentTime,
          0.05,
        );
      }
      return existing.bus;
    }
    const bus = createBus(this.ctx, this.graph, reverbSendLevel(this.reverbAmount, instrument.reverbSend));
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
        reverbSendLevel(this.reverbAmount, getInstrument(track.instrumentId).reverbSend),
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
    if (this.spaceSwap !== null) window.clearTimeout(this.spaceSwap);
    this.spaceSwap = null;
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
  }

  getDebugInfo(): {
    state: string;
    sampleRate: number;
    activeVoices: number;
    previewVoices: number;
    tracks: string[];
    reverbAmount: number;
    reverbSpace: ReverbSpaceId;
    masterVolume: number;
  } {
    return {
      state: this.state,
      sampleRate: this.sampleRate,
      activeVoices: this.active.length,
      previewVoices: this.previewVoices.length,
      tracks: [...this.buses.keys()],
      reverbAmount: this.reverbAmount,
      reverbSpace: this.reverbSpace,
      masterVolume: this.masterVolume,
    };
  }
}
