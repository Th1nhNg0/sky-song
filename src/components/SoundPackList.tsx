import type { ChangeEvent } from 'react';
import { packBytes, type SoundPack } from '../audio/soundPack';
import { plural } from '../util';

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** The saved packs for one instrument, with the controls to switch, back up and delete them. */
export function SoundPackList({
  packs,
  instrumentName,
  busy,
  onImport,
  onActivate,
  onExport,
  onDelete,
}: {
  packs: SoundPack[];
  instrumentName: string;
  busy: boolean;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onActivate: (pack: SoundPack, enabled: boolean) => void;
  onExport: (pack: SoundPack) => void;
  onDelete: (pack: SoundPack) => void;
}) {
  return (
    <div className="sounds-block">
      <div className="sounds-block-head">
        <h4>Your packs for {instrumentName}</h4>
        <label className="mini-btn sounds-file-button">
          Import pack files
          <input type="file" accept="application/json,.json" multiple onChange={onImport} hidden />
        </label>
      </div>
      {packs.length === 0 ? (
        <p className="fine-print">No packs yet. Record a scale from your own game, or load one file per note below.</p>
      ) : (
        <ul className="sounds-pack-list">
          {packs.map((pack) => (
            <li key={pack.id} className="sounds-pack-row">
              <div className="sounds-pack-info">
                <strong>{pack.name}</strong>
                <span>
                  {pack.samples.length} sample{plural(pack.samples.length)} ·{' '}
                  {formatMb(packBytes(pack))} ·{' '}
                  {pack.samples.some((sample) => sample.midi !== null) ? 'pitched' : 'pad-mapped'} · updated{' '}
                  {new Date(pack.updatedAt).toLocaleDateString()}
                </span>
              </div>
              <label className="toggle-row sounds-pack-active">
                <input
                  type="checkbox"
                  checked={pack.enabled}
                  onChange={(event) => onActivate(pack, event.target.checked)}
                  disabled={busy}
                />
                <span>{pack.enabled ? 'Active' : 'Use'}</span>
              </label>
              <button type="button" className="mini-btn" onClick={() => onExport(pack)}>
                Export
              </button>
              <button type="button" className="mini-btn danger" onClick={() => onDelete(pack)} disabled={busy}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface PadMapEntry {
  pad: number;
  name: string;
  /** Note of the recording this pad plays; null when the pack has none for it. */
  sampleMidi: number | null;
  /** Semitones the recording is shifted by to reach the pad's note. */
  shift: number | null;
}

/** Which recording each pad of a pitched instrument plays, and how far it is shifted. */
export function SoundPadMap({
  instrumentName,
  entries,
  onPreview,
}: {
  instrumentName: string;
  entries: PadMapEntry[];
  onPreview: (pad: number) => void;
}) {
  return (
    <div className="sounds-block">
      <h4>How the recorded notes map to {instrumentName} pads</h4>
      <p className="fine-print">
        Pads whose note matches a recording play it unchanged. Other pads pitch-shift the nearest recording. Large
        shifts (more than a few semitones) change the character; record more notes for a closer match.
      </p>
      <div className="sounds-map-grid">
        {entries.map((entry) => (
          <button
            key={entry.pad}
            type="button"
            className="sounds-map-cell"
            onClick={() => onPreview(entry.pad)}
            title={`Pad ${entry.pad + 1}: ${entry.name}`}
          >
            <strong>{entry.name}</strong>
            <span>
              {entry.sampleMidi === null
                ? 'no sample'
                : entry.shift === 0
                  ? 'exact recording'
                  : `shift ${entry.shift && entry.shift > 0 ? '+' : ''}${entry.shift} semitones`}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
