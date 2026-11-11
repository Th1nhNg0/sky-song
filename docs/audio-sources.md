# Audio sources, licenses, sound packs and the synthesis approach

## Summary

Two sound paths exist, and the UI always says which one an instrument is using:

1. **Original synthesis (the default).** Every built-in sound is generated at
   runtime by the original Web Audio code in `src/audio/synth.ts` and mixed by
   `src/audio/graph.ts`. No game audio is included. These remain **approximations**,
   labelled as such in the catalog, Settings and docs.
2. **Optional sound packs from your own game.** You can record notes from your *own*
   copy of the game, load the WAV/MP3/OGG files in Settings, let the app slice a
   played scale at onsets and detect each note, correct the mapping, and play those
   recordings. Packs are stored only in this browser (IndexedDB) and are never
   uploaded. A recorded note that is played at its recorded pitch is exact; other
   notes are pitch-shifted approximations.

**The project includes 45 versioned sound packs containing 916 samples** in
`public/sound-packs/`. Each pack is rendered through the
installed game's own FMOD banks and `fmodstudio.dll`, one recording per key or pad, so
it keeps the game's layered attacks, variant choice, envelopes and relative loudness.

At dev-server startup and build time, Vite generates `manifest.json` from the
`.skypack.json` files in that directory, naming the instrument each pack plays. Both
dev and production preview read these same packs from the app's own origin and cache
them in IndexedDB. Existing disabled packs stay disabled; newer browser edits are
preserved. A checkout with no personal packs uses the synth. No external audio
service is contacted and nothing is uploaded.

In the repository the packs are JSON with the audio as text, about 285 MB in all. A
build does not ship them that way. It rewrites each one as a `.skyaudio` file
(`scripts/compactSoundPacks.ts`), which holds the same 16-bit audio packed without
loss, and names the file after its contents so instruments that play the same
recordings share it. The built packs come to about 58 MB in 34 files, the largest
under 8 MB, and every sample unpacks to exactly the values in its JSON. The dev
server serves the JSON files as they are.

Even so, a pack is fetched only when its instrument is needed: when a song that uses it is opened, when it is auditioned in the picker, or
when it is chosen in Settings. Play waits for the song's packs so the first note is
the recorded one, for at most 8 seconds; on a slow connection the song then starts
on the synth and each instrument switches to its recording as its pack arrives.
The audio context itself is started inside the tap or key press and never waits on a
download, because phones only let sound begin within a gesture. A manifest entry
without an `instrumentId` is read up front, as every pack once was.

Builds include the same audio in `dist/sound-packs/`, packed as described above. The
source packs and their manifest are tracked in Git; generated `dist/` is ignored. To add
or replace a pack, put its `.skypack.json` file in `public/sound-packs/` and restart
dev or rebuild. You can still use **Settings → Import pack files** for packs kept
only in one browser.

Every instrument now plays game audio, and the packs follow the game's own data. Each
prop's `SocialInstrument` type and `sub_type` in `OutfitDefs.json` select a sample
family through the lookup in `Sky.exe`, and the shop names in `Localizable.strings`
identify the variants:

| App instrument | Game prop | Samples |
| --- | --- | --- |
| Drum | `Prop_Drum` | `Percussion` |
| Prophecy Drum | `AP08Dundun` | `Dundun` |
| Triumph Drum | `AP08Dundun_02` | `GoldDundun` |
| Handpan | `AP07HandPan` | `Handpan` |
| Triumph Handpan | `AP07HandPan_02` | `GoldHandpan` |
| Small Bell, Large Bell | `AP02Bell_01`, `AP02Bell_02` | `APBell1`, `APBell2` |
| Winter Piano (Rhythm Snow Piano) | `APPiano_01` | `APPiano` |
| Grand and Fledgling Upright Pianos | `AP23PianoAnims` | `GoldPiano` |
| Light, Electric and TGC Guitars | `AP14Guitar_01`, `_02` | `LightGuitar` |
| Rhythm Guitar | `AP04Guitar_02` | `Guitar` |
| Moonlit Lute | `MoonlightLute` | `Pipa` |
| Violin, Triumph Violin | `Violin` | `Violin` |
| Transverse Flute, Vessel Flute | `AP29Piccolo` | `AP29Piccolo` |
| Trumpet (Triumph Horn) | `AP10Bugle_02` | `GoldBugle` |

The game has one ukulele sound, so Toy Ukulele shares `Ukulele`. `GoldGuitar` is in the
sound bank, but no prop plays it. The game's text uses "Vessel Flute" for the Ocarina;
the catalog entry with the 修繕者笛 alias is the Mender's Flute. Tuned Krill Horn has no
game equivalent: its pack is the one `AP15DarkHorn` blast, strongest at F3, and the
other pads pitch-shift it.

The render sets `menuPitch` to each key's semitone above the instrument's low key, or
to the pad number for drums, bells and handpans. All packs share one gain, so the
game's balance between instruments is preserved. Every melodic recording was checked
against its catalog note; Xylophone bars and bells are inharmonic, so their pitch
labels are nominal. Bells, handpans, drums and cymbals vary from hit to hit in the game, so their packs keep
up to six distinct takes per pad and the app rotates through them. Rendering each key
repeatedly showed 23 other events play the same audio every time. Light Guitar has up
to three takes on some keys, and its packs keep those too.
Recordings that are still sounding at 6 seconds loop for as long as the note is held,
with a crossfaded seam. The samples have no loop points of their own, and the Violin
and AURORA renders show no fixed repeat, so there is no game loop length to copy. The bells were matched by the bounding boxes in the game's
meshes: `AP02Bell_02` is the larger prop.

The Light, Electric and TGC Guitar packs have their quiet lead-ins trimmed (up to
0.19 s), with a 5 ms fade at the new onset, so short held notes are audible before their release.
Pack version timestamps ensure cached browser copies update after deployment.

## How to get exact sound (step by step)

Exact game timbre can only come from the game's own recordings. Use your own
recording of your own game session:

1. **Capture only your own gameplay.** Use OBS, QuickTime, your phone's screen
   recorder or an audio interface. Do not download other people's recordings, game
   files, data-mined assets or “Sky soundfonts”, and do not redistribute the result
   as a sample library. Check thatgamecompany's terms and your platform's rules
   before sharing anything.
2. **Make the recording clean.** Reduce in-game music/ambience and other players or
   go to a quiet area. Mute notifications. Record at 44.1 or 48 kHz; WAV is the
   safest format (MP3/OGG also work where the browser can decode them).
3. **Play one scale, one note at a time.** In the game, choose the instrument and
   play a full scale from its lowest pad upward. Hold each note for roughly one to
   two seconds and leave about 0.3–0.6 s of silence between notes. Keep the same key
   and register; do not play chords.
4. **Open Settings → Instrument sounds & sample packs.** Select the instrument,
   choose **One recording of a played scale**, and load the file.
5. **Check the auto-slices.** Adjust the onset threshold and minimum gap if a note
   was split or merged. The pitch detector fills in each note; correct any octave or
   semitone error with the −/+ buttons or the MIDI field. Preview each slice.
6. **Save the pack.** It is written to IndexedDB in this browser only. Nothing is
   sent anywhere. The catalog badge changes from “synth” to “recorded pack”.
7. **Back it up.** Use **Export** to download a `.skypack.json` file containing your
   own recordings, and **Import pack file** to restore it on another browser or
   machine.
8. **For exactness at every pad, record every pad.** The engine uses the nearest
   recorded note and pitch-shifts it with a playback-rate change. A matching note
   plays at rate 1 (exact); a shifted note is a practical approximation (large
   shifts change formants and character). The mapping table in the panel shows
   “exact recording” or the number of shifted semitones per pad.
9. **Project files do not contain audio.** A `.skymusic.json` or share link only
   contains notes and settings; a collaborator needs their own pack file.

The app does not record the game for you (no screen capture, no automation, no
memory reading). It only decodes and slices files you provide.

## Sample pack format

A pack is a local object with an instrument id and a list of samples. Each sample
stores: original MIDI note (manually correctable), detected note and confidence,
source offset/duration in the recording, playback gain, native sample rate and
channel-major PCM. A `.skypack.json` backup stores the same metadata plus 16-bit
PCM (base64) per channel; import validates the format, version, instrument, sample
count and sizes. Limits: 128 samples/pack, 12 s/sample, 96 MB/file.

Storage is the separate IndexedDB database `sky-music-studio-sounds` (store
`packs`). If a browser exposes no IndexedDB at all, packs work for the session in a
memory store and the UI warns that they will not survive a reload. If IndexedDB is
present but blocked or full, saving reports an error instead of pretending to save.
Audio is never written to localStorage, the repository or a server.

## Live playback and export share one path

`createNoteVoice` (`src/audio/synth.ts`) checks the active pack first. If a sample
matches, `createSampleVoice` (`src/audio/sampleVoice.ts`) schedules an
`AudioBufferSourceNode` with a playback-rate pitch shift. Otherwise the same
function schedules the synth profile. The exact same `createNoteVoice` is used by:

- the realtime `AudioContext` in `src/audio/engine.ts`, and
- the `OfflineAudioContext` in `src/audio/render.ts` for WAV and MP3.

So a project with samples renders those samples into the export; an instrument
without a pack falls back to the synth in both places. Sound packs must be in the
bank before scheduling, which `AudioEngine.init()` and `renderProject()` ensure.

## Sound pack privacy and the project rule

- Browser imports live in IndexedDB; there is no upload endpoint.
- Backup/import is a manual file the user controls.
- Project packs in `public/sound-packs/` are tracked in Git and included in builds.
  A fresh clone restores them; both dev and preview load the same files.
- User recordings can be personal data or third-party content; the user is
  responsible for rights, and the UI tells them not to redistribute others'
  recordings.

## The reworked default synthesis

The owner's complaint was that the instruments did not sound like the game. The
default synth was reworked around the qualities that read as “Sky”: a soft attack,
a warm rounded body, a long airy release and a large cave-like reverb. It is
**still original synthesis, not a recording**, and the app says so everywhere.

Measured targets are checked by `tests/audio-targets.test.ts`; the test writes a
real 44.1 kHz/16-bit stereo WAV for **every** profile (`all-<profile>.wav`) and a
measured one for the headline instruments to `test-results/audio-wavs/`
(gitignored), plus `measurements.json`. The generated test-tone pack phrase is
`generated-pack-phrase.wav` in the same folder. Current results:

| Instrument | Spectral centroid | Attack (to 50%) | Decay (to −30 dB) |
|---|---|---|---|
| Harp | ≈ 856 Hz | ≈ 9 ms | ≈ 3.15 s |
| Piano | ≈ 927 Hz | ≈ 4 ms | ≈ 4.25 s |
| Flute | ≈ 2446 Hz | ≈ 46 ms | ≈ 1.48 s (incl. hold + release) |
| Horn | ≈ 793 Hz | ≈ 46 ms | ≈ 1.25 s (incl. hold + release) |
| Bell | ≈ 1226 Hz | ≈ 2 ms | ≈ 6.10 s |
| Handpan | ≈ 610 Hz | ≈ 8 ms | ≈ 4.09 s |
| Drum (snare voice) | ≈ 5606 Hz | ≈ 3 ms | ≈ 0.14 s |

Targets are ranges, not “the game's values”. They catch regressions such as a thin
bright patch, an instant attack, a short pluck or a click. CPU cost also rose: a
profile can use 2–3 detuned copies per partial plus a noise bed.

What changed in the profiles:

- **Harp / Piano / Grand / Bright Piano / Guitar / Ukulele / Pipa / Lute /
  Kalimba / Contrabass:** longer natural decays, sub-octave body partials, lower
  low-pass cutoffs, filter “bloom” at the start, a quiet tail after the decay and a
  little stereo ensemble.
- **Flute / Panflute / Ocarina / Horn / Bugle / Trumpet / Saxophone / Harmonica /
  Violin / Cello / Voice:** longer attacks and releases, sustained air/breath noise,
  lower cutoffs, vibrato and ensemble spread; wind hold limits were raised from
  ~1.4 s to 4 s.
- **Bell / Handpan / Xylophone:** inharmonic partial sets with stronger upper
  partials, long decays and tails; the bell's main decay is ~7.5 s to −34 dB
  (plus a 1.8 s tail) rather than ~3 s.
- **Drum / Cymbals:** longer kick body and snare room, crash tail raised to 2.4 s,
  quiet tail after the transient.
- **Reverb:** the procedural impulse grew from 2.1 s to ~5.2 s with a 28 ms
  pre-delay, damped diffuse tail, early reflections and stereo decorrelation. Bus
  sends are lifted (with the same 0–100% user control) so the default mix sits in a
  large space rather than a dry room. This is an original synthetic cave, not a
  sampled Sky area. WAV/MP3 exports keep a 9.5 s tail by default so long bell/harp
  decays and the reverb are not cut off.

The Node tests measure a pure-JS numeric mirror (`src/audio/offlineRender.ts`) of
the same profile data because Node has no Web Audio. The browser's live and export
paths use the shared `createNoteVoice` Web Audio function. The Playwright test
“records a user sound pack: slices, detects, persists, plays and exports” covers the
real browser flow end to end: it generates a synthetic played-scale WAV (no game
audio), loads it through More → Settings → Sounds, checks eight detected slices and
MIDI notes, saves the pack, confirms the catalog badge, reloads and verifies the
pack is still in IndexedDB, auditions it (a sample voice is created), and exports a
WAV with nonzero audio (sample voices also run during the offline render).

## Instrument → synthesis profile map

All profiles are original. The table documents the intended character, not a claim
of exact game timbre.

| Catalog instruments | Profile family | Synthesis character |
|---|---|---|
| Harp, Fledgling Harp | `harp` | Soft triangle/sine partials, sub body, long warm decay, pluck air |
| Piano, Fledgling Upright Piano | `piano` | Inharmonic partials, soft hammer noise, long decay, warm cutoff |
| Grand Piano, Grand Piano (White) | `grand-piano` | Longer/darker partials, stronger low body |
| Winter Piano | `bright-piano` | Brighter upper partials, shorter decay, one octave up |
| Guitar, Rhythm Guitar | `guitar` | Triangle partials, soft pluck, medium decay |
| Light Guitar, Electric Guitar, TGC Guitar | `electric-guitar` | Sustained detuned saw partials, soft saturation, mild vibrato |
| Ukulele, Toy Ukulele | `ukulele` | Short warm pluck |
| Pipa | `pipa` | Faster metallic pluck, upper partials |
| Moonlit Lute | `lute` | Warmer, shorter pluck (research-pending variant) |
| Kalimba | `kalimba` | Sine partials at 1/3/5/7, soft metallic tick |
| Xylophone | `xylophone` | Inharmonic struck bars, short decay |
| Violin, Triumph Violin | `violin` | Sustained bowed ensemble, breath, longer release |
| Cello, Duets Cello | `cello` | Low sustained bowed ensemble, air |
| Contrabass | `contrabass` | Dark low pluck with long tail |
| Voice of AURORA | `voice` | Sustained formant-like choir ensemble; not an AURORA recording |
| Horn | `horn` | Warm brass with breath, bloom and a long release |
| Bugle | `bugle` | Brighter brass variant |
| Trumpet | `trumpet` | Brighter brass with a softer bloom |
| Flute, Vessel Flute | `flute` | Breathy sine with air bed and vibrato |
| Panflute | `panflute` | Breathy hollow pipe |
| Ocarina, Manta Ocarina | `ocarina` | Mellow sine pipe |
| Saxophone | `saxophone` | Sustained reed-like saw, breath, vibrato |
| Harmonica | `harmonica` | Sustained detuned square reeds, beating |
| Small Bell, Large Bell | `bell` | Inharmonic metallic partials, very long decay |
| Handpan, Triumph Handpan | `handpan` | Inharmonic metallic struck partials, long warm tail |
| Drum, Prophecy Drum, Fortune Drum | `drum` | Membrane pitch drops + roomy noise transients (unpitched) |
| Cymbals | `cymbal` | Filtered noise/metal crashes with a cave tail (unpitched) |

Distinct variants can share a documented timbre family; the catalog says so.
Register, detune and reverb-send differences provide variation.

## Research sources (facts only, not assets)

The instrument catalog, pad counts, sheet parts and sustain behavior were informed
by public research. No content from these pages was copied into the app:

- Official help center, “How do I use Music Sheets in Sky?”:
  <https://thatgamecompany.helpshift.com/hc/en/17-sky-children-of-the-light/faq/1345-how-do-i-use-music-sheets-in-sky/>
- Official patch notes index:
  <https://thatgamecompany.helpshift.com/hc/en/17-sky-children-of-the-light/section/110-patch-notes/>
- Japanese Sky community wiki, instrument table and mechanics:
  <https://wikiwiki.jp/sky-jp/楽器一覧>
  <https://wikiwiki.jp/sky-jp/楽器・楽譜など演奏関連>
- Fandom Sky Wiki pages (blocked by Cloudflare in this environment; only search
  snippets were used):
  <https://sky-children-of-the-light.fandom.com/wiki/Instruments>
  <https://sky-children-of-the-light.fandom.com/wiki/Music_Key>
  <https://sky-children-of-the-light.fandom.com/wiki/Music_Sheets>
- Sky Music Nightly changelog (instrument freshness / sustain changes):
  <https://sky-music.specy.app/changelog>
- `specy/genshin-music` public metadata/presets (AGPL-3.0 project; inspected only
  for factual note counts, pad offsets, register octaves and sustain flags; no code
  or assets copied):
  <https://github.com/specy/genshin-music>
- Sky Studio store listing (interoperability context only):
  <https://play.google.com/store/apps/details?id=com.Maple.SkyStudio>

See [`docs/sky-mechanics.md`](sky-mechanics.md) for the detailed source/confidence
table and the exact consequences for this app.

## Third-party software licenses

The app uses these runtime libraries:

| Package | Version | License | Use | URL |
|---|---|---|---|---|
| `react` / `react-dom` | 19.3.1 | MIT | UI | <https://github.com/facebook/react> |
| `zustand` | 5.0.16 | MIT | state store | <https://github.com/pmndrs/zustand> |

Development/test-only libraries (not shipped in the app bundle except test code):
`@tonejs/midi` (MIT, MIDI reading and writing), `vite` (MIT), `typescript` (Apache-2.0),
`eslint` (MIT),
`typescript-eslint` (MIT). See `package.json` for the pinned versions.

## Honest audio limitations

- The default synth cannot match the game's recorded instruments note-for-note. It
  is an approximation with per-family character and register.
- A user pack is exact only at recorded pitches. Pitch-shifted notes are resampled
  and lose formants/character, especially beyond ±2 semitones. A long held note may
  outlast a short recording; the sample does not currently loop.
- Onset detection is amplitude-based; slurred/legato notes or loud background music
  can merge or split slices. Every detected note is manually correctable, and the
  threshold/gap controls are exposed.
- The reverb spaces are synthetic stereo impulses (1.5 s open sky to 8.5 s vault; the
  default cave is 5.2 s), not captured Sky areas. Recordings from a sound pack are
  sent to the space at the same level as the built-in voices.
- Percussion pad voicing, handpan/bell pad order and some octave registers are
  community-reported or inferred; see [`known-gaps.md`](known-gaps.md).
- No latency compensation beyond the measured `AudioContext.outputLatency` +
  user offset is applied.
- MP3 is lossy; WAV is the archival export. The MP3 ID3 comment is a generic
  “Sky Music Studio export — unofficial fan software” string, not a per-project audit
  of which instruments used user packs; listen to the file and check the instrument
  badges if provenance matters. MIDI carries pitch/time but no timbre.
