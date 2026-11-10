import { clamp } from '../util';

export const MIN_BPM = 40;
export const MAX_BPM = 240;

export function clampBpm(bpm: number): number {
  return clamp(Math.round(bpm), MIN_BPM, MAX_BPM);
}

export const TIME_SIGNATURES: ReadonlyArray<{ label: string; value: [number, number] }> = [
  { label: '4/4', value: [4, 4] },
  { label: '3/4', value: [3, 4] },
  { label: '2/4', value: [2, 4] },
  { label: '6/8', value: [6, 8] },
  { label: '5/4', value: [5, 4] },
  { label: '7/8', value: [7, 8] },
];

export function beatsPerMeasure(timeSignature: [number, number]): number {
  const [numerator, denominator] = timeSignature;
  return (numerator * 4) / denominator;
}

export function beatsToSeconds(beats: number, bpm: number): number {
  return (beats * 60) / bpm;
}

interface BarBeat {
  bar: number;
  beat: number;
}

function beatsToBarBeat(beats: number, timeSignature: [number, number]): BarBeat {
  const perMeasure = beatsPerMeasure(timeSignature);
  // Triplet grids land a hair under the bar line (3.9999999999999996), which would read as "1:5".
  const safe = Math.max(0, Math.round(beats * 1e6) / 1e6);
  const bar = Math.floor(safe / perMeasure) + 1;
  const beat = safe % perMeasure;
  return { bar, beat };
}

export function formatBarBeat(beats: number, timeSignature: [number, number]): string {
  const { bar, beat } = beatsToBarBeat(beats, timeSignature);
  const displayBeat = beat + 1;
  const text = displayBeat.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${bar}:${text}`;
}

export function snapBeat(beat: number, snap: number): number {
  if (!Number.isFinite(beat)) return 0;
  if (snap <= 0) return Math.max(0, beat);
  return Math.max(0, Math.round(beat / snap) * snap);
}

export const SNAP_OPTIONS: ReadonlyArray<{ label: string; value: number }> = [
  { label: '1 bar', value: 4 },
  { label: '1/2', value: 2 },
  { label: '1/4 (beat)', value: 1 },
  { label: '1/8', value: 0.5 },
  { label: '1/8 triplet', value: 1 / 3 },
  { label: '1/16', value: 0.25 },
  { label: 'Off', value: 0 },
];
