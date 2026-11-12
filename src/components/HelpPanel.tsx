import { useAppStore } from '../state/store';
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
    <Modal title="Help & field guide" eyebrow="Unofficial fan software · strict Sky mode" onClose={onClose} size="large">
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
            <li>Click the instrument name above the grid to change it, or Add instrument below the tracks.</li>
            <li>With Add note on, click a row to place a note. Held instruments stretch as you drag right.</li>
            <li>Only that instrument’s real keys are shown: 15, 8 or 4, exactly as in the game.</li>
            <li>Play the keys on the right, or with Q–T, A–G and Z–B. Step input writes them at the cursor.</li>
            <li>Click the ruler to place the cursor, then press Space to play from there.</li>
            <li>Songs save automatically. My songs keeps every song in this browser.</li>
          </ol>
        </section>
        <section className="help-card">
          <h3><KeyboardIcon size={16} /> Shortcuts</h3>
          <div className="shortcut-list">
            <Shortcut keys="Space" label="Play or pause from the cursor" />
            <Shortcut keys="Shift+Space" label="Stop and return to the start" />
            <Shortcut keys="Home" label="Cursor to the start" />
            <Shortcut keys="End" label="Cursor to the end of the song" />
            <Shortcut keys="1" label="Add note tool" />
            <Shortcut keys="2" label="Edit tool" />
            <Shortcut keys="K" label="Show or hide the keys" />
            <Shortcut keys="I" label="Step input" />
            <Shortcut keys="L" label="Loop" />
            <Shortcut keys="M" label="Metronome click" />
            <Shortcut keys="Q" label="Quantize, when the keys are hidden" />
            <Shortcut keys="←" label="Move notes or cursor by the snap" />
            <Shortcut keys="Shift+←" label="Move by a whole bar" />
            <Shortcut keys="↑" label="Move selected notes up a key" />
            <Shortcut keys="−" label="Zoom out" />
            <Shortcut keys="=" label="Zoom in" />
            <Shortcut keys="0" label="Fit the whole song" />
            <Shortcut keys="Ctrl+Z" label="Undo" />
            <Shortcut keys="Ctrl+Shift+Z" label="Redo" />
            <Shortcut keys="Ctrl+A" label="Select the whole track" />
            <Shortcut keys="Ctrl+C" label="Copy" />
            <Shortcut keys="Ctrl+X" label="Cut" />
            <Shortcut keys="Ctrl+V" label="Paste at the cursor" />
            <Shortcut keys="Ctrl+D" label="Duplicate after the selection" />
            <Shortcut keys="Delete" label="Delete selected notes" />
            <Shortcut keys="Esc" label="Clear the selection" />
          </div>
        </section>
        <section className="help-card">
          <h3>With a finger</h3>
          <div className="shortcut-list">
            <Shortcut keys="Tap" label="Place a note with Add note on, or select one" />
            <Shortcut keys="Drag" label="Scroll the song; a selected note moves instead" />
            <Shortcut keys="Double-tap" label="Delete a note" />
            <Shortcut keys="Long press" label="Add a note to the selection, or drag a box from empty grid" />
            <Shortcut keys="Pinch" label="Zoom in and out" />
          </div>
          <p className="fine-print">
            On a phone, the ⋯ button holds Songs, My songs, Import, Sheet and Export, with the tempo, the meter and their changes. Undo and the
            keys are in the row of tools, which scrolls sideways.
          </p>
        </section>
        <section className="help-card">
          <h3>With the mouse</h3>
          <div className="shortcut-list">
            <Shortcut keys="Drag" label="Move notes; they land on the grid" />
            <Shortcut keys="Shift+drag" label="Move freely, or box-select on empty grid" />
            <Shortcut keys="Alt+drag" label="Copy notes, or draw from the Edit tool" />
            <Shortcut keys="Right-click" label="Delete a note (double-click works too)" />
            <Shortcut keys="Ctrl+wheel" label="Zoom around the pointer" />
          </div>
          <p className="fine-print">Click a pitch at the left of the grid to hear it. Drag in the overview at the bottom to travel through a long song.</p>
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
            Songs save to My songs as you edit. Export can save a <code>.skymusic.json</code> song file. To open a song
            file or a MIDI file, use Import in the top bar or drop the file anywhere on the window. Nothing is uploaded.
          </p>
          <p>
            MIDI is a Type-1 file with every tempo and meter change, the key signature, named tracks, GM programs and channel-10 percussion. MIDI timbres
            differ by DAW/soundfont. Built-in synthesis is an approximation; personal sample packs supply recorded sounds.
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
            Sky: Children of the Light is a trademark of thatgamecompany. This is an unofficial fan project. Instrument
            pictures and sound packs come from the game and remain thatgamecompany’s work.
          </p>
        </section>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={() => useAppStore.getState().setPanel('about')}>About &amp; credits</button>
        <button type="button" className="btn primary" onClick={onClose}>Start composing</button>
      </div>
    </Modal>
  );
}
