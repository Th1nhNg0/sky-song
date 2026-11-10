import { Midi } from '@tonejs/midi';
import { midiSafeText } from '../audio/midi';
import { getInstrument, INSTRUMENTS } from './instruments';
import { resolvePad } from './pitch';
import { createProject, createTrack, newId, sortNotes } from './project';
import { MAX_BPM, MIN_BPM, TIME_SIGNATURES } from './time';
import type { InstrumentDefinition, Note, Project } from './types';
import { MAX_PROJECT_NOTES, MAX_TRACK_NAME_LENGTH } from './validation';

interface SourceNote {
  midi: number;
  startBeat: number;
  durationBeats: number;
  velocity: number;
  /** The sounding pitch once the song's transpose and the line's octave are settled. */
  pitch?: number;
}

interface Part {
  instrumentId: string;
  name: string;
  volume: number;
  notes: SourceNote[];
}

const GRID = 0.25;
/** Lands on both sixteenths and triplets, so swung songs keep their lilt. */
const SWING_GRID = 1 / 12;
const SWING_SHARE = 0.1;
const LOUD_PERCENTILE = 0.95;
const LOUD_TARGET = 0.9;
/** Instruments that reach past everything else, with room for two of them at most. */
const LOW_REACH = 'contrabass';
const HIGH_REACH = 'xylophone';
/** A new instrument has to carry a real share of the song, not plink a few stray notes. */
const MIN_REACH_SHARE = 0.1;
/** How many notes the band may start together before the game's samples turn to mud. */
const MAX_BAND_NOTES = 6;
const MAX_PARTS = 6;
const MAX_CHORD = 4;
const C_MAJOR = new Set([0, 2, 4, 5, 7, 9, 11]);

/** General MIDI percussion note → pad on the 8-pad drum. */
const DRUM_PADS: Record<number, number> = {
  35: 0, 36: 0, 41: 1, 43: 1, 38: 2, 40: 2, 45: 3, 47: 3, 37: 4, 39: 4, 48: 5, 50: 5,
  42: 6, 44: 6, 46: 6, 51: 6, 53: 6, 59: 6, 69: 6, 70: 6, 49: 7, 52: 7, 55: 7, 57: 7,
  // Clicks, sticks and snaps have no pad of their own; the rim is the closest sound.
  25: 4, 26: 4, 27: 4, 28: 4, 29: 4, 30: 4, 31: 4, 32: 4, 33: 4, 34: 4,
  54: 6, 56: 6, 58: 6,
};

/** Arrangers often leave a default patch on a part they named; the name is the truer guide. */
const NAMED_INSTRUMENTS: [RegExp, string][] = [
  [/sax/i, 'saxophone'],
  [/trumpet|cornet/i, 'trumpet'],
  [/trombone|tuba|french horn/i, 'cello'],
  [/flute|piccolo/i, 'flute'],
  [/violin|fiddle/i, 'violin'],
  [/cello/i, 'cello'],
];

function instrumentForProgram(program: number): string {
  if (program < 8) return 'piano';
  if (program < 16) return 'xylophone';
  if (program < 24) return 'harmonica';
  if (program < 26) return 'guitar';
  if (program < 32) return 'light-guitar';
  if (program < 40) return 'contrabass';
  if (program < 42) return 'violin';
  if (program < 48) return 'cello';
  if (program >= 52 && program < 55) return 'aurora-voice';
  if (program < 56) return 'cello';
  if (program === 56 || program === 59) return 'trumpet';
  if (program < 64) return 'cello';
  if (program < 72) return 'saxophone';
  if (program < 80) return 'flute';
  return 'harp';
}

function instrumentForTrack(name: string, program: number): string {
  return NAMED_INSTRUMENTS.find(([pattern]) => pattern.test(name))?.[1] ?? instrumentForProgram(program);
}

function snap(value: number, grid = GRID): number {
  return Math.round(value / grid) * grid;
}

function onGrid(value: number, grid: number): boolean {
  return Math.abs(value / grid - Math.round(value / grid)) < 0.02;
}

/** Sixteenths flatten swung eighths, so a song with enough triplet timing gets a finer grid. */
function timingGrid(notes: SourceNote[]): number {
  const swung = notes.filter((note) => !onGrid(note.startBeat, GRID) && onGrid(note.startBeat, SWING_GRID));
  return swung.length >= notes.length * SWING_SHARE ? SWING_GRID : GRID;
}

/** Quiet files would stay quiet on the game's samples; lifts the song and keeps its balance. */
function velocityBoost(velocities: number[]): number {
  const sorted = [...velocities].sort((a, b) => a - b);
  const loud = sorted[Math.floor((sorted.length - 1) * LOUD_PERCENTILE)] ?? LOUD_TARGET;
  return Math.max(1, LOUD_TARGET / Math.max(loud, 0.01));
}

/** Whole-song shift that lands the most sound on the game's white-note pads. */
function bestTranspose(notes: SourceNote[]): number {
  let best = 0;
  let bestScore = -1;
  for (const shift of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6]) {
    let score = 0;
    for (const note of notes) {
      if (C_MAJOR.has((((note.midi + shift) % 12) + 12) % 12)) score += note.durationBeats;
    }
    if (score > bestScore) {
      best = shift;
      bestScore = score;
    }
  }
  return best;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 60;
}

/** The octave that leaves the fewest notes out of range; folding those breaks the line. */
function bestOctave(pitches: number[], low: number, high: number): number {
  const center = (low + high) / 2;
  const middle = median(pitches);
  let best = 0;
  let bestCost = Infinity;
  for (let octave = -48; octave <= 48; octave += 12) {
    const outside = pitches.filter((pitch) => pitch + octave < low || pitch + octave > high).length;
    const cost = outside + Math.abs(middle + octave - center) / 1000;
    if (cost < bestCost) {
      best = octave;
      bestCost = cost;
    }
  }
  return best;
}

function padPitches(instrument: InstrumentDefinition): number[] {
  return instrument.pads.map((_, pad) => resolvePad(instrument, 0, pad).midi ?? 0);
}

function placeNotes(notes: SourceNote[], instrument: InstrumentDefinition, grid: number): Note[] {
  const pads = padPitches(instrument);
  const low = pads[0];
  const high = pads[pads.length - 1];
  const chords = new Map<number, Map<number, Note>>();
  notes.forEach((note) => {
    let target = note.pitch ?? note.midi;
    const startBeat = snap(note.startBeat, grid);
    while (target < low) target += 12;
    while (target > high) target -= 12;
    let pad = 0;
    pads.forEach((value, candidate) => {
      if (Math.abs(value - target) < Math.abs(pads[pad] - target)) pad = candidate;
    });
    const chord = chords.get(startBeat) ?? new Map<number, Note>();
    chords.set(startBeat, chord);
    if (chord.has(pad)) return;
    chord.set(pad, {
      id: newId('note'),
      pad,
      startBeat,
      durationBeats: Math.max(grid, snap(note.durationBeats, grid)),
      velocity: Math.max(0.2, Math.min(1, note.velocity)),
    });
  });
  const placed = [...chords.values()].flatMap((chord) =>
    [...chord.values()].sort((a, b) => b.pad - a.pad).slice(0, MAX_CHORD),
  );
  return sortNotes(placed);
}

/**
 * A lone piano track holds the whole song. The hands split at middle C: the right hand
 * stays as the melody, and the left is thinned to one bass note a bar with light chords
 * on the other beats, because replaying every hit on sampled instruments turns to mud.
 */
function splitSoloTrack(notes: SourceNote[], beatsPerBar: number): Part[] {
  const groups = new Map<number, SourceNote[]>();
  const bars = new Map<number, SourceNote[]>();
  for (const note of notes) {
    if (note.midi < 60) {
      const bar = Math.floor(snap(note.startBeat) / beatsPerBar);
      bars.set(bar, [...(bars.get(bar) ?? []), note]);
      continue;
    }
    const key = snap(note.startBeat);
    groups.set(key, [...(groups.get(key) ?? []), note]);
  }
  const lead = [...groups.values()].map((group) =>
    group.reduce((top, note) => (note.midi > top.midi ? note : top)),
  );
  const bass: SourceNote[] = [];
  const chords: SourceNote[] = [];
  for (const [bar, barNotes] of bars) {
    const start = bar * beatsPerBar;
    const first = Math.min(...barNotes.map((note) => note.startBeat));
    const root = barNotes
      .filter((note) => note.startBeat === first)
      .reduce((low, note) => (note.midi < low.midi ? note : low));
    bass.push({ ...root, startBeat: start, durationBeats: beatsPerBar, velocity: 0.8 });
    const tones = [...new Set(barNotes.map((note) => note.midi))]
      .filter((midi) => midi % 12 !== root.midi % 12)
      .sort((a, b) => a - b)
      .slice(0, 3);
    for (let beat = 1; beat < beatsPerBar; beat++) {
      for (const midi of tones) {
        chords.push({ midi, startBeat: start + beat, durationBeats: 1, velocity: 0.55 });
      }
    }
  }
  return [
    { instrumentId: 'piano', name: 'Piano · Melody', volume: 1, notes: lead },
    { instrumentId: 'harp', name: 'Harp · Chords', volume: 0.45, notes: chords },
    { instrumentId: 'contrabass', name: 'Contrabass · Bass', volume: 0.6, notes: bass },
  ].filter((part) => part.notes.length > 0);
}

/** Too many parts for the song: the smallest moves to the part nearest in pitch, not the bin. */
function foldExtraParts(parts: Part[]): Part[] {
  const kept = [...parts];
  while (kept.length > MAX_PARTS) {
    const extra = kept.pop()!;
    const center = median(extra.notes.map((note) => note.midi));
    const nearest = kept.reduce((best, part) =>
      Math.abs(median(part.notes.map((note) => note.midi)) - center) <
      Math.abs(median(best.notes.map((note) => note.midi)) - center) ? part : best,
    );
    nearest.notes.push(...extra.notes);
  }
  return kept;
}

/**
 * Settles each line's octave, then hands notes its instrument can't reach to one that can,
 * so they keep their real pitch instead of folding back and breaking the line. A note with
 * nowhere to go stays put and folds; too few notes never justify a whole extra instrument.
 */
function reachNotes(parts: Part[], shift: number): Part[] {
  const ranges = (id: string) => {
    const pads = padPitches(getInstrument(id));
    return [pads[0], pads[pads.length - 1]];
  };
  const stranded: { note: SourceNote; home: number }[] = [];
  const settled = parts.map((part, home) => {
    const [low, high] = ranges(part.instrumentId);
    // One octave for the whole part: moving lines apart scrambles a section's chords.
    const octave = bestOctave(part.notes.map((note) => note.midi + shift), low, high);
    const inside: SourceNote[] = [];
    for (const note of part.notes) {
      const pitch = note.midi + shift + octave;
      if (pitch >= low && pitch <= high) inside.push({ ...note, pitch });
      else stranded.push({ note: { ...note, pitch }, home });
    }
    return { ...part, notes: inside };
  });

  const extra = new Map<string, { note: SourceNote; home: number }[]>();
  for (const { note, home } of stranded) {
    const pitch = note.pitch!;
    const fits = settled.filter((part) => {
      const [low, high] = ranges(part.instrumentId);
      return pitch >= low && pitch <= high;
    });
    if (fits.length > 0) {
      fits.reduce((best, part) => {
        const center = (id: string) => (ranges(id)[0] + ranges(id)[1]) / 2;
        return Math.abs(center(part.instrumentId) - pitch) < Math.abs(center(best.instrumentId) - pitch) ? part : best;
      }).notes.push(note);
    } else {
      const id = pitch < 60 ? LOW_REACH : HIGH_REACH;
      extra.set(id, [...(extra.get(id) ?? []), { note, home }]);
    }
  }
  const added: Part[] = [];
  const total = parts.reduce((sum, part) => sum + part.notes.length, 0);
  for (const [instrumentId, notes] of extra) {
    if (notes.length >= total * MIN_REACH_SHARE) {
      const moved = notes.map(({ note }) => note);
      added.push({ instrumentId, name: getInstrument(instrumentId).displayName, volume: 0.8, notes: moved });
    } else {
      for (const { note, home } of notes) settled[home].notes.push(note);
    }
  }
  return [...settled, ...added].filter((part) => part.notes.length > 0);
}

/**
 * Clears what the whole band plays at once, not just one part: a note the pads can't play
 * only lands on a wrong neighbour beside others that already say enough, and a pitch two
 * parts share just thickens the sound, so the loudest copy stays.
 */
function clearClashes(parts: Part[], grid: number): Part[] {
  const sizes = new Map<number, number>();
  const loudest = new Map<string, SourceNote>();
  const at = (note: SourceNote) => snap(note.startBeat, grid);
  for (const note of parts.flatMap((part) => part.notes)) {
    sizes.set(at(note), (sizes.get(at(note)) ?? 0) + 1);
    const key = `${at(note)}:${note.pitch}`;
    const held = loudest.get(key);
    if (!held || note.velocity > held.velocity) loudest.set(key, note);
  }
  const clear = parts.flatMap((part) => part.notes).filter((note) => {
    const offScale = !C_MAJOR.has((((note.pitch ?? note.midi) % 12) + 12) % 12);
    if (offScale && (sizes.get(at(note)) ?? 0) >= 3) return false;
    return loudest.get(`${at(note)}:${note.pitch}`) === note;
  });
  // Top and bottom carry the tune and the harmony; the loudest of the middle fill in.
  const moments = new Map<number, SourceNote[]>();
  for (const note of clear) moments.set(at(note), [...(moments.get(at(note)) ?? []), note]);
  const kept = new Set<SourceNote>();
  for (const moment of moments.values()) {
    const byPitch = [...moment].sort((a, b) => (a.pitch ?? a.midi) - (b.pitch ?? b.midi));
    const middle = byPitch.slice(1, -1).sort((a, b) => b.velocity - a.velocity);
    for (const note of [byPitch[0], byPitch[byPitch.length - 1], ...middle.slice(0, MAX_BAND_NOTES - 2)]) kept.add(note);
  }
  return parts
    .map((part) => ({ ...part, notes: part.notes.filter((note) => kept.has(note)) }))
    .filter((part) => part.notes.length > 0);
}

function clampBpm(bpm: number): number {
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
}

/**
 * The tempo the song spends the most time in. A file's first tempo is often just a
 * count-in or a pickup, and a project has one tempo, so the opening one can be far off.
 */
function songBpm(midi: Midi): number {
  const { tempos } = midi.header;
  const notes = midi.tracks.flatMap((track) => track.notes);
  if (tempos.length < 2 || notes.length === 0) return tempos[0]?.bpm ?? 90;
  const first = Math.min(...notes.map((note) => note.ticks));
  const last = Math.max(...notes.map((note) => note.ticks + note.durationTicks));
  const held = new Map<number, number>();
  tempos.forEach((tempo, index) => {
    const from = Math.max(first, tempo.ticks);
    const to = Math.min(last, tempos[index + 1]?.ticks ?? last);
    const bpm = Math.round(tempo.bpm);
    if (to > from) held.set(bpm, (held.get(bpm) ?? 0) + to - from);
  });
  let best = tempos[0].bpm;
  let longest = 0;
  for (const [bpm, ticks] of held) {
    if (ticks > longest) {
      best = bpm;
      longest = ticks;
    }
  }
  return best;
}

/** Files this app exported name each track `<track> | <instrument> (<part>, <role>)`. */
function nativeTrackParts(name: string): { name: string; instrument: InstrumentDefinition } | null {
  const match = /^(.*) \| (.+) \([^,]+, \w+\)$/.exec(name);
  const instrument = match && INSTRUMENTS.find((item) => midiSafeText(item.displayName) === match[2]);
  return match && instrument?.selectable ? { name: match[1], instrument } : null;
}

/** Restores a file exported by this app note for note, so nothing is arranged twice. */
function nativeProject(midi: Midi, title: string): Project | null {
  const sources = midi.tracks.filter((track) => track.notes.length > 0 || nativeTrackParts(track.name));
  const parts = sources.map((track) => nativeTrackParts(track.name));
  if (parts.length === 0 || parts.some((part) => !part)) return null;
  const project = createProject({ title, bpm: clampBpm(songBpm(midi)), key: 0 });
  const meter = midi.header.timeSignatures[0]?.timeSignature;
  project.timeSignature =
    TIME_SIGNATURES.find((option) => option.value[0] === meter?.[0] && option.value[1] === meter?.[1])?.value ?? [4, 4];
  project.tracks = sources.map((source, index) => {
    const { name, instrument } = parts[index]!;
    const track = createTrack(instrument.id, { name: name.slice(0, MAX_TRACK_NAME_LENGTH) || instrument.displayName, colorIndex: index });
    const pitches = instrument.pads.map((_, pad) => {
      const resolved = resolvePad(instrument, 0, pad);
      return resolved.pitched ? resolved.midi : resolved.drumNote;
    });
    track.notes = sortNotes(
      source.notes.map((note) => {
        const exact = pitches.indexOf(note.midi);
        const pad = exact >= 0 ? exact : pitches.reduce<number>(
          (best, pitch, candidate) => Math.abs((pitch ?? 0) - note.midi) < Math.abs((pitches[best] ?? 0) - note.midi) ? candidate : best,
          0,
        );
        return {
          id: newId('note'),
          pad,
          startBeat: note.ticks / midi.header.ppq,
          durationBeats: Math.max(GRID / 4, note.durationTicks / midi.header.ppq),
          velocity: Math.max(0.05, note.velocity),
        };
      }),
    );
    return track;
  });
  return project;
}

/** Drops the end of a song that exceeds the project limit; returns how many notes went. */
export function trimToNoteLimit(project: Project): number {
  const starts = project.tracks.flatMap((track) => track.notes.map((note) => note.startBeat)).sort((a, b) => a - b);
  if (starts.length <= MAX_PROJECT_NOTES) return 0;
  const cutoff = starts[MAX_PROJECT_NOTES];
  for (const track of project.tracks) track.notes = track.notes.filter((note) => note.startBeat < cutoff);
  return starts.length - project.tracks.reduce((sum, track) => sum + track.notes.length, 0);
}

/** Converts a Standard MIDI File into a project that only uses real game pads. */
export function midiToProject(bytes: ArrayBuffer | Uint8Array, title: string): Project {
  const midi = new Midi(bytes);
  const native = nativeProject(midi, title);
  if (native) return native;
  const [meter] = midi.header.timeSignatures;
  // Fast waltzes are often notated in 6/8; as 3/4 at double tempo the notes sit on the beats.
  const waltz = meter?.timeSignature[0] === 6 && meter?.timeSignature[1] === 8;
  const beat = (ticks: number) => (ticks / midi.header.ppq) * (waltz ? 2 : 1);
  const boost = velocityBoost(midi.tracks.flatMap((track) => track.notes.map((note) => note.velocity)));
  const source = (track: Midi['tracks'][number]): SourceNote[] =>
    track.notes.map((note) => ({
      midi: note.midi,
      startBeat: beat(note.ticks),
      durationBeats: beat(note.durationTicks),
      velocity: Math.min(1, note.velocity * boost),
    }));

  const pitched = midi.tracks.filter((track) => track.notes.length > 0 && !track.instrument.percussion);
  const drums = midi.tracks.filter((track) => track.notes.length > 0 && track.instrument.percussion);
  if (pitched.length === 0 && drums.length === 0) throw new Error('That MIDI file has no notes.');

  let parts: Part[];
  const lone = pitched.length === 1 ? source(pitched[0]) : [];
  if (lone.length > 0 && new Set(lone.map((note) => snap(note.startBeat))).size * 1.2 < lone.length) {
    const [top, bottom] = waltz ? [3, 4] : meter?.timeSignature ?? [4, 4];
    parts = splitSoloTrack(lone, (top * 4) / bottom);
  } else {
    const merged = new Map<string, Part>();
    const seenParts = new Set<string>();
    for (const track of pitched) {
      // Arrangers often double a part on two channels; one copy is enough here.
      const fingerprint = track.notes.map((note) => `${note.ticks}:${note.midi}`).join();
      if (seenParts.has(fingerprint)) continue;
      seenParts.add(fingerprint);
      const instrumentId = instrumentForTrack(track.name, track.instrument.number);
      const part = merged.get(instrumentId) ?? {
        instrumentId,
        name: getInstrument(instrumentId).displayName,
        volume: 0.8,
        notes: [],
      };
      part.notes.push(...source(track));
      merged.set(instrumentId, part);
    }
    parts = [...merged.values()].sort((a, b) => b.notes.length - a.notes.length);
  }
  parts = foldExtraParts(parts);
  const grid = timingGrid(parts.flatMap((part) => part.notes));

  const shift = bestTranspose(parts.flatMap((part) => part.notes));
  const known = TIME_SIGNATURES.find(
    (option) => option.value[0] === meter?.timeSignature[0] && option.value[1] === meter?.timeSignature[1],
  );
  const bpm = songBpm(midi) * (waltz ? 2 : 1);
  const project = createProject({ title, bpm: clampBpm(bpm), key: 0 });
  project.timeSignature = waltz ? [3, 4] : known ? known.value : [4, 4];
  project.tracks = clearClashes(reachNotes(parts, shift), grid).map((part, index) => {
    const track = createTrack(part.instrumentId, { name: part.name, colorIndex: index });
    track.volume = part.volume;
    track.notes = placeNotes(part.notes, getInstrument(part.instrumentId), grid);
    return track;
  });

  if (drums.length > 0) {
    const track = createTrack('drum', { name: 'Drum', colorIndex: project.tracks.length });
    const seen = new Set<string>();
    for (const note of drums.flatMap(source)) {
      const pad = DRUM_PADS[note.midi];
      const startBeat = snap(note.startBeat, grid);
      if (pad === undefined || seen.has(`${pad}:${startBeat}`)) continue;
      seen.add(`${pad}:${startBeat}`);
      track.notes.push({ id: newId('note'), pad, startBeat, durationBeats: grid, velocity: note.velocity });
    }
    track.notes = sortNotes(track.notes);
    project.tracks.push(track);
  }
  return project;
}
