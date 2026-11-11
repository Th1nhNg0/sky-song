import { midiToProject, trimToNoteLimit } from '../music/midiImport';
import { createProject, DEFAULT_TITLE } from '../music/project';
import { parseProjectJson, ProjectImportError } from '../music/validation';
import {
  deleteProjectFromLibrary,
  duplicateProjectInLibrary,
  listLibrary,
  loadProjectFromLibrary,
  saveProjectToLibrary,
} from '../storage/library';
import type { AppState, StoreTools } from './storeTypes';

let saveGeneration = 0;

/** "Untitled Song", or "Untitled Song 2", 3… when My songs already has one. */
function freeUntitledName(taken: string[]): string {
  const used = new Set(taken);
  let name = DEFAULT_TITLE;
  for (let number = 2; used.has(name); number++) name = `${DEFAULT_TITLE} ${number}`;
  return name;
}

type LibraryActions = Pick<
  AppState,
  'initialize' | 'refreshLibrary' | 'saveNow' | 'setProject' | 'newProject' | 'openLibraryProject'
  | 'deleteLibraryProject' | 'duplicateLibraryProject' | 'importMidi' | 'importProjectJson'
>;

/** Opening, saving and importing whole songs, and the list of songs kept in this browser. */
export function libraryActions({ set, get }: StoreTools): LibraryActions {
  return {
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
        history: options.resetHistory === false ? get().history : { past: [], future: [] },
        saveState: 'saved',
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
        const { project } = parseProjectJson(text);
        get().setProject(project);
        set({ panel: null });
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
  };
}
