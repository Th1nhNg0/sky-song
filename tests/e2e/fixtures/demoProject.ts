import { createNote, createProject, createTrack, nowIso } from '../../../src/music/project';
import { CATALOG_VERSION, PROJECT_SCHEMA_VERSION } from '../../../src/music/types';
import type { Project, Track } from '../../../src/music/types';

function addNotes(track: Track, notes: Array<[pad: number, start: number, duration: number, velocity?: number]>) {
  for (const [pad, start, duration, velocity] of notes) {
    track.notes.push(createNote(pad, start, duration, velocity ?? 0.8));
  }
}

// All pad numbers below are 1-based scale degrees. The key never changes: verses
// lean on A minor and the chorus opens into C major, using the same fifteen pads.
type Line = Array<[pad: number, offset: number, duration: number]>;
type NoteList = Array<[number, number, number, number?]>;
type Chord = 'I' | 'ii7' | 'iii' | 'IV' | 'V' | 'vi';
type Bar = [chord: Chord, bass: number];

const pianoVoicings: Record<Chord, [number, number, number, number]> = {
  I: [1, 3, 5, 8],
  ii7: [2, 4, 6, 8],
  iii: [3, 5, 7, 10],
  IV: [1, 4, 6, 8],
  V: [2, 5, 7, 9],
  vi: [1, 3, 6, 8],
};

const harpVoicings: Record<Chord, [number, number, number, number]> = {
  I: [1, 5, 8, 10],
  ii7: [2, 6, 8, 11],
  iii: [3, 5, 7, 10],
  IV: [4, 6, 8, 11],
  V: [2, 5, 7, 9],
  vi: [3, 6, 8, 10],
};

const verseBars: Bar[] = [['vi', 6], ['IV', 4], ['I', 3], ['V', 5], ['vi', 6], ['IV', 4], ['ii7', 2], ['V', 5]];
const riseBars: Bar[] = [['IV', 4], ['V', 5], ['vi', 6], ['V', 5]];
const chorusBars: Bar[] = [['I', 8], ['V', 5], ['vi', 6], ['IV', 4], ['I', 3], ['V', 5], ['IV', 4], ['I', 1]];
const bridgeBars: Bar[] = [['IV', 4], ['iii', 3], ['IV', 4], ['iii', 3], ['ii7', 2], ['V', 5]];
const finalBars: Bar[] = [['I', 8], ['V', 5], ['vi', 6], ['IV', 4], ['I', 3], ['V', 5]];
const tagBars: Bar[] = [['ii7', 2], ['V', 5], ['I', 8], ['I', 1]];
const outroBars: Bar[] = [['IV', 4], ['I', 3], ['I', 1]];

type SectionName = 'intro' | 'verse1' | 'verse2' | 'rise' | 'chorus' | 'bridge' | 'final' | 'tag' | 'outro';

const form: Array<[name: SectionName, bars: Bar[]]> = [
  ['intro', verseBars.slice(0, 2)],
  ['verse1', verseBars.slice(0, 4)],
  ['verse2', verseBars.slice(4)],
  ['rise', riseBars],
  ['chorus', chorusBars],
  ['bridge', bridgeBars],
  ['final', finalBars],
  ['tag', tagBars],
  ['outro', outroBars],
];

const SECTION_BAR = {} as Record<SectionName, number>;
form.reduce((bar, [name, bars]) => {
  SECTION_BAR[name] = bar;
  return bar + bars.length;
}, 0);
const LAST_BEAT = (SECTION_BAR.outro + outroBars.length - 1) * 4;
const END_BEAT = LAST_BEAT + 4;

function forEachBar(name: SectionName, visit: (bar: Bar, start: number, index: number) => void) {
  const bars = form.find(([section]) => section === name)![1];
  bars.forEach((bar, index) => visit(bar, (SECTION_BAR[name] + index) * 4, index));
}

// Original melody. Each bar is a list of [pad, offsetWithinBar, duration].
const verseMelody: Line[] = [
  [[6, 0, 1.5], [8, 1.5, 0.5], [10, 2, 2]],
  [[11, 0, 1.5], [10, 1.5, 0.5], [8, 2, 2]],
  [[10, 0, 1.5], [8, 1.5, 0.5], [5, 2, 2]],
  [[7, 0, 1], [9, 1, 1], [7, 2, 2]],
];

const verseReply: Line[] = [
  [[10, 0, 1.5], [12, 1.5, 0.5], [13, 2, 2]],
  [[13, 0, 1], [12, 1, 1], [11, 2, 2]],
  [[11, 0, 1], [9, 1, 1], [8, 2, 1], [6, 3, 1]],
  [[7, 0, 2], [9, 2, 1], [12, 3, 1]],
];

const riseMelody: Line[] = [
  [[8, 0, 1], [11, 1, 1], [13, 2, 1], [11, 3, 1]],
  [[9, 0, 1], [12, 1, 1], [11, 2, 1], [12, 3, 1]],
  [[10, 0, 1], [13, 1, 1], [12, 2, 1], [13, 3, 1]],
  [[12, 0, 3]],
];

const chorusMelody: Line[] = [
  [[10, 0, 2], [12, 2, 1], [13, 3, 1]],
  [[12, 0, 3], [9, 3, 1]],
  [[10, 0, 2], [12, 2, 1], [13, 3, 1]],
  [[13, 0, 2], [11, 2, 1.5], [10, 3.5, 0.5]],
  [[10, 0, 2], [12, 2, 1], [13, 3, 1]],
  [[14, 0, 2], [12, 2, 2]],
  [[13, 0, 1.5], [12, 1.5, 0.5], [11, 2, 1.5], [10, 3.5, 0.5]],
  [[8, 0, 3.5]],
];

const chorusHarmony: Line[] = [
  [[8, 0, 2], [10, 2, 1], [10, 3, 1]],
  [[9, 0, 3], [7, 3, 1]],
  [[8, 0, 2], [10, 2, 1], [10, 3, 1]],
  [[11, 0, 2], [8, 2, 2]],
  [[8, 0, 2], [10, 2, 2]],
  [[12, 0, 2], [9, 2, 2]],
  [[11, 0, 2], [8, 2, 2]],
  [[5, 0, 3.5]],
];

const bridgeMelody: Line[] = [
  [[13, 0, 3], [12, 3, 1]],
  [[12, 0, 3], [14, 3, 1]],
  [[11, 0, 1], [13, 1, 1], [13, 2, 2]],
  [[12, 0, 1], [14, 1, 1], [12, 2, 2]],
  [[11, 0, 1], [13, 1, 1], [13, 2, 1], [11, 3, 1]],
  [[14, 0, 3], [12, 3.5, 0.5]],
];

// The only place the Violin touches the top pad.
const finalMelody: Line[] = [
  [[12, 0, 2], [13, 2, 1], [15, 3, 1]],
  [[14, 0, 3], [12, 3, 1]],
  [[13, 0, 2], [15, 2, 1], [13, 3, 1]],
  [[15, 0, 3], [13, 3, 1]],
  [[12, 0, 2], [13, 2, 1], [15, 3, 1]],
  [[14, 0, 2], [12, 2, 2]],
];

const tagMelody: Line[] = [
  [[11, 0, 1], [13, 1, 1], [15, 2, 2]],
  [[14, 0, 2], [12, 2, 1], [14, 3, 1]],
  [[15, 0, 4]],
  [[15, 0, 2], [12, 2, 2]],
];

const outroMelody: Line[] = [
  [[13, 0, 4]],
  [[10, 0, 2], [12, 2, 2]],
  [[8, 0, 4]],
];

function addLine(target: NoteList, bars: Line[], name: SectionName, velocity: number) {
  bars.forEach((bar, index) => {
    for (const [pad, offset, duration] of bar) {
      target.push([pad - 1, (SECTION_BAR[name] + index) * 4 + offset, duration, velocity]);
    }
  });
}

function pianoPart(): NoteList {
  const notes: NoteList = [];
  const chord = (pads: number[], start: number, velocity: number, duration = 1) => {
    for (const pad of pads) notes.push([Math.min(pad, 15) - 1, start, duration, velocity]);
  };
  const hush = (name: SectionName, level: number) =>
    forEachBar(name, ([harmony], start) => {
      const [low, mid, high, top] = pianoVoicings[harmony];
      [low, high, mid, top].forEach((pad, step) => notes.push([pad - 1, start + step, 1, level]));
    });
  const flow = (name: SectionName, level: number) =>
    forEachBar(name, ([harmony], start) => {
      const [low, mid, high, top] = pianoVoicings[harmony];
      [low, high, mid, top, low, high, top, mid].forEach((pad, step) => {
        notes.push([pad - 1, start + step * 0.5, 1, level + (step % 4 === 0 ? 0.07 : 0)]);
      });
    });
  const rise = (name: SectionName, level: number) =>
    forEachBar(name, ([harmony], start, index) => {
      const [low, mid, high] = pianoVoicings[harmony];
      if (index === 3) {
        // Everything stops here, so the chorus lands out of silence.
        chord([low, mid, high], start, level + 0.14, 2);
        chord([low, mid, high], start + 2, level + 0.18, 0.75);
        return;
      }
      for (let step = 0; step < 8; step++) {
        chord([low, mid, high], start + step * 0.5, level + index * 0.05 + step * 0.008);
      }
    });
  const drive = (name: SectionName, level: number, octave: boolean) =>
    forEachBar(name, ([harmony], start) => {
      const [low, mid, high, top] = pianoVoicings[harmony];
      chord([low, mid, high], start, level + 0.06);
      if (octave) chord([top, low + 7], start, level - 0.06);
      notes.push([top - 1, start + 1, 0.5, level - 0.12]);
      notes.push([high - 1, start + 1.5, 0.5, level - 0.14]);
      chord([mid, high, top], start + 2.5, level);
      if (octave) chord([mid + 7], start + 2.5, level - 0.1);
      notes.push([high - 1, start + 3.5, 0.5, level - 0.14]);
    });

  hush('intro', 0.56);
  hush('verse1', 0.48);
  flow('verse2', 0.48);
  rise('rise', 0.48);
  drive('chorus', 0.64, false);
  forEachBar('bridge', ([harmony], start, index) => {
    const [low, mid, high, top] = pianoVoicings[harmony];
    if (index < 2) {
      chord([low, mid, high, top], start, 0.44, 4);
    } else if (index < 5) {
      chord([low, mid, high], start, 0.46 + index * 0.03, 2);
      chord([mid, high, top], start + 2, 0.46 + index * 0.03, 2);
    } else {
      chord([low, mid, high], start, 0.68, 2);
      chord([low, mid, high], start + 2, 0.74, 1);
    }
  });
  drive('final', 0.72, true);
  forEachBar('tag', ([harmony], start, index) => {
    const [low, mid, high, top] = pianoVoicings[harmony];
    chord([low, mid, high, top], start, 0.76, 2);
    if (index < 2) chord([low + 7, mid + 7, high + 7], start + 2, 0.7, 2);
  });
  forEachBar('outro', ([harmony], start, index) => {
    const [low, mid, high, top] = pianoVoicings[harmony];
    if (index === outroBars.length - 1) return;
    [low, high, mid, top].forEach((pad, step) => notes.push([pad - 1, start + step, 2, 0.46 - index * 0.03]));
  });
  [1, 3, 5, 8, 12, 15].forEach((pad, index) => {
    notes.push([pad - 1, LAST_BEAT + index * 0.12, 4, 0.42 + index * 0.02]);
  });
  return notes;
}

function violinPart(): NoteList {
  const notes: NoteList = [];
  addLine(notes, verseMelody, 'verse1', 0.7);
  addLine(notes, verseReply, 'verse2', 0.76);
  addLine(notes, riseMelody, 'rise', 0.82);
  addLine(notes, chorusMelody, 'chorus', 0.9);
  addLine(notes, bridgeMelody, 'bridge', 0.72);
  addLine(notes, finalMelody, 'final', 0.96);
  addLine(notes, tagMelody, 'tag', 0.96);
  addLine(notes, outroMelody, 'outro', 0.56);
  return notes;
}

function flutePart(): NoteList {
  const notes: NoteList = [];
  addLine(notes, chorusHarmony, 'chorus', 0.54);
  addLine(notes, chorusHarmony.slice(0, 6), 'final', 0.64);
  return notes;
}

function celloPart(): NoteList {
  const notes: NoteList = [];
  const longBass = (name: SectionName, level: number, from = 0) =>
    forEachBar(name, ([, bass], start, index) => {
      if (index >= from) notes.push([bass - 1, start, 3.9, level]);
    });
  const pulseBass = (name: SectionName, level: number) =>
    forEachBar(name, ([, bass], start) => {
      notes.push([bass - 1, start, 2.4, level]);
      notes.push([bass - 1, start + 2.5, 1.4, level - 0.1]);
    });
  longBass('verse2', 0.52);
  longBass('rise', 0.62);
  pulseBass('chorus', 0.72);
  longBass('bridge', 0.54, 2);
  pulseBass('final', 0.78);
  pulseBass('tag', 0.78);
  longBass('outro', 0.48);
  return notes;
}

function harpPart(): NoteList {
  const notes: NoteList = [];
  const arpeggio = (name: SectionName, level: number) =>
    forEachBar(name, ([harmony], start) => {
      const voicing = harpVoicings[harmony];
      [0, 1, 2, 3, 2, 1, 2, 3].forEach((tone, step) => {
        notes.push([voicing[tone] - 1, start + step * 0.5, 1, level + (step === 0 ? 0.06 : 0)]);
      });
    });
  const sweep = (name: SectionName, level: number) =>
    forEachBar(name, ([harmony], start, index) => {
      if (index !== 3) return;
      const [low, mid, high, top] = pianoVoicings[harmony];
      [low + 7, mid + 7, high + 7, top + 7 > 15 ? top : top + 7].forEach((pad, step) => {
        notes.push([pad - 1, start + 1 + step * 0.5, 1, level + step * 0.04]);
      });
    });
  sweep('rise', 0.52);
  arpeggio('chorus', 0.34);
  arpeggio('final', 0.44);
  [8, 10, 12, 15].forEach((pad, index) => {
    notes.push([pad - 1, LAST_BEAT + 0.3 + index * 0.14, 4, 0.42]);
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
  const shaker = (start: number, step: number, level: number) => {
    for (let beat = 0; beat < 4; beat += step) {
      hit(SHAKER, start + beat, beat % 1 === 0 ? level : level - 0.08);
    }
  };
  const fill = (start: number, level: number) => {
    hit(SNARE, start + 2, level - 0.1);
    hit(SNARE, start + 2.5, level - 0.04);
    hit(HIGH_TOM, start + 3, level);
    hit(HIGH_TOM, start + 3.25, level - 0.08);
    hit(MID_TOM, start + 3.5, level);
    hit(LOW_TOM, start + 3.75, level + 0.04);
  };
  const roll = (start: number, level: number) => {
    // Sixteenth snare crescendo that cuts off just before the downbeat.
    for (let step = 0; step < 14; step++) hit(SNARE, start + step * 0.25, level + step * 0.03);
  };
  const groove = (name: SectionName, snare: number, rate: number, lastBarFill: boolean) =>
    forEachBar(name, (_bar, start, index) => {
      const size = form.find(([section]) => section === name)![1].length;
      if (index === 0) hit(CRASH, start, 0.66);
      shaker(start, rate, 0.3);
      hit(KICK, start, 0.78);
      hit(SNARE, start + 1, snare);
      hit(KICK, start + 1.75, 0.5);
      if (lastBarFill && index === size - 1) {
        fill(start, 0.74);
        return;
      }
      hit(KICK, start + 2.5, 0.7);
      hit(SNARE, start + 3, snare);
      if (index % 2 === 1) hit(SNARE, start + 3.75, 0.26);
    });

  // A heartbeat only: the first verse has no backbeat at all.
  forEachBar('verse1', (_bar, start) => hit(KICK, start, 0.42));
  forEachBar('verse2', (_bar, start) => {
    shaker(start, 0.5, 0.26);
    hit(KICK, start, 0.56);
    hit(RIM, start + 1, 0.44);
    hit(KICK, start + 2.5, 0.44);
    hit(RIM, start + 3, 0.46);
  });
  const rise = (name: SectionName, level: number) =>
    forEachBar(name, (_bar, start, index) => {
      if (index === 3) {
        roll(start, level);
        return;
      }
      for (let beat = 0; beat < 4; beat++) hit(KICK, start + beat, level + 0.1 + index * 0.06);
      hit(SNARE, start + 1, level + index * 0.08);
      hit(SNARE, start + 3, level + index * 0.08);
    });
  rise('rise', 0.42);
  groove('chorus', 0.72, 0.5, true);
  // The bridge drops out, then toms bring the band back from nothing.
  forEachBar('bridge', (_bar, start, index) => {
    if (index < 2) return;
    if (index === 5) {
      roll(start, 0.5);
      return;
    }
    const level = 0.3 + (index - 2) * 0.1;
    for (let beat = 0; beat < 4; beat++) hit(LOW_TOM, start + beat, level);
    hit(MID_TOM, start + 3.5, level + 0.04);
  });
  groove('final', 0.84, 0.25, false);
  forEachBar('final', (_bar, start, index) => {
    hit(LOW_TOM, start, 0.36);
    if (index === 4) hit(CRASH, start, 0.62);
  });
  forEachBar('tag', (_bar, start, index) => {
    if (index === 0 || index === 2) hit(CRASH, start, 0.72);
    hit(KICK, start, 0.82);
    hit(LOW_TOM, start, 0.4);
    if (index === 1) fill(start, 0.8);
    if (index === 2) {
      hit(SNARE, start + 1, 0.8);
      hit(KICK, start + 2, 0.7);
      hit(SNARE, start + 3, 0.8);
    }
  });
  hit(KICK, LAST_BEAT, 0.46);
  hit(CRASH, LAST_BEAT, 0.3);
  return notes;
}

/**
 * “Lanterns Over the Valley” — an original two-minute piece in C major at 82 BPM
 * for six performers. A bare A minor verse climbs into a full chorus, the bridge
 * empties out, and the top Violin pad is saved for the final chorus.
 * No third-party melody is reproduced. The end-to-end tests use it as a full song.
 */
export function createDemoProject(): Project {
  const base = createProject({ title: 'Lanterns Over the Valley', bpm: 82, key: 0 });
  const piano = createTrack('piano', { name: 'Piano · Accompaniment', color: '#8fd3ff', colorIndex: 0 });
  const violin = createTrack('violin', { name: 'Violin · Melody', color: '#ffd6a0', colorIndex: 1 });
  const flute = createTrack('flute', { name: 'Flute · Harmony', color: '#cfe9ff', colorIndex: 2 });
  const cello = createTrack('cello', { name: 'Cello · Bass', color: '#ffb289', colorIndex: 3 });
  const harp = createTrack('harp', { name: 'Harp · Colour', color: '#b8f0d8', colorIndex: 4 });
  const drum = createTrack('drum', { name: 'Drum · Groove', color: '#ff9f8a', colorIndex: 5 });

  piano.volume = 0.74;
  violin.volume = 0.88;
  flute.volume = 0.7;
  cello.volume = 0.84;
  harp.volume = 0.64;
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
    loop: { enabled: false, startBeat: 0, endBeat: END_BEAT },
    updatedAt: nowIso(),
  };
  return project;
}
