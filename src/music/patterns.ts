import type { PadDefinition, PadLayout, PercussionVoiceId } from './types';
import { semitoneToDegree } from './keys';

/** Semitone offsets of the standard 15-pad Sky keyboard (two octaves + tonic). */
export const STANDARD_15_SEMITONES = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24] as const;

/** C D G A / C D G A — bell pattern, scale degrees 1,2,5,6 / 8,9,12,13. */
export const BELLS_8_SEMITONES = [0, 2, 7, 9, 12, 14, 19, 21] as const;

/** D A C D F G A C — handpan pattern (degrees 2,6,8,9,11,12,13,15). */
export const HANDPAN_8_SEMITONES = [2, 9, 12, 14, 17, 19, 21, 24] as const;

/** F G A B / C D E F — community-reported Tuned Krill Horn pattern (degrees 4..11). */
export const KRILL_8_SEMITONES = [5, 7, 9, 11, 12, 14, 16, 17] as const;

export interface DrumPadSeed {
  voice: PercussionVoiceId;
  gmDrum: number;
  label: string;
}

/** Unpitched 8-pad drum voices. Physical voicing is an honest approximation. */
export const DRUMS_8: DrumPadSeed[] = [
  { voice: 'drum-kick', gmDrum: 36, label: 'Kick' },
  { voice: 'drum-low', gmDrum: 41, label: 'Low tom' },
  { voice: 'drum-snare', gmDrum: 38, label: 'Snare' },
  { voice: 'drum-mid', gmDrum: 45, label: 'Mid tom' },
  { voice: 'drum-rim', gmDrum: 37, label: 'Rim' },
  { voice: 'drum-high', gmDrum: 50, label: 'High tom' },
  { voice: 'drum-shaker', gmDrum: 70, label: 'Shaker' },
  { voice: 'drum-crash', gmDrum: 49, label: 'Crash' },
];

export const DRUMS_4: DrumPadSeed[] = [
  { voice: 'drum-kick', gmDrum: 36, label: 'Low' },
  { voice: 'drum-tom', gmDrum: 47, label: 'Mid' },
  { voice: 'drum-snare', gmDrum: 38, label: 'High' },
  { voice: 'drum-crash', gmDrum: 49, label: 'Crash' },
];

export const CYMBALS_4: DrumPadSeed[] = [
  { voice: 'cymbal-crash', gmDrum: 49, label: 'Crash' },
  { voice: 'cymbal-splash', gmDrum: 55, label: 'Splash' },
  { voice: 'cymbal-china', gmDrum: 52, label: 'China' },
  { voice: 'cymbal-ride', gmDrum: 51, label: 'Ride' },
];

export function layoutFor(count: number): PadLayout {
  if (count === 15) return { rows: 3, cols: 5 };
  if (count === 8) return { rows: 2, cols: 4 };
  if (count === 4) return { rows: 2, cols: 2 };
  throw new Error(`Unsupported pad count: ${count}`);
}

export function pitchedPads(semitones: readonly number[]): PadDefinition[] {
  const { cols } = layoutFor(semitones.length);
  return semitones.map((semitone, index) => ({
    index,
    row: Math.floor(index / cols),
    col: index % cols,
    degree: semitoneToDegree(semitone),
    semitone,
    pitched: true,
  }));
}

export function unpitchedPads(seeds: DrumPadSeed[], cols = 4): PadDefinition[] {
  layoutFor(seeds.length);
  return seeds.map((seed, index) => ({
    index,
    row: Math.floor(index / cols),
    col: index % cols,
    degree: null,
    semitone: null,
    pitched: false,
    percussionVoice: seed.voice,
    gmDrum: seed.gmDrum,
    label: seed.label,
  }));
}
