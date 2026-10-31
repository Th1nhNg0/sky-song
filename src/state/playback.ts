import { AudioEngine } from '../audio/engine';
import { Transport, type TransportState } from '../audio/transport';
import { useAppStore } from './store';
import { useAudioStore, useClockStore } from './clock';

class PlaybackController {
  readonly engine: AudioEngine;
  readonly transport: Transport;
  private rafId: number | null = null;
  private unsubscribe: (() => void) | null = null;
  private audioReady = false;
  private starting: Promise<boolean> | null = null;

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
      if (state.project !== previous.project) {
        this.transport.setProject(state.project);
        this.engine.syncTracks(state.project);
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
    const frame = () => {
      useClockStore.getState().setPlayhead(this.transport.positionBeats());
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

  async play(): Promise<void> {
    const ok = await this.ensureAudio();
    if (!ok) return;
    this.engine.syncTracks(useAppStore.getState().project);
    this.transport.play();
    this.startFrameLoop();
  }

  pause(): void {
    this.transport.pause();
    this.stopFrameLoop();
    useClockStore.getState().setPlayhead(this.transport.positionBeats());
  }

  stop(): void {
    this.transport.stop();
    this.stopFrameLoop();
    useClockStore.getState().setPlayhead(this.transport.positionBeats());
  }

  async togglePlay(): Promise<void> {
    if (this.transport.currentState === 'playing') this.pause();
    else await this.play();
  }

  seek(beat: number): void {
    this.transport.seek(beat);
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
