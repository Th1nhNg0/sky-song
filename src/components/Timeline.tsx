import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { firstNoteAt, gridBackground } from '../music/grid';
import { getInstrument } from '../music/instruments';
import { isTonicDegree } from '../music/keys';
import { resolvePad } from '../music/pitch';
import { DEFAULT_VELOCITY, isTrackAudible, projectEndBeat } from '../music/project';
import { beatsPerMeasure, formatBarBeat, snapBeat } from '../music/time';
import type { Note } from '../music/types';
import { getSoundBankVersion, soundSourceInfo, subscribeSoundBank } from '../audio/sampleBank';
import { LABEL_WIDTH, useClockStore, useViewStore } from '../state/clock';
import { playback } from '../state/playback';
import { useAppStore } from '../state/store';
import { MAX_ZOOM, MIN_ZOOM } from '../storage/preferences';
import { clamp } from '../util';
import type { CatalogIntent } from './CatalogPanel';
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  DuplicateIcon,
  LoopIcon,
  PasteIcon,
  PlusIcon,
  RecordIcon,
  TrashIcon,
  VolumeIcon,
} from './Icons';
import { InstrumentIcon } from './InstrumentIcon';
import { LoopLane, Ruler, usePlayheadTransform } from './Ruler';
import { LANE_HEIGHT, TrackLane, TrackMixButtons } from './TrackLane';

type NoteOrigin = Record<string, { startBeat: number; pad: number }>;

type DragState =
  | { kind: 'move'; startX: number; startY: number; originals: NoteOrigin; anchor: { startBeat: number; pad: number } }
  | { kind: 'resize'; startX: number; noteId: string; originalDuration: number }
  | { kind: 'marquee'; x1: number; y1: number; additive: boolean };

const ACTIVE_HEADER_HEIGHT = 38;
const RULER_HEIGHT = 34;
const LOOP_HEIGHT = 26;
const ADD_ROW_HEIGHT = 38;
const MIN_ROW = 20;
const MAX_ROW = 42;
const NOTE_SIZE = 26;
const COMPACT_ZOOM = 24;
/** Extra width drawn beyond each side of the viewport, and how far scrolling goes before redrawing it. */
const OVERSCAN = 900;
const WINDOW_STEP = 300;
const EDGE_ZONE = 44;
const EDGE_SPEED = 16;
const USER_SCROLL_HOLD_MS = 2500;

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

function PlayheadLine({ px }: { px: number }) {
  const ref = usePlayheadTransform<HTMLDivElement>(px, LABEL_WIDTH);
  return <div ref={ref} className="playhead-line" aria-hidden="true" />;
}

function ActiveVolume({ trackId, volume, name }: { trackId: string; volume: number; name: string }) {
  const setVolume = useAppStore((state) => state.setTrackVolume);
  const beginGesture = useAppStore((state) => state.beginGesture);
  const endGesture = useAppStore((state) => state.endGesture);
  return (
    <label className="active-volume" title={`Volume ${Math.round(volume * 100)}%`}>
      <VolumeIcon size={14} />
      <input
        type="range"
        min={0}
        max={1.2}
        step={0.01}
        value={volume}
        aria-label={`${name} volume`}
        onChange={(event) => setVolume(trackId, Number(event.target.value))}
        onPointerDown={beginGesture}
        onPointerUp={(event) => {
          endGesture();
          event.currentTarget.blur();
        }}
      />
    </label>
  );
}

function SelectionBar({ onLoop, onQuantize }: { onLoop: () => void; onQuantize: () => void }) {
  const count = useAppStore((state) => state.selectedNoteIds.length);
  const state = useAppStore.getState();
  const hasOriginal = useAppStore((current) => {
    const ids = new Set(current.selectedNoteIds);
    return current.activeTrack().notes.some((note) => note.original && ids.has(note.id));
  });
  const velocity = useAppStore((current) => {
    const ids = new Set(current.selectedNoteIds);
    const selected = current.activeTrack().notes.filter((note) => ids.has(note.id));
    return selected.length ? selected.reduce((sum, note) => sum + note.velocity, 0) / selected.length : DEFAULT_VELOCITY;
  });
  if (count === 0) return null;
  return (
    <div className="selection-bar" role="toolbar" aria-label="Selected notes">
      <strong>{count} selected</strong>
      <div className="selection-actions">
        <button type="button" onClick={state.copySelection} aria-label="Copy selected notes" title="Copy (Ctrl+C)">
          <CopyIcon size={15} />
        </button>
        <button
          type="button"
          onClick={() => {
            const end = useAppStore.getState().pasteClipboard(playback.position());
            if (end !== null) playback.seek(end);
          }}
          aria-label="Paste notes at cursor"
          title="Paste at cursor (Ctrl+V)"
        >
          <PasteIcon size={15} />
        </button>
        <button type="button" onClick={state.duplicateSelection} aria-label="Duplicate selected notes" title="Duplicate after selection (Ctrl+D)">
          <DuplicateIcon size={15} />
        </button>
        <span className="selection-divider" />
        <label className="velocity-control" title={`Strength ${Math.round(velocity * 100)}%`}>
          <span>Strength</span>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.01}
            value={velocity}
            aria-label="Strength of selected notes"
            onChange={(event) => useAppStore.getState().setSelectionVelocity(Number(event.target.value))}
            onPointerDown={state.beginGesture}
            onPointerUp={(event) => {
              state.endGesture();
              event.currentTarget.blur();
            }}
          />
        </label>
        <span className="selection-divider" />
        <button type="button" onClick={onQuantize} title="Move to the grid (Q with keys hidden)">
          <CheckIcon size={15} /> <span>Quantize</span>
        </button>
        {hasOriginal && (
          <button type="button" onClick={state.restoreOriginalTiming} title="Back to the timing before quantizing">
            <RecordIcon size={13} /> <span>Restore</span>
          </button>
        )}
        <button type="button" onClick={onLoop} title="Loop these notes">
          <LoopIcon size={15} /> <span>Loop</span>
        </button>
        <span className="selection-divider" />
        <button type="button" className="danger-text" onClick={state.deleteSelectedNotes} aria-label="Delete selected notes" title="Delete (Del)">
          <TrashIcon size={15} />
        </button>
        <button type="button" onClick={state.clearSelection} aria-label="Clear selection" title="Clear selection (Esc)">
          Done
        </button>
      </div>
    </div>
  );
}

export function Timeline({ onOpenCatalog }: { onOpenCatalog: (intent: CatalogIntent) => void }) {
  const project = useAppStore((state) => state.project);
  const activeTrackId = useAppStore((state) => state.activeTrackId);
  const selectedNoteIds = useAppStore((state) => state.selectedNoteIds);
  const px = useAppStore((state) => state.preferences.zoom);
  const snap = useAppStore((state) => state.preferences.snap);
  const preserveOriginal = useAppStore((state) => state.preferences.preserveOriginalTiming);
  const editTool = useAppStore((state) => state.editTool);
  const setLoop = useAppStore((state) => state.setLoop);
  const setActiveTrack = useAppStore((state) => state.setActiveTrack);
  const [minimizedId, setMinimizedId] = useState<string | null>(null);
  const [viewHeight, setViewHeight] = useState(0);
  const [viewWidth, setViewWidth] = useState(800);
  const [windowStart, setWindowStart] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useSyncExternalStore(subscribeSoundBank, getSoundBankVersion);

  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const lastPadRef = useRef<number | null>(null);
  const zoomAnchorRef = useRef<{ beat: number; offset: number } | null>(null);
  const followHoldRef = useRef(0);

  const activeTrack = project.tracks.find((track) => track.id === activeTrackId) ?? project.tracks[0];
  const instrument = getInstrument(activeTrack.instrumentId);
  const hold = instrument.supportsHold;
  const minimized = minimizedId === activeTrack.id;
  const keyCount = instrument.keyCount;
  const cols = instrument.padLayout.cols;
  const beatsPerBar = beatsPerMeasure(project.timeSignature);
  const contentEnd = Math.max(projectEndBeat(project), project.loop.endBeat);
  const totalBeats =
    Math.ceil(Math.max(contentEnd + beatsPerBar * 4, viewWidth / px) / beatsPerBar) * beatsPerBar;

  const openRows = minimized ? 0 : ACTIVE_HEADER_HEIGHT;
  const chrome =
    RULER_HEIGHT +
    (project.loop.enabled ? LOOP_HEIGHT : 0) +
    openRows +
    (project.tracks.length - (minimized ? 0 : 1)) * LANE_HEIGHT +
    ADD_ROW_HEIGHT;
  const rowHeight = clamp(Math.floor((viewHeight - chrome) / keyCount), MIN_ROW, MAX_ROW);
  const rollHeight = keyCount * rowHeight;
  const noteSize = Math.min(NOTE_SIZE, rowHeight - 4);
  // Zoomed far out, dots would overlap into a blur, so notes become slim unlabelled marks.
  const compact = px < COMPACT_ZOOM;
  const shotWidth = compact ? Math.max(4, px * 0.8) : noteSize;

  const padNames = useMemo(
    () =>
      Array.from({ length: keyCount }, (_, pad) => {
        const resolved = resolvePad(instrument, project.key, pad);
        const full = resolved.noteName ?? resolved.label;
        return { full, short: resolved.pitched ? full.replace(/\d/, '') : '', pitched: resolved.pitched, degree: resolved.degree };
      }),
    [instrument, keyCount, project.key],
  );
  const selectedSet = useMemo(() => new Set(selectedNoteIds), [selectedNoteIds]);

  const longest = useMemo(
    () => (hold ? activeTrack.notes.reduce((max, note) => Math.max(max, note.durationBeats), 0) : 0),
    [activeTrack.notes, hold],
  );
  const visibleNotes = useMemo(() => {
    const from = (windowStart - OVERSCAN) / px - longest - 1;
    const to = (windowStart + viewWidth + OVERSCAN + WINDOW_STEP) / px;
    const notes: Note[] = [];
    for (let index = firstNoteAt(activeTrack.notes, from); index < activeTrack.notes.length; index++) {
      const note = activeTrack.notes[index];
      if (note.startBeat > to) break;
      notes.push(note);
    }
    return notes;
  }, [activeTrack.notes, windowStart, viewWidth, px, longest]);

  useEffect(() => {
    useViewStore.setState({ totalBeats });
  }, [totalBeats]);

  // Scroll and size tracking.
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const measure = () => {
      setViewHeight(scroll.clientHeight);
      const width = Math.max(120, scroll.clientWidth - LABEL_WIDTH);
      setViewWidth(width);
      useViewStore.setState({ viewWidth: width });
    };
    const onScroll = () => {
      useViewStore.setState({ scrollLeft: scroll.scrollLeft });
      setWindowStart(Math.floor(scroll.scrollLeft / WINDOW_STEP) * WINDOW_STEP);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    measure();
    scroll.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      scroll.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Ctrl+wheel and pinch zoom around the pointer; a plain wheel scrolls sideways when nothing overflows vertically.
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const onWheel = (event: WheelEvent) => {
      followHoldRef.current = performance.now() + USER_SCROLL_HOLD_MS;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const { zoom } = useAppStore.getState().preferences;
        useViewStore.getState().navigation?.zoomTo(zoom * Math.exp(-event.deltaY * 0.0022), event.clientX);
      } else if (!event.shiftKey && scroll.scrollHeight <= scroll.clientHeight) {
        event.preventDefault();
        scroll.scrollLeft += event.deltaY;
      }
    };
    scroll.addEventListener('wheel', onWheel, { passive: false });
    return () => scroll.removeEventListener('wheel', onWheel);
  }, []);

  // Keeps the beat under the pointer in place across a zoom.
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const anchor = zoomAnchorRef.current;
    if (!scroll || !anchor) return;
    zoomAnchorRef.current = null;
    scroll.scrollLeft = Math.max(0, anchor.beat * px - anchor.offset);
  }, [px]);

  useEffect(() => {
    useViewStore.setState({
      navigation: {
        zoomTo: (next, anchorClientX) => {
          const scroll = scrollRef.current;
          if (!scroll) return;
          const current = useAppStore.getState().preferences.zoom;
          const value = clamp(Math.round(next * 100) / 100, MIN_ZOOM, MAX_ZOOM);
          if (value === current) return;
          const left = scroll.getBoundingClientRect().left + LABEL_WIDTH;
          const offset = anchorClientX !== undefined ? Math.max(0, anchorClientX - left) : scroll.clientWidth / 3;
          zoomAnchorRef.current = { beat: (scroll.scrollLeft + offset) / current, offset };
          useAppStore.getState().setPreferences({ zoom: value });
        },
        zoomToFit: () => {
          const { project: song } = useAppStore.getState();
          const scroll = scrollRef.current;
          if (!scroll) return;
          const width = scroll.clientWidth - LABEL_WIDTH - 24;
          const value = clamp(Math.floor((width / projectEndBeat(song)) * 100) / 100, MIN_ZOOM, MAX_ZOOM);
          zoomAnchorRef.current = { beat: 0, offset: 0 };
          useAppStore.getState().setPreferences({ zoom: value });
          scroll.scrollLeft = 0;
        },
        scrollToBeat: (beat) => {
          const scroll = scrollRef.current;
          if (!scroll) return;
          followHoldRef.current = performance.now() + USER_SCROLL_HOLD_MS;
          scroll.scrollLeft = Math.max(0, beat * useAppStore.getState().preferences.zoom);
        },
      },
    });
  }, []);

  // Keeps the cursor in view. During playback it glides, holding about two thirds across.
  useEffect(() => {
    return useClockStore.subscribe((state) => {
      const scroll = scrollRef.current;
      if (!scroll || dragRef.current || performance.now() < followHoldRef.current) return;
      const width = scroll.clientWidth - LABEL_WIDTH;
      const x = state.playhead * px;
      const left = scroll.scrollLeft;
      if (x < left) scroll.scrollLeft = Math.max(0, x - width * 0.1);
      else if (x > left + width * 0.68) {
        if (useAppStore.getState().isPlaying) scroll.scrollLeft = x - width * 0.68;
        else if (x > left + width) scroll.scrollLeft = x - width * 0.5;
      }
    });
  }, [px]);

  const pointerPosition = useCallback(
    (clientX: number, clientY: number) => {
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const beat = Math.max(0, (clientX - rect.left) / px);
      const pad = clamp(Math.floor((clientY - rect.top) / rowHeight), 0, keyCount - 1);
      return { beat, pad, snapped: snap > 0 ? snapBeat(beat, snap) : beat, x: clientX - rect.left, y: clientY - rect.top };
    },
    [px, keyCount, rowHeight, snap],
  );

  const contentX = (clientX: number) => clientX + (scrollRef.current?.scrollLeft ?? 0);

  const hideGhost = () => {
    if (ghostRef.current) ghostRef.current.style.display = 'none';
    useViewStore.setState({ hover: null });
  };

  const onGridPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current) return;
    const position = pointerPosition(event.clientX, event.clientY);
    if (!position) return;
    useViewStore.setState({ hover: { beat: position.snapped, pad: position.pad } });
    const ghost = ghostRef.current;
    if (!ghost) return;
    const overNote = (event.target as HTMLElement).closest('.roll-note');
    if (editTool !== 'draw' || overNote || event.shiftKey) {
      ghost.style.display = 'none';
      return;
    }
    ghost.style.display = 'block';
    ghost.style.transform = `translate3d(${position.snapped * px}px, ${position.pad * rowHeight + (rowHeight - noteSize) / 2}px, 0)`;
    ghost.textContent = padNames[position.pad].short;
  };

  const startMarquee = (event: ReactPointerEvent<HTMLDivElement>, x: number, y: number) => {
    event.preventDefault();
    const state = useAppStore.getState();
    if (!event.shiftKey) state.clearSelection();
    dragRef.current = { kind: 'marquee', x1: x, y1: y, additive: event.shiftKey };
    setMarquee({ left: x, top: y, width: 0, height: 0 });
    setDragging(true);
  };

  const startMove = (event: ReactPointerEvent, note: Note) => {
    const state = useAppStore.getState();
    if (event.shiftKey || event.metaKey || event.ctrlKey) state.selectNotes([note.id], 'toggle');
    else if (!state.selectedNoteIds.includes(note.id)) state.selectNotes([note.id]);
    if (!useAppStore.getState().selectedNoteIds.includes(note.id)) return;
    useAppStore.getState().beginGesture();
    if (event.altKey) useAppStore.getState().cloneSelectionInPlace();
    const fresh = useAppStore.getState();
    const ids = new Set(fresh.selectedNoteIds);
    const originals: NoteOrigin = {};
    for (const item of fresh.activeTrack().notes) {
      if (ids.has(item.id)) originals[item.id] = { startBeat: item.startBeat, pad: item.pad };
    }
    void playback.previewPad(instrument.id, note.pad, note.velocity);
    lastPadRef.current = note.pad;
    dragRef.current = {
      kind: 'move',
      startX: contentX(event.clientX),
      startY: event.clientY,
      originals,
      anchor: { startBeat: note.startBeat, pad: note.pad },
    };
    setDragging(true);
  };

  const onGridPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    const noteElement = target.closest<HTMLElement>('[data-note-id]');
    const position = pointerPosition(event.clientX, event.clientY);
    if (!position) return;
    if (noteElement) {
      event.preventDefault();
      const note = activeTrack.notes.find((item) => item.id === noteElement.dataset.noteId);
      if (!note) return;
      if (target.closest('.note-resize')) {
        useAppStore.getState().selectNotes([note.id]);
        useAppStore.getState().beginGesture();
        dragRef.current = { kind: 'resize', startX: contentX(event.clientX), noteId: note.id, originalDuration: note.durationBeats };
        setDragging(true);
      } else {
        startMove(event, note);
      }
      return;
    }
    if ((editTool === 'draw' && !event.shiftKey) || event.altKey) {
      event.preventDefault();
      const duration = hold ? Math.max(1, snap || 0.5) : 0.5;
      const state = useAppStore.getState();
      state.beginGesture();
      const id = state.addNote(position.pad, position.snapped, duration, { history: false });
      if (!id) {
        state.endGesture();
        return;
      }
      void playback.previewPad(instrument.id, position.pad);
      hideGhost();
      const created = useAppStore.getState().activeTrack().notes.find((item) => item.id === id)!;
      lastPadRef.current = position.pad;
      // Dragging right after placing a held note sets its length; otherwise the note follows the pointer.
      dragRef.current = hold
        ? { kind: 'resize', startX: contentX(event.clientX), noteId: id, originalDuration: duration }
        : {
            kind: 'move',
            startX: contentX(event.clientX),
            startY: event.clientY,
            originals: { [id]: { startBeat: created.startBeat, pad: created.pad } },
            anchor: { startBeat: created.startBeat, pad: created.pad },
          };
      setDragging(true);
      return;
    }
    startMarquee(event, position.x, position.y);
  };

  const noteFromEvent = (event: ReactMouseEvent) =>
    (event.target as HTMLElement).closest<HTMLElement>('[data-note-id]')?.dataset.noteId;

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const noteId = noteFromEvent(event);
    if (noteId) {
      useAppStore.getState().deleteNotes([noteId]);
      return;
    }
    if (editTool === 'draw') return;
    const position = pointerPosition(event.clientX, event.clientY);
    if (!position) return;
    useAppStore.getState().addNote(position.pad, position.snapped, hold ? Math.max(1, snap || 0.5) : 0.5);
    void playback.previewPad(instrument.id, position.pad);
  };

  const onContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const noteId = noteFromEvent(event);
    if (noteId) useAppStore.getState().deleteNotes([noteId]);
  };

  useEffect(() => {
    if (!dragging) return;
    const edgeScroll = (clientX: number) => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      const rect = scroll.getBoundingClientRect();
      if (clientX > rect.right - EDGE_ZONE) scroll.scrollLeft += EDGE_SPEED;
      else if (clientX < rect.left + LABEL_WIDTH + EDGE_ZONE) scroll.scrollLeft -= EDGE_SPEED;
    };
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      edgeScroll(event.clientX);
      const store = useAppStore.getState();
      if (drag.kind === 'move') {
        const target = drag.anchor.startBeat + (contentX(event.clientX) - drag.startX) / px;
        // The grabbed note lands on the grid and the rest keep their spacing. Shift moves freely.
        const landed = snap > 0 && !event.shiftKey ? snapBeat(target, snap) : target;
        const deltaPad = Math.round((event.clientY - drag.startY) / rowHeight);
        store.dragSelectedNotes(drag.originals, landed - drag.anchor.startBeat, deltaPad);
        const pad = clamp(drag.anchor.pad + deltaPad, 0, keyCount - 1);
        useViewStore.setState({ hover: { beat: landed, pad } });
        if (pad !== lastPadRef.current) {
          lastPadRef.current = pad;
          void playback.previewPad(instrument.id, pad);
        }
      } else if (drag.kind === 'resize') {
        const raw = drag.originalDuration + (contentX(event.clientX) - drag.startX) / px;
        const next = snap > 0 ? Math.max(snap, Math.round(raw / snap) * snap) : Math.max(0.1, raw);
        store.resizeNote(drag.noteId, next);
      } else {
        const rect = gridRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = Math.max(0, event.clientX - rect.left);
        const y = clamp(event.clientY - rect.top, 0, rollHeight);
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
      const store = useAppStore.getState();
      if (drag?.kind === 'marquee') {
        setMarquee((box) => {
          if (box && (box.width > 3 || box.height > 3)) {
            const beatMin = box.left / px;
            const beatMax = (box.left + box.width) / px;
            const padMin = Math.floor(box.top / rowHeight);
            const padMax = Math.floor((box.top + box.height) / rowHeight);
            const reach = (note: Note) => (hold ? note.durationBeats : noteSize / px);
            const ids = store
              .activeTrack()
              .notes.filter(
                (note) =>
                  note.startBeat < beatMax &&
                  note.startBeat + reach(note) > beatMin &&
                  note.pad >= padMin &&
                  note.pad <= padMax,
              )
              .map((note) => note.id);
            store.selectNotes(ids, drag.additive ? 'add' : 'replace');
          }
          return null;
        });
      } else if (drag) {
        store.endGesture();
      }
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [dragging, px, rowHeight, rollHeight, snap, keyCount, instrument.id, hold, noteSize]);

  const selectTrack = (id: string) => {
    setMinimizedId(null);
    setActiveTrack(id);
  };

  const loopFromSelection = () => {
    const state = useAppStore.getState();
    const ids = new Set(state.selectedNoteIds);
    const selected = state.activeTrack().notes.filter((note) => ids.has(note.id));
    if (selected.length === 0) return;
    const startBeat = Math.floor(Math.min(...selected.map((note) => note.startBeat)));
    const endBeat = Math.max(startBeat + 1, Math.ceil(Math.max(...selected.map((note) => note.startBeat + note.durationBeats))));
    setLoop({ enabled: true, startBeat, endBeat });
  };

  const quantize = () => {
    if (snap <= 0) {
      useAppStore.getState().notify('Choose a snap value before quantizing.', 'warning');
      return;
    }
    useAppStore.getState().quantizeSelection(snap, preserveOriginal);
  };

  const grid = gridBackground(px, project.timeSignature, snap);
  const isGame = soundSourceInfo(instrument.id).kind === 'sample';

  const openRoll = (
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
        onPointerDown={onGridPointerDown}
        onPointerMove={onGridPointerMove}
        onPointerLeave={hideGhost}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
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
            position={formatBarBeat(note.startBeat, project.timeSignature)}
          />
        ))}
        <div ref={ghostRef} className="roll-ghost" style={{ width: noteSize, height: noteSize, lineHeight: `${noteSize}px` }} aria-hidden="true" />
        {marquee && <div className="marquee" style={marquee} aria-hidden="true" />}
        {activeTrack.notes.length === 0 && (
          <div className="roll-empty">
            <strong>{editTool === 'draw' ? 'Click a row to place a note' : 'Double-click to place a note'}</strong>
            <span>
              {hold ? `${instrument.displayName} holds notes: drag right while placing to set the length.` : `${instrument.displayName} plays one-shot notes that ring out on their own.`}
            </span>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <section className="timeline" aria-label="Song editor">
      <SelectionBar onLoop={loopFromSelection} onQuantize={quantize} />
      <div className="timeline-scroll" ref={scrollRef}>
        <div
          className="timeline-content"
          style={{ width: LABEL_WIDTH + totalBeats * px, ['--label-width' as string]: `${LABEL_WIDTH}px` }}
        >
          <div className="ruler-wrap">
            <div className="ruler-row">
              <div className="ruler-corner">Bars</div>
              <Ruler
                px={px}
                totalBeats={totalBeats}
                meter={project.timeSignature}
                snap={snap}
                windowStart={Math.max(0, windowStart - OVERSCAN)}
                windowEnd={windowStart + viewWidth + OVERSCAN + WINDOW_STEP}
              />
            </div>
            {project.loop.enabled && (
              <LoopLane totalBeats={totalBeats} px={px} loop={project.loop} meter={project.timeSignature} snap={snap} onChange={setLoop} />
            )}
          </div>

          <div className="timeline-body">
            {project.loop.enabled && (
              <div
                className="loop-band"
                style={{ left: LABEL_WIDTH + project.loop.startBeat * px, width: (project.loop.endBeat - project.loop.startBeat) * px }}
                aria-hidden="true"
              />
            )}
            {project.tracks.map((track) =>
              track.id === activeTrack.id && !minimized ? (
                <div key={track.id} className="track-active" style={{ ['--track-color' as string]: track.color }}>
                  <div className="track-active-head" style={{ height: ACTIVE_HEADER_HEIGHT }}>
                    <button
                      type="button"
                      className="instrument-pick"
                      data-track-id={track.id}
                      data-instrument-id={track.instrumentId}
                      onClick={() => onOpenCatalog({ mode: 'change', trackId: track.id })}
                      aria-label={`Change instrument for ${track.name}`}
                      title="Change instrument"
                    >
                      <InstrumentIcon instrumentId={track.instrumentId} size={22} />
                      <span>{track.name}</span>
                      <ChevronDownIcon size={13} />
                    </button>
                    <span className="track-facts">
                      <em className={`sound-source ${isGame ? 'is-game' : ''}`}>{isGame ? 'Game' : 'Synth'}</em>
                      <span>{hold ? 'Held notes' : 'One-shot'}</span>
                      <span>{track.notes.length} notes</span>
                    </span>
                    <TrackMixButtons track={track} />
                    <ActiveVolume trackId={track.id} volume={track.volume} name={track.name} />
                    <button
                      type="button"
                      className="track-minimize"
                      onClick={() => {
                        useAppStore.getState().clearSelection();
                        setMinimizedId(track.id);
                      }}
                      aria-label={`Minimize ${track.name}`}
                      title="Collapse to a lane"
                    >
                      <ChevronDownIcon size={15} />
                    </button>
                  </div>
                  {openRoll}
                </div>
              ) : (
                <TrackLane
                  key={track.id}
                  track={track}
                  px={px}
                  totalBeats={totalBeats}
                  silent={!isTrackAudible(project, track)}
                  onSelect={selectTrack}
                />
              ),
            )}
            <div className="add-track-row" style={{ height: ADD_ROW_HEIGHT }}>
              <button type="button" className="add-track-button" onClick={() => onOpenCatalog({ mode: 'add' })}>
                <PlusIcon size={15} />
                <span>Add instrument</span>
              </button>
            </div>
            <PlayheadLine px={px} />
          </div>
        </div>
      </div>
    </section>
  );
}
