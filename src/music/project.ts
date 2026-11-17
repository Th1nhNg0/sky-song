import { DEFAULT_INSTRUMENT_ID, getInstrument } from './instruments';
import { CATALOG_VERSION, PROJECT_SCHEMA_VERSION } from './types';
import type { LoopRegion, Note, Project, Track } from './types';
import { clamp } from '../util';

export const TRACK_COLORS = [
  '#8fd3ff',
  '#ffb289',
  '#b8f0d8',
  '#ffd98f',
  '#f7c6ff',
  '#a8b8ff',
  '#ff9f8a',
  '#d6f7a8',
];

export const DEFAULT_TITLE = 'Untitled Song';
export const DEFAULT_VELOCITY = 0.85;
export const DEFAULT_TRACK_VOLUME = 0.85;
export const MAX_TRACK_VOLUME = 1.5;

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

let idCounter = 0;

export function newId(prefix: string): string {
  idCounter = (idCounter + 1) % 1_000_000;
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return `${prefix}_${cryptoObj.randomUUID()}`;
  }
  let random = '';
  for (let i = 0; i < 10; i++) {
    random += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  }
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${random}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function clampVelocity(velocity: number): number {
  return clamp(velocity, 0.05, 1);
}

export function createNote(
  pad: number,
  startBeat: number,
  durationBeats: number,
  velocity = DEFAULT_VELOCITY,
): Note {
  return {
    id: newId('n'),
    pad,
    startBeat: Math.max(0, startBeat),
    durationBeats: Math.max(0.05, durationBeats),
    velocity: clampVelocity(velocity),
  };
}

export function createTrack(
  instrumentId = DEFAULT_INSTRUMENT_ID,
  options: { name?: string; color?: string; colorIndex?: number } = {},
): Track {
  const instrument = getInstrument(instrumentId);
  const performerNumber = options.colorIndex !== undefined ? options.colorIndex : Math.floor(Math.random() * TRACK_COLORS.length);
  return {
    id: newId('track'),
    name: options.name ?? `${instrument.shortName} · Performer`,
    instrumentId: instrument.id,
    color: options.color ?? TRACK_COLORS[performerNumber % TRACK_COLORS.length],
    volume: DEFAULT_TRACK_VOLUME,
    muted: false,
    solo: false,
    notes: [],
  };
}

/**
 * A track still named after its instrument ("Harp · Performer 2") follows an
 * instrument change; a name the user typed is left alone.
 */
export function renameForInstrument(name: string, fromInstrumentId: string, toInstrumentId: string): string {
  const prefix = `${getInstrument(fromInstrumentId).shortName} · `;
  if (!name.startsWith(prefix)) return name;
  return `${getInstrument(toInstrumentId).shortName} · ${name.slice(prefix.length)}`;
}

export function defaultLoop(): LoopRegion {
  return { enabled: false, startBeat: 0, endBeat: 16 };
}

export function createProject(options: { title?: string; bpm?: number; key?: number } = {}): Project {
  const track = createTrack(DEFAULT_INSTRUMENT_ID, { colorIndex: 0 });
  const now = nowIso();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    app: 'sky-music-studio',
    catalogVersion: CATALOG_VERSION,
    id: newId('proj'),
    title: options.title ?? DEFAULT_TITLE,
    bpm: options.bpm ?? 90,
    timeSignature: [4, 4],
    key: options.key ?? 0,
    tracks: [track],
    loop: defaultLoop(),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Beat where the last note ends; 0 for an empty song. Notes are sorted by start, so a
 * long early note can end after the last one starts.
 */
export function lastNoteEnd(project: Project): number {
  let end = 0;
  for (const track of project.tracks) {
    for (const note of track.notes) {
      end = Math.max(end, note.startBeat + note.durationBeats);
    }
  }
  return end;
}

/** Last meaningful beat; minimum four bars so the timeline always has room. */
export function projectEndBeat(project: Project): number {
  return Math.max(16, Math.ceil(lastNoteEnd(project)));
}

function anySolo(project: Project): boolean {
  return project.tracks.some((track) => track.solo);
}

export function isTrackAudible(project: Project, track: Track): boolean {
  if (track.muted) return false;
  if (anySolo(project)) return track.solo;
  return true;
}

/** The key a track sounds in: its own when it has one, otherwise the song's. */
export function trackKey(project: Pick<Project, 'key'>, track: Pick<Track, 'key'>): number {
  return track.key ?? project.key;
}

/** Pads one octave apart on this instrument (7 on the 15-pad keyboard), or null if its layout has none. */
function octavePads(instrumentId: string): number | null {
  const pads = getInstrument(instrumentId).pads;
  for (let step = 1; step < pads.length; step++) {
    let matches = 0;
    let fits = true;
    for (let pad = 0; pad + step < pads.length; pad++) {
      const low = pads[pad].semitone;
      const high = pads[pad + step].semitone;
      if (low === null || high === null || high - low !== 12) fits = false;
      else matches++;
    }
    if (fits && matches > 0) return step;
  }
  return null;
}

/**
 * The song in another key. The song's tracks move with the key; a track in a key of its own
 * moves by as much, so it stays where it was against the others. Keys run C..B, so where one
 * of them wraps past B (or C) and the other does not, that track would land an octave away:
 * its notes then move an octave along its pads instead, when they all fit.
 */
export function transposeProject(project: Project, key: number): Project {
  if (!Number.isInteger(key) || key < 0 || key > 11 || key === project.key) return project;
  const move = key - project.key;
  const tracks = project.tracks.map((track) => {
    if (track.key === undefined) return track;
    const next = (((track.key + move) % 12) + 12) % 12;
    const octaves = (next - track.key - move) / 12;
    const step = octavePads(track.instrumentId);
    let notes = track.notes;
    if (octaves !== 0 && step !== null) {
      const shift = -octaves * step;
      const last = getInstrument(track.instrumentId).pads.length - 1;
      if (notes.every((note) => note.pad + shift >= 0 && note.pad + shift <= last)) {
        notes = notes.map((note) => ({ ...note, pad: note.pad + shift }));
      }
    }
    if (next === key) {
      const { key: _own, ...rest } = track;
      void _own;
      return { ...rest, notes };
    }
    return { ...track, key: next, notes };
  });
  return { ...project, key, tracks };
}

export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => a.startBeat - b.startBeat || a.pad - b.pad);
}

export function projectToJson(project: Project): string {
  return JSON.stringify(project, null, 2);
}
