import { useState } from 'react';
import { clampBpm, MAX_BPM, MIN_BPM, TIME_SIGNATURES } from '../music/time';
import { timingOf } from '../music/timing';
import { playback } from '../state/playback';
import { useAppStore } from '../state/store';
import { Modal } from './Modal';
import { useCancellableEdit } from './useCancellableEdit';

function TempoInput({ bpm, label, onChange }: { bpm: number; label: string; onChange: (bpm: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const edit = useCancellableEdit(
    () => {
      const value = draft === null || draft.trim() === '' ? NaN : Number(draft);
      if (Number.isFinite(value) && clampBpm(value) !== bpm) onChange(clampBpm(value));
      setDraft(null);
    },
    () => setDraft(null),
  );
  return (
    <input
      className="timing-bpm"
      type="number"
      min={MIN_BPM}
      max={MAX_BPM}
      step={1}
      value={draft ?? String(bpm)}
      onChange={(event) => setDraft(event.target.value)}
      {...edit}
      aria-label={label}
    />
  );
}

function MeterSelect({
  meter,
  label,
  onChange,
}: {
  meter: [number, number];
  label: string;
  onChange: (meter: [number, number]) => void;
}) {
  return (
    <select
      value={meter.join('/')}
      onChange={(event) => {
        const [numerator, denominator] = event.target.value.split('/').map(Number);
        onChange([numerator, denominator]);
      }}
      aria-label={label}
    >
      {TIME_SIGNATURES.map((option) => (
        <option key={option.label} value={option.label}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** Where the song changes tempo or meter: one row per change, each saying what holds from there on. */
export function TimingPanel({ onClose }: { onClose: () => void }) {
  const project = useAppStore((state) => state.project);
  const setTimingChange = useAppStore((state) => state.setTimingChange);
  const removeTimingChange = useAppStore((state) => state.removeTimingChange);
  const timing = timingOf(project);
  const rows = [{ beat: 0 }, ...timing.points];
  // A new change starts at the bar the cursor is in, or the next one if that bar is taken.
  const [bar, setBar] = useState(() => {
    let next = timing.barAt(playback.position()).bar + 1;
    while (rows.some((row) => Math.abs(row.beat - timing.barStart(next - 1)) < 1e-6)) next++;
    return next;
  });
  const barBeat = timing.barStart(Math.max(1, bar) - 1);
  const [bpm, setBpm] = useState(() => timing.bpmAt(barBeat));
  const [meter, setMeter] = useState<[number, number]>(() => timing.meterAt(barBeat));
  const taken = rows.some((row) => Math.abs(row.beat - barBeat) < 1e-6);
  const changesNothing =
    bpm === timing.bpmAt(barBeat) && meter.join('/') === timing.meterAt(barBeat).join('/');

  const add = () => {
    setTimingChange(barBeat, { bpm, timeSignature: meter });
    setBar(bar + 1);
  };

  return (
    <Modal title="Tempo and meter changes" eyebrow="Song" size="small" onClose={onClose}>
      <p className="fine-print">
        Each row sets the tempo and meter from that bar on. A meter can only change on a bar line.
      </p>
      <table className="timing-table">
        <thead>
          <tr>
            <th scope="col">From</th>
            <th scope="col">BPM</th>
            <th scope="col">Meter</th>
            <th scope="col">
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const position = timing.barAt(row.beat);
            const where = row.beat === 0 ? 'Start' : position.beat < 1e-6 ? `Bar ${position.bar + 1}` : `Bar ${timing.format(row.beat)}`;
            return (
              <tr key={row.beat} data-beat={row.beat}>
                <th scope="row">{where}</th>
                <td>
                  <TempoInput
                    key={timing.bpmAt(row.beat)}
                    bpm={timing.bpmAt(row.beat)}
                    label={`Tempo from ${where}`}
                    onChange={(value) => setTimingChange(row.beat, { bpm: value })}
                  />
                </td>
                <td>
                  {position.beat < 1e-6 ? (
                    <MeterSelect
                      meter={timing.meterAt(row.beat)}
                      label={`Meter from ${where}`}
                      onChange={(value) => setTimingChange(row.beat, { timeSignature: value })}
                    />
                  ) : (
                    timing.meterAt(row.beat).join('/')
                  )}
                </td>
                <td>
                  {row.beat > 0 && (
                    <button type="button" className="btn small" onClick={() => removeTimingChange(row.beat)} aria-label={`Remove the change at ${where}`}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="timing-add">
        <label>
          <span>From bar</span>
          <input
            className="timing-bar"
            type="number"
            min={2}
            step={1}
            value={bar}
            onChange={(event) => {
              const value = Math.max(1, Math.floor(Number(event.target.value) || 1));
              const beat = timing.barStart(value - 1);
              setBar(value);
              setBpm(timing.bpmAt(beat));
              setMeter(timing.meterAt(beat));
            }}
            aria-label="Bar where the new change starts"
          />
        </label>
        <label>
          <span>BPM</span>
          <input
            className="timing-bpm"
            type="number"
            min={MIN_BPM}
            max={MAX_BPM}
            step={1}
            value={bpm}
            onChange={(event) => setBpm(Number(event.target.value))}
            onBlur={() => setBpm(Number.isFinite(bpm) && bpm > 0 ? clampBpm(bpm) : timing.bpmAt(barBeat))}
            aria-label="Tempo of the new change"
          />
        </label>
        <label>
          <span>Meter</span>
          <MeterSelect meter={meter} label="Meter of the new change" onChange={setMeter} />
        </label>
        <button type="button" className="btn primary" onClick={add} disabled={bar < 2 || taken || changesNothing || !(bpm >= MIN_BPM && bpm <= MAX_BPM)}>
          Add change
        </button>
      </div>
      {bar >= 2 && taken && <p className="fine-print">Bar {bar} already has a change. Edit its row above.</p>}
      {bar >= 2 && !taken && changesNothing && (
        <p className="fine-print">Choose a tempo or meter different from the one already playing at bar {bar}.</p>
      )}
    </Modal>
  );
}
