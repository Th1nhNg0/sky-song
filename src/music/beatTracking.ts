/**
 * Beat tracking for files transcribed from a recording. Their notes keep a steady pulse, but
 * the pulse drifts a little against any fixed grid, so no single tempo lines them up. Here
 * each onset is placed from the one before it, which keeps the drift from building up.
 */

export interface OnsetNote {
  /** Start, in seconds. */
  time: number;
  midi: number;
}

export interface TrackedBeats {
  bpm: number;
  /** Beat of a note that starts at `time` seconds; whole bars start on multiples of the meter. */
  beatOf(time: number): number;
  /** Length in beats of `seconds`. */
  beats(seconds: number): number;
}

/** A tempo has to place most onsets this close (in seconds) to be trusted. */
const MAX_P90_ERROR = 0.025;
/** Tempos this close (in seconds of p90 error) to the best fit count as equally good. */
const TIE_ERROR = 0.004;
/** Past this share of triplet onsets, the tempo is probably a third off. */
const MAX_TRIPLET_SHARE = 0.2;
/** Fewer onsets than this can't tell a pulse from chance. */
const MIN_ONSETS = 64;
const TRIPLET_SLACK = 0.04;

const key = (time: number) => Math.round(time * 1000);

function follow(onsets: number[], period: number) {
  const beats = new Map<number, number>();
  const errors: number[] = [];
  let triplets = 0;
  let eighths = 0;
  let prevTime = onsets[0];
  let prevBeat = 0;
  for (const time of onsets) {
    const beat = prevBeat + (time - prevTime) / period;
    const four = Math.round(beat * 4) / 4;
    const three = Math.round(beat * 3) / 3;
    const placed = Math.abs(beat - four) <= Math.abs(beat - three) + TRIPLET_SLACK ? four : three;
    if (placed !== four) triplets++;
    if (placed * 2 === Math.round(placed * 2)) eighths++;
    errors.push(Math.abs(placed - beat) * period);
    beats.set(key(time), Math.round(placed * 12) / 12);
    prevTime = time;
    prevBeat = placed;
  }
  errors.sort((a, b) => a - b);
  return { beats, p90: errors[Math.floor(errors.length * 0.9)], triplets, eighths };
}

/**
 * Finds the pulse a recording keeps, or null when there isn't one to trust. Of the tempos that
 * fit equally well, the real one puts the most notes on the eighths, as with steady files.
 */
export function trackBeats(notes: OnsetNote[], beatsPerBar: number): TrackedBeats | null {
  const onsets = [...new Set(notes.map((note) => key(note.time)))].sort((a, b) => a - b).map((ms) => ms / 1000);
  if (onsets.length < MIN_ONSETS) return null;
  const fits: { bpm: number; fit: ReturnType<typeof follow> }[] = [];
  for (let bpm = 70; bpm < 140; bpm += 0.25) fits.push({ bpm, fit: follow(onsets, 60 / bpm) });
  const bestError = Math.min(...fits.map(({ fit }) => fit.p90));
  const coarse = fits
    .filter(({ fit }) => fit.p90 <= bestError + TIE_ERROR)
    .reduce((a, b) => (b.fit.eighths > a.fit.eighths ? b : a));
  let best = coarse;
  for (let bpm = coarse.bpm - 0.25; bpm <= coarse.bpm + 0.25; bpm += 0.01) {
    const fit = follow(onsets, 60 / bpm);
    if (fit.p90 < best.fit.p90 && fit.eighths >= coarse.fit.eighths) best = { bpm, fit };
  }
  const { fit, bpm } = best;
  if (fit.p90 > MAX_P90_ERROR || fit.triplets > onsets.length * MAX_TRIPLET_SHARE) return null;

  // Bar lines go where the most low notes land on the first beat, and the most of the rest
  // on the bar's middle.
  const lowest = new Map<number, number>();
  for (const note of notes) {
    const at = fit.beats.get(key(note.time))!;
    if (note.midi < 60) lowest.set(at, Math.min(note.midi, lowest.get(at) ?? Infinity));
  }
  const half = beatsPerBar % 2 === 0 ? beatsPerBar / 2 : beatsPerBar;
  let shift = 0;
  let shiftScore = -1;
  for (let step = 0; step < beatsPerBar * 4; step++) {
    let score = 0;
    for (const at of lowest.keys()) {
      const inBar = (((at + step / 4) % beatsPerBar) + beatsPerBar) % beatsPerBar;
      if (inBar === 0) score += 2;
      else if (inBar === half) score += 1;
    }
    if (score > shiftScore) {
      shiftScore = score;
      shift = step / 4;
    }
  }
  const period = 60 / bpm;
  return {
    bpm,
    beatOf: (time) => (fit.beats.get(key(time)) ?? 0) + shift,
    beats: (seconds) => seconds / period,
  };
}
