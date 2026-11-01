# Known gaps and limitations

This is the unvarnished list, current as of the delivery build. Items marked
**unverified** are not claimed to match the game exactly.

## Mechanics / catalog research

1. **Fandom wiki access blocked.** Cloudflare returned HTTP 403 for the English Sky
   Wiki pages (`Instruments`, `Music_Key`, `Music_Sheets`). Facts attributed to them
   come from search-result snippets and were cross-checked where possible against the
   Japanese community wiki and open factual metadata. The full English wiki tables
   were not read.
2. **Percussion pad voicing is inferred.** Which physical pad is kick/snare/rim/etc.
   is not documented. The app uses a musically sensible, original 8-pad voicing. It
   is not claimed to match the game's physical pad layout exactly.
3. **Some octave registers are community-reported.** Winter Piano = Piano + 1 octave
   is explicitly documented; other register differences (Harp C3, Cello C2,
   Contrabass C1, Horn C2, Xylophone C5, etc.) rely on community metadata. They affect
   perceived register, not the strict pad count.
4. **Bell/handpan pad order and relative octaves are partly inferred.**
   - Bells: C D G A / C D G A pattern is verified; which of Small/Large Bell is higher
     is inferred.
   - Handpan: pattern is community-reported; the wiki image showing exact physical
     pad positions could not be read.
5. **4-pad physical layout is community-reported.** Fortune Drum and Cymbals are
   verified as 4-note special percussion (FD part). The app uses a 2×2 grid. Some
   community text is ambiguous about the physical arrangement.
6. **Sustain behavior coverage.** Sustaining instruments: Violin, Electric Guitar,
   TGC Guitar, Voice of AURORA, Saxophone, Cello, Duets Cello, Harmonica, Vessel
   Flute (verified/community), plus Light Guitar, Transverse Flute, Tuned Krill Horn
   (community-reported). Exact hold-duration limits and simultaneous-note limits in
   the game are undocumented; the app only applies its own 16-beat resize safety cap
   and does not claim a game limit.
7. **New 2026 instruments are research-pending.** Moonlit Lute and Vessel Flute are
   listed by the community but only partially verified; Tuned Krill Horn is
   community-reported. The plain “Krill Horn” is intentionally **not** selectable
   because its tuning/layout could not be verified; it is documented as a research
   gap rather than invented.
8. **Jam Station is not simulated.** It is represented as a 4-part × 8-step, fixed-C
   sequencer concept (special, non-selectable). Its exact fixed tempo and step
   resolution are not confirmed.
9. **Dark Horn is a prop, not an instrument.** It is catalogued as a one-sound prop;
   it cannot be selected as a track.
10. **Naming inconsistencies and excluded presets.** Community inventories disagree
    on names such as “Rhythm Guitar” vs “Light Guitar” and on whether some variants
    are separate instruments. The app keeps both entries and labels aliases/caveats
    instead of hiding the ambiguity. Community tools also expose labels such as
    “DunDun”, “Sine Synth”, “Bass Synth”, “TR-909”, and call effects; these are not
    corroborated as ordinary playable Sky instruments and are excluded rather than
    invented.
11. **Automatic regional key changes are not simulated.** Sky changes key by area and
    by sheet; a browser composer cannot know the player's world state. The project
    has one explicit global key that the user chooses. This is documented and is not
    presented as a world simulator.

## Audio

12. **The built-in sounds are original synthesis, not game recordings.** They cannot
    match the actual game timbres exactly; the app labels them as approximations
    everywhere. The default profiles were reworked for a softer attack, warmer tone,
    longer tail and a larger synthetic cave (see `docs/audio-sources.md`), but that is
    a character approximation, not a reproduction.
13. **No game samples, ripped audio, soundfonts or third-party sample libraries ship
    with the app.** The only sample path is the optional sound pack the user creates
    from their own recording. Nothing is downloaded or fetched at runtime.
14. **Reverb is a procedural 5.2 s stereo impulse**, not a captured Sky space.
15. **Percussion voices and some registers are approximations**, as above.
16. **Browser audio support:** Chrome/Chromium is the primary tested target. A Firefox
    smoke check passed (Web Audio playback, note editing, WAV export). Safari
    was not tested in this environment; `AudioContext` unlock/latency behavior can
    differ. Sample-pack file decoding also depends on the browser (WAV is safest;
    some browsers cannot decode OGG/MP3 fixtures).
17. **Sound packs are lazy in the sense that they are user-supplied.** There is no
    bundled sample payload; the initial production bundle remains synth-only (about
    511 KB JS / 87 KB CSS, ≈156 KB / 17 KB gzip). The MP3 encoder is lazy-loaded as a
    separate 169 KB (58 KB gzip) chunk only when exporting MP3. User packs can add
    megabytes of local IndexedDB data depending on how many notes were recorded.
18. **Latency calibration is manual.** The app uses `AudioContext.outputLatency` and
    `baseLatency` plus the user's offset to align the visual playhead with audio; it does
    not run a click-measurement calibration routine.
19. **Peak normalization only on export.** Live playback relies on the master
    compressor and sensible gains; it is not hard-limited per sample like a broadcast
    master. Exported WAV/MP3 are peak-normalised below clipping.
20. **MP3 metadata** is minimal ID3v2.3 (title, artist, album, comment). No cover art.
    Some strict tag readers may interpret the UTF-8 text encoding differently; ffmpeg
    reads it correctly.

## Product scope

21. **MIDI import is exact only for this app's own files.** A file exported here comes
    back note for note, with its tracks, instruments and pads. Other MIDI files are
    arranged onto real game keys: they are transposed to the white notes, capped at six
    parts and four-note chords, and only the first tempo is read. Songs over 20,000
    notes lose their ending, and the app says how many notes were left out.
22. **No Sky Studio / Sky Music Nightly / `.skysheet` interoperability.** This was
    investigated as optional compatibility. No verified public format was adopted,
    so the app does not claim or partially implement it.
23. **No official in-game sheet import, bots, macros, or key automation in the app.**
    It cannot make Sky import a custom sheet. **Export for sky-mod** writes a file for
    the separate sky-mod project, which does the in-game playback; nothing here sends
    input to the game. The file's 4- and 8-pad key layout is unverified in game.
24. **No multiplayer, synchronized editing, accounts, or backend.** By design.
25. **Desktop only.** The editor is laid out for windows 1024 px wide and up. Phones are
    not supported.
26. **Undo keeps 80 steps.** Edits share unchanged tracks and notes, so history stays
    small even on long songs. A whole drag or slider move is one step.
27. **Accessibility is improved but not certified.** Focus-visible styles, labels,
    reduced-motion CSS, focus trapping in modals and keyboard operation are present;
    there has been no formal WCAG audit or screen-reader certification. Some controls
    (very small mini-buttons, dense piano-roll notes) are hard to target by keyboard.
28. **Printing** opens a standalone HTML view; users choose “Save as PDF” in the
    browser print dialog. The app does not generate its own PDF binary. SVG export is
    single-player and caps at 220 displayed steps.
31. **Music rights.** The user is responsible for rights to music they enter.
32. **No cloud backup.** Clearing browser data removes the local library; exporting a
    project file is the backup mechanism.
33. **Browser storage quotas** vary. The app reports storage errors rather than
    silently losing changes, but a very large library may hit quota.

## Verification gaps

34. **Visual pixel comparison against Sky is intentionally not done.** The UI is an
    original fan-inspired design, not a copy.
35. **Audio is verified for non-silence, duration, format and distinctness**, not by
    an expert listening panel or against game recordings. The “quality” claim is
    therefore about a playable, distinct synthesized baseline, not exact fidelity.
37. **Browser tests run in Chromium only.** `npm run test:e2e` covers composing, playback,
    MIDI round trips, reloads, a 20,000-note song and four desktop sizes. Firefox and
    Safari are not part of it.
38. **Load is tested at the 20,000-note limit** on a desktop machine, not on low-end
    hardware. Only notes near the view are drawn, so note count mainly affects saving
    and the overview.
39. **MIDI channel reuse above 15 melodic tracks.** A MIDI file has 15 melodic
    channels after channel 10 percussion; the app supports up to 24 tracks, so
    additional melodic performers reuse channels. The MIDI file remains valid and
    each track has its own name/program change, but some DAWs may merge patch
    assignments for reused channels. Typical 2–8 performer projects are unaffected.
40. **No time-signature changes mid-song.** The project has one meter; the goal did
    not require a meter map. The ruler/count-in follow that meter.

## User-recorded sound packs

41. **A pack is exact only at the recorded pitch.** Notes between recordings are
    pitch-shifted by changing playback rate; this is a resampling approximation and
    loses formants/character, especially beyond ±2 semitones. The pad mapping table
    says which pads are exact and how far each is shifted.
42. **No sample looping for long holds.** A held note longer than the recording simply
    ends; the app does not loop the sustain region yet. Record a longer held note if
    this matters.
43. **Onset slicing is amplitude-based.** Legato/slurred playing, reverb tails, loud
    background music or overlapping notes can merge or split slices. The threshold and
    minimum-gap controls plus per-slice MIDI correction recover most cases, but there
    is no spectral onset detector or undo history for pack edits.
44. **Pitch detection is monophonic and heuristic.** Octave errors are possible for
    bell-like or very breathy notes; every detected note is editable. There is no
    chord/polyphonic detection.
45. **Percussion packs need manual pad assignment.** Pitch is meaningless for drums;
    auto-slicing assigns slices to pads in order as a starting point, and the user can
    correct each row. There is no per-velocity layer, round-robin or release sample;
    repeated notes use the same recording.
46. **Packs are local to one browser profile.** IndexedDB data is not synced or backed
    up automatically. If the browser exposes no IndexedDB, a session-only memory
    store is used and the panel warns that the pack will be lost; if IndexedDB is
    present but blocked/full, saving reports an error. The `.skypack.json` export is
    the user's backup.
47. **Packs are not embedded in project files.** A collaborator hears
    the synth fallback unless they import their own pack. This is deliberate: the app
    does not redistribute game recordings.
48. **The MP3 ID3 comment is generic.** It says “Sky Music Studio export — unofficial
    fan software; see docs/audio-sources.md”, which is not an audit of which
    instruments used user packs. WAV is the archival export; listen to the file and
    check the catalog badges for provenance.
49. **Pack audio is stored unencrypted in the browser.** Anyone with access to the
    browser profile can read it. Do not load recordings you are not allowed to keep.
50. **Timing tests use a fake audio clock.** `npm test` checks the transport's schedule
    against a stand-in engine. The browser tests confirm real playback runs, but do not
    measure what comes out of the speakers. Sound-pack recording has no automated test.
