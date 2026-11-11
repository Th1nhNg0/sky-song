import { describe, expect, it } from 'vitest';
import { makeTransport, songWithBeats, startTimes } from './helpers';

describe('Transport', () => {
  it('plays every note of the first pass through a loop that does not start at beat 0', () => {
    const song = songWithBeats([8, 9, 10, 11], { loop: { enabled: true, startBeat: 8, endBeat: 12 } });
    const { engine, transport, run } = makeTransport(song);
    transport.play();
    run(8.5);
    const lead = engine.voices[0].startTime;
    expect(startTimes(engine).map((time) => Math.round((time - lead) * 100) / 100)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('keeps a loop in time over many passes', () => {
    const song = songWithBeats([2, 3], { loop: { enabled: true, startBeat: 2, endBeat: 4 } });
    const { engine, transport, run } = makeTransport(song);
    transport.play();
    run(20);
    const gaps = engine.voices.slice(1).map((voice, index) => voice.startTime - engine.voices[index].startTime);
    expect(gaps.length).toBeGreaterThan(18);
    for (const gap of gaps) expect(gap).toBeCloseTo(1, 6);
  });

  it('starts from the cursor after seeking while stopped', () => {
    const { engine, transport, run } = makeTransport(songWithBeats([0, 4, 5]));
    transport.seek(4);
    transport.play();
    run(0.3);
    expect(engine.voices).toHaveLength(1);
    expect(transport.positionBeats()).toBeGreaterThanOrEqual(4);
  });

  it('lets the cursor sit past the last note', () => {
    const { transport } = makeTransport(songWithBeats([0]));
    transport.seek(40);
    expect(transport.positionBeats()).toBe(40);
  });

  it('does not derail a count-in when resuming after a long pause', () => {
    const { engine, transport, run } = makeTransport(songWithBeats([4, 5]), { countInMeasures: 1 });
    transport.play();
    run(0.2);
    transport.pause();
    run(10);
    transport.seek(4);
    transport.play();
    run(0.2);
    expect(transport.inCountIn()).toBe(true);
    expect(engine.stops).toBe(1);
  });

  it('does not sound a note added just behind the playhead', () => {
    const song = songWithBeats([0, 8]);
    const { engine, transport, run, update } = makeTransport(song);
    transport.play();
    run(3);
    const track = song.tracks[0];
    const added = { ...track.notes[0], id: 'late', startBeat: 2.5 };
    update({ ...song, tracks: [{ ...track, notes: [track.notes[0], added, track.notes[1]] }] });
    run(0.5);
    expect(engine.voices).toHaveLength(1);
  });

  it('changes tempo without stopping ringing voices or losing position', () => {
    const song = songWithBeats([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const { engine, transport, run, update } = makeTransport(song);
    transport.play();
    run(4);
    const before = transport.positionBeats();
    update({ ...song, bpm: 120 });
    expect(engine.stops).toBe(0);
    expect(Math.abs(transport.positionBeats() - before)).toBeLessThan(0.02);
    const count = engine.voices.length;
    run(1.5);
    const fresh = engine.voices.slice(count).map((voice) => voice.startTime);
    for (let i = 1; i < fresh.length; i++) expect(fresh[i] - fresh[i - 1]).toBeCloseTo(0.5, 6);
    expect(new Set(engine.voices.map((voice) => voice.seed)).size).toBe(engine.voices.length);
  });

  it('never bunches overdue notes together after the main thread stalls', () => {
    const song = songWithBeats(Array.from({ length: 20 }, (_, index) => index / 4));
    const { engine, transport, run } = makeTransport(song);
    transport.play();
    run(1);
    const count = engine.voices.length;
    engine.time += 1.5; // A long task blocks every tick for 1.5 seconds.
    run(0.05);
    const late = engine.voices.slice(count);
    const stallEnded = engine.time - 0.05;
    expect(late.length).toBeGreaterThan(0);
    for (const voice of late) expect(voice.startTime).toBeGreaterThan(stallEnded - 0.08);
    expect(transport.getScheduledDiagnostics().droppedLate).toBeGreaterThan(3);
  });

  describe('edits to the song', () => {
    const withNote = (song: ReturnType<typeof songWithBeats>, id: string, startBeat: number) => {
      const track = song.tracks[0];
      const notes = [...track.notes, { ...track.notes[0], id, startBeat }].sort((a, b) => a.startBeat - b.startBeat);
      return { ...song, tracks: [{ ...track, notes }] };
    };
    const seeds = (engine: { voices: { seed: string }[] }, id: string) =>
      engine.voices.filter((voice) => voice.seed.endsWith(`:${id}`)).length;

    it('plays a note added while stopped', () => {
      const song = songWithBeats([0]);
      const { engine, transport, run, update } = makeTransport(song);
      update(withNote(song, 'added', 2));
      expect(transport.getScheduledDiagnostics().events).toBe(2);
      transport.play();
      run(3);
      expect(startTimes(engine).map((time) => Math.round(time - engine.voices[0].startTime))).toEqual([0, 2]);
    });

    it('plays a note added ahead of the playhead once, without replaying the others', () => {
      const song = songWithBeats([0, 1, 5]);
      const { engine, transport, run, update } = makeTransport(song);
      transport.play();
      run(2);
      expect(engine.voices).toHaveLength(2);
      update(withNote(song, 'added', 3));
      run(4);
      expect(engine.voices).toHaveLength(4);
      expect(seeds(engine, 'added')).toBe(1);
      expect(new Set(engine.voices.map((voice) => voice.seed)).size).toBe(4);
      expect(engine.stops).toBe(0);
    });

    it('treats several edits between two ticks like one', () => {
      const song = songWithBeats([0, 6]);
      const { engine, transport, run, update } = makeTransport(song);
      transport.play();
      run(1);
      const once = withNote(song, 'first', 2);
      update(once);
      update(withNote(once, 'second', 3));
      run(3);
      expect(seeds(engine, 'first')).toBe(1);
      expect(seeds(engine, 'second')).toBe(1);
      expect(engine.voices).toHaveLength(3);
    });

    it('plays on past the old end when a note is added after it', () => {
      const song = songWithBeats([0, 1]);
      const { engine, transport, run, update } = makeTransport(song);
      transport.play();
      run(1);
      update(withNote(song, 'later', 6));
      run(5.5);
      expect(transport.currentState).toBe('playing');
      run(3);
      expect(seeds(engine, 'later')).toBe(1);
      expect(transport.currentState).toBe('paused');
      expect(transport.positionBeats()).toBe(7);
    });

    it('stops at the new end when the last note is removed', () => {
      const song = songWithBeats([0, 8]);
      const { engine, transport, run, update } = makeTransport(song);
      transport.play();
      run(1);
      update({ ...song, tracks: [{ ...song.tracks[0], notes: [song.tracks[0].notes[0]] }] });
      run(5);
      expect(transport.currentState).toBe('paused');
      expect(transport.positionBeats()).toBe(4);
      expect(engine.voices).toHaveLength(1);
    });

    it('jumps into a loop switched on during playback', () => {
      const song = songWithBeats([0, 1, 2, 3, 4, 5, 6, 7]);
      const { engine, transport, run, update } = makeTransport(song);
      transport.play();
      run(1);
      update({ ...song, loop: { enabled: true, startBeat: 4, endBeat: 6 } });
      expect(engine.stops).toBe(1);
      expect(transport.positionBeats()).toBe(4);
      const count = engine.voices.length;
      run(4.2);
      const looped = engine.voices.slice(count).map((voice) => voice.seed);
      expect(looped).toHaveLength(4);
      expect(new Set(looped).size).toBe(2);
    });

    it('keeps an edit and a tempo change made together', () => {
      const song = songWithBeats([0, 1, 6]);
      const { engine, transport, run, update } = makeTransport(song);
      transport.play();
      run(2);
      const before = transport.positionBeats();
      const edited = withNote(song, 'added', 4);
      update(edited);
      update({ ...edited, bpm: 120 });
      expect(Math.abs(transport.positionBeats() - before)).toBeLessThan(0.02);
      run(3);
      expect(seeds(engine, 'added')).toBe(1);
      expect(new Set(engine.voices.map((voice) => voice.seed)).size).toBe(engine.voices.length);
      expect(engine.voices).toHaveLength(4);
    });

    it('applies a new latency setting to the position straight away', () => {
      const song = songWithBeats([0, 1, 2, 3, 4]);
      const settings = { metronomeEnabled: false, countInMeasures: 0, latencyOffsetMs: 0 };
      const { transport, run, update } = makeTransport(song, settings);
      transport.play();
      run(2);
      const before = transport.positionBeats();
      settings.latencyOffsetMs = 250;
      update(song);
      expect(transport.positionBeats()).toBeCloseTo(before - 0.25, 6);
    });
  });
});
