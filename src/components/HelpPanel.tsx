import { Modal } from './Modal';
import { DownloadIcon, KeyboardIcon, MusicIcon, SparkIcon } from './Icons';

function Shortcut({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="shortcut-row">
      <span className="keys">{keys.split('+').map((part) => <kbd key={part}>{part}</kbd>)}</span>
      <span>{label}</span>
    </div>
  );
}

export function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Help & field guide" eyebrow="Unofficial fan software · strict Sky mode" onClose={onClose} size="large" testId="help-panel">
      <div className="help-intro">
        <SparkIcon size={22} />
        <p>
          Sky Music Studio is a local-first composer for Sky: Children of the Light. Each track is one human performer with one
          in-game instrument. You get strict instrument-specific pad rows in a real multitrack piano roll cues, real audio and
          MIDI exports. Nothing here modifies or controls the game.
        </p>
      </div>

      <div className="help-columns">
        <section className="help-card">
          <h3><MusicIcon size={16} /> First song</h3>
          <ol>
            <li>Choose a track at the top and pick an instrument from the catalog.</li>
            <li>Add note is the default tool: tap the grid to place a note. Edit lets you select and drag.</li>
            <li>Only that instrument’s physical pads are shown — 15 diatonic pads, 8 percussion/pitched exceptions, or 4.</li>
            <li>Press Space to play, or use Audition in the instrument catalog to hear a sound.</li>
            <li>Change the key in the transport and every track is remapped to the same scale degrees.</li>
            <li>Save happens automatically; the library keeps every project locally.</li>
          </ol>
        </section>
        <section className="help-card">
          <h3><KeyboardIcon size={16} /> Shortcuts</h3>
          <div className="shortcut-list">
            <Shortcut keys="Space" label="Play / pause" />
            <Shortcut keys="Shift+Space" label="Stop and return to start" />
            <Shortcut keys="L" label="Toggle loop" />
            <Shortcut keys="M" label="Toggle metronome" />
            <Shortcut keys="Ctrl+Z" label="Undo" />
            <Shortcut keys="Ctrl+Shift+Z" label="Redo" />
            <Shortcut keys="Ctrl+A" label="Select all notes in the active track" />
            <Shortcut keys="Ctrl+C" label="Copy selected notes" />
            <Shortcut keys="Ctrl+X" label="Cut selected notes" />
            <Shortcut keys="Ctrl+V" label="Paste at the playhead" />
            <Shortcut keys="Ctrl+D" label="Duplicate selection" />
            <Shortcut keys="Delete" label="Delete selected notes" />
            <Shortcut keys="Alt+drag" label="Draw a note without changing tool" />
          </div>
                  </section>
        <section className="help-card">
          <h3>Strict Sky rules</h3>
          <p>
            There is deliberately no chromatic or extra-octave mode. A note stores a physical pad index, and pitch is derived
            from <code>(instrument, key, pad)</code>. The 15-pad family is the major scale over two octaves plus the tonic:
            C D E F G / A B C D E / F G A B C in C major. Bells use C D G A / C D G A; handpan uses D A C D F G A C; drums are
            unpitched; the Tuned Krill Horn is a documented 8-pad pitched exception.
          </p>
          <p>
            Sustain instruments (violin, cello, guitar variants, saxophone, harmonica, AURORA voice, Vessel Flute and reported
            extras) allow longer held notes. Others are one-shot. No undocumented duration cap is claimed.
          </p>
        </section>
        <section className="help-card">
          <h3><DownloadIcon size={16} /> Saving &amp; loading</h3>
          <p>
            Songs autosave to the Library under More. Export downloads a <code>.skymusic.json</code> project file, and Import in
            the Library loads it back; nothing is uploaded.
          </p>
          <p>
            MIDI is a Type-1 file with tempo, key signature, named tracks, GM programs and channel-10 percussion. MIDI timbres
            differ by DAW/soundfont. All app sounds are original synthesis approximations, not game recordings.
          </p>
        </section>
        <section className="help-card">
          <h3>Local, private, honest</h3>
          <p>
            No accounts, no multiplayer, no backend, no analytics, no paid APIs. Projects live in your browser; export a project
            file to back them up. If storage is full, the app reports an error instead of silently losing changes.
          </p>
          <p>
            Research gaps and approximations are documented in <code>docs/sky-mechanics.md</code>, <code>docs/known-gaps.md</code>{' '}
            and <code>docs/audio-sources.md</code>. Uncertain entries are labelled community-reported or research-pending in the
            catalog.
          </p>
          <p className="fine-print">
            Sky: Children of the Light is a trademark of thatgamecompany. This is an unofficial fan project with no copied
            artwork, music, or game audio.
          </p>
        </section>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn primary" onClick={onClose}>Start composing</button>
      </div>
    </Modal>
  );
}
