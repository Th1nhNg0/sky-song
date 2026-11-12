import { getInstrument } from '../music/instruments';
import { lastNoteEnd } from '../music/project';
import { timingOf, type Timing } from '../music/timing';
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
  private timing: Timing;
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
  /** Set by an edit: the note list is rebuilt when it is next needed, not once per edit. */
  private stale = false;

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
    this.timing = timingOf(this.project);
    this.rebuildEvents();
  }

  get currentState(): TransportState {
    return this.state;
  }

  private rebuildEvents(): void {
    this.stale = false;
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
    this.timing = timingOf(project);
    const latency = (this.getSettings().latencyOffsetMs ?? 0) / 1000;
    const hardware = this.engine.outputLatencySeconds?.() ?? 0;
    this.latencySeconds = Math.max(0, latency + hardware);
    this.loopEvents = project.loop.enabled
      ? events.filter((event) => event.startBeat >= project.loop.startBeat && event.startBeat < project.loop.endBeat)
      : [];
    this.loopClicks = [];
    if (project.loop.enabled) {
      let beat = this.timing.nextClick(project.loop.startBeat);
      while (beat < project.loop.endBeat - EPSILON && this.loopClicks.length < 100000) {
        this.loopClicks.push(beat);
        beat = this.timing.nextClick(beat + 0.01);
      }
    }
  }

  /**
   * Brings the note list up to date after an edit. Dragging a note edits the song on every
   * pointer move, and sorting a long song each time is wasted while nothing reads the result.
   * During playback it carries on from what is already scheduled, so no note sounds twice.
   */
  private refresh(): void {
    if (!this.stale) return;
    this.rebuildEvents();
    if (this.state === 'playing') this.recomputeIndicesAfter(this.lastScheduledV);
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
    const previous = this.project;
    const timingChanged = project.bpm !== previous.bpm || project.tempoChanges !== previous.tempoChanges;
    const loopChanged =
      project.loop.enabled !== previous.loop.enabled ||
      project.loop.startBeat !== previous.loop.startBeat ||
      project.loop.endBeat !== previous.loop.endBeat;
    // Only a tempo or loop change during playback moves the transport; it needs to know
    // where playback was under the old settings. Any other edit just marks the notes stale.
    const moves = this.state === 'playing' && (loopChanged || timingChanged);
    const position = moves ? this.positionBeats() : 0;
    const virtual = moves ? this.currentVirtual(false) : 0;
    this.project = project;
    this.stale = true;
    if (moves && loopChanged) this.seek(position);
    else if (moves) this.retime(virtual);
  }

  /** Continues from the same musical position at a new tempo, leaving sounding notes alone. */
  private retime(virtual: number): void {
    this.refresh();
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
    this.nextClickV = this.timing.nextClick(virtual);
    this.tick();
  }

  /**
   * Seconds of music up to a virtual beat. Virtual beats run on past the loop's end, one
   * loop length per pass, and every pass takes as long as the looped stretch of the song,
   * whatever tempo changes it holds.
   */
  private secondsForVirtual(virtualBeat: number): number {
    const loop = this.project.loop;
    if (!loop.enabled) return this.timing.secondsAt(virtualBeat);
    const length = this.loopLength();
    const pass = Math.max(0, Math.floor((virtualBeat - loop.startBeat) / length));
    const passSeconds = this.timing.secondsBetween(loop.startBeat, loop.endBeat);
    return pass * passSeconds + this.timing.secondsAt(virtualBeat - pass * length);
  }

  private virtualForSeconds(seconds: number): number {
    const loop = this.project.loop;
    if (!loop.enabled) return this.timing.beatAt(seconds);
    const passSeconds = Math.max(1e-6, this.timing.secondsBetween(loop.startBeat, loop.endBeat));
    const pass = Math.max(0, Math.floor((seconds - this.timing.secondsAt(loop.startBeat)) / passSeconds));
    return pass * this.loopLength() + this.timing.beatAt(seconds - pass * passSeconds);
  }

  private timeForVirtual(virtualBeat: number): number {
    return this.anchorTime + this.secondsForVirtual(virtualBeat) - this.secondsForVirtual(this.anchorVirtual);
  }

  /** The virtual beat sounding at a clock time; the anchor itself until the clock reaches it. */
  private virtualAtTime(time: number): number {
    if (time <= this.anchorTime) return this.anchorVirtual;
    return this.virtualForSeconds(this.secondsForVirtual(this.anchorVirtual) + time - this.anchorTime);
  }

  private currentVirtual(useLatency: boolean): number {
    return this.virtualAtTime(this.clock() - (useLatency ? this.latencySeconds : 0));
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
      durationSeconds: this.timing.secondsBetween(event.startBeat, event.startBeat + durationBeats),
      velocity: event.velocity,
      seed: event.seed,
    });
  }

  private scheduleSampleClick(virtualBeat: number, songBeat: number): void {
    const settings = this.getSettings();
    if (!settings.metronomeEnabled) return;
    this.engine.scheduleClick(this.timeForVirtual(virtualBeat), this.timing.isBarLine(songBeat));
  }

  /** Beats of count-in before `start`, counted in the meter playback starts in. */
  private countInLength(start: number): number {
    const perMeasure = this.timing.meterSpanAt(start).barBeats;
    return Math.max(0, Math.round(this.getSettings().countInMeasures * perMeasure));
  }

  /** The count-in keeps the tempo and meter of the place playback starts from. */
  private scheduleCountIn(start: number): void {
    this.countInBeats = this.countInLength(start);
    if (this.countInBeats === 0) return;
    const perMeasure = this.timing.meterSpanAt(start).barBeats;
    const beatSeconds = 60 / this.timing.bpmAt(start);
    for (let i = 0; i < this.countInBeats; i++) {
      const time = this.anchorTime - (this.countInBeats - i) * beatSeconds;
      this.engine.scheduleClick(time, i % perMeasure === 0);
    }
  }

  play(fromBeat?: number): void {
    this.refresh();
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
    const lead = 0.09;
    this.anchorTime = this.clock() + lead + (this.countInLength(start) * 60) / this.timing.bpmAt(start);
    this.nextClickV = this.timing.nextClick(start);
    this.scheduleCountIn(start);
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
    this.refresh();
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
    this.rebuildEvents();
    this.nextClickV = this.timing.nextClick(target);
    if (wasPlaying) {
      this.tick();
      this.startTimer();
    } else {
      this.onStateChange?.(this.state);
    }
  }

  positionBeats(): number {
    if (this.state !== 'playing') return this.pausedBeat;
    this.refresh();
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
    this.refresh();
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
    const horizon = this.virtualAtTime(now + this.lookaheadSeconds);
    const loop = this.project.loop;
    if (loop.enabled) {
      this.scheduleLoop(horizon);
    } else {
      this.schedulePlain(horizon);
    }
    this.lastScheduledV = Math.max(this.lastScheduledV, horizon);
    if (now > this.anchorTime && now - this.latencySeconds > this.anchorTime) {
      const raw = this.virtualAtTime(now - this.latencySeconds);
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
      this.nextClickV = this.timing.nextClick(this.currentVirtual(false));
    }
    while (this.nextClickV <= horizon) {
      if (this.nextClickV >= this.anchorVirtual - EPSILON) {
        this.scheduleSampleClick(this.nextClickV, this.nextClickV);
      }
      this.nextClickV = this.timing.nextClick(this.nextClickV + 0.01);
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
    this.refresh();
    return {
      state: this.state,
      events: this.events.length,
      loopEvents: this.loopEvents.length,
      anchorVirtual: this.anchorVirtual,
      anchorTime: this.anchorTime,
      lastScheduledV: this.lastScheduledV,
      bps: this.timing.bpmAt(this.positionBeats()) / 60,
      droppedLate: this.droppedLate,
    };
  }

  dispose(): void {
    this.stopTimer();
    this.stopVoices();
  }
}
