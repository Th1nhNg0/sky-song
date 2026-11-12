import { describe, expect, it } from 'vitest';
import { barLabelStep, firstNoteAt, gridBackground, meterBeat } from '../../src/music/grid';
import { PlayheadSmoother } from '../../src/state/smoothing';

describe('grid', () => {
  it('counts eighth-note meters in eighths', () => {
    expect(meterBeat([6, 8])).toBe(0.5);
    expect(meterBeat([4, 4])).toBe(1);
  });

  it('thins ruler numbers as the view zooms out', () => {
    expect(barLabelStep(56, 4)).toBe(1);
    expect(barLabelStep(4, 4)).toBe(4);
    expect(barLabelStep(0.25, 4)).toBe(64);
  });

  it('shows subdivisions only when they are far enough apart to read', () => {
    expect(gridBackground(56, [4, 4], 0.25).backgroundSize).toContain('14px');
    expect(gridBackground(20, [4, 4], 0.25).backgroundSize).not.toContain('5px');
  });

  it('finds the first note at a beat in a sorted list', () => {
    const notes = [0, 1, 1, 4].map((startBeat) => ({ startBeat }));
    expect(firstNoteAt(notes, 1)).toBe(1);
    expect(firstNoteAt(notes, 2)).toBe(3);
    expect(firstNoteAt(notes, 9)).toBe(4);
  });
});

describe('PlayheadSmoother', () => {
  it('moves evenly between coarse clock readings', () => {
    const smoother = new PlayheadSmoother();
    const shown: number[] = [];
    // The clock reads in 40 ms steps while frames arrive every 16 ms, at 2 beats a second.
    for (let frame = 0; frame < 120; frame++) {
      const ms = frame * 16;
      shown.push(smoother.next(Math.floor(ms / 40) * 0.08, ms, 2));
    }
    const steps = shown.slice(40).map((value, index) => value - shown[39 + index]);
    for (const step of steps) expect(step).toBeGreaterThan(0.015);
    for (const step of steps) expect(step).toBeLessThan(0.05);
  });

  it('jumps straight to a seek or a loop wrap', () => {
    const smoother = new PlayheadSmoother();
    smoother.next(10, 0, 2);
    expect(smoother.next(2, 16, 2)).toBe(2);
  });
});
