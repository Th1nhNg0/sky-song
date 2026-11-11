/** The spaces a song can be played in, and the procedural impulse each one rings with. */

import { mulberry32 } from './random';

export interface ReverbImpulseOptions {
  /** Audible tail length in seconds. */
  seconds?: number;
  /** Silence before the first reflection, in seconds. */
  predelaySeconds?: number;
  /** High-frequency damping cutoff in Hz. */
  dampingHz?: number;
  /** Low-frequency body under the tail: more for enclosed stone, less for open air. */
  body?: number;
  /** Level of the diffuse tail against the reflections and echoes. */
  tailLevel?: number;
  /** How far apart the early reflections land: 1 is the cave's walls. */
  size?: number;
  /** Distinct repeats bouncing back from a far wall. */
  echo?: { delaySeconds: number; feedback: number; count: number; level: number };
}

export interface ReverbSpace {
  id: string;
  name: string;
  hint: string;
  /** Return level against the cave, so every space sits at a comparable loudness. */
  level: number;
  impulse: ReverbImpulseOptions;
}

/**
 * Original synthetic spaces in the spirit of the places Sky is played in. None is a
 * recording or a measurement of a Sky area.
 */
export const REVERB_SPACES = [
  {
    id: 'sky',
    name: 'Open sky',
    hint: 'Open air above the clouds: a short, light bloom.',
    level: 1.5,
    impulse: { seconds: 1.5, predelaySeconds: 0.012, dampingHz: 5200, body: 0.15, size: 0.7 },
  },
  {
    id: 'cave',
    name: 'Cave',
    hint: 'A large, warm cave with a long soft tail.',
    level: 1,
    impulse: {},
  },
  {
    id: 'temple',
    name: 'Temple hall',
    hint: 'A bright stone hall: clear walls and a medium tail.',
    level: 1.15,
    impulse: { seconds: 3.1, predelaySeconds: 0.04, dampingHz: 4800, body: 0.4, size: 1.6 },
  },
  {
    id: 'vault',
    name: 'Great vault',
    hint: 'A vast, dark chamber where notes hang for a long time.',
    level: 0.9,
    impulse: { seconds: 8.5, predelaySeconds: 0.06, dampingHz: 2400, body: 0.9, size: 2.2 },
  },
  {
    id: 'canyon',
    name: 'Canyon echo',
    hint: 'Notes call back from a far wall before they fade.',
    level: 1.6,
    impulse: {
      seconds: 3.6,
      predelaySeconds: 0.02,
      dampingHz: 3800,
      body: 0.3,
      tailLevel: 0.35,
      size: 1.3,
      echo: { delaySeconds: 0.34, feedback: 0.5, count: 5, level: 1 },
    },
  },
] as const satisfies readonly ReverbSpace[];

export type ReverbSpaceId = (typeof REVERB_SPACES)[number]['id'];

export const DEFAULT_REVERB_SPACE: ReverbSpaceId = 'cave';

export function isReverbSpaceId(value: unknown): value is ReverbSpaceId {
  return REVERB_SPACES.some((space) => space.id === value);
}

export function getReverbSpace(id: ReverbSpaceId): ReverbSpace {
  return REVERB_SPACES.find((space) => space.id === id) ?? REVERB_SPACES[1];
}

const REFLECTION_TIMES = [0.008, 0.015, 0.024, 0.037, 0.052, 0.074, 0.098];
const REFLECTION_GAINS = [0.55, 0.42, 0.35, 0.28, 0.2, 0.14, 0.1];
/** Length of note an echo has to stand clear of: the tail under it grows with the note. */
const ECHO_NOTE_SECONDS = 0.4;

/**
 * Procedural impulse: a soft pre-delay, a handful of early reflections, a wide
 * decorrelated diffuse tail and a long smooth fade. With no options it is the
 * "large cave" the app has always used.
 */
export function generateReverbImpulseData(
  sampleRate: number,
  options: ReverbImpulseOptions = {},
): [Float32Array, Float32Array] {
  const seconds = options.seconds ?? 5.2;
  const predelay = options.predelaySeconds ?? 0.028;
  const dampingHz = options.dampingHz ?? 3400;
  const body = options.body ?? 0.6;
  const tailLevel = options.tailLevel ?? 1;
  const size = options.size ?? 1;
  const totalSeconds = seconds + predelay;
  const length = Math.max(1, Math.floor(sampleRate * totalSeconds));
  const predelayFrames = Math.min(length, Math.floor(predelay * sampleRate));
  const channels: [Float32Array, Float32Array] = [
    new Float32Array(length),
    new Float32Array(length),
  ];
  const dampingCoefficient = 1 - Math.exp((-2 * Math.PI * dampingHz) / sampleRate);

  for (let channel = 0; channel < 2; channel++) {
    const data = channels[channel];
    const random = mulberry32(0xc0ffee + channel * 7919);
    let damped = 0;
    let low = 0;
    const stereoSign = channel === 0 ? 1 : -1;
    for (let i = predelayFrames; i < length; i++) {
      const t = (i - predelayFrames) / (length - predelayFrames);
      const fadeOut = Math.pow(1 - Math.min(1, t), 2.2);
      const noise = random() * 2 - 1;
      damped += (noise - damped) * dampingCoefficient;
      low += (damped - low) * 0.02;
      // Mix the damped diffuse field with a little low-frequency body so the tail
      // feels like a large enclosed space rather than bright noise.
      data[i] = (damped * 1.25 + low * body) * fadeOut * tailLevel;
    }
    for (let index = 0; index < REFLECTION_TIMES.length; index++) {
      const position = predelayFrames + Math.floor(REFLECTION_TIMES[index] * size * sampleRate);
      if (position < length) {
        data[position] += REFLECTION_GAINS[index] * stereoSign * (index % 2 === 0 ? 1 : -0.7);
      }
    }
    if (options.echo) addEchoes(data, sampleRate, predelayFrames, channel, options.echo);
  }

  // Normalise both channels to a sane maximum so the convolver sees a usable IR.
  let peak = 0;
  for (const data of channels) {
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  }
  if (peak > 0) {
    const scale = 0.62 / peak;
    for (const data of channels) {
      for (let i = 0; i < data.length; i++) data[i] *= scale;
    }
  }
  return channels;
}

/**
 * Whole copies of the sound coming back late. Each repeat is quieter, duller (air
 * takes the highs) and leans to the other ear, the way a call crosses a canyon.
 */
function addEchoes(
  data: Float32Array,
  sampleRate: number,
  predelayFrames: number,
  channel: number,
  echo: NonNullable<ReverbImpulseOptions['echo']>,
): void {
  // A single copy has to stand above a tail that sums a whole note's worth of noise.
  const clear = echo.level * 0.4 * Math.sqrt(sampleRate * ECHO_NOTE_SECONDS);
  for (let repeat = 1; repeat <= echo.count; repeat++) {
    const start = predelayFrames + Math.floor(repeat * echo.delaySeconds * sampleRate);
    const side = (repeat + channel) % 2 === 0 ? 1 : 0.55;
    const gain = clear * Math.pow(echo.feedback, repeat - 1) * side;
    // A one-pole smear whose weights add up to 1: the repeat keeps its level and loses its edge.
    const sharpness = 1 / (1 + repeat * 0.8);
    let weight = sharpness;
    for (let i = start; i < data.length && weight > 1e-4; i++) {
      data[i] += gain * weight;
      weight *= 1 - sharpness;
    }
  }
}

const impulseCache = new WeakMap<BaseAudioContext, Map<ReverbSpaceId, AudioBuffer>>();

/** Builds/caches a space's stereo impulse for a given AudioContext or OfflineAudioContext. */
export function getReverbImpulse(ctx: BaseAudioContext, spaceId: ReverbSpaceId = DEFAULT_REVERB_SPACE): AudioBuffer {
  let cache = impulseCache.get(ctx);
  if (!cache) {
    cache = new Map();
    impulseCache.set(ctx, cache);
  }
  const cached = cache.get(spaceId);
  if (cached) return cached;
  const [left, right] = generateReverbImpulseData(ctx.sampleRate, getReverbSpace(spaceId).impulse);
  const impulse = ctx.createBuffer(2, left.length, ctx.sampleRate);
  impulse.getChannelData(0).set(left);
  impulse.getChannelData(1).set(right);
  cache.set(spaceId, impulse);
  return impulse;
}
