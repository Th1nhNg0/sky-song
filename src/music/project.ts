import { DEFAULT_INSTRUMENT_ID, getInstrument } from './instruments';
import { CATALOG_VERSION, PROJECT_SCHEMA_VERSION } from './types';
import type { LoopRegion, Note, Project, Track } from './types';

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

export function createNote(
  pad: number,
  startBeat: number,
  durationBeats: number,
  velocity = 0.85,
): Note {
  return {
    id: newId('n'),
    pad,
    startBeat: Math.max(0, startBeat),
    durationBeats: Math.max(0.05, durationBeats),
    velocity: Math.min(1, Math.max(0.05, velocity)),
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
    volume: 0.85,
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

function defaultLoop(): LoopRegion {
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
    title: options.title ?? 'Untitled Song',
    bpm: options.bpm ?? 90,
    timeSignature: [4, 4],
    key: options.key ?? 0,
    tracks: [track],
    loop: defaultLoop(),
    createdAt: now,
    updatedAt: now,
  };
}

/** Last meaningful beat; minimum four bars so the timeline always has room. */
export function projectEndBeat(project: Project): number {
  let end = 0;
  for (const track of project.tracks) {
    for (const note of track.notes) {
      end = Math.max(end, note.startBeat + note.durationBeats);
    }
  }
  return Math.max(16, Math.ceil(end));
}

function anySolo(project: Project): boolean {
  return project.tracks.some((track) => track.solo);
}

export function isTrackAudible(project: Project, track: Track): boolean {
  if (track.muted) return false;
  if (anySolo(project)) return track.solo;
  return true;
}

export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => a.startBeat - b.startBeat || a.pad - b.pad);
}

export function projectToJson(project: Project): string {
  return JSON.stringify(project, null, 2);
}
