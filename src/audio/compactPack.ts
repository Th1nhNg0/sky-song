/**
 * The form the app's own sound packs are deployed in.
 *
 * A pack in the repository is a `.skypack.json` file: readable, and three times the
 * size of the sound it holds. A build rewrites each one as a `.skyaudio` file, holding
 * the samples' details and their audio packed without loss, and moves the pack's own
 * details (its name, its instrument) into the manifest. Instruments that play the same
 * recordings then share one file.
 *
 * Layout: "SKYA", a version byte, the header's length (32-bit, little-endian), the
 * header as JSON, then each sample's packed audio one after another.
 */

import { packAudio, unpackAudio } from './lossless';
import {
  packFromFile,
  SOUND_PACK_FORMAT,
  SOUND_PACK_VERSION,
  type PackFileSample,
  type SoundPack,
} from './soundPack';

const MAGIC = 'SKYA';
const VERSION = 1;
const PREFIX_BYTES = MAGIC.length + 1 + 4;
/** Longest the page is held up unpacking before it is given a turn. */
const SLICE_MS = 12;

/** A sample's details as the file's header lists them. Ids are the pack's to give. */
type CompactSample = Omit<PackFileSample, 'id' | 'data'> & {
  frames: number;
  /** Length of this sample's packed audio. */
  bytes: number;
};

/** What the manifest says about a pack whose samples are in a `.skyaudio` file. */
export interface CompactPackEntry {
  id: string;
  updatedAt: string;
  instrumentId: string;
  name: string;
  notes: string;
  createdAt: string;
  /** Given when the samples' ids are not simply the pack's id and their position. */
  sampleIds: string[] | null;
}

export const defaultSampleId = (packId: string, index: number) => `${packId}-${index}`;

/** Writes samples as one `.skyaudio` file. Each sample's channels must be the same length. */
export function writeCompactAudio(samples: { details: Omit<PackFileSample, 'id' | 'data'>; channels: Int16Array[] }[]): Uint8Array {
  const audio = samples.map((sample) => packAudio(sample.channels));
  const header = new TextEncoder().encode(
    JSON.stringify({
      samples: samples.map(
        (sample, index): CompactSample => ({
          ...sample.details,
          channels: sample.channels.length,
          frames: sample.channels[0].length,
          bytes: audio[index].length,
        }),
      ),
    }),
  );
  const out = new Uint8Array(PREFIX_BYTES + header.length + audio.reduce((sum, bytes) => sum + bytes.length, 0));
  for (let i = 0; i < MAGIC.length; i++) out[i] = MAGIC.charCodeAt(i);
  out[MAGIC.length] = VERSION;
  new DataView(out.buffer).setUint32(MAGIC.length + 1, header.length, true);
  out.set(header, PREFIX_BYTES);
  let at = PREFIX_BYTES + header.length;
  for (const bytes of audio) {
    out.set(bytes, at);
    at += bytes.length;
  }
  return out;
}

/**
 * Builds the pack a manifest entry describes from its `.skyaudio` file. The audio comes
 * back exactly as the `.skypack.json` held it. Unpacking a large pack takes a moment, so
 * it is done a sample at a time with the page given a turn in between.
 */
export async function readCompactPack(entry: CompactPackEntry, buffer: ArrayBuffer): Promise<SoundPack> {
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(...bytes.subarray(0, MAGIC.length));
  if (magic !== MAGIC || bytes[MAGIC.length] !== VERSION) throw new Error('That is not a packed sound file this app can read.');
  const headerLength = new DataView(buffer).getUint32(MAGIC.length + 1, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(PREFIX_BYTES, PREFIX_BYTES + headerLength))) as {
    samples: CompactSample[];
  };
  if (!Array.isArray(header.samples)) throw new Error('The packed sound file has no samples.');

  const audio: Float32Array[][] = [];
  let at = PREFIX_BYTES + headerLength;
  let turn = performance.now();
  for (const sample of header.samples) {
    const packed = bytes.subarray(at, at + sample.bytes);
    if (packed.length !== sample.bytes) throw new Error('The packed sound file is cut short.');
    at += sample.bytes;
    audio.push(
      unpackAudio(packed, sample.channels, sample.frames).map((channel) => {
        const floats = new Float32Array(channel.length);
        for (let i = 0; i < channel.length; i++) floats[i] = channel[i] / 32768;
        return floats;
      }),
    );
    if (performance.now() - turn > SLICE_MS) {
      await new Promise((resolve) => setTimeout(resolve));
      turn = performance.now();
    }
  }

  return packFromFile(
    {
      format: SOUND_PACK_FORMAT,
      version: SOUND_PACK_VERSION,
      id: entry.id,
      name: entry.name,
      instrumentId: entry.instrumentId,
      enabled: true,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      notes: entry.notes,
      samples: header.samples.map((sample, index) => ({
        ...sample,
        id: entry.sampleIds?.[index] ?? defaultSampleId(entry.id, index),
      })),
    },
    (_, index) => audio[index],
  );
}
