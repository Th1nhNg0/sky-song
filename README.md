# Sky Music Studio

An **unofficial fan-made** composer and arranger for
*Sky: Children of the Light*. It runs entirely in the browser, stores projects
locally, and treats Sky's performance grids as the musical instrument they are:
strict, physical, diatonic pads — not a generic chromatic piano.

> Sky: Children of the Light is a trademark of thatgamecompany. This project is
> not affiliated with, endorsed by, or supported by thatgamecompany. It contains
> no game audio, artwork, icons, music, or other proprietary assets. Built-in
> sounds are original synthesized approximations. Optional sound packs made from
> your own copy of the game stay in the browser and are never uploaded.

![The one-screen studio](docs/screenshots/arrange.png)

## What it does

- **One clear studio screen** — open a song, choose a track and instrument, tap
  the grid to add a note, and press Play. Tempo and key stay visible; library,
  export, mix, loop, click, snap, meter, count-in and zoom live under one **More**
  menu. The selected track gets a friendly 15-pad-style roll with large rows.
- **Researched instrument catalog** — 44 playable entries, variants and special
  cases, with evidence, confidence, status, pad count/layout, native sheet part,
  sustain behavior and a distinct original synth profile. Special props and
  sequencers (Jam Station, Dark Horn) are represented separately and are not
  disguised as pitched instruments.
- **Strict Sky mode** — 15 diatonic pads (2 octaves + tonic), instrument-specific
  8-pad bell/handpan patterns, an unusual 8-pad pitched Tuned Krill Horn, and
  4-pad percussion. Twelve major keys. Notes store a **physical pad index**;
  pitch is derived from `(instrument, key, pad)`. There is no chromatic or
  extra-octave mode anywhere.
- **Multitrack arrangement** — up to 24 virtual performers, per-track instrument,
  volume/mute/solo/color/reorder, a selected-track piano roll, drag/move/resize
  (holds only), marquee and multi-select, copy/cut/paste/duplicate, undo/redo,
  snapping, zoom, ruler, loop region, seek and audio-clock playhead.
- **Original synthesized playback** — per-instrument voices, stereo mixer,
  procedural reverb and limiter; audition any catalog sound and play the whole
  arrangement with per-track mute, solo and volume.
- **Optional local sound packs** — load your own WAV/MP3/OGG instrument recordings
  (or one played scale), let the app slice and pitch-map them, correct the mapping,
  and keep packs in the browser. Instruments without a pack use the synth.
- **Reversible timing tools** — quantize selected notes with optional
  **preserve-original-timing**, then recover the raw positions with “Restore timing”.
  Metronome, count-in and latency calibration stay available.
- **Save and load** — songs autosave to the library; export a versioned
  `.skymusic.json` project file and import it back. **Type-1 multitrack MIDI** with
  tempo, meter, key signature, track names, GM programs and channel-10 percussion
  is also available.
- **Local-first** — IndexedDB library (with a localStorage fallback), autosave,
  project import/export, no accounts, no backend, no telemetry, no paid APIs.

## Quick start

Requires Node.js 20.19+ (tested on Node 22) and npm.

```bash
npm install
npm run dev            # http://127.0.0.1:5173
npm run build          # type-check + production static build in dist/
npm run preview        # preview the production build on port 4173
```

Open the app and choose **Play the demo** or **Start a new song**. Press **Play**
once to unlock browser audio. The demo is an original 40-bar ensemble piece in C major at
82 BPM: Violin melody over Piano and Drum, with Flute, Cello and Harp.

### Verification commands

```bash
npm run lint           # ESLint, zero errors/warnings
npm run typecheck      # tsc --noEmit
npm run build          # production bundle
```


## Architecture

```
src/music/       keys, pad patterns, instrument manifest, pitch resolution,
                 project schema, validation/migration, original demo songs
src/audio/       original synth voices, mixer graph, look-ahead transport,
                 MIDI writer
src/components/  top bar, toolbar, track strip, timeline/piano roll,
                 More menu, catalog, library, sounds, export, settings,
                 help
src/storage/     IndexedDB library, preferences
src/state/       Zustand store, playback controller, playhead/audio stores
src/export/      download helpers and export orchestration
docs/            research, decisions, known gaps, format, user guide, audio sources
```

**Playback:** the transport schedules notes on
the `AudioContext` clock with a look-ahead window; React frames are only used to
paint the playhead, never to drive audio.

**Canonical note model:** notes are `{ id, pad, startBeat, durationBeats, velocity }`.
Pad indices are 0-based internally (UI shows 1-based). MIDI pitch, frequency and
note names are derived on demand from the project key and instrument mapping.

## Research and honesty

The full fact table, sources, confidence levels and implementation consequences are
in [`docs/sky-mechanics.md`](docs/sky-mechanics.md). Key points:

- The official tutorial confirms the 15-pad / two-octave music-sheet grid and the
  box/star cue mechanic.
- The Fandom wiki was blocked by Cloudflare from this environment; facts drawn from
  it came from search snippets and were cross-checked against a Japanese community
  wiki and open factual metadata. This limitation is documented rather than hidden.
- Octave registers, percussion pad voicing, bell/handpan order and 4-pad layout
  details are partly community-reported or inferred. Uncertain entries are marked
  **community-reported**, **inferred**, or **research-pending** in the UI.
- Built-in sounds are synthesis. Exact instrument audio only comes from sound packs
  the user makes from their own copy of the game and loads locally.
- This app does not import official in-game sheets, does not automate key presses,
  and does not claim Sky Studio/Sky Music Nightly file compatibility.

See [`docs/known-gaps.md`](docs/known-gaps.md) for the unvarnished list.

## Privacy and storage

- Projects are stored in the browser only (IndexedDB; localStorage fallback).
- No accounts, multiplayer, analytics, advertising, paid APIs or telemetry.
- Clearing site data deletes the local library. Export a `.skymusic.json` file for
  permanent backups.
- Audio is unlocked only after a user gesture.

## Deployment

`npm run build` produces a static site in `dist/` (Vite `base: './'`, so it works
from a domain root or a subdirectory). Serve it with any static host. No server-side
runtime, environment variables, or keys are required.

## Licensing

The original code and documentation in this repository are MIT-licensed (see
[`LICENSE`](LICENSE)). Third-party libraries are acknowledged in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and
[`licenses/`](licenses). No third-party audio samples or game assets are used.

## Documentation

- [Sky mechanics fact table](docs/sky-mechanics.md)
- [User guide](docs/user-guide.md)
- [Project format](docs/project-format.md)
- [Architecture decisions](docs/decisions.md)
- [Known gaps and limitations](docs/known-gaps.md)
- [Audio sources and licenses](docs/audio-sources.md)
- [Task tracker](TASKS.md)
