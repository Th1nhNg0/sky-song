# Architecture decisions

Concise decision log. Dates are implementation dates (2026-10-31).

## D001 — Static React/Vite app, no backend

**Decision:** Use Vite + React + TypeScript and build a static site. No server,
accounts, database service, paid API, or collaboration backend.

**Why:** The goal explicitly requires solo editing, static hosting, no paid services,
and local-first data. A static bundle is deployable anywhere and keeps the privacy
story simple.

**Consequence:** Sharing uses the URL fragment; persistence uses IndexedDB with a
localStorage fallback. There is no multi-device sync by design.

## D002 — Physical pad index is canonical

**Decision:** Store `pad` (0-based physical index), `startBeat`, `durationBeats` and
`velocity`; derive MIDI pitch/frequency/name from `(instrument, key, pad)`.

**Why:** Sky instruments are played by pad. A physical pad survives key changes,
instrument validation and MIDI export correctly. Storing a MIDI number would make
the app accidentally chromatic or lose percussion identity.

**Consequence:** Pad validity is enforced at note creation, paste, instrument change,
project import and MIDI/audio export. The UI shows 1-based pad numbers.

## D003 — Strict Sky mode only

**Decision:** No chromatic mode, no extra octaves, no out-of-grid notes. The 15-pad
family is the major scale over two octaves plus tonic. Instrument-specific 8/4-pad
exceptions are data, not hardcoding.

**Why:** This is a non-negotiable product constraint and the main correctness risk.

**Consequence:** Instrument changes that reduce the pad grid remove out-of-grid notes
with an undoable warning. Import rejects invalid pads. The piano roll renders only
the selected instrument's real pads.

## D004 — Versioned, data-driven instrument manifest

**Decision:** One manifest carries id, display name, category, native sheet part,
key count/layout, pad mapping, base octave, sustain, sound profile, evidence,
confidence, status and notes. Special props/sequencers live in a separate list.

**Why:** The catalog must be auditable and honest about uncertainty; variants and
special cases must not be silently normalised.

**Consequence:** The catalog can be searched/filtered; confidence and status are
visible. Every entry has an original synth profile. Jam Station/Dark Horn/Krill Horn
are not selectable track instruments.

## D005 — Shared realtime/offline synthesis path

**Decision:** Use one synth voice implementation and one mixer topology for live
`AudioContext` playback and `OfflineAudioContext` WAV/MP3 rendering.

**Why:** Export must sound like playback and avoid a second, divergent engine.

**Consequence:** Track buses, synthetic reverb and limiter are built identically. The
offline renderer additionally peak-normalises if needed and fades the very end.

## D006 — Audio-clock look-ahead scheduler

**Decision:** Schedule notes from `AudioContext.currentTime` with a 25 ms timer and a
120 ms look-ahead window. Never use React render frames or `setInterval` as the audio
clock.

**Why:** Prevent drift and UI jank. Visual playhead is painted from the audio clock.

**Consequence:** Transport uses deterministic beat↔time mapping, loop-unrolled virtual
beat scheduling, and re-anchors after tab suspension. Unit tests simulate the clock.

## D007 — Own MIDI writer instead of relying on a library encoder

**Decision:** Implement the Type-1 Standard MIDI File writer directly. Use
`@tonejs/midi` only in tests as an independent parser.

**Why:** During verification, the tested library wrote key-signature meta events with
an incorrect signed value (writer/parser mismatch), and we needed exact control over
conductor metadata, channels and ASCII-safe track names. Midi text meta is commonly
read as Latin-1, so exported names are ASCII-normalised to prevent mojibake.

**Consequence:** MIDI has a conductor track with tempo/meter/key, per-performer tracks,
GM programs, channel-10 percussion, and instrument/part names. Tests parse it back.

## D008 — WAV by hand, MP3 by LAME

**Decision:** Encode WAV as 16-bit PCM ourselves; use `@breezystack/lamejs` (LGPL) for
real MPEG-1 Layer III at 192 kbps with ID3 tags.

**Why:** WAV needs no dependency and is trivial to verify. A genuine MP3 encoder is
required by the goal; renaming WAV is explicitly forbidden.

**Consequence:** The LAME license is included. MP3 encoding is chunked/yielded to keep
the UI responsive. MP3 is never used as an internal audio format.

## D009 — Compressed share links with an honest fallback

**Decision:** Deflate the project JSON, base64url-encode it into `#/song/v1...`.
Use a 24 KB soft warning and a 60 KB hard cutoff, falling back to project-file
download above that.

**Why:** Static hosting + no backend. URLs can be truncated by chat apps; oversized
links would silently break. A real fallback is better than pretending.

**Consequence:** Share links open as local copies. The app explains the limitation.
Very large projects get a clear message and a `.skymusic.json` download.

## D010 — Snapshot undo with gesture grouping

**Decision:** Undo/redo stores whole project snapshots (max 80). Continuous drags are
wrapped in `beginGesture`/`endGesture`, producing one history entry per gesture.

**Why:** Simple, reliable, and sufficient for a solo DAW at this scale. Immutable
project objects are cloned before edits.

**Consequence:** Note/track structure, key/tempo, instrument, mute/solo, color and
loop changes are undoable. Volume slider changes are grouped with begin/end gestures.
Selection is cleared by undo/redo.

## D011 — Retired: practice tempo and accompaniment

Practice mode was removed at the product owner's request.

## D012 — Retired: Sky-like cue

Practice mode was removed at the product owner's request.

## D013 — Special props are not instruments

**Decision:** Jam Station, Dark Horn and unresolved Krill Horn live in a separate
special list. Jam Station is a 4-part × 8-step, fixed-C sequencer concept; Dark Horn
is a one-sound prop.

**Why:** Faking these as pitched keyboards would be false.

**Consequence:** They are browsable with explanations but cannot be selected as a track
instrument. A user can recreate a Jam Station-style loop with four tracks manually.

## D014 — Mobile layout with explicit views

**Decision:** Keep one studio screen at every width: a compact header, primary
toolbar, horizontally scrollable track strip, and the selected track's pad roll.
Secondary tools live in the same **More** menu on desktop and phone; practice was a
full-screen mode.

**Why:** A 294 px sidebar and multiple stacked control bars made the first screen
feel like a cockpit at 390 px and on desktop. One stage with a single secondary menu
is faster for a newcomer and still exposes every feature.

**Consequence:** Mobile reaches Tracks & mix, library, export and timing through More.
The track strip scrolls sideways, and Add note is the default touch interaction.

## D015 — Honest approximations over false fidelity

**Decision:** Mark every synthesized instrument as an approximation, document research
confidence, keep a known-gaps file, and avoid claiming official sheet import or
proprietary sample usage.

**Why:** Correctness and honesty are explicit top priorities. The app cannot legally
or technically reproduce exact game recordings.

**Consequence:** Catalog badges, help text and README all state the
approximation and unofficial status.

## D016 — Share links and audio export removed (2026-10-31)

**Decision:** Saving and loading songs is enough, so share links and WAV/MP3 export
were removed, along with `pako`, `@breezystack/lamejs` and the offline renderer. This
supersedes the WAV/MP3 parts of D005 and all of D008 and D009.

## D017 — Automated tests removed (2026-10-31)

**Decision:** The unit and browser test suites and their tooling were removed at the
owner's request. `npm run verify` now runs lint, typecheck and build. Older docs that
mention test evidence describe past checks, not anything that can be re-run.

## D018 — Phones: one folded layout, taps edit and drags scroll (2026-11-11)

**Decision:** Below 900 px wide or 520 px tall the same studio screen folds, as D014
describes: the top bar keeps Play, the title and **⋯**; song actions, tempo and meter
move into **⋯**; the toolbar becomes one row that scrolls sideways; the label column
narrows from 196 to 64 px. `src/state/layout.ts` holds the media queries that the
components and the stylesheet share. On the note grid a finger scrolls, so editing is
done with taps: tap to place or select, drag a selected note to move it, long-press to
extend the selection or start a box, pinch to zoom.

**Why:** With a mouse, pressing on the grid draws or box-selects at once. Under a
finger that left no way to scroll a song that is always wider than the screen. Only a
note that is already selected holds the finger, so a scroll that happens to start on a
note cannot move it.

**Consequence:** A held note gets its length from its right-edge handle after it is
placed, and there is no touch form of Alt-drag copying. Rows are at least 30 px tall
under a coarse pointer, so a 15-key instrument scrolls up and down on a small phone.
The keys start closed on a phone, to leave the screen to the notes.

## D019 — Shipped sound packs are fetched per instrument (2026-11-11)

**Decision:** The manifest names the instrument each shipped pack plays, and a pack
is read when a song using that instrument opens, when it is auditioned, or when it is
chosen in Settings. The audio context is created and resumed inside the gesture that
asks for sound, before any pack is awaited. Play waits up to 8 seconds for the song's
packs and then starts regardless.

**Why:** Every pack used to be downloaded before the audio context was created. That
is about 285 MB, so on a phone the first note never came: the download outlasted the
tap that is allowed to start audio, and it spent the visitor's data on instruments the
song did not use.

**Consequence:** An instrument can be labelled a game sound before its recordings are
in memory (`soundSourceInfo(...).pack` is null until then). On a slow connection a
song can start on the synth and change to recordings as they arrive. A manifest entry
without `instrumentId` is still read up front.

## D020 — Built sound packs are packed without loss (2026-11-11)

**Decision:** A build rewrites each shipped `.skypack.json` as a `.skyaudio` file:
the samples' details as a small header, and their audio as prediction differences in
Rice code (`src/audio/lossless.ts`, the method of FLAC's fixed predictors). The pack's
own details move into the manifest, and a file is named after its contents, so the
nine groups of instruments that play the same recordings share one file each. The
repository keeps the JSON packs, and the dev server serves them unchanged.

**Why:** The packs were 285 MB to deploy and 5 to 27 MB per instrument to download,
almost all of it 16-bit audio written as base64 text. Packed, they are 58 MB, and an
instrument is a third of what it was. A lossy codec would be three times smaller
again, but it would change recordings the project describes as exact, shift attacks
by its encoder delay, and depend on what each browser can decode. This decoder is the
app's own, so it behaves the same everywhere and is checked bit for bit.

**Consequence:** Nothing about the sound changes. A build takes a few seconds longer
and needs no outside tool. Largest file is under 8 MB, so no pack is split for the
host's 25 MB limit any more; the splitting step stays for a pack that would be.

