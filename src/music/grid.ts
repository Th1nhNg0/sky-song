import { beatsPerMeasure } from './time';
import type { Timing } from './timing';

const MIN_LINE_GAP = 7;
const MIN_LABEL_GAP = 46;

/** Length of the beat the meter counts, in quarter notes: 1 in 4/4, 0.5 in 6/8. */
export function meterBeat(meter: [number, number]): number {
  return 4 / meter[1];
}

function lines(color: string, step: number): { image: string; size: string } {
  return {
    image: `linear-gradient(90deg, ${color} 1px, transparent 1px)`,
    size: `${step}px 100%`,
  };
}

/**
 * CSS background for the note grid: bars, beats, and the snap subdivision when it fits.
 * `oddStart` is for a stretch that begins on an even-numbered bar, so the shading of
 * every other bar carries on from the stretch before it.
 */
export function gridBackground(px: number, meter: [number, number], snap: number, oddStart = false) {
  const barPx = beatsPerMeasure(meter) * px;
  const beatPx = meterBeat(meter) * px;
  const snapPx = snap * px;
  const layers = [
    {
      image: 'linear-gradient(90deg, transparent 50%, var(--grid-shade) 50%)',
      size: `${barPx * 2}px 100%`,
    },
  ];
  if (barPx >= MIN_LINE_GAP) layers.unshift(lines('var(--grid-bar)', barPx));
  if (beatPx >= MIN_LINE_GAP) layers.unshift(lines('var(--grid-beat)', beatPx));
  if (snapPx >= MIN_LINE_GAP && snapPx < beatPx) layers.unshift(lines('var(--grid-sub)', snapPx));
  return {
    backgroundImage: layers.map((layer) => layer.image).join(', '),
    backgroundSize: layers.map((layer) => layer.size).join(', '),
    backgroundPosition: layers.map((_, index) => (oddStart && index === layers.length - 1 ? `${-barPx}px 0` : '0 0')).join(', '),
  };
}

/** The grid of a song whose meter changes: one background per stretch of the same meter. */
export function gridSpans(px: number, timing: Timing, snap: number, totalBeats: number) {
  return timing.meters
    .filter((span) => span.beat < totalBeats)
    .map((span) => ({
      key: span.beat,
      style: {
        left: span.beat * px,
        width: (Math.min(span.end, totalBeats) - span.beat) * px,
        ...gridBackground(px, span.meter, snap, span.bar % 2 === 1),
      },
    }));
}

/** How many bars apart the ruler's numbers sit at this zoom: 1, 2, 4, 8… */
export function barLabelStep(px: number, barBeats: number): number {
  const barPx = barBeats * px;
  let step = 1;
  while (step * barPx < MIN_LABEL_GAP) step *= 2;
  return step;
}

/** Index of the first item at or after `beat` in notes sorted by start. */
export function firstNoteAt(notes: ReadonlyArray<{ startBeat: number }>, beat: number): number {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (notes[middle].startBeat < beat) low = middle + 1;
    else high = middle;
  }
  return low;
}
