import { getInstrument, hasInstrument } from './instruments';
import { MAX_BPM, MIN_BPM, TIME_SIGNATURES } from './time';
import { MAX_TIMING_CHANGES, normalizeMeterChanges, normalizeTempoChanges } from './timing';
import { CATALOG_VERSION, PROJECT_SCHEMA_VERSION } from './types';
import type { Note, Project, Track, ValidationIssue, ValidationResult } from './types';
import {
  clampVelocity,
  DEFAULT_TITLE,
  DEFAULT_TRACK_VOLUME,
  DEFAULT_VELOCITY,
  defaultLoop,
  MAX_TRACK_VOLUME,
  newId,
  nowIso,
  sortNotes,
} from './project';
import { clamp, plural } from '../util';

export const MAX_PROJECT_NOTES = 20000;
export const MAX_TRACKS = 24;
export const MAX_TITLE_LENGTH = 120;
export const MAX_TRACK_NAME_LENGTH = 60;

const LIMITS = {
  maxTracks: MAX_TRACKS,
  maxNotesPerTrack: MAX_PROJECT_NOTES,
  maxNotesTotal: MAX_PROJECT_NOTES,
  maxTitleLength: MAX_TITLE_LENGTH,
  maxTrackNameLength: MAX_TRACK_NAME_LENGTH,
  maxDurationBeats: 512,
  maxStartBeat: 100000,
  maxFileBytes: 5 * 1024 * 1024,
};

const KNOWN_METERS = new Set(TIME_SIGNATURES.map((ts) => ts.value.join('/')));
const INSTRUMENT_ALIASES: Record<string, string> = {
  'piano-keyboard': 'piano',
  piano_keyboard: 'piano',
  winterpiano: 'winter-piano',
  grandpiano: 'grand-piano',
  lightguitar: 'light-guitar',
  aurora: 'aurora-voice',
};

function issue(path: string, message: string, severity: 'error' | 'warning'): ValidationIssue {
  return { path, message, severity };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Migrates older/looser project shapes to the current schema. Returns the
 * migrated raw value and human-readable notes about what changed.
 */
function migrateProject(raw: unknown): { value: unknown; notes: string[] } {
  if (!isRecord(raw)) return { value: raw, notes: [] };
  const notes: string[] = [];
  const version = raw.schemaVersion;
  if (typeof version === 'number' && version > PROJECT_SCHEMA_VERSION) {
    throw new Error(
      `This project was made with a newer version (schema ${version}); this app supports schema ${PROJECT_SCHEMA_VERSION}.`,
    );
  }
  const migrated: Record<string, unknown> = { ...raw };
  if (version === undefined || version === null) {
    migrated.schemaVersion = PROJECT_SCHEMA_VERSION;
    notes.push('Added missing schema version.');
  } else if (version === 0) {
    migrated.schemaVersion = PROJECT_SCHEMA_VERSION;
    notes.push('Migrated schema version 0 → 1.');
  }
  if (migrated.app === undefined) {
    migrated.app = 'sky-music-studio';
  }
  if (migrated.catalogVersion === undefined) {
    migrated.catalogVersion = CATALOG_VERSION;
  }
  if (Array.isArray(migrated.tracks)) {
    migrated.tracks = migrated.tracks.map((track) => {
      if (!isRecord(track)) return track;
      const instrumentId = typeof track.instrumentId === 'string' ? track.instrumentId : '';
      const alias = INSTRUMENT_ALIASES[instrumentId];
      if (alias && alias !== instrumentId) {
        notes.push(`Mapped legacy instrument id “${instrumentId}” → “${alias}”.`);
        return { ...track, instrumentId: alias };
      }
      return track;
    });
  }
  if (migrated.loop === undefined) {
    migrated.loop = defaultLoop();
    notes.push('Added default loop region.');
  }
  return { value: migrated, notes };
}

function validateNote(
  raw: unknown,
  trackPath: string,
  instrumentId: string,
  index: number,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
): Note | null {
  if (!isRecord(raw)) {
    errors.push(issue(`${trackPath}.notes[${index}]`, 'Note is not an object.', 'error'));
    return null;
  }
  const instrument = hasInstrument(instrumentId) ? getInstrument(instrumentId) : null;
  if (!instrument) return null;
  const path = `${trackPath}.notes[${index}]`;
  const id = typeof raw.id === 'string' && raw.id ? raw.id : newId('n');
  const pad = finiteNumber(raw.pad) ? raw.pad : Number.NaN;
  if (!Number.isInteger(pad) || pad < 0 || pad >= instrument.keyCount) {
    errors.push(
      issue(
        `${path}.pad`,
        `Pad ${String(pad)} is not playable on ${instrument.displayName} (valid 1–${instrument.keyCount}).`,
        'error',
      ),
    );
    return null;
  }
  const startBeat = finiteNumber(raw.startBeat) ? raw.startBeat : Number.NaN;
  if (!Number.isFinite(startBeat) || startBeat < 0 || startBeat > LIMITS.maxStartBeat) {
    errors.push(issue(`${path}.startBeat`, 'Start beat must be a finite number ≥ 0.', 'error'));
    return null;
  }
  let durationBeats = finiteNumber(raw.durationBeats) ? raw.durationBeats : Number.NaN;
  if (!Number.isFinite(durationBeats) || durationBeats <= 0) {
    errors.push(issue(`${path}.durationBeats`, 'Duration must be greater than 0.', 'error'));
    return null;
  }
  if (durationBeats > LIMITS.maxDurationBeats) {
    warnings.push(
      issue(`${path}.durationBeats`, `Duration clamped to ${LIMITS.maxDurationBeats} beats (app safety limit).`, 'warning'),
    );
    durationBeats = LIMITS.maxDurationBeats;
  }
  const velocity = clampVelocity(finiteNumber(raw.velocity) ? raw.velocity : DEFAULT_VELOCITY);
  const note: Note = {
    id,
    pad,
    startBeat,
    durationBeats,
    velocity,
  };
  if (isRecord(raw.original)) {
    const origStart = raw.original.startBeat;
    const origDur = raw.original.durationBeats;
    if (finiteNumber(origStart) && finiteNumber(origDur) && origStart >= 0 && origDur > 0) {
      note.original = { startBeat: origStart, durationBeats: origDur };
    }
  }
  return note;
}

/** Validates and normalizes an imported project. Never throws for bad data. */
function validateProject(input: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  let raw: unknown;
  const migrationNotes: string[] = [];
  try {
    const migrated = migrateProject(input);
    raw = migrated.value;
    migrationNotes.push(...migrated.notes);
  } catch (error) {
    errors.push(issue('$', error instanceof Error ? error.message : 'Unsupported project version.', 'error'));
    return { ok: false, errors, warnings };
  }
  if (!isRecord(raw)) {
    errors.push(issue('$', 'Project must be a JSON object.', 'error'));
    return { ok: false, errors, warnings };
  }
  for (const note of migrationNotes) {
    warnings.push(issue('$', note, 'warning'));
  }
  if (raw.app !== undefined && raw.app !== 'sky-music-studio') {
    errors.push(issue('$.app', 'Not a Sky Music Studio project.', 'error'));
  }
  if (raw.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    errors.push(issue('$.schemaVersion', `Unsupported schema version ${String(raw.schemaVersion)}.`, 'error'));
  }
  const titleRaw = raw.title;
  if (typeof titleRaw !== 'string') {
    errors.push(issue('$.title', 'Title must be a string.', 'error'));
  }
  const title = typeof titleRaw === 'string' ? titleRaw.trim().slice(0, LIMITS.maxTitleLength) : '';
  if (typeof titleRaw === 'string' && titleRaw.length > LIMITS.maxTitleLength) {
    warnings.push(issue('$.title', `Title truncated to ${LIMITS.maxTitleLength} characters.`, 'warning'));
  }
  const bpm = raw.bpm;
  if (!finiteNumber(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) {
    errors.push(issue('$.bpm', `Tempo must be between ${MIN_BPM} and ${MAX_BPM} BPM.`, 'error'));
  }
  const meterRaw = raw.timeSignature;
  let timeSignature: [number, number] = [4, 4];
  if (
    !Array.isArray(meterRaw) ||
    meterRaw.length !== 2 ||
    !meterRaw.every((n) => typeof n === 'number' && Number.isInteger(n)) ||
    !KNOWN_METERS.has(meterRaw.join('/'))
  ) {
    errors.push(issue('$.timeSignature', 'Time signature must be one of 4/4, 3/4, 2/4, 6/8, 5/4 or 7/8.', 'error'));
  } else {
    timeSignature = [meterRaw[0], meterRaw[1]];
  }
  const baseBpm = finiteNumber(bpm) ? Math.round(bpm) : 90;
  const tempoChanges = readChanges(raw.tempoChanges, '$.tempoChanges', warnings, (item) =>
    finiteNumber(item.bpm) && item.bpm >= MIN_BPM && item.bpm <= MAX_BPM ? { bpm: item.bpm } : null,
  );
  const meterChanges = readChanges(raw.meterChanges, '$.meterChanges', warnings, (item) => {
    const meter = item.timeSignature;
    return Array.isArray(meter) && meter.length === 2 && KNOWN_METERS.has(meter.join('/'))
      ? { timeSignature: [meter[0], meter[1]] as [number, number] }
      : null;
  });
  const tempos = normalizeTempoChanges(baseBpm, tempoChanges);
  const meters = normalizeMeterChanges(timeSignature, meterChanges);
  if (meters.length !== meterChanges.length || meters.some((change, index) => change.beat !== meterChanges[index].beat)) {
    warnings.push(issue('$.meterChanges', 'Meter changes were moved to bar lines, or dropped where they changed nothing.', 'warning'));
  }
  const key = raw.key;
  if (!finiteNumber(key) || !Number.isInteger(key) || key < 0 || key > 11) {
    errors.push(issue('$.key', 'Key must be an integer 0–11 (C..B major).', 'error'));
  }
  const tracksRaw = raw.tracks;
  if (!Array.isArray(tracksRaw) || tracksRaw.length === 0) {
    errors.push(issue('$.tracks', 'Project must contain at least one track.', 'error'));
  } else if (tracksRaw.length > LIMITS.maxTracks) {
    errors.push(issue('$.tracks', `Too many tracks (maximum ${LIMITS.maxTracks}).`, 'error'));
  }
  const tracks: Track[] = [];
  let totalNotes = 0;
  if (Array.isArray(tracksRaw)) {
    tracksRaw.forEach((trackRaw, trackIndex) => {
      const trackPath = `$.tracks[${trackIndex}]`;
      if (!isRecord(trackRaw)) {
        errors.push(issue(trackPath, 'Track must be an object.', 'error'));
        return;
      }
      const instrumentId = typeof trackRaw.instrumentId === 'string' ? trackRaw.instrumentId : '';
      if (!hasInstrument(instrumentId)) {
        errors.push(issue(`${trackPath}.instrumentId`, `Unknown instrument “${instrumentId}”.`, 'error'));
        return;
      }
      const instrument = getInstrument(instrumentId);
      if (!instrument.selectable) {
        errors.push(issue(`${trackPath}.instrumentId`, `${instrument.displayName} is not a track instrument.`, 'error'));
        return;
      }
      const nameRaw = trackRaw.name;
      const name =
        typeof nameRaw === 'string' && nameRaw.trim()
          ? nameRaw.trim().slice(0, LIMITS.maxTrackNameLength)
          : `${instrument.shortName} · Performer`;
      const volume = finiteNumber(trackRaw.volume) ? clamp(trackRaw.volume, 0, MAX_TRACK_VOLUME) : DEFAULT_TRACK_VOLUME;
      const color =
        typeof trackRaw.color === 'string' && /^#[0-9a-f]{6}$/i.test(trackRaw.color) ? trackRaw.color : '#8fd3ff';
      const notesRaw = trackRaw.notes;
      if (!Array.isArray(notesRaw)) {
        errors.push(issue(`${trackPath}.notes`, 'Track notes must be an array.', 'error'));
        return;
      }
      if (notesRaw.length > LIMITS.maxNotesPerTrack) {
        errors.push(
          issue(`${trackPath}.notes`, `Too many notes in track (max ${LIMITS.maxNotesPerTrack}).`, 'error'),
        );
        return;
      }
      totalNotes += notesRaw.length;
      const seenIds = new Set<string>();
      const notes: Note[] = [];
      notesRaw.forEach((noteRaw, noteIndex) => {
        const note = validateNote(noteRaw, trackPath, instrumentId, noteIndex, errors, warnings);
        if (!note) return;
        if (seenIds.has(note.id)) {
          errors.push(issue(`${trackPath}.notes[${noteIndex}].id`, `Duplicate note id “${note.id}”.`, 'error'));
          return;
        }
        seenIds.add(note.id);
        notes.push(note);
      });
      tracks.push({
        id: typeof trackRaw.id === 'string' && trackRaw.id ? trackRaw.id : newId('track'),
        name,
        instrumentId,
        color,
        volume,
        muted: Boolean(trackRaw.muted),
        solo: Boolean(trackRaw.solo),
        notes: sortNotes(notes),
      });
    });
  }
  if (totalNotes > LIMITS.maxNotesTotal) {
    errors.push(issue('$.tracks', `Project contains too many notes (max ${LIMITS.maxNotesTotal}).`, 'error'));
  }
  const trackIds = new Set<string>();
  for (const track of tracks) {
    if (trackIds.has(track.id)) {
      errors.push(issue('$.tracks', `Duplicate track id “${track.id}”.`, 'error'));
    }
    trackIds.add(track.id);
  }
  let loop = defaultLoop();
  if (isRecord(raw.loop)) {
    const start = finiteNumber(raw.loop.startBeat) ? Math.max(0, raw.loop.startBeat) : 0;
    const end = finiteNumber(raw.loop.endBeat) ? Math.max(0, raw.loop.endBeat) : 16;
    if (end <= start) {
      warnings.push(issue('$.loop', 'Loop end must be after loop start; loop disabled.', 'warning'));
      loop = { enabled: false, startBeat: start, endBeat: start + 16 };
    } else {
      loop = { enabled: Boolean(raw.loop.enabled), startBeat: start, endBeat: end };
    }
  } else if (raw.loop !== undefined) {
    warnings.push(issue('$.loop', 'Invalid loop region; using default.', 'warning'));
  }
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : nowIso();
  const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : createdAt;
  const project: Project = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    app: 'sky-music-studio',
    catalogVersion: typeof raw.catalogVersion === 'string' ? raw.catalogVersion : CATALOG_VERSION,
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId('proj'),
    title: title || DEFAULT_TITLE,
    bpm: baseBpm,
    timeSignature,
    ...(tempos.length > 0 ? { tempoChanges: tempos } : {}),
    ...(meters.length > 0 ? { meterChanges: meters } : {}),
    key: finiteNumber(key) && Number.isInteger(key) ? key : 0,
    tracks,
    loop,
    createdAt,
    updatedAt,
  };
  const ok = errors.length === 0;
  return ok ? { ok, errors, warnings, project } : { ok, errors, warnings };
}

/** Reads a list of tempo or meter changes, leaving out entries that make no sense. */
function readChanges<T>(
  raw: unknown,
  path: string,
  warnings: ValidationIssue[],
  read: (item: Record<string, unknown>) => T | null,
): (T & { beat: number })[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push(issue(path, 'Expected a list of changes; ignored.', 'warning'));
    return [];
  }
  const changes: (T & { beat: number })[] = [];
  for (const item of raw.slice(0, MAX_TIMING_CHANGES * 4)) {
    const value = isRecord(item) && finiteNumber(item.beat) && item.beat >= 0 ? read(item) : null;
    if (value && isRecord(item)) changes.push({ ...value, beat: item.beat as number });
  }
  const dropped = raw.length - changes.length;
  if (dropped > 0) warnings.push(issue(path, `${dropped} invalid change${plural(dropped)} ignored.`, 'warning'));
  return changes.sort((a, b) => a.beat - b.beat);
}

export class ProjectImportError extends Error {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  constructor(message: string, errors: ValidationIssue[], warnings: ValidationIssue[] = []) {
    super(message);
    this.name = 'ProjectImportError';
    this.errors = errors;
    this.warnings = warnings;
  }
}

export function parseProjectJson(text: string): { project: Project; warnings: ValidationIssue[] } {
  if (typeof text !== 'string' || text.length === 0) {
    throw new ProjectImportError('File is empty.', [issue('$', 'File is empty.', 'error')]);
  }
  if (text.length > LIMITS.maxFileBytes) {
    throw new ProjectImportError(
      `File is too large (${(text.length / 1024 / 1024).toFixed(1)} MB; maximum 5 MB).`,
      [issue('$', 'File exceeds the 5 MB import limit.', 'error')],
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProjectImportError('File is not valid JSON.', [issue('$', 'JSON parse error.', 'error')]);
  }
  const result = validateProject(parsed);
  if (!result.ok || !result.project) {
    throw new ProjectImportError(
      `Project import failed with ${result.errors.length} error${plural(result.errors.length)}.`,
      result.errors,
      result.warnings,
    );
  }
  return { project: result.project, warnings: result.warnings };
}
