import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_REVERB_SPACE,
  REVERB_SPACES,
  generateReverbImpulseData,
  getReverbSpace,
  isReverbSpaceId,
} from '../../src/audio/reverb';
import { loadPreferences } from '../../src/storage/preferences';

const RATE = 48000;

function impulse(id: (typeof REVERB_SPACES)[number]['id']) {
  return generateReverbImpulseData(RATE, getReverbSpace(id).impulse);
}

function rms(data: Float32Array, fromSeconds: number, seconds: number): number {
  const start = Math.floor(fromSeconds * RATE);
  const end = Math.min(data.length, start + Math.floor(seconds * RATE));
  let sum = 0;
  for (let i = start; i < end; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / Math.max(1, end - start));
}

describe('reverb spaces', () => {
  it('keeps the cave the app has always played in as the default', () => {
    expect(DEFAULT_REVERB_SPACE).toBe('cave');
    const [left, right] = impulse('cave');
    expect(left.length).toBe(Math.floor(RATE * (5.2 + 0.028)));
    expect(left).toEqual(generateReverbImpulseData(RATE)[0]);
    // The two ears hear different walls.
    expect(left).not.toEqual(right);
  });

  it('gives every space its own length, from open air to the vault', () => {
    const seconds = Object.fromEntries(REVERB_SPACES.map((space) => [space.id, impulse(space.id)[0].length / RATE]));
    expect(new Set(Object.values(seconds)).size).toBe(REVERB_SPACES.length);
    expect(seconds.sky).toBeLessThan(2);
    expect(seconds.vault).toBeGreaterThan(seconds.cave);
    expect(seconds.temple).toBeLessThan(seconds.cave);
  });

  it('builds the same impulse every time, with no silence-breaking values', () => {
    for (const space of REVERB_SPACES) {
      const [left] = impulse(space.id);
      expect(left).toEqual(impulse(space.id)[0]);
      expect(left.every((value) => Number.isFinite(value) && Math.abs(value) <= 0.62 + 1e-6)).toBe(true);
      // Every space dies away: its last tenth is far below its first.
      expect(rms(left, (left.length / RATE) * 0.9, 1)).toBeLessThan(rms(left, 0.1, 0.2) * 0.05);
    }
  });

  it('darkens the vault and brightens the open sky', () => {
    // Sample-to-sample change against level: more of it means more highs.
    const brightness = (data: Float32Array) => {
      let change = 0;
      let level = 0;
      for (let i = RATE / 10; i < RATE / 2; i++) {
        change += (data[i] - data[i - 1]) ** 2;
        level += data[i] ** 2;
      }
      return change / level;
    };
    expect(brightness(impulse('sky')[0])).toBeGreaterThan(brightness(impulse('cave')[0]));
    expect(brightness(impulse('vault')[0])).toBeLessThan(brightness(impulse('cave')[0]));
  });

  it('answers a note in the canyon with repeats that fade and swap ears', () => {
    const [left, right] = impulse('canyon');
    const predelay = 0.02;
    const peakAt = (data: Float32Array, repeat: number) => {
      const start = Math.floor(predelay * RATE) + Math.floor(repeat * 0.34 * RATE);
      let peak = 0;
      for (let i = start; i < start + 48; i++) peak = Math.max(peak, Math.abs(data[i]));
      return peak;
    };
    const first = peakAt(left, 1);
    // A repeat is a clear copy of the note, well above the wash around it.
    expect(first).toBeGreaterThan(rms(left, 0.2, 0.1) * 20);
    expect(peakAt(left, 3)).toBeLessThan(first * 0.5);
    expect(peakAt(left, 5)).toBeLessThan(peakAt(left, 3));
    expect(peakAt(right, 1)).toBeGreaterThan(first);
    expect(peakAt(right, 2)).toBeLessThan(peakAt(left, 2));
    // No other space calls back.
    const cave = impulse('cave')[0];
    expect(peakAt(cave, 1)).toBeLessThan(rms(cave, 0.2, 0.1) * 6);
  });
});

describe('the saved space', () => {
  afterEach(() => vi.unstubAllGlobals());

  function saved(value: unknown) {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(value) });
    return loadPreferences().reverbSpace;
  }

  it('is read back when it names a space', () => {
    expect(saved({ reverbSpace: 'vault' })).toBe('vault');
  });

  it('falls back to the cave when it is missing or unknown', () => {
    expect(saved({})).toBe('cave');
    expect(saved({ reverbSpace: 'moon' })).toBe('cave');
    expect(isReverbSpaceId('moon')).toBe(false);
  });
});
