import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../state/store';
import { Modal } from './Modal';
import { downloadProjectFile } from '../export/exporters';
import { importSongFile } from '../state/importFile';
import { keyShortLabel } from '../music/keys';
import {
  CopyIcon,
  DownloadIcon,
  LibraryIcon,
  MusicIcon,
  PlusIcon,
  SparkIcon,
  TrashIcon,
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
    <Modal title="Project library" eyebrow="Stored locally in this browser · no account, no server" onClose={onClose} size="large">
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
            <DownloadIcon size={15} /> {importing ? 'Importing…' : 'Import song or MIDI'}
          </button>
          <button type="button" className="btn" onClick={() => downloadProjectFile(current)}>
            Export current JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.skymusic.json,application/json,.mid,.midi,audio/midi"
            className="file-input"
            onChange={(event) => void importFile(event.target.files?.[0] ?? null)}
          />
        </div>
      </div>

      <p className="library-note">
        Projects autosave here after each edit; nothing is uploaded.
        For large songs, use a project file instead of a URL.
      </p>

      {loading && <p className="loading-line">Reading local library…</p>}

      <div className="library-list">
        {library.map((entry) => (
          <article key={entry.id} className={`library-card ${entry.id === current.id ? 'is-current' : ''}`}>
            <div className="library-icon"><LibraryIcon size={19} /></div>
            <div className="library-card-main">
              <h3>{entry.title}</h3>
              <p>
                {formatDate(entry.updatedAt)} · {entry.trackCount} performer{entry.trackCount === 1 ? '' : 's'} ·{' '}
                {entry.noteCount} notes · {entry.bpm} BPM · {keyShortLabel(entry.key)} major
              </p>
              <p className="library-meta">
                {Math.round(entry.sizeBytes / 1024)} KB · schema v1 · pads preserved
              </p>
            </div>
            <div className="library-card-actions">
              <button
                type="button"
                className="btn small"
                onClick={async () => {
                  if (await openProject(entry.id)) onClose();
                }}
              >
                Open
              </button>
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
          Saved in this browser. Clearing site data removes the library; export a
          <code> .skymusic.json</code> file for a permanent backup.
        </span>
      </div>
    </Modal>
  );
}
