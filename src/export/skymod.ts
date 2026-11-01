import { getInstrument } from '../music/instruments';
import { beatsPerMeasure, beatsToSeconds } from '../music/time';
import type { Project } from '../music/types';

export const SKY_MOD_SONG_FORMAT = 'sky-mod-song';
export const SKY_MOD_SONG_VERSION = 1;
/** Fan-wiki limit for one Shared Memory recording; the exporter warns past it. */
export const SHARED_MEMORY_LIMIT_MS = 120_000;

const MIN_COUNT_IN_BEATS = 4;

export interface SkyModNote {
  time: number;
  key: string;
}

export interface SkyModTrack {
  name: string;
  instrument: string;
  pads: number;
  songNotes: SkyModNote[];
}

/** One song, every layer on the same clock: time 0 is the first count-in beat. */
export interface SkyModSong {
  format: typeof SKY_MOD_SONG_FORMAT;
  version: typeof SKY_MOD_SONG_VERSION;
  name: string;
  bpm: number;
  countIn: { beats: number; beatMs: number };
  durationMs: number;
  tracks: SkyModTrack[];
}

export function countInBeats(timeSignature: [number, number]): number {
  let beats = Math.ceil(beatsPerMeasure(timeSignature));
  while (beats < MIN_COUNT_IN_BEATS) beats *= 2;
  return beats;
}

export function projectToSkyModSong(project: Project): SkyModSong {
  const beats = countInBeats(project.timeSignature);
  const beatMs = beatsToSeconds(1, project.bpm) * 1000;
  const countInMs = beats * beatMs;
  let durationMs = countInMs;

  const tracks = project.tracks
    .filter((track) => track.notes.length > 0)
    .map((track): SkyModTrack => {
      const instrument = getInstrument(track.instrumentId);
      const songNotes = [...track.notes]
        .sort((a, b) => a.startBeat - b.startBeat || a.pad - b.pad)
        .map((note) => {
          const time = countInMs + beatsToSeconds(note.startBeat, project.bpm) * 1000;
          durationMs = Math.max(durationMs, time + beatsToSeconds(note.durationBeats, project.bpm) * 1000);
          return { time: Math.round(time), key: `Key${note.pad}` };
        });
      return { name: track.name, instrument: instrument.displayName, pads: instrument.keyCount, songNotes };
    });

  return {
    format: SKY_MOD_SONG_FORMAT,
    version: SKY_MOD_SONG_VERSION,
    name: project.title,
    bpm: project.bpm,
    countIn: { beats, beatMs },
    durationMs: Math.ceil(durationMs),
    tracks,
  };
}

/** sky-mod opens files through ANSI Lua paths, so the name stays plain ASCII. */
export function skyModFilename(title: string): string {
  const ascii = title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[_.]+|[_.]+$/g, '')
    .slice(0, 80);
  return `${ascii || 'sky-song'}.skymod.json`;
}
