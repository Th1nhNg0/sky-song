import { create } from 'zustand';
import { createDemoProject, createStarterProject } from '../music/demo';
import { getInstrument, hasInstrument } from '../music/instruments';
import { createNote, createProject, createTrack, nowIso, TRACK_COLORS } from '../music/project';
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
import { midiToProject } from '../music/midiImport';
import { loadPreferences, savePreferences, type Preferences } from '../storage/preferences';

type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';
type EditTool = 'select' | 'draw';
export type PanelKind = 'catalog' | 'library' | 'help' | 'settings' | 'export' | 'tracks' | null;
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
  gesture: { project: Project; changed: boolean } | null;
  clipboard: Clipboard | null;
  toast: Toast | null;
  library: LibraryEntry[];
  libraryLoading: boolean;
  lastWarnings: ValidationIssue[];

  initialize(): Promise<void>;
  refreshLibrary(): Promise<void>;
  saveNow(): Promise<void>;
  setProject(project: Project, options?: { resetHistory?: boolean }): void;
  newProject(options?: { starter?: boolean; demo?: boolean }): void;
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
  dragSelectedNotes(
    originals: Record<string, { startBeat: number; pad: number }>,
    deltaBeats: number,
    deltaPad: number,
  ): void;
  resizeNote(noteId: string, durationBeats: number): void;
  setNoteVelocity(noteId: string, velocity: number): void;
  copySelection(): void;
  cutSelection(): void;
  pasteClipboard(atBeat: number): void;
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

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sanitizeName(value: string, fallback: string, max = 120): string {
  const trimmed = value.trim();
  return (trimmed || fallback).slice(0, max);
}

function findTrack(project: Project, id: string): Track | undefined {
  return project.tracks.find((track) => track.id === id);
}

function makeNote(pad: number, start: number, duration: number, velocity = 0.85): Note {
  return createNote(pad, start, duration, velocity);
}

function markDirty(project: Project): Project {
  return { ...project, updatedAt: nowIso() };
}

const initialProject = createProject({ key: 0 });
const initialPreferences = loadPreferences();

export const useAppStore = create<AppState>()((set, get) => ({
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
    });
  },

  newProject: (options = {}) => {
    let project: Project;
    if (options.demo) project = createDemoProject();
    else if (options.starter) project = createStarterProject();
    else project = createProject({ title: 'Untitled Song', key: 0 });
    get().setProject(project);
    set({ panel: null });
    get().notify(options.demo ? 'Loaded the demo piece “Lanterns Over the Valley”.' : 'New song created.', 'success');
    void get().saveNow();
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
      // Re-importing a song replaces it rather than leaving a second copy.
      project.id = get().library.find((entry) => entry.title === title)?.id ?? project.id;
      get().setProject(project);
      set({ saveState: 'unsaved', panel: null });
      await get().saveNow();
      await get().refreshLibrary();
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
    const project = clone(get().project);
    const next = sanitizeName(title, 'Untitled Song');
    if (next === project.title) return;
    project.title = next;
    set({
      project: markDirty(project),
      saveState: 'unsaved',
      history: { past: [...get().history.past, get().project].slice(-80), future: [] },
    });
  },
  setBpm: (bpm) => {
    if (!Number.isFinite(bpm)) return;
    const value = Math.round(Math.min(240, Math.max(40, bpm)));
    const project = clone(get().project);
    if (project.bpm === value) return;
    project.bpm = value;
    set({
      project: markDirty(project),
      saveState: 'unsaved',
      history: { past: [...get().history.past, get().project].slice(-80), future: [] },
    });
  },
  setKey: (key) => {
    if (!Number.isInteger(key) || key < 0 || key > 11) return;
    const project = clone(get().project);
    if (project.key === key) return;
    project.key = key;
    set({
      project: markDirty(project),
      saveState: 'unsaved',
      history: { past: [...get().history.past, get().project].slice(-80), future: [] },
    });
    get().notify('Key changed. Every track is remapped to the same scale degrees.', 'info');
  },
  setMeter: (meter) => {
    const project = clone(get().project);
    if (project.timeSignature[0] === meter[0] && project.timeSignature[1] === meter[1]) return;
    project.timeSignature = [meter[0], meter[1]];
    set({
      project: markDirty(project),
      saveState: 'unsaved',
      history: { past: [...get().history.past, get().project].slice(-80), future: [] },
    });
  },
  setLoop: (loop) => {
    const project = clone(get().project);
    project.loop = {
      enabled: loop.enabled,
      startBeat: Math.max(0, Math.min(loop.startBeat, loop.endBeat - 0.25)),
      endBeat: Math.max(loop.startBeat + 0.25, loop.endBeat),
    };
    set({
      project: markDirty(project),
      saveState: 'unsaved',
      history: { past: [...get().history.past, get().project].slice(-80), future: [] },
    });
  },
  toggleLoop: () => {
    const loop = get().project.loop;
    get().setLoop({ ...loop, enabled: !loop.enabled });
  },

  setActiveTrack: (id) => {
    if (!findTrack(get().project, id)) return;
    set({ activeTrackId: id, selectedNoteIds: [] });
  },
  addTrack: (instrumentId) => {
    const project = clone(get().project);
    if (project.tracks.length >= 24) {
      get().notify('A project can hold up to 24 performers.', 'warning');
      return;
    }
    const id = instrumentId && hasInstrument(instrumentId) ? instrumentId : 'harp';
    const track = createTrack(id, { colorIndex: project.tracks.length % TRACK_COLORS.length });
    if (!instrumentId) track.name = `${getInstrument(id).shortName} · Performer ${project.tracks.length + 1}`;
    project.tracks.push(track);
    set({
      project: markDirty(project),
      activeTrackId: track.id,
      selectedNoteIds: [],
      saveState: 'unsaved',
      history: { past: [...get().history.past, get().project].slice(-80), future: [] },
    });
  },
  removeTrack: (id) => {
    const project = clone(get().project);
    if (project.tracks.length <= 1) {
      get().notify('A project needs at least one performer track.', 'warning');
      return;
    }
    const index = project.tracks.findIndex((track) => track.id === id);
    if (index === -1) return;
    project.tracks.splice(index, 1);
    const activeTrackId = get().activeTrackId === id ? project.tracks[Math.max(0, index - 1)].id : get().activeTrackId;
    set({
      project: markDirty(project),
      activeTrackId,
      selectedNoteIds: [],
      saveState: 'unsaved',
      history: { past: [...get().history.past, get().project].slice(-80), future: [] },
    });
  },
  duplicateTrack: (id) => {
    const project = clone(get().project);
    const source = findTrack(project, id);
    if (!source) return;
    if (project.tracks.length >= 24) {
      get().notify('A project can hold up to 24 performers.', 'warning');
      return;
    }
    const copyTrack = clone(source);
    copyTrack.id = createTrack(source.instrumentId, { colorIndex: project.tracks.length }).id;
    copyTrack.name = sanitizeName(`${source.name} (copy)`, 'Copy', 60);
    copyTrack.notes = copyTrack.notes.map((note) => ({ ...note, id: createNote(note.pad, 0, 0.5).id }));
    project.tracks.splice(project.tracks.findIndex((track) => track.id === id) + 1, 0, copyTrack);
    set({
      project: markDirty(project),
      activeTrackId: copyTrack.id,
      selectedNoteIds: [],
      saveState: 'unsaved',
      history: { past: [...get().history.past, get().project].slice(-80), future: [] },
    });
  },
  renameTrack: (id, name) => {
    const project = clone(get().project);
    const track = findTrack(project, id);
    if (!track) return;
    const next = sanitizeName(name, track.name, 60);
    if (next === track.name) return;
    track.name = next;
    set({
      project: markDirty(project),
      saveState: 'unsaved',
      history: { past: [...get().history.past, get().project].slice(-80), future: [] },
    });
  },
  moveTrack: (id, direction) => {
    const project = clone(get().project);
    const index = project.tracks.findIndex((track) => track.id === id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= project.tracks.length) return;
    const [track] = project.tracks.splice(index, 1);
    project.tracks.splice(target, 0, track);
    set({
      project: markDirty(project),
      saveState: 'unsaved',
      history: { past: [...get().history.past, get().project].slice(-80), future: [] },
    });
  },
  setTrackInstrument: (id, instrumentId) => {
    if (!hasInstrument(instrumentId)) return;
    const instrument = getInstrument(instrumentId);
    if (!instrument.selectable) {
      get().notify(`${instrument.displayName} is not a selectable track instrument.`, 'warning');
      return;
    }
    const project = clone(get().project);
    const track = findTrack(project, id);
    if (!track || track.instrumentId === instrumentId) return;
    const before = track.notes.length;
    track.notes = track.notes.filter((note) => note.pad < instrument.keyCount);
    const removed = before - track.notes.length;
    track.instrumentId = instrumentId;
    const selected = get().selectedNoteIds.filter((noteId) => track.notes.some((note) => note.id === noteId));
    set({
      project: markDirty(project),
      selectedNoteIds: selected,
      saveState: 'unsaved',
      history: { past: [...get().history.past, get().project].slice(-80), future: [] },
    });
    if (removed > 0) {
      get().notify(
        `${instrument.displayName} has ${instrument.keyCount} pads. Removed ${removed} note${removed === 1 ? '' : 's'} outside its grid — undo is available.`,
        'warning',
      );
    }
  },
  setTrackColor: (id, color) => {
    const project = clone(get().project);
    const track = findTrack(project, id);
    if (!track || track.color === color) return;
    track.color = color;
    set({
      project: markDirty(project),
      saveState: 'unsaved',
      history: { past: [...get().history.past, get().project].slice(-80), future: [] },
    });
  },
  toggleTrackMute: (id) => {
    const project = clone(get().project);
    const track = findTrack(project, id);
    if (!track) return;
    track.muted = !track.muted;
    set({
      project: markDirty(project),
      saveState: 'unsaved',
      history: { past: [...get().history.past, get().project].slice(-80), future: [] },
    });
  },
  toggleTrackSolo: (id) => {
    const project = clone(get().project);
    const track = findTrack(project, id);
    if (!track) return;
    track.solo = !track.solo;
    set({
      project: markDirty(project),
      saveState: 'unsaved',
      history: { past: [...get().history.past, get().project].slice(-80), future: [] },
    });
  },
  setTrackVolume: (id, volume) => {
    const project = clone(get().project);
    const track = findTrack(project, id);
    if (!track) return;
    track.volume = Math.min(1.5, Math.max(0, volume));
    set({ project: markDirty(project), saveState: 'unsaved' });
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
    const state = get();
    const track = state.activeTrack();
    set({ selectedNoteIds: track.notes.map((note) => note.id) });
  },
  clearSelection: () => set({ selectedNoteIds: [] }),

  addNote: (pad, startBeat, durationBeats, options = {}) => {
    const state = get();
    const project = clone(state.project);
    const track = findTrack(project, state.activeTrackId);
    if (!track) return null;
    const instrument = getInstrument(track.instrumentId);
    if (!Number.isInteger(pad) || pad < 0 || pad >= instrument.keyCount) {
      state.notify(`Pad ${pad + 1} is outside ${instrument.displayName}'s ${instrument.keyCount}-pad grid.`, 'warning');
      return null;
    }
    const note = makeNote(
      pad,
      Math.max(0, startBeat),
      Math.max(0.05, durationBeats),
      options.velocity ?? 0.85,
    );
    track.notes.push(note);
    track.notes.sort((a, b) => a.startBeat - b.startBeat || a.pad - b.pad);
    set({
      project: markDirty(project),
      selectedNoteIds: options.select === false ? state.selectedNoteIds : [note.id],
      saveState: 'unsaved',
      history:
        options.history === false
          ? state.history
          : { past: [...state.history.past, state.project].slice(-80), future: [] },
    });
    return note.id;
  },
  deleteNotes: (ids, options = {}) => {
    const state = get();
    if (ids.length === 0) return;
    const project = clone(state.project);
    const track = findTrack(project, state.activeTrackId);
    if (!track) return;
    const setIds = new Set(ids);
    const before = track.notes.length;
    track.notes = track.notes.filter((note) => !setIds.has(note.id));
    if (track.notes.length === before) return;
    set({
      project: markDirty(project),
      selectedNoteIds: state.selectedNoteIds.filter((id) => !setIds.has(id)),
      saveState: 'unsaved',
      history:
        options.history === false
          ? state.history
          : { past: [...state.history.past, state.project].slice(-80), future: [] },
    });
  },
  deleteSelectedNotes: () => get().deleteNotes(get().selectedNoteIds),

  dragSelectedNotes: (originals, deltaBeats, deltaPad) => {
    const state = get();
    const project = clone(state.project);
    const track = findTrack(project, state.activeTrackId);
    if (!track) return;
    const instrument = getInstrument(track.instrumentId);
    const minStart = Math.min(...Object.values(originals).map((entry) => entry.startBeat));
    const beatDelta = Math.max(deltaBeats, -minStart);
    for (const note of track.notes) {
      const original = originals[note.id];
      if (!original) continue;
      note.startBeat = Math.max(0, Math.round((original.startBeat + beatDelta) * 1000) / 1000);
      note.pad = Math.min(instrument.keyCount - 1, Math.max(0, original.pad + deltaPad));
    }
    track.notes.sort((a, b) => a.startBeat - b.startBeat || a.pad - b.pad);
    set({ project: markDirty(project), saveState: 'unsaved' });
  },
  resizeNote: (noteId, durationBeats) => {
    const state = get();
    const project = clone(state.project);
    const track = findTrack(project, state.activeTrackId);
    if (!track) return;
    const instrument = getInstrument(track.instrumentId);
    if (!instrument.supportsHold) return;
    const note = track.notes.find((item) => item.id === noteId);
    if (!note) return;
    note.durationBeats = Math.min(instrument.maxHoldBeats, Math.max(0.1, Math.round(durationBeats * 1000) / 1000));
    set({ project: markDirty(project), saveState: 'unsaved' });
  },
  setNoteVelocity: (noteId, velocity) => {
    const state = get();
    const project = clone(state.project);
    const track = findTrack(project, state.activeTrackId);
    const note = track?.notes.find((item) => item.id === noteId);
    if (!note) return;
    note.velocity = Math.min(1, Math.max(0.05, velocity));
    set({ project: markDirty(project), saveState: 'unsaved' });
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
      notes: selected
        .slice()
        .sort((a, b) => a.startBeat - b.startBeat)
        .map((note) => ({
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
      return;
    }
    const project = clone(state.project);
    const track = findTrack(project, state.activeTrackId);
    if (!track) return;
    const instrument = getInstrument(track.instrumentId);
    const kept = clipboard.notes.filter((note) => note.pad < instrument.keyCount);
    if (kept.length === 0) {
      state.notify(`${instrument.displayName} cannot play the copied pads.`, 'warning');
      return;
    }
    const base = Math.max(0, atBeat);
    const newIds: string[] = [];
    for (const note of kept) {
      const created = makeNote(note.pad, base + note.offsetBeat, note.durationBeats, note.velocity);
      track.notes.push(created);
      newIds.push(created.id);
    }
    track.notes.sort((a, b) => a.startBeat - b.startBeat || a.pad - b.pad);
    set({
      project: markDirty(project),
      selectedNoteIds: newIds,
      saveState: 'unsaved',
      history: { past: [...state.history.past, state.project].slice(-80), future: [] },
    });
    if (kept.length < clipboard.notes.length) {
      state.notify(
        `Pasted ${kept.length} of ${clipboard.notes.length} notes; ${instrument.displayName} has only ${instrument.keyCount} pads.`,
        'warning',
      );
    }
  },
  duplicateSelection: () => {
    const state = get();
    const track = state.activeTrack();
    const selected = track.notes.filter((note) => state.selectedNoteIds.includes(note.id));
    if (selected.length === 0) {
      state.notify('Select notes to duplicate.', 'info');
      return;
    }
    const offset = Math.max(1, state.preferences.snap || 0.5);
    const project = clone(state.project);
    const target = findTrack(project, state.activeTrackId);
    if (!target) return;
    const ids: string[] = [];
    for (const note of selected) {
      const created = makeNote(
        note.pad,
        note.startBeat + offset,
        note.durationBeats,
        note.velocity,
      );
      target.notes.push(created);
      ids.push(created.id);
    }
    target.notes.sort((a, b) => a.startBeat - b.startBeat || a.pad - b.pad);
    set({
      project: markDirty(project),
      selectedNoteIds: ids,
      saveState: 'unsaved',
      history: { past: [...state.history.past, state.project].slice(-80), future: [] },
    });
  },
  quantizeSelection: (grid, preserveOriginal) => {
    const state = get();
    const project = clone(state.project);
    const track = findTrack(project, state.activeTrackId);
    if (!track) return;
    const selected = new Set(state.selectedNoteIds);
    const notes = selected.size > 0 ? track.notes.filter((note) => selected.has(note.id)) : track.notes;
    if (notes.length === 0 || grid <= 0) return;
    for (const note of notes) {
      if (preserveOriginal && !note.original) {
        note.original = { startBeat: note.startBeat, durationBeats: note.durationBeats };
      }
      note.startBeat = Math.round(snapBeat(note.startBeat, grid) * 1000) / 1000;
      note.durationBeats = Math.max(grid, Math.round(note.durationBeats / grid) * grid);
    }
    track.notes.sort((a, b) => a.startBeat - b.startBeat || a.pad - b.pad);
    set({
      project: markDirty(project),
      saveState: 'unsaved',
      history: { past: [...state.history.past, state.project].slice(-80), future: [] },
    });
    state.notify(
      `Quantized ${notes.length} note${notes.length === 1 ? '' : 's'}${preserveOriginal ? ' · original timing preserved' : ''}.`,
      'success',
    );
  },
  restoreOriginalTiming: () => {
    const state = get();
    const project = clone(state.project);
    const track = findTrack(project, state.activeTrackId);
    if (!track) return;
    const selected = new Set(state.selectedNoteIds);
    const notes = selected.size > 0 ? track.notes.filter((note) => selected.has(note.id)) : track.notes;
    let restored = 0;
    for (const note of notes) {
      if (!note.original) continue;
      note.startBeat = note.original.startBeat;
      note.durationBeats = note.original.durationBeats;
      delete note.original;
      restored++;
    }
    if (restored === 0) {
      state.notify('No preserved original timing on these notes.', 'info');
      return;
    }
    track.notes.sort((a, b) => a.startBeat - b.startBeat || a.pad - b.pad);
    set({
      project: markDirty(project),
      saveState: 'unsaved',
      history: { past: [...state.history.past, state.project].slice(-80), future: [] },
    });
    state.notify(`Restored original timing on ${restored} note${restored === 1 ? '' : 's'}.`, 'success');
  },

  beginGesture: () => {
    set({ gesture: { project: clone(get().project), changed: false } });
  },
  endGesture: () => {
    const gesture = get().gesture;
    if (!gesture) return;
    if (JSON.stringify(gesture.project) !== JSON.stringify(get().project)) {
      set({
        history: { past: [...get().history.past, gesture.project].slice(-80), future: [] },
        gesture: null,
      });
    } else {
      set({ gesture: null });
    }
  },
  undo: () => {
    const { history } = get();
    if (history.past.length === 0) return;
    const past = [...history.past];
    const project = past.pop()!;
    const activeTrackId = findTrack(project, get().activeTrackId) ? get().activeTrackId : project.tracks[0].id;
    set({
      project,
      history: { past, future: [get().project, ...history.future].slice(0, 80) },
      activeTrackId,
      selectedNoteIds: [],
      saveState: 'unsaved',
    });
  },
  redo: () => {
    const { history } = get();
    if (history.future.length === 0) return;
    const future = [...history.future];
    const project = future.shift()!;
    const activeTrackId = findTrack(project, get().activeTrackId) ? get().activeTrackId : project.tracks[0].id;
    set({
      project,
      history: { past: [...history.past, get().project].slice(-80), future },
      activeTrackId,
      selectedNoteIds: [],
      saveState: 'unsaved',
    });
  },

  exportProjectJson: () => JSON.stringify(get().project, null, 2),

  activeTrack: () => {
    const state = get();
    return findTrack(state.project, state.activeTrackId) ?? state.project.tracks[0];
  },
}));
