import { useMemo, useState } from 'react';
import { useAppStore } from '../state/store';
import { playback } from '../state/playback';
import { searchInstruments } from '../music/instruments';
import { soundSourceInfo } from '../audio/sampleBank';
import { useSoundBankVersion } from './SoundsPanel';
import type { SheetPart } from '../music/types';
import { Modal } from './Modal';
import { InstrumentIcon } from './InstrumentIcon';
import { MusicIcon, PlayIcon } from './Icons';

export type CatalogIntent =
  | { mode: 'browse' }
  | { mode: 'add' }
  | { mode: 'change'; trackId: string };

const PARTS: { value: SheetPart | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'melody', label: 'Melody' },
  { value: 'sub', label: 'Wind' },
  { value: 'bass', label: 'Bass' },
  { value: 'percussion', label: 'Percussion' },
];

export function CatalogPanel({ intent, onClose }: { intent: CatalogIntent; onClose: () => void }) {
  const project = useAppStore((state) => state.project);
  const activeTrackId = useAppStore((state) => state.activeTrackId);
  const setTrackInstrument = useAppStore((state) => state.setTrackInstrument);
  const addTrack = useAppStore((state) => state.addTrack);
  const [query, setQuery] = useState('');
  const [part, setPart] = useState<SheetPart | 'all'>('all');
  const results = useMemo(
    () => searchInstruments({ query, part, status: 'all', category: 'all' }),
    [query, part],
  );
  useSoundBankVersion();

  const targetId = intent.mode === 'change' ? intent.trackId : activeTrackId;
  const currentInstrument = project.tracks.find((track) => track.id === targetId)?.instrumentId;

  const chooseInstrument = (instrumentId: string) => {
    if (intent.mode === 'add') addTrack(instrumentId);
    else setTrackInstrument(targetId, instrumentId);
    onClose();
  };

  return (
    <Modal
      title={intent.mode === 'add' ? 'Add an instrument' : 'Choose an instrument'}
      onClose={onClose}
      size="wide"
      testId="catalog-panel"
    >
      <div className="catalog-filters">
        <input
          type="search"
          className="input search-input"
          placeholder="Search instruments"
          aria-label="Search instruments"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          data-testid="catalog-search"
        />
        <div className="catalog-parts" role="group" aria-label="Filter by part">
          {PARTS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={part === item.value ? 'is-on' : ''}
              onClick={() => setPart(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="catalog-grid" data-testid="catalog-grid">
        {results.map((instrument) => (
          <div
            key={instrument.id}
            className={`instrument-tile ${instrument.id === currentInstrument ? 'is-current' : ''}`}
            data-testid={`instrument-card-${instrument.id}`}
          >
            <button
              type="button"
              className="instrument-tile-main"
              onClick={() => chooseInstrument(instrument.id)}
              data-testid={`use-${instrument.id}`}
            >
              <InstrumentIcon instrumentId={instrument.id} size={44} />
              <span className="instrument-tile-name">{instrument.displayName}</span>
              <span className="instrument-tile-meta">
                {instrument.keyCount} pads · {soundSourceInfo(instrument.id).kind === 'sample' ? 'Game' : 'Synth'}
              </span>
            </button>
            <button
              type="button"
              className="instrument-tile-play"
              onClick={() => void playback.audition(instrument.id)}
              aria-label={`Hear ${instrument.displayName}`}
              title="Hear it"
              data-testid={`audition-${instrument.id}`}
            >
              <PlayIcon size={12} />
            </button>
          </div>
        ))}
      </div>
      {results.length === 0 && (
        <div className="empty-state">
          <MusicIcon size={22} />
          <p>No instruments match.</p>
        </div>
      )}
    </Modal>
  );
}
