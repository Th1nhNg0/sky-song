import { getInstrument } from '../music/instruments';
import { midiSafeText } from '../music/midiText';
import { resolvePad } from '../music/pitch';
import { timingOf } from '../music/timing';
import type { Project, SoundProfileId } from '../music/types';
import { clamp } from '../util';

const TICKS_PER_BEAT = 480;

const GM_PROGRAMS: Record<SoundProfileId, number> = {
  harp: 46,
  piano: 0,
  'grand-piano': 0,
  'bright-piano': 0,
  guitar: 24,
  'electric-guitar': 27,
  ukulele: 24,
  pipa: 105,
  lute: 24,
  kalimba: 108,
  xylophone: 13,
  violin: 40,
  cello: 42,
  contrabass: 43,
  voice: 52,
  horn: 60,
  bugle: 56,
  trumpet: 56,
  flute: 73,
  panflute: 75,
  ocarina: 79,
  saxophone: 65,
  harmonica: 22,
  bell: 14,
  handpan: 114,
  drum: 0,
  cymbal: 0,
};

/**
 * MIDI key signatures, expressed as the signed number of sharps (+) or flats (-).
 * This is the actual Standard MIDI File key-signature byte value (sf).
 */
const KEY_SIGNATURE_SHARPS: Record<number, number> = {
  0: 0,
  1: -5,
  2: 2,
  3: -3,
  4: 4,
  5: -1,
  6: -6,
  7: 1,
  8: -4,
  9: 3,
  10: -2,
  11: 5,
};

export interface MidiExportResult {
  bytes: Uint8Array;
  fileName: string;
  trackCount: number;
  noteCount: number;
}

interface MidiEvent {
  tick: number;
  priority: number;
  bytes: number[];
}

function variableLength(value: number): number[] {
  let buffer = value & 0x7f;
  const bytes = [];
  while ((value >>= 7)) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return bytes;
}

function meta(type: number, payload: number[]): number[] {
  return [0xff, type, ...variableLength(payload.length), ...payload];
}

function textMeta(type: number, text: string): number[] {
  return meta(type, [...new TextEncoder().encode(text)]);
}

function noteOn(channel: number, note: number, velocity: number): number[] {
  return [0x90 | (channel & 0x0f), clamp(note, 0, 127), clamp(velocity, 1, 127)];
}

function noteOff(channel: number, note: number): number[] {
  return [0x80 | (channel & 0x0f), clamp(note, 0, 127), 64];
}

function encodeTrack(events: MidiEvent[]): Uint8Array {
  events.sort((a, b) => a.tick - b.tick || a.priority - b.priority);
  const body: number[] = [];
  let previousTick = 0;
  for (const event of events) {
    const delta = event.tick - previousTick;
    body.push(...variableLength(Math.max(0, delta)), ...event.bytes);
    previousTick = event.tick;
  }
  body.push(0, ...meta(0x2f, []));
  return new Uint8Array([0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body]);
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/**
 * Writes a Standard MIDI File (format 1) directly, giving exact control over:
 *  - one conductor track with every tempo and time signature and a correctly signed key signature
 *  - one named track per virtual performer with instrument/part metadata
 *  - General MIDI programs for pitched tracks and channel 10 for unpitched percussion
 * The public @tonejs/midi parser is used in tests to verify the bytes round-trip.
 */
function tempoMeta(bpm: number): number[] {
  const microseconds = Math.floor(60000000 / bpm);
  return meta(0x51, [(microseconds >>> 16) & 0xff, (microseconds >>> 8) & 0xff, microseconds & 0xff]);
}

function meterMeta(meter: [number, number]): number[] {
  return meta(0x58, [meter[0], Math.round(Math.log2(meter[1])), 24, 8]);
}

export function exportProjectToMidi(project: Project): MidiExportResult {
  const timing = timingOf(project);
  const conductor: MidiEvent[] = [
    { tick: 0, priority: 0, bytes: textMeta(0x03, midiSafeText(project.title) || 'Sky Music Studio project') },
    {
      tick: 0,
      priority: 1,
      bytes: textMeta(
        0x01,
        'Sky Music Studio — unofficial fan software; see docs/audio-sources.md.',
      ),
    },
    ...timing.tempos.map((span) => ({ tick: Math.round(span.beat * TICKS_PER_BEAT), priority: 2, bytes: tempoMeta(span.bpm) })),
    ...timing.meters.map((span) => ({ tick: Math.round(span.beat * TICKS_PER_BEAT), priority: 3, bytes: meterMeta(span.meter) })),
    {
      tick: 0,
      priority: 4,
      bytes: meta(0x59, [KEY_SIGNATURE_SHARPS[project.key] & 0xff, 0]),
    },
  ];
  const tracks: Uint8Array[] = [encodeTrack(conductor)];
  let melodicChannel = 0;
  let noteCount = 0;

  for (const track of project.tracks) {
    const instrument = getInstrument(track.instrumentId);
    const events: MidiEvent[] = [];
    const isUnpitched = instrument.renderingMode === 'unpitched';
    let channel: number;
    let program = 0;
    if (isUnpitched) {
      channel = 9;
    } else {
      channel = melodicChannel;
      melodicChannel = (melodicChannel + 1) % 16;
      if (melodicChannel === 9) melodicChannel = 10;
      program = GM_PROGRAMS[instrument.soundProfile] ?? 0;
    }
    events.push({
      tick: 0,
      priority: 0,
      bytes: textMeta(
        0x03,
        midiSafeText(`${track.name} | ${instrument.displayName} (${instrument.nativePartCode}, ${instrument.nativeSheetPart})`),
      ),
    });
    if (!isUnpitched) {
      events.push({ tick: 0, priority: 1, bytes: [0xc0 | channel, program] });
      // Channel volume (CC 7) so DAWs start at a sensible level.
      events.push({ tick: 0, priority: 2, bytes: [0xb0 | channel, 7, 100] });
    }
    for (const note of track.notes) {
      const resolved = resolvePad(instrument, project.key, note.pad);
      const midiNote = isUnpitched ? resolved.drumNote ?? 38 : resolved.midi;
      if (midiNote === null) continue;
      const startTick = Math.round(note.startBeat * TICKS_PER_BEAT);
      const endTick = Math.max(startTick + 1, Math.round((note.startBeat + note.durationBeats) * TICKS_PER_BEAT));
      const velocity = clamp(Math.round(note.velocity * 127), 1, 127);
      events.push({ tick: startTick, priority: 3, bytes: noteOn(channel, midiNote, velocity) });
      events.push({ tick: endTick, priority: 0, bytes: noteOff(channel, midiNote) });
      noteCount++;
    }
    tracks.push(encodeTrack(events));
  }

  const header = [
    0x4d,
    0x54,
    0x68,
    0x64,
    0,
    0,
    0,
    6,
    0,
    1, // format 1
    (tracks.length >>> 8) & 0xff,
    tracks.length & 0xff,
    (TICKS_PER_BEAT >>> 8) & 0xff,
    TICKS_PER_BEAT & 0xff,
  ];
  const total = header.length + tracks.reduce((sum, track) => sum + track.length, 0);
  const bytes = new Uint8Array(total);
  bytes.set(header, 0);
  let offset = header.length;
  for (const track of tracks) {
    bytes.set(track, offset);
    offset += track.length;
  }
  const safeTitle = project.title.replace(/[^a-z0-9\-_ ]/gi, '').trim().replace(/\s+/g, '-') || 'sky-song';
  return {
    bytes,
    fileName: `${safeTitle}.mid`,
    trackCount: project.tracks.length,
    noteCount,
  };
}

