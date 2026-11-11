import { DEFAULT_VELOCITY } from '../music/project';
import { pasteAtCursor } from '../state/shortcuts';
import { useAppStore } from '../state/store';
import { CheckIcon, CopyIcon, DuplicateIcon, LoopIcon, PasteIcon, RecordIcon, TrashIcon } from './Icons';

function loopSelection(): void {
  const state = useAppStore.getState();
  const ids = new Set(state.selectedNoteIds);
  const selected = state.activeTrack().notes.filter((note) => ids.has(note.id));
  if (selected.length === 0) return;
  const startBeat = Math.floor(Math.min(...selected.map((note) => note.startBeat)));
  const endBeat = Math.max(startBeat + 1, Math.ceil(Math.max(...selected.map((note) => note.startBeat + note.durationBeats))));
  state.setLoop({ enabled: true, startBeat, endBeat });
}

function quantizeSelection(): void {
  const state = useAppStore.getState();
  const { snap, preserveOriginalTiming } = state.preferences;
  if (snap <= 0) {
    state.notify('Choose a snap value before quantizing.', 'warning');
    return;
  }
  state.quantizeSelection(snap, preserveOriginalTiming);
}

/** Actions for the selected notes, shown above the timeline while anything is selected. */
export function SelectionBar() {
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
          onClick={pasteAtCursor}
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
        <button type="button" onClick={quantizeSelection} title="Move to the grid (Q with keys hidden)">
          <CheckIcon size={15} /> <span>Quantize</span>
        </button>
        {hasOriginal && (
          <button type="button" onClick={state.restoreOriginalTiming} title="Back to the timing before quantizing">
            <RecordIcon size={13} /> <span>Restore</span>
          </button>
        )}
        <button type="button" onClick={loopSelection} title="Loop these notes">
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
