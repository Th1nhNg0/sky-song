import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compactSoundPacks } from '../../scripts/compactSoundPacks';
import { readCompactPack, type CompactPackEntry } from '../../src/audio/compactPack';
import { packAudio, unpackAudio } from '../../src/audio/lossless';
import { createSoundPack, normalizeSlice, packFromJson, packToJson, type SoundPack } from '../../src/audio/soundPack';

/** Repeatable noise, so a failure can be run again. */
function noise(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function expectLossless(channels: Int16Array[]) {
  const packed = packAudio(channels);
  const back = unpackAudio(packed, channels.length, channels[0].length);
  expect(back.length).toBe(channels.length);
  channels.forEach((channel, index) => expect(Buffer.from(back[index].buffer).equals(Buffer.from(channel.buffer))).toBe(true));
  return packed;
}

describe('lossless audio packing', () => {
  it('gives back every sample of tones, noise, silence and full-scale clicks', () => {
    const random = noise(7);
    const tone = Int16Array.from({ length: 10_000 }, (_, i) => Math.round(Math.sin(i / 9) * 20_000 * Math.exp(-i / 4000)));
    const hiss = Int16Array.from({ length: 9001 }, () => Math.round((random() - 0.5) * 65535));
    const clicks = Int16Array.from({ length: 5000 }, (_, i) => (i % 97 === 0 ? (i % 2 ? 32767 : -32768) : 0));
    for (const channel of [tone, hiss, clicks, new Int16Array(4096), new Int16Array(1), new Int16Array(0)]) {
      expectLossless([channel]);
    }
  });

  it('gives back both channels of stereo, including opposed and odd-sum pairs', () => {
    const random = noise(11);
    const left = Int16Array.from({ length: 12_345 }, (_, i) => Math.round(Math.sin(i / 14) * 15_000 + (random() - 0.5) * 400));
    const near = left.map((value, i) => value + (i % 3) - 1);
    const opposed = left.map((value) => -value - 1);
    const extremes = [Int16Array.from({ length: 600 }, (_, i) => (i % 2 ? 32767 : -32768)), Int16Array.from({ length: 600 }, (_, i) => (i % 2 ? -32768 : 32767))];
    expectLossless([left, near]);
    expectLossless([left, opposed]);
    expectLossless(extremes);
  });

  it('makes a decaying note much smaller, and a matching second channel cheap', () => {
    const note = Int16Array.from({ length: 64_000 }, (_, i) => Math.round(Math.sin(i / 20) * 24_000 * Math.exp(-i / 16_000)));
    const mono = expectLossless([note]);
    expect(mono.length).toBeLessThan(note.byteLength * 0.4);
    // A second channel that repeats the first is stored as their difference: a bit a frame.
    expect(expectLossless([note, note]).length).toBeLessThan(mono.length * 1.5);
  });

  it('refuses audio that has been cut short or damaged rather than inventing samples', () => {
    const random = noise(3);
    const packed = packAudio([Int16Array.from({ length: 3000 }, () => Math.round((random() - 0.5) * 65535))]);
    expect(() => unpackAudio(new Uint8Array(packed.length).fill(255), 1, 3000)).toThrow();
  });
});

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true });
});

function pack(id: string, instrumentId: string, midis: number[], sampleId?: (index: number) => string): SoundPack {
  const built = createSoundPack({
    id, name: `Test ${id}`, instrumentId, notes: 'Made for a test.',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
    samples: midis.map((midi, index) => {
      const left = Float32Array.from({ length: 6000 }, (_, i) => Math.sin((i * midi) / 400) * 0.6 * Math.exp(-i / 2500));
      const sample = normalizeSlice(index % 2 ? [left, left.map((value) => value * 0.5)] : [left], 32000);
      sample.midi = midi;
      sample.id = sampleId ? sampleId(index) : `${id}-${index}`;
      return sample;
    }),
  });
  return built;
}

/** Writes packs as a build would find them, runs the step, and returns the manifest it leaves. */
function build(packs: SoundPack[], maxBytes?: number) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-compact-'));
  directories.push(directory);
  const manifest = packs.map((item) => {
    const file = `${item.id}.skypack.json`;
    fs.writeFileSync(path.join(directory, file), packToJson(item));
    return { id: item.id, updatedAt: item.updatedAt, instrumentId: item.instrumentId, file };
  });
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  compactSoundPacks(directory, maxBytes);
  const read = () => JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')) as {
    id: string; updatedAt: string; instrumentId: string; file?: string; audio?: string;
    pack?: { name: string; notes: string; createdAt: string; sampleIds?: string[] };
  }[];
  return { directory, read };
}

async function open(directory: string, entry: ReturnType<ReturnType<typeof build>['read']>[number]) {
  const bytes = fs.readFileSync(path.join(directory, entry.audio!));
  const details: CompactPackEntry = {
    id: entry.id, updatedAt: entry.updatedAt, instrumentId: entry.instrumentId,
    name: entry.pack!.name, notes: entry.pack!.notes, createdAt: entry.pack!.createdAt, sampleIds: entry.pack!.sampleIds ?? null,
  };
  return readCompactPack(details, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

describe('packed sound packs in a build', () => {
  it('reads back as the same pack the JSON file holds, in a fraction of the space', async () => {
    const source = pack('test-harp', 'harp', [48, 52, 55, 60]);
    const { directory, read } = build([source]);
    const [entry] = read();
    expect(entry.file).toBeUndefined();
    expect(fs.existsSync(path.join(directory, 'test-harp.skypack.json'))).toBe(false);
    expect(await open(directory, entry)).toEqual(packFromJson(packToJson(source)));
    expect(fs.statSync(path.join(directory, entry.audio!)).size).toBeLessThan(packToJson(source).length / 2.5);
  });

  it('gives instruments that play the same recordings one file, and keeps their own details', async () => {
    const violin = pack('test-violin', 'violin', [55, 62]);
    const triumph = { ...pack('test-triumph-violin', 'triumph-violin', [55, 62]), name: 'Triumph violin' };
    const cello = pack('test-cello', 'cello', [36, 43]);
    const { directory, read } = build([violin, triumph, cello]);
    const [first, second, third] = read();
    expect(second.audio).toBe(first.audio);
    expect(third.audio).not.toBe(first.audio);
    expect(fs.readdirSync(directory).filter((file) => file.endsWith('.skyaudio')).length).toBe(2);
    const opened = await open(directory, second);
    expect([opened.id, opened.name, opened.instrumentId]).toEqual(['test-triumph-violin', 'Triumph violin', 'triumph-violin']);
    expect(opened.samples.map((sample) => sample.id)).toEqual(['test-triumph-violin-0', 'test-triumph-violin-1']);
  });

  it('keeps sample ids that do not follow the pack, and leaves alone what it cannot pack', async () => {
    const named = pack('test-drum', 'drum', [40, 41], (index) => `kick-${index}`);
    const { directory, read } = build([named]);
    expect((await open(directory, read()[0])).samples.map((sample) => sample.id)).toEqual(['kick-0', 'kick-1']);
    compactSoundPacks(directory); // Running again changes nothing.
    expect(read()[0].pack!.sampleIds).toEqual(['kick-0', 'kick-1']);

    // Over the deployment's file limit: the JSON stays for the step that splits it.
    const large = build([pack('test-big', 'harp', [48, 50])], 64);
    expect(large.read()[0]).toMatchObject({ file: 'test-big.skypack.json' });
    expect(fs.existsSync(path.join(large.directory, 'test-big.skypack.json'))).toBe(true);
  });
});
