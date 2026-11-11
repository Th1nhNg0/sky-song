import { useEffect } from 'react';
import { firstNoteAt } from '../music/grid';
import { getInstrument } from '../music/instruments';
import { isTonicDegree } from '../music/keys';
import { padKey } from '../music/padKeys';
import { resolvePad } from '../music/pitch';
import { useClockStore } from '../state/clock';
import { useTouch } from '../state/layout';
import { pressPad } from '../state/padInput';
import { useAppStore } from '../state/store';
import { RecordIcon } from './Icons';

/** Lights the pads and row labels of the open track as the playhead reaches each note. */
function useNoteFlash() {
  useEffect(() => {
    let previous = 0;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return useClockStore.subscribe((clock) => {
      const state = useAppStore.getState();
      const beat = clock.playhead;
      if (!state.isPlaying || beat < previous || beat - previous > 1) {
        previous = beat;
        return;
      }
      const track = state.activeTrack();
      const color = track.color;
      for (let index = firstNoteAt(track.notes, previous); index < track.notes.length; index++) {
        const note = track.notes[index];
        if (note.startBeat >= beat) break;
        for (const element of document.querySelectorAll<HTMLElement>(`[data-pad="${note.pad}"]`)) {
          element.animate(
            [{ backgroundColor: color, color: '#17131f', transform: calm ? 'none' : 'scale(0.96)' }, {}],
            { duration: calm ? 120 : 340, easing: 'ease-out' },
          );
        }
      }
      previous = beat;
    });
  }, []);
}

export function NoteFlash() {
  useNoteFlash();
  return null;
}

export function KeyPanel() {
  const track = useAppStore((state) => state.activeTrack());
  const projectKey = useAppStore((state) => state.project.key);
  const stepInput = useAppStore((state) => state.preferences.stepInput);
  const setPreferences = useAppStore((state) => state.setPreferences);
  const instrument = getInstrument(track.instrumentId);
  const { rows, cols } = instrument.padLayout;
  const touch = useTouch();

  return (
    <aside className="key-panel" aria-label={`${instrument.displayName} keys`} style={{ ['--track-color' as string]: track.color }}>
      <div className="key-panel-head">
        <div>
          <strong>{instrument.displayName}</strong>
          <span>{instrument.keyCount} keys</span>
        </div>
        <button
          type="button"
          className={`step-toggle ${stepInput ? 'is-on' : ''}`}
          onClick={() => setPreferences({ stepInput: !stepInput })}
          aria-pressed={stepInput}
          title="Write each key you press at the cursor (I)"
        >
          <RecordIcon size={11} />
          <span>Step input</span>
        </button>
      </div>
      <div className="key-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
        {instrument.pads.map((pad) => {
          const resolved = resolvePad(instrument, projectKey, pad.index);
          const key = padKey(instrument, pad.index);
          const tonic = isTonicDegree(pad.degree);
          return (
            <button
              type="button"
              key={pad.index}
              data-pad={pad.index}
              className={`key-pad ${tonic ? 'is-tonic' : ''}`}
              style={{ gridRow: pad.row + 1, gridColumn: pad.col + 1 }}
              onPointerDown={(event) => {
                event.preventDefault();
                pressPad(pad.index);
              }}
              aria-label={`Pad ${pad.index + 1}, ${resolved.noteName ?? resolved.label}`}
            >
              <span className="key-pad-name">{resolved.pitched ? resolved.noteName?.replace(/\d/, '') : resolved.label}</span>
              {key && <kbd>{key}</kbd>}
            </button>
          );
        })}
      </div>
      <p className="key-panel-hint">
        {stepInput
          ? 'Each key writes a note at the cursor and moves on by the snap value. While playing, keys record at the playhead.'
          : `${touch ? 'Tap the keys' : 'Press the letters'} to play along. Turn on step input to write what you play.`}
      </p>
      <dl className="hint-list">
        <div><dt><kbd>Space</kbd></dt><dd>Play or pause</dd></div>
        <div><dt><kbd>1</kbd> <kbd>2</kbd></dt><dd>Add or Edit tool</dd></div>
        <div><dt><kbd>Alt</kbd> drag</dt><dd>Copy notes</dd></div>
        <div><dt>Right-click</dt><dd>Delete a note</dd></div>
        <div><dt><kbd>Ctrl</kbd> wheel</dt><dd>Zoom</dd></div>
        <div><dt><kbd>?</kbd></dt><dd>All shortcuts</dd></div>
      </dl>
    </aside>
  );
}
