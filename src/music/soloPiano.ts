import { pitchClass } from './keys';
import { C_MAJOR, type KeyPlan } from './keySections';

export interface PianoNote {
  midi: number;
  startBeat: number;
  durationBeats: number;
  velocity: number;
  /** The pitch it plays on the pads, in the key of C and inside the instrument's range. */
  pitch?: number;
}

interface Line {
  startBeat: number;
  durationBeats: number;
  velocity: number;
  pitch: number;
}

/** Below this, a note belongs to the left hand. */
const MIDDLE_C = 60;
/** The melody keeps clear of the lowest five keys where it can; that is where the bass goes. */
const BASS_ROOM = 7;
/** What a melody note out of range costs against one in the bass's room, and a jump between bars. */
const OUT_COST = 3;
const CROWD_COST = 0.6;
const JUMP_COST = 5;
/** Under the melody, a harmony note keeps at least this far below it, and this far above the bass. */
const MIN_GAP = 3;
/** Thirds and sixths below the melody first, then fourths and fifths, then wider. */
const WARM = [3, 4, 8, 9];
const OPEN = [5, 7];
const WIDE = [10, 15, 16];
/** Chord notes for a beat the melody leaves empty, measured up from the bass. */
const FILL_STEPS = [4, 3, 7, 9, 8];
/** How many beats back a note can start and still be part of the chord sounding now. */
const LOOK_BACK = 8;

const onPads = (pitch: number) => C_MAJOR.has(pitchClass(pitch));

/**
 * A piano cover kept to one Sky piano, as one player would play it on 15 keys: the melody on
 * top, a bass note on the strong beats underneath, and a soft note of the song's own chord in
 * between where there is room. The melody moves a whole octave only where it has to, and
 * never more than once a bar, so its shape survives the two octaves.
 */
export function arrangeSoloPiano(
  notes: PianoNote[],
  keys: KeyPlan,
  beatsPerBar: number,
  range: [number, number],
  snapBeat: (beat: number) => number,
): PianoNote[] {
  const [low, high] = range;
  const shifted = (note: PianoNote) => note.midi + keys.at(snapBeat(note.startBeat));

  // The melody: the top note of each right-hand moment.
  const moments = new Map<number, PianoNote[]>();
  for (const note of notes.filter((n) => n.midi >= MIDDLE_C)) {
    const at = snapBeat(note.startBeat);
    moments.set(at, [...(moments.get(at) ?? []), note]);
  }
  const melody: Line[] = [...moments.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([at, group]) => {
      const top = group.reduce((a, b) => (b.midi > a.midi ? b : a));
      return { startBeat: at, durationBeats: top.durationBeats, velocity: Math.min(1, Math.max(0.78, top.velocity * 1.3)), pitch: shifted(top) };
    });
  placeMelody(melody, keys, beatsPerBar, low, high);

  const bass = placeBass(notes, melody, keys, beatsPerBar, low, snapBeat);
  const bassAt = new Map(bass.map((note) => [note.startBeat, note]));
  const melodyAt = new Set(melody.map((note) => note.startBeat));
  // Notes by the beat they start on, to find what sounds at a moment without a full scan.
  const byBeat = new Map<number, PianoNote[]>();
  for (const note of notes) {
    const beat = Math.floor(snapBeat(note.startBeat));
    byBeat.set(beat, [...(byBeat.get(beat) ?? []), note]);
  }
  const chordAt = (at: number, filter: (note: PianoNote) => boolean = () => true) => {
    const chord = new Set<number>();
    for (let beat = Math.floor(at) - LOOK_BACK; beat <= Math.floor(at + 0.25); beat++) {
      for (const note of byBeat.get(beat) ?? []) {
        const start = snapBeat(note.startBeat);
        if (start > at + 0.25 || start + note.durationBeats <= at || !filter(note)) continue;
        const pitch = shifted(note);
        if (onPads(pitch)) chord.add(pitchClass(pitch));
      }
    }
    return chord;
  };

  // Harmony under the melody on each beat and long note, from the chord sounding there.
  const harmony: Line[] = [];
  for (const top of melody) {
    if (!(top.startBeat % 1 === 0 || top.durationBeats >= 1.5)) continue;
    const chord = chordAt(top.startBeat);
    if (chord.size < 2) continue;
    const under = bassAt.get(top.startBeat);
    const floor = under ? under.pitch + MIN_GAP : low;
    let best: { pitch: number; rank: number } | null = null;
    for (let pitch = top.pitch - MIN_GAP; pitch >= floor; pitch--) {
      if (!onPads(pitch) || !chord.has(pitchClass(pitch))) continue;
      if (under && pitchClass(pitch) === pitchClass(under.pitch)) continue;
      const gap = top.pitch - pitch;
      const rank = WARM.includes(gap) ? 0 : OPEN.includes(gap) ? 1 : WIDE.includes(gap) ? 2 : -1;
      if (rank >= 0 && (!best || rank < best.rank)) best = { pitch, rank };
    }
    if (best) harmony.push({ startBeat: top.startBeat, durationBeats: Math.min(2, top.durationBeats), velocity: 0.5, pitch: best.pitch });
  }

  // A beat with no new melody or bass note gets one chord note above the bass, under any
  // melody note still ringing, as a pianist's left hand would fill it.
  const last = Math.max(...notes.map((note) => snapBeat(note.startBeat)));
  let bassIndex = -1;
  let melodyIndex = -1;
  for (let beat = 0; beat <= last; beat++) {
    while (bass[bassIndex + 1]?.startBeat < beat) bassIndex++;
    while (melody[melodyIndex + 1]?.startBeat < beat) melodyIndex++;
    if (melodyAt.has(beat) || bassAt.has(beat)) continue;
    const root = bass[bassIndex];
    if (!root || beat - root.startBeat > 2) continue;
    const ringing = melody[melodyIndex];
    const ceiling = ringing && beat - ringing.startBeat <= 2 ? ringing.pitch - MIN_GAP : high;
    const chord = chordAt(beat, (note) => note.midi < MIDDLE_C);
    const pitch = FILL_STEPS.map((step) => root.pitch + step).find(
      (candidate) => onPads(candidate) && chord.has(pitchClass(candidate)) && candidate <= ceiling && candidate <= high,
    );
    if (pitch !== undefined) harmony.push({ startBeat: beat, durationBeats: 1, velocity: 0.45, pitch });
  }

  return [...melody, ...bass, ...harmony].map((line) => ({ ...line, midi: line.pitch }));
}

/**
 * Settles the melody on the pads: an octave for each key section, then bar by bar the octave
 * that keeps it in range and above the bass's room, where each jump between bars has a cost
 * so a phrase only moves where it must. What still falls outside folds alone, and the few
 * notes outside the key move one step toward where the line goes next.
 */
function placeMelody(melody: Line[], keys: KeyPlan, beatsPerBar: number, low: number, high: number): void {
  const cost = (pitch: number) => (pitch < low || pitch > high ? OUT_COST : 0) + (pitch < low + BASS_ROOM ? CROWD_COST : 0);
  const bounds = [-Infinity, ...keys.changes, Infinity];
  for (let index = 0; index < bounds.length - 1; index++) {
    const section = melody.filter((note) => note.startBeat >= bounds[index] && note.startBeat < bounds[index + 1]);
    let best = 0;
    let bestCost = Infinity;
    for (const octave of [-36, -24, -12, 0, 12, 24]) {
      const total = section.reduce((sum, note) => sum + cost(note.pitch + octave), 0);
      if (total < bestCost) {
        bestCost = total;
        best = octave;
      }
    }
    for (const note of section) note.pitch += best;
  }

  const bars = new Map<number, Line[]>();
  for (const note of melody) {
    const bar = Math.floor(note.startBeat / beatsPerBar);
    bars.set(bar, [...(bars.get(bar) ?? []), note]);
  }
  const order = [...bars.keys()].sort((a, b) => a - b);
  const octaves = [-12, 0, 12];
  const barCost = (bar: number, octave: number) => bars.get(bar)!.reduce((sum, note) => sum + cost(note.pitch + octave), 0);
  if (order.length > 0) {
    let totals = octaves.map((octave) => barCost(order[0], octave));
    const from: number[][] = [];
    for (const bar of order.slice(1)) {
      const step = octaves.map((_, to) => {
        const via = totals.map((total, at) => total + (at === to ? 0 : JUMP_COST));
        return via.indexOf(Math.min(...via));
      });
      from.push(step);
      totals = octaves.map((octave, to) => totals[step[to]] + (step[to] === to ? 0 : JUMP_COST) + barCost(bar, octave));
    }
    let state = totals.indexOf(Math.min(...totals));
    for (let index = order.length - 1; index >= 0; index--) {
      for (const note of bars.get(order[index])!) note.pitch += octaves[state];
      if (index > 0) state = from[index - 1][state];
    }
  }

  melody.forEach((note, index) => {
    while (note.pitch < low) note.pitch += 12;
    while (note.pitch > high) note.pitch -= 12;
    if (onPads(note.pitch)) return;
    const next = melody[index + 1]?.pitch ?? note.pitch;
    if (note.pitch + 1 > high) note.pitch -= 1;
    else if (note.pitch - 1 < low) note.pitch += 1;
    else note.pitch += next > note.pitch ? 1 : -1;
  });
}

/**
 * The lowest left-hand note of each half bar (each bar, in an odd meter) on the lowest
 * octave of keys. A half bar that repeats the bar's bass is left out, and a bass that would
 * sit on the melody drops an octave or, with no room, is left out too.
 */
function placeBass(
  notes: PianoNote[],
  melody: Line[],
  keys: KeyPlan,
  beatsPerBar: number,
  low: number,
  snapBeat: (beat: number) => number,
): Line[] {
  const span = beatsPerBar % 2 === 0 ? beatsPerBar / 2 : beatsPerBar;
  const windows = new Map<number, PianoNote[]>();
  for (const note of notes) {
    if (note.midi >= MIDDLE_C) continue;
    const slot = Math.floor(snapBeat(note.startBeat) / span);
    windows.set(slot, [...(windows.get(slot) ?? []), note]);
  }
  const melodyAt = new Map(melody.map((note) => [note.startBeat, note.pitch]));
  const bass: Line[] = [];
  let lastClass = -1;
  for (const slot of [...windows.keys()].sort((a, b) => a - b)) {
    const inWindow = windows.get(slot)!;
    const first = Math.min(...inWindow.map((note) => snapBeat(note.startBeat)));
    const root = inWindow.filter((note) => snapBeat(note.startBeat) === first).reduce((a, b) => (b.midi < a.midi ? b : a));
    let pitch = root.midi + keys.at(first);
    if (!onPads(pitch)) pitch -= 1;
    while (pitch < low) pitch += 12;
    while (pitch >= low + 12) pitch -= 12;
    const midBar = span < beatsPerBar && slot % 2 === 1;
    if (midBar && pitchClass(pitch) === lastClass) continue;
    // The melody is a single line, so one note can sit over the bass; too close, and the bass gives way.
    const over = melodyAt.get(first);
    if (over !== undefined && over - pitch < MIN_GAP) continue;
    bass.push({ startBeat: first, durationBeats: span, velocity: 0.6, pitch });
    lastClass = pitchClass(pitch);
  }
  return bass;
}
