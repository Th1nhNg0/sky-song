/**
 * Monophonic pitch detection for user-recorded instrument notes.
 *
 * Uses the YIN cumulative-mean-normalised difference function. It is intentionally
 * dependency-free so packs can be analysed in the browser and in Node unit tests.
 * Detection is a convenience: the UI always lets the user correct the note.
 */

export interface PitchDetectionOptions {
  minFrequency?: number;
  maxFrequency?: number;
  /** Below this confidence the result is rejected. */
  minConfidence?: number;
  /** Analysis window length in seconds (capped by the slice length). */
  windowSeconds?: number;
  /** Skip this much of the slice start to avoid the attack transient. */
  skipSeconds?: number;
}

export interface PitchResult {
  frequency: number;
  midi: number;
  /** 0..1; 1 means a perfectly periodic signal. */
  confidence: number;
  /** Signed distance from the nearest equal-tempered MIDI note, in cents. */
  centsOff: number;
}

function midiFromFrequency(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const frames = Math.min(...channels.map((channel) => channel.length));
  const mono = new Float32Array(frames);
  for (const channel of channels) {
    for (let i = 0; i < frames; i++) mono[i] += channel[i] / channels.length;
  }
  return mono;
}

export function detectPitch(
  input: Float32Array | Float32Array[],
  sampleRate: number,
  options: PitchDetectionOptions = {},
): PitchResult | null {
  const channels = Array.isArray(input) ? input : [input];
  if (channels.length === 0 || sampleRate <= 0) return null;
  const mono = mixToMono(channels);
  const minFrequency = options.minFrequency ?? 55;
  const maxFrequency = options.maxFrequency ?? 2100;
  const minConfidence = options.minConfidence ?? 0.3;
  const skip = Math.max(0, Math.round((options.skipSeconds ?? 0.012) * sampleRate));
  const windowSeconds = options.windowSeconds ?? 0.1;
  const requestedWindow = Math.max(1024, Math.round(windowSeconds * sampleRate));
  const available = mono.length - skip;
  if (available < 256) return null;
  const windowLength = Math.min(requestedWindow, available);
  const start = skip;

  const window = new Float32Array(windowLength);
  let mean = 0;
  for (let i = 0; i < windowLength; i++) mean += mono[start + i];
  mean /= windowLength;
  let energy = 0;
  for (let i = 0; i < windowLength; i++) {
    const value = mono[start + i] - mean;
    window[i] = value;
    energy += value * value;
  }
  if (energy / windowLength < 1e-8) return null;

  const minLag = Math.max(2, Math.floor(sampleRate / maxFrequency));
  const maxLag = Math.min(
    Math.floor(sampleRate / minFrequency),
    Math.floor(windowLength / 2),
  );
  if (maxLag <= minLag) return null;

  // YIN difference function d(tau) for tau in [minLag, maxLag].
  const difference = new Float32Array(maxLag + 1);
  let runningSum = 0;
  for (let tau = minLag; tau <= maxLag; tau++) {
    let sum = 0;
    const limit = windowLength - tau;
    for (let i = 0; i < limit; i++) {
      const delta = window[i] - window[i + tau];
      sum += delta * delta;
    }
    difference[tau] = sum;
  }
  // Cumulative mean normalised difference.
  const normalised = new Float32Array(maxLag + 1);
  for (let tau = minLag; tau <= maxLag; tau++) {
    runningSum += difference[tau];
    normalised[tau] = runningSum > 0 ? (difference[tau] * (tau - minLag + 1)) / runningSum : 1;
  }

  // First dip below the absolute threshold wins; otherwise the global minimum.
  const absoluteThreshold = 0.145;
  let bestLag = -1;
  for (let tau = minLag; tau <= maxLag; tau++) {
    if (normalised[tau] < absoluteThreshold) {
      bestLag = tau;
      while (bestLag + 1 <= maxLag && normalised[bestLag + 1] < normalised[bestLag]) bestLag++;
      break;
    }
  }
  if (bestLag < 0) {
    let bestValue = Infinity;
    for (let tau = minLag; tau <= maxLag; tau++) {
      if (normalised[tau] < bestValue) {
        bestValue = normalised[tau];
        bestLag = tau;
      }
    }
    if (bestLag < 0 || bestValue > 0.5) return null;
  }

  // Parabolic interpolation around the chosen lag for sub-sample precision.
  let refinedLag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const left = normalised[bestLag - 1];
    const centre = normalised[bestLag];
    const right = normalised[bestLag + 1];
    const denominator = 2 * (2 * centre - left - right);
    if (Math.abs(denominator) > 1e-9) {
      refinedLag = bestLag + (right - left) / denominator;
    }
  }
  if (refinedLag <= 0) return null;
  const frequency = sampleRate / refinedLag;
  if (!Number.isFinite(frequency) || frequency < minFrequency || frequency > maxFrequency) return null;
  const confidence = Math.max(0, Math.min(1, 1 - normalised[bestLag]));
  if (confidence < minConfidence) return null;
  const exactMidi = midiFromFrequency(frequency);
  return {
    frequency,
    midi: Math.round(exactMidi),
    confidence,
    centsOff: (exactMidi - Math.round(exactMidi)) * 100,
  };
}
