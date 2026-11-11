import { create } from 'zustand';
import { createProject } from '../music/project';
import { loadPreferences, savePreferences } from '../storage/preferences';
import { findTrack } from './storeHelpers';
import { createCommit, historyActions } from './storeHistory';
import { libraryActions } from './storeLibrary';
import { noteActions } from './storeNotes';
import { songActions } from './storeSong';
import type { AppState, StoreTools } from './storeTypes';

export type { PanelKind, SaveState } from './storeTypes';

let toastCounter = 0;

const initialProject = createProject({ key: 0 });
const initialPreferences = loadPreferences();

/**
 * The editor's one store. Its actions live with their concern (the song library, the song
 * and its tracks, notes, undo history) and are put together here with the interface state.
 */
export const useAppStore = create<AppState>()((set, get) => {
  const tools: StoreTools = { set, get, commit: createCommit({ set, get }) };

  return {
    project: initialProject,
    activeTrackId: initialProject.tracks[0].id,
    selectedNoteIds: [],
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
    songLoads: 0,

    ...libraryActions(tools),
    ...songActions(tools),
    ...noteActions(tools),
    ...historyActions(tools),

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

    exportProjectJson: () => JSON.stringify(get().project, null, 2),

    activeTrack: () => {
      const state = get();
      return findTrack(state.project, state.activeTrackId) ?? state.project.tracks[0];
    },
  };
});
