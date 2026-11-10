import { getInstrument } from '../music/instruments';
import { lastNoteEnd } from '../music/project';
import { beatsPerMeasure, beatsToSeconds } from '../music/time';
import type { Project } from '../music/types';
import type { PlaybackEngine } from './engine';
import { createTicker, type Ticker } from './ticker';

export type TransportState = 'stopped' | 'playing' | 'paused';

interface ScheduledEvent {
  trackId: string;
  instrumentId: string;
  keyIndex: number;
  pad: number;
  startBeat: number;
  durationBeats: number;
  velocity: number;
  seed: string;
}

export interface TransportSettings {
  metronomeEnabled: boolean;
  countInMeasures: number;
  latencyOffsetMs: number;
}

export interface TransportOptions {
  engine: PlaybackEngine;
  getProject: () => Project;
  getSettings: () => TransportSettings;
  onStateChange?: (state: TransportState) => void;
  lookaheadSeconds?: number;
  tickIntervalMs?: number;
  /** Tests inject a clock and disable the timer. */
  now?: () => number;
  manualTick?: boolean;
}

const EPSILON = 1e-7;
/** A note this overdue after a stall is skipped: bunching it up would sound worse than a gap. */
const MAX_LATE_SECONDS = 0.08;

function mod(value: number, base: number): number {
  return ((value % base) + base) % base;
}

export class Transport {
  private engine: PlaybackEngine;
  private getProject: () => Project;
  private getSettings: () => TransportSettings;
  private onStateChange?: (state: TransportState) => void;
  private lookaheadSeconds: number;
  private tickIntervalMs: number;
  private clock: () => number;
  private manualTick: boolean;
  private ticker: Ticker | null = null;

  private state: TransportState = 'stopped';
  private project: Project;
  private events: ScheduledEvent[] = [];
  private loopEvents: ScheduledEvent[] = [];
  private contentEndBeat = 16;
  private anchorVirtual = 0;
  private anchorTime = 0;
  private pausedBeat = 0;
  private bps = 2;
  private latencySeconds = 0;
  private countInBeats = 0;

  private plainIndex = 0;
  private loopIndex = 0;
  private loopBase = 0;
  private loopClickIndex = 0;
  private loopClicks: number[] = [];
  private nextClickV = 0;
  private lastScheduledV = 0;
  private firedLoopIterations = 0;
  private lastTickAt = 0;
  private droppedLate = 0;

  constructor(options: TransportOptions) {
    this.engine = options.engine;
    this.getProject = options.getProject;
    this.getSettings = options.getSettings;
    this.onStateChange = options.onStateChange;
    this.lookaheadSeconds = options.lookaheadSeconds ?? 0.2;
    this.tickIntervalMs = options.tickIntervalMs ?? 25;
    this.clock = options.now ?? (() => this.engine.now());
    this.manualTick = options.manualTick ?? false;
    this.project = this.getProject();
    this.rebuild();
  }

  get currentState(): TransportState {
    return this.state;
  }

  private rebuildEvents(): void {
    const project = this.project;
    const keyIndex = project.key;
    const events: ScheduledEvent[] = [];
    for (const track of project.tracks) {
      const instrument = getInstrument(track.instrumentId);
      for (const note of track.notes) {
        events.push({
          trackId: track.id,
          instrumentId: instrument.id,
          keyIndex,
          pad: note.pad,
          startBeat: note.startBeat,
          durationBeats: note.durationBeats,
          velocity: note.velocity,
          seed: `${project.id}:${track.id}:${note.id}`,
        });
      }
    }
    events.sort((a, b) => a.startBeat - b.startBeat || a.pad - b.pad);
    this.events = events;
    this.contentEndBeat = Math.max(4, Math.ceil(lastNoteEnd(project)));
    this.bps = project.bpm / 60;
    const latency = (this.getSettings().latencyOffsetMs ?? 0) / 1000;
    const hardware = this.engine.outputLatencySeconds?.() ?? 0;
    this.latencySeconds = Math.max(0, latency + hardware);
    this.loopEvents = project.loop.enabled
      ? events.filter((event) => event.startBeat >= project.loop.startBeat && event.startBeat < project.loop.endBeat)
      : [];
    const clickStart = Math.ceil(project.loop.startBeat - EPSILON);
    const clickEnd = Math.ceil(project.loop.endBeat - EPSILON);
    this.loopClicks = [];
    for (let beat = clickStart; beat < clickEnd; beat++) this.loopClicks.push(beat);
  }

  private rebuild(): void {
    const previousLoopBase = this.loopBase;
    const previousScheduled = this.lastScheduledV;
    this.rebuildEvents();
    if (this.state === 'playing') {
      this.loopBase = previousLoopBase;
      this.recomputeIndicesAfter(previousScheduled);
    }
  }

  /** After a live project change, continue without re-triggering already scheduled notes. */
  private recomputeIndicesAfter(virtualBeat: number): void {
    const loop = this.project.loop;
    if (loop.enabled) {
      let index = 0;
      while (index < this.loopEvents.length && this.loopBase + this.loopEvents[index].startBeat <= virtualBeat + EPSILON) {
        index++;
      }
      this.loopIndex = index;
      let clickIndex = 0;
      while (
        clickIndex < this.loopClicks.length &&
        this.loopBase + this.loopClicks[clickIndex] <= virtualBeat + EPSILON
      ) {
        clickIndex++;
      }
      this.loopClickIndex = clickIndex;
    } else {
      let index = 0;
      while (index < this.events.length && this.events[index].startBeat <= virtualBeat + EPSILON) {
        index++;
      }
      this.plainIndex = index;
    }
  }

  setProject(project: Project): void {
    const wasPlaying = this.state === 'playing';
    const previous = this.project;
    const position = this.positionBeats();
    const virtual = wasPlaying ? this.currentVirtual(false) : 0;
    const timingChanged = project.bpm !== previous.bpm;
    const loopChanged =
      project.loop.enabled !== previous.loop.enabled ||
      project.loop.startBeat !== previous.loop.startBeat ||
      project.loop.endBeat !== previous.loop.endBeat;
    this.project = project;
    this.rebuild();
    if (wasPlaying && loopChanged) this.seek(position);
    else if (wasPlaying && timingChanged) this.retime(virtual);
  }

  /** Continues from the same musical position at a new tempo, leaving sounding notes alone. */
  private retime(virtual: number): void {
    const now = this.clock();
    if (now < this.anchorTime) {
      this.seek(this.anchorVirtual);
      return;
    }
    this.engine.cancelPending?.(now);
    this.anchorVirtual = virtual;
    this.anchorTime = now;
    this.lastScheduledV = virtual;
    this.recomputeIndicesAfter(virtual);
    this.nextClickV = Math.ceil(virtual - EPSILON);
    this.tick();
  }

  private timeForVirtual(virtualBeat: number): number {
    return this.anchorTime + (virtualBeat - this.anchorVirtual) / this.bps;
  }

  private currentVirtual(useLatency: boolean): number {
    const now = this.clock() - (useLatency ? this.latencySeconds : 0);
    return this.anchorVirtual + Math.max(0, now - this.anchorTime) * this.bps;
  }

  private loopLength(): number {
    return Math.max(0.001, this.project.loop.endBeat - this.project.loop.startBeat);
  }

  private scheduleEvent(event: ScheduledEvent, virtualBeat: number): void {
    const loop = this.project.loop;
    const startTime = this.timeForVirtual(virtualBeat);
    if (this.clock() - startTime > MAX_LATE_SECONDS) {
      this.droppedLate++;
      return;
    }
    let durationBeats = event.durationBeats;
    if (loop.enabled) {
      const remaining = loop.endBeat - event.startBeat;
      durationBeats = Math.min(durationBeats, Math.max(0.05, remaining));
    }
    this.engine.scheduleVoice({
      trackId: event.trackId,
      instrument: getInstrument(event.instrumentId),
      keyIndex: event.keyIndex,
      pad: event.pad,
      startTime,
      durationSeconds: beatsToSeconds(durationBeats, this.project.bpm),
      velocity: event.velocity,
      seed: event.seed,
    });
  }

  private scheduleSampleClick(virtualBeat: number, songBeat: number): void {
    const settings = this.getSettings();
    if (!settings.metronomeEnabled) return;
    const perMeasure = beatsPerMeasure(this.project.timeSignature);
    const accent = Math.abs(mod(songBeat, perMeasure)) < EPSILON;
    this.engine.scheduleClick(this.timeForVirtual(virtualBeat), accent);
  }

  private scheduleCountIn(): void {
    this.countInBeats = Math.max(
      0,
      Math.round(this.getSettings().countInMeasures * beatsPerMeasure(this.project.timeSignature)),
    );
    if (this.countInBeats === 0) return;
    const perMeasure = beatsPerMeasure(this.project.timeSignature);
    for (let i = 0; i < this.countInBeats; i++) {
      const beatOffset = this.countInBeats - i;
      const time = this.anchorTime - beatsToSeconds(beatOffset, this.project.bpm);
      this.engine.scheduleClick(time, i % perMeasure === 0);
    }
  }

  play(fromBeat?: number): void {
    const settings = this.getSettings();
    const loop = this.project.loop;
    let start = fromBeat ?? this.pausedBeat;
    if (fromBeat === undefined && !loop.enabled && start >= this.contentEndBeat - 0.01) start = 0;
    if (loop.enabled) {
      if (start < loop.startBeat || start >= loop.endBeat) start = loop.startBeat;
    } else {
      start = Math.max(0, Math.min(start, this.contentEndBeat));
    }
    if (this.state === 'playing') this.stopVoices();
    this.state = 'playing';
    this.anchorVirtual = start;
    this.lastScheduledV = start - EPSILON;
    this.pausedBeat = start;
    this.loopBase = 0;
    this.plainIndex = 0;
    this.loopIndex = 0;
    this.loopClickIndex = 0;
    this.firedLoopIterations = 0;
    this.lastTickAt = 0;
    this.countInBeats = 0;
    this.rebuildEvents();
    const countIn = Math.max(0, settings.countInMeasures) * beatsPerMeasure(this.project.timeSignature);
    const lead = 0.09;
    this.anchorTime = this.clock() + lead + beatsToSeconds(countIn, this.project.bpm);
    this.nextClickV = Math.ceil(start - EPSILON);
    this.scheduleCountIn();
    this.onStateChange?.('playing');
    this.tick();
    this.startTimer();
  }

  private startTimer(): void {
    if (this.manualTick || typeof window === 'undefined') return;
    this.stopTimer();
    this.ticker = createTicker(() => this.tick(), this.tickIntervalMs);
  }

  private stopTimer(): void {
    this.ticker?.stop();
    this.ticker = null;
  }

  private stopVoices(): void {
    this.engine.stopAll();
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.pausedBeat = this.positionBeats();
    this.stopTimer();
    this.stopVoices();
    this.state = 'paused';
    this.onStateChange?.('paused');
  }

  stop(): void {
    this.stopTimer();
    this.stopVoices();
    this.state = 'stopped';
    const loop = this.project.loop;
    this.pausedBeat = loop.enabled ? loop.startBeat : 0;
    this.anchorVirtual = this.pausedBeat;
    this.anchorTime = this.clock();
    this.onStateChange?.('stopped');
  }

  seek(beat: number): void {
    const loop = this.project.loop;
    const wasPlaying = this.state === 'playing';
    let target = Math.max(0, beat);
    // A stopped cursor may rest anywhere; only a running transport has to stay in range.
    if (wasPlaying) {
      target = loop.enabled
        ? Math.min(Math.max(loop.startBeat, target), loop.endBeat - 0.001)
        : Math.min(target, this.contentEndBeat);
    }
    if (wasPlaying) {
      this.stopVoices();
      this.state = 'playing';
    }
    this.pausedBeat = target;
    this.anchorVirtual = target;
    this.lastScheduledV = target - EPSILON;
    this.anchorTime = this.clock() + 0.05;
    this.loopBase = 0;
    this.plainIndex = 0;
    this.loopIndex = 0;
    this.loopClickIndex = 0;
    this.lastTickAt = 0;
    this.nextClickV = Math.ceil(target - EPSILON);
    this.rebuildEvents();
    if (wasPlaying) {
      this.tick();
      this.startTimer();
    } else {
      this.onStateChange?.(this.state);
    }
  }

  positionBeats(): number {
    if (this.state !== 'playing') return this.pausedBeat;
    const now = this.clock();
    if (now < this.anchorTime) return this.anchorVirtual;
    const virtual = this.currentVirtual(true);
    const loop = this.project.loop;
    if (loop.enabled) {
      const length = this.loopLength();
      return loop.startBeat + mod(virtual - loop.startBeat, length);
    }
    return Math.min(virtual, this.contentEndBeat);
  }

  /** True while the count-in is still running. */
  inCountIn(): boolean {
    return this.countInBeats > 0 && this.clock() < this.anchorTime;
  }

  tick(): void {
    if (this.state !== 'playing') return;
    const now = this.clock();
    // After a background-tab suspension, do not dump minutes of missed notes into
    // the lookahead window. Re-anchor and keep the musical position instead.
    if (this.lastTickAt > 0 && now - this.lastTickAt > 5) {
      const position = this.positionBeats();
      this.lastTickAt = now;
      this.seek(position);
      return;
    }
    this.lastTickAt = now;
    if (now + this.lookaheadSeconds < this.anchorTime) return;
    const horizon = this.anchorVirtual + (now + this.lookaheadSeconds - this.anchorTime) * this.bps;
    const loop = this.project.loop;
    if (loop.enabled) {
      this.scheduleLoop(horizon);
    } else {
      this.schedulePlain(horizon);
    }
    this.lastScheduledV = Math.max(this.lastScheduledV, horizon);
    if (now > this.anchorTime && now - this.latencySeconds > this.anchorTime) {
      const raw = this.anchorVirtual + (now - this.latencySeconds - this.anchorTime) * this.bps;
      if (!loop.enabled && raw > this.contentEndBeat + 0.05) {
        this.finishAtEnd();
      }
    }
  }

  private schedulePlain(horizon: number): void {
    while (this.plainIndex < this.events.length) {
      const event = this.events[this.plainIndex];
      if (event.startBeat > horizon) break;
      if (event.startBeat < this.anchorVirtual - EPSILON) {
        this.plainIndex++;
        continue;
      }
      this.scheduleEvent(event, event.startBeat);
      this.plainIndex++;
    }
    const settings = this.getSettings();
    if (!settings.metronomeEnabled) return;
    if (this.nextClickV < this.currentVirtual(false) - 2) {
      this.nextClickV = Math.ceil(this.currentVirtual(false) - EPSILON);
    }
    while (this.nextClickV <= horizon) {
      if (this.nextClickV >= this.anchorVirtual - EPSILON) {
        this.scheduleSampleClick(this.nextClickV, this.nextClickV);
      }
      this.nextClickV += 1;
    }
  }

  private scheduleLoop(horizon: number): void {
    const length = this.loopLength();
    let guard = 0;
    // Determine the cycle that contains the scheduling horizon; advance as needed.
    while (guard++ < 2000) {
      const cycleStart = this.loopBase;
      const cycleEnd = cycleStart + this.project.loop.endBeat;
      while (this.loopIndex < this.loopEvents.length) {
        const event = this.loopEvents[this.loopIndex];
        const virtual = cycleStart + event.startBeat;
        if (virtual > horizon) break;
        if (virtual >= this.anchorVirtual - EPSILON) {
          this.scheduleEvent(event, virtual);
        }
        this.loopIndex++;
      }
      const settings = this.getSettings();
      if (settings.metronomeEnabled) {
        while (this.loopClickIndex < this.loopClicks.length) {
          const beat = this.loopClicks[this.loopClickIndex];
          const virtual = cycleStart + beat;
          if (virtual > horizon) break;
          if (virtual >= this.anchorVirtual - EPSILON) {
            this.scheduleSampleClick(virtual, beat);
          }
          this.loopClickIndex++;
        }
      }
      if (cycleEnd > horizon) break;
      this.loopBase += length;
      this.loopIndex = 0;
      this.loopClickIndex = 0;
      this.firedLoopIterations++;
      if (this.firedLoopIterations > 100000) break;
    }
  }

  private finishAtEnd(): void {
    this.stopTimer();
    this.state = 'paused';
    this.pausedBeat = this.contentEndBeat;
    this.onStateChange?.('paused');
  }

  getScheduledDiagnostics(): {
    state: TransportState;
    events: number;
    loopEvents: number;
    anchorVirtual: number;
    anchorTime: number;
    lastScheduledV: number;
    bps: number;
    droppedLate: number;
  } {
    return {
      state: this.state,
      events: this.events.length,
      loopEvents: this.loopEvents.length,
      anchorVirtual: this.anchorVirtual,
      anchorTime: this.anchorTime,
      lastScheduledV: this.lastScheduledV,
      bps: this.bps,
      droppedLate: this.droppedLate,
    };
  }

  dispose(): void {
    this.stopTimer();
    this.stopVoices();
  }
}
