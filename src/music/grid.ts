import { beatsPerMeasure } from './time';

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

/** CSS background for the note grid: bars, beats, and the snap subdivision when it fits. */
export function gridBackground(px: number, meter: [number, number], snap: number) {
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
  };
}

/** How many bars apart the ruler's numbers sit at this zoom: 1, 2, 4, 8… */
export function barLabelStep(px: number, meter: [number, number]): number {
  const barPx = beatsPerMeasure(meter) * px;
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
