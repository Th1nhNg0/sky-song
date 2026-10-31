import { useSyncExternalStore } from 'react';
import { getSoundBankVersion, soundSourceInfo, subscribeSoundBank } from '../audio/sampleBank';
import { useAppStore } from '../state/store';
import { getInstrument } from '../music/instruments';
import type { CatalogIntent } from './CatalogPanel';
import { ToolSwitch } from './Transport';
import { InstrumentIcon } from './InstrumentIcon';
import { ChevronDownIcon, PlusIcon, VolumeIcon } from './Icons';

export function TrackStrip({ onOpenCatalog }: { onOpenCatalog: (intent: CatalogIntent) => void }) {
  const tracks = useAppStore((state) => state.project.tracks);
  const activeTrackId = useAppStore((state) => state.activeTrackId);
  const setPanel = useAppStore((state) => state.setPanel);
  const active = tracks.find((track) => track.id === activeTrackId) ?? tracks[0];
  const instrument = getInstrument(active.instrumentId);
  useSyncExternalStore(subscribeSoundBank, getSoundBankVersion);
  const isGameSound = soundSourceInfo(instrument.id).kind === 'sample';

  return (
    <section className="track-strip" aria-label="Editing tools">
      <button
        type="button"
        className="instrument-pick"
        onClick={() => onOpenCatalog({ mode: 'change', trackId: active.id })}
        data-testid="track-instrument-button"
        aria-label={`Change instrument for ${active.name}`}
        title="Change instrument"
      >
        <InstrumentIcon instrumentId={instrument.id} size={22} />
        <span>{instrument.displayName}</span>
        <em className={`sound-source ${isGameSound ? 'is-game' : ''}`} data-testid="sound-source">
          {isGameSound ? 'Game' : 'Synth'}
        </em>
        <ChevronDownIcon size={14} />
      </button>
      <button
        type="button"
        className="icon-text-button"
        onClick={() => onOpenCatalog({ mode: 'add' })}
        data-testid="add-track-button"
      >
        <PlusIcon size={16} />
        <span>Add instrument</span>
      </button>
      <div className="track-tools">
        <ToolSwitch />
        <button
          type="button"
          className="icon-text-button"
          onClick={() => setPanel('tracks')}
          aria-label="Tracks and mix"
          title="Tracks and mix"
        >
          <VolumeIcon size={16} />
          <span>Mix</span>
        </button>
      </div>
    </section>
  );
}
