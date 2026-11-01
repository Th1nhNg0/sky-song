import { readFileSync } from 'node:fs';
import { findSustainLoop, joinSustainLoop, nearestSample, packSustains, sampleForPad, type PackSample, type SoundPack } from '../../src/audio/soundPack';
import { describe, expect, it } from 'vitest';

function pack(id: string) {
  const text = readFileSync(`public/sound-packs/Game-${id}-${id}.skypack.json`, 'utf8');
  return JSON.parse(text) as { notes: string; samples: { midi: number | null; padIndex: number | null; data: string[] }[] };
}

function notes(id: string) {
  return [...new Set(pack(id).samples.map((sample) => sample.midi))];
}

describe('game sound packs', () => {
  it('keeps the plain Drum and the Prophecy Drum on their own samples', () => {
    const drum = pack('drum');
    const prophecy = pack('prophecy-drum');
    expect(drum.notes).toContain('PercussionLocal');
    expect(prophecy.notes).toContain('DundunLocal');
    expect(drum.samples[0].data).not.toEqual(prophecy.samples[0].data);
  });

  it('plays the handpan pad pattern from the recordings', () => {
    expect(notes('handpan')).toEqual([50, 57, 60, 62, 65, 67, 69, 72]);
  });

  it('keeps Winter Piano an octave above Piano', () => {
    const lowest = (id: string) => Math.min(...pack(id).samples.map((sample) => sample.midi!));
    expect(lowest('winter-piano') - lowest('piano')).toBe(12);
  });
});

describe('game sound pack mapping', () => {
  it('gives the Triumph Drum its own recordings', () => {
    expect(pack('triumph-drum').notes).toContain('GoldDundunLocal');
    expect(pack('triumph-drum').samples[0].data).not.toEqual(pack('prophecy-drum').samples[0].data);
  });

  it('matches every bell pad to one recording at its original pitch', () => {
    expect(notes('small-bell')).toEqual([72, 74, 79, 81, 84, 86, 91, 93]);
    expect(notes('large-bell')).toEqual([60, 62, 67, 69, 72, 74, 79, 81]);
  });

  it('records every key of a melodic instrument', () => {
    expect(pack('harp').samples).toHaveLength(15);
    expect(new Set(pack('cymbals').samples.map((sample) => sample.padIndex)).size).toBe(4);
  });

  it('keeps the Krill Horn blast at the first pad', () => {
    expect(pack('tuned-krill-horn').samples.map((sample) => sample.midi)).toEqual([53]);
  });
});

describe('sustain loops', () => {
  const rate = 1000;
  const held = Float32Array.from({ length: 6 * rate }, (_, i) => Math.sin(i * 0.3));
  const fading = Float32Array.from(held, (value, i) => value * Math.exp(-i / rate));

  it('loops a recording that is still sounding at its end', () => {
    expect(packSustains([{ channels: [held], sampleRate: rate }])).toBe(true);
    expect(findSustainLoop([held], rate)!.endFrame - findSustainLoop([held], rate)!.startFrame).toBe(1.5 * rate);
  });

  it('leaves a recording that fades out alone', () => {
    expect(packSustains([{ channels: [fading], sampleRate: rate }])).toBe(false);
  });

  it('makes the end of the loop continue into its start', () => {
    const channel = held.slice();
    const loop = findSustainLoop([channel], rate)!;
    joinSustainLoop(channel, loop);
    expect(channel[loop.endFrame - 1]).toBeCloseTo(channel[loop.startFrame - 1], 2);
  });
});

describe('variant takes', () => {
  const take = (id: string, midi: number | null, padIndex: number | null) => ({ id, midi, padIndex }) as unknown as PackSample;
  const packOf = (samples: PackSample[]) => ({ id: 'test', samples: samples.map((s) => ({ ...s, channels: [new Float32Array(1)] })) }) as unknown as SoundPack;

  it('rotates through the takes of a pad', () => {
    const drums = packOf([take('a', null, 0), take('b', null, 0), take('c', null, 1)]);
    expect([0, 1, 2].map(() => sampleForPad(drums, 0)?.id)).toEqual(['a', 'b', 'a']);
    expect(sampleForPad(drums, 1)?.id).toBe('c');
  });

  it('rotates through the takes of a note', () => {
    const bells = packOf([take('x', 60, null), take('y', 60, null), take('z', 72, null)]);
    expect([60, 60, 72].map((midi) => nearestSample(bells, midi)?.id)).toEqual(['x', 'y', 'z']);
  });
});
