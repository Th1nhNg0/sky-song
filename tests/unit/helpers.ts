import { Transport, type TransportSettings } from '../../src/audio/transport';
import type { PlaybackEngine, ScheduledVoiceSpec } from '../../src/audio/engine';
import { createNote, createProject } from '../../src/music/project';
import type { Project } from '../../src/music/types';

export class FakeEngine implements PlaybackEngine {
  time = 0;
  voices: ScheduledVoiceSpec[] = [];
  clicks: { time: number; accent: boolean }[] = [];
  stops = 0;
  now() {
    return this.time;
  }
  scheduleVoice(spec: ScheduledVoiceSpec) {
    this.voices.push(spec);
  }
  scheduleClick(time: number, accent: boolean) {
    this.clicks.push({ time, accent });
  }
  stopAll() {
    this.stops++;
    this.clicks = this.clicks.filter((click) => click.time <= this.time);
  }
  cancelPending(afterTime: number) {
    this.voices = this.voices.filter((voice) => voice.startTime <= afterTime);
    this.clicks = this.clicks.filter((click) => click.time <= afterTime);
  }
}

/** A one-track song at 60 BPM (1 beat = 1 second) with a note on each listed beat. */
export function songWithBeats(beats: number[], patch: Partial<Project> = {}): Project {
  const project = createProject({ bpm: 60 });
  project.tracks[0].notes = beats.map((beat) => createNote(0, beat, 0.5));
  return { ...project, ...patch };
}

export function makeTransport(project: Project, settings: Partial<TransportSettings> = {}) {
  const engine = new FakeEngine();
  let current = project;
  const transport = new Transport({
    engine,
    getProject: () => current,
    getSettings: () => ({ metronomeEnabled: false, countInMeasures: 0, latencyOffsetMs: 0, ...settings }),
    manualTick: true,
  });
  /** Advances the fake audio clock in 25 ms ticks, the way the real timer does. */
  const run = (seconds: number) => {
    const end = engine.time + seconds;
    while (engine.time < end) {
      engine.time += 0.025;
      transport.tick();
    }
  };
  const update = (next: Project) => {
    current = next;
    transport.setProject(next);
  };
  return { engine, transport, run, update };
}

export const startTimes = (engine: FakeEngine) =>
  engine.voices.map((voice) => Math.round(voice.startTime * 100) / 100);
