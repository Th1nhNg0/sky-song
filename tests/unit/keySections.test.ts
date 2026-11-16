import { describe, expect, it } from 'vitest';
import { planKeys } from '../../src/music/keySections';

const scale = [0, 2, 4, 5, 7, 9, 11];
const tune = (tonic: number, fromBar: number, bars: number) =>
  Array.from({ length: bars * 4 }, (_, i) => ({
    midi: tonic + scale[(i * 3) % 7],
    startBeat: fromBar * 4 + i,
    durationBeats: 1,
  }));

describe('planKeys', () => {
  it('keeps a song in one key on one shift', () => {
    const plan = planKeys(tune(67, 0, 32), 4);
    expect(plan.changes).toEqual([]);
    expect(plan.at(0)).toBe(5);
    expect(plan.at(120)).toBe(5);
  });

  it('gives each key its own shift after a key change', () => {
    const plan = planKeys([...tune(67, 0, 16), ...tune(68, 16, 16)], 4);
    expect(plan.changes).toEqual([64]);
    expect(plan.at(63)).toBe(5);
    expect(plan.at(64)).toBe(4);
  });

  it('does not treat a chromatic bar as a key change', () => {
    const notes = tune(60, 0, 32);
    for (const note of notes.filter((n) => n.startBeat >= 40 && n.startBeat < 44)) note.midi += 1;
    expect(planKeys(notes, 4).changes).toEqual([]);
  });
});
