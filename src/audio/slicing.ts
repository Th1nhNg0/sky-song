/**
 * Slice a single recording of a played scale into one sample per note.
 *
 * The detector uses a short-time RMS envelope with hysteresis. That is deliberately
 * simple and predictable for the intended material (one instrument, one note at a
 * time, from a game recording): it does not need spectral flux or a trained model.
 * The UI exposes the threshold and gap controls and the user can correct every
 * detected note, so a failed onset is recoverable rather than silently wrong.
 */

import { detectPitch, mixToMono, type PitchDetectionOptions, type PitchResult } from './pitchDetect';
import { normalizeSlice, type PackSample } from './soundPack';

export interface OnsetDetectionOptions {
  /** Onset threshold relative to the loudest frame, in dB (default -32). */
  thresholdDb?: number;
  /** Minimum spacing between onsets (default 90 ms). */
  minGapSeconds?: number;
  /** Minimum slice length (default 80 ms). */
  minSliceSeconds?: number;
  /** Maximum slice length (default 6 s). */
  maxSliceSeconds?: number;
  /** Keep a little pre-roll before the detected attack (default 10 ms). */
  preRollSeconds?: number;
  /** Fade-out applied to each slice to avoid clicks (default 30 ms). */
  fadeOutSeconds?: number;
  /** Skip pitch detection (percussion packs). */
  detectPitches?: boolean;
}

interface DetectedSlice {
  startSample: number;
  endSample: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

export interface AnalyzedSlice extends DetectedSlice {
  sample: PackSample;
  pitch: PitchResult | null;
}

const DEFAULTS: Required<OnsetDetectionOptions> = {
  thresholdDb: -32,
  minGapSeconds: 0.09,
  minSliceSeconds: 0.08,
  maxSliceSeconds: 6,
  preRollSeconds: 0.01,
  fadeOutSeconds: 0.03,
  detectPitches: true,
};

/** Wider and more forgiving than the detector's defaults: game recordings are breathy and reach low. */
const SLICE_PITCH_OPTIONS: PitchDetectionOptions = {
  minFrequency: 45,
  maxFrequency: 2600,
  minConfidence: 0.18,
  skipSeconds: 0.015,
  windowSeconds: 0.12,
};

interface Envelope {
  rms: Float32Array;
  frameSize: number;
  hop: number;
  sampleRate: number;
  threshold: number;
  halfThreshold: number;
  peak: number;
}

function percentile(sortedValues: number[], fraction: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.floor(fraction * sortedValues.length)));
  return sortedValues[index];
}

function buildEnvelope(mono: Float32Array, sampleRate: number, thresholdDb: number): Envelope {
  const frameSize = Math.max(128, Math.round(sampleRate * 0.02));
  const hop = Math.max(32, Math.round(sampleRate * 0.005));
  const frameCount = mono.length >= frameSize ? Math.floor((mono.length - frameSize) / hop) + 1 : 0;
  const rms = new Float32Array(Math.max(0, frameCount));
  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * hop;
    let sum = 0;
    for (let i = 0; i < frameSize; i++) {
      const value = mono[start + i];
      sum += value * value;
    }
    rms[frame] = Math.sqrt(sum / frameSize);
  }
  let peak = 0;
  for (let i = 0; i < rms.length; i++) peak = Math.max(peak, rms[i]);
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const noiseFloor = percentile(sorted, 0.15);
  const relative = peak * Math.pow(10, thresholdDb / 20);
  const threshold = Math.max(relative, noiseFloor * 2.5, 1e-5);
  return { rms, frameSize, hop, sampleRate, threshold, halfThreshold: threshold * 0.5, peak };
}

function refineOnsetFrame(envelope: Envelope, onsetFrame: number): number {
  // Walk back to the local energy minimum in the ~40 ms before the threshold crossing.
  const lookBack = Math.max(1, Math.round((0.04 * envelope.sampleRate) / envelope.hop));
  let frame = onsetFrame;
  const limit = Math.max(0, onsetFrame - lookBack);
  while (frame > limit && envelope.rms[frame - 1] < envelope.rms[frame]) frame--;
  return frame;
}

/** Onset times in seconds for a mono signal. */
function detectOnsets(
  mono: Float32Array,
  sampleRate: number,
  options: OnsetDetectionOptions = {},
): number[] {
  const config = { ...DEFAULTS, ...options };
  if (mono.length === 0 || sampleRate <= 0) return [];
  const envelope = buildEnvelope(mono, sampleRate, config.thresholdDb);
  const { rms, hop, threshold, halfThreshold, peak } = envelope;
  if (peak < 1e-4 || rms.length === 0) return [];

  const onsets: number[] = [];
  let armed = true;
  let lastOnsetSample = -Infinity;
  const minGapSamples = config.minGapSeconds * sampleRate;

  for (let frame = 1; frame < rms.length; frame++) {
    const previous = rms[frame - 1];
    const current = rms[frame];
    if (armed && current >= threshold && previous < threshold) {
      const refined = refineOnsetFrame(envelope, frame);
      const samplePosition = refined * hop;
      if (samplePosition - lastOnsetSample >= minGapSamples) {
        onsets.push(samplePosition / sampleRate);
        lastOnsetSample = samplePosition;
      }
      armed = false;
    } else if (!armed && current < halfThreshold) {
      armed = true;
    }
  }
  return onsets;
}

/**
 * Finds a natural end for a slice: the point where the envelope falls well below
 * the onset threshold and stays there, capped by the next onset and max length.
 */
function findSliceEndSeconds(
  envelope: Envelope,
  startFrame: number,
  nextOnsetSeconds: number | null,
  sampleRate: number,
  config: Required<OnsetDetectionOptions>,
): number {
  const { rms, hop, halfThreshold } = envelope;
  const startSeconds = (startFrame * hop) / sampleRate;
  const hardLimitSeconds =
    nextOnsetSeconds !== null
      ? Math.min(nextOnsetSeconds - config.preRollSeconds * 0.5, startSeconds + config.maxSliceSeconds)
      : Math.min(envelope.rms.length * hop / sampleRate, startSeconds + config.maxSliceSeconds);
  const quietThreshold = halfThreshold * 0.5;
  let quietFrames = 0;
  let endSeconds = hardLimitSeconds;
  for (let frame = startFrame + 1; frame < rms.length; frame++) {
    const time = (frame * hop) / sampleRate;
    if (time > hardLimitSeconds) break;
    if (rms[frame] < quietThreshold) {
      quietFrames++;
      if (quietFrames >= 4) {
        endSeconds = Math.max(startSeconds + config.minSliceSeconds, time - (4 * hop) / sampleRate + 0.02);
        break;
      }
    } else {
      quietFrames = 0;
    }
  }
  return Math.max(startSeconds + config.minSliceSeconds, endSeconds);
}

function sliceRecording(
  channels: Float32Array[],
  sampleRate: number,
  options: OnsetDetectionOptions = {},
): DetectedSlice[] {
  const config = { ...DEFAULTS, ...options };
  if (channels.length === 0 || sampleRate <= 0) return [];
  const mono = mixToMono(channels);
  const onsets = detectOnsets(mono, sampleRate, options);
  if (onsets.length === 0) return [];
  const envelope = buildEnvelope(mono, sampleRate, config.thresholdDb);
  const frames = channels[0].length;
  const slices: DetectedSlice[] = [];

  for (let index = 0; index < onsets.length; index++) {
    const onsetSeconds = onsets[index];
    const nextOnset = index + 1 < onsets.length ? onsets[index + 1] : null;
    const startSeconds = Math.max(0, onsetSeconds - config.preRollSeconds);
    const startSample = Math.max(0, Math.min(frames - 1, Math.round(startSeconds * sampleRate)));
    const startFrame = Math.floor(startSample / envelope.hop);
    const endSeconds = Math.min(
      frames / sampleRate,
      findSliceEndSeconds(envelope, startFrame, nextOnset, sampleRate, config),
    );
    const endSample = Math.max(startSample + 1, Math.min(frames, Math.round(endSeconds * sampleRate)));
    slices.push({
      startSample,
      endSample,
      startSeconds: startSample / sampleRate,
      endSeconds: endSample / sampleRate,
      durationSeconds: (endSample - startSample) / sampleRate,
    });
  }
  return slices;
}

/**
 * Full analysis used by the Sounds panel: slices + per-slice normalisation +
 * automatic pitch detection. `midi` is the editable mapping; `detectedMidi`
 * preserves what the detector said for provenance.
 */
export function analyzeRecording(
  channels: Float32Array[],
  sampleRate: number,
  options: OnsetDetectionOptions = {},
): AnalyzedSlice[] {
  const config = { ...DEFAULTS, ...options };
  const slices = sliceRecording(channels, sampleRate, options);
  return slices.map((slice) => {
    const sliceChannels = channels.map((channel) => channel.subarray(slice.startSample, slice.endSample));
    const sample = normalizeSlice(sliceChannels, sampleRate, {
      fadeOutSeconds: config.fadeOutSeconds,
    });
    sample.sourceStartSeconds = slice.startSeconds;
    sample.durationSeconds = slice.durationSeconds;
    const pitch = config.detectPitches
      ? detectPitch(sample.channels, sampleRate, SLICE_PITCH_OPTIONS)
      : null;
    if (pitch) {
      sample.midi = pitch.midi;
      sample.detectedMidi = pitch.midi;
      sample.confidence = pitch.confidence;
    }
    return { ...slice, sample, pitch };
  });
}

/** Builds a pack sample from a complete per-note file. */
export function analyzeFile(
  channels: Float32Array[],
  sampleRate: number,
  detect: boolean,
): { sample: PackSample; pitch: PitchResult | null } {
  const sample = normalizeSlice(channels, sampleRate);
  sample.durationSeconds = sample.channels[0] ? sample.channels[0].length / sampleRate : 0;
  const pitch = detect
    ? detectPitch(sample.channels, sampleRate, SLICE_PITCH_OPTIONS)
    : null;
  if (pitch) {
    sample.midi = pitch.midi;
    sample.detectedMidi = pitch.midi;
    sample.confidence = pitch.confidence;
  }
  return { sample, pitch };
}
