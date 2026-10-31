import { useEffect, useState } from 'react';
import { useAppStore } from '../state/store';
import { playback } from '../state/playback';
import { useClockStore } from '../state/clock';
import { formatBarBeat } from '../music/time';
import {
  CursorIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RedoIcon,
  StopIcon,
  UndoIcon,
} from './Icons';

function TimeReadout() {
  const playhead = useClockStore((state) => state.playhead);
  const meter = useAppStore((state) => state.project.timeSignature);
  const bpm = useAppStore((state) => state.project.bpm);
  const seconds = (playhead * 60) / bpm;
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return (
    <div className="time-readout" data-testid="time-readout" aria-label="Playback position">
      <span className="clock">
        {minutes}:{secs.toString().padStart(2, '0')}
      </span>
      <span className="bar-beat">{formatBarBeat(playhead, meter)}</span>
    </div>
  );
}

export function TransportControls() {
  const isPlaying = useAppStore((state) => state.isPlaying);

  return (
    <div className="transport-primary">
      <button
        type="button"
        className={`play-button ${isPlaying ? 'is-playing' : ''}`}
        onClick={() => void playback.togglePlay()}
        aria-label={isPlaying ? 'Pause' : 'Play'}
        aria-pressed={isPlaying}
        title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        data-testid="transport-play"
      >
        {isPlaying ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
        <span>{isPlaying ? 'Pause' : 'Play'}</span>
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={() => playback.stop()}
        aria-label="Stop"
        title="Stop (Shift+Space)"
        data-testid="transport-stop"
      >
        <StopIcon size={16} />
      </button>
      <TimeReadout />
    </div>
  );
}

export function ToolSwitch() {
  const editTool = useAppStore((state) => state.editTool);
  const setEditTool = useAppStore((state) => state.setEditTool);

  return (
    <div className="tool-switch" role="group" aria-label="Note tool">
      <button
        type="button"
        className={editTool === 'draw' ? 'is-on' : ''}
        onClick={() => setEditTool('draw')}
        aria-pressed={editTool === 'draw'}
        title="Tap the grid to add notes"
        data-testid="draw-tool"
      >
        <PlusIcon size={16} />
        <span>Add note</span>
      </button>
      <button
        type="button"
        className={editTool === 'select' ? 'is-on' : ''}
        onClick={() => setEditTool('select')}
        aria-pressed={editTool === 'select'}
        title="Select and move notes"
        data-testid="select-tool"
      >
        <CursorIcon size={15} />
        <span>Edit</span>
      </button>
    </div>
  );
}

export function SongFields() {
  const project = useAppStore((state) => state.project);
  const setBpm = useAppStore((state) => state.setBpm);
  const [bpmDraft, setBpmDraft] = useState(String(project.bpm));

  useEffect(() => {
    setBpmDraft(String(project.bpm));
  }, [project.bpm]);

  const commitBpm = () => {
    const value = Number(bpmDraft);
    if (Number.isFinite(value)) setBpm(value);
    else setBpmDraft(String(project.bpm));
  };

  return (
    <div className="song-fields">
      <label className="inline-field">
        <span>BPM</span>
        <input
          className="bpm-input"
          type="number"
          min={40}
          max={240}
          step={1}
          value={bpmDraft}
          data-testid="bpm-input"
          onChange={(event) => setBpmDraft(event.target.value)}
          onBlur={commitBpm}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          aria-label="Tempo in beats per minute"
        />
      </label>
    </div>
  );
}

export function HistoryButtons() {
  const undo = useAppStore((state) => state.undo);
  const redo = useAppStore((state) => state.redo);
  const canUndo = useAppStore((state) => state.history.past.length > 0);
  const canRedo = useAppStore((state) => state.history.future.length > 0);

  return (
    <div className="history-buttons">
      <button
        type="button"
        className="icon-button"
        onClick={undo}
        disabled={!canUndo}
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        data-testid="undo"
      >
        <UndoIcon size={16} />
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={redo}
        disabled={!canRedo}
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        data-testid="redo"
      >
        <RedoIcon size={16} />
      </button>
    </div>
  );
}
