import { beforeEach, describe, expect, it } from 'vitest';
import { Midi } from '@tonejs/midi';
import { exportProjectToMidi } from '../../src/export/midi';
import { gridSpans } from '../../src/music/grid';
import { midiToProject } from '../../src/music/midiImport';
import { createNote, createProject, projectToJson } from '../../src/music/project';
import { buildSheetFrames } from '../../src/music/sheet';
import { getInstrument } from '../../src/music/instruments';
import { normalizeMeterChanges, normalizeTempoChanges, Timing, timingOf } from '../../src/music/timing';
import { parseProjectJson } from '../../src/music/validation';
import { useAppStore } from '../../src/state/store';
import { makeTransport, songWithBeats, startTimes } from './helpers';

/** 60 BPM for four beats, then 120: beat 4 is at 4 s and every later beat takes half a second. */
const speedsUp = { bpm: 60, timeSignature: [4, 4] as [number, number], tempoChanges: [{ beat: 4, bpm: 120 }] };
/** Two bars of 4/4, then 3/4. */
const turnsToWaltz = { bpm: 60, timeSignature: [4, 4] as [number, number], meterChanges: [{ beat: 8, timeSignature: [3, 4] as [number, number] }] };

describe('Timing', () => {
  it('turns beats into seconds and back through a tempo change', () => {
    const timing = new Timing(speedsUp);
    expect(timing.secondsAt(4)).toBe(4);
    expect(timing.secondsAt(8)).toBe(6);
    expect(timing.secondsBetween(3, 5)).toBe(1.5);
    for (const beat of [0, 2.5, 4, 4.25, 19]) expect(timing.beatAt(timing.secondsAt(beat))).toBeCloseTo(beat, 9);
    expect(timing.bpmAt(3.99)).toBe(60);
    expect(timing.bpmAt(4)).toBe(120);
  });

  it('counts bars through a meter change', () => {
    const timing = new Timing(turnsToWaltz);
    expect(timing.format(7)).toBe('2:4');
    expect(timing.format(8)).toBe('3:1');
    expect(timing.format(11)).toBe('4:1');
    expect(timing.barStart(4)).toBe(14);
    expect(timing.barAt(13.5)).toMatchObject({ bar: 3, start: 11, beat: 2.5 });
    expect(timing.isBarLine(11)).toBe(true);
    expect(timing.isBarLine(12)).toBe(false);
  });

  it('keeps a triplet a hair under the bar line in the right bar', () => {
    expect(new Timing(turnsToWaltz).format(10.999999999999998)).toBe('4:1');
  });

  it('clicks a beat apart from each bar line, even when a bar is not a whole number of beats', () => {
    const timing = new Timing({ bpm: 60, timeSignature: [7, 8] });
    const clicks = [0];
    while (clicks.length < 7) clicks.push(timing.nextClick(clicks[clicks.length - 1] + 0.01));
    expect(clicks).toEqual([0, 1, 2, 3, 3.5, 4.5, 5.5]);
  });

  it('moves a meter change to the nearest bar line and drops changes that change nothing', () => {
    expect(normalizeMeterChanges([4, 4], [{ beat: 9, timeSignature: [3, 4] }, { beat: 14, timeSignature: [3, 4] }])).toEqual([
      { beat: 8, timeSignature: [3, 4] },
    ]);
    expect(normalizeTempoChanges(90, [{ beat: 8, bpm: 90 }, { beat: 4, bpm: 300 }, { beat: 0, bpm: 50 }])).toEqual([
      { beat: 4, bpm: 240 },
      { beat: 8, bpm: 90 },
    ]);
  });

  it('hands back the same timing while only the notes change', () => {
    const project = { ...createProject(), ...speedsUp };
    const retitled = { ...project, title: 'Edited' };
    const faster = { ...project, bpm: 61 };
    expect(timingOf(retitled)).toBe(timingOf(project));
    expect(timingOf(faster)).not.toBe(timingOf(project));
  });

  it('draws one grid stretch per meter and keeps the bar shading alternating', () => {
    const spans = gridSpans(10, new Timing({ ...turnsToWaltz, meterChanges: [{ beat: 4, timeSignature: [3, 4] }] }), 1, 40);
    expect(spans.map((span) => [span.style.left, span.style.width])).toEqual([[0, 40], [40, 360]]);
    expect(spans[1].style.backgroundPosition).toContain('-30px');
  });

  it('numbers sheet bars by the meter each note falls in', () => {
    const frames = buildSheetFrames([createNote(0, 7, 0.5), createNote(0, 11, 0.5)], getInstrument('harp'), new Timing(turnsToWaltz));
    expect(frames.map((frame) => [frame.bar, frame.beat])).toEqual([[1, 3], [3, 0]]);
  });
});

describe('Transport with tempo changes', () => {
  it('plays each note at the time the tempo map gives it', () => {
    const { engine, transport, run } = makeTransport(songWithBeats([0, 2, 4, 5, 6, 8], speedsUp));
    transport.play();
    run(7);
    const lead = engine.voices[0].startTime;
    expect(startTimes(engine).map((time) => Math.round((time - lead) * 100) / 100)).toEqual([0, 2, 4, 4.5, 5, 6]);
    expect(transport.positionBeats()).toBeGreaterThan(8);
  });

  it('gives a note that spans a tempo change the length it really sounds', () => {
    const song = songWithBeats([], speedsUp);
    song.tracks[0].notes = [createNote(0, 3, 2)];
    const { engine, transport, run } = makeTransport(song);
    transport.play();
    run(4);
    expect(engine.voices[0].durationSeconds).toBeCloseTo(1.5, 9);
  });

  it('keeps a loop that holds a tempo change in time over many passes', () => {
    const song = songWithBeats([2, 4, 5], { ...speedsUp, loop: { enabled: true, startBeat: 2, endBeat: 6 } });
    const { engine, transport, run } = makeTransport(song);
    transport.play();
    run(13);
    const lead = engine.voices[0].startTime;
    // One pass is beats 2–4 at 60 (2 s) and 4–6 at 120 (1 s): 3 s in all.
    expect(startTimes(engine).map((time) => Math.round((time - lead) * 100) / 100)).toEqual([
      0, 2, 2.5, 3, 5, 5.5, 6, 8, 8.5, 9, 11, 11.5, 12,
    ]);
    expect(transport.positionBeats()).toBeGreaterThanOrEqual(2);
    expect(transport.positionBeats()).toBeLessThan(6);
  });

  it('seeks into the faster part and carries on at that tempo', () => {
    const { engine, transport, run } = makeTransport(songWithBeats([6, 7, 8], speedsUp));
    transport.seek(6);
    transport.play();
    run(1.5);
    const gaps = engine.voices.slice(1).map((voice, index) => voice.startTime - engine.voices[index].startTime);
    expect(gaps).toHaveLength(2);
    for (const gap of gaps) expect(gap).toBeCloseTo(0.5, 6);
  });

  it('accents the metronome on the bar lines of a changing meter', () => {
    const { engine, transport, run } = makeTransport(songWithBeats([0, 15], turnsToWaltz), { metronomeEnabled: true });
    transport.play();
    run(15);
    const lead = engine.clicks[0].time;
    const accents = engine.clicks.filter((click) => click.accent).map((click) => Math.round(click.time - lead));
    expect(accents).toEqual([0, 4, 8, 11, 14]);
  });

  it('follows a tempo change added while playing without replaying notes', () => {
    const song = songWithBeats([0, 1, 2, 3, 4, 5, 6]);
    const { engine, transport, run, update } = makeTransport(song);
    transport.play();
    run(2.5);
    update({ ...song, tempoChanges: [{ beat: 4, bpm: 120 }] });
    run(3);
    const lead = engine.voices[0].startTime;
    expect(startTimes(engine).map((time) => Math.round((time - lead) * 100) / 100)).toEqual([0, 1, 2, 3, 4, 4.5, 5]);
  });
});

describe('tempo and meter changes in files', () => {
  const song = () => {
    const project = createProject({ title: 'Changes', bpm: 96 });
    project.tracks[0].notes = [createNote(0, 0, 0.5), createNote(3, 9, 0.5), createNote(5, 20, 0.5)];
    project.tempoChanges = [{ beat: 8, bpm: 72 }, { beat: 16.5, bpm: 140 }];
    project.meterChanges = [{ beat: 8, timeSignature: [3, 4] }, { beat: 14, timeSignature: [6, 8] }];
    return project;
  };

  it('writes every change into a MIDI file and reads them back', () => {
    const bytes = exportProjectToMidi(song()).bytes;
    const midi = new Midi(bytes);
    expect(midi.header.tempos.map((tempo) => [tempo.ticks / midi.header.ppq, Math.round(tempo.bpm)])).toEqual([[0, 96], [8, 72], [16.5, 140]]);
    expect(midi.header.timeSignatures.map((meter) => [meter.ticks / midi.header.ppq, meter.timeSignature])).toEqual([
      [0, [4, 4]], [8, [3, 4]], [14, [6, 8]],
    ]);
    const back = midiToProject(bytes, 'Changes');
    expect(back).toMatchObject({ bpm: 96, timeSignature: [4, 4], tempoChanges: song().tempoChanges, meterChanges: song().meterChanges });
  });

  it('keeps the changes of a MIDI file from another program, but not a count-in tempo', () => {
    const midi = new Midi();
    const ppq = midi.header.ppq;
    midi.header.tempos = [{ ticks: 0, bpm: 200 }, { ticks: ppq * 4, bpm: 100 }, { ticks: ppq * 36, bpm: 80 }];
    midi.header.timeSignatures = [{ ticks: 0, timeSignature: [4, 4] }, { ticks: ppq * 36, timeSignature: [3, 4] }];
    midi.header.update();
    const track = midi.addTrack();
    for (let i = 0; i < 64; i++) track.addNote({ midi: 60 + (i % 5) * 2, ticks: ppq * (4 + i), durationTicks: ppq / 2 });
    const project = midiToProject(midi.toArray(), 'Ritardando');
    expect(project.bpm).toBe(100);
    expect(project.tempoChanges).toEqual([{ beat: 36, bpm: 80 }]);
    expect(project.meterChanges).toEqual([{ beat: 36, timeSignature: [3, 4] }]);
  });

  it('keeps one tempo for a file that changes tempo more often than a project can hold', () => {
    const midi = new Midi();
    const ppq = midi.header.ppq;
    midi.header.tempos = Array.from({ length: 600 }, (_, i) => ({ ticks: (ppq * i) / 4, bpm: i % 2 ? 91 : 97 }));
    midi.header.update();
    const track = midi.addTrack();
    for (let i = 0; i < 64; i++) track.addNote({ midi: 60, ticks: ppq * i, durationTicks: ppq / 2 });
    const project = midiToProject(midi.toArray(), 'Rubato');
    expect(project.tempoChanges).toBeUndefined();
    expect([91, 97]).toContain(project.bpm);
  });

  it('saves the changes in a project file and tidies what it reads', () => {
    expect(parseProjectJson(projectToJson(song())).project).toMatchObject({
      tempoChanges: song().tempoChanges,
      meterChanges: song().meterChanges,
    });
    const messy = { ...song(), tempoChanges: [{ beat: 8, bpm: 9000 }, { beat: -1, bpm: 80 }, 'x'], meterChanges: [{ beat: 9, timeSignature: [3, 4] }, { beat: 12, timeSignature: [9, 16] }] };
    const { project, warnings } = parseProjectJson(JSON.stringify(messy));
    expect(project.tempoChanges).toBeUndefined();
    expect(project.meterChanges).toEqual([{ beat: 8, timeSignature: [3, 4] }]);
    expect(warnings.map((warning) => warning.path)).toEqual(expect.arrayContaining(['$.tempoChanges', '$.meterChanges']));
    expect(parseProjectJson(projectToJson(createProject())).project).not.toHaveProperty('tempoChanges');
  });
});

describe('editing tempo and meter changes', () => {
  const store = () => useAppStore.getState();
  beforeEach(() => store().setProject(createProject({ bpm: 90 })));

  it('adds, edits and removes a change, each as one undo step', () => {
    store().setTimingChange(8, { bpm: 120, timeSignature: [3, 4] });
    expect(store().project).toMatchObject({ tempoChanges: [{ beat: 8, bpm: 120 }], meterChanges: [{ beat: 8, timeSignature: [3, 4] }] });
    store().setTimingChange(8, { bpm: 100 });
    expect(store().project.tempoChanges).toEqual([{ beat: 8, bpm: 100 }]);
    store().undo();
    expect(store().project.tempoChanges).toEqual([{ beat: 8, bpm: 120 }]);
    store().removeTimingChange(8);
    expect(store().project).not.toHaveProperty('tempoChanges');
    expect(store().project).not.toHaveProperty('meterChanges');
  });

  it('puts a meter change on the bar line and ignores a change that changes nothing', () => {
    store().setTimingChange(6, { timeSignature: [3, 4] });
    expect(store().project.meterChanges).toEqual([{ beat: 4, timeSignature: [3, 4] }]);
    const before = store().project;
    store().setTimingChange(16, { bpm: 90 });
    expect(store().project).toBe(before);
  });

  it('keeps later meter changes on bar lines when the opening meter changes', () => {
    store().setTimingChange(8, { timeSignature: [3, 4] });
    store().setMeter([5, 4]);
    expect(store().project.meterChanges).toEqual([{ beat: 10, timeSignature: [3, 4] }]);
  });

  it('treats a change at the start as the song’s own tempo and meter', () => {
    store().setTimingChange(0, { bpm: 132, timeSignature: [6, 8] });
    expect(store().project).toMatchObject({ bpm: 132, timeSignature: [6, 8] });
    expect(store().project).not.toHaveProperty('tempoChanges');
  });
});
