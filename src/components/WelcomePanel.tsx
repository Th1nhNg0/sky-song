import type { ChangeEvent } from 'react';
import { importSongFile, SONG_FILE_ACCEPT } from '../state/importFile';
import { useAppStore } from '../state/store';
import { CloseIcon, LibraryIcon, MusicIcon, PlayIcon, SparkIcon, UploadIcon } from './Icons';

export function WelcomePanel() {
  const newProject = useAppStore((state) => state.newProject);
  const finishOnboarding = useAppStore((state) => state.finishOnboarding);
  const setWelcomeOpen = useAppStore((state) => state.setWelcomeOpen);
  const setPanel = useAppStore((state) => state.setPanel);
  const library = useAppStore((state) => state.library);

  const dismiss = () => {
    finishOnboarding();
    setWelcomeOpen(false);
  };

  const openFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file && (await importSongFile(file))) finishOnboarding();
  };

  const start = (options?: { demo?: boolean; starter?: boolean }) => {
    newProject(options);
    finishOnboarding();
  };

  return (
    <div className="welcome-backdrop" role="dialog" aria-modal="true" aria-label="Welcome to Sky Music Studio">
      <div className="welcome-panel">
        <button type="button" className="modal-close welcome-close" onClick={dismiss} aria-label="Close welcome">
          <CloseIcon size={18} />
        </button>

        <div className="welcome-orbit" aria-hidden="true">
          <span className="orbit orbit-1" />
          <span className="orbit orbit-2" />
          <SparkIcon size={32} />
        </div>
        <p className="welcome-kicker">Sky Music Studio</p>
        <h1>Make a little song for the sky.</h1>
        <p className="welcome-lede">Pick an instrument, tap the grid, and press play.</p>

        <div className="welcome-start">
          <button
            type="button"
            className="welcome-primary"
            onClick={() => start({ demo: true })}
            autoFocus
          >
            <PlayIcon size={18} /> Play the demo
          </button>
          <button type="button" className="welcome-secondary" onClick={() => start()}>
            <MusicIcon size={17} /> Start a new song
          </button>
        </div>

        <div className="welcome-links">
          <button type="button" className="link-btn" onClick={() => start({ starter: true })}>
            Start with a simple loop
          </button>
          <label className="link-btn">
            <UploadIcon size={14} /> Open a MIDI or song file
            <input type="file" accept={SONG_FILE_ACCEPT} aria-label="Open a MIDI or song file" hidden onChange={(event) => void openFile(event)} />
          </label>
          {library.length > 0 && (
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                dismiss();
                setPanel('library');
              }}
            >
              <LibraryIcon size={14} /> My songs ({library.length})
            </button>
          )}
        </div>

        <p className="welcome-note">You can also drop a MIDI or song file anywhere on this window · Unofficial fan app</p>
      </div>
    </div>
  );
}
