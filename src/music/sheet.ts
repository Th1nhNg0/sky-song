import { sortNotes } from './project';
import type { InstrumentDefinition, Note } from './types';

/**
 * A track as a player reads it: one frame per moment the hands come down, each showing
 * the instrument's pads with the ones to press lit. Frames keep their bar and beat, so
 * the sheet can follow the song as it plays.
 */

export interface SheetFrame {
  /** Position among the track's frames. */
  index: number;
  startBeat: number;
  /** 0-based bar the frame starts in. */
  bar: number;
  /** Beats into that bar. */
  beat: number;
  /** Pads pressed together, lowest first. */
  pads: number[];
}

export type SheetCell =
  | { kind: 'frame'; column: number; frame: SheetFrame }
  | { kind: 'rest'; column: number; fromBar: number; bars: number };

export interface SheetLine {
  /** 0-based bar the line starts in. */
  bar: number;
  cells: SheetCell[];
}

export interface SheetGeometry {
  /** Distance between pad centres. */
  cell: number;
  /** Space between the pads and the frame's edge. */
  inset: number;
  frameWidth: number;
  frameHeight: number;
  /** Frames on a line; every line uses the same columns, so the sheet reads as a grid. */
  columns: number;
  /** Space between frames, chosen so a full line spans the whole width. */
  gap: number;
  /** Room at the left of each line for its bar number. */
  gutter: number;
  lineGap: number;
  lineHeight: number;
}

const SAME_MOMENT = 1e-6;

export function sheetGeometry(instrument: InstrumentDefinition, width: number): SheetGeometry {
  const cell = 16;
  const inset = 8;
  const gutter = 26;
  const smallestGap = 10;
  const { rows, cols } = instrument.padLayout;
  const frameWidth = cols * cell + inset * 2;
  const frameHeight = rows * cell + inset * 2;
  const room = width - gutter;
  const columns = Math.max(2, Math.floor((room + smallestGap) / (frameWidth + smallestGap)));
  const lineGap = 22;
  return {
    cell,
    inset,
    frameWidth,
    frameHeight,
    columns,
    gap: (room - columns * frameWidth) / (columns - 1),
    gutter,
    lineGap,
    lineHeight: frameHeight + lineGap,
  };
}

export function buildSheetFrames(notes: Note[], instrument: InstrumentDefinition, beatsPerBar: number): SheetFrame[] {
  const frames: SheetFrame[] = [];
  for (const note of sortNotes(notes)) {
    if (note.pad < 0 || note.pad >= instrument.pads.length) continue;
    const last = frames[frames.length - 1];
    if (last && Math.abs(last.startBeat - note.startBeat) < SAME_MOMENT) {
      if (!last.pads.includes(note.pad)) last.pads.push(note.pad);
      continue;
    }
    // Triplet grids land a hair under the bar line; rounding keeps them in the right bar.
    const start = Math.max(0, Math.round(note.startBeat * 1e6) / 1e6);
    const bar = Math.floor(start / beatsPerBar);
    frames.push({ index: frames.length, startBeat: note.startBeat, bar, beat: start - bar * beatsPerBar, pads: [note.pad] });
  }
  return frames;
}

/**
 * Sets frames out in lines of `columns`. Empty bars between frames become one rest cell
 * saying how many bars to wait, so a long pause does not fill the page with blanks.
 */
export function layoutSheet(frames: SheetFrame[], columns: number): SheetLine[] {
  const lines: SheetLine[] = [];
  let line: SheetLine | null = null;
  const add = (bar: number, make: (column: number) => SheetCell) => {
    if (!line || line.cells.length >= columns) {
      line = { bar, cells: [] };
      lines.push(line);
    }
    line.cells.push(make(line.cells.length));
  };
  let previousBar = -1;
  for (const frame of frames) {
    const emptyBars = frame.bar - previousBar - 1;
    if (emptyBars > 0) {
      const fromBar = previousBar + 1;
      add(fromBar, (column) => ({ kind: 'rest', column, fromBar, bars: emptyBars }));
    }
    add(frame.bar, (column) => ({ kind: 'frame', column, frame }));
    previousBar = frame.bar;
  }
  return lines;
}

/** Splits lines into pages: the first page is shorter because it carries the heading. */
export function paginateSheet(lines: SheetLine[], firstPageLines: number, pageLines: number): SheetLine[][] {
  const pages: SheetLine[][] = [];
  let start = 0;
  while (start < lines.length) {
    const size = Math.max(1, pages.length === 0 ? firstPageLines : pageLines);
    pages.push(lines.slice(start, start + size));
    start += size;
  }
  return pages.length > 0 ? pages : [[]];
}

/** The frame sounding at `beat`: the last one that has started. -1 before the first. */
export function frameAtBeat(frames: SheetFrame[], beat: number): number {
  let low = 0;
  let high = frames.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (frames[middle].startBeat <= beat + SAME_MOMENT) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}
