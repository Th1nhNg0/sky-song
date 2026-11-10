/**
 * Web Audio playback of a user-recorded note.
 *
 * This function is used by the realtime AudioEngine. Pitch-shifting is a playback-rate change (equal
 * temperament); a note that was recorded at the requested pitch plays at rate 1.
 */

import type { SampleSelection } from './sampleBank';
import { findSustainLoop, joinSustainLoop, packSustains, type SustainLoop } from './soundPack';
import type { NoteVoiceSpec, SynthVoice } from './synth';

const SAMPLE_LEVEL = 0.3;

const bufferCache = new WeakMap<BaseAudioContext, Map<string, CachedBuffer>>();

interface CachedBuffer {
  buffer: AudioBuffer;
  loop: SustainLoop | null;
}

let sampleVoicesCreated = 0;

/** Debug/diagnostic counter used by browser tests to prove the sample path ran. */
export function getSampleVoiceCount(): number {
  return sampleVoicesCreated;
}

function getSampleBuffer(
  ctx: BaseAudioContext,
  selection: SampleSelection,
  sustains: boolean,
): CachedBuffer {
  let perContext = bufferCache.get(ctx);
  if (!perContext) {
    perContext = new Map();
    bufferCache.set(ctx, perContext);
  }
  const { pack, sample } = selection;
  const frames = sample.channels[0]?.length ?? 0;
  const key = `${pack.id}:${pack.updatedAt}:${sample.id}:${sample.sampleRate}:${frames}:${sustains}`;
  const cached = perContext.get(key);
  if (cached) return cached;
  const buffer = ctx.createBuffer(
    Math.max(1, sample.channels.length),
    Math.max(1, frames),
    sample.sampleRate,
  );
  for (let channel = 0; channel < sample.channels.length; channel++) {
    buffer.getChannelData(channel).set(sample.channels[channel]);
  }
  const loop = sustains && packSustains(pack.samples) ? findSustainLoop(sample.channels, sample.sampleRate) : null;
  if (loop) {
    for (let channel = 0; channel < sample.channels.length; channel++) {
      joinSustainLoop(buffer.getChannelData(channel), loop);
    }
  }
  const entry = { buffer, loop };
  perContext.set(key, entry);
  return entry;
}

/** Declared here (not imported) so the sample path has no runtime dependency on synth. */
export interface SampleVoiceOptions {
  start: number;
  velocity: number;
}

export function createSampleVoice(
  ctx: BaseAudioContext,
  spec: NoteVoiceSpec,
  selection: SampleSelection,
  options: SampleVoiceOptions,
): SynthVoice {
  const { sample, playbackRate } = selection;
  sampleVoicesCreated += 1;
  const frames = sample.channels[0]?.length ?? 0;
  const start = Math.max(options.start, ctx.currentTime + 0.002);
  const velocity = Math.max(0.02, Math.min(1, options.velocity));
  const source = ctx.createBufferSource();
  const { buffer, loop } = getSampleBuffer(ctx, selection, spec.instrument.supportsHold);
  source.buffer = buffer;
  if (loop) {
    source.loop = true;
    source.loopStart = loop.startFrame / sample.sampleRate;
    source.loopEnd = loop.endFrame / sample.sampleRate;
  }
  source.playbackRate.value = playbackRate;

  const gain = ctx.createGain();
  source.connect(gain);
  gain.connect(spec.destination);

  const naturalDuration = loop
    ? Infinity
    : frames > 0 ? frames / (sample.sampleRate * Math.max(0.01, playbackRate)) : 0.001;
  const level = Math.max(0.0002, sample.gain * velocity * SAMPLE_LEVEL);
  const attack = 0.001;
  const noteEnd = start + Math.max(0.05, spec.durationSeconds);
  const release = 0.35;
  const holdEnd = spec.instrument.supportsHold ? noteEnd : start;
  const stopAt = Math.max(
    start + attack + 0.01,
    Math.min(start + naturalDuration, spec.instrument.supportsHold ? holdEnd + release : start + naturalDuration),
  );
  const fade = spec.instrument.supportsHold ? Math.min(0.35, Math.max(0.02, stopAt - start - attack)) : 0.03;

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(level, start + attack);
  gain.gain.setValueAtTime(level, Math.max(start + attack, stopAt - fade));
  gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);
  source.start(start);
  source.stop(stopAt + 0.03);

  let stopped = false;
  const stop = (when?: number) => {
    if (stopped) return;
    stopped = true;
    const at = Math.max(ctx.currentTime, when ?? ctx.currentTime);
    try {
      gain.gain.cancelScheduledValues(at);
      gain.gain.setTargetAtTime(0.0001, at, 0.012);
    } catch {
      gain.gain.value = 0;
    }
    try {
      source.stop(at + 0.06);
    } catch {
      // Already stopped; nothing to do.
    }
  };

  return { endTime: stopAt + 0.05, stop };
}
