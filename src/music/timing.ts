import { beatsPerMeasure, clampBpm, TIME_SIGNATURES } from './time';
import type { MeterChange, Project, TempoChange } from './types';

/** The parts of a song that say how fast it goes and how its bars are counted. */
export type TimingSource = Pick<Project, 'bpm' | 'timeSignature' | 'tempoChanges' | 'meterChanges'>;

/** A stretch of the song at one tempo. */
interface TempoSpan {
  beat: number;
  bpm: number;
  /** Seconds from the start of the song to `beat`. */
  seconds: number;
}

/** A stretch of the song in one meter. It always starts on a bar line. */
export interface MeterSpan {
  beat: number;
  /** Where the span ends: the next meter change, or Infinity. */
  end: number;
  /** 0-based number of the bar that starts at `beat`. */
  bar: number;
  meter: [number, number];
  barBeats: number;
}

export interface BarPosition {
  /** 0-based bar number. */
  bar: number;
  /** Beat where that bar starts. */
  start: number;
  /** Beats into the bar. */
  beat: number;
  span: MeterSpan;
}

/** A project file holds at most this many changes of each kind. */
export const MAX_TIMING_CHANGES = 256;

const EPSILON = 1e-6;
// Triplet grids land a hair under a bar line (3.9999999999999996); rounding keeps them in the right bar.
const tidy = (beat: number) => Math.max(0, Math.round(beat * 1e6) / 1e6);

function knownMeter(meter: readonly number[] | undefined): [number, number] | null {
  return TIME_SIGNATURES.find((option) => option.value[0] === meter?.[0] && option.value[1] === meter?.[1])?.value ?? null;
}

/**
 * Tempo changes in order, one per beat, without any that change nothing. A change at
 * beat 0 is not a change: that tempo is the song's `bpm`.
 */
export function normalizeTempoChanges(baseBpm: number, changes: readonly TempoChange[] | undefined): TempoChange[] {
  const byBeat = new Map<number, number>();
  for (const change of changes ?? []) {
    if (!Number.isFinite(change.beat) || !Number.isFinite(change.bpm) || change.beat < EPSILON) continue;
    byBeat.set(tidy(change.beat), clampBpm(change.bpm));
  }
  const result: TempoChange[] = [];
  let current = baseBpm;
  for (const beat of [...byBeat.keys()].sort((a, b) => a - b)) {
    const bpm = byBeat.get(beat)!;
    if (bpm === current) continue;
    result.push({ beat, bpm });
    current = bpm;
  }
  return result.slice(0, MAX_TIMING_CHANGES);
}

/**
 * Meter changes in order, each moved to the nearest bar line of the meter before it, since
 * a bar cannot change meter part-way through. Changes that change nothing are dropped.
 */
export function normalizeMeterChanges(
  baseMeter: [number, number],
  changes: readonly MeterChange[] | undefined,
): MeterChange[] {
  const valid = (changes ?? [])
    .filter((change) => Number.isFinite(change.beat) && change.beat >= EPSILON && knownMeter(change.timeSignature))
    .sort((a, b) => a.beat - b.beat);
  const result: MeterChange[] = [];
  let start = 0;
  let meter = baseMeter;
  for (const change of valid) {
    const barBeats = beatsPerMeasure(meter);
    const beat = tidy(start + Math.round((change.beat - start) / barBeats) * barBeats);
    const next = knownMeter(change.timeSignature)!;
    const last = result[result.length - 1];
    if (last && beat <= last.beat + EPSILON) {
      // Two changes on one bar line: the later one wins.
      result.pop();
      meter = result.length > 0 ? result[result.length - 1].timeSignature : baseMeter;
    } else if (beat <= start + EPSILON) {
      continue;
    }
    if (next[0] === meter[0] && next[1] === meter[1]) continue;
    result.push({ beat, timeSignature: [next[0], next[1]] });
    start = beat;
    meter = next;
  }
  return result.slice(0, MAX_TIMING_CHANGES);
}

/** Answers "when is this beat" and "which bar is this" for a song whose tempo and meter may change. */
export class Timing {
  readonly tempos: TempoSpan[];
  readonly meters: MeterSpan[];
  /** Every place the tempo or meter changes after the start, in order. */
  readonly points: TimingPoint[];

  constructor(source: TimingSource) {
    this.points = timingPoints(source);
    this.tempos = [{ beat: 0, bpm: source.bpm, seconds: 0 }];
    for (const change of normalizeTempoChanges(source.bpm, source.tempoChanges)) {
      const previous = this.tempos[this.tempos.length - 1];
      this.tempos.push({
        beat: change.beat,
        bpm: change.bpm,
        seconds: previous.seconds + ((change.beat - previous.beat) * 60) / previous.bpm,
      });
    }
    const first: MeterSpan = {
      beat: 0,
      end: Infinity,
      bar: 0,
      meter: source.timeSignature,
      barBeats: beatsPerMeasure(source.timeSignature),
    };
    this.meters = [first];
    for (const change of normalizeMeterChanges(source.timeSignature, source.meterChanges)) {
      const previous = this.meters[this.meters.length - 1];
      previous.end = change.beat;
      this.meters.push({
        beat: change.beat,
        end: Infinity,
        bar: previous.bar + Math.round((change.beat - previous.beat) / previous.barBeats),
        meter: change.timeSignature,
        barBeats: beatsPerMeasure(change.timeSignature),
      });
    }
  }

  /** True when the song keeps one tempo and one meter throughout. */
  get steady(): boolean {
    return this.tempos.length === 1 && this.meters.length === 1;
  }

  private tempoSpanAt(beat: number): TempoSpan {
    let index = this.tempos.length - 1;
    while (index > 0 && this.tempos[index].beat > beat + EPSILON) index--;
    return this.tempos[index];
  }

  bpmAt(beat: number): number {
    return this.tempoSpanAt(beat).bpm;
  }

  /** Seconds from the start of the song to `beat`. */
  secondsAt(beat: number): number {
    let index = this.tempos.length - 1;
    while (index > 0 && this.tempos[index].beat > beat) index--;
    const span = this.tempos[index];
    return span.seconds + ((beat - span.beat) * 60) / span.bpm;
  }

  /** The beat reached `seconds` into the song. */
  beatAt(seconds: number): number {
    let index = this.tempos.length - 1;
    while (index > 0 && this.tempos[index].seconds > seconds) index--;
    const span = this.tempos[index];
    return span.beat + ((seconds - span.seconds) * span.bpm) / 60;
  }

  /** How long a stretch of beats lasts, wherever tempo changes fall inside it. */
  secondsBetween(fromBeat: number, toBeat: number): number {
    return this.secondsAt(toBeat) - this.secondsAt(fromBeat);
  }

  meterSpanAt(beat: number): MeterSpan {
    const safe = tidy(beat);
    let index = this.meters.length - 1;
    while (index > 0 && this.meters[index].beat > safe) index--;
    return this.meters[index];
  }

  meterAt(beat: number): [number, number] {
    return this.meterSpanAt(beat).meter;
  }

  barAt(beat: number): BarPosition {
    const safe = tidy(beat);
    const span = this.meterSpanAt(safe);
    const into = Math.floor((safe - span.beat) / span.barBeats + EPSILON);
    const start = span.beat + into * span.barBeats;
    return { bar: span.bar + into, start, beat: Math.max(0, safe - start), span };
  }

  /** Beat where the 0-based `bar` starts. */
  barStart(bar: number): number {
    let index = this.meters.length - 1;
    while (index > 0 && this.meters[index].bar > bar) index--;
    const span = this.meters[index];
    return span.beat + (bar - span.bar) * span.barBeats;
  }

  /** The first metronome click at or after `beat`: clicks fall a beat apart from each bar line. */
  nextClick(beat: number): number {
    const position = this.barAt(Math.max(0, beat - EPSILON));
    const click = position.start + Math.ceil(position.beat - EPSILON);
    const nextBar = Math.min(position.start + position.span.barBeats, position.span.end);
    const result = click >= nextBar - EPSILON ? nextBar : click;
    return result < beat - EPSILON ? nextBar : result;
  }

  isBarLine(beat: number): boolean {
    return this.barAt(beat).beat < EPSILON;
  }

  /** Position as the ruler shows it: `bar:beat`, both counted from 1. */
  format(beat: number): string {
    const position = this.barAt(beat);
    const text = (position.beat + 1).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return `${position.bar + 1}:${text}`;
  }
}

let latest: { source: TimingSource; timing: Timing } | null = null;
const cache = new WeakMap<TimingSource, Timing>();

/**
 * The timing of a song. Editing notes makes a new project object but leaves its tempo and
 * meter alone, so the same Timing is handed back and whatever draws from it can stay put.
 */
export function timingOf(source: TimingSource): Timing {
  const cached = cache.get(source);
  if (cached) return cached;
  const same =
    latest &&
    latest.source.bpm === source.bpm &&
    latest.source.timeSignature === source.timeSignature &&
    latest.source.tempoChanges === source.tempoChanges &&
    latest.source.meterChanges === source.meterChanges;
  const timing = same ? latest!.timing : new Timing(source);
  cache.set(source, timing);
  latest = { source, timing };
  return timing;
}

/** Tempo and meter for a heading: "90 BPM · 4/4", noting when either changes later on. */
export function describeTiming(source: TimingSource): string {
  const timing = timingOf(source);
  const tempo = `${source.bpm} BPM${timing.tempos.length > 1 ? ' at the start' : ''}`;
  const meter = `${source.timeSignature.join('/')}${timing.meters.length > 1 ? ' at the start' : ''}`;
  return `${tempo} · ${meter}`;
}

export interface TimingPoint {
  beat: number;
  /** Set when the tempo changes here. */
  bpm?: number;
  /** Set when the meter changes here. */
  timeSignature?: [number, number];
}

function timingPoints(source: TimingSource): TimingPoint[] {
  const points = new Map<number, TimingPoint>();
  const at = (beat: number) => {
    const point = points.get(beat) ?? { beat };
    points.set(beat, point);
    return point;
  };
  for (const change of normalizeTempoChanges(source.bpm, source.tempoChanges)) at(change.beat).bpm = change.bpm;
  for (const change of normalizeMeterChanges(source.timeSignature, source.meterChanges)) {
    at(change.beat).timeSignature = change.timeSignature;
  }
  return [...points.values()].sort((a, b) => a.beat - b.beat);
}
