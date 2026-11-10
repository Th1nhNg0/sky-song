import type { ChangeEvent } from 'react';
import { importSongFile, SONG_FILE_ACCEPT } from '../state/importFile';
import { useAppStore } from '../state/store';
import { DownloadIcon, LibraryIcon, SheetIcon, StarIcon, UploadIcon } from './Icons';

/** The song-level actions used most often, kept one click away in the top bar. */
export function QuickActions() {
  const setPanel = useAppStore((state) => state.setPanel);

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await importSongFile(file);
  };

  return (
    <div className="quick-actions">
      <button
        type="button"
        className="quick-action"
        onClick={() => setPanel('songs')}
        aria-label="Song library"
        title="Song library: ready-made songs to play or edit"
      >
        <StarIcon size={17} />
        <span>Songs</span>
      </button>
      <button
        type="button"
        className="quick-action"
        onClick={() => setPanel('library')}
        aria-label="My songs"
        title="My songs"
      >
        <LibraryIcon size={17} />
        <span>My songs</span>
      </button>
      <label className="quick-action" title="Open a MIDI file or a saved song (.skymusic.json). You can also drop a file on the window.">
        <UploadIcon size={17} />
        <span>Import</span>
        <input
          type="file"
          accept={SONG_FILE_ACCEPT}
          aria-label="Import song or MIDI"
          hidden
          onChange={(event) => void importFile(event)}
        />
      </label>
      <button
        type="button"
        className="quick-action"
        onClick={() => setPanel('sheet')}
        aria-label="Sheet"
        title="Sheet: read, practise, print or share the song as key frames"
      >
        <SheetIcon size={17} />
        <span>Sheet</span>
      </button>
      <button
        type="button"
        className="quick-action"
        onClick={() => setPanel('export')}
        aria-label="Export"
        title="Export"
      >
        <DownloadIcon size={17} />
        <span>Export</span>
      </button>
    </div>
  );
}
