# User guide

Sky Music Studio is an unofficial, local-first composer for *Sky: Children of the
Light*. You arrange up to 24 virtual performers, audition each instrument, and export audio or
MIDI.

> This app does not import official Sky sheets and does not press keys in the game.

## 1. First run

1. Open the app in a desktop browser.
2. Choose **Play the demo** to hear the engine, **Start a new song**,
   or **Starter loop**. The demo is original: *Lanterns Over the Valley*, about two
   minutes in C major at 82 BPM: Violin melody over Piano and Drum, with Flute,
   Cello and Harp.
3. Press **Play** once. The browser unlocks sound on that first press.
4. The app autosaves into the browser's local project library. There is no account or
   upload.

## 2. Instruments and strict Sky mode

- Most pitched instruments have **15 pads** arranged 3×5, covering two octaves of the
  current major key. The pad order is top-left → bottom-right:
  `C D E F G / A B C D E / F G A B C` in C major.
- Percussion usually has **8 pads** (4×2). Drums are unpitched. Bells and handpans use
  instrument-specific pitched patterns. Fortune Drum and Cymbals have **4 pads**.
- The Tuned Krill Horn is an unusual **8-pad pitched** instrument with sustain.
- The app is always strict: there is no chromatic mode and no extra octave. The grid
  shows only pads the selected instrument can actually play.
- Changing an instrument to one with fewer pads removes notes outside the new grid.
  The app warns you and you can undo.
- The catalog shows the native sheet part (Melody / Sub-Wind / Bass / Percussion),
  pad count/layout, sustain behavior, evidence, coverage status and confidence. Read
  the caveats; some variants and registers are community-reported.
- Special items such as **Jam Station**, **Dark Horn**, and the unresolved plain
  **Krill Horn** are information-only, not track instruments.

## 3. The screen

- **Top bar:** Play/stop, position, the song name and a small save dot, tempo, meter,
  undo/redo, My songs, Import MIDI, Export and **⋯**.
- **Toolbar:** Add note / Edit, Snap, Loop, Click, zoom, Mix and Keys.
- **Tracks:** the open track shows its real keys, one row each. Its header holds the
  instrument picker, mute, solo, volume and collapse. Every other track is a lane with
  its own mute and solo; click a lane to open it.
- **Keys:** the instrument's physical layout. Click the keys or press Q–T, A–G and Z–B
  to play. Turn on **Step input** to write what you play at the cursor. Press **K** to
  hide the panel.
- **Bottom bar:** the position under the pointer, and an overview of the whole song.
  Click or drag it to travel.
- **⋯:** Instruments, Tracks & mix, Settings & sound, Help, count-in and whether notes
  sound while you edit.

## 4. Editing in the timeline

- **Add note (default):** tap/click anywhere in the grid to place a note on that
  pad and beat; drag sideways to lengthen a held note.
- **Edit:** click a note to select it, drag selected notes to move them, drag empty
  space to box-select, and drag the right-edge handle on a sustain instrument to
  resize.
- **Ruler:** click/drag to scrub; Left/Right arrow keys seek by one snap step.
- **Loop lane:** enable Loop under More → Grid & timing. The lane then appears;
  drag to set a region and drag its end handles to resize.
- **Selection bar:** appears while notes are selected. Copy, paste, duplicate,
  delete, quantize, restore pre-quantize timing, loop from selection, or clear.
- **Snap** options include bar, half, beat, eighth, eighth-triplet, sixteenth and off (More → Grid & timing).
- **Quantize** snaps starts and durations to the snap grid. If “Preserve original
  timing” is checked (Settings), each note keeps its original timing; use Restore
  timing to invert.
- **Zoom** is under More → Grid & timing. The timeline follows the playhead while
  playing.

### Keyboard shortcuts

| Keys | Action |
|---|---|
| Space | Play / pause |
| Shift+Space | Stop |
| L | Toggle loop |
| M | Metronome |
| Ctrl/Cmd+Z | Undo |
| Ctrl/Cmd+Shift+Z or Ctrl+Y | Redo |
| Ctrl/Cmd+A | Select all notes in active track |
| Ctrl/Cmd+C / X / V | Copy / cut / paste at playhead |
| Ctrl/Cmd+D | Duplicate selection |
| Delete / Backspace | Delete selected notes |
| Alt+drag | Draw a note without switching tool |
| ← / → in ruler | Seek by snap step |
| ? | Open help and shortcuts |
| Esc | Close dialog |


## 5. Playing and auditioning

- **Play** (or Space) plays the full arrangement. The playhead runs on the audio
  clock; seek with the ruler or the arrow keys.
- **Tracks & mix** (or More → Tracks & mix) sets volume, mute and solo. Solo keeps the chosen performer
  audible while other buses are muted, without altering the saved mix.
- **Catalog → Audition** plays a short original phrase on any selectable instrument
  in the current project key, so you can compare timbres before assigning one.
- **Click**, **meter**, **count-in**, **snap** and **zoom** live under More → Grid &
  timing. They are scheduled with the audio clock.
- Playback is entirely inside this app; it never sends keys or input to Sky.

## 6. Saving, library, importing

- Edits autosave locally after a short debounce. The small dot by the title shows
  saved / saving / unsaved / storage error on hover or focus.
- **More → My songs** lists every local project; open, duplicate, delete (two-step confirm),
  start a new song, load the demo/starter, import a project file, or export the
  current project.
- Supported import is the app's native `.skymusic.json` (schema v1). Malformed,
  oversized, out-of-grid or unknown-instrument projects are rejected with an error
  toast; the current project is not modified.
- Export a project file for a permanent backup. Clearing site data removes the local
  library.
- Preferences (volumes, reverb, count-in, latency, snap, zoom) are stored separately
  in localStorage.

## 7. Saving and exporting

- **MIDI:** Type-1 file; conductor track with tempo/meter/key signature; one named
  track per performer; GM programs; unpitched percussion on channel 10. DAW timbres
  will differ from this app's synthesis.
- **Project JSON:** complete native project; load it back with Import in the Library.
- **sky-mod song:** one `.skymod.json` for the separate sky-mod project, with every
  non-empty track on a shared count-in. Copy it to `sheets\mine` in the Sky game
  folder and open F5 → Music → My songs. Mute and solo are ignored. The export warns
  when the song runs past the 120 s reported for one Shared Memory recording.
- Every export is generated locally. No cloud service or key is involved.
- MIDI contains notes, not timbres.

## 8. Troubleshooting

- **No sound:** press Play once or tap the sound icon; check the tab isn't muted; check Settings volume and
  the track volume/mute/solo.
- **Audio looks out of sync:** adjust the latency offset in Settings & sound. Hardware output
  latency is included automatically; this is a manual correction on top.
- **Export fails:** free memory/tab resources and try a shorter song; very long songs
  are capped at 30 minutes per render; keep the tab visible during rendering.
- **Storage error:** browser storage may be full; export a project file and delete old
  library entries.
- **Unknown instrument on import:** the project references an instrument not in this
  catalog version; import is rejected rather than silently changing it.

## Quick reference

- **Delete a note:** right-click or double-click it.
- **Copy by dragging:** hold Alt while dragging notes.
- **Move off the grid:** hold Shift while dragging.
- **Duplicate:** Ctrl+D places the copy straight after the selection.
- **Change note strength:** select notes and use Strength in the selection bar.
- **Zoom:** Ctrl+wheel around the pointer, or **0** to fit the whole song.
- **Play from anywhere:** click the ruler, then press Space.

Press **?** in the app for every shortcut.
