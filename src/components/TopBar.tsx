import { useEffect, useState } from 'react';
import { useAppStore, type SaveState } from '../state/store';
import { useAudioStore } from '../state/clock';
import { playback } from '../state/playback';
import { MAX_TITLE_LENGTH } from '../music/validation';
import { AudioIcon, SparkIcon } from './Icons';
import { MoreMenu } from './MoreMenu';
import { QuickActions } from './QuickActions';
import { HistoryButtons, SongFields, TransportControls } from './Transport';
import { useCancellableEdit } from './useCancellableEdit';

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'Saved locally',
  saving: 'Saving…',
  unsaved: 'Unsaved changes',
  error: 'Storage error',
};

export function TopBar({ onOpenCatalog }: { onOpenCatalog: () => void }) {
  const project = useAppStore((state) => state.project);
  const saveState = useAppStore((state) => state.saveState);
  const saveError = useAppStore((state) => state.saveError);
  const setProjectTitle = useAppStore((state) => state.setTitle);
  const audioStatus = useAudioStore((state) => state.status);
  const [title, setTitle] = useState(project.title);
  const [editingTitle, setEditingTitle] = useState(false);

  useEffect(() => {
    if (!editingTitle) setTitle(project.title);
  }, [project.title, project.id, editingTitle]);

  const titleEdit = useCancellableEdit(
    () => {
      setEditingTitle(false);
      if (title.trim() && title.trim() !== project.title) setProjectTitle(title.trim());
      else setProjectTitle(project.title);
    },
    () => {
      setEditingTitle(false);
      setTitle(project.title);
    },
  );

  const audioLabel = audioStatus === 'ready' ? 'Sound on' : audioStatus === 'starting' ? 'Starting sound' : 'Turn on sound';

  return (
    <header className="studio-bar">
      <TransportControls />

      <div className="project-title-block">
        <input
          className={`project-title ${editingTitle ? 'is-editing' : ''}`}
          value={title}
          aria-label="Project title"
          onFocus={() => setEditingTitle(true)}
          onChange={(event) => setTitle(event.target.value.slice(0, MAX_TITLE_LENGTH))}
          {...titleEdit}
        />
        <span
          className={`save-indicator save-${saveState}`}
          title={saveError ?? SAVE_LABEL[saveState]}
          aria-label={SAVE_LABEL[saveState]}
          role="status"
        >
          <span className="save-dot" />
        </span>
      </div>

      <SongFields />
      <HistoryButtons />

      <nav className="top-actions" aria-label="Project actions">
        <QuickActions />
        <button
          type="button"
          className={`btn top-icon audio-pill ${audioStatus}`}
          onClick={() => void playback.enableAudio()}
          aria-label={audioLabel}
          title={audioLabel}
        >
          {audioStatus === 'ready' ? <AudioIcon size={18} /> : <SparkIcon size={17} />}
        </button>
        <MoreMenu onOpenCatalog={onOpenCatalog} />
      </nav>
    </header>
  );
}
