import { midiToFrequency } from '../music/keys';
import { resolvePad } from '../music/pitch';
import type { InstrumentDefinition, PercussionVoiceId } from '../music/types';
import { getNoiseBuffer, hashString, mulberry32 } from './random';
import { resolveSampleForNote } from './sampleBank';
import { createSampleVoice } from './sampleVoice';
import { PROFILES, type SynthProfile } from './synthProfiles';
import { createVoiceStop } from './voice';
import { clamp } from '../util';

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
    return { endTime: result.endTime, stop: createVoiceStop(ctx, voiceGain, () => panner.disconnect()) };
  }

  const midi = resolved.midi!;
  const frequency = midiToFrequency(midi);
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

  const stop = createVoiceStop(ctx, voiceGain, (at) => {
    for (const source of sources) {
      safeStop(source, at + 0.08);
    }
    try {
      filter.disconnect();
    } catch {
      // ignore
    }
  });

  return { endTime, stop };
}
