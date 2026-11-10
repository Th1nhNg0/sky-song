import { describe, expect, it } from 'vitest';
import { getInstrument } from '../../src/music/instruments';
import { createNote } from '../../src/music/project';
import {
  buildSheetFrames,
  frameAtBeat,
  layoutSheet,
  paginateSheet,
  sheetGeometry,
  type SheetCell,
} from '../../src/music/sheet';

const harp = getInstrument('harp');
const frames = (cells: SheetCell[]) => cells.flatMap((cell) => (cell.kind === 'frame' ? [cell.frame.index] : []));

describe('sheet frames', () => {
  it('puts notes that start together in one frame and keeps bar and beat', () => {
    const notes = [createNote(7, 4.5, 0.5), createNote(0, 0, 0.5), createNote(4, 0, 0.5), createNote(2, 0, 0.5)];
    const built = buildSheetFrames(notes, harp, 4);
    expect(built.map((frame) => frame.pads)).toEqual([[0, 2, 4], [7]]);
    expect(built[1]).toMatchObject({ index: 1, bar: 1, beat: 0.5 });
  });

  it('keeps a triplet that lands a hair under the bar line in the next bar', () => {
    const [frame] = buildSheetFrames([createNote(0, 3.9999999999999996, 0.25)], harp, 4);
    expect(frame).toMatchObject({ bar: 1, beat: 0 });
  });

  it('finds the frame sounding at a beat', () => {
    const built = buildSheetFrames([createNote(0, 1, 0.5), createNote(1, 2, 0.5), createNote(2, 6, 0.5)], harp, 4);
    expect([0, 1, 1.9, 2, 5.5, 99].map((beat) => frameAtBeat(built, beat))).toEqual([-1, 0, 0, 1, 1, 2]);
  });
});

describe('sheet layout', () => {
  it('fills every line with the same number of columns', () => {
    const notes = Array.from({ length: 10 }, (_, step) => createNote(0, step, 0.5));
    const lines = layoutSheet(buildSheetFrames(notes, harp, 4), 4);
    expect(lines.map((line) => frames(line.cells))).toEqual([[0, 1, 2, 3], [4, 5, 6, 7], [8, 9]]);
    expect(lines.map((line) => line.bar)).toEqual([0, 1, 2]);
    expect(lines[1].cells.map((cell) => cell.column)).toEqual([0, 1, 2, 3]);
  });

  it('shows empty bars as one rest, including before the first note', () => {
    const notes = [createNote(0, 8, 0.5), createNote(0, 24, 0.5)];
    const [line] = layoutSheet(buildSheetFrames(notes, harp, 4), 9);
    expect(line.cells.map((cell) => (cell.kind === 'rest' ? `rest ${cell.fromBar}+${cell.bars}` : 'frame'))).toEqual([
      'rest 0+2',
      'frame',
      'rest 3+3',
      'frame',
    ]);
    expect(line.bar).toBe(0);
  });

  it('spreads a full line across the whole width', () => {
    for (const instrument of [harp, getInstrument('drum')]) {
      const geometry = sheetGeometry(instrument, 992);
      const span = geometry.gutter + geometry.columns * geometry.frameWidth + (geometry.columns - 1) * geometry.gap;
      expect(span).toBeCloseTo(992);
      expect(geometry.gap).toBeGreaterThanOrEqual(10);
    }
  });

  it('gives the first page fewer lines than the rest', () => {
    const lines = Array.from({ length: 10 }, () => ({ bar: 0, cells: [] }));
    expect(paginateSheet(lines, 3, 4).map((page) => page.length)).toEqual([3, 4, 3]);
    expect(paginateSheet([], 3, 4)).toEqual([[]]);
  });
});
