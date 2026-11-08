import { readFileAsText } from '../export/exporters';
import { useAppStore } from './store';

/** For file pickers: MIDI files and saved songs. */
export const SONG_FILE_ACCEPT = '.mid,.midi,.kar,audio/midi,audio/x-midi,.json,application/json';

const MIDI_NAME = /\.(mid|midi|kar)$/i;
const SONG_NAME = /\.json$/i;

/** True for files the app can open as a song: MIDI or a `.skymusic.json` project. */
export function isSongFile(file: File): boolean {
  return MIDI_NAME.test(file.name) || SONG_NAME.test(file.name) || file.type === 'audio/midi' || file.type === 'audio/x-midi';
}

async function looksLikeMidi(file: File): Promise<boolean> {
  if (MIDI_NAME.test(file.name) || file.type === 'audio/midi' || file.type === 'audio/x-midi') return true;
  // A MIDI file saved without its extension still starts with "MThd".
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return String.fromCharCode(...head) === 'MThd';
}

/** Opens a MIDI or project file as the current song. Returns whether it loaded. */
export async function importSongFile(file: File): Promise<boolean> {
  const state = useAppStore.getState();
  try {
    if (await looksLikeMidi(file)) {
      return await state.importMidi(await file.arrayBuffer(), file.name.replace(MIDI_NAME, ''));
    }
    if (!SONG_NAME.test(file.name) && file.type !== 'application/json') {
      state.notify(`“${file.name}” is not a song file. Drop a MIDI file (.mid) or a .skymusic.json project.`, 'warning');
      return false;
    }
    return state.importProjectJson(await readFileAsText(file));
  } catch (error) {
    state.notify(error instanceof Error ? error.message : 'Could not read that file.', 'error');
    return false;
  }
}
