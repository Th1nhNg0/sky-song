import { memo, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useAppStore } from '../state/store';
import { useClockStore } from '../state/clock';
import { playback } from '../state/playback';
import { getInstrument } from '../music/instruments';
import { resolvePad } from '../music/pitch';
import { projectEndBeat } from '../music/project';
import { beatsPerMeasure, formatBarBeat, snapBeat } from '../music/time';
import type { LoopRegion, Note, Track } from '../music/types';
import {
  CheckIcon,
  CopyIcon,
  DuplicateIcon,
  LoopIcon,
  PasteIcon,
  RecordIcon,
  StarIcon,
  TrashIcon,
} from './Icons';
import { InstrumentIcon } from './InstrumentIcon';

type DragState =
  | {
      kind: 'move';
      startX: number;
      startY: number;
      originals: Record<string, { startBeat: number; pad: number }>;
    }
  | { kind: 'resize'; startX: number; noteId: string; originalDuration: number }
  | { kind: 'draw'; startX: number; noteId: string; baseDuration: number }
  | { kind: 'marquee'; x1: number; y1: number; additive: boolean };

function RulerPlayhead({ px }: { px: number }) {
  const playhead = useClockStore((state) => state.playhead);
  return <div className="ruler-playhead" style={{ left: playhead * px }} aria-hidden="true" />;
}

const LANE_HEIGHT = 56;
const NOTE_DOT = 28;
const ACTIVE_HEADER_HEIGHT = 34;

/** One instrument's notes in miniature; clicking it opens that instrument for editing. */
const TrackLane = memo(function TrackLane({
  track,
  px,
  totalBeats,
  onSelect,
}: {
  track: Track;
  px: number;
  totalBeats: number;
  onSelect: (id: string) => void;
}) {
  const instrument = getInstrument(track.instrumentId);
  const pads = instrument.keyCount;
  const inner = LANE_HEIGHT - 10;
  const noteHeight = Math.max(4, inner / pads - 1);
  return (
    <div
      className={`track-lane ${track.muted ? 'is-muted' : ''}`}
      style={{ ['--track-color' as string]: track.color, height: LANE_HEIGHT }}
    >
      <button
        type="button"
        className="track-chip track-lane-label"
        onClick={() => onSelect(track.id)}
        data-testid="track-chip"
        data-track-id={track.id}
        data-instrument-id={track.instrumentId}
        title={`Edit ${track.name}`}
      >
        <InstrumentIcon instrumentId={track.instrumentId} size={24} />
        <span className="track-chip-name">{instrument.shortName}</span>
      </button>
      <button
        type="button"
        className="track-lane-notes"
        style={{ width: totalBeats * px }}
        onClick={() => onSelect(track.id)}
        aria-label={`Edit ${track.name}`}
        tabIndex={-1}
      >
        {track.notes.map((note) => (
          <span
            key={note.id}
            className="track-lane-note"
            style={{
              left: note.startBeat * px,
              top: 5 + (note.pad * inner) / pads,
              width: instrument.supportsHold ? Math.max(noteHeight, note.durationBeats * px - 2) : noteHeight,
              height: noteHeight,
            }}
          />
        ))}
      </button>
    </div>
  );
});

function PlayheadLine({ px, height, labelWidth }: { px: number; height: number; labelWidth: number }) {
  const playhead = useClockStore((state) => state.playhead);
  return (
    <div
      className="playhead-line"
      style={{ left: labelWidth + playhead * px, height: height || '100%' }}
      aria-hidden="true"
      data-testid="playhead"
    >
      <span className="playhead-cap" />
    </div>
  );
}

function LoopLane({
  totalBeats,
  px,
  loop,
  meter,
  onChange,
}: {
  totalBeats: number;
  px: number;
  loop: LoopRegion;
  meter: [number, number];
  onChange: (loop: LoopRegion) => void;
}) {
  const laneRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ start: number; end: number } | null>(null);
  const dragRef = useRef<{ mode: 'new' | 'start' | 'end'; anchor: number; fixed: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const beatFromEvent = (event: PointerEvent | ReactPointerEvent): number => {
    const rect = laneRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const x = Math.min(Math.max(0, event.clientX - rect.left), totalBeats * px);
    return Math.round((x / px) * 1000) / 1000;
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const beat = beatFromEvent(event);
      if (drag.mode === 'new') {
        setDraft({ start: Math.min(drag.anchor, beat), end: Math.max(drag.anchor, beat) });
      } else if (drag.mode === 'start') {
        setDraft({ start: Math.min(beat, drag.fixed - 0.25), end: drag.fixed });
      } else {
        setDraft({ start: drag.fixed, end: Math.max(beat, drag.fixed + 0.25) });
      }
    };
    const up = () => {
      const drag = dragRef.current;
      const range = draft;
      if (drag) {
        if (range && range.end - range.start >= 0.25) {
          onChange({ enabled: true, startBeat: range.start, endBeat: range.end });
        } else if (drag.mode === 'new') {
          onChange({ enabled: true, startBeat: drag.anchor, endBeat: drag.anchor + 4 });
        }
      }
      dragRef.current = null;
      setDragging(false);
      setDraft(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    window.addEventListener('pointercancel', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    // beatFromEvent only reads refs and the stable px/totalBeats values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, draft, onChange, px, totalBeats]);

  const startDrag = (event: ReactPointerEvent, mode: 'new' | 'start' | 'end') => {
    event.preventDefault();
    event.stopPropagation();
    const beat = beatFromEvent(event);
    if (mode === 'new') {
      dragRef.current = { mode, anchor: beat, fixed: beat };
      setDraft({ start: beat, end: beat + 0.001 });
    } else if (mode === 'start') {
      dragRef.current = { mode, anchor: beat, fixed: loop.endBeat };
      setDraft({ start: beat, end: loop.endBeat });
    } else {
      dragRef.current = { mode, anchor: beat, fixed: loop.startBeat };
      setDraft({ start: loop.startBeat, end: beat });
    }
    setDragging(true);
  };

  const shown = draft ?? { start: loop.startBeat, end: loop.endBeat };
  const width = Math.max(2, (shown.end - shown.start) * px);
  return (
    <div className="loop-row">
      <div className="loop-corner">
        <LoopIcon size={12} />
        <span>Loop</span>
      </div>
      <div
        className="loop-lane"
        ref={laneRef}
        style={{ width: totalBeats * px }}
        onPointerDown={(event) => startDrag(event, 'new')}
        title="Drag to set a loop region; drag the ends to resize"
        data-testid="loop-lane"
      >
        <div
          className={`loop-region ${loop.enabled ? 'is-enabled' : ''} ${draft ? 'is-draft' : ''}`}
          style={{ left: shown.start * px, width }}
        >
          <button
            type="button"
            className="loop-handle start"
            aria-label="Drag loop start"
            onPointerDown={(event) => startDrag(event, 'start')}
          />
          <span className="loop-label">
            {formatBarBeat(shown.start, meter)} – {formatBarBeat(shown.end, meter)}
          </span>
          <button
            type="button"
            className="loop-handle end"
            aria-label="Drag loop end"
            onPointerDown={(event) => startDrag(event, 'end')}
          />
        </div>
      </div>
    </div>
  );
}

export function Timeline() {
  const project = useAppStore((state) => state.project);
  const activeTrackId = useAppStore((state) => state.activeTrackId);
  const selectedNoteIds = useAppStore((state) => state.selectedNoteIds);
  const preferences = useAppStore((state) => state.preferences);
  const editTool = useAppStore((state) => state.editTool);
  const setLoop = useAppStore((state) => state.setLoop);
  const addNote = useAppStore((state) => state.addNote);
  const selectNotes = useAppStore((state) => state.selectNotes);
  const clearSelection = useAppStore((state) => state.clearSelection);
  const duplicateSelection = useAppStore((state) => state.duplicateSelection);
  const copySelection = useAppStore((state) => state.copySelection);
  const pasteClipboard = useAppStore((state) => state.pasteClipboard);
  const deleteSelectedNotes = useAppStore((state) => state.deleteSelectedNotes);
  const quantizeSelection = useAppStore((state) => state.quantizeSelection);
  const restoreOriginalTiming = useAppStore((state) => state.restoreOriginalTiming);
  const notify = useAppStore((state) => state.notify);
  const setActiveTrack = useAppStore((state) => state.setActiveTrack);
  const activeTrack = project.tracks.find((track) => track.id === activeTrackId) ?? project.tracks[0];
  const instrument = getInstrument(activeTrack.instrumentId);
  const px = preferences.zoom;
  const snap = preferences.snap;
  const beatsPerBar = beatsPerMeasure(project.timeSignature);
  const contentEnd = Math.max(
    projectEndBeat(project),
    project.loop.endBeat,
    project.loop.startBeat + 4,
    16,
  );
  const totalBeats = contentEnd + 8;
  const labelWidth = 104;
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const [viewHeight, setViewHeight] = useState(0);
  const headerHeight =
    34 +
    (project.loop.enabled ? 28 : 0) +
    ACTIVE_HEADER_HEIGHT +
    (project.tracks.length - 1) * LANE_HEIGHT;
  const rowHeight = Math.max(
    22,
    Math.min(64, Math.floor((viewHeight - headerHeight) / instrument.keyCount)),
  );
  const rollHeight = instrument.padLayout.rows * instrument.padLayout.cols * rowHeight;

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const observer = new ResizeObserver(() => setViewHeight(scroll.clientHeight));
    observer.observe(scroll);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return useClockStore.subscribe((state) => {
      if (!useAppStore.getState().isPlaying) return;
      const scroll = scrollRef.current;
      if (!scroll) return;
      const x = state.playhead * px;
      const start = scroll.scrollLeft + 40;
      const end = scroll.scrollLeft + scroll.clientWidth - 120;
      if (x < start || x > end) {
        scroll.scrollLeft = Math.max(0, x - 120);
      }
    });
  }, [px]);

  const commitLoopFromSelection = () => {
    const state = useAppStore.getState();
    const track = state.activeTrack();
    const selected = track.notes.filter((note) => state.selectedNoteIds.includes(note.id));
    if (selected.length === 0) {
      notify('Select notes first to build a loop from them.', 'info');
      return;
    }
    const start = Math.min(...selected.map((note) => note.startBeat));
    const end = Math.max(...selected.map((note) => note.startBeat + note.durationBeats));
    const roundedStart = Math.max(0, Math.floor(start));
    const roundedEnd = Math.max(roundedStart + 1, Math.ceil(end));
    setLoop({ enabled: true, startBeat: roundedStart, endBeat: roundedEnd });
    notify(`Loop set to bars ${formatBarBeat(roundedStart, state.project.timeSignature)} – ${formatBarBeat(
      roundedEnd,
      state.project.timeSignature,
    )}.`, 'success');
  };

  const quantize = () => {
    if (!snap || snap <= 0) {
      notify('Choose a snap subdivision before quantizing.', 'warning');
      return;
    }
    quantizeSelection(snap, preferences.preserveOriginalTiming);
  };

  const startMarquee = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (!event.shiftKey) clearSelection();
    dragRef.current = { kind: 'marquee', x1: x, y1: y, additive: event.shiftKey };
    setMarquee({ left: x, top: y, width: 0, height: 0 });
    setDragging(true);
  };

  const onGridPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('.roll-note')) return;
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;
    const beat = Math.max(0, (event.clientX - rect.left) / px);
    const pad = Math.min(
      instrument.keyCount - 1,
      Math.max(0, Math.floor((event.clientY - rect.top) / rowHeight)),
    );
    if (editTool === 'draw' || event.altKey) {
      event.preventDefault();
      const snapped = snap > 0 ? snapBeat(beat, snap) : beat;
      const duration = instrument.supportsHold ? Math.max(1, snap || 0.5) : 0.5;
      useAppStore.getState().beginGesture();
      const id = addNote(pad, snapped, duration, { history: false });
      if (id) {
        dragRef.current = { kind: 'draw', startX: event.clientX, noteId: id, baseDuration: duration };
        setDragging(true);
      }
      return;
    }
    startMarquee(event);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.roll-note')) return;
    if (editTool === 'draw') return;
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;
    const beat = Math.max(0, (event.clientX - rect.left) / px);
    const pad = Math.min(
      instrument.keyCount - 1,
      Math.max(0, Math.floor((event.clientY - rect.top) / rowHeight)),
    );
    const snapped = snap > 0 ? snapBeat(beat, snap) : beat;
    addNote(pad, snapped, instrument.supportsHold ? Math.max(1, snap || 0.5) : 0.5);
  };

  const onNotePointerDown = (event: ReactPointerEvent<HTMLDivElement>, note: Note) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const state = useAppStore.getState();
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      state.selectNotes([note.id], 'toggle');
    } else if (!state.selectedNoteIds.includes(note.id)) {
      state.selectNotes([note.id]);
    }
    const ids = useAppStore.getState().selectedNoteIds;
    if (!ids.includes(note.id)) return;
    const track = useAppStore.getState().activeTrack();
    const originals: Record<string, { startBeat: number; pad: number }> = {};
    for (const item of track.notes) {
      if (ids.includes(item.id)) originals[item.id] = { startBeat: item.startBeat, pad: item.pad };
    }
    useAppStore.getState().beginGesture();
    dragRef.current = { kind: 'move', startX: event.clientX, startY: event.clientY, originals };
    setDragging(true);
  };

  const onResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, note: Note) => {
    event.preventDefault();
    event.stopPropagation();
    if (!instrument.supportsHold) return;
    useAppStore.getState().beginGesture();
    dragRef.current = {
      kind: 'resize',
      startX: event.clientX,
      noteId: note.id,
      originalDuration: note.durationBeats,
    };
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.kind === 'move') {
        const dxBeats = (event.clientX - drag.startX) / px;
        const deltaBeats = snap > 0 ? Math.round(dxBeats / snap) * snap : dxBeats;
        const deltaPad = Math.round((event.clientY - drag.startY) / rowHeight);
        useAppStore.getState().dragSelectedNotes(drag.originals, deltaBeats, deltaPad);
      } else if (drag.kind === 'resize') {
        const raw = drag.originalDuration + (event.clientX - drag.startX) / px;
        const next = snap > 0 ? Math.max(snap, Math.round(raw / snap) * snap) : Math.max(0.1, raw);
        useAppStore.getState().resizeNote(drag.noteId, next);
      } else if (drag.kind === 'draw') {
        const raw = drag.baseDuration + (event.clientX - drag.startX) / px;
        const next = snap > 0 ? Math.max(snap, Math.round(raw / snap) * snap) : Math.max(0.1, raw);
        useAppStore.getState().resizeNote(drag.noteId, next);
      } else {
        const rect = gridRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = Math.min(Math.max(0, event.clientX - rect.left), totalBeats * px);
        const y = Math.min(Math.max(0, event.clientY - rect.top), rollHeight);
        setMarquee({
          left: Math.min(drag.x1, x),
          top: Math.min(drag.y1, y),
          width: Math.abs(x - drag.x1),
          height: Math.abs(y - drag.y1),
        });
      }
    };
    const up = () => {
      const drag = dragRef.current;
      if (drag?.kind === 'marquee') {
        const rect = gridRef.current?.getBoundingClientRect();
        const box = marquee;
        if (rect && box && (box.width > 3 || box.height > 3)) {
          const beatMin = box.left / px;
          const beatMax = (box.left + box.width) / px;
          const padMin = Math.floor(box.top / rowHeight);
          const padMax = Math.floor((box.top + box.height) / rowHeight);
          const track = useAppStore.getState().activeTrack();
          const ids = track.notes
            .filter(
              (note) =>
                note.startBeat < beatMax &&
                note.startBeat + note.durationBeats > beatMin &&
                note.pad >= padMin &&
                note.pad <= padMax,
            )
            .map((note) => note.id);
          selectNotes(ids, drag.additive ? 'add' : 'replace');
        }
      } else if (drag) {
        useAppStore.getState().endGesture();
      }
      dragRef.current = null;
      setDragging(false);
      setMarquee(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    window.addEventListener('pointercancel', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [dragging, marquee, px, rowHeight, rollHeight, snap, totalBeats, selectNotes]);

  const seekRuler = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const raw = Math.max(0, (event.clientX - rect.left) / px);
    const beat = snap > 0 ? snapBeat(raw, snap) : raw;
    playback.seek(beat);
  };

  const onRulerPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    seekRuler(event);
    const target = event.currentTarget;
    const move = (ev: PointerEvent) => {
      const rect = target.getBoundingClientRect();
      const raw = Math.max(0, (ev.clientX - rect.left) / px);
      playback.seek(snap > 0 ? snapBeat(raw, snap) : raw);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };

  const loop = project.loop;
  const loopWidth = Math.max(0, (loop.endBeat - loop.startBeat) * px);
  const selectedCount = selectedNoteIds.length;

  const activeRoll = (
    <div className="piano-roll" data-testid="piano-roll">
      <div className="roll-labels" style={{ height: rollHeight }}>
        {Array.from({ length: instrument.keyCount }, (_, padIndex) => {
          const resolved = resolvePad(instrument, project.key, padIndex);
          const isGroupStart = padIndex % instrument.padLayout.cols === 0;
          const groupAlt = Math.floor(padIndex / instrument.padLayout.cols) % 2 === 1;
          return (
            <div
              key={padIndex}
              className={`roll-label ${isGroupStart ? 'group-start' : ''} ${groupAlt ? 'group-alt' : ''}`}
              style={{ height: rowHeight }}
            >
              <span className="roll-pad-number">{padIndex + 1}</span>
              <span className="roll-note-name">
                {resolved.pitched ? resolved.noteName : resolved.label}
              </span>
            </div>
          );
        })}
      </div>
      <div
        className="roll-grid"
        ref={gridRef}
        style={{
          width: totalBeats * px,
          height: rollHeight,
          backgroundSize: `${px}px 100%, ${beatsPerBar * px}px 100%, 100% ${rowHeight}px`,
        }}
        onPointerDown={onGridPointerDown}
        onDoubleClick={onDoubleClick}
        data-testid="grid"
      >
        {Array.from({ length: instrument.keyCount }, (_, padIndex) => (
          <div
            key={padIndex}
            className={`roll-row-bg ${padIndex % instrument.padLayout.cols === 0 ? 'group-start' : ''} ${Math.floor(padIndex / instrument.padLayout.cols) % 2 === 1 ? 'group-alt' : ''}`}
            style={{ top: padIndex * rowHeight, height: rowHeight }}
            aria-hidden="true"
          />
        ))}
        {activeTrack.notes.map((note) => {
          const resolved = resolvePad(instrument, project.key, note.pad);
          // One-shot instruments ring out whatever the length, so they draw as even dots.
          const dot = Math.min(NOTE_DOT, rowHeight - 6);
          const width = instrument.supportsHold ? Math.max(dot, note.durationBeats * px) : dot;
          const label = resolved.pitched ? resolved.noteName?.replace(/\d/, '') : resolved.label;
          const selected = selectedNoteIds.includes(note.id);
          return (
            <div
              key={note.id}
              className={`roll-note ${selected ? 'is-selected' : ''}`}
              style={{
                left: note.startBeat * px,
                top: note.pad * rowHeight + (rowHeight - dot) / 2,
                width,
                height: dot,
              }}
              data-note-id={note.id}
              data-testid="roll-note"
              onPointerDown={(event) => onNotePointerDown(event, note)}
              title={`Pad ${note.pad + 1} · ${resolved.noteName ?? resolved.label} · ${formatBarBeat(
                note.startBeat,
                project.timeSignature,
              )} · ${note.durationBeats.toFixed(2)} beats`}
            >
              {resolved.pitched && <span className="roll-note-label">{label}</span>}
              {instrument.supportsHold && (
                <button
                  type="button"
                  className="note-resize"
                  aria-label={`Resize note on pad ${note.pad + 1}`}
                  onPointerDown={(event) => onResizePointerDown(event, note)}
                />
              )}
            </div>
          );
        })}
        {marquee && (
          <div
            className="marquee"
            style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }}
            aria-hidden="true"
          />
        )}
        {activeTrack.notes.length === 0 && (
          <div className="roll-empty">
            <StarIcon size={17} />
            <span>
              {editTool === 'draw'
                ? 'Tap anywhere here to add your first note.'
                : 'Double-click to add a note, or drag to select.'}
            </span>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <section
      className="timeline"
      aria-label="Song editor"
    >
      {selectedCount > 0 && (
        <div className="selection-bar" data-testid="selection-info">
          <strong>{selectedCount} selected</strong>
          <div className="selection-actions">
            <button type="button" onClick={copySelection} aria-label="Copy selected notes" title="Copy (Ctrl/Cmd+C)">
              <CopyIcon size={15} />
            </button>
            <button type="button" onClick={() => pasteClipboard(playback.position())} aria-label="Paste notes at playhead" title="Paste (Ctrl/Cmd+V)">
              <PasteIcon size={15} />
            </button>
            <button type="button" onClick={duplicateSelection} aria-label="Duplicate selected notes" title="Duplicate (Ctrl/Cmd+D)">
              <DuplicateIcon size={15} />
            </button>
            <button type="button" onClick={quantize} data-testid="quantize-button" title="Quantize to grid">
              <CheckIcon size={15} /> <span>Quantize</span>
            </button>
            <button type="button" onClick={restoreOriginalTiming} title="Restore pre-quantize timing">
              <RecordIcon size={13} /> <span>Restore</span>
            </button>
            <button type="button" onClick={commitLoopFromSelection} title="Set the loop region from selected notes">
              <LoopIcon size={15} /> <span>Loop</span>
            </button>
            <button type="button" className="danger-text" onClick={deleteSelectedNotes} aria-label="Delete selected notes" title="Delete">
              <TrashIcon size={15} />
            </button>
            <button type="button" onClick={clearSelection} aria-label="Clear selection" title="Clear selection">
              Done
            </button>
          </div>
        </div>
      )}

      <div className="timeline-scroll" ref={scrollRef}>
        <div className="timeline-content" style={{ width: labelWidth + totalBeats * px, ['--label-width' as string]: `${labelWidth}px`, ['--beat-size' as string]: `${px}px`, ['--bar-size' as string]: `${beatsPerBar * px}px` }}>
          <div className="ruler-wrap">
            <div className="ruler-row">
              <div className="ruler-corner">
                <span>Bars</span>
              </div>
              <div
                className="ruler"
                style={{ width: totalBeats * px }}
                onPointerDown={onRulerPointerDown}
                role="slider"
                aria-label="Timeline position"
                aria-valuemin={0}
                aria-valuemax={totalBeats}
                tabIndex={0}
                data-testid="ruler"
                onKeyDown={(event) => {
                  if (event.key === 'ArrowRight') playback.seek(playback.position() + (snap || 0.25));
                  if (event.key === 'ArrowLeft') playback.seek(Math.max(0, playback.position() - (snap || 0.25)));
                }}
              >
                {Array.from({ length: Math.ceil(totalBeats / beatsPerBar) + 1 }, (_, index) => (
                  <span
                    key={index}
                    className="measure-label"
                    style={{ left: index * beatsPerBar * px }}
                  >
                    {index + 1}
                  </span>
                ))}
                <RulerPlayhead px={px} />
              </div>
            </div>
            {loop.enabled && (
              <LoopLane totalBeats={totalBeats} px={px} loop={loop} meter={project.timeSignature} onChange={setLoop} />
            )}
          </div>

          <div
            className="timeline-body"
            style={{
              backgroundSize: `${px}px 100%, ${beatsPerBar * px}px 100%`,
            }}
          >
            {loop.enabled && (
              <div
                className="loop-band"
                style={{ left: labelWidth + loop.startBeat * px, width: loopWidth }}
                aria-hidden="true"
              />
            )}

            {project.tracks.map((track) =>
              track.id === activeTrack.id ? (
                <div
                  key={track.id}
                  className="track-active"
                  style={{ ['--track-color' as string]: track.color }}
                >
                  <div className="track-active-head" style={{ height: ACTIVE_HEADER_HEIGHT }}>
                    <button
                      type="button"
                      className="track-chip is-active"
                      data-testid="track-chip"
                      data-track-id={track.id}
                      data-instrument-id={track.instrumentId}
                    >
                      <InstrumentIcon instrumentId={track.instrumentId} size={24} />
                      <span className="track-chip-name">{track.name}</span>
                    </button>
                  </div>
                  {activeRoll}
                </div>
              ) : (
                <TrackLane key={track.id} track={track} px={px} totalBeats={totalBeats} onSelect={setActiveTrack} />
              ),
            )}
            <PlayheadLine px={px} height={0} labelWidth={labelWidth} />
          </div>
        </div>
      </div>
    </section>
  );
}
