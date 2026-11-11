import { nowIso } from '../music/project';
import type { Project } from '../music/types';
import { findTrack } from './storeHelpers';
import type { AppState, StoreTools } from './storeTypes';

const HISTORY_LIMIT = 80;

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

/** Saves an edit. Unchanged tracks and notes keep their identity, so undo stays cheap. */
export function createCommit({ set, get }: Pick<StoreTools, 'set' | 'get'>): StoreTools['commit'] {
  return (project, extra = {}, history = true) => {
    const state = get();
    set({
      project: markDirty(project),
      saveState: 'unsaved',
      history: history ? { past: [...state.history.past, state.project].slice(-HISTORY_LIMIT), future: [] } : state.history,
      ...extra,
    });
  };
}

type HistoryActions = Pick<
  AppState,
  'beginGesture' | 'endGesture' | 'undo' | 'redo'
>;

/** Undo and redo, and the gestures that fold a whole drag into one undo step. */
export function historyActions({ set, get }: Pick<StoreTools, 'set' | 'get'>): HistoryActions {
  return {
    beginGesture: () => {
      set({ gesture: { project: get().project } });
    },
    endGesture: () => {
      const gesture = get().gesture;
      if (!gesture) return;
      if (gesture.project !== get().project) {
        set({ history: { past: [...get().history.past, gesture.project].slice(-HISTORY_LIMIT), future: [] }, gesture: null });
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
        history: { past, future: [get().project, ...history.future].slice(0, HISTORY_LIMIT) },
      });
    },
    redo: () => {
      const { history, gesture } = get();
      if (gesture || history.future.length === 0) return;
      const future = [...history.future];
      const project = future.shift()!;
      set({
        ...restored(project, get()),
        history: { past: [...history.past, get().project].slice(-HISTORY_LIMIT), future },
      });
    },
  };
}
