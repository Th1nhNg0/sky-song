import { createNote, createProject, createTrack, nowIso } from './project';
import { CATALOG_VERSION, PROJECT_SCHEMA_VERSION } from './types';
import type { Project, Track } from './types';

function addNotes(track: Track, notes: Array<[pad: number, start: number, duration: number, velocity?: number]>) {
  for (const [pad, start, duration, velocity] of notes) {
    track.notes.push(createNote(pad, start, duration, velocity ?? 0.8));
  }
}

// All pad numbers below are 1-based scale degrees. C major keeps the Piano
// (C4–C6) under the Violin melody, with Cello on C2 and Harp on C3.
type Line = Array<[pad: number, offset: number, duration: number]>;
type NoteList = Array<[number, number, number, number?]>;
type Chord = 'I' | 'ii7' | 'iii' | 'IV' | 'V' | 'vi';

// Close piano voicings, lowest note first, kept below most of the melody.
const pianoVoicings: Record<Chord, [number, number, number, number]> = {
  I: [1, 3, 5, 8],
  ii7: [2, 4, 6, 8],
  iii: [3, 5, 7, 10],
  IV: [1, 4, 6, 8],
  V: [2, 5, 7, 9],
  vi: [1, 3, 6, 8],
};

interface Bar {
  chord: Chord;
  bass: number;
}

// A stepwise falling bass carries the verse.
const verse: Bar[] = [
  { chord: 'I', bass: 8 },
  { chord: 'V', bass: 7 },
  { chord: 'vi', bass: 6 },
  { chord: 'iii', bass: 5 },
  { chord: 'IV', bass: 4 },
  { chord: 'I', bass: 3 },
  { chord: 'ii7', bass: 2 },
  { chord: 'V', bass: 5 },
];

const intro: Bar[] = [
  { chord: 'I', bass: 1 },
  { chord: 'vi', bass: 6 },
  { chord: 'IV', bass: 4 },
  { chord: 'V', bass: 5 },
];

// The bridge opens on vi, so the end of the second verse lands somewhere new.
const bridge: Bar[] = [
  { chord: 'vi', bass: 6 },
  { chord: 'IV', bass: 4 },
  { chord: 'I', bass: 3 },
  { chord: 'V', bass: 5 },
  { chord: 'vi', bass: 6 },
  { chord: 'IV', bass: 4 },
  { chord: 'ii7', bass: 2 },
  { chord: 'V', bass: 5 },
];

const outro: Bar[] = [
  { chord: 'I', bass: 8 },
  { chord: 'IV', bass: 4 },
  { chord: 'I', bass: 3 },
  { chord: 'I', bass: 1 },
];

const INTRO_BAR = 0;
const VERSE_BAR = 4;
const VERSE_2_BAR = 12;
const BRIDGE_BAR = 20;
const VERSE_3_BAR = 28;
const OUTRO_BAR = 36;
const LAST_BEAT = 156;

const form: Array<[bar: number, bars: Bar[]]> = [
  [INTRO_BAR, intro],
  [VERSE_BAR, verse],
  [VERSE_2_BAR, verse],
  [BRIDGE_BAR, bridge],
  [VERSE_3_BAR, verse],
  [OUTRO_BAR, outro],
];

// Original melody. Each bar is a list of [pad, offsetWithinBar, duration].
const verseOpening: Line[] = [
  [[3, 0, 1.5], [5, 1.5, 0.5], [8, 2, 2]],
  [[7, 0, 1.5], [6, 1.5, 0.5], [5, 2, 2]],
  [[6, 0, 1.5], [8, 1.5, 0.5], [10, 2, 2]],
  [[9, 0, 1], [7, 1, 1], [5, 2, 2]],
];

// The same phrase an octave up for the last verse.
const verseOpeningHigh: Line[] = [
  [[10, 0, 1.5], [12, 1.5, 0.5], [15, 2, 2]],
  [[14, 0, 1.5], [13, 1.5, 0.5], [12, 2, 2]],
  [[13, 0, 1.5], [15, 1.5, 0.5], [13, 2, 2]],
  [[14, 0, 1], [12, 1, 1], [10, 2, 2]],
];

const verseAnswer: Line[] = [
  [[8, 0, 1.5], [9, 1.5, 0.5], [8, 2, 1], [6, 3, 1]],
  [[5, 0, 1.5], [6, 1.5, 0.5], [3, 2, 2]],
  [[4, 0, 1], [6, 1, 1], [9, 2, 1], [8, 3, 1]],
  [[7, 0, 3]],
];

// The second answer climbs higher before settling back.
const verseAnswerHigh: Line[] = [
  [[8, 0, 1.5], [9, 1.5, 0.5], [11, 2, 2]],
  [[12, 0, 2], [10, 2, 1], [8, 3, 1]],
  [[9, 0, 1], [11, 1, 1], [13, 2, 1], [11, 3, 1]],
  [[9, 0, 1.5], [8, 1.5, 0.5], [7, 2, 2]],
];

const bridgeMelody: Line[] = [
  [[8, 0, 1], [10, 1, 1], [13, 2, 2]],
  [[11, 0, 1.5], [12, 1.5, 0.5], [13, 2, 2]],
  [[12, 0, 1.5], [11, 1.5, 0.5], [10, 2, 2]],
  [[9, 0, 1.5], [10, 1.5, 0.5], [9, 2, 1], [7, 3, 1]],
  [[8, 0, 1], [10, 1, 1], [13, 2, 2]],
  [[13, 0, 1], [15, 1, 2], [13, 3, 1]],
  [[13, 0, 1.5], [12, 1.5, 0.5], [11, 2, 1], [9, 3, 1]],
  [[9, 0, 3], [7, 3, 1]],
];

// Flute harmony in thirds and sixths under the bridge melody.
const bridgeHarmony: Line[] = [
  [[6, 0, 1], [8, 1, 1], [10, 2, 2]],
  [[8, 0, 1.5], [10, 1.5, 0.5], [11, 2, 2]],
  [[10, 0, 1.5], [9, 1.5, 0.5], [8, 2, 2]],
  [[7, 0, 1.5], [8, 1.5, 0.5], [7, 2, 1], [5, 3, 1]],
  [[6, 0, 1], [8, 1, 1], [10, 2, 2]],
  [[11, 0, 1], [13, 1, 2], [11, 3, 1]],
  [[11, 0, 1.5], [10, 1.5, 0.5], [9, 2, 1], [6, 3, 1]],
  [[7, 0, 3], [5, 3, 1]],
];

// Flute counter-line a tenth above the falling bass.
const verseCounter: Line = [
  [10, 0, 3], [9, 3, 1],
  [9, 4, 4],
  [8, 8, 3], [7, 11, 1],
  [7, 12, 3], [6, 15, 1],
  [6, 16, 3], [5, 19, 1],
  [5, 20, 4],
  [4, 24, 3], [6, 27, 1],
  [7, 28, 4],
];

function addLine(target: NoteList, bars: Line[], firstBar: number, velocity: number) {
  bars.forEach((bar, index) => {
    for (const [pad, offset, duration] of bar) {
      target.push([pad - 1, (firstBar + index) * 4 + offset, duration, velocity]);
    }
  });
}

function addFlatLine(target: NoteList, line: Line, firstBar: number, velocity: number) {
  for (const [pad, offset, duration] of line) {
    target.push([pad - 1, firstBar * 4 + offset, duration, velocity]);
  }
}

function pianoPart(): NoteList {
  const notes: NoteList = [];
  const chord = (pads: number[], start: number, velocity: number) => {
    for (const pad of pads) notes.push([pad - 1, start, 1, velocity]);
  };
  for (const [firstBar, bars] of form) {
    const strong = firstBar === BRIDGE_BAR || firstBar === VERSE_3_BAR;
    const driving = strong || firstBar === VERSE_2_BAR;
    const level = strong ? 0.68 : driving ? 0.62 : 0.56;
    bars.forEach((bar, index) => {
      const [low, mid, high, top] = pianoVoicings[bar.chord];
      const start = (firstBar + index) * 4;
      if (firstBar === OUTRO_BAR) {
        // The pattern loosens into slow broken chords as the piece comes to rest.
        if (index === bars.length - 1) return;
        [low, mid, high, top].forEach((pad, step) => {
          notes.push([pad - 1, start + step, 2, 0.56 - index * 0.06]);
        });
        return;
      }
      if (driving) {
        // Pushed chords that lock with the kick and snare.
        chord([low, mid, high], start, level + 0.06);
        notes.push([top - 1, start + 1, 0.5, level - 0.12]);
        notes.push([high - 1, start + 1.5, 0.5, level - 0.14]);
        chord([mid, high, top], start + 2.5, level);
        notes.push([high - 1, start + 3.5, 0.5, level - 0.14]);
      } else {
        // Broken eighths: low note, then the upper voices rocking above it.
        [low, high, mid, top, low, high, top, mid].forEach((pad, step) => {
          notes.push([pad - 1, start + step * 0.5, 1, level + (step % 4 === 0 ? 0.08 : 0)]);
        });
      }
    });
  }
  // Closing chord, gently rolled.
  [1, 3, 5, 8, 12, 15].forEach((pad, index) => {
    notes.push([pad - 1, LAST_BEAT + index * 0.1, 4, 0.5 + index * 0.02]);
  });
  return notes;
}

function violinPart(): NoteList {
  const notes: NoteList = [];
  addLine(notes, verseOpening, VERSE_BAR, 0.76);
  addLine(notes, verseAnswer, VERSE_BAR + 4, 0.76);
  addLine(notes, verseOpening, VERSE_2_BAR, 0.8);
  addLine(notes, verseAnswerHigh, VERSE_2_BAR + 4, 0.82);
  addLine(notes, bridgeMelody, BRIDGE_BAR, 0.88);
  addLine(notes, verseOpeningHigh, VERSE_3_BAR, 0.9);
  addLine(notes, verseAnswerHigh, VERSE_3_BAR + 4, 0.86);
  // A last echo of the opening motif.
  addLine(notes, [[[3, 0, 1.5], [5, 1.5, 0.5], [8, 2, 2]], [[6, 0, 4]], [[5, 0, 4]]], OUTRO_BAR, 0.66);
  notes.push([7, LAST_BEAT, 4, 0.56]);
  return notes;
}

function flutePart(): NoteList {
  const notes: NoteList = [];
  addFlatLine(notes, verseCounter, VERSE_2_BAR, 0.5);
  addLine(notes, bridgeHarmony, BRIDGE_BAR, 0.6);
  addFlatLine(notes, verseCounter, VERSE_3_BAR, 0.56);
  return notes;
}

function celloPart(): NoteList {
  const notes: NoteList = [];
  for (const [firstBar, bars] of form) {
    if (firstBar === INTRO_BAR) continue;
    const driving = firstBar !== VERSE_BAR && firstBar !== OUTRO_BAR;
    bars.forEach(({ bass }, index) => {
      const start = (firstBar + index) * 4;
      if (driving) {
        notes.push([bass - 1, start, 2.4, 0.68]);
        notes.push([bass - 1, start + 2.5, 1.4, 0.58]);
      } else {
        const level = firstBar === OUTRO_BAR ? 0.56 - index * 0.04 : 0.6;
        notes.push([bass - 1, start, 3.9, level]);
      }
    });
  }
  return notes;
}

function harpPart(): NoteList {
  const notes: NoteList = [];
  // A rising sweep closes each phrase and hands over to the next one.
  const sweep: Array<[bar: number, velocity: number]> = [
    [3, 0.46],
    [7, 0.42],
    [11, 0.46],
    [15, 0.5],
    [19, 0.54],
    [23, 0.54],
    [27, 0.58],
    [31, 0.54],
    [35, 0.58],
  ];
  const chordAt = (bar: number): Chord => {
    const [firstBar, bars] = [...form].reverse().find(([first]) => first <= bar)!;
    return bars[bar - firstBar].chord;
  };
  for (const [bar, velocity] of sweep) {
    const [low, mid, high, top] = pianoVoicings[chordAt(bar)];
    [low + 7, mid + 7, high + 7, top + 7 > 15 ? top : top + 7].forEach((pad, step) => {
      notes.push([Math.min(pad, 15) - 1, bar * 4 + 2 + step * 0.5, 1, velocity + step * 0.03]);
    });
  }
  [8, 10, 12, 15].forEach((pad, index) => {
    notes.push([pad - 1, LAST_BEAT + 0.2 + index * 0.14, 4, 0.46]);
  });
  return notes;
}

const KICK = 0;
const LOW_TOM = 1;
const SNARE = 2;
const MID_TOM = 3;
const RIM = 4;
const HIGH_TOM = 5;
const SHAKER = 6;
const CRASH = 7;

function drumPart(): NoteList {
  const notes: NoteList = [];
  const hit = (pad: number, beat: number, velocity: number) => {
    notes.push([pad, beat, pad === CRASH ? 0.5 : 0.25, velocity]);
  };
  const fill = (start: number, level: number) => {
    hit(SNARE, start + 2, level - 0.1);
    hit(SNARE, start + 2.5, level - 0.04);
    hit(HIGH_TOM, start + 3, level);
    hit(HIGH_TOM, start + 3.25, level - 0.08);
    hit(MID_TOM, start + 3.5, level);
    hit(LOW_TOM, start + 3.75, level + 0.04);
  };
  const shaker = (start: number, step: number, level: number) => {
    for (let beat = 0; beat < 4; beat += step) {
      hit(SHAKER, start + beat, beat % 1 === 0 ? level : level - 0.08);
    }
  };

  // The intro starts with a shaker and rim, then a fill pulls the band in.
  for (let bar = INTRO_BAR + 2; bar < VERSE_BAR; bar++) {
    const start = bar * 4;
    shaker(start, 0.5, 0.3);
    hit(KICK, start, 0.52);
    hit(RIM, start + 3, 0.4);
  }
  fill((VERSE_BAR - 1) * 4, 0.56);

  // Verse one: a light rim backbeat.
  for (let bar = VERSE_BAR; bar < VERSE_2_BAR; bar++) {
    const start = bar * 4;
    const isFill = bar === VERSE_2_BAR - 1;
    shaker(start, 0.5, 0.34);
    hit(KICK, start, 0.64);
    hit(RIM, start + 1, 0.5);
    if (isFill) {
      fill(start, 0.62);
      continue;
    }
    hit(KICK, start + 2.5, 0.54);
    hit(RIM, start + 3, 0.5);
  }

  // Verse two and beyond: the full groove with snare on two and four.
  for (let bar = VERSE_2_BAR; bar < OUTRO_BAR; bar++) {
    const start = bar * 4;
    const peak = bar >= BRIDGE_BAR;
    const isFill = (bar + 1 - VERSE_2_BAR) % 8 === 0;
    const isTurn = (bar + 1 - VERSE_2_BAR) % 4 === 0;
    const snare = peak ? 0.78 : 0.68;
    if (bar === VERSE_2_BAR || bar === BRIDGE_BAR || bar === VERSE_3_BAR) hit(CRASH, start, 0.62);
    shaker(start, peak ? 0.25 : 0.5, peak ? 0.3 : 0.34);
    hit(KICK, start, 0.76);
    hit(SNARE, start + 1, snare);
    if (peak) hit(KICK, start + 1.75, 0.5);
    if (isFill) {
      fill(start, 0.72);
      continue;
    }
    hit(KICK, start + 2.5, 0.68);
    hit(SNARE, start + 3, snare);
    hit(SNARE, start + 3.75, 0.24);
    if (isTurn) {
      hit(HIGH_TOM, start + 3.5, 0.5);
      hit(LOW_TOM, start + 3.75, 0.54);
    }
  }

  // The outro falls back to the intro's pulse, then lands with the last chord.
  hit(CRASH, OUTRO_BAR * 4, 0.56);
  for (let bar = OUTRO_BAR; bar < OUTRO_BAR + 3; bar++) {
    const start = bar * 4;
    hit(KICK, start, 0.6 - (bar - OUTRO_BAR) * 0.06);
    hit(RIM, start + 3, 0.42 - (bar - OUTRO_BAR) * 0.06);
    shaker(start, 1, 0.26);
  }
  hit(KICK, LAST_BEAT, 0.56);
  hit(CRASH, LAST_BEAT, 0.42);
  return notes;
}

/**
 * “Lanterns Over the Valley” — an original 40-bar piece in C major at 82 BPM.
 * Violin carries the melody over Piano accompaniment, with Drum driving the
 * groove. Flute, Cello and Harp support them with a counter-line, the bass and
 * phrase-ending sweeps. The form is intro, verse, verse, bridge, verse, outro.
 * No third-party melody is reproduced.
 */
export function createDemoProject(): Project {
  const base = createProject({ title: 'Lanterns Over the Valley', bpm: 82, key: 0 });
  const piano = createTrack('piano', { name: 'Piano · Accompaniment', color: '#8fd3ff', colorIndex: 0 });
  const violin = createTrack('violin', { name: 'Violin · Melody', color: '#ffd6a0', colorIndex: 1 });
  const flute = createTrack('flute', { name: 'Flute · Counter-line', color: '#cfe9ff', colorIndex: 2 });
  const cello = createTrack('cello', { name: 'Cello · Bass', color: '#ffb289', colorIndex: 3 });
  const harp = createTrack('harp', { name: 'Harp · Sweeps', color: '#b8f0d8', colorIndex: 4 });
  const drum = createTrack('drum', { name: 'Drum · Groove', color: '#ff9f8a', colorIndex: 5 });

  piano.volume = 0.74;
  violin.volume = 0.88;
  flute.volume = 0.72;
  cello.volume = 0.82;
  harp.volume = 0.66;
  drum.volume = 0.86;

  addNotes(piano, pianoPart());
  addNotes(violin, violinPart());
  addNotes(flute, flutePart());
  addNotes(cello, celloPart());
  addNotes(harp, harpPart());
  addNotes(drum, drumPart());

  const project: Project = {
    ...base,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    catalogVersion: CATALOG_VERSION,
    tracks: [piano, violin, flute, cello, harp, drum],
    loop: { enabled: false, startBeat: 0, endBeat: 160 },
    updatedAt: nowIso(),
  };
  return project;
}

/** A tiny, quick-start project used by “Try a taste” in the welcome panel. */
export function createStarterProject(): Project {
  const project = createProject({ title: 'First Light', bpm: 96, key: 0 });
  const harp = project.tracks[0];
  const notes: Array<[number, number, number]> = [
    [8, 0, 0.5],
    [10, 0.5, 0.5],
    [12, 1, 0.5],
    [15, 1.5, 1.5],
    [13, 3, 0.5],
    [12, 3.5, 0.5],
    [10, 4, 0.5],
    [8, 4.5, 0.5],
    [6, 5, 0.5],
    [8, 5.5, 1.5],
  ];
  notes.forEach(([pad, start, duration]) => {
    harp.notes.push(createNote(pad - 1, start, duration, 0.8));
  });
  const flute = createTrack('flute', { name: 'Flute · Wind', color: '#cfe9ff', colorIndex: 1 });
  const fluteNotes: Array<[number, number, number]> = [
    [8, 0, 1],
    [12, 1, 1],
    [13, 2, 2],
    [11, 4, 1],
    [10, 5, 1],
    [8, 6, 2],
  ];
  fluteNotes.forEach(([pad, start, duration]) => {
    flute.notes.push(createNote(pad - 1, start, duration, 0.7));
  });
  project.tracks.push(flute);
  project.loop = { enabled: false, startBeat: 0, endBeat: 8 };
  return project;
}
