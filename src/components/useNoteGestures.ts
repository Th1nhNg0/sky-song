import { useEffect, useRef, useState, type RefObject } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { snapBeat } from '../music/time';
import type { Note } from '../music/types';
import { useViewStore } from '../state/clock';
import { labelWidth } from '../state/layout';
import { playback } from '../state/playback';
import { useAppStore } from '../state/store';
import type { EditTool } from '../state/storeTypes';
import { clamp } from '../util';

type NoteOrigin = Record<string, { startBeat: number; pad: number }>;

export type DragState =
  | {
      kind: 'move';
      startX: number;
      startY: number;
      originals: NoteOrigin;
      anchor: { startBeat: number; pad: number };
      /** Set for a finger on a note: it is a tap on that note until it travels. */
      tap?: { noteId: string; clientX: number; clientY: number };
    }
  | { kind: 'resize'; startX: number; noteId: string; originalDuration: number }
  | { kind: 'marquee'; x1: number; y1: number; additive: boolean };

const EDGE_ZONE = 44;
const EDGE_SPEED = 16;
/** How far a finger may wander and still be a tap. */
const TAP_SLOP = 10;
const LONG_PRESS_MS = 420;

type Box = { left: number; top: number; width: number; height: number };
type GridPosition = { beat: number; pad: number; snapped: number; x: number; y: number };

/** A finger that is down on the grid and has not yet become a tap, a long press or a scroll. */
interface PendingTouch {
  pointerId: number;
  clientX: number;
  clientY: number;
  position: GridPosition;
  noteId: string | null;
  timer: number;
  /** The long press fired, so lifting the finger is not a tap. */
  held: boolean;
}

/** A finger or a pen: the grid scrolls under it, so its gestures differ from a mouse's. */
const isTouch = (event: { pointerType: string }) => event.pointerType !== 'mouse';

/** A pointer's x position within the scrolled timeline content. */
function contentX(scrollRef: RefObject<HTMLDivElement | null>, clientX: number): number {
  return clientX + (scrollRef.current?.scrollLeft ?? 0);
}

interface NoteGestureOptions {
  gridRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  /** The gesture under way, shared so the timeline does not scroll beneath it. */
  dragRef: RefObject<DragState | null>;
  /** Notes of the open track. */
  notes: Note[];
  instrumentId: string;
  hold: boolean;
  keyCount: number;
  px: number;
  snap: number;
  editTool: EditTool;
  rowHeight: number;
  rollHeight: number;
  noteSize: number;
  padNames: ReadonlyArray<{ short: string }>;
}

/**
 * Pointer editing on the note grid: placing a note, dragging notes to move or copy them,
 * stretching a held note, and box-selecting. Each drag is one undo step.
 */
export function useNoteGestures({
  gridRef,
  scrollRef,
  dragRef,
  notes,
  instrumentId,
  hold,
  keyCount,
  px,
  snap,
  editTool,
  rowHeight,
  rollHeight,
  noteSize,
  padNames,
}: NoteGestureOptions) {
  const [dragging, setDragging] = useState(false);
  const [marquee, setMarqueeState] = useState<Box | null>(null);
  // The box as last drawn, for the moment the pointer lifts: state may not have caught up.
  const marqueeRef = useRef<Box | null>(null);
  const setMarquee = (box: Box | null) => {
    marqueeRef.current = box;
    setMarqueeState(box);
  };
  const ghostRef = useRef<HTMLDivElement>(null);
  const lastPadRef = useRef<number | null>(null);
  const touchRef = useRef<PendingTouch | null>(null);
  const lastPointerRef = useRef('mouse');

  const pointerPosition = (clientX: number, clientY: number): GridPosition | null => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const beat = Math.max(0, (clientX - rect.left) / px);
    const pad = clamp(Math.floor((clientY - rect.top) / rowHeight), 0, keyCount - 1);
    return { beat, pad, snapped: snap > 0 ? snapBeat(beat, snap) : beat, x: clientX - rect.left, y: clientY - rect.top };
  };

  const hideGhost = () => {
    if (ghostRef.current) ghostRef.current.style.display = 'none';
    useViewStore.setState({ hover: null });
  };

  const onGridPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isTouch(event)) {
      const pending = touchRef.current;
      const strayed =
        pending && Math.hypot(event.clientX - pending.clientX, event.clientY - pending.clientY) > TAP_SLOP;
      if (strayed && !pending.held) cancelTouch();
      return;
    }
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

  const cancelTouch = () => {
    if (touchRef.current) window.clearTimeout(touchRef.current.timer);
    touchRef.current = null;
  };

  const placeNote = (position: GridPosition, history: boolean) => {
    const duration = hold ? Math.max(1, snap || 0.5) : 0.5;
    const id = useAppStore.getState().addNote(position.pad, position.snapped, duration, { history });
    if (id) void playback.previewPad(instrumentId, position.pad);
    return id ? { id, duration } : null;
  };

  /**
   * Touch and pen. A drag scrolls the timeline, so the grid acts on taps: a tap places a
   * note or selects one, a selected note can be dragged, and a long press adds a note to
   * the selection or, on empty grid, starts a box.
   */
  const onTouchDown = (event: ReactPointerEvent<HTMLDivElement>, position: GridPosition, note: Note | null, target: HTMLElement) => {
    if (dragRef.current) return;
    if (touchRef.current) {
      // A second finger: this is a pinch, not a tap.
      cancelTouch();
      return;
    }
    const state = useAppStore.getState();
    if (note && state.selectedNoteIds.includes(note.id)) {
      // Selected notes do not scroll, so the finger has them from the start.
      if (hold && target.closest('.note-resize')) startResize(event, note);
      else startMove(event, note, true);
      return;
    }
    const pending: PendingTouch = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      position,
      noteId: note?.id ?? null,
      held: false,
      timer: window.setTimeout(() => {
        pending.held = true;
        navigator.vibrate?.(10);
        if (pending.noteId) {
          useAppStore.getState().selectNotes([pending.noteId], 'toggle');
          return;
        }
        dragRef.current = { kind: 'marquee', x1: position.x, y1: position.y, additive: true };
        setMarquee({ left: position.x, top: position.y, width: 0, height: 0 });
        setDragging(true);
      }, LONG_PRESS_MS),
    };
    touchRef.current = pending;
  };

  const onGridPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pending = touchRef.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    cancelTouch();
    if (pending.held) return;
    const state = useAppStore.getState();
    if (pending.noteId) state.selectNotes([pending.noteId]);
    else if (editTool === 'draw') placeNote(pending.position, true);
    else state.clearSelection();
  };

  const startResize = (event: ReactPointerEvent, note: Note) => {
    useAppStore.getState().selectNotes([note.id]);
    useAppStore.getState().beginGesture();
    dragRef.current = { kind: 'resize', startX: contentX(scrollRef, event.clientX), noteId: note.id, originalDuration: note.durationBeats };
    setDragging(true);
  };

  const startMove = (event: ReactPointerEvent, note: Note, byTouch = false) => {
    const state = useAppStore.getState();
    if (byTouch) {
      // The tap that selects a note is handled when the finger lifts.
    } else if (event.shiftKey || event.metaKey || event.ctrlKey) state.selectNotes([note.id], 'toggle');
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
    void playback.previewPad(instrumentId, note.pad, note.velocity);
    lastPadRef.current = note.pad;
    dragRef.current = {
      kind: 'move',
      startX: contentX(scrollRef, event.clientX),
      startY: event.clientY,
      originals,
      anchor: { startBeat: note.startBeat, pad: note.pad },
      tap: byTouch ? { noteId: note.id, clientX: event.clientX, clientY: event.clientY } : undefined,
    };
    setDragging(true);
  };

  const onGridPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    lastPointerRef.current = event.pointerType;
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    const noteElement = target.closest<HTMLElement>('[data-note-id]');
    const position = pointerPosition(event.clientX, event.clientY);
    if (!position) return;
    if (isTouch(event)) {
      const touched = noteElement ? notes.find((item) => item.id === noteElement.dataset.noteId) : null;
      onTouchDown(event, position, touched ?? null, target);
      return;
    }
    if (noteElement) {
      event.preventDefault();
      const note = notes.find((item) => item.id === noteElement.dataset.noteId);
      if (!note) return;
      if (target.closest('.note-resize')) startResize(event, note);
      else startMove(event, note);
      return;
    }
    if ((editTool === 'draw' && !event.shiftKey) || event.altKey) {
      event.preventDefault();
      const state = useAppStore.getState();
      state.beginGesture();
      const placed = placeNote(position, false);
      if (!placed) {
        state.endGesture();
        return;
      }
      const { id, duration } = placed;
      hideGhost();
      const created = useAppStore.getState().activeTrack().notes.find((item) => item.id === id)!;
      lastPadRef.current = position.pad;
      // Dragging right after placing a held note sets its length; otherwise the note follows the pointer.
      dragRef.current = hold
        ? { kind: 'resize', startX: contentX(scrollRef, event.clientX), noteId: id, originalDuration: duration }
        : {
            kind: 'move',
            startX: contentX(scrollRef, event.clientX),
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
    void playback.previewPad(instrumentId, position.pad);
  };

  const onContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    // A phone raises this for a long press, which selects here rather than deletes.
    if (lastPointerRef.current !== 'mouse') return;
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
      else if (clientX < rect.left + labelWidth() + EDGE_ZONE) scroll.scrollLeft -= EDGE_SPEED;
    };
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      edgeScroll(event.clientX);
      const store = useAppStore.getState();
      if (drag.kind === 'move') {
        if (drag.tap) {
          if (Math.hypot(event.clientX - drag.tap.clientX, event.clientY - drag.tap.clientY) <= TAP_SLOP) return;
          drag.tap = undefined;
        }
        const target = drag.anchor.startBeat + (contentX(scrollRef, event.clientX) - drag.startX) / px;
        // The grabbed note lands on the grid and the rest keep their spacing. Shift moves freely.
        const landed = snap > 0 && !event.shiftKey ? snapBeat(target, snap) : target;
        const deltaPad = Math.round((event.clientY - drag.startY) / rowHeight);
        store.dragSelectedNotes(drag.originals, landed - drag.anchor.startBeat, deltaPad);
        const pad = clamp(drag.anchor.pad + deltaPad, 0, keyCount - 1);
        useViewStore.setState({ hover: { beat: landed, pad } });
        if (pad !== lastPadRef.current) {
          lastPadRef.current = pad;
          void playback.previewPad(instrumentId, pad);
        }
      } else if (drag.kind === 'resize') {
        const raw = drag.originalDuration + (contentX(scrollRef, event.clientX) - drag.startX) / px;
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
        const box = marqueeRef.current;
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
        setMarquee(null);
      } else if (drag) {
        store.endGesture();
        // A finger that came down on a selected note and went nowhere: tapping the only
        // selected note lets it go, tapping one of several keeps just that one.
        if (drag.kind === 'move' && drag.tap) {
          if (store.selectedNoteIds.length === 1) store.clearSelection();
          else store.selectNotes([drag.tap.noteId]);
        }
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
  }, [dragging, px, rowHeight, rollHeight, snap, keyCount, instrumentId, hold, noteSize, dragRef, gridRef, scrollRef]);

  // Once a finger holds a note or a box, the timeline must not scroll under it.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const keepStill = (event: TouchEvent) => {
      if (dragRef.current && event.cancelable) event.preventDefault();
    };
    grid.addEventListener('touchmove', keepStill, { passive: false });
    return () => grid.removeEventListener('touchmove', keepStill);
  }, [gridRef, dragRef]);

  useEffect(() => () => window.clearTimeout(touchRef.current?.timer), []);

  return {
    ghostRef,
    marquee,
    gridHandlers: {
      onPointerDown: onGridPointerDown,
      onPointerMove: onGridPointerMove,
      onPointerUp: onGridPointerUp,
      onPointerCancel: cancelTouch,
      onPointerLeave: hideGhost,
      onDoubleClick,
      onContextMenu,
    },
  };
}
