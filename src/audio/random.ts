/** Deterministic pseudo-random helpers shared by the synth and reverb. */

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** One second of deterministic white noise, reused by every voice. */
export function getNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const cached = noiseCache.get(ctx);
  if (cached) return cached;
  const length = Math.max(1, Math.floor(ctx.sampleRate));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const random = mulberry32(0x5eed1234);
  for (let i = 0; i < length; i++) {
    data[i] = random() * 2 - 1;
  }
  noiseCache.set(ctx, buffer);
  return buffer;
}

interface ReverbImpulseOptions {
  /** Audible tail length in seconds. */
  seconds?: number;
  /** Silence before the first reflection, in seconds. */
  predelaySeconds?: number;
  /** High-frequency damping cutoff in Hz. */
  dampingHz?: number;
}

/**
 * Procedural "large cave" impulse: a soft pre-delay, a handful of early
 * reflections, a wide decorrelated diffuse tail and a long smooth fade. This is an
 * original synthetic space, not a recording of a Sky area.
 */
function generateReverbImpulseData(
  sampleRate: number,
  options: ReverbImpulseOptions = {},
): [Float32Array, Float32Array] {
  const seconds = options.seconds ?? 5.2;
  const predelay = options.predelaySeconds ?? 0.028;
  const dampingHz = options.dampingHz ?? 3400;
  const totalSeconds = seconds + predelay;
  const length = Math.max(1, Math.floor(sampleRate * totalSeconds));
  const predelayFrames = Math.min(length, Math.floor(predelay * sampleRate));
  const channels: [Float32Array, Float32Array] = [
    new Float32Array(length),
    new Float32Array(length),
  ];
  const reflectionTimes = [0.008, 0.015, 0.024, 0.037, 0.052, 0.074, 0.098];
  const reflectionGains = [0.55, 0.42, 0.35, 0.28, 0.2, 0.14, 0.1];
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
      data[i] = (damped * 1.25 + low * 0.6) * fadeOut;
    }
    for (let index = 0; index < reflectionTimes.length; index++) {
      const position = predelayFrames + Math.floor(reflectionTimes[index] * sampleRate);
      if (position < length) {
        data[position] += reflectionGains[index] * stereoSign * (index % 2 === 0 ? 1 : -0.7);
      }
    }
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

const reverbCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Builds/caches the stereo impulse for a given AudioContext or OfflineAudioContext. */
export function getReverbImpulse(ctx: BaseAudioContext): AudioBuffer {
  const cache = reverbCache.get(ctx);
  if (cache) return cache;
  const [left, right] = generateReverbImpulseData(ctx.sampleRate);
  const impulse = ctx.createBuffer(2, left.length, ctx.sampleRate);
  impulse.getChannelData(0).set(left);
  impulse.getChannelData(1).set(right);
  reverbCache.set(ctx, impulse);
  return impulse;
}
