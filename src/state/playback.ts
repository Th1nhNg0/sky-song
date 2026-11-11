import { AudioEngine } from '../audio/engine';
import { Transport, type TransportState } from '../audio/transport';
import { useAppStore } from './store';
import { useAudioStore, useClockStore } from './clock';
import { PlayheadSmoother } from './smoothing';
import type { SampleSelection } from '../audio/sampleBank';
import { createSampleVoice } from '../audio/sampleVoice';
import { getInstrument } from '../music/instruments';
import type { InstrumentDefinition, Project } from '../music/types';

/** Only these fields reach the mixer, so note edits leave the audio graph alone. */
function mixChanged(next: Project, previous: Project): boolean {
  if (next.tracks === previous.tracks) return false;
  if (next.tracks.length !== previous.tracks.length) return true;
  return next.tracks.some((track, index) => {
    const other = previous.tracks[index];
    return (
      track.id !== other.id ||
      track.volume !== other.volume ||
      track.muted !== other.muted ||
      track.solo !== other.solo ||
      track.instrumentId !== other.instrumentId
    );
  });
}

class PlaybackController {
  readonly engine: AudioEngine;
  readonly transport: Transport;
  private rafId: number | null = null;
  private unsubscribe: (() => void) | null = null;
  private audioReady = false;
  private starting: Promise<boolean> | null = null;
  private smoother = new PlayheadSmoother();
  private lastPreview = { key: '', at: 0 };
  /** Counts play requests, so a Pause pressed while sound is still starting can call off the start. */
  private startRequest = 0;
  private startPending = false;

  constructor() {
    this.engine = new AudioEngine();
    const app = useAppStore.getState();
    this.transport = new Transport({
      engine: this.engine,
      getProject: () => useAppStore.getState().project,
      getSettings: () => {
        const preferences = useAppStore.getState().preferences;
        return {
          metronomeEnabled: preferences.metronomeEnabled,
          countInMeasures: preferences.countInMeasures,
          latencyOffsetMs: preferences.latencyOffsetMs,
        };
      },
      onStateChange: (state) => this.handleTransportState(state),
    });
    this.engine.setReverbAmount(app.preferences.reverbAmount);
    this.engine.setMasterVolume(app.preferences.masterVolume);
    this.unsubscribe = useAppStore.subscribe((state, previous) => {
      // Another song was opened: stop the old one and put the cursor back at its start.
      if (state.songLoads !== previous.songLoads) {
        this.cancelPendingStart();
        this.transport.setProject(state.project);
        this.stop();
      }
      if (state.project !== previous.project) {
        this.transport.setProject(state.project);
        if (mixChanged(state.project, previous.project)) this.engine.syncTracks(state.project);
      }
      if (state.preferences.reverbAmount !== previous.preferences.reverbAmount) {
        this.engine.setReverbAmount(state.preferences.reverbAmount);
      }
      if (state.preferences.masterVolume !== previous.preferences.masterVolume) {
        this.engine.setMasterVolume(state.preferences.masterVolume);
      }
      if (
        state.preferences.latencyOffsetMs !== previous.preferences.latencyOffsetMs ||
        state.preferences.metronomeEnabled !== previous.preferences.metronomeEnabled ||
        state.preferences.countInMeasures !== previous.preferences.countInMeasures
      ) {
        this.transport.setProject(state.project);
      }
      if (state.project.loop !== previous.project.loop) {
        useClockStore.getState().setPlayhead(this.transport.positionBeats());
      }
    });
  }

  private handleTransportState(state: TransportState): void {
    useAppStore.getState().setPlaying(state === 'playing');
    useClockStore.getState().setPlayhead(this.transport.positionBeats());
    if (state === 'playing') this.startFrameLoop();
  }

  async ensureAudio(): Promise<boolean> {
    if (this.audioReady && this.engine.ready) return true;
    if (this.starting) return this.starting;
    useAudioStore.getState().setStatus('starting');
    this.starting = (async () => {
      const ok = await this.engine.resume();
      if (!ok || !this.engine.ctx) {
        useAudioStore.getState().setStatus('error', this.engine.lastError ?? 'Audio could not start.');
        useAppStore
          .getState()
          .notify(
            this.engine.lastError ??
              'Audio is locked by the browser. Tap Play or the sound button (a user gesture is required).',
            'warning',
          );
        this.starting = null;
        return false;
      }
      this.audioReady = true;
      const app = useAppStore.getState();
      this.engine.setReverbAmount(app.preferences.reverbAmount);
      this.engine.setMasterVolume(app.preferences.masterVolume);
      this.engine.syncTracks(app.project);
      this.transport.setProject(app.project);
      useAudioStore.getState().setStatus('ready');
      this.starting = null;
      return true;
    })();
    return this.starting;
  }

  private startFrameLoop(): void {
    if (this.rafId !== null || typeof window === 'undefined') return;
    this.smoother.reset();
    const frame = () => {
      const beatsPerSecond = useAppStore.getState().project.bpm / 60;
      const shown = this.smoother.next(this.transport.positionBeats(), performance.now(), beatsPerSecond);
      useClockStore.getState().setPlayhead(shown);
      if (this.transport.currentState === 'playing') {
        this.rafId = window.requestAnimationFrame(frame);
      } else {
        this.rafId = null;
      }
    };
    this.rafId = window.requestAnimationFrame(frame);
  }

  private stopFrameLoop(): void {
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private cancelPendingStart(): void {
    this.startRequest++;
    this.startPending = false;
  }

  async play(): Promise<void> {
    const request = ++this.startRequest;
    this.startPending = true;
    const ok = await this.ensureAudio();
    // The first start waits for the sound packs; a stop, pause or new song meanwhile wins.
    if (request !== this.startRequest) return;
    this.startPending = false;
    if (!ok) return;
    this.engine.syncTracks(useAppStore.getState().project);
    this.transport.play();
    this.startFrameLoop();
  }

  pause(): void {
    this.cancelPendingStart();
    this.transport.pause();
    this.stopFrameLoop();
    useClockStore.getState().setPlayhead(this.transport.positionBeats());
  }

  stop(): void {
    this.cancelPendingStart();
    this.transport.stop();
    this.stopFrameLoop();
    useClockStore.getState().setPlayhead(this.transport.positionBeats());
  }

  async togglePlay(): Promise<void> {
    if (this.transport.currentState === 'playing' || this.startPending) this.pause();
    else await this.play();
  }

  seek(beat: number): void {
    this.transport.seek(beat);
    this.smoother.reset();
    useClockStore.getState().setPlayhead(this.transport.positionBeats());
    if (this.transport.currentState === 'playing') this.startFrameLoop();
  }

  position(): number {
    return this.transport.positionBeats();
  }

  async audition(instrumentId: string): Promise<void> {
    const ok = await this.ensureAudio();
    if (!ok) return;
    this.engine.audition(instrumentId, useAppStore.getState().project.key);
  }

  /** Sounds one pad while editing. Quiet during playback, when the song itself is the feedback. */
  async previewPad(instrumentId: string, pad: number, velocity = 0.8, force = false): Promise<void> {
    const app = useAppStore.getState();
    if (!force && (!app.preferences.notePreview || app.isPlaying)) return;
    const key = `${instrumentId}:${pad}`;
    const at = performance.now();
    if (this.lastPreview.key === key && at - this.lastPreview.at < 70) return;
    this.lastPreview = { key, at };
    if (!(await this.ensureAudio())) return;
    const instrument = getInstrument(instrumentId);
    this.engine.playPad({ instrument, keyIndex: app.project.key, pad, velocity, durationSeconds: 0.45 });
  }

  /** Plays one chosen recording through the preview bus, whichever pack the bank would pick. */
  async previewRecording(
    instrument: InstrumentDefinition,
    pad: number,
    durationSeconds: number,
    selection: SampleSelection,
  ): Promise<void> {
    const ok = await this.ensureAudio();
    const { ctx, graph } = this.engine;
    if (!ok || !ctx || !graph) return;
    const start = ctx.currentTime + 0.02;
    createSampleVoice(
      ctx,
      {
        instrument,
        keyIndex: useAppStore.getState().project.key,
        pad,
        startTime: start,
        durationSeconds,
        velocity: 0.85,
        destination: graph.previewBus.input,
      },
      selection,
      { start, velocity: 0.85 },
    );
  }

  async enableAudio(): Promise<void> {
    const ok = await this.ensureAudio();
    if (ok) useAppStore.getState().notify('Audio ready — Web Audio is running.', 'success');
  }

  get engineInfo() {
    return this.engine.getDebugInfo();
  }

  dispose(): void {
    this.stopFrameLoop();
    this.transport.dispose();
    this.unsubscribe?.();
    this.unsubscribe = null;
    void this.engine.dispose();
  }
}

export const playback = new PlaybackController();
