import type { LoopRegion, Project, Track } from '../music/types';
import type { LibraryEntry } from '../storage/library';
import type { Preferences } from '../storage/preferences';

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';
export type EditTool = 'select' | 'draw';
export type PanelKind = 'catalog' | 'library' | 'songs' | 'sheet' | 'about' | 'help' | 'settings' | 'export' | 'tracks' | null;
export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
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

export interface Clipboard {
  instrumentId: string;
  notes: ClipboardNote[];
}

export interface AppState {
  project: Project;
  activeTrackId: string;
  selectedNoteIds: string[];
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

  setTitle(title: string): void;
  setBpm(bpm: number): void;
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

export interface StoreTools {
  set: (partial: Partial<AppState>) => void;
  get: () => AppState;
  /** Applies an edit to the project, marks it unsaved and, unless told not to, records an undo step. */
  commit: (project: Project, extra?: Partial<AppState>, history?: boolean) => void;
}
