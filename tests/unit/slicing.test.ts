import { describe, expect, it } from 'vitest';
import { analyzeFile, analyzeRecording } from '../../src/audio/slicing';

const RATE = 44100;

/** Decaying tones with silence between them, the way a played scale is recorded. */
function scale(midis: number[], pan = 1, leadSeconds = 0.25): Float32Array {
  const noteFrames = Math.floor(0.5 * RATE);
  const gapFrames = Math.floor(0.25 * RATE);
  const leadFrames = Math.floor(leadSeconds * RATE);
  const out = new Float32Array(leadFrames + midis.length * (noteFrames + gapFrames));
  midis.forEach((midi, index) => {
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    const start = leadFrames + index * (noteFrames + gapFrames);
    for (let i = 0; i < noteFrames; i++) {
      const t = i / RATE;
      out[start + i] = pan * 0.6 * Math.exp(-t * 6) * Math.sin(2 * Math.PI * frequency * t);
    }
  });
  return out;
}

describe('recording analysis', () => {
  const midis = [60, 64, 67, 72];

  it('slices a played scale at each onset and names every note', () => {
    const slices = analyzeRecording([scale(midis)], RATE);
    expect(slices.map((slice) => slice.pitch?.midi)).toEqual(midis);
    expect(slices.map((slice) => slice.sample.midi)).toEqual(midis);
    expect(slices.map((slice) => slice.sample.detectedMidi)).toEqual(midis);
    expect(slices.map((slice) => Number(slice.startSeconds.toFixed(2)))).toEqual([0.22, 0.97, 1.72, 2.47]);
    for (const slice of slices) {
      expect(slice.sample.confidence).toBeGreaterThan(0.9);
      expect(slice.sample.sourceStartSeconds).toBe(slice.startSeconds);
      expect(slice.sample.durationSeconds).toBe(slice.durationSeconds);
      expect(Math.max(...slice.sample.channels[0].map(Math.abs)) * slice.sample.gain).toBeCloseTo(0.92, 5);
    }
  });

  it('gives a stereo recording the same slices and notes as its mono mix', () => {
    const left = scale(midis, 1);
    const right = scale(midis, 0.5);
    const mono = left.map((value, index) => (value + right[index]) / 2);
    const stereo = analyzeRecording([left, right], RATE);
    const single = analyzeRecording([mono], RATE);
    expect(stereo.map((slice) => [slice.startSample, slice.endSample])).toEqual(
      single.map((slice) => [slice.startSample, slice.endSample]),
    );
    expect(stereo.map((slice) => slice.pitch?.midi)).toEqual(midis);
    expect(stereo.map((slice) => slice.pitch?.frequency)).toEqual(single.map((slice) => slice.pitch?.frequency));
    expect(stereo[0].sample.channels).toHaveLength(2);
  });

  it('leaves percussion slices without a pitch', () => {
    const slices = analyzeRecording([scale(midis)], RATE, { detectPitches: false });
    expect(slices).toHaveLength(4);
    expect(slices.every((slice) => slice.pitch === null && slice.sample.midi === null)).toBe(true);
  });

  it('returns nothing for silence or an empty recording', () => {
    expect(analyzeRecording([new Float32Array(RATE)], RATE)).toEqual([]);
    expect(analyzeRecording([], RATE)).toEqual([]);
  });

  it('reads one note from a per-note file', () => {
    const note = scale([69], 1, 0);
    const { sample, pitch } = analyzeFile([note], RATE, true);
    expect(pitch?.midi).toBe(69);
    expect(pitch?.frequency).toBeCloseTo(440, 0);
    expect(sample.midi).toBe(69);
    expect(sample.durationSeconds).toBeCloseTo(0.75, 2);
    expect(analyzeFile([note], RATE, false).pitch).toBeNull();
  });
});
