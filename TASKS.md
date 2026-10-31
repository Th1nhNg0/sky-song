# Sky Music Studio — task tracker

Last updated: 2026-10-31 (simplified one-screen UI + local sound packs).

Legend: `[x]` implemented and verified · `[~]` implemented with a documented
limitation · `[ ]` not implemented. Past verification evidence was in test suites since removed (see D017),
`docs/`,.

## Research

- [x] Official music-sheet tutorial retrieved: 15 pads, 2 octaves, box/star cues
- [x] Community instrument inventory cross-referenced (Japanese wiki + open metadata)
- [x] 8-pad and 4-pad percussion patterns documented
- [x] 12 major keys and pad→pitch transposition documented
- [x] Sustain instrument list with confidence levels
- [x] Sheet parts (M/S/B/P/FD) and special props (Jam Station, Dark Horn) documented
- [x] `docs/sky-mechanics.md` fact table: sources, confidence, consequences, gaps
- [x] Audio/licensing strategy documented (`docs/audio-sources.md`)
- [~] English Fandom wiki blocked by Cloudflare (HTTP 403); snippets/cross-checks used
- [~] Some pad voicing, octave registers, handpan/bell order, 4-pad layout remain
      community-reported/inferred (see `docs/known-gaps.md`)

## Foundation and music core

- [x] Vite + React + TypeScript static app, build/preview/dev scripts
- [x] Versioned data-driven instrument manifest (44 playable entries) with evidence,
      confidence, status, pad maps, parts, sustain and sound profiles
- [x] All 12 major keys; correct diatonic spelling and semitone mapping
- [x] Physical pad index canonical; pitch derived from `(instrument, key, pad)`
- [x] Strict grid enforcement in note creation, paste, instrument change, import,
      JSON validation and MIDI/audio export
- [x] Standard 15-pad, bells 8, handpan 8, Tuned Krill Horn 8, drums 8 and 4-pad cases
- [x] Special props/sequencer represented separately and non-selectable
- [x] Versioned project schema, validation, limits, migration, import errors
- [x] Shared realtime/offline synth + mixer topology
- [x] Original six-performer demo and starter loop
- [x] Unit tests for registry invariants, all keys, pad validation, project round-trip,
      migration, share codec, WAV/MP3/MIDI writers, transport scheduler, store actions

## Editor

- [x] One-screen studio shell: header, primary toolbar, track strip, editor
- [x] Track management: add/remove/duplicate/rename/reorder/color/mute/solo/volume
- [x] Selected-track 15-pad-style roll with only real pads and large touch rows
- [x] Add note is the default tool; Edit selects, moves, marquees and resizes
- [x] Selection bar appears only when notes are selected; delete/copy/paste/
      duplicate/quantize/restore/loop-selection live there
- [x] Hold-note resize only on sustain instruments
- [x] Snap, zoom, ruler scrub and follow playhead
- [x] Loop lane and resize handles appear only when loop is enabled via More
- [x] BPM and key stay on the main toolbar; meter, metronome and count-in under More
- [x] Undo/redo with gesture grouping
- [x] Autosave, dirty/saving/error status, last-saved time
- [x] Local project library: open, duplicate, delete (confirm), import, export
- [x] Catalog audition phrases for every selectable instrument
- [x] Quantize selected notes with optional preserve-original-timing; reversible
      “Restore timing” recovers the pre-quantize positions
- [x] Latency offset setting
- [x] Mobile track strip, touch note entry, and Tracks & mix under More
- [x] Volume/color/loop changes are grouped into undo history

## Audio

- [x] Distinct original synth profiles per family/instrument; envelope, harmonics,
      register, noise transients, vibrato/ensemble, optional reverb
- [x] Anti-click envelopes, voice cap/stealing, track buses, master compressor,
      peak-safe WAV/MP3 rendering
- [x] Audio unlock gesture handling and error display
- [x] Synthetic procedural reverb (labeled approximation)
- [x] Optional local sample packs: WAV/MP3/OGG per instrument or one played scale,
      onset slicing, pitch detection, manual correction, pitch-shift, IndexedDB,
      pack export/import, and synth fallback (21 unit tests)
- [x] Every catalog instrument renders audible output in a browser test
- [~] Built-in sounds remain approximations, not game recordings; sample packs are
      only the user's own local recordings and are never uploaded or bundled
- [~] Percussion voicing / some registers inferred (documented)
- [x] Chrome/Chromium full E2E; Firefox smoke check passed
- [~] Safari not tested in this environment

## Persistence, sharing, exports

- [x] IndexedDB library with localStorage fallback, autosave and recovery on reload
- [x] Native `.skymusic.json` export/import with full data round-trip
- [x] Validation rejects malformed/oversized/out-of-grid/unknown projects safely
- [x] Compressed share links with copy action and verified second-tab round-trip
- [x] Honest oversized-link fallback with project-file download (tested)
- [x] WAV export: genuine 16-bit stereo 44.1 kHz PCM, full duration/content
- [x] MP3 export: genuine LAME MPEG-1 Layer III 192 kbps, ID3 title/artist/album/comment
- [x] MIDI export: Type-1, tempo/meter/key, named tracks, GM programs, channel 10,
      parsed back by an independent parser
- [x] Project JSON export verified by re-import
- [x] LAME/LGPL license texts and third-party notices included
- [ ] MIDI import (not required by the specification)
- [ ] Sky Studio / Sky Music Nightly / `.skysheet` interoperability (optional;
      investigated, not verified/adopted)
- [~] Share links are app-internal, not official Sky sheet links (stated)

## UI / polish / accessibility

- [x] Minimal first-run dialog: Play the demo / Start a new song, one short hint
- [x] Compact sound control replaces the full-width audio banner
- [x] One **More** menu holds library, instruments, mix, export, settings, help,
      loop, click, meter, snap, count-in and zoom
- [x] Empty/loading/error states, toasts, tooltips and a tiny save dot
- [x] Help panel updated for the new screen and More menu
- [x] Settings: master volume, synthetic reverb, latency offset, metronome/count-in,
      preserve-original-timing, sound packs and project/storage facts
- [x] Focus-visible styles, modal focus trap/restore, reduced-motion CSS
- [x] 36–48 px touch targets; pointer-cancel/blur safety for timeline gestures
- [~] No formal WCAG audit/screen-reader certification
- [~] Dense piano-roll notes are mouse/touch-first; not every note is keyboard-editable

## Verification

- [x] `npm install` succeeds
- [x] `npm run typecheck` succeeds
- [x] `npm run build` succeeds
- [x] `npm run lint` succeeds with zero errors/warnings
- [x] `npm test` — 101 unit tests pass
- [x] Firefox smoke check: load, Web Audio playback with voices, note editing,
      WAV export
- [x] WAV/MP3 decoded and checked for nonzero audio, duration, format, bitrate, tags
- [x] MIDI parsed for tracks/notes/tempo/key/channels/names
- [x] Share link round-trip and oversize fallback verified in a browser
- [x] Save/reload, import, undo/redo, grid enforcement, solo, loop/seek,
      library duplicate/delete verified in browser
- [x] Before/after desktop and mobile screenshots inspected
- [x] Evidence and command outputs recorded in `docs/verification.md`
- [~] Audio quality cannot be compared against proprietary game recordings

## Honest release status

All release-required capabilities in the goal are implemented and tested. Remaining
limitations are documented in `docs/known-gaps.md`; the most important are that all
sounds are original synthesis approximations, some mechanics are community-reported,
there is no in-game/official-sheet import or automation, and optional third-party
sheet formats/MIDI import are not implemented. None of these are hidden or marked
complete.
