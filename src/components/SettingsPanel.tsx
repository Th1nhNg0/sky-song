import { useAppStore } from '../state/store';
import { playback } from '../state/playback';
import { useAudioStore } from '../state/clock';
import { Modal } from './Modal';
import { SparkIcon } from './Icons';
import { SoundsPanel } from './SoundsPanel';

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const preferences = useAppStore((state) => state.preferences);
  const setPreferences = useAppStore((state) => state.setPreferences);
  const audioStatus = useAudioStore((state) => state.status);
  const audioMessage = useAudioStore((state) => state.message);

  return (
    <Modal title="Settings" eyebrow="Audio, playback and project defaults" onClose={onClose} size="large" testId="settings-panel">
      <div className="settings-grid">
        <section className="settings-card">
          <h3>Audio engine</h3>
          <p className="settings-note">Web Audio requires a gesture before it can start. The app never autoplays.</p>
          <div className={`audio-state ${audioStatus}`}>
            <SparkIcon size={17} />
            <span>
              {audioStatus === 'ready'
                ? 'Audio context is running.'
                : audioStatus === 'starting'
                  ? 'Starting audio…'
                  : audioStatus === 'error'
                    ? audioMessage ?? 'Audio could not start.'
                    : 'Audio is locked until you tap Enable.'}
            </span>
          </div>
          <button type="button" className="btn primary" onClick={() => void playback.enableAudio()}>
            Enable / test audio
          </button>
          <label className="slider-field">
            <div><span>Master volume</span><strong>{Math.round(preferences.masterVolume * 100)}%</strong></div>
            <input type="range" min={0} max={1} step={0.01} value={preferences.masterVolume} onChange={(event) => setPreferences({ masterVolume: Number(event.target.value) })} />
          </label>
          <label className="slider-field">
            <div><span>Reverb (synthetic)</span><strong>{Math.round(preferences.reverbAmount * 100)}%</strong></div>
            <input type="range" min={0} max={1} step={0.01} value={preferences.reverbAmount} onChange={(event) => setPreferences({ reverbAmount: Number(event.target.value) })} />
          </label>
          <p className="fine-print">The reverb is a procedurally generated impulse response, not a sampled space. It is an approximation of Sky’s calm ambience.</p>
          <label className="slider-field">
            <div><span>Latency offset</span><strong>{preferences.latencyOffsetMs} ms</strong></div>
            <input type="range" min={-250} max={300} step={5} value={preferences.latencyOffsetMs} onChange={(event) => setPreferences({ latencyOffsetMs: Number(event.target.value) })} />
          </label>
          <p className="fine-print">
            Calibrate the on-screen playhead against what you hear. Hardware output latency is included automatically; this is
            a manual correction on top.
          </p>
        </section>

        <SoundsPanel />
        <section className="settings-card">
          <h3>Playback</h3>
          <label className="toggle-row">
            <input type="checkbox" checked={preferences.metronomeEnabled} onChange={(event) => setPreferences({ metronomeEnabled: event.target.checked })} />
            <span>Metronome enabled</span>
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={preferences.preserveOriginalTiming} onChange={(event) => setPreferences({ preserveOriginalTiming: event.target.checked })} />
            <span>Preserve original timing when quantizing (reversible)</span>
          </label>
          <label className="field">
            <span className="field-label">Count-in measures</span>
            <select className="input select" value={preferences.countInMeasures} onChange={(event) => setPreferences({ countInMeasures: Number(event.target.value) })}>
              {[0, 1, 2, 4].map((value) => <option key={value} value={value}>{value === 0 ? 'Off' : `${value} bar${value === 1 ? '' : 's'}`}</option>)}
            </select>
          </label>
          <p className="fine-print">
            Quantize stores the pre-quantize timing on each note. Use “Restore timing” in the timeline toolbar to undo it.
            Sky’s exact sustain duration caps are undocumented, so the app only enforces its own 16-beat safety limit.
          </p>
        </section>

        <section className="settings-card wide">
          <h3>Project &amp; storage</h3>
          <div className="settings-facts">
            <span><strong>Format</strong> .skymusic.json · schema v1</span>
            <span><strong>Catalog</strong> 2026.10.1</span>
            <span><strong>Storage</strong> local IndexedDB (fallback localStorage)</span>
            <span><strong>Network</strong> none — no accounts, APIs or telemetry</span>
          </div>
          <p className="fine-print">
            Sky Music Studio is unofficial fan software. It is not affiliated with thatgamecompany, contains no proprietary
            game assets, and does not automate gameplay. Built-in instrument sounds are original synthesis approximations
            based on public descriptions; optional sample packs use only recordings you load locally. See{' '}
            <code>docs/known-gaps.md</code> for the uncertain mechanics.
          </p>
        </section>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}
