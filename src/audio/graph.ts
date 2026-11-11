import { clamp } from '../util';

export interface VoiceGraph {
  input: AudioNode;
  /** Reverb send for this bus. */
  send: GainNode;
  /** Dry level for this bus. */
  dry: GainNode;
  trackGain: GainNode;
}

export interface MixGraph {
  ctx: BaseAudioContext;
  masterIn: GainNode;
  limiter: DynamicsCompressorNode;
  masterOut: GainNode;
  convolver: ConvolverNode;
  reverbReturn: GainNode;
  clickBus: GainNode;
  previewBus: VoiceGraph;
}

export function createBus(ctx: BaseAudioContext, graph: Pick<MixGraph, 'masterIn' | 'convolver'>, reverbAmount: number): VoiceGraph {
  const trackGain = ctx.createGain();
  const dry = ctx.createGain();
  const send = ctx.createGain();
  trackGain.gain.value = 1;
  dry.gain.value = 1;
  send.gain.value = reverbAmount;
  trackGain.connect(dry);
  dry.connect(graph.masterIn);
  trackGain.connect(send);
  send.connect(graph.convolver);
  return { input: trackGain, send, dry, trackGain };
}

/**
 * Converts the user's reverb amount + the instrument's character into a bus send.
 * Sky's spaces are large and wet, so even the default amount lifts the send well
 * above a dry room; 0 still means fully dry. Built-in voices and recordings are sent
 * alike: a recording is the instrument alone, and the space is what the game adds.
 */
export function reverbSendLevel(reverbAmount: number, instrumentSend: number): number {
  const amount = clamp(reverbAmount, 0, 1);
  return Math.min(0.85, amount * (0.3 + instrumentSend * 2));
}

/**
 * Realtime mix topology: builds the graph in an AudioContext.
 */
export function createMixGraph(
  ctx: BaseAudioContext,
  options: { reverbAmount?: number; masterVolume?: number } = {},
): MixGraph {
  const masterIn = ctx.createGain();
  masterIn.gain.value = options.masterVolume ?? 0.72;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.22;
  const masterOut = ctx.createGain();
  masterOut.gain.value = 0.95;
  masterIn.connect(limiter);
  limiter.connect(masterOut);
  masterOut.connect(ctx.destination);
  const convolver = ctx.createConvolver();
  // Impulse is attached by the caller (it needs the reverb generator).
  const reverbReturn = ctx.createGain();
  reverbReturn.gain.value = 1.1;
  convolver.connect(reverbReturn);
  reverbReturn.connect(masterIn);
  const clickBus = ctx.createGain();
  clickBus.gain.value = 1;
  clickBus.connect(masterIn);
  const reverbAmount = options.reverbAmount ?? 0.26;
  const previewBus = createBus(ctx, { masterIn, convolver }, reverbAmount);
  previewBus.trackGain.gain.value = 0.9;
  return { ctx, masterIn, limiter, masterOut, convolver, reverbReturn, clickBus, previewBus };
}

/** Short metronome click. Returns a function that silences it if it has not sounded yet. */
export function scheduleClick(
  ctx: BaseAudioContext,
  destination: AudioNode,
  time: number,
  accent: boolean,
): () => void {
  const start = Math.max(time, ctx.currentTime + 0.001);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = accent ? 'triangle' : 'sine';
  osc.frequency.setValueAtTime(accent ? 1568 : 1174, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(accent ? 0.24 : 0.13, start + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + (accent ? 0.09 : 0.06));
  osc.connect(gain);
  gain.connect(destination);
  osc.start(start);
  osc.stop(start + 0.11);
  return () => osc.stop();
}
