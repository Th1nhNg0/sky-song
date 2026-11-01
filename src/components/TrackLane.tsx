import { memo, useEffect, useRef } from 'react';
import { getInstrument } from '../music/instruments';
import { firstNoteAt } from '../music/grid';
import type { Track } from '../music/types';
import { useViewStore } from '../state/clock';
import { useAppStore } from '../state/store';
import { InstrumentIcon } from './InstrumentIcon';
import { TrashIcon } from './Icons';

export const LANE_HEIGHT = 46;
const LANE_PADDING = 6;

/** Track controls shared by collapsed lanes and the open track's header. */
export function TrackMixButtons({ track }: { track: Track }) {
  const toggleMute = useAppStore((state) => state.toggleTrackMute);
  const toggleSolo = useAppStore((state) => state.toggleTrackSolo);
  const removeTrack = useAppStore((state) => state.removeTrack);
  const notify = useAppStore((state) => state.notify);
  const canRemove = useAppStore((state) => state.project.tracks.length > 1);
  return (
    <span className="mix-toggles">
      <button
        type="button"
        className={`mix-toggle is-mute ${track.muted ? 'is-on' : ''}`}
        onClick={(event) => {
          event.stopPropagation();
          toggleMute(track.id);
        }}
        aria-pressed={track.muted}
        aria-label={`Mute ${track.name}`}
        title="Mute"
      >
        M
      </button>
      <button
        type="button"
        className={`mix-toggle is-solo ${track.solo ? 'is-on' : ''}`}
        onClick={(event) => {
          event.stopPropagation();
          toggleSolo(track.id);
        }}
        aria-pressed={track.solo}
        aria-label={`Solo ${track.name}`}
        title="Solo"
      >
        S
      </button>
      <button
        type="button"
        className="mix-toggle is-remove"
        onClick={(event) => {
          event.stopPropagation();
          removeTrack(track.id);
          notify(`Removed “${track.name}”. Undo restores the instrument and its notes.`, 'success');
        }}
        disabled={!canRemove}
        aria-label={`Remove ${track.name}`}
        title={canRemove ? 'Remove instrument — Undo restores it' : 'Keep at least one instrument'}
      >
        <TrashIcon size={12} />
      </button>
    </span>
  );
}

/** Paints only the visible stretch of a lane, sharp at any zoom and song length. */
function LaneCanvas({ track, px, hold, pads }: { track: Track; px: number; hold: boolean; pads: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const longest = hold ? track.notes.reduce((max, note) => Math.max(max, note.durationBeats), 0) : 0;
    let frame = 0;
    const draw = () => {
      frame = 0;
      const { scrollLeft, viewWidth } = useViewStore.getState();
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(viewWidth));
      if (canvas.width !== width * ratio) {
        canvas.width = width * ratio;
        canvas.height = LANE_HEIGHT * ratio;
        canvas.style.width = `${width}px`;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, LANE_HEIGHT);
      ctx.fillStyle = track.color;
      const inner = LANE_HEIGHT - LANE_PADDING * 2;
      const height = Math.max(2, inner / pads - 0.5);
      const last = (scrollLeft + width) / px;
      for (let index = firstNoteAt(track.notes, scrollLeft / px - longest - 1); index < track.notes.length; index++) {
        const note = track.notes[index];
        if (note.startBeat > last) break;
        const noteWidth = hold ? Math.max(height, note.durationBeats * px - 1) : Math.max(height, 2.5);
        ctx.fillRect(note.startBeat * px - scrollLeft, LANE_PADDING + (note.pad * inner) / pads, noteWidth, height);
      }
    };
    const request = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    draw();
    const unsubscribe = useViewStore.subscribe((state, previous) => {
      if (state.scrollLeft !== previous.scrollLeft || state.viewWidth !== previous.viewWidth) request();
    });
    return () => {
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [track.notes, track.color, px, hold, pads]);

  return <canvas ref={canvasRef} className="track-lane-canvas" aria-hidden="true" />;
}

/** One instrument's notes in miniature; clicking it opens that instrument for editing. */
export const TrackLane = memo(function TrackLane({
  track,
  px,
  totalBeats,
  silent,
  onSelect,
}: {
  track: Track;
  px: number;
  totalBeats: number;
  silent: boolean;
  onSelect: (id: string) => void;
}) {
  const instrument = getInstrument(track.instrumentId);
  return (
    <div
      className={`track-lane ${silent ? 'is-silent' : ''}`}
      style={{ ['--track-color' as string]: track.color, height: LANE_HEIGHT }}
    >
      <div className="track-header">
        <button
          type="button"
          className="track-header-open"
          onClick={() => onSelect(track.id)}
          data-track-id={track.id}
          data-instrument-id={track.instrumentId}
          title={`Edit ${track.name}`}
        >
          <InstrumentIcon instrumentId={track.instrumentId} size={22} />
          <span className="track-header-name">{track.name}</span>
        </button>
        <TrackMixButtons track={track} />
      </div>
      <div className="track-lane-notes" style={{ width: totalBeats * px }} onClick={() => onSelect(track.id)}>
        {track.notes.length > 0 ? (
          <LaneCanvas track={track} px={px} hold={instrument.supportsHold} pads={instrument.keyCount} />
        ) : (
          <span className="track-lane-empty">Empty</span>
        )}
      </div>
    </div>
  );
});
