import { getKey, midiToFrequency, midiToSpelledName } from './keys';
import type { InstrumentDefinition, ResolvedPad } from './types';

/** Converts a 0-based pad index on an instrument into pitch / drum information. */
export function resolvePad(
  instrument: InstrumentDefinition,
  keyIndex: number,
  padIndex: number,
): ResolvedPad {
  const pad = instrument.pads[padIndex];
  if (!pad) {
    throw new Error(
      `${instrument.displayName} has no pad ${padIndex + 1} (valid: 1–${instrument.pads.length})`,
    );
  }
  const key = getKey(keyIndex);
  if (!pad.pitched || pad.semitone === null) {
    return {
      padIndex,
      pitched: false,
      midi: null,
      frequency: null,
      noteName: null,
      degree: null,
      degreeLabel: '–',
      drumNote: pad.gmDrum ?? null,
      label: pad.label ?? `Pad ${padIndex + 1}`,
    };
  }
  const midi = 12 * (instrument.baseOctave + 1) + key.tonicPc + pad.semitone;
  const degreeLabel = pad.degree ? `deg ${pad.degree}` : '';
  return {
    padIndex,
    pitched: true,
    midi,
    frequency: midiToFrequency(midi),
    noteName: midiToSpelledName(midi, key),
    degree: pad.degree,
    degreeLabel,
    drumNote: null,
    label: midiToSpelledName(midi, key),
  };
}
