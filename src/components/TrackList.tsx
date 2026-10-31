import { useEffect, useState } from 'react';
import { useAppStore } from '../state/store';
import { getInstrument } from '../music/instruments';
import { TRACK_COLORS } from '../music/project';
import type { Track } from '../music/types';
import type { CatalogIntent } from './CatalogPanel';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  CopyIcon,
  MusicIcon,
  MuteIcon,
  PlusIcon,
  TrashIcon,
  VolumeIcon,
} from './Icons';

function TrackNameInput({ track }: { track: Track }) {
  const renameTrack = useAppStore((state) => state.renameTrack);
  const [name, setName] = useState(track.name);
  useEffect(() => setName(track.name), [track.name]);
  return (
    <input
      className="track-name-input"
      value={name}
      aria-label={`Rename ${track.name}`}
      onChange={(event) => setName(event.target.value.slice(0, 60))}
      onBlur={() => {
        if (name.trim() && name.trim() !== track.name) renameTrack(track.id, name);
        else setName(track.name);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setName(track.name);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function TrackRow({
  track,
  index,
  onOpenCatalog,
}: {
  track: Track;
  index: number;
  onOpenCatalog: (intent: CatalogIntent) => void;
}) {
  const activeTrackId = useAppStore((state) => state.activeTrackId);
  const setActiveTrack = useAppStore((state) => state.setActiveTrack);
  const setTrackColor = useAppStore((state) => state.setTrackColor);
  const toggleMute = useAppStore((state) => state.toggleTrackMute);
  const toggleSolo = useAppStore((state) => state.toggleTrackSolo);
  const setVolume = useAppStore((state) => state.setTrackVolume);
  const beginGesture = useAppStore((state) => state.beginGesture);
  const endGesture = useAppStore((state) => state.endGesture);
  const duplicateTrack = useAppStore((state) => state.duplicateTrack);
  const removeTrack = useAppStore((state) => state.removeTrack);
  const moveTrack = useAppStore((state) => state.moveTrack);
  const instrument = getInstrument(track.instrumentId);
  const isActive = track.id === activeTrackId;

  return (
    <article
      className={`track-card ${isActive ? 'is-active' : ''} ${track.muted ? 'is-muted' : ''}`}
      style={{ ['--track-color' as string]: track.color }}
      data-testid="track-card"
      data-track-id={track.id}
      data-instrument-id={track.instrumentId}
      onClick={() => setActiveTrack(track.id)}
    >
      <div className="track-row-head">
        <span className="track-color-dot" aria-hidden="true" />
        <span className="track-index">P{index + 1}</span>
        <TrackNameInput track={track} />
        <span className="note-count">{track.notes.length} notes</span>
      </div>

      <button
        type="button"
        className="track-instrument"
        onClick={(event) => {
          event.stopPropagation();
          setActiveTrack(track.id);
          onOpenCatalog({ mode: 'change', trackId: track.id });
        }}
        data-testid="track-instrument-button"
      >
        <MusicIcon size={14} />
        <span>{instrument.displayName}</span>
        <small>{instrument.keyCount} pads</small>
      </button>

      <div className="track-mix">
        <button
          type="button"
          className={`track-mix-button ${track.muted ? 'is-on' : ''}`}
          onClick={(event) => {
            event.stopPropagation();
            toggleMute(track.id);
          }}
          aria-pressed={track.muted}
          aria-label="Mute track"
          title="Mute"
          data-testid="mute-button"
        >
          <MuteIcon size={14} /> M
        </button>
        <button
          type="button"
          className={`track-mix-button ${track.solo ? 'is-on' : ''}`}
          onClick={(event) => {
            event.stopPropagation();
            toggleSolo(track.id);
          }}
          aria-pressed={track.solo}
          aria-label="Solo track"
          title="Solo"
          data-testid="solo-button"
        >
          S
        </button>
        <label className="volume-control" onClick={(event) => event.stopPropagation()}>
          <VolumeIcon size={14} />
          <input
            type="range"
            min={0}
            max={1.2}
            step={0.01}
            value={track.volume}
            aria-label={`${track.name} volume`}
            onChange={(event) => setVolume(track.id, Number(event.target.value))}
            onPointerDown={beginGesture}
            onPointerUp={endGesture}
            onBlur={endGesture}
            onKeyDown={(event) => {
              if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') beginGesture();
            }}
            onKeyUp={(event) => {
              if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') endGesture();
            }}
          />
        </label>
        <button
          type="button"
          className="color-swatch"
          onClick={(event) => {
            event.stopPropagation();
            const current = TRACK_COLORS.indexOf(track.color);
            setTrackColor(track.id, TRACK_COLORS[(current + 1) % TRACK_COLORS.length]);
          }}
          title="Change colour"
          aria-label={`Change colour of ${track.name}`}
          style={{ background: track.color }}
        />
      </div>

      <details className="track-options" onClick={(event) => event.stopPropagation()}>
        <summary>
          Track options <ChevronDownIcon size={13} />
        </summary>
        <div className="track-option-actions">
          <button
            type="button"
            onClick={() => duplicateTrack(track.id)}
            aria-label="Duplicate track"
            title="Duplicate"
          >
            <CopyIcon size={14} /> Duplicate
          </button>
          <button
            type="button"
            onClick={() => moveTrack(track.id, -1)}
            aria-label="Move track up"
            disabled={index === 0}
          >
            <ArrowUpIcon size={14} /> Up
          </button>
          <button type="button" onClick={() => moveTrack(track.id, 1)} aria-label="Move track down">
            <ArrowDownIcon size={14} /> Down
          </button>
          <button
            type="button"
            className="danger-text"
            onClick={() => removeTrack(track.id)}
            aria-label="Delete track"
            data-testid="delete-track"
          >
            <TrashIcon size={14} /> Delete
          </button>
        </div>
      </details>
    </article>
  );
}

export function TrackList({ onOpenCatalog }: { onOpenCatalog: (intent: CatalogIntent) => void }) {
  const tracks = useAppStore((state) => state.project.tracks);
  return (
    <aside className="sidebar track-manager" aria-label="Tracks">
      <div className="track-list">
        {tracks.map((track, index) => (
          <TrackRow key={track.id} track={track} index={index} onOpenCatalog={onOpenCatalog} />
        ))}
      </div>
      <button
        type="button"
        className="btn add-track"
        onClick={() => onOpenCatalog({ mode: 'add' })}
        data-testid="add-track-button"
      >
        <PlusIcon size={16} /> Add performer
      </button>
    </aside>
  );
}
