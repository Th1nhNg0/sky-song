import { DEFAULT_INSTRUMENT_ID, getInstrument, hasInstrument } from '../music/instruments';
import {
  createTrack,
  DEFAULT_TITLE,
  MAX_TRACK_VOLUME,
  newId,
  renameForInstrument,
  TRACK_COLORS,
} from '../music/project';
import { clampBpm } from '../music/time';
import type { LoopRegion, Track } from '../music/types';
import { MAX_TITLE_LENGTH, MAX_TRACK_NAME_LENGTH, MAX_TRACKS } from '../music/validation';
import { clamp, plural } from '../util';
import { findTrack, replaceTrack } from './storeHelpers';
import type { AppState, StoreTools } from './storeTypes';

function sanitizeName(value: string, fallback: string, max = MAX_TITLE_LENGTH): string {
  const trimmed = value.trim();
  return (trimmed || fallback).slice(0, max);
}

type SongActions = Pick<
  AppState,
  'setTitle' | 'setBpm' | 'setMeter' | 'setLoop' | 'toggleLoop' | 'setActiveTrack' | 'addTrack'
  | 'removeTrack' | 'duplicateTrack' | 'renameTrack' | 'moveTrack' | 'setTrackInstrument'
  | 'setTrackColor' | 'toggleTrackMute' | 'toggleTrackSolo' | 'setTrackVolume'
>;

/** The song's own settings and its tracks: title, tempo, meter, loop, instruments and mix. */
export function songActions({ set, get, commit }: StoreTools): SongActions {
  return {
    setTitle: (title) => {
      const project = get().project;
      const next = sanitizeName(title, DEFAULT_TITLE);
      if (next !== project.title) commit({ ...project, title: next });
    },
    setBpm: (bpm) => {
      if (!Number.isFinite(bpm)) return;
      const value = clampBpm(bpm);
      if (get().project.bpm !== value) commit({ ...get().project, bpm: value });
    },
    setMeter: (meter) => {
      const project = get().project;
      if (project.timeSignature[0] === meter[0] && project.timeSignature[1] === meter[1]) return;
      commit({ ...project, timeSignature: [meter[0], meter[1]] });
    },
    setLoop: (loop) => {
      const project = get().project;
      const next: LoopRegion = {
        enabled: loop.enabled,
        startBeat: Math.max(0, Math.min(loop.startBeat, loop.endBeat - 0.25)),
        endBeat: Math.max(loop.startBeat + 0.25, loop.endBeat),
      };
      const same =
        next.enabled === project.loop.enabled &&
        next.startBeat === project.loop.startBeat &&
        next.endBeat === project.loop.endBeat;
      if (!same) commit({ ...project, loop: next });
    },
    toggleLoop: () => {
      const loop = get().project.loop;
      get().setLoop({ ...loop, enabled: !loop.enabled });
    },

    setActiveTrack: (id) => {
      if (id === get().activeTrackId || !findTrack(get().project, id)) return;
      set({ activeTrackId: id, selectedNoteIds: [] });
    },
    addTrack: (instrumentId) => {
      const project = get().project;
      if (project.tracks.length >= MAX_TRACKS) {
        get().notify(`A project can hold up to ${MAX_TRACKS} performers.`, 'warning');
        return;
      }
      const id = instrumentId && hasInstrument(instrumentId) ? instrumentId : DEFAULT_INSTRUMENT_ID;
      const track = createTrack(id, { colorIndex: project.tracks.length % TRACK_COLORS.length });
      if (!instrumentId) track.name = `${getInstrument(id).shortName} · Performer ${project.tracks.length + 1}`;
      commit({ ...project, tracks: [...project.tracks, track] }, { activeTrackId: track.id, selectedNoteIds: [] });
    },
    removeTrack: (id) => {
      const project = get().project;
      if (project.tracks.length <= 1) {
        get().notify('A project needs at least one performer track.', 'warning');
        return;
      }
      const index = project.tracks.findIndex((track) => track.id === id);
      if (index === -1) return;
      const tracks = project.tracks.filter((track) => track.id !== id);
      const activeTrackId = get().activeTrackId === id ? tracks[Math.max(0, index - 1)].id : get().activeTrackId;
      commit({ ...project, tracks }, { activeTrackId, selectedNoteIds: [] });
    },
    duplicateTrack: (id) => {
      const project = get().project;
      const source = findTrack(project, id);
      if (!source) return;
      if (project.tracks.length >= MAX_TRACKS) {
        get().notify(`A project can hold up to ${MAX_TRACKS} performers.`, 'warning');
        return;
      }
      const copy: Track = {
        ...source,
        id: newId('track'),
        name: sanitizeName(`${source.name} (copy)`, 'Copy', MAX_TRACK_NAME_LENGTH),
        notes: source.notes.map((note) => ({ ...note, id: newId('n') })),
      };
      const tracks = [...project.tracks];
      tracks.splice(tracks.indexOf(source) + 1, 0, copy);
      commit({ ...project, tracks }, { activeTrackId: copy.id, selectedNoteIds: [] });
    },
    renameTrack: (id, name) => {
      const project = get().project;
      const track = findTrack(project, id);
      if (!track) return;
      const next = sanitizeName(name, track.name, MAX_TRACK_NAME_LENGTH);
      if (next !== track.name) commit(replaceTrack(project, id, (item) => ({ ...item, name: next })));
    },
    moveTrack: (id, direction) => {
      const project = get().project;
      const index = project.tracks.findIndex((track) => track.id === id);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= project.tracks.length) return;
      const tracks = [...project.tracks];
      const [track] = tracks.splice(index, 1);
      tracks.splice(target, 0, track);
      commit({ ...project, tracks });
    },
    setTrackInstrument: (id, instrumentId) => {
      if (!hasInstrument(instrumentId)) return;
      const instrument = getInstrument(instrumentId);
      if (!instrument.selectable) {
        get().notify(`${instrument.displayName} is not a selectable track instrument.`, 'warning');
        return;
      }
      const project = get().project;
      const track = findTrack(project, id);
      if (!track || track.instrumentId === instrumentId) return;
      const notes = track.notes.filter((note) => note.pad < instrument.keyCount);
      const removed = track.notes.length - notes.length;
      const kept = new Set(notes.map((note) => note.id));
      const name = renameForInstrument(track.name, track.instrumentId, instrumentId);
      commit(replaceTrack(project, id, (item) => ({ ...item, instrumentId, name, notes })), {
        selectedNoteIds: get().selectedNoteIds.filter((noteId) => kept.has(noteId)),
      });
      if (removed > 0) {
        get().notify(
          `${instrument.displayName} has ${instrument.keyCount} pads. Removed ${removed} note${plural(removed)} outside its grid — undo is available.`,
          'warning',
        );
      }
    },
    setTrackColor: (id, color) => {
      const track = findTrack(get().project, id);
      if (track && track.color !== color) commit(replaceTrack(get().project, id, (item) => ({ ...item, color })));
    },
    toggleTrackMute: (id) => {
      commit(replaceTrack(get().project, id, (track) => ({ ...track, muted: !track.muted })));
    },
    toggleTrackSolo: (id) => {
      commit(replaceTrack(get().project, id, (track) => ({ ...track, solo: !track.solo })));
    },
    setTrackVolume: (id, volume) => {
      const value = clamp(volume, 0, MAX_TRACK_VOLUME);
      // A drag is one undo step (its gesture records it); a key press is a step of its own.
      commit(replaceTrack(get().project, id, (track) => ({ ...track, volume: value })), {}, get().gesture === null);
    },
  };
}
