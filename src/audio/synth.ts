import { resolvePad } from '../music/pitch';
import type { InstrumentDefinition, PercussionVoiceId, SoundProfileId } from '../music/types';
import { getNoiseBuffer, hashString, mulberry32 } from './random';
import { resolveSampleForNote } from './sampleBank';
import { createSampleVoice } from './sampleVoice';

type PartialSpec = readonly [ratio: number, amplitude: number, decayScale?: number];

interface NoiseSpec {
  amount: number;
  type: BiquadFilterType;
  frequency: number;
  q: number;
  decay: number;
}

interface SynthProfile {
  kind: 'pluck' | 'struck' | 'blow' | 'sustain' | 'percussion';
  osc: OscillatorType;
  partials: readonly PartialSpec[];
  attack: number;
  decay: number;
  sustainLevel: number;
  release: number;
  naturalDecay: number;
  minHold: number;
  maxHold: number;
  lowpass: number;
  q: number;
  /** Filter-bloom multiplier at note start; 1 = no bloom. */
  filterFrom: number;
  /** Seconds for the filter bloom to settle at the nominal cutoff. */
  filterDecay: number;
  /** Extra quiet air after the main decay, in seconds. */
  tail: number;
  /** Sustained breath/air noise bed (winds, choir). */
  breath?: NoiseSpec;
  vibratoRate: number;
  vibratoCents: number;
  detuneSpread: number;
  ensemble: number;
  noise?: NoiseSpec;
  gain: number;
  distortion?: number;
}

function profile(partial: Partial<SynthProfile> & Pick<SynthProfile, 'kind'>): SynthProfile {
  return {
    osc: 'sine',
    partials: [
      [1, 0.6],
      [2, 0.22],
      [3, 0.1],
    ],
    attack: 0.005,
    decay: 0.2,
    sustainLevel: 0.55,
    release: 0.25,
    naturalDecay: 2,
    minHold: 0.25,
    maxHold: 6,
    lowpass: 6000,
    q: 0.7,
    filterFrom: 1.6,
    filterDecay: 0.3,
    tail: 0.5,
    vibratoRate: 0,
    vibratoCents: 0,
    detuneSpread: 4,
    ensemble: 1,
    gain: 0.5,
    ...partial,
  };
}

/**
 * Original synthesis profiles, reworked for the calm, rounded, cave-like character
 * associated with Sky. These remain approximations, not transcriptions: soft attacks,
 * long quiet tails, warm low-passed partials and a large procedural reverb (see
 * `random.ts`). Spectral-centroid and decay targets are checked in `tests/`.
 */
const PROFILES: Record<SoundProfileId, SynthProfile> = {
  harp: profile({
    kind: 'pluck',
    osc: 'triangle',
    partials: [
      [0.5, 0.075],
      [1, 0.46],
      [2, 0.26],
      [3, 0.13],
      [4, 0.07],
      [5, 0.04],
      [6, 0.022],
      [8, 0.01],
    ],
    attack: 0.014,
    naturalDecay: 4.6,
    lowpass: 4600,
    q: 0.65,
    filterFrom: 2.6,
    filterDecay: 0.4,
    tail: 1.0,
    detuneSpread: 2.5,
    ensemble: 2,
    noise: { amount: 0.02, type: 'bandpass', frequency: 1700, q: 0.7, decay: 0.05 },
    gain: 0.4,
  }),
  piano: profile({
    kind: 'pluck',
    osc: 'sine',
    partials: [
      [0.5, 0.07],
      [1, 0.5],
      [2.002, 0.24],
      [3.006, 0.12],
      [4.012, 0.075],
      [5.02, 0.045],
      [6.03, 0.028],
      [8.05, 0.014],
    ],
    attack: 0.007,
    naturalDecay: 5.2,
    lowpass: 6000,
    q: 0.6,
    filterFrom: 2.5,
    filterDecay: 0.3,
    tail: 0.9,
    detuneSpread: 2,
    noise: { amount: 0.035, type: 'bandpass', frequency: 1800, q: 0.8, decay: 0.04 },
    gain: 0.37,
  }),
  'grand-piano': profile({
    kind: 'pluck',
    osc: 'sine',
    partials: [
      [0.5, 0.09],
      [1, 0.48],
      [2.002, 0.24],
      [3.005, 0.14],
      [4.01, 0.09],
      [5.02, 0.055],
      [6.03, 0.035],
      [8.05, 0.018],
      [10.08, 0.008],
    ],
    attack: 0.007,
    naturalDecay: 6.2,
    lowpass: 7200,
    q: 0.6,
    filterFrom: 2.2,
    filterDecay: 0.32,
    tail: 1.1,
    detuneSpread: 1.5,
    noise: { amount: 0.04, type: 'bandpass', frequency: 1500, q: 0.75, decay: 0.045 },
    gain: 0.35,
  }),
  'bright-piano': profile({
    kind: 'pluck',
    osc: 'sine',
    partials: [
      [1, 0.46],
      [2.004, 0.26],
      [3.01, 0.16],
      [4.02, 0.1],
      [5.03, 0.065],
      [6.05, 0.04],
      [8.1, 0.02],
    ],
    attack: 0.006,
    naturalDecay: 3.8,
    lowpass: 8600,
    q: 0.6,
    filterFrom: 3.0,
    filterDecay: 0.22,
    tail: 0.7,
    detuneSpread: 1.5,
    noise: { amount: 0.045, type: 'bandpass', frequency: 2300, q: 0.7, decay: 0.035 },
    gain: 0.35,
  }),
  guitar: profile({
    kind: 'pluck',
    osc: 'triangle',
    partials: [
      [0.5, 0.05],
      [1, 0.5],
      [2, 0.24],
      [3, 0.13],
      [4, 0.08],
      [5, 0.045],
      [6, 0.025],
    ],
    attack: 0.009,
    naturalDecay: 3.0,
    lowpass: 3900,
    q: 0.8,
    filterFrom: 2.3,
    filterDecay: 0.28,
    tail: 0.6,
    detuneSpread: 3,
    ensemble: 2,
    noise: { amount: 0.03, type: 'bandpass', frequency: 2000, q: 1, decay: 0.03 },
    gain: 0.38,
  }),
  'electric-guitar': profile({
    kind: 'sustain',
    osc: 'sawtooth',
    partials: [
      [0.5, 0.04],
      [1, 0.32],
      [2, 0.17],
      [3, 0.11],
      [4, 0.07],
      [5, 0.045],
    ],
    attack: 0.022,
    decay: 0.18,
    sustainLevel: 0.62,
    release: 0.55,
    minHold: 0.1,
    maxHold: 16,
    lowpass: 2600,
    q: 1.2,
    filterFrom: 1.5,
    filterDecay: 0.4,
    vibratoRate: 4.6,
    vibratoCents: 2.2,
    detuneSpread: 7,
    ensemble: 2,
    noise: { amount: 0.012, type: 'highpass', frequency: 3800, q: 0.7, decay: 0.02 },
    gain: 0.27,
    distortion: 1.4,
  }),
  ukulele: profile({
    kind: 'pluck',
    osc: 'triangle',
    partials: [
      [1, 0.46],
      [2, 0.28],
      [3, 0.2],
      [4, 0.12],
      [5, 0.07],
      [7, 0.03],
    ],
    attack: 0.006,
    naturalDecay: 2.2,
    lowpass: 4800,
    q: 0.9,
    filterFrom: 2.4,
    filterDecay: 0.2,
    tail: 0.5,
    detuneSpread: 3,
    noise: { amount: 0.025, type: 'bandpass', frequency: 2800, q: 1.1, decay: 0.022 },
    gain: 0.38,
  }),
  pipa: profile({
    kind: 'pluck',
    osc: 'triangle',
    partials: [
      [1, 0.46],
      [2, 0.29],
      [3, 0.19],
      [4, 0.12],
      [5, 0.08],
      [6, 0.045],
      [8, 0.02],
    ],
    attack: 0.005,
    naturalDecay: 2.8,
    lowpass: 5400,
    q: 1.0,
    filterFrom: 2.5,
    filterDecay: 0.22,
    tail: 0.5,
    detuneSpread: 2,
    noise: { amount: 0.03, type: 'bandpass', frequency: 3000, q: 1.4, decay: 0.018 },
    gain: 0.36,
  }),
  lute: profile({
    kind: 'pluck',
    osc: 'triangle',
    partials: [
      [0.5, 0.05],
      [1, 0.5],
      [2, 0.22],
      [3, 0.12],
      [4, 0.07],
      [5, 0.035],
    ],
    attack: 0.012,
    naturalDecay: 3.2,
    lowpass: 3300,
    q: 0.7,
    filterFrom: 2.0,
    filterDecay: 0.34,
    tail: 0.7,
    detuneSpread: 2.5,
    ensemble: 2,
    noise: { amount: 0.02, type: 'bandpass', frequency: 1900, q: 0.9, decay: 0.028 },
    gain: 0.4,
  }),
  kalimba: profile({
    kind: 'pluck',
    osc: 'sine',
    partials: [
      [1, 0.55],
      [2, 0.06],
      [3, 0.2],
      [5, 0.1],
      [7, 0.05],
      [9, 0.02],
    ],
    attack: 0.005,
    naturalDecay: 3.2,
    lowpass: 4000,
    q: 0.6,
    filterFrom: 2.2,
    filterDecay: 0.22,
    tail: 0.8,
    noise: { amount: 0.035, type: 'highpass', frequency: 4800, q: 0.7, decay: 0.014 },
    gain: 0.38,
  }),
  xylophone: profile({
    kind: 'struck',
    osc: 'sine',
    partials: [
      [1, 0.45],
      [3, 0.25],
      [6.1, 0.1],
      [9.2, 0.05],
      [13.5, 0.02],
    ],
    attack: 0.004,
    naturalDecay: 1.8,
    lowpass: 7500,
    q: 0.6,
    filterFrom: 1.8,
    filterDecay: 0.18,
    tail: 0.4,
    noise: { amount: 0.02, type: 'highpass', frequency: 5800, q: 0.7, decay: 0.016 },
    gain: 0.4,
  }),
  violin: profile({
    kind: 'sustain',
    osc: 'sawtooth',
    partials: [
      [1, 0.3],
      [2, 0.17],
      [3, 0.13],
      [4, 0.09],
      [5, 0.06],
      [6, 0.04],
      [7, 0.025],
    ],
    attack: 0.14,
    decay: 0.26,
    sustainLevel: 0.58,
    release: 0.7,
    minHold: 0.12,
    maxHold: 16,
    lowpass: 2900,
    q: 0.9,
    filterFrom: 1.5,
    filterDecay: 0.5,
    vibratoRate: 5.2,
    vibratoCents: 6.5,
    detuneSpread: 4,
    ensemble: 2,
    noise: { amount: 0.025, type: 'bandpass', frequency: 2400, q: 0.8, decay: 0.3 },
    breath: { amount: 0.012, type: 'bandpass', frequency: 2200, q: 0.55, decay: 0.3 },
    gain: 0.3,
  }),
  cello: profile({
    kind: 'sustain',
    osc: 'sawtooth',
    partials: [
      [1, 0.34],
      [2, 0.18],
      [3, 0.13],
      [4, 0.08],
      [5, 0.05],
    ],
    attack: 0.16,
    decay: 0.3,
    sustainLevel: 0.58,
    release: 0.8,
    minHold: 0.15,
    maxHold: 16,
    lowpass: 1700,
    q: 0.9,
    filterFrom: 1.45,
    filterDecay: 0.55,
    vibratoRate: 4.6,
    vibratoCents: 5.5,
    detuneSpread: 4,
    ensemble: 2,
    noise: { amount: 0.02, type: 'bandpass', frequency: 1400, q: 0.9, decay: 0.34 },
    breath: { amount: 0.01, type: 'bandpass', frequency: 1200, q: 0.6, decay: 0.34 },
    gain: 0.33,
  }),
  contrabass: profile({
    kind: 'pluck',
    osc: 'sine',
    // C1 is only 33 Hz. Keep the bass pitch, but give the pluck enough upper
    // harmonics to carry on speakers that cannot reproduce the fundamental.
    // Explicit sine partials also avoid the triangle's alternating harmonics
    // cancelling some of that presence.
    partials: [
      [1, 0.48],
      [2, 0.3],
      [3, 0.22],
      [4, 0.16],
      [5, 0.12],
      [6, 0.09],
      [8, 0.05],
    ],
    attack: 0.012,
    naturalDecay: 3.6,
    lowpass: 1100,
    q: 0.7,
    filterFrom: 1.9,
    filterDecay: 0.35,
    tail: 0.8,
    detuneSpread: 2,
    noise: { amount: 0.015, type: 'lowpass', frequency: 800, q: 0.7, decay: 0.03 },
    gain: 0.42,
  }),
  voice: profile({
    kind: 'sustain',
    osc: 'sine',
    partials: [
      [1, 0.5],
      [2, 0.23],
      [3, 0.11],
      [4, 0.06],
      [5, 0.03],
    ],
    attack: 0.28,
    decay: 0.35,
    sustainLevel: 0.62,
    release: 1.1,
    minHold: 0.3,
    maxHold: 16,
    lowpass: 3400,
    q: 0.7,
    filterFrom: 1.4,
    filterDecay: 0.6,
    vibratoRate: 4.2,
    vibratoCents: 8,
    detuneSpread: 10,
    ensemble: 3,
    noise: { amount: 0.012, type: 'bandpass', frequency: 1100, q: 0.6, decay: 0.3 },
    breath: { amount: 0.02, type: 'bandpass', frequency: 1200, q: 0.6, decay: 0.3 },
    gain: 0.24,
  }),
  horn: profile({
    kind: 'blow',
    osc: 'sawtooth',
    partials: [
      [1, 0.34],
      [2, 0.19],
      [3, 0.12],
      [4, 0.08],
      [5, 0.045],
    ],
    attack: 0.1,
    decay: 0.22,
    sustainLevel: 0.62,
    release: 0.8,
    naturalDecay: 2,
    minHold: 0.35,
    maxHold: 4,
    lowpass: 1450,
    q: 0.9,
    filterFrom: 1.9,
    filterDecay: 0.55,
    vibratoRate: 4,
    vibratoCents: 2.5,
    detuneSpread: 3.5,
    ensemble: 2,
    noise: { amount: 0.015, type: 'bandpass', frequency: 800, q: 0.7, decay: 0.12 },
    breath: { amount: 0.018, type: 'bandpass', frequency: 750, q: 0.6, decay: 0.3 },
    gain: 0.3,
  }),
  bugle: profile({
    kind: 'blow',
    osc: 'sawtooth',
    partials: [
      [1, 0.32],
      [2, 0.2],
      [3, 0.15],
      [4, 0.09],
      [5, 0.055],
    ],
    attack: 0.08,
    decay: 0.2,
    sustainLevel: 0.62,
    release: 0.7,
    naturalDecay: 1.8,
    minHold: 0.3,
    maxHold: 4,
    lowpass: 2100,
    q: 0.9,
    filterFrom: 1.8,
    filterDecay: 0.5,
    vibratoRate: 4.4,
    vibratoCents: 2.5,
    detuneSpread: 3,
    ensemble: 2,
    noise: { amount: 0.018, type: 'bandpass', frequency: 1100, q: 0.7, decay: 0.1 },
    breath: { amount: 0.014, type: 'bandpass', frequency: 1000, q: 0.6, decay: 0.28 },
    gain: 0.3,
  }),
  trumpet: profile({
    kind: 'blow',
    osc: 'sawtooth',
    partials: [
      [1, 0.3],
      [2, 0.2],
      [3, 0.16],
      [4, 0.1],
      [5, 0.06],
      [6, 0.035],
    ],
    attack: 0.06,
    decay: 0.16,
    sustainLevel: 0.62,
    release: 0.6,
    naturalDecay: 1.7,
    minHold: 0.3,
    maxHold: 4,
    lowpass: 2700,
    q: 1,
    filterFrom: 1.7,
    filterDecay: 0.4,
    vibratoRate: 4.8,
    vibratoCents: 2.8,
    detuneSpread: 2.5,
    ensemble: 2,
    noise: { amount: 0.02, type: 'bandpass', frequency: 1600, q: 0.8, decay: 0.08 },
    breath: { amount: 0.016, type: 'bandpass', frequency: 1400, q: 0.6, decay: 0.25 },
    gain: 0.28,
  }),
  flute: profile({
    kind: 'blow',
    osc: 'sine',
    partials: [
      [1, 0.48],
      [2, 0.14],
      [3, 0.05],
      [4, 0.015],
    ],
    attack: 0.075,
    decay: 0.16,
    sustainLevel: 0.58,
    release: 0.85,
    naturalDecay: 1.8,
    minHold: 0.4,
    maxHold: 4,
    lowpass: 2300,
    q: 0.7,
    filterFrom: 1.7,
    filterDecay: 0.35,
    vibratoRate: 4.8,
    vibratoCents: 4.5,
    detuneSpread: 2,
    ensemble: 1,
    noise: { amount: 0.07, type: 'bandpass', frequency: 2600, q: 0.55, decay: 0.22 },
    breath: { amount: 0.03, type: 'bandpass', frequency: 2100, q: 0.5, decay: 0.3 },
    gain: 0.27,
  }),
  panflute: profile({
    kind: 'blow',
    osc: 'sine',
    partials: [
      [1, 0.46],
      [2, 0.18],
      [3, 0.07],
    ],
    attack: 0.07,
    decay: 0.15,
    sustainLevel: 0.58,
    release: 0.8,
    naturalDecay: 1.6,
    minHold: 0.35,
    maxHold: 4,
    lowpass: 2100,
    q: 0.7,
    filterFrom: 1.65,
    filterDecay: 0.35,
    vibratoRate: 4.7,
    vibratoCents: 4,
    detuneSpread: 2,
    ensemble: 1,
    noise: { amount: 0.09, type: 'bandpass', frequency: 2300, q: 0.5, decay: 0.2 },
    breath: { amount: 0.04, type: 'bandpass', frequency: 1900, q: 0.5, decay: 0.28 },
    gain: 0.27,
  }),
  ocarina: profile({
    kind: 'blow',
    osc: 'sine',
    partials: [
      [1, 0.5],
      [2, 0.14],
      [3, 0.04],
    ],
    attack: 0.06,
    decay: 0.13,
    sustainLevel: 0.6,
    release: 0.7,
    naturalDecay: 1.4,
    minHold: 0.3,
    maxHold: 4,
    lowpass: 1800,
    q: 0.7,
    filterFrom: 1.5,
    filterDecay: 0.3,
    vibratoRate: 4.6,
    vibratoCents: 3,
    detuneSpread: 2.5,
    ensemble: 1,
    noise: { amount: 0.05, type: 'bandpass', frequency: 1700, q: 0.6, decay: 0.15 },
    breath: { amount: 0.015, type: 'bandpass', frequency: 1600, q: 0.6, decay: 0.24 },
    gain: 0.3,
  }),
  saxophone: profile({
    kind: 'sustain',
    osc: 'sawtooth',
    partials: [
      [1, 0.32],
      [2, 0.19],
      [3, 0.13],
      [4, 0.08],
      [5, 0.05],
      [6, 0.025],
    ],
    attack: 0.06,
    decay: 0.18,
    sustainLevel: 0.6,
    release: 0.6,
    minHold: 0.12,
    maxHold: 16,
    lowpass: 2300,
    q: 1,
    filterFrom: 1.5,
    filterDecay: 0.45,
    vibratoRate: 5,
    vibratoCents: 6,
    detuneSpread: 5,
    ensemble: 2,
    noise: { amount: 0.03, type: 'bandpass', frequency: 2000, q: 0.7, decay: 0.2 },
    breath: { amount: 0.015, type: 'bandpass', frequency: 1800, q: 0.6, decay: 0.28 },
    gain: 0.27,
  }),
  harmonica: profile({
    kind: 'sustain',
    osc: 'square',
    partials: [
      [1, 0.24],
      [2, 0.14],
      [3, 0.09],
      [4, 0.05],
      [5, 0.03],
    ],
    attack: 0.04,
    decay: 0.12,
    sustainLevel: 0.62,
    release: 0.5,
    minHold: 0.1,
    maxHold: 16,
    lowpass: 2900,
    q: 1.2,
    filterFrom: 1.6,
    filterDecay: 0.35,
    vibratoRate: 6,
    vibratoCents: 4,
    detuneSpread: 9,
    ensemble: 2,
    noise: { amount: 0.02, type: 'bandpass', frequency: 2400, q: 0.9, decay: 0.1 },
    gain: 0.22,
  }),
  bell: profile({
    kind: 'struck',
    osc: 'sine',
    partials: [
      [0.5, 0.08],
      [1, 0.45],
      [2.02, 0.2],
      [2.76, 0.22],
      [4.07, 0.1],
      [5.43, 0.06],
      [6.79, 0.04],
      [8.93, 0.025],
    ],
    attack: 0.004,
    naturalDecay: 7.5,
    lowpass: 6500,
    q: 0.6,
    filterFrom: 1.35,
    filterDecay: 1.4,
    tail: 1.8,
    detuneSpread: 0,
    noise: { amount: 0.005, type: 'highpass', frequency: 5500, q: 0.7, decay: 0.02 },
    gain: 0.3,
  }),
  handpan: profile({
    kind: 'struck',
    osc: 'sine',
    partials: [
      [0.5, 0.03],
      [1, 0.34],
      [2, 0.26],
      [2.98, 0.2],
      [4.2, 0.12],
      [5.4, 0.08],
    ],
    attack: 0.009,
    naturalDecay: 5.2,
    lowpass: 5000,
    q: 0.6,
    filterFrom: 2.4,
    filterDecay: 0.45,
    tail: 1.2,
    detuneSpread: 1.5,
    noise: { amount: 0.018, type: 'bandpass', frequency: 1500, q: 0.9, decay: 0.022 },
    gain: 0.33,
  }),
  drum: profile({
    kind: 'percussion',
    naturalDecay: 0.4,
    release: 0.45,
    tail: 0.5,
    lowpass: 4000,
    gain: 0.5,
  }),
  cymbal: profile({
    kind: 'percussion',
    naturalDecay: 1.6,
    release: 1,
    tail: 0.8,
    lowpass: 9000,
    gain: 0.32,
  }),
};

const distortionCache = new WeakMap<BaseAudioContext, Float32Array>();

function getDistortionCurve(): Float32Array {
  const samples = 1024;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.tanh(x * 2.2) * 0.9;
  }
  return curve;
}

function getCurve(ctx: BaseAudioContext): Float32Array {
  let curve = distortionCache.get(ctx);
  if (!curve) {
    curve = getDistortionCurve();
    distortionCache.set(ctx, curve);
  }
  return curve;
}

export interface NoteVoiceSpec {
  instrument: InstrumentDefinition;
  keyIndex: number;
  pad: number;
  startTime: number;
  durationSeconds: number;
  velocity: number;
  seed?: string;
  destination: AudioNode;
}

export interface SynthVoice {
  /** Audio-clock time at which the voice is naturally silent. */
  endTime: number;
  stop: (when?: number) => void;
}


function safeStop(source: AudioScheduledSourceNode, when: number): void {
  try {
    source.stop(when);
  } catch {
    // Already stopped or never started; nothing to do.
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createNoiseHit(
  ctx: BaseAudioContext,
  destination: AudioNode,
  at: number,
  duration: number,
  amount: number,
  type: BiquadFilterType,
  frequency: number,
  q: number,
  random: () => number,
): void {
  const buffer = getNoiseBuffer(ctx);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  const gain = ctx.createGain();
  const offset = random() * Math.max(0.01, buffer.duration - 0.6);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(Math.max(0.0002, amount), at + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  source.start(at, offset);
  source.stop(at + duration + 0.02);
}

function makePanner(ctx: BaseAudioContext, pan: number): StereoPannerNode {
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  return panner;
}

function createPercussionVoice(
  ctx: BaseAudioContext,
  spec: NoteVoiceSpec,
  profile: SynthProfile,
  voiceGain: GainNode,
  start: number,
  random: () => number,
): { endTime: number } {
  const pad = spec.instrument.pads[spec.pad];
  const voice: PercussionVoiceId = pad?.percussionVoice ?? 'drum-snare';
  const drumPitch = Math.pow(2, spec.instrument.detuneCents / 1200);
  const velocity = clamp(spec.velocity, 0.05, 1);
  const destination = voiceGain;
  const addTone = (type: OscillatorType, fromHz: number, toHz: number, duration: number, gainValue: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(fromHz * drumPitch, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, toHz * drumPitch), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(gainValue * velocity, start + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
    return duration + 0.03;
  };
  const addNoise = (type: BiquadFilterType, frequency: number, q: number, duration: number, amount: number) => {
    createNoiseHit(ctx, destination, start, duration, amount * velocity, type, frequency, q, random);
    return duration + 0.02;
  };
  let end = start + 0.3;
  switch (voice) {
    case 'drum-kick':
      end = start + addTone('sine', 100, 38, 0.6, 0.85);
      addTone('sine', 190, 80, 0.22, 0.2);
      addNoise('highpass', 2200, 0.8, 0.04, 0.1);
      break;
    case 'drum-low':
      end = start + addTone('sine', 145, 72, 0.36, 0.7);
      addNoise('bandpass', 600, 1, 0.05, 0.12);
      break;
    case 'drum-mid':
      end = start + addTone('sine', 205, 110, 0.3, 0.62);
      addNoise('bandpass', 900, 1, 0.04, 0.1);
      break;
    case 'drum-high':
      end = start + addTone('sine', 280, 160, 0.24, 0.55);
      addNoise('bandpass', 1400, 1.2, 0.03, 0.1);
      break;
    case 'drum-tom':
      end = start + addTone('sine', 190, 100, 0.32, 0.66);
      addNoise('bandpass', 1000, 1, 0.04, 0.08);
      break;
    case 'drum-snare':
      addTone('triangle', 210, 170, 0.14, 0.22);
      end = start + addNoise('bandpass', 1900, 0.8, 0.44, 0.42);
      break;
    case 'drum-rim':
      end = start + addTone('square', 720, 620, 0.045, 0.22);
      addNoise('highpass', 3200, 0.7, 0.05, 0.16);
      break;
    case 'drum-shaker':
      end = start + addNoise('highpass', 5600, 0.6, 0.09, 0.2);
      break;
    case 'drum-crash':
    case 'cymbal-crash':
      end = start + addNoise('highpass', 3800, 0.45, 2.4, 0.3);
      addTone('square', 3200, 2900, 0.25, 0.03);
      break;
    case 'cymbal-splash':
      end = start + addNoise('highpass', 5200, 0.6, 0.7, 0.26);
      break;
    case 'cymbal-china':
      end = start + addNoise('bandpass', 3000, 0.4, 1.2, 0.3);
      addTone('square', 2400, 2100, 0.3, 0.03);
      break;
    case 'cymbal-ride':
      end = start + addNoise('bandpass', 4200, 0.7, 1.1, 0.18);
      addTone('sine', 1800, 1750, 0.9, 0.04);
      break;
    default:
      end = start + addTone('sine', 180, 90, 0.3, 0.5);
  }
  return { endTime: end + profile.release + profile.tail };
}

export function createNoteVoice(ctx: BaseAudioContext, spec: NoteVoiceSpec): SynthVoice {
  const profile = PROFILES[spec.instrument.soundProfile];
  const resolved = resolvePad(spec.instrument, spec.keyIndex, spec.pad);
  const start = Math.max(spec.startTime, ctx.currentTime + 0.002);
  const velocity = clamp(spec.velocity, 0.05, 1);
  const seed = hashString(spec.seed ?? `${spec.instrument.id}:${spec.pad}:${spec.startTime.toFixed(3)}`);
  const random = mulberry32(seed);

  // User-recorded sample packs take precedence over the synthesizer.
  const recorded = resolveSampleForNote(
    spec.instrument.id,
    resolved.pitched ? resolved.midi : null,
    spec.pad,
  );
  if (recorded) {
    return createSampleVoice(ctx, spec, recorded, { start, velocity });
  }

  const voiceGain = ctx.createGain();
  voiceGain.gain.setValueAtTime(1, start);
  const panner = makePanner(
    ctx,
    clamp((spec.pad - (spec.instrument.keyCount - 1) / 2) / Math.max(1, spec.instrument.keyCount), -0.35, 0.35),
  );
  voiceGain.connect(panner);
  panner.connect(spec.destination);
  const sources: AudioScheduledSourceNode[] = [];
  if (profile.kind === 'percussion' || !resolved.pitched) {
    const result = createPercussionVoice(ctx, spec, profile, voiceGain, start, random);
    const endTime = result.endTime;
    let stopped = false;
    const stop = (when?: number) => {
      if (stopped) return;
      stopped = true;
      const at = Math.max(ctx.currentTime, when ?? ctx.currentTime);
      try {
        voiceGain.gain.cancelScheduledValues(at);
        voiceGain.gain.setTargetAtTime(0.0001, at, 0.012);
      } catch {
        voiceGain.gain.value = 0;
      }
      panner.disconnect();
    };
    return { endTime, stop };
  }

  const midi = resolved.midi!;
  const frequency = 440 * Math.pow(2, (midi - 69) / 12);
  const voiceDetune = spec.instrument.detuneCents;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  const cutoff = clamp(profile.lowpass * (0.55 + velocity * 0.55), 200, 16000);
  filter.frequency.setValueAtTime(clamp(cutoff * profile.filterFrom, 200, 16000), start);
  filter.frequency.exponentialRampToValueAtTime(
    Math.max(120, cutoff),
    start + Math.max(0.03, profile.filterDecay),
  );
  filter.Q.value = profile.q;
  voiceGain.disconnect();
  voiceGain.connect(filter);
  if (profile.distortion) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = new Float32Array(getCurve(ctx));
    shaper.oversample = '2x';
    filter.connect(shaper);
    shaper.connect(panner);
  } else {
    filter.connect(panner);
  }

  const supportsHold = spec.instrument.supportsHold;
  const useHold = supportsHold && profile.kind !== 'pluck' && profile.kind !== 'struck';
  const sustainKind = useHold || profile.kind === 'sustain';
  const attack = profile.attack;
  const release = profile.release;
  const partialGain = profile.gain * velocity * 0.55;
  const naturalEnd = start + attack + profile.naturalDecay;
  const holdEnd = sustainKind
    ? Math.max(start + Math.max(spec.durationSeconds, profile.minHold), start + attack + profile.decay + 0.01)
    : profile.kind === 'blow'
      ? Math.max(
          start + clamp(spec.durationSeconds, profile.minHold, profile.maxHold),
          start + attack + profile.decay + 0.01,
        )
      : naturalEnd;

  for (const [ratio, amplitude, decayScale] of profile.partials) {
    const ensemble = profile.ensemble;
    for (let copy = 0; copy < ensemble; copy++) {
      const osc = ctx.createOscillator();
      osc.type = profile.osc;
      const detune = (random() * 2 - 1) * profile.detuneSpread + (copy - (ensemble - 1) / 2) * profile.detuneSpread * 1.5;
      osc.frequency.setValueAtTime(frequency * ratio, start);
      osc.detune.setValueAtTime(voiceDetune + detune, start);
      const gain = ctx.createGain();
      const amp = amplitude / (ensemble === 1 ? 1 : 1.6);
      const peak = partialGain * amp;
      const decayScaleValue = decayScale ?? 1;

      if (sustainKind) {
        const sustainLevel = Math.max(0.0002, peak * profile.sustainLevel);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(peak, start + attack);
        gain.gain.exponentialRampToValueAtTime(sustainLevel, start + attack + profile.decay * decayScaleValue);
        gain.gain.setValueAtTime(sustainLevel, Math.max(start + attack + 0.005, holdEnd));
        gain.gain.exponentialRampToValueAtTime(0.0001, holdEnd + release);
      } else if (profile.kind === 'blow') {
        const sustainLevel = Math.max(0.0002, peak * profile.sustainLevel);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(peak, start + attack);
        gain.gain.exponentialRampToValueAtTime(sustainLevel, start + attack + profile.decay);
        gain.gain.setValueAtTime(sustainLevel, Math.max(start + attack + 0.005, holdEnd));
        gain.gain.exponentialRampToValueAtTime(0.0001, holdEnd + release);
      } else {
        const decay = Math.max(0.08, profile.naturalDecay * decayScaleValue);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(peak, start + attack);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * 0.02), start + attack + decay);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay + Math.max(0.05, profile.tail));
      }
      osc.connect(gain);
      gain.connect(voiceGain);

      if (profile.vibratoCents > 0 && profile.vibratoRate > 0) {
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfo.frequency.value = profile.vibratoRate + (random() - 0.5) * 0.35;
        lfoGain.gain.value = profile.vibratoCents * (0.6 + random() * 0.6);
        lfo.connect(lfoGain);
        lfoGain.connect(osc.detune);
        lfo.start(start);
        lfo.stop(holdEnd + release + 0.05);
        sources.push(lfo);
      }
      osc.start(start);
      const oscStop = sustainKind || profile.kind === 'blow' ? holdEnd + release + 0.06 : naturalEnd + Math.max(0.05, profile.tail) + 0.1;
      osc.stop(oscStop);
      sources.push(osc);
    }
  }

  if (profile.noise) {
    const noise = profile.noise;
    createNoiseHit(
      ctx,
      voiceGain,
      start,
      noise.decay * 4,
      noise.amount * velocity * 0.8,
      noise.type,
      noise.frequency,
      noise.q,
      random,
    );
  }

  // Sustained breath/air bed: rounds off the attack and keeps the tone airy
  // instead of a static organ-like sustain.
  if (profile.breath) {
    const breath = profile.breath;
    const source = ctx.createBufferSource();
    source.buffer = getNoiseBuffer(ctx);
    source.loop = true;
    const breathFilter = ctx.createBiquadFilter();
    breathFilter.type = breath.type;
    breathFilter.frequency.value = breath.frequency;
    breathFilter.Q.value = breath.q;
    const breathGain = ctx.createGain();
    const level = Math.max(0.0002, breath.amount * velocity);
    const rise = sustainKind ? Math.max(0.12, attack) : attack + 0.04;
    breathGain.gain.setValueAtTime(0.0001, start);
    breathGain.gain.linearRampToValueAtTime(level, start + rise);
    if (sustainKind || profile.kind === 'blow') {
      breathGain.gain.setValueAtTime(level, Math.max(start + rise + 0.005, holdEnd));
      breathGain.gain.exponentialRampToValueAtTime(0.0001, holdEnd + release);
    } else {
      breathGain.gain.exponentialRampToValueAtTime(0.0001, start + attack + profile.naturalDecay);
    }
    source.connect(breathFilter);
    breathFilter.connect(breathGain);
    breathGain.connect(voiceGain);
    const breathStop =
      sustainKind || profile.kind === 'blow'
        ? holdEnd + release + 0.1
        : start + attack + profile.naturalDecay + Math.max(0.05, profile.tail) + 0.1;
    source.start(start, random() * 0.4);
    source.stop(breathStop);
    sources.push(source);
  }

  const endTime =
    sustainKind || profile.kind === 'blow'
      ? holdEnd + release + 0.08
      : naturalEnd + Math.max(0.05, profile.tail) + 0.12;

  // A short fade at the end prevents clicks even when the musical note is long.
  let stopped = false;
  const stop = (when?: number) => {
    if (stopped) return;
    stopped = true;
    const at = Math.max(ctx.currentTime, when ?? ctx.currentTime);
    try {
      voiceGain.gain.cancelScheduledValues(at);
      voiceGain.gain.setTargetAtTime(0.0001, at, 0.012);
    } catch {
      voiceGain.gain.value = 0;
    }
    for (const source of sources) {
      safeStop(source, at + 0.08);
    }
    try {
      filter.disconnect();
    } catch {
      // ignore
    }
  };

  return { endTime, stop };
}
