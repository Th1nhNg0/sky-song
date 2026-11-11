import { getInstrument } from '../music/instruments';
import { padForKey } from '../music/padKeys';
import { lastNoteEnd } from '../music/project';
import { beatsPerMeasure } from '../music/time';
import { useViewStore } from './clock';
import { pressPad } from './padInput';
import { playback } from './playback';
import { useAppStore } from './store';

function isEditableTarget(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  // A focused slider only needs its arrow keys; everything else stays a shortcut.
  if (target instanceof HTMLInputElement && (target.type === 'range' || target.type === 'checkbox')) {
    return event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End';
  }
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

/** Pastes the clipboard at the cursor and moves the cursor past what was pasted. */
export function pasteAtCursor(): void {
  const end = useAppStore.getState().pasteClipboard(playback.position());
  if (end !== null) playback.seek(end);
}

function withModifier(event: KeyboardEvent, lower: string): boolean {
  const state = useAppStore.getState();
  const actions: Record<string, () => void> = {
    z: () => (event.shiftKey ? state.redo() : state.undo()),
    y: state.redo,
    a: state.selectAllNotes,
    c: state.copySelection,
    x: state.cutSelection,
    d: state.duplicateSelection,
    v: pasteAtCursor,
  };
  actions[lower]?.();
  return lower in actions;
}

function arrow(event: KeyboardEvent): void {
  const state = useAppStore.getState();
  const step = event.shiftKey ? beatsPerMeasure(state.project.timeSignature) : state.preferences.snap || 0.25;
  const horizontal = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
  const vertical = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
  if (state.selectedNoteIds.length > 0) state.nudgeSelection(horizontal, vertical);
  else if (horizontal !== 0) playback.seek(Math.max(0, playback.position() + horizontal));
}

/** Every keyboard shortcut in one place. Letters play the keys while the key panel is showing. */
export function handleShortcut(event: KeyboardEvent): void {
  if (event.defaultPrevented || isEditableTarget(event)) return;
  const state = useAppStore.getState();
  const { key } = event;
  const lower = key.toLowerCase();

  if (key === 'Escape') {
    if (state.panel) state.setPanel(null);
    else if (state.welcomeOpen) state.finishOnboarding();
    else state.clearSelection();
    return;
  }
  if (state.welcomeOpen || state.panel) return;

  if (event.ctrlKey || event.metaKey) {
    if (withModifier(event, lower)) event.preventDefault();
    return;
  }

  if (state.preferences.keysOpen && !event.altKey) {
    const pad = padForKey(getInstrument(state.activeTrack().instrumentId), key);
    if (pad !== null) {
      event.preventDefault();
      if (!event.repeat) pressPad(pad);
      return;
    }
  }

  const navigation = useViewStore.getState().navigation;
  const actions: Record<string, () => void> = {
    ' ': () => (event.shiftKey ? playback.stop() : void playback.togglePlay()),
    delete: state.deleteSelectedNotes,
    backspace: state.deleteSelectedNotes,
    arrowleft: () => arrow(event),
    arrowright: () => arrow(event),
    arrowup: () => arrow(event),
    arrowdown: () => arrow(event),
    home: () => playback.seek(0),
    end: () => playback.seek(lastNoteEnd(useAppStore.getState().project)),
    1: () => state.setEditTool('draw'),
    2: () => state.setEditTool('select'),
    k: () => state.setPreferences({ keysOpen: !state.preferences.keysOpen }),
    i: () => state.setPreferences({ stepInput: !state.preferences.stepInput }),
    l: state.toggleLoop,
    m: () => state.setPreferences({ metronomeEnabled: !state.preferences.metronomeEnabled }),
    q: () => {
      if (state.preferences.snap > 0) state.quantizeSelection(state.preferences.snap, state.preferences.preserveOriginalTiming);
    },
    '+': () => navigation?.zoomTo(state.preferences.zoom * 1.3),
    '=': () => navigation?.zoomTo(state.preferences.zoom * 1.3),
    '-': () => navigation?.zoomTo(state.preferences.zoom / 1.3),
    0: () => navigation?.zoomToFit(),
    '?': () => state.setPanel('help'),
  };
  const action = actions[lower];
  if (action) {
    event.preventDefault();
    action();
  }
}
