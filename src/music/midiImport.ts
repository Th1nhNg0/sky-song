import { Midi } from '@tonejs/midi';
import { getInstrument } from './instruments';
import { resolvePad } from './pitch';
import { createProject, createTrack, newId, sortNotes } from './project';
import { TIME_SIGNATURES } from './time';
import type { InstrumentDefinition, Note, Project } from './types';

interface SourceNote {
  midi: number;
  startBeat: number;
  durationBeats: number;
  velocity: number;
}

interface Part {
  instrumentId: string;
  name: string;
  volume: number;
  notes: SourceNote[];
}

const GRID = 0.25;
const MAX_PARTS = 6;
const MAX_CHORD = 4;
const C_MAJOR = new Set([0, 2, 4, 5, 7, 9, 11]);

/** General MIDI percussion note → pad on the 8-pad drum. */
const DRUM_PADS: Record<number, number> = {
  35: 0, 36: 0, 41: 1, 43: 1, 38: 2, 40: 2, 45: 3, 47: 3, 37: 4, 39: 4, 48: 5, 50: 5,
  42: 6, 44: 6, 46: 6, 51: 6, 53: 6, 59: 6, 69: 6, 70: 6, 49: 7, 52: 7, 55: 7, 57: 7,
};

function instrumentForProgram(program: number): string {
  if (program < 8) return 'piano';
  if (program < 16) return 'xylophone';
  if (program < 24) return 'harmonica';
  if (program < 26) return 'guitar';
  if (program < 32) return 'light-guitar';
  if (program < 40) return 'contrabass';
  if (program < 48) return 'cello';
  if (program >= 52 && program < 55) return 'aurora-voice';
  if (program < 56) return 'cello';
  if (program < 64) return 'horn';
  if (program < 72) return 'saxophone';
  if (program < 80) return 'flute';
  return 'harp';
}

function snap(value: number): number {
  return Math.round(value / GRID) * GRID;
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

function placeNotes(notes: SourceNote[], instrument: InstrumentDefinition, shift: number): Note[] {
  const pads = instrument.pads.map((_, pad) => resolvePad(instrument, 0, pad).midi ?? 0);
  const low = pads[0];
  const high = pads[pads.length - 1];
  const moved = notes.map((note) => note.midi + shift);
  const octave = bestOctave(moved, low, high);
  const chords = new Map<number, Map<number, Note>>();
  notes.forEach((note, index) => {
    let target = moved[index] + octave;
    while (target < low) target += 12;
    while (target > high) target -= 12;
    let pad = 0;
    pads.forEach((value, candidate) => {
      if (Math.abs(value - target) < Math.abs(pads[pad] - target)) pad = candidate;
    });
    const startBeat = snap(note.startBeat);
    const chord = chords.get(startBeat) ?? new Map<number, Note>();
    chords.set(startBeat, chord);
    if (chord.has(pad)) return;
    chord.set(pad, {
      id: newId('note'),
      pad,
      startBeat,
      durationBeats: Math.max(GRID, snap(note.durationBeats)),
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

/** Converts a Standard MIDI File into a project that only uses real game pads. */
export function midiToProject(bytes: ArrayBuffer | Uint8Array, title: string): Project {
  const midi = new Midi(bytes);
  const [meter] = midi.header.timeSignatures;
  // Fast waltzes are often notated in 6/8; as 3/4 at double tempo the notes sit on the beats.
  const waltz = meter?.timeSignature[0] === 6 && meter?.timeSignature[1] === 8;
  const beat = (ticks: number) => (ticks / midi.header.ppq) * (waltz ? 2 : 1);
  const source = (track: Midi['tracks'][number]): SourceNote[] =>
    track.notes.map((note) => ({
      midi: note.midi,
      startBeat: beat(note.ticks),
      durationBeats: beat(note.durationTicks),
      velocity: note.velocity,
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
      const instrumentId = instrumentForProgram(track.instrument.number);
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
  parts = parts.slice(0, drums.length > 0 ? MAX_PARTS - 1 : MAX_PARTS);

  const shift = bestTranspose(parts.flatMap((part) => part.notes));
  const known = TIME_SIGNATURES.find(
    (option) => option.value[0] === meter?.timeSignature[0] && option.value[1] === meter?.timeSignature[1],
  );
  const bpm = Math.round((midi.header.tempos[0]?.bpm ?? 90) * (waltz ? 2 : 1));
  const project = createProject({ title, bpm: Math.min(240, bpm), key: 0 });
  project.timeSignature = waltz ? [3, 4] : known ? known.value : [4, 4];
  project.tracks = parts.map((part, index) => {
    const track = createTrack(part.instrumentId, { name: part.name, colorIndex: index });
    track.volume = part.volume;
    track.notes = placeNotes(part.notes, getInstrument(part.instrumentId), shift);
    return track;
  });

  if (drums.length > 0) {
    const track = createTrack('drum', { name: 'Drum', colorIndex: project.tracks.length });
    const seen = new Set<string>();
    for (const note of drums.flatMap(source)) {
      const pad = DRUM_PADS[note.midi];
      const startBeat = snap(note.startBeat);
      if (pad === undefined || seen.has(`${pad}:${startBeat}`)) continue;
      seen.add(`${pad}:${startBeat}`);
      track.notes.push({ id: newId('note'), pad, startBeat, durationBeats: GRID, velocity: note.velocity });
    }
    track.notes = sortNotes(track.notes);
    project.tracks.push(track);
  }
  return project;
}
