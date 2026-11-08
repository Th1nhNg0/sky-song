import type { ChangeEvent } from 'react';
import { importSongFile } from '../state/importFile';
import { useAppStore } from '../state/store';
import { DownloadIcon, LibraryIcon, UploadIcon } from './Icons';

/** The song-level actions used most often, kept one click away in the top bar. */
export function QuickActions() {
  const setPanel = useAppStore((state) => state.setPanel);

  const importMidiFile = async (event: ChangeEvent<HTMLInputElement>) => {
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
        onClick={() => setPanel('library')}
        aria-label="My songs"
        title="My songs"
      >
        <LibraryIcon size={17} />
        <span>My songs</span>
      </button>
      <label className="quick-action" title="Import a MIDI file (or drop one on the window)">
        <UploadIcon size={17} />
        <span>Import MIDI</span>
        <input
          type="file"
          accept=".mid,.midi,audio/midi"
          aria-label="Import MIDI"
          hidden
          onChange={(event) => void importMidiFile(event)}
        />
      </label>
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
