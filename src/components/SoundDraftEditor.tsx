import type { PackSample } from '../audio/soundPack';
import { getKey, midiToSpelledName } from '../music/keys';
import type { InstrumentDefinition } from '../music/types';
import { clamp, plural } from '../util';

function midiLabel(midi: number | null, keyIndex: number): string {
  if (midi === null) return '—';
  return midiToSpelledName(midi, getKey(keyIndex));
}

export function formatSeconds(value: number): string {
  return `${value.toFixed(2)} s`;
}

/**
 * The samples prepared from a recording, before they are saved as a pack: each one's note
 * (or pad, for percussion) can be corrected and heard, and the pack is named and saved.
 */
export function SoundDraftEditor({
  draft,
  instrument,
  keyIndex,
  name,
  busy,
  onRename,
  onUpdate,
  onShift,
  onPreview,
  onSave,
}: {
  draft: PackSample[];
  instrument: InstrumentDefinition;
  keyIndex: number;
  name: string;
  busy: boolean;
  onRename: (name: string) => void;
  onUpdate: (index: number, patch: Partial<PackSample>) => void;
  onShift: (index: number, delta: number) => void;
  onPreview: (sample: PackSample) => void;
  onSave: () => void;
}) {
  const pitched = instrument.renderingMode === 'pitched';
  return (
    <div className="sounds-draft">
      <div className="sounds-block-head">
        <h4>{draft.length} prepared sample{plural(draft.length)}</h4>
        <span className="mini-chip">{pitched ? 'auto-detected MIDI, editable' : 'assign to pads'}</span>
      </div>
      <div className="sounds-rows">
        {draft.map((sample, index) => (
          <div className="sounds-row" key={sample.id}>
            <span className="sounds-row-index">{index + 1}</span>
            <span className="sounds-row-time">
              {formatSeconds(sample.sourceStartSeconds)} · {formatSeconds(sample.durationSeconds)}
            </span>
            {pitched ? (
              <div className="sounds-note">
                <button type="button" className="mini-btn" onClick={() => onShift(index, -1)} aria-label="One semitone lower">
                  −
                </button>
                <input
                  type="number"
                  className="input sounds-midi-input"
                  min={0}
                  max={127}
                  value={sample.midi ?? ''}
                  onChange={(event) => {
                    const value = event.target.value === '' ? null : Number(event.target.value);
                    onUpdate(index, { midi: value === null ? null : clamp(Math.round(value), 0, 127) });
                  }}
                  aria-label={`Note for sample ${index + 1}`}
                />
                <span className="sounds-note-name">{midiLabel(sample.midi, keyIndex)}</span>
                <button type="button" className="mini-btn" onClick={() => onShift(index, 1)} aria-label="One semitone higher">
                  +
                </button>
                <span className="mini-chip">
                  detected {midiLabel(sample.detectedMidi, keyIndex)} · {Math.round(sample.confidence * 100)}%
                </span>
              </div>
            ) : (
              <select
                className="input select sounds-pad-select"
                value={sample.padIndex ?? ''}
                onChange={(event) =>
                  onUpdate(index, {
                    padIndex: event.target.value === '' ? null : Number(event.target.value),
                  })
                }
                aria-label={`Pad for sample ${index + 1}`}
              >
                <option value="">Unassigned</option>
                {instrument.pads.map((pad) => (
                  <option key={pad.index} value={pad.index}>
                    Pad {pad.index + 1} · {pad.label ?? 'percussion'}
                  </option>
                ))}
              </select>
            )}
            <button type="button" className="mini-btn" onClick={() => onPreview(sample)}>
              ▶ Preview
            </button>
          </div>
        ))}
      </div>

      <div className="sounds-save-row">
        <label className="field sounds-name-field">
          <span className="field-label">Pack name</span>
          <input
            className="input"
            value={name}
            placeholder={`${instrument.displayName} recording`}
            onChange={(event) => onRename(event.target.value)}
            maxLength={80}
          />
        </label>
        <button type="button" className="btn primary" onClick={onSave} disabled={busy || draft.length === 0}>
          Save pack in this browser
        </button>
      </div>
    </div>
  );
}
