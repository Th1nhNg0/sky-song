/**
 * User-supplied sound packs.
 *
 * IMPORTANT: this project never bundles, downloads or fetches game audio. A sound
 * pack comes only from the user's own copy of the game, is stored in the browser
 * (IndexedDB) and is never uploaded. Pack files must stay out of this repository.
 *
 * Everything here is pure data handling so it can be unit-tested in Node.
 */

const SOUND_PACK_FORMAT = 'skymusic-soundpack';
const SOUND_PACK_VERSION = 1;
const MAX_PACK_SAMPLES = 128;
const MAX_SAMPLE_SECONDS = 12;
const MAX_PACK_BYTES = 96 * 1024 * 1024;

export interface PackSample {
  id: string;
  /** Target MIDI note for pitched instruments. May be manually corrected. */
  midi: number | null;
  /** Pad index for unpitched instruments (drums, cymbals). */
  padIndex: number | null;
  /** MIDI reported by pitch detection before any manual correction. */
  detectedMidi: number | null;
  /** Pitch-detection confidence, 0..1. */
  confidence: number;
  /** Where the slice came from in the original recording, in seconds. */
  sourceStartSeconds: number;
  /** Slice length in seconds (for display and provenance). */
  durationSeconds: number;
  /** Per-sample gain applied on playback (peak normalisation). */
  gain: number;
  /** Native sample rate of the recorded audio. */
  sampleRate: number;
  /** Channel-major PCM data, 1 or 2 channels. */
  channels: Float32Array[];
}

export interface SoundPack {
  id: string;
  name: string;
  instrumentId: string;
  /** Enabled packs are preferred by the engine for that instrument. */
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  notes: string;
  samples: PackSample[];
}

function makePackId(prefix = 'pack'): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${random}`;
}

export function createSoundPack(input: {
  id?: string;
  name: string;
  instrumentId: string;
  enabled?: boolean;
  notes?: string;
  samples: PackSample[];
  createdAt?: string;
  updatedAt?: string;
}): SoundPack {
  const now = new Date().toISOString();
  return normalizePack({
    id: input.id ?? makePackId(),
    name: input.name,
    instrumentId: input.instrumentId,
    enabled: input.enabled ?? true,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    notes: input.notes ?? '',
    samples: input.samples,
  });
}

function channelBytes(sample: PackSample): number {
  return sample.channels.reduce((sum, channel) => sum + channel.length * 4, 0);
}

export function packBytes(pack: SoundPack): number {
  return pack.samples.reduce((sum, sample) => sum + channelBytes(sample), 0);
}

/** Nearest recorded note for a target MIDI note (used for pitch-shifted playback). */
export function nearestSample(pack: SoundPack, midi: number): PackSample | null {
  let best: PackSample | null = null;
  let bestDistance = Infinity;
  for (const sample of pack.samples) {
    if (sample.midi === null || sample.channels.length === 0) continue;
    const distance = Math.abs(sample.midi - midi);
    if (distance < bestDistance || (distance === bestDistance && best && sample.confidence > best.confidence)) {
      best = sample;
      bestDistance = distance;
    }
  }
  return best;
}

/** Sample assigned to an unpitched pad. */
export function sampleForPad(pack: SoundPack, padIndex: number): PackSample | null {
  return pack.samples.find((sample) => sample.padIndex === padIndex && sample.midi === null) ?? null;
}

/** Playback-rate ratio that shifts a recorded note to the requested MIDI note. */
export function playbackRateFor(sample: PackSample, targetMidi: number): number {
  if (sample.midi === null) return 1;
  return Math.pow(2, (targetMidi - sample.midi) / 12);
}

/**
 * Normalises a recorded slice: DC removal, short fades and peak scaling. The fades
 * are what prevent clicks at slice boundaries; the peak scaling keeps the mix
 * predictable and is stored so the original relative dynamics can be inspected.
 */
export function normalizeSlice(
  channels: Float32Array[],
  sampleRate: number,
  options: { targetPeak?: number; fadeInSeconds?: number; fadeOutSeconds?: number } = {},
): PackSample {
  const targetPeak = options.targetPeak ?? 0.92;
  const fadeIn = Math.max(1, Math.round((options.fadeInSeconds ?? 0.004) * sampleRate));
  const fadeOut = Math.max(1, Math.round((options.fadeOutSeconds ?? 0.03) * sampleRate));
  const copied = channels.map((channel) => {
    const data = new Float32Array(channel.length);
    let mean = 0;
    for (let i = 0; i < channel.length; i++) mean += channel[i];
    mean /= Math.max(1, channel.length);
    for (let i = 0; i < channel.length; i++) data[i] = channel[i] - mean;
    const length = data.length;
    for (let i = 0; i < Math.min(fadeIn, length); i++) data[i] *= i / fadeIn;
    for (let i = 0; i < Math.min(fadeOut, length); i++) data[length - 1 - i] *= i / fadeOut;
    return data;
  });
  const peak = copied.reduce((max, channel) => {
    for (let i = 0; i < channel.length; i++) max = Math.max(max, Math.abs(channel[i]));
    return max;
  }, 0);
  const gain = peak > 0.0001 ? targetPeak / peak : 1;
  return {
    id: makePackId('slice'),
    midi: null,
    padIndex: null,
    detectedMidi: null,
    confidence: 0,
    sourceStartSeconds: 0,
    durationSeconds: copied[0] ? copied[0].length / sampleRate : 0,
    gain,
    sampleRate,
    channels: copied,
  };
}

function normalizePack(pack: SoundPack): SoundPack {
  const samples: PackSample[] = [];
  for (const raw of pack.samples.slice(0, MAX_PACK_SAMPLES)) {
    if (!raw || !Array.isArray(raw.channels) || raw.channels.length === 0) continue;
    const channels = raw.channels
      .slice(0, 2)
      .map((channel) => (channel instanceof Float32Array ? channel : new Float32Array(channel ?? [])))
      .filter((channel) => channel.length > 0);
    if (channels.length === 0) continue;
    const sampleRate = clampNumber(raw.sampleRate, 8000, 96000, 44100);
    const maxFrames = Math.floor(MAX_SAMPLE_SECONDS * sampleRate);
    const frames = Math.min(channels[0].length, maxFrames);
    const trimmed = channels.map((channel) => channel.slice(0, frames));
    samples.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : makePackId('slice'),
      midi: raw.midi === null || raw.midi === undefined ? null : clampInt(raw.midi, 0, 127),
      padIndex:
        raw.padIndex === null || raw.padIndex === undefined ? null : clampInt(raw.padIndex, 0, 63),
      detectedMidi:
        raw.detectedMidi === null || raw.detectedMidi === undefined
          ? null
          : clampInt(raw.detectedMidi, 0, 127),
      confidence: clampNumber(raw.confidence, 0, 1, 0),
      sourceStartSeconds: clampNumber(raw.sourceStartSeconds, 0, 60 * 60, 0),
      durationSeconds: clampNumber(raw.durationSeconds, 0, MAX_SAMPLE_SECONDS, frames / sampleRate),
      gain: clampNumber(raw.gain, 0.02, 8, 1),
      sampleRate,
      channels: trimmed,
    });
  }
  return {
    id: typeof pack.id === 'string' && pack.id ? pack.id : makePackId(),
    name: (pack.name || 'Untitled pack').slice(0, 80),
    instrumentId: pack.instrumentId,
    enabled: Boolean(pack.enabled),
    createdAt: pack.createdAt || new Date().toISOString(),
    updatedAt: pack.updatedAt || new Date().toISOString(),
    notes: (pack.notes ?? '').slice(0, 2000),
    samples,
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/* ------------------------------------------------------------------ */
/* Base64 + 16-bit PCM, implemented here so it works in Node and the  */
/* browser without Buffer/btoa differences.                           */
/* ------------------------------------------------------------------ */

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i++) table[BASE64_ALPHABET.charCodeAt(i)] = i;
  return table;
})();

function bytesToBase64(bytes: Uint8Array): string {
  let output = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const value = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    output += BASE64_ALPHABET[(value >> 18) & 63];
    output += BASE64_ALPHABET[(value >> 12) & 63];
    output += BASE64_ALPHABET[(value >> 6) & 63];
    output += BASE64_ALPHABET[value & 63];
  }
  if (i < bytes.length) {
    const remaining = bytes.length - i;
    const value = (bytes[i] << 16) | (remaining > 1 ? bytes[i + 1] << 8 : 0);
    output += BASE64_ALPHABET[(value >> 18) & 63];
    output += BASE64_ALPHABET[(value >> 12) & 63];
    output += remaining > 1 ? BASE64_ALPHABET[(value >> 6) & 63] : '=';
    output += '=';
  }
  return output;
}

function base64ToBytes(value: string): Uint8Array {
  const cleaned = value.replace(/[^A-Za-z0-9+/]/g, '');
  const output = new Uint8Array(Math.floor((cleaned.length * 3) / 4));
  let outputIndex = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < cleaned.length; i++) {
    const code = cleaned.charCodeAt(i);
    const digit = code < 128 ? BASE64_LOOKUP[code] : -1;
    if (digit < 0) continue;
    buffer = (buffer << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output[outputIndex++] = (buffer >> bits) & 0xff;
    }
  }
  return output.subarray(0, outputIndex);
}

function floatToPcm16Base64(channel: Float32Array): string {
  const bytes = new Uint8Array(channel.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < channel.length; i++) {
    const sample = Math.max(-1, Math.min(1, channel[i]));
    view.setInt16(i * 2, sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff), true);
  }
  return bytesToBase64(bytes);
}

function pcm16Base64ToFloat(value: string): Float32Array {
  const bytes = base64ToBytes(value);
  const frames = Math.floor(bytes.length / 2);
  const output = new Float32Array(frames);
  const view = new DataView(bytes.buffer, bytes.byteOffset, frames * 2);
  for (let i = 0; i < frames; i++) output[i] = view.getInt16(i * 2, true) / 32768;
  return output;
}

interface PackFileSample {
  id: string;
  midi: number | null;
  padIndex: number | null;
  detectedMidi: number | null;
  confidence: number;
  sourceStartSeconds: number;
  durationSeconds: number;
  gain: number;
  sampleRate: number;
  channels: number;
  data: string[];
}

interface PackFile {
  format: typeof SOUND_PACK_FORMAT;
  version: number;
  id: string;
  name: string;
  instrumentId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  notes: string;
  samples: PackFileSample[];
}

/**
 * Serialises a pack to a self-contained, human-portable JSON file. Audio is
 * quantised to 16-bit PCM to keep the backup
 * reasonably small; the discrepancy is below normal listening thresholds.
 */
export function packToJson(pack: SoundPack): string {
  const file: PackFile = {
    format: SOUND_PACK_FORMAT,
    version: SOUND_PACK_VERSION,
    id: pack.id,
    name: pack.name,
    instrumentId: pack.instrumentId,
    enabled: pack.enabled,
    createdAt: pack.createdAt,
    updatedAt: pack.updatedAt,
    notes: pack.notes,
    samples: pack.samples.map((sample) => ({
      id: sample.id,
      midi: sample.midi,
      padIndex: sample.padIndex,
      detectedMidi: sample.detectedMidi,
      confidence: sample.confidence,
      sourceStartSeconds: sample.sourceStartSeconds,
      durationSeconds: sample.durationSeconds,
      gain: sample.gain,
      sampleRate: sample.sampleRate,
      channels: sample.channels.length,
      data: sample.channels.map((channel) => floatToPcm16Base64(channel)),
    })),
  };
  return JSON.stringify(file);
}

export function packFromJson(text: string): SoundPack {
  if (text.length > MAX_PACK_BYTES) throw new Error('That sound pack file is too large.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const file = parsed as Partial<PackFile>;
  if (!file || file.format !== SOUND_PACK_FORMAT) {
    throw new Error('That file is not a Sky Music Studio sound pack.');
  }
  if (file.version !== SOUND_PACK_VERSION) {
    throw new Error(`Unsupported sound pack version ${String(file.version)}.`);
  }
  if (typeof file.instrumentId !== 'string' || !file.instrumentId) {
    throw new Error('The sound pack is missing its instrument.');
  }
  if (!Array.isArray(file.samples) || file.samples.length === 0) {
    throw new Error('The sound pack has no samples.');
  }
  if (file.samples.length > MAX_PACK_SAMPLES) {
    throw new Error(`The sound pack has more than ${MAX_PACK_SAMPLES} samples.`);
  }
  const samples: PackSample[] = file.samples.map((sample) => {
    if (!sample || !Array.isArray(sample.data) || sample.data.length === 0) {
      throw new Error('A sample in the pack has no audio data.');
    }
    const channels = sample.data.slice(0, 2).map((value) => pcm16Base64ToFloat(String(value)));
    if (channels.every((channel) => channel.length === 0)) {
      throw new Error('A sample in the pack has empty audio data.');
    }
    const frames = Math.min(...channels.map((channel) => channel.length));
    return {
      id: typeof sample.id === 'string' ? sample.id : makePackId('slice'),
      midi: sample.midi === null || sample.midi === undefined ? null : clampInt(sample.midi, 0, 127),
      padIndex:
        sample.padIndex === null || sample.padIndex === undefined
          ? null
          : clampInt(sample.padIndex, 0, 63),
      detectedMidi:
        sample.detectedMidi === null || sample.detectedMidi === undefined
          ? null
          : clampInt(sample.detectedMidi, 0, 127),
      confidence: clampNumber(sample.confidence, 0, 1, 0),
      sourceStartSeconds: clampNumber(sample.sourceStartSeconds, 0, 60 * 60, 0),
      durationSeconds: clampNumber(sample.durationSeconds, 0, MAX_SAMPLE_SECONDS, 0),
      gain: clampNumber(sample.gain, 0.02, 8, 1),
      sampleRate: clampInt(sample.sampleRate, 8000, 96000),
      channels: channels.map((channel) => channel.slice(0, frames)),
    };
  });
  return normalizePack({
    id: typeof file.id === 'string' && file.id ? file.id : makePackId(),
    name: typeof file.name === 'string' && file.name ? file.name : 'Imported pack',
    instrumentId: file.instrumentId,
    enabled: file.enabled !== false,
    createdAt: typeof file.createdAt === 'string' ? file.createdAt : new Date().toISOString(),
    updatedAt: typeof file.updatedAt === 'string' ? file.updatedAt : new Date().toISOString(),
    notes: typeof file.notes === 'string' ? file.notes : '',
    samples,
  });
}

export function packFileName(pack: SoundPack): string {
  const safe = pack.name
    .replace(/[^A-Za-z0-9 _-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 48);
  const instrument = pack.instrumentId.replace(/[^A-Za-z0-9_-]+/g, '-');
  return `${safe || 'sound-pack'}-${instrument}.skypack.json`;
}
