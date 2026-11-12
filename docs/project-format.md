# Project format — Sky Music Studio `.skymusic.json`

The native project format is a versioned, validated JSON document. Everything the
app needs to reproduce a song is in this file; preferences (master/reverb volumes,
metronome, count-in, snap and zoom) are separate browser preferences.

## Schema v1

```ts
interface Project {
  schemaVersion: 1;
  app: 'sky-music-studio';
  catalogVersion: string;       // e.g. "2026.11.1"
  id: string;                   // stable project id
  title: string;                // 1..120 chars
  bpm: number;                  // 40..240 (rounded on edit): the tempo the song starts in
  timeSignature: [number, number]; // one of 4/4, 3/4, 2/4, 6/8, 5/4, 7/8: the meter it starts in
  tempoChanges?: { beat: number; bpm: number }[];                       // later tempos, by beat
  meterChanges?: { beat: number; timeSignature: [number, number] }[];   // later meters, by beat
  key: number;                  // 0..11 major tonic: C, D♭, D, E♭, E, F, G♭, G, A♭, A, B♭, B
  tracks: Track[];              // 1..24
  loop: { enabled: boolean; startBeat: number; endBeat: number };
  createdAt: string;            // ISO timestamp
  updatedAt: string;            // ISO timestamp
}

interface Track {
  id: string;
  name: string;
  instrumentId: string;         // key in the versioned catalog
  color: string;                // #rrggbb
  volume: number;               // 0..1.5 (clamped on import)
  muted: boolean;
  solo: boolean;
  notes: Note[];
}

interface Note {
  id: string;                   // unique within the track
  pad: number;                  // 0-based physical pad index
  startBeat: number;            // >= 0
  durationBeats: number;        // > 0
  velocity: number;             // 0.05..1
  original?: {                  // preserved timing before an explicit quantize
    startBeat: number;
    durationBeats: number;
  };
}
```

### Why `pad` is canonical

Sky performance instruments are played by physical pad. The same note on the same
pad is a different pitch in a different key. Storing MIDI pitch would lose the
instrument's grid identity and would make key changes, pad validation and MIDI
export inconsistent. The app therefore stores `pad`, plus musical time in beats,
and derives pitch:

```
midi = 12 * (instrument.baseOctave + 1) + key.tonicPc + instrument.pads[pad].semitone
```

The UI displays pad numbers 1-based (1–15 / 1–8 / 1–4). Export MIDI derives the
pitch from the project key at export time.

### Instrument catalog

`instrumentId` must exist in the versioned catalog (`src/music/instruments.ts`,
catalog `2026.11.1` at the time of writing). Unknown IDs are rejected rather than
silently replaced, so a project can never quietly change instrument. The catalog
also declares `keyCount`, `padLayout`, `pads`, `nativeSheetPart`, `supportsHold`,
`renderingMode`, confidence, status, evidence URLs and notes.

### Timing

All note and loop times are in quarter-note beats, independent of tempo. With one
tempo the audio transport converts beats to seconds as

```
seconds = beats * 60 / bpm
```

`tempoChanges` and `meterChanges` are optional. Each entry holds from its `beat` to
the next entry, and `bpm` / `timeSignature` hold from beat 0 to the first one. With
tempo changes, the seconds to a beat are the sum of each stretch at its own tempo
(`Timing` in `src/music/timing.ts`). A file without the two lists means exactly what
it did before they existed, so the schema version is still 1.

On load and on every edit the lists are tidied: sorted by beat, one entry per beat,
entries that change nothing removed, and each meter change moved to the nearest bar
line of the meter before it, because a bar cannot change meter part-way through. An
empty list is left out of the file.

Changing a tempo does not alter stored timings; the transport re-anchors on a live
tempo change. Meters affect measure/beat display, the metronome's accents and the
count-in length, not the stored beat unit.

## Validation and limits

`validateProject()` (src/music/validation.ts) rejects malformed data and reports
field paths. Current limits:

- 1–24 tracks
- ≤ 20,000 notes in the project, on any mix of tracks
- title ≤ 120 chars; track name ≤ 60 chars
- BPM 40–240; supported meters only; key integer 0–11
- at most 256 tempo changes and 256 meter changes; invalid entries are dropped with a
  warning rather than rejecting the file
- note pad must be within the instrument's `keyCount`; times must be finite and valid
- note durations above 512 beats are clamped with a warning (app safety limit)
- import files larger than 5 MB are rejected
- duplicate note IDs within a track and duplicate track IDs are rejected
- a bad/empty loop region is disabled with a warning
- unknown instruments and non-selectable special props are rejected

Import never throws raw JSON into the app: `parseProjectJson()` wraps parse and
validation failures in a descriptive `ProjectImportError` that the UI displays as an
error toast. The current project is left untouched on failure.

## Migration

`migrateProject()` currently handles:

- schema v0 / missing schemaVersion → v1
- missing `app`/`catalogVersion`/`loop` fields → current defaults
- legacy instrument ids such as `piano-keyboard` → `piano`

A project with a newer schema version is rejected with a clear message rather than
being partially loaded. Future schema changes must add a migration step and update
this document.

## Example

A minimal project (one harp note, C major, 90 BPM):

```json
{
  "schemaVersion": 1,
  "app": "sky-music-studio",
  "catalogVersion": "2026.11.1",
  "id": "proj_example",
  "title": "First Light",
  "bpm": 90,
  "timeSignature": [4, 4],
  "key": 0,
  "tracks": [
    {
      "id": "track_example",
      "name": "Harp · Performer",
      "instrumentId": "harp",
      "color": "#8fd3ff",
      "volume": 0.85,
      "muted": false,
      "solo": false,
      "notes": [
        {
          "id": "note_example",
          "pad": 0,
          "startBeat": 0,
          "durationBeats": 1,
          "velocity": 0.85
        }
      ]
    }
  ],
  "loop": { "enabled": false, "startBeat": 0, "endBeat": 16 },
  "createdAt": "2026-10-31T00:00:00.000Z",
  "updatedAt": "2026-10-31T00:00:00.000Z"
}
```

## Interoperability status

- **Implemented and tested:** native JSON, MIDI export, sky-mod song export, and
  Type-1 MIDI import (`src/music/midiImport.ts`, headless via
  `npm run midi2sky -- song.mid`). MIDI carries every tempo and meter change both
  ways. Share links and WAV/MP3 export were removed (D016 in `decisions.md`).
- **Not implemented:** Sky Studio JSON, Sky Music Nightly JSON/TXT, `.skysheet`
  files, official in-game sheet import. These were investigated as optional
  compatibility work; no verified public format was adopted. The app does not claim
  compatibility.
