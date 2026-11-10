import type { MusicKey } from './types';

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11] as const;
const FLAT = '♭';
const SHARP = '♯';
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11] as const;

interface KeySeed {
  name: string;
  altName: string;
  tonicPc: number;
  tonicLetter: number;
  accidentals: string;
}

// The 12 major keys. Enharmonic names are shown together; the flat spelling is
// used for note labels (matching the community convention for Sky's keys).
const KEY_SEEDS: KeySeed[] = [
  { name: 'C', altName: 'C', tonicPc: 0, tonicLetter: 0, accidentals: 'none' },
  { name: 'D♭', altName: 'C♯', tonicPc: 1, tonicLetter: 1, accidentals: '5♭' },
  { name: 'D', altName: 'D', tonicPc: 2, tonicLetter: 1, accidentals: '2♯' },
  { name: 'E♭', altName: 'D♯', tonicPc: 3, tonicLetter: 2, accidentals: '3♭' },
  { name: 'E', altName: 'E', tonicPc: 4, tonicLetter: 2, accidentals: '4♯' },
  { name: 'F', altName: 'F', tonicPc: 5, tonicLetter: 3, accidentals: '1♭' },
  { name: 'G♭', altName: 'F♯', tonicPc: 6, tonicLetter: 4, accidentals: '6♭' },
  { name: 'G', altName: 'G', tonicPc: 7, tonicLetter: 4, accidentals: '1♯' },
  { name: 'A♭', altName: 'G♯', tonicPc: 8, tonicLetter: 5, accidentals: '4♭' },
  { name: 'A', altName: 'A', tonicPc: 9, tonicLetter: 5, accidentals: '3♯' },
  { name: 'B♭', altName: 'A♯', tonicPc: 10, tonicLetter: 6, accidentals: '2♭' },
  { name: 'B', altName: 'B', tonicPc: 11, tonicLetter: 6, accidentals: '5♯' },
];

function spellDegree(tonicLetter: number, tonicPc: number, degree: number): string {
  // Degrees repeat every 7; the leading letter advances one step each degree.
  const letter = LETTERS[(tonicLetter + (degree - 1)) % 7];
  const letterIndex = (tonicLetter + (degree - 1)) % 7;
  const targetPc = (tonicPc + MAJOR_STEPS[(degree - 1) % 7] + 12 * Math.floor((degree - 1) / 7)) % 12;
  const naturalPc = LETTER_PC[letterIndex];
  let diff = (targetPc - naturalPc + 12) % 12;
  if (diff > 6) diff -= 12;
  const accidental = diff === 0 ? '' : diff > 0 ? SHARP.repeat(diff) : FLAT.repeat(-diff);
  return `${letter}${accidental}`;
}

const KEYS: MusicKey[] = KEY_SEEDS.map((seed, index) => ({
  index,
  tonicPc: seed.tonicPc,
  tonicLetter: seed.tonicLetter,
  name: seed.name,
  altName: seed.altName,
  accidentals: seed.accidentals,
  degreeNames: Array.from({ length: 15 }, (_, i) => spellDegree(seed.tonicLetter, seed.tonicPc, i + 1)),
}));

export function getKey(index: number): MusicKey {
  if (!Number.isInteger(index) || index < 0 || index >= KEYS.length) {
    throw new Error(`Invalid musical key index: ${index}`);
  }
  return KEYS[index];
}

export function keyShortLabel(index: number): string {
  const key = getKey(index);
  return key.name === key.altName ? key.name : `${key.name}/${key.altName}`;
}

/** Pitch class 0..11 of a MIDI note, C = 0. */
export function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

/** True for the key's home note in any octave: scale degrees 1, 8 and 15. */
export function isTonicDegree(degree: number | null): boolean {
  return degree !== null && (degree - 1) % 7 === 0;
}

/** Note name (letter + accidental) without octave for a MIDI note in a key. */
export function midiToSpelledName(midi: number, key: MusicKey): string {
  const pc = pitchClass(midi);
  // Find a degree spelling matching the pitch class; fall back to sharps.
  for (let degree = 1; degree <= 15; degree++) {
    const name = key.degreeNames[degree - 1];
    const spelledPc = spelledPitchClass(name);
    if (spelledPc === pc) {
      const octave = Math.floor(midi / 12) - 1;
      return `${name}${octave}`;
    }
  }
  return `${pcName(pc)}${Math.floor(midi / 12) - 1}`;
}

const SPELL_PC: Record<string, number> = {
  C: 0,
  'C♯': 1,
  'C♭': 11,
  D: 2,
  'D♯': 3,
  'D♭': 1,
  E: 4,
  'E♯': 5,
  'E♭': 3,
  F: 5,
  'F♯': 6,
  'F♭': 4,
  G: 7,
  'G♯': 8,
  'G♭': 6,
  A: 9,
  'A♯': 10,
  'A♭': 8,
  B: 11,
  'B♯': 0,
  'B♭': 10,
};

function spelledPitchClass(name: string): number {
  return SPELL_PC[name] ?? 0;
}

function pcName(pc: number): string {
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  return names[pitchClass(pc)];
}

/** Scale degree 1..15 for a diatonic semitone offset above the tonic, if diatonic. */
export function semitoneToDegree(semitone: number): number | null {
  if (!Number.isInteger(semitone) || semitone < 0) return null;
  const pc = semitone % 12;
  const step = MAJOR_STEPS.indexOf(pc as (typeof MAJOR_STEPS)[number]);
  if (step === -1) return null;
  return 7 * Math.floor(semitone / 12) + step + 1;
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
