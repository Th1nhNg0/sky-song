# Pi Agent Goal — Sky Music Studio

> **Project:** Create a polished, original web application for composing, arranging, playing, practicing, and sharing music inspired by **Sky: Children of the Light**.
>
> **Execution:** You are the implementation agent. Build a runnable app in the current empty repository. Research source facts, implement incrementally, run tests, and leave clear instructions. Do not stop at a proposal, a wireframe, a nonfunctional mockup, or a scaffold.

## 0. Non-negotiable product decisions

- **Platform:** Web app, desktop-first but functional on mobile and tablets; no native app requirement.
- **Editing:** BOTH a Sky-style performance grid AND a modern, multi-track piano-roll/timeline editor.
- **Scope:** Cover **all actual playable Sky instruments** in a versioned, data-driven catalog, including unusual 8-key/4-key percussion and variants. Do not falsely present props such as the Dark Horn or the Jam Station as ordinary pitched instruments; represent special sequencers separately if appropriate.
- **Audio:** Get as close to Sky's perceived timbre, pitch, articulation, note envelope, and optional reverb as possible **using only legally usable assets** or original synthesis. Never extract or bundle proprietary game files. If exact sound is not legally available, offer a transparently labeled approximation.
- **Musical rules:** **STRICT SKY MODE ONLY.** Never provide an unrestricted chromatic or extra-octave composition mode. The editor may be more convenient than Sky, but every track must represent notes playable on the selected Sky instrument. Multiple instruments play simultaneously in the browser as **separate virtual performers**.
- **Output:** Browser playback; save/load; shareable compositions; real WAV, MP3, and multitrack MIDI exports; native project JSON; a useful visual/manual in-game performance guide for every performer.
- **Collaboration:** SOLO EDITOR ONLY. No multiplayer rooms, synchronized editing, authentication, or backend collaboration.
- **Visual:** Original Sky-inspired, calm, luminous, minimalist interface with a professional DAW timeline underneath. Do not copy Sky's proprietary artwork, icons, music, or official branding. Clearly label the app as unofficial fan software.
- **Delivery:** Fully working, tested, buildable, deployable static web app with a great first-use experience. Use no paid services or API keys.

## 1. First: research the actual game (with evidence)

Before locking the data model, inspect the most reliable accessible sources. Consult these starting points (or document if unavailable):

1. Official Music Sheets tutorial: https://thatgamecompany.helpshift.com/hc/en/17-sky-children-of-the-light/faq/1345-how-do-i-use-music-sheets-in-sky/
2. Community instrument registry, note counts, octave ranges, part memberships: https://sky-children-of-the-light.fandom.com/wiki/Instruments
3. Community key/scale mapping: https://sky-children-of-the-light.fandom.com/wiki/Music_Key
4. In-game sheet part roles: https://sky-children-of-the-light.fandom.com/wiki/Music_Sheets
5. Sky Music Nightly, an existing fan composer for baseline/competitive comparison (observe, don't copy): https://sky-music.specy.app/composer and https://sky-music.specy.app/changelog
6. Sky Studio format descriptions, only for interoperability research: https://play.google.com/store/apps/details?id=com.Maple.SkyStudio
7. Current official updates, to check for newly added instruments: https://thatgamecompany.helpshift.com/hc/en/17-sky-children-of-the-light/section/110-patch-notes/

Create `docs/sky-mechanics.md` with a **fact table**: mechanic, observed rule, source URL, confidence (verified / community-reported / inferred), implementation consequence, and any uncertainties. Do not claim undocumented behavior is exact. If browsing is inaccessible, proceed with the known rules and explicitly mark verification gaps; research must not block implementation.

Important starting facts to validate:

- Most pitched instruments use a **3-by-5 grid of 15 diatonic notes**, covering two octaves (degree sequence 1,2,3,4,5,6,7,1,2,3,4,5,6,7,1). The default C-major mapping is C D E F G / A B C D E / F G A B C.
- Some percussion instruments use **8 pads**; a special case uses **4 pads**. Percussion can be unpitched, or use instrument-specific pitched patterns; bells/handpans are NOT interchangeable with generic 15-note keyboards.
- Sky has a set of 12 major keys. Selected in-game music sheets / environmental background music can change the key. Model global key selection; do not falsely simulate continuous world-dependent automatic updates from a browser.
- Pitched instruments have differing base octaves. Some permit **held/sustained notes**, others have short one-shot envelopes. Infer nothing about precise duration caps or simultaneous-note limits without verification.
- Native game sheet parts: **Melody, Wind, Bass, Percussion**. Instrument classification and sheet-part mapping are important. In-game sheets use timed visual cues (growing inner/outer note boxes and traveling beat indicator), not a traditional five-line staff.
- There is a distinction between playing **existing in-game sheets** and a fan editor's **custom compositions**; don't pretend external JSON/MIDI is importable as an official in-game sheet without verified support.

## 2. Technical direction (simple, maintainable, no overengineering)

Use **Vite + React + TypeScript**. Choose a lightweight state store (e.g. Zustand) only if helpful. Implement a clean responsive design using CSS variables / ordinary CSS or a small styling library; no giant UI framework needed. Prefer native **Web Audio API** scheduling with `AudioContext` and `OfflineAudioContext` so live playback and audio export share the same note-rendering logic. Use small, well-maintained open-source packages when they materially help (such as a reliable MIDI writer and MP3 encoder) and document licenses.

Suggested separation:

- `src/music/` — Sky pitch maps, instrument registry, validation, timeline and note transformations.
- `src/audio/` — low-latency transport, synthesis/sample engine, mixing, FX, offline export.
- `src/editor/` — timeline, piano roll, track list, performance pad, editing tools.
- `src/practice/` — individual-part guided performance, cue scheduler, visual sheets.
- `src/storage/` — local projects, schema versions/migrations, import/export/sharing.
- `src/components/` — reusable UI.
- `docs/` — game-mechanic research, sound attribution/licenses, project format and user guide.

**No external server is required for the basic product.** Use IndexedDB or an equivalent reliable local store and a static hosting deployment. For share links, serialize and compress projects into a URL fragment for reasonably sized compositions. Show a real size warning/fallback to a portable project file for songs too large to fit a robust URL; do not lie about universally shareable large songs. Avoid unnecessary APIs and database services.

## 3. Versioned instrument registry and exact playable notes

Create one **data-driven instrument manifest** with at least:

`id, displayName, category, nativeSheetPart, keyCount, padLayout, noteMapping, baseOctaveOrPitchMap, supportsHold, soundProfile, renderingMode, sourceEvidence, confidence, status`.

Use the verified catalog rather than a hardcoded handful. Investigate instruments/variants such as Harp, Fledgling Harp, Piano Keyboard, Grand Piano and variants, Guitar, Rhythm Guitar, Ukulele, Electric Guitars, Lute, Kalimba, Xylophone, Winter Piano, Flute, Panflute, Bugle, Horn, Manta Ocarina, Vessel Flute, Harmonica, Saxophone, Violin, Voice of AURORA, Cello, Duets Cello, Contrabass, Small/Large Bell, Handpans, Drum/Prophecy/Fortune Drum, Cymbals, and other currently listed playable instruments. **This is a research checklist, not an assertion that every item shares a note layout or is still current.** Handle instrument variants and unsupported/uncertain cases honestly.

Requirements:

- Instrument choice changes available pad positions, pitch frequencies, octave, sustain behavior and actual rendered timbre.
- Each note stores a **physical pad index** plus time/duration, not just MIDI pitch. Pitch is derived from `(instrument, musical key, pad)`; this preserves game-realistic 15-key transposition and percussion mapping.
- Store musical key with the project and render it consistently across all tracks; support all **12 major keys** using the correct semitone pattern. Allow a user to change key and hear the new result, without silently making a track chromatic.
- Enforce exact supported pads in UI, validators, import, and export. No notes outside each instrument's playable grid.
- Distinguish continuous/sustained from percussive/one-shot playback. Unsupported hold lengths should be clamped/rejected with a clear warning only where evidence supports limits.
- Multiple virtual performer tracks may use the same part/instrument; the strict restriction applies to **each individual track**, not to the number of layered performers.
- Include a browsable/searchable instrument catalog with **measured coverage**: playable, approximate sound, or research pending. Do not quietly substitute the same piano sample for everything.

## 4. Sky-style performance keyboard

Make the keyboard genuinely playable:

- 3 x 5 pad arrangement for common instruments, correct 8/4-pad layouts where appropriate.
- Mouse, multi-touch, and customizable desktop keyboard bindings. Provide a familiar default based on Sky PC if verified, and allow rebinding to avoid keyboard-layout issues.
- Multiple simultaneous touches/keys, instant visual response, keyboard focus handling, no page-scroll/shortcut conflicts, and robust stuck-note prevention on blur/pointer cancel.
- Show numbered pads (1–15 / 1–8 / 1–4) and optionally note names/frequencies appropriate to the key. The grid must visually match the corresponding timeline rows.
- Live perform, record into selected track, overdub where feasible, optional metronome and count-in, quantize with preserve-original-timing option, latency calibration or offset setting if needed.
- Provide convenient audition/sound testing of each catalog instrument and a reasonable virtual reverb option (clearly an approximation).

## 5. Multi-track timeline / piano roll (primary workflow)

The app should feel like a **real, pleasant-to-use mini DAW** rather than a decorated table.

- Add, remove, duplicate, rename, reorder, color, mute, solo, volume-balance and select tracks. Choose a Sky instrument and see its native category and valid pad rows.
- Time ruler with measures/beats, BPM (e.g., 40–240), meter, snapping/subdivisions, zoom and horizontal/vertical scrolling; optional loop region.
- Insert/remove notes via click/tap; drag to move notes in time/pad; resize only if that instrument supports holds; box select, multi-select, delete, copy/paste, duplicate, cut, and useful keyboard shortcuts.
- Grid displays **only actual playable pads** for the selected track; avoid a normal 88-key piano roll or allowing out-of-scale pitches in strict mode.
- Play/pause/stop, seek, looping, visible playhead, ruler following, good scrub behavior. Use deterministic beat-to-time mapping with no cumulative drift.
- Undo/redo for all meaningful edits. Dirty state, autosave/recovery and informative save status.
- Mix many tracks without noticeable drift: use an audio-clock-based look-ahead scheduler, never use React render frames or naive `setInterval` timing as the audio clock. Keep visual playhead synced to audio time.
- Provide example **original** multi-part compositions (e.g. Melody + Wind + Bass + Percussion), not copyrighted Sky songs or recognizable commercial music.

## 6. Practice modes and real-world in-game performance guides

This is a key differentiator. Every track represents one **human player** playing one instrument **in the actual game**.

- Select any track => **Practice This Part**: hide or dim others, optional accompaniment audio, pad highlights timed to its events, adjustable practice tempo without changing composition, loop range, seek, count-in and metronome.
- Implement an optional **Sky-like cue visualization** inspired by the official mechanics: expanding inner box toward outer box for upcoming note, plus a traveling timing cue. Use your own graphic design and verify timings. Distinguish original recreation from verified exact behavior.
- Show readable step-by-step numbered grid sheets and an animated performance guide, with a clear **player assignment card** listing instrument, song key, BPM, start offset, pad layout, timestamps/measures and notes. For multiple simultaneous performers, generate one guide per track and a combined conductor/count-in overview.
- Offer printable/shareable **PDF or SVG/PNG performance guide** if feasible; at minimum provide high-quality print CSS and exportable per-player guide as a standalone printable HTML view. Do not claim nonexistent PDF support.
- Support a standardized start/count-in so multiple players can manually perform together in Sky. Make it obvious that this guides players **manually** and is **not** official in-game custom-sheet import or bot/macro gameplay automation.
- Optional practice accuracy feedback (hit/miss/early/late) is a stretch goal, not a substitute for accurate synchronized playback.

## 7. Audio quality and legal asset strategy

Audio accuracy is a product priority but must be honestly scoped.

- Research sound sources, license terms, attribution, and redistribution permissions. Keep `docs/audio-sources.md` with license, author, URL, required attribution and instrument mapping. Do **not** rip, hotlink without permission, redistribute proprietary game samples, or scrape protected assets.
- Build distinct, original synth/sample **sound profiles per instrument family and instrument**, accounting for attack/decay/sustain/release, harmonic content, register, pitch, dynamics, optional ambient/cave reverb, and percussive transients. Prefer properly licensed samples where allowed; otherwise synthesis that is transparent about being an approximation.
- Implement anti-click envelopes, voice management, simultaneous-note mixing, sensible master limiter/peak headroom, track gain and no clipping. Unlock/resume AudioContext after user gesture.
- A quality-first playable baseline for **all registry instruments** is mandatory, even if some are marked sonic approximations. Improve important profiles (piano, harp, guitar, flute, drums, cello, violin) first. Distinct instruments should not all sound identical.
- Avoid huge downloads; lazy-load and cache optional samples. Handle missing samples gracefully. Test in Chrome and one other browser where possible.

## 8. Project persistence, sharing, import/export

Define versioned, documented `.json` (or `.skymusic.json`) project data and input validation. Suggested structure:

```ts
interface Project {
  schemaVersion: number;
  id: string;
  title: string;
  bpm: number;
  timeSignature: [number, number];
  key: number; // 0..11, C..B major; document tonic representation
  tracks: Array<{
    id: string;
    name: string;
    instrumentId: string;
    volume: number;
    muted: boolean;
    notes: Array<{ id: string; pad: number; startBeat: number; durationBeats: number }>;
  }>;
}
```

Adjust schema if research requires more data. Keep immutable note IDs, time in musical beats, round-trip stability and schema migration. Validate on input and reject malformed or too-large files safely.

- **Browser save/load:** local project library, rename/duplicate/delete, autosave, explicit import/export; reload preserves all tracks, tempo, key, notes and preferences.
- **Sharing:** compressed shareable view/edit link for realistic small/medium project sizes, working through normal static hosting; option to download/upload project files for longer songs. Provide share link copy action and verify roundtrip.
- **WAV:** genuine full multitrack stereo render with accurate tempo and tails via offline audio engine. User can listen to the exported file.
- **MP3:** actual encoded MP3 (not a WAV file with `.mp3` extension), with correct metadata/format basics and licensing for encoder.
- **MIDI:** Type-1 multitrack MIDI file with tempo, tracks, events, correct pitch and timing; use GM percussion conventions where meaningful, retaining instrument/part metadata if possible. Explain that exported MIDI can contain notes that a standard DAW plays differently because of soundfont/patch differences.
- **Compatibility:** investigate Sky Studio / Sky Music Nightly JSON, TXT, or `.skysheet` interoperability. Support import/export only when publicly documented and technically verifiable; **not a release blocker**. Do not claim official Sky import.
- **No dependence on paid SaaS or private APIs.**

## 9. UI and product experience

Design an original immersive dark/light twilight aesthetic: soft gradients, glows, legible typography, rounded panels, subtle animated notes and calm responsive transitions. It should evoke the tranquility of the game without copying its assets.

Recommended layout:

1. Top bar: project name, save/share/export, settings/help.
2. Transport: play/pause, stop, record, BPM, meter, key, metronome, loop, undo/redo.
3. Left sidebar: track list and instrument picker, solo/mute/volume.
4. Center: aligned multi-track DAW timeline with editor, beat grid, draggable notes and playhead.
5. Bottom: playable Sky-style grid for the selected instrument, contextual guidance and note names.
6. Practice mode: focused full-screen guide with one player's notes and accompaniment controls.

High-quality details: polished loading/empty/error states, audio unlock prompt, tooltips, keyboard shortcut reference, a guided first-run sample, accessible controls and focus indicators, touch targets, no accidental browser scrolling while playing. Avoid overcrowding mobile: use tabs/expandable panels while keeping keyboard and practice usable. Responsive layout should remain usable at 390px width.

## 10. Phased execution (you must WRITE WORKING CODE, not just plans)

Proceed autonomously and test as you go. Keep `TASKS.md` with checkboxes, `docs/decisions.md` with concise decisions, and `docs/known-gaps.md` for unverified mechanics/audio limits. Do not make the user answer routine implementation questions.

### Phase A — research, foundation, and vertical slice

- Verify mechanics and source references; enumerate instruments and exception types.
- Scaffold app, create reusable music core and versioned project format.
- Render responsive shell, instrument picker, 15/8/4 pads and functional basic sound profiles.
- Prove a short 4-track piece plays concurrently with correct key/pad mapping, play/pause/seek.

### Phase B — high-quality editor

- Complete full instrument catalog and correct supported grids.
- Implement selected-track piano roll, note editing, track management, transport, loop, BPM/meter/key, record, metronome, undo/redo.
- Add saving, autosave recovery, imports and a compelling demo song.
- Inspect actual visuals in a browser and fix obvious layout/interaction defects, rather than trusting compilation alone.

### Phase C — practice, polish, and real exports

- Complete individual track performance practice and guided Sky-like cues.
- Finish original sonic profiles, timing and multitrack mixing.
- Implement and **test** real WAV/MP3/MIDI/project exports, and sharing links.
- Add accessibility, responsive/mobile behavior and documentation.

### Phase D — verification and release

- `npm install`, `npm run dev`, `npm run build`, tests and lint should succeed (include scripts).
- Use Playwright or comparable automated real-browser checks, plus music-core unit tests.
- Test all instrument registry mappings with assertions, including 15-note and 8-/4-note special cases, octave/range, key transposition and invalid-pad rejection.
- Test scheduling on a simultaneous four-track chord, stop/seek/loop, note-off/held notes, save/reload fidelity, undo/redo, share link roundtrip, WAV & MP3 decoding, MIDI multitrack parsing.
- Verify the exported WAV/MP3 has nonzero audible content for a full example and reasonably stable duration; verify correct file header and sample format, not just download behavior.
- Test UI at desktop and mobile screen widths; document any limitations.
- Run the app and provide a short, factual delivery report with commands, paths, completed features, remaining sound approximations, mechanics uncertainly and known issues. Don't mark pending tasks complete.

## 11. Testable acceptance criteria

The project is **done** only when a user can:

1. Open it in a browser, start a new song and choose from the researched playable Sky instrument catalog.
2. Select Harp on track 1, Flute on track 2, Cello on track 3 and Drum on track 4, with each track showing its **own correct, instrument-specific** playable pad count and pitch/sound characteristics.
3. Compose using mouse/touch in a piano roll and play/record the actual Sky-like grid with keyboard/touch.
4. Hear all four tracks perfectly synchronized during play/seek/loop, and see synchronized notes/cue animations.
5. Switch from C major to a different real Sky major key and get consistently remapped playable pitches, without out-of-scale notes.
6. Save, reload, edit and undo notes with no lost data.
7. Solo a track and follow its player-specific guide; generate a set of individual manual in-game guides and a shared start/count-in for a group.
8. Export a playable WAV and MP3, multitrack MIDI and full project JSON; import the saved project back unchanged.
9. Generate a working static URL share link for a reasonably sized song, and receive a clear file-sharing fallback for oversized projects.
10. Use the editor smoothly on a desktop and practice mode comfortably on a phone.

## 12. Constraints, honesty, priorities

- Highest priorities, in order: **correct Sky mechanics > synchronized audio > functional editing > guided multi-player performance > reliable exports > polished UI > optional extras**.
- Do not add multiplayer, accounts, social feed, generative AI music, paid cloud services, or automation that presses keys in the real game.
- Do not waste time seeking pixel-perfect copied Sky screens or proprietary samples. Create an original fan-inspired design.
- Be explicit in documentation and UI when sound is an original approximation rather than a game recording, and when features are 'inspired by' rather than verified Sky mechanics.
- If web research is blocked, document the gap and implement the best supported fallback; don't stall.
- Prefer finishing a fully tested end-to-end experience over sprawling partial features. However, the **full catalog and core deliverables above are release requirements**; honestly list any unmet acceptance criteria.
- Keep code understandable to a solo developer; avoid excessive abstractions.

**Begin now. Inspect the working directory, research the Sky rules, establish the source-backed catalog, implement the app, run it in a browser, iterate until core acceptance criteria pass, and give a concise final report.**
