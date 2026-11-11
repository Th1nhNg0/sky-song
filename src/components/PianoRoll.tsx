import { memo, useMemo, useRef, type RefObject } from 'react';
import { firstNoteAt, gridBackground } from '../music/grid';
import { isTonicDegree } from '../music/keys';
import { resolvePad } from '../music/pitch';
import { formatBarBeat } from '../music/time';
import type { InstrumentDefinition, Note, Track } from '../music/types';
import { useTouch } from '../state/layout';
import { playback } from '../state/playback';
import { useAppStore } from '../state/store';
import { useNoteGestures, type DragState } from './useNoteGestures';
import { OVERSCAN, WINDOW_STEP } from './useTimelineView';

const NOTE_SIZE = 26;
const COMPACT_ZOOM = 24;

const RollNote = memo(function RollNote({
  note,
  left,
  top,
  width,
  height,
  selected,
  hold,
  label,
  fullName,
  position,
}: {
  note: Note;
  left: number;
  top: number;
  width: number;
  height: number;
  selected: boolean;
  hold: boolean;
  label: string;
  fullName: string;
  position: string;
}) {
  return (
    <div
      className={`roll-note ${hold ? 'is-held' : 'is-shot'} ${selected ? 'is-selected' : ''}`}
      style={{ left, top, width, height, opacity: 0.78 + note.velocity * 0.22 }}
      data-note-id={note.id}
      title={`${fullName} · ${position}${hold ? ` · held ${note.durationBeats.toFixed(2)} beats` : ''}`}
    >
      <span className="roll-note-label">{label}</span>
      {hold && <span className="note-resize" aria-hidden="true" />}
    </div>
  );
});

/** The open track's notes on its instrument's real pads, one row per pad. */
export function PianoRoll({
  track,
  instrument,
  projectKey,
  meter,
  px,
  snap,
  rowHeight,
  totalBeats,
  windowStart,
  viewWidth,
  scrollRef,
  dragRef,
}: {
  track: Track;
  instrument: InstrumentDefinition;
  projectKey: number;
  meter: [number, number];
  px: number;
  snap: number;
  rowHeight: number;
  totalBeats: number;
  /** Left edge, in pixels, of the stretch of the timeline being drawn. */
  windowStart: number;
  viewWidth: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  dragRef: RefObject<DragState | null>;
}) {
  const selectedNoteIds = useAppStore((state) => state.selectedNoteIds);
  const editTool = useAppStore((state) => state.editTool);
  const gridRef = useRef<HTMLDivElement>(null);
  const touch = useTouch();

  const hold = instrument.supportsHold;
  const keyCount = instrument.keyCount;
  const cols = instrument.padLayout.cols;
  const rollHeight = keyCount * rowHeight;
  const noteSize = Math.min(NOTE_SIZE, rowHeight - 4);
  // Zoomed far out, dots would overlap into a blur, so notes become slim unlabelled marks.
  const compact = px < COMPACT_ZOOM;
  const shotWidth = compact ? Math.max(4, px * 0.8) : noteSize;

  const padNames = useMemo(
    () =>
      Array.from({ length: keyCount }, (_, pad) => {
        const resolved = resolvePad(instrument, projectKey, pad);
        const full = resolved.noteName ?? resolved.label;
        return { full, short: resolved.pitched ? full.replace(/\d/, '') : '', pitched: resolved.pitched, degree: resolved.degree };
      }),
    [instrument, keyCount, projectKey],
  );
  const selectedSet = useMemo(() => new Set(selectedNoteIds), [selectedNoteIds]);

  const longest = useMemo(
    () => (hold ? track.notes.reduce((max, note) => Math.max(max, note.durationBeats), 0) : 0),
    [track.notes, hold],
  );
  const visibleNotes = useMemo(() => {
    const from = (windowStart - OVERSCAN) / px - longest - 1;
    const to = (windowStart + viewWidth + OVERSCAN + WINDOW_STEP) / px;
    const notes: Note[] = [];
    for (let index = firstNoteAt(track.notes, from); index < track.notes.length; index++) {
      const note = track.notes[index];
      if (note.startBeat > to) break;
      notes.push(note);
    }
    return notes;
  }, [track.notes, windowStart, viewWidth, px, longest]);

  const { ghostRef, marquee, gridHandlers } = useNoteGestures({
    gridRef,
    scrollRef,
    dragRef,
    notes: track.notes,
    instrumentId: instrument.id,
    hold,
    keyCount,
    px,
    snap,
    editTool,
    rowHeight,
    rollHeight,
    noteSize,
    padNames,
  });

  const grid = gridBackground(px, meter, snap);

  return (
    <div className="piano-roll">
      <div className="roll-labels" style={{ height: rollHeight }}>
        {padNames.map((name, pad) => (
          <button
            type="button"
            key={pad}
            data-pad={pad}
            className={`roll-label ${Math.floor(pad / cols) % 2 === 1 ? 'group-alt' : ''} ${isTonicDegree(name.degree) ? 'is-tonic' : ''}`}
            style={{ height: rowHeight }}
            tabIndex={-1}
            onPointerDown={() => void playback.previewPad(instrument.id, pad, 0.8, true)}
            title={`Hear pad ${pad + 1}`}
          >
            <span className="roll-pad-number">{pad + 1}</span>
            <span className="roll-note-name">{name.full}</span>
          </button>
        ))}
      </div>
      <div
        className={`roll-grid tool-${editTool} ${compact ? 'is-compact' : ''}`}
        ref={gridRef}
        style={{ width: totalBeats * px, height: rollHeight, ...grid }}
        {...gridHandlers}
      >
        {padNames.map((name, pad) => (
          <div
            key={pad}
            className={`roll-row-bg ${Math.floor(pad / cols) % 2 === 1 ? 'group-alt' : ''} ${isTonicDegree(name.degree) ? 'is-tonic' : ''}`}
            style={{ top: pad * rowHeight, height: rowHeight }}
            aria-hidden="true"
          />
        ))}
        {visibleNotes.map((note) => (
          <RollNote
            key={note.id}
            note={note}
            left={note.startBeat * px}
            top={note.pad * rowHeight + (rowHeight - noteSize) / 2}
            width={hold ? Math.max(compact ? 4 : noteSize, note.durationBeats * px - 1) : shotWidth}
            height={noteSize}
            selected={selectedSet.has(note.id)}
            hold={hold}
            label={compact ? '' : padNames[note.pad]?.short ?? ''}
            fullName={padNames[note.pad]?.full ?? ''}
            position={formatBarBeat(note.startBeat, meter)}
          />
        ))}
        <div ref={ghostRef} className="roll-ghost" style={{ width: noteSize, height: noteSize, lineHeight: `${noteSize}px` }} aria-hidden="true" />
        {marquee && <div className="marquee" style={marquee} aria-hidden="true" />}
        {track.notes.length === 0 && (
          <div className="roll-empty">
            <strong>
              {editTool === 'draw'
                ? `${touch ? 'Tap' : 'Click'} a row to place a note`
                : `${touch ? 'Double-tap' : 'Double-click'} to place a note`}
            </strong>
            <span>
              {!hold
                ? `${instrument.displayName} plays one-shot notes that ring out on their own.`
                : touch
                  ? `${instrument.displayName} holds notes: drag a note’s right edge to set the length.`
                  : `${instrument.displayName} holds notes: drag right while placing to set the length.`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
