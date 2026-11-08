import { Modal } from './Modal';
import { TrackList } from './TrackList';
import type { CatalogIntent } from './CatalogPanel';
import { MusicIcon } from './Icons';

export function TracksPanel({
  onOpenCatalog,
  onClose,
}: {
  onOpenCatalog: (intent: CatalogIntent) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Tracks & mix"
      onClose={onClose}
      size="medium"
    >
      <p className="panel-hint">Set each instrument's volume, mute (M) or solo (S) it, and rename or reorder tracks. Click a track to edit its notes.</p>
      <div className="tracks-panel-body">
        <TrackList onOpenCatalog={onOpenCatalog} />
      </div>
      <div className="modal-actions">
        <button type="button" className="btn primary" onClick={onClose}>
          <MusicIcon size={15} /> Done
        </button>
      </div>
    </Modal>
  );
}
