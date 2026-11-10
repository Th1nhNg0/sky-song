import { create } from 'zustand';
import { getInstrument, hasInstrument } from '../music/instruments';
import { createNote, createProject, createTrack, nowIso, renameForInstrument, sortNotes, TRACK_COLORS } from '../music/project';
import { snapBeat } from '../music/time';
import type { LoopRegion, Note, Project, Track, ValidationIssue } from '../music/types';
import { parseProjectJson, ProjectImportError } from '../music/validation';
import {
  deleteProjectFromLibrary,
  duplicateProjectInLibrary,
  listLibrary,
  loadProjectFromLibrary,
  saveProjectToLibrary,
  type LibraryEntry,
} from '../storage/library';
import { midiToProject, trimToNoteLimit } from '../music/midiImport';
import { loadPreferences, savePreferences, type Preferences } from '../storage/preferences';

type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';
type EditTool = 'select' | 'draw';
export type PanelKind = 'catalog' | 'library' | 'songs' | 'help' | 'settings' | 'export' | 'tracks' | null;
type ToastKind = 'info' | 'success' | 'warning' | 'error';

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ClipboardNote {
  pad: number;
  offsetBeat: number;
  durationBeats: number;
  velocity: number;
}

interface Clipboard {
  instrumentId: string;
  notes: ClipboardNote[];
}

interface AppState {
  project: Project;
  activeTrackId: string;
  selectedNoteIds: string[];
  playhead: number;
  isPlaying: boolean;
  editTool: EditTool;
  panel: PanelKind;
  welcomeOpen: boolean;
  preferences: Preferences;
  saveState: SaveState;
  lastSavedAt: string | null;
  saveError: string | null;
  history: { past: Project[]; future: Project[] };
  gesture: { project: Project } | null;
  clipboard: Clipboard | null;
  toast: Toast | null;
  library: LibraryEntry[];
  libraryLoading: boolean;
  lastWarnings: ValidationIssue[];
  /** Goes up each time a different song is opened, so playback can start it from the top. */
  songLoads: number;

  initialize(): Promise<void>;
  refreshLibrary(): Promise<void>;
  saveNow(): Promise<void>;
  setProject(project: Project, options?: { resetHistory?: boolean }): void;
  newProject(): void;
  openLibraryProject(id: string): Promise<boolean>;
  deleteLibraryProject(id: string): Promise<void>;
  duplicateLibraryProject(id: string): Promise<void>;
  importProjectJson(text: string): boolean;
  importMidi(bytes: ArrayBuffer, title: string): Promise<boolean>;

  notify(message: string, kind?: ToastKind): void;
  dismissToast(): void;
  setPanel(panel: PanelKind): void;
  setEditTool(tool: EditTool): void;
  setWelcomeOpen(open: boolean): void;
  finishOnboarding(): void;

  setPreferences(patch: Partial<Preferences>): void;

  setPlaying(playing: boolean): void;
  setPlayhead(beat: number): void;

  setTitle(title: string): void;
  setBpm(bpm: number): void;
  setKey(key: number): void;
  setMeter(meter: [number, number]): void;
  setLoop(loop: LoopRegion): void;
  toggleLoop(): void;

  setActiveTrack(id: string): void;
  addTrack(instrumentId?: string): void;
  removeTrack(id: string): void;
  duplicateTrack(id: string): void;
  renameTrack(id: string, name: string): void;
  moveTrack(id: string, direction: -1 | 1): void;
  setTrackInstrument(id: string, instrumentId: string): void;
  setTrackColor(id: string, color: string): void;
  toggleTrackMute(id: string): void;
  toggleTrackSolo(id: string): void;
  setTrackVolume(id: string, volume: number): void;

  selectNotes(ids: string[], mode?: 'replace' | 'add' | 'toggle'): void;
  selectAllNotes(): void;
  clearSelection(): void;
  addNote(
    pad: number,
    startBeat: number,
    durationBeats: number,
    options?: { velocity?: number; history?: boolean; select?: boolean },
  ): string | null;
  deleteNotes(ids: string[], options?: { history?: boolean }): void;
  deleteSelectedNotes(): void;
  /** Copies the selection in place and selects the copies, for Alt-drag. */
  cloneSelectionInPlace(): void;
  nudgeSelection(deltaBeats: number, deltaPad: number): void;
  setSelectionVelocity(velocity: number): void;
  dragSelectedNotes(
    originals: Record<string, { startBeat: number; pad: number }>,
    deltaBeats: number,
    deltaPad: number,
  ): void;
  resizeNote(noteId: string, durationBeats: number): void;
  copySelection(): void;
  cutSelection(): void;
  /** Returns the beat just after the pasted notes, or null if nothing was pasted. */
  pasteClipboard(atBeat: number): number | null;
  duplicateSelection(): void;
  quantizeSelection(grid: number, preserveOriginal: boolean): void;
  restoreOriginalTiming(): void;

  beginGesture(): void;
  endGesture(): void;
  undo(): void;
  redo(): void;

  exportProjectJson(): string;
  activeTrack(): Track;
}

let toastCounter = 0;
let saveGeneration = 0;

function sanitizeName(value: string, fallback: string, max = 120): string {
  const trimmed = value.trim();
  return (trimmed || fallback).slice(0, max);
}

/** "Untitled Song", or "Untitled Song 2", 3… when My songs already has one. */
function freeUntitledName(taken: string[]): string {
  const used = new Set(taken);
  let name = 'Untitled Song';
  for (let number = 2; used.has(name); number++) name = `Untitled Song ${number}`;
  return name;
}

function findTrack(project: Project, id: string): Track | undefined {
  return project.tracks.find((track) => track.id === id);
}

function replaceTrack(project: Project, id: string, change: (track: Track) => Track): Project {
  return { ...project, tracks: project.tracks.map((track) => (track.id === id ? change(track) : track)) };
}

function roundBeat(beat: number): number {
  return Math.round(beat * 1000) / 1000;
}

/** Lowest change to `delta` that keeps the whole group on the instrument, preserving its shape. */
function clampPadDelta(pads: number[], delta: number, keyCount: number): number {
  return Math.min(keyCount - 1 - Math.max(...pads), Math.max(-Math.min(...pads), delta));
}

function makeNote(pad: number, start: number, duration: number, velocity = 0.85): Note {
  return createNote(pad, start, duration, velocity);
}

function markDirty(project: Project): Project {
  return { ...project, updatedAt: nowIso() };
}

/** State after undo or redo: stays on the same track and keeps whichever selected notes still exist. */
function restored(project: Project, state: { activeTrackId: string; selectedNoteIds: string[] }) {
  const active = findTrack(project, state.activeTrackId) ?? project.tracks[0];
  const present = new Set(active.notes.map((note) => note.id));
  return {
    project,
    activeTrackId: active.id,
    selectedNoteIds: state.selectedNoteIds.filter((id) => present.has(id)),
    saveState: 'unsaved' as const,
  };
}

const initialProject = createProject({ key: 0 });
const initialPreferences = loadPreferences();

export const useAppStore = create<AppState>()((set, get) => {
  /** Saves an edit. Unchanged tracks and notes keep their identity, so undo stays cheap. */
  const commit = (project: Project, extra: Partial<AppState> = {}, history = true) => {
    const state = get();
    set({
      project: markDirty(project),
      saveState: 'unsaved',
      history: history ? { past: [...state.history.past, state.project].slice(-80), future: [] } : state.history,
      ...extra,
    });
  };

  return {
  project: initialProject,
  activeTrackId: initialProject.tracks[0].id,
  selectedNoteIds: [],
  playhead: 0,
  isPlaying: false,
  editTool: 'draw',
  panel: null,
  welcomeOpen: true,
  preferences: initialPreferences,
  saveState: 'saved',
  lastSavedAt: null,
  saveError: null,
  history: { past: [], future: [] },
  gesture: null,
  clipboard: null,
  toast: null,
  library: [],
  libraryLoading: false,
  lastWarnings: [],
  songLoads: 0,

  initialize: async () => {
    await get().refreshLibrary();
    set({ welcomeOpen: !get().preferences.onboardingDone && get().library.length === 0 });
  },

  refreshLibrary: async () => {
    set({ libraryLoading: true });
    try {
      const library = await listLibrary();
      set({ library, libraryLoading: false });
    } catch {
      set({ libraryLoading: false });
    }
  },

  saveNow: async () => {
    const project = get().project;
    const generation = ++saveGeneration;
    set({ saveState: 'saving', saveError: null });
    try {
      await saveProjectToLibrary(project);
      if (generation === saveGeneration) {
        set({
          saveState: get().project === project ? 'saved' : 'unsaved',
          lastSavedAt: new Date().toISOString(),
          saveError: null,
        });
      }
    } catch (error) {
      if (generation === saveGeneration) {
        const message = error instanceof Error ? error.message : 'Could not save to browser storage.';
        set({ saveState: 'error', saveError: message });
        get().notify(message, 'error');
      }
    }
  },

  setProject: (loaded, options = {}) => {
    // The game's instruments have fixed notes, so every song stays on the C pad layout.
    const project = { ...loaded, key: 0 };
    const activeTrackId = project.tracks[0]?.id ?? '';
    set({
      project,
      activeTrackId,
      selectedNoteIds: [],
      playhead: 0,
      history: options.resetHistory === false ? get().history : { past: [], future: [] },
      saveState: 'saved',
      lastWarnings: [],
      gesture: null,
      welcomeOpen: false,
      songLoads: get().songLoads + 1,
    });
  },

  newProject: () => {
    get().setProject(createProject({ title: freeUntitledName(get().library.map((entry) => entry.title)), key: 0 }));
    set({ panel: null });
    get().notify('New song created.', 'success');
    // A blank song joins My songs with its first edit, so trying “New song” leaves no empty entries behind.
    void get().refreshLibrary();
  },

  openLibraryProject: async (id) => {
    try {
      const project = await loadProjectFromLibrary(id);
      if (!project) {
        get().notify('That project could not be found in this browser.', 'error');
        return false;
      }
      get().setProject(project);
      set({ panel: null });
      get().notify(`Opened “${project.title}”.`, 'success');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open the project.';
      get().notify(message, 'error');
      return false;
    }
  },

  deleteLibraryProject: async (id) => {
    try {
      await deleteProjectFromLibrary(id);
      await get().refreshLibrary();
      get().notify('Project deleted from this browser.', 'success');
    } catch {
      get().notify('Could not delete that project.', 'error');
    }
  },

  duplicateLibraryProject: async (id) => {
    try {
      const copy = await duplicateProjectInLibrary(id);
      await get().refreshLibrary();
      if (copy) get().notify(`Duplicated as “${copy.title}”.`, 'success');
    } catch {
      get().notify('Could not duplicate that project.', 'error');
    }
  },

  importMidi: async (bytes, title) => {
    try {
      const project = midiToProject(bytes, title);
      const dropped = trimToNoteLimit(project);
      // Re-importing a song replaces it rather than leaving a second copy.
      project.id = get().library.find((entry) => entry.title === title)?.id ?? project.id;
      get().setProject(project);
      set({ saveState: 'unsaved', panel: null });
      await get().saveNow();
      await get().refreshLibrary();
      const notes = project.tracks.reduce((sum, track) => sum + track.notes.length, 0);
      if (dropped > 0) get().notify(`Imported “${title}”, but left out the last ${dropped} notes to stay within the project limit.`, 'warning');
      else get().notify(`Imported “${title}”: ${notes} notes on ${project.tracks.length} tracks.`, 'success');
      return true;
    } catch (error) {
      get().notify(`MIDI import failed: ${error instanceof Error ? error.message : 'unreadable file'}`, 'error');
      return false;
    }
  },
  importProjectJson: (text) => {
    try {
      const { project, warnings } = parseProjectJson(text);
      get().setProject(project);
      set({ lastWarnings: warnings, panel: null });
      get().notify(`Imported “${project.title}” with ${project.tracks.length} tracks.`, 'success');
      void get().saveNow();
      return true;
    } catch (error) {
      if (error instanceof ProjectImportError) {
        const first = error.errors[0];
        get().notify(
          `${error.message}${first ? ` ${first.path}: ${first.message}` : ''}`,
          'error',
        );
      } else {
        get().notify(error instanceof Error ? error.message : 'Import failed.', 'error');
      }
      return false;
    }
  },


  notify: (message, kind = 'info') => {
    toastCounter += 1;
    set({ toast: { id: toastCounter, message, kind } });
  },
  dismissToast: () => set({ toast: null }),
  setPanel: (panel) => set({ panel }),
  setEditTool: (editTool) => set({ editTool }),
  setWelcomeOpen: (welcomeOpen) => set({ welcomeOpen }),
  finishOnboarding: () => {
    const preferences = { ...get().preferences, onboardingDone: true };
    savePreferences(preferences);
    set({ preferences, welcomeOpen: false });
  },

  setPreferences: (patch) => {
    const preferences = { ...get().preferences, ...patch };
    savePreferences(preferences);
    set({ preferences });
  },
  setPlaying: (isPlaying) => set({ isPlaying }),
  setPlayhead: (playhead) => set({ playhead: Math.max(0, playhead) }),

  setTitle: (title) => {
    const project = get().project;
    const next = sanitizeName(title, 'Untitled Song');
    if (next !== project.title) commit({ ...project, title: next });
  },
  setBpm: (bpm) => {
    if (!Number.isFinite(bpm)) return;
    const value = Math.round(Math.min(240, Math.max(40, bpm)));
    if (get().project.bpm !== value) commit({ ...get().project, bpm: value });
  },
  setKey: (key) => {
    if (!Number.isInteger(key) || key < 0 || key > 11 || get().project.key === key) return;
    commit({ ...get().project, key });
    get().notify('Key changed. Every track is remapped to the same scale degrees.', 'info');
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
    if (project.tracks.length >= 24) {
      get().notify('A project can hold up to 24 performers.', 'warning');
      return;
    }
    const id = instrumentId && hasInstrument(instrumentId) ? instrumentId : 'harp';
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
    if (project.tracks.length >= 24) {
      get().notify('A project can hold up to 24 performers.', 'warning');
      return;
    }
    const copy: Track = {
      ...source,
      id: createTrack(source.instrumentId, { colorIndex: project.tracks.length }).id,
      name: sanitizeName(`${source.name} (copy)`, 'Copy', 60),
      notes: source.notes.map((note) => ({ ...note, id: createNote(note.pad, 0, 0.5).id })),
    };
    const tracks = [...project.tracks];
    tracks.splice(tracks.indexOf(source) + 1, 0, copy);
    commit({ ...project, tracks }, { activeTrackId: copy.id, selectedNoteIds: [] });
  },
  renameTrack: (id, name) => {
    const project = get().project;
    const track = findTrack(project, id);
    if (!track) return;
    const next = sanitizeName(name, track.name, 60);
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
        `${instrument.displayName} has ${instrument.keyCount} pads. Removed ${removed} note${removed === 1 ? '' : 's'} outside its grid — undo is available.`,
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
    const value = Math.min(1.5, Math.max(0, volume));
    // A drag is one undo step (its gesture records it); a key press is a step of its own.
    commit(replaceTrack(get().project, id, (track) => ({ ...track, volume: value })), {}, get().gesture === null);
  },

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
    const note = makeNote(pad, Math.max(0, startBeat), Math.max(0.05, durationBeats), options.velocity ?? 0.85);
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
      .map((note) => makeNote(note.pad, note.startBeat, note.durationBeats, note.velocity));
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
    const value = Math.min(1, Math.max(0.05, velocity));
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
    const next = Math.min(instrument.maxHoldBeats, Math.max(0.1, roundBeat(durationBeats)));
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
    state.notify(`Copied ${selected.length} note${selected.length === 1 ? '' : 's'}.`, 'info');
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
    const created = kept.map((note) => makeNote(note.pad, base + note.offsetBeat, note.durationBeats, note.velocity));
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
      makeNote(note.pad, note.startBeat + offset, note.durationBeats, note.velocity),
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
      `Quantized ${count} note${count === 1 ? '' : 's'}${preserveOriginal ? ' · original timing preserved' : ''}.`,
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
    state.notify(`Restored original timing on ${restored} note${restored === 1 ? '' : 's'}.`, 'success');
  },

  beginGesture: () => {
    set({ gesture: { project: get().project } });
  },
  endGesture: () => {
    const gesture = get().gesture;
    if (!gesture) return;
    if (gesture.project !== get().project) {
      set({ history: { past: [...get().history.past, gesture.project].slice(-80), future: [] }, gesture: null });
    } else {
      set({ gesture: null });
    }
  },
  undo: () => {
    const { history, gesture } = get();
    if (gesture || history.past.length === 0) return;
    const past = [...history.past];
    const project = past.pop()!;
    set({
      ...restored(project, get()),
      history: { past, future: [get().project, ...history.future].slice(0, 80) },
    });
  },
  redo: () => {
    const { history, gesture } = get();
    if (gesture || history.future.length === 0) return;
    const future = [...history.future];
    const project = future.shift()!;
    set({
      ...restored(project, get()),
      history: { past: [...history.past, get().project].slice(-80), future },
    });
  },

  exportProjectJson: () => JSON.stringify(get().project, null, 2),

  activeTrack: () => {
    const state = get();
    return findTrack(state.project, state.activeTrackId) ?? state.project.tracks[0];
  },
  };
});
