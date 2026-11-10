import type { InstrumentDefinition } from './types';

const KEY_ROWS = ['QWERT', 'ASDFG', 'ZXCVB'];

/** The computer key for a pad, by its place on the instrument's physical grid. */
export function padKey(instrument: InstrumentDefinition, pad: number): string | null {
  const { row, col } = instrument.pads[pad];
  return KEY_ROWS[row]?.[col] ?? null;
}

export function padForKey(instrument: InstrumentDefinition, key: string): number | null {
  const upper = key.toUpperCase();
  const pad = instrument.pads.find((item) => padKey(instrument, item.index) === upper);
  return pad ? pad.index : null;
}
