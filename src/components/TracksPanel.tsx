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
      title="Performers"
      onClose={onClose}
      size="medium"
    >
      <p className="panel-hint">Pick a track to edit it. Mix and instrument options stay here.</p>
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
