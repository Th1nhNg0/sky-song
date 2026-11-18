import { pitchClass } from './keys';

/** Pitch classes of C major, the notes the game's pads play in the key of C. */
export const C_MAJOR = new Set([0, 2, 4, 5, 7, 9, 11]);

interface KeyedNote {
  midi: number;
  startBeat: number;
  durationBeats: number;
}

export interface KeyPlan {
  /** Semitones to add to a note that starts at `beat` to put it on the pads. */
  at(beat: number): number;
  /** Beats where the song changes key, in order. Empty for a song in one key. */
  changes: number[];
}

/** Shifts tried for each section, nearest first, so a tie keeps the song where it is. */
const SHIFTS = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6];
/**
 * A new key has to save at least this many notes from falling between the pads. Set high
 * enough that a chromatic bar or two never counts as a key change, since a song shifted
 * mid-phrase breaks its own line.
 */
const MIN_CHANGE_NOTES = 24;
const MIN_CHANGE_SHARE = 0.04;

/** Shift that lands the most sound on the pads; length counts, so long notes weigh more. */
function bestShift(notes: KeyedNote[]): number {
  let best = 0;
  let bestScore = -1;
  for (const shift of SHIFTS) {
    let score = 0;
    for (const note of notes) if (C_MAJOR.has(pitchClass(note.midi + shift))) score += note.durationBeats;
    if (score > bestScore) {
      best = shift;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Splits the song where its key changes, bar by bar, and gives each section its own shift.
 * The key change itself is lost, since the pads only play one key, but every note in both
 * sections lands on a pad instead of between two.
 */
export function planKeys(notes: KeyedNote[], beatsPerBar: number): KeyPlan {
  const whole = bestShift(notes);
  const single: KeyPlan = { at: () => whole, changes: [] };
  if (notes.length === 0) return single;
  const barOf = (note: KeyedNote) => Math.max(0, Math.floor(note.startBeat / beatsPerBar));
  const lastBar = Math.max(...notes.map(barOf));
  const misses: number[][] = Array.from({ length: lastBar + 1 }, () => SHIFTS.map(() => 0));
  for (const note of notes) {
    SHIFTS.forEach((shift, index) => {
      if (!C_MAJOR.has(pitchClass(note.midi + shift))) misses[barOf(note)][index]++;
    });
  }

  // Cheapest run of shifts over the bars, where each change of key costs a fixed toll.
  const toll = Math.max(MIN_CHANGE_NOTES, notes.length * MIN_CHANGE_SHARE);
  let cost = misses[0].slice();
  const from: number[][] = [];
  for (let bar = 1; bar <= lastBar; bar++) {
    const cheapest = cost.indexOf(Math.min(...cost));
    from.push(cost.map((value, index) => (value <= cost[cheapest] + toll ? index : cheapest)));
    cost = cost.map((value, index) => Math.min(value, cost[cheapest] + toll) + misses[bar][index]);
  }
  let state = cost.indexOf(Math.min(...cost));
  const path: number[] = [];
  for (let bar = lastBar; bar >= 0; bar--) {
    path[bar] = state;
    if (bar > 0) state = from[bar - 1][state];
  }
  const changes = path.flatMap((state, bar) => (bar > 0 && state !== path[bar - 1] ? [bar * beatsPerBar] : []));
  if (changes.length === 0) return single;

  // Each section's own best shift, kept within a fifth of the one before so the register holds.
  const bounds = [-Infinity, ...changes, Infinity];
  const shifts: number[] = [];
  for (let index = 0; index < bounds.length - 1; index++) {
    const section = notes.filter((note) => note.startBeat >= bounds[index] && note.startBeat < bounds[index + 1]);
    let shift = bestShift(section);
    const previous = shifts[index - 1];
    if (previous !== undefined) {
      while (shift - previous > 6) shift -= 12;
      while (previous - shift > 6) shift += 12;
    }
    shifts.push(shift);
  }
  return {
    at: (beat) => shifts[changes.filter((change) => beat >= change).length],
    changes,
  };
}
