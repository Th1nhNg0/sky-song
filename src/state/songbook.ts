import { useAppStore } from './store';

/** One ready-made song, as listed in `public/songs/catalog.json`. */
export interface SongbookEntry {
  id: string;
  title: string;
  /** The performer, or the songwriter where a song has had many singers. */
  artist: string;
  year?: number;
  file: string;
  bpm: number;
  seconds: number;
  notes: number;
  instruments: string[];
  /** How busy the song is from start to end, each step 0–1. */
  shape: number[];
}

const SONGS_URL = `${import.meta.env.BASE_URL}songs/`;

let catalog: Promise<SongbookEntry[]> | null = null;

/** The list of ready-made songs. Fetched once; a failed fetch is retried on the next call. */
export function loadSongbook(): Promise<SongbookEntry[]> {
  catalog ??= fetch(`${SONGS_URL}catalog.json`)
    .then((response) => {
      if (!response.ok) throw new Error(`The song list could not be loaded (${response.status}).`);
      return response.json() as Promise<SongbookEntry[]>;
    })
    .catch((error: unknown) => {
      catalog = null;
      throw error;
    });
  return catalog;
}

/**
 * Opens a ready-made song. A song opened before lives in My songs with the user's edits,
 * so that copy is reopened unless `fresh` asks for the original again.
 */
export async function openSongbookSong(entry: SongbookEntry, options: { fresh?: boolean } = {}): Promise<boolean> {
  const state = useAppStore.getState();
  if (!options.fresh && state.library.some((saved) => saved.id === entry.id)) {
    return state.openLibraryProject(entry.id);
  }
  try {
    const response = await fetch(`${SONGS_URL}${entry.file}`);
    if (!response.ok) throw new Error(`“${entry.title}” could not be downloaded (${response.status}).`);
    return state.importProjectJson(await response.text());
  } catch (error) {
    state.notify(error instanceof Error ? error.message : `“${entry.title}” could not be downloaded.`, 'error');
    return false;
  }
}

export function formatSongLength(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
