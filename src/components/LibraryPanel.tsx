import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../state/store';
import { Modal } from './Modal';
import { downloadProjectFile } from '../export/exporters';
import { importSongFile, SONG_FILE_ACCEPT } from '../state/importFile';
import {
  CopyIcon,
  DownloadIcon,
  LibraryIcon,
  MusicIcon,
  PlusIcon,
  SparkIcon,
  TrashIcon,
  UploadIcon,
} from './Icons';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function LibraryPanel({ onClose }: { onClose: () => void }) {
  const library = useAppStore((state) => state.library);
  const loading = useAppStore((state) => state.libraryLoading);
  const current = useAppStore((state) => state.project);
  const refresh = useAppStore((state) => state.refreshLibrary);
  const openProject = useAppStore((state) => state.openLibraryProject);
  const deleteProject = useAppStore((state) => state.deleteLibraryProject);
  const duplicateProject = useAppStore((state) => state.duplicateLibraryProject);
  const newProject = useAppStore((state) => state.newProject);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const importFile = async (file: File | null) => {
    if (!file) return;
    setImporting(true);
    try {
      if (await importSongFile(file)) onClose();
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Modal title="My songs" eyebrow="Saved in this browser · no account, nothing uploaded" onClose={onClose} size="large">
      <div className="library-toolbar">
        <div className="library-actions">
          <button type="button" className="btn primary" onClick={() => { newProject(); onClose(); }}>
            <PlusIcon size={15} /> New song
          </button>
          <button type="button" className="btn" onClick={() => { newProject({ demo: true }); onClose(); }}>
            <SparkIcon size={15} /> Load demo
          </button>
          <button type="button" className="btn" onClick={() => { newProject({ starter: true }); onClose(); }}>
            <MusicIcon size={15} /> Starter loop
          </button>
        </div>
        <div className="library-actions">
          <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={importing}>
            <UploadIcon size={15} /> {importing ? 'Opening…' : 'Import song or MIDI'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => downloadProjectFile(current)}
            title="Download the open song as a .skymusic.json file, as a backup or to share"
          >
            <DownloadIcon size={15} /> Save song to a file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={SONG_FILE_ACCEPT}
            className="file-input"
            onChange={(event) => void importFile(event.target.files?.[0] ?? null)}
          />
        </div>
      </div>

      <p className="library-note">
        Songs save here automatically as you edit. To open a MIDI file or a saved song, use Import or drop the file anywhere on the window.
      </p>

      {loading && <p className="loading-line">Reading local library…</p>}

      <div className="library-list">
        {library.map((entry) => (
          <article key={entry.id} className={`library-card ${entry.id === current.id ? 'is-current' : ''}`}>
            <div className="library-icon"><LibraryIcon size={19} /></div>
            <div className="library-card-main">
              <h3>{entry.title}</h3>
              <p>
                {formatDate(entry.updatedAt)} · {entry.trackCount} instrument{entry.trackCount === 1 ? '' : 's'} ·{' '}
                {entry.noteCount} note{entry.noteCount === 1 ? '' : 's'} · {entry.bpm} BPM
              </p>
            </div>
            <div className="library-card-actions">
              {entry.id === current.id ? (
                <span className="library-open-badge">Open now</span>
              ) : (
                <button
                  type="button"
                  className="btn small"
                  onClick={async () => {
                    if (await openProject(entry.id)) onClose();
                  }}
                >
                  Open
                </button>
              )}
              <button
                type="button"
                className="mini-btn"
                onClick={() => void duplicateProject(entry.id)}
                title="Duplicate"
              >
                <CopyIcon size={14} />
              </button>
              {confirming === entry.id ? (
                <span className="confirm-row">
                  <button
                    type="button"
                    className="mini-btn danger-solid"
                    onClick={async () => {
                      await deleteProject(entry.id);
                      setConfirming(null);
                    }}
                  >
                    Delete
                  </button>
                  <button type="button" className="mini-btn" onClick={() => setConfirming(null)}>
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="mini-btn danger"
                  onClick={() => setConfirming(entry.id)}
                  title="Delete from this browser"
                  aria-label={`Delete ${entry.title}`}
                >
                  <TrashIcon size={14} />
                </button>
              )}
            </div>
          </article>
        ))}
      </div>

      {!loading && library.length === 0 && (
        <div className="empty-state library-empty">
          <SparkIcon size={26} />
          <h3>No local songs yet</h3>
          <p>Start an empty song or load the original six-performer demo to hear how it sounds.</p>
          <div className="library-actions center">
            <button type="button" className="btn primary" onClick={() => { newProject(); onClose(); }}>New song</button>
            <button type="button" className="btn" onClick={() => { newProject({ demo: true }); onClose(); }}>Load demo</button>
          </div>
        </div>
      )}

      <div className="library-footnote">
        <span>
          Clearing this browser's site data deletes My songs. Use Save song to a file for a backup you keep.
        </span>
      </div>
    </Modal>
  );
}
