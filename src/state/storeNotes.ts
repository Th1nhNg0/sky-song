import { getInstrument } from '../music/instruments';
import { clampVelocity, createNote, DEFAULT_VELOCITY, sortNotes } from '../music/project';
import { snapBeat } from '../music/time';
import type { Note } from '../music/types';
import { clamp, plural } from '../util';
import { findTrack, replaceTrack } from './storeHelpers';
import type { AppState, Clipboard, StoreTools } from './storeTypes';

function roundBeat(beat: number): number {
  return Math.round(beat * 1000) / 1000;
}

/** Lowest change to `delta` that keeps the whole group on the instrument, preserving its shape. */
function clampPadDelta(pads: number[], delta: number, keyCount: number): number {
  return Math.min(keyCount - 1 - Math.max(...pads), Math.max(-Math.min(...pads), delta));
}

type NoteActions = Pick<
  AppState,
  'selectNotes' | 'selectAllNotes' | 'clearSelection' | 'addNote' | 'deleteNotes'
  | 'deleteSelectedNotes' | 'cloneSelectionInPlace' | 'nudgeSelection' | 'setSelectionVelocity'
  | 'dragSelectedNotes' | 'resizeNote' | 'copySelection' | 'cutSelection' | 'pasteClipboard'
  | 'duplicateSelection' | 'quantizeSelection' | 'restoreOriginalTiming'
>;

/** Selecting and editing the notes of the open track, and the clipboard. */
export function noteActions({ set, get, commit }: StoreTools): NoteActions {
  return {
    selectNotes: (ids, mode = 'replace') => {
      const current = get().selectedNoteIds;
      let next: string[];
      if (mode === 'replace') next = ids;
      else if (mode === 'add') next = [...new Set([...current, ...ids])];
      else {
        const setIds = new Set(current);
        for (const id of ids) {
          if (setIds.has(id)) setIds.delete(id);
          else setIds.add(id);
        }
        next = [...setIds];
      }
      set({ selectedNoteIds: next });
    },
    selectAllNotes: () => {
      set({ selectedNoteIds: get().activeTrack().notes.map((note) => note.id) });
    },
    clearSelection: () => {
      if (get().selectedNoteIds.length > 0) set({ selectedNoteIds: [] });
    },

    addNote: (pad, startBeat, durationBeats, options = {}) => {
      const state = get();
      const track = findTrack(state.project, state.activeTrackId);
      if (!track) return null;
      const instrument = getInstrument(track.instrumentId);
      if (!Number.isInteger(pad) || pad < 0 || pad >= instrument.keyCount) {
        state.notify(`Pad ${pad + 1} is outside ${instrument.displayName}'s ${instrument.keyCount}-pad grid.`, 'warning');
        return null;
      }
      const note = createNote(pad, Math.max(0, startBeat), Math.max(0.05, durationBeats), options.velocity ?? DEFAULT_VELOCITY);
      commit(
        replaceTrack(state.project, track.id, (item) => ({ ...item, notes: sortNotes([...item.notes, note]) })),
        { selectedNoteIds: options.select === false ? state.selectedNoteIds : [note.id] },
        options.history !== false,
      );
      return note.id;
    },
    deleteNotes: (ids, options = {}) => {
      const state = get();
      if (ids.length === 0) return;
      const track = findTrack(state.project, state.activeTrackId);
      if (!track) return;
      const setIds = new Set(ids);
      const notes = track.notes.filter((note) => !setIds.has(note.id));
      if (notes.length === track.notes.length) return;
      commit(
        replaceTrack(state.project, track.id, (item) => ({ ...item, notes })),
        { selectedNoteIds: state.selectedNoteIds.filter((id) => !setIds.has(id)) },
        options.history !== false,
      );
    },
    deleteSelectedNotes: () => get().deleteNotes(get().selectedNoteIds),

    cloneSelectionInPlace: () => {
      const state = get();
      const track = state.activeTrack();
      const ids = new Set(state.selectedNoteIds);
      const copies = track.notes
        .filter((note) => ids.has(note.id))
        .map((note) => createNote(note.pad, note.startBeat, note.durationBeats, note.velocity));
      if (copies.length === 0) return;
      commit(
        replaceTrack(state.project, track.id, (item) => ({ ...item, notes: sortNotes([...item.notes, ...copies]) })),
        { selectedNoteIds: copies.map((note) => note.id) },
        false,
      );
    },
    nudgeSelection: (deltaBeats, deltaPad) => {
      const state = get();
      const track = state.activeTrack();
      const ids = new Set(state.selectedNoteIds);
      const selected = track.notes.filter((note) => ids.has(note.id));
      if (selected.length === 0) return;
      const beats = Math.max(deltaBeats, -Math.min(...selected.map((note) => note.startBeat)));
      const pads = clampPadDelta(selected.map((note) => note.pad), deltaPad, getInstrument(track.instrumentId).keyCount);
      if (beats === 0 && pads === 0) return;
      const notes = track.notes.map((note) =>
        ids.has(note.id) ? { ...note, startBeat: roundBeat(note.startBeat + beats), pad: note.pad + pads } : note,
      );
      commit(replaceTrack(state.project, track.id, (item) => ({ ...item, notes: sortNotes(notes) })));
    },
    setSelectionVelocity: (velocity) => {
      const state = get();
      const ids = new Set(state.selectedNoteIds);
      const value = clampVelocity(velocity);
      commit(
        replaceTrack(state.project, state.activeTrackId, (track) => ({
          ...track,
          notes: track.notes.map((note) => (ids.has(note.id) ? { ...note, velocity: value } : note)),
        })),
        {},
        state.gesture === null,
      );
    },
    dragSelectedNotes: (originals, deltaBeats, deltaPad) => {
      const state = get();
      const track = findTrack(state.project, state.activeTrackId);
      if (!track) return;
      const entries = Object.values(originals);
      const beats = Math.max(deltaBeats, -Math.min(...entries.map((entry) => entry.startBeat)));
      const pads = clampPadDelta(entries.map((entry) => entry.pad), deltaPad, getInstrument(track.instrumentId).keyCount);
      let changed = false;
      const notes = track.notes.map((note) => {
        const original = originals[note.id];
        if (!original) return note;
        const startBeat = roundBeat(original.startBeat + beats);
        const pad = original.pad + pads;
        if (startBeat === note.startBeat && pad === note.pad) return note;
        changed = true;
        return { ...note, startBeat, pad };
      });
      if (changed) commit(replaceTrack(state.project, track.id, (item) => ({ ...item, notes: sortNotes(notes) })), {}, false);
    },
    resizeNote: (noteId, durationBeats) => {
      const state = get();
      const track = findTrack(state.project, state.activeTrackId);
      if (!track) return;
      const instrument = getInstrument(track.instrumentId);
      if (!instrument.supportsHold) return;
      const next = clamp(roundBeat(durationBeats), 0.1, instrument.maxHoldBeats);
      const notes = track.notes.map((note) => (note.id === noteId ? { ...note, durationBeats: next } : note));
      commit(replaceTrack(state.project, track.id, (item) => ({ ...item, notes })), {}, false);
    },

    copySelection: () => {
      const state = get();
      const track = state.activeTrack();
      const ids = new Set(state.selectedNoteIds);
      const selected = track.notes.filter((note) => ids.has(note.id));
      if (selected.length === 0) {
        state.notify('Select notes first.', 'info');
        return;
      }
      const minStart = Math.min(...selected.map((note) => note.startBeat));
      const clipboard: Clipboard = {
        instrumentId: track.instrumentId,
        notes: selected.map((note) => ({
          pad: note.pad,
          offsetBeat: note.startBeat - minStart,
          durationBeats: note.durationBeats,
          velocity: note.velocity,
        })),
      };
      set({ clipboard });
      state.notify(`Copied ${selected.length} note${plural(selected.length)}.`, 'info');
    },
    cutSelection: () => {
      const state = get();
      state.copySelection();
      state.deleteSelectedNotes();
    },
    pasteClipboard: (atBeat) => {
      const state = get();
      const clipboard = state.clipboard;
      if (!clipboard || clipboard.notes.length === 0) {
        state.notify('Nothing to paste yet.', 'info');
        return null;
      }
      const track = findTrack(state.project, state.activeTrackId);
      if (!track) return null;
      const instrument = getInstrument(track.instrumentId);
      const kept = clipboard.notes.filter((note) => note.pad < instrument.keyCount);
      if (kept.length === 0) {
        state.notify(`${instrument.displayName} cannot play the copied pads.`, 'warning');
        return null;
      }
      const base = Math.max(0, atBeat);
      const created = kept.map((note) => createNote(note.pad, base + note.offsetBeat, note.durationBeats, note.velocity));
      commit(
        replaceTrack(state.project, track.id, (item) => ({ ...item, notes: sortNotes([...item.notes, ...created]) })),
        { selectedNoteIds: created.map((note) => note.id) },
      );
      if (kept.length < clipboard.notes.length) {
        state.notify(
          `Pasted ${kept.length} of ${clipboard.notes.length} notes; ${instrument.displayName} has only ${instrument.keyCount} pads.`,
          'warning',
        );
      }
      const step = state.preferences.snap || 0.25;
      return base + Math.ceil((Math.max(...kept.map((note) => note.offsetBeat)) + step) / step) * step;
    },
    duplicateSelection: () => {
      const state = get();
      const track = state.activeTrack();
      const ids = new Set(state.selectedNoteIds);
      const selected = track.notes.filter((note) => ids.has(note.id));
      if (selected.length === 0) {
        state.notify('Select notes to duplicate.', 'info');
        return;
      }
      // The copy starts right after the selection, so a phrase repeats in time.
      const step = state.preferences.snap || 0.25;
      const hold = getInstrument(track.instrumentId).supportsHold;
      const first = Math.min(...selected.map((note) => note.startBeat));
      const last = Math.max(...selected.map((note) => note.startBeat + (hold ? note.durationBeats : step)));
      const offset = Math.ceil((last - first) / step - 1e-6) * step;
      const created = selected.map((note) =>
        createNote(note.pad, note.startBeat + offset, note.durationBeats, note.velocity),
      );
      commit(
        replaceTrack(state.project, track.id, (item) => ({ ...item, notes: sortNotes([...item.notes, ...created]) })),
        { selectedNoteIds: created.map((note) => note.id) },
      );
    },
    quantizeSelection: (grid, preserveOriginal) => {
      const state = get();
      const track = findTrack(state.project, state.activeTrackId);
      if (!track || grid <= 0) return;
      const hold = getInstrument(track.instrumentId).supportsHold;
      const ids = new Set(state.selectedNoteIds);
      const inScope = (note: Note) => ids.size === 0 || ids.has(note.id);
      const count = track.notes.filter(inScope).length;
      if (count === 0) return;
      const notes = track.notes.map((note) => {
        if (!inScope(note)) return note;
        return {
          ...note,
          original:
            note.original ??
            (preserveOriginal ? { startBeat: note.startBeat, durationBeats: note.durationBeats } : undefined),
          startBeat: roundBeat(snapBeat(note.startBeat, grid)),
          // A one-shot rings out whatever its length, so only its onset has a grid position.
          durationBeats: hold ? Math.max(grid, Math.round(note.durationBeats / grid) * grid) : note.durationBeats,
        };
      });
      commit(replaceTrack(state.project, track.id, (item) => ({ ...item, notes: sortNotes(notes) })));
      state.notify(
        `Quantized ${count} note${plural(count)}${preserveOriginal ? ' · original timing preserved' : ''}.`,
        'success',
      );
    },
    restoreOriginalTiming: () => {
      const state = get();
      const track = findTrack(state.project, state.activeTrackId);
      if (!track) return;
      const ids = new Set(state.selectedNoteIds);
      let restored = 0;
      const notes = track.notes.map((note) => {
        if (!note.original || (ids.size > 0 && !ids.has(note.id))) return note;
        restored++;
        const { original, ...rest } = note;
        return { ...rest, startBeat: original.startBeat, durationBeats: original.durationBeats };
      });
      if (restored === 0) {
        state.notify('No preserved original timing on these notes.', 'info');
        return;
      }
      commit(replaceTrack(state.project, track.id, (item) => ({ ...item, notes: sortNotes(notes) })));
      state.notify(`Restored original timing on ${restored} note${plural(restored)}.`, 'success');
    },
  };
}
