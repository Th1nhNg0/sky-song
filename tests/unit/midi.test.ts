import { describe, expect, it } from 'vitest';
import { Midi } from '@tonejs/midi';
import { exportProjectToMidi } from '../../src/export/midi';
import { midiToProject } from '../../src/music/midiImport';
import { createNote, createProject, createTrack } from '../../src/music/project';
import { parseProjectJson } from '../../src/music/validation';

describe('MIDI import/export', () => {
  it('round-trips instruments, pads, timing and track identity', () => {
    const project = createProject({ title: 'Round trip', bpm: 132 });
    project.timeSignature = [3, 4];
    const harpA = project.tracks[0];
    harpA.name = 'Lead harp';
    harpA.notes = [createNote(0, 0, 0.5), createNote(7, 0, 0.5), createNote(14, 1.125, 0.5)];
    const harpB = createTrack('harp', { name: 'Second harp' });
    harpB.notes = [createNote(3, 2, 0.5)];
    const cello = createTrack('cello', { name: 'Cello line' });
    cello.notes = [createNote(2, 0, 3.5)];
    const bass = createTrack('contrabass', { name: 'Bass' });
    bass.notes = [createNote(1, 1, 2)];
    const drum = createTrack('drum', { name: 'Drums' });
    drum.notes = [createNote(0, 0, 0.25), createNote(2, 1, 0.25), createNote(6, 1.5, 0.25)];
    project.tracks = [harpA, harpB, cello, bass, drum];

    const back = midiToProject(exportProjectToMidi(project).bytes, 'Round trip');
    expect(back.bpm).toBe(132);
    expect(back.timeSignature).toEqual([3, 4]);
    expect(back.tracks.map((track) => track.instrumentId)).toEqual(project.tracks.map((track) => track.instrumentId));
    expect(back.tracks.map((track) => track.name)).toEqual(project.tracks.map((track) => track.name));
    project.tracks.forEach((track, index) => {
      const shape = (notes: typeof track.notes) =>
        notes.map((note) => [note.pad, note.startBeat, note.durationBeats]).sort();
      expect(shape(back.tracks[index].notes)).toEqual(shape(track.notes));
    });
  });

  it('produces a project that survives save and reload for slow and huge files', () => {
    const midi = new Midi();
    midi.header.setTempo(30);
    const track = midi.addTrack();
    for (let i = 0; i < 4500; i++) track.addNote({ midi: 60 + (i % 12), ticks: i * 120, durationTicks: 100 });
    const project = midiToProject(midi.toArray(), 'Long and slow');
    expect(() => parseProjectJson(JSON.stringify(project))).not.toThrow();
  });

  it('keeps swung timing instead of flattening it to sixteenths', () => {
    const midi = new Midi();
    const track = midi.addTrack();
    const ppq = midi.header.ppq;
    for (let i = 0; i < 8; i++) {
      track.addNote({ midi: 60, ticks: i * ppq, durationTicks: ppq / 3 });
      track.addNote({ midi: 62, ticks: i * ppq + Math.round((ppq * 2) / 3), durationTicks: ppq / 3 });
    }
    const starts = midiToProject(midi.toArray(), 'Swing').tracks[0].notes.map((note) => note.startBeat);
    expect(starts[1]).toBeCloseTo(2 / 3);
  });

  it('trusts a part name over a mismatched patch', () => {
    const midi = new Midi();
    const track = midi.addTrack();
    track.name = 'Alto Sax 1';
    track.instrument.number = 48;
    track.addNote({ midi: 60, ticks: 0, durationTicks: 100 });
    expect(midiToProject(midi.toArray(), 'Names').tracks[0].instrumentId).toBe('saxophone');
  });

  it('moves parts past the limit onto the nearest part and keeps drums alongside', () => {
    const midi = new Midi();
    [0, 24, 33, 40, 42, 60, 73].forEach((program, index) => {
      const track = midi.addTrack();
      track.instrument.number = program;
      for (let i = 0; i < 20 - index; i++) track.addNote({ midi: 48 + index * 3, ticks: i * 960 + index * 120, durationTicks: 100 });
    });
    const drums = midi.addTrack();
    drums.channel = 9;
    drums.addNote({ midi: 36, ticks: 0, durationTicks: 100 });
    const project = midiToProject(midi.toArray(), 'Crowded');
    expect(project.tracks).toHaveLength(7);
    expect(project.tracks.at(-1)?.instrumentId).toBe('drum');
    expect(project.tracks.flatMap((track) => track.notes).length).toBeGreaterThan(100);
  });

  it('drops chord tones the pads cannot play but keeps a lone one', () => {
    const midi = new Midi();
    const track = midi.addTrack();
    [60, 64, 67, 70].forEach((pitch) => track.addNote({ midi: pitch, ticks: 0, durationTicks: 100 }));
    const scale = [60, 62, 64, 65, 67, 69, 71];
    for (let i = 1; i <= 21; i++) track.addNote({ midi: i === 8 ? 61 : scale[i % 7], ticks: i * 480, durationTicks: 400 });
    const notes = midiToProject(midi.toArray(), 'Chromatic').tracks.flatMap((part) => part.notes);
    expect(notes.filter((note) => note.startBeat === 0)).toHaveLength(3);
    expect(notes.some((note) => note.startBeat === 8)).toBe(true);
  });

  it('hands notes out of reach to an instrument that plays their real pitch', () => {
    const midi = new Midi();
    const flute = midi.addTrack();
    flute.instrument.number = 73;
    const scale = [0, 2, 4, 5, 7, 9, 11];
    // Most of the line fits the flute's two octaves; its top doesn't, in any octave.
    for (let i = 0; i < 42; i++) flute.addNote({ midi: 60 + scale[i % 7] + 12 * (i % 2), ticks: i * 240, durationTicks: 200 });
    for (let i = 0; i < 14; i++) flute.addNote({ midi: 84 + 2 + scale[i % 7], ticks: 10080 + i * 240, durationTicks: 200 });
    const project = midiToProject(midi.toArray(), 'Wide');
    const high = project.tracks.find((track) => track.instrumentId === 'xylophone');
    expect(high?.notes.length).toBeGreaterThanOrEqual(12);
    expect(project.tracks[0].notes.length).toBeGreaterThan(30);
  });

  it('caps what the band starts together but keeps the top and bottom notes', () => {
    const midi = new Midi();
    [0, 24, 33, 40, 42, 60].forEach((program, index) => {
      const track = midi.addTrack();
      track.instrument.number = program;
      const pitches = [[72, 76], [55, 59], [36, 40], [64, 67], [48, 52], [45, 50]][index];
      for (const pitch of pitches) track.addNote({ midi: pitch, ticks: 0, durationTicks: 400 });
    });
    const notes = midiToProject(midi.toArray(), 'Tutti').tracks.flatMap((track) => track.notes);
    expect(notes).toHaveLength(6);
  });

  it('takes the tempo most of the song is in, not a count-in', () => {
    const midi = new Midi();
    const ppq = midi.header.ppq;
    midi.header.tempos = [
      { ticks: 0, bpm: 240 },
      { ticks: ppq * 4, bpm: 114 },
    ];
    const track = midi.addTrack();
    for (let i = 0; i < 64; i++) track.addNote({ midi: 60, ticks: ppq * (4 + i), durationTicks: ppq / 2 });
    expect(midiToProject(midi.toArray(), 'Count-in').bpm).toBe(114);
  });

  it('finds the real tempo of a file recorded at a nominal 120', () => {
    const midi = new Midi();
    midi.header.setTempo(120);
    const ppq = midi.header.ppq;
    const track = midi.addTrack();
    // Eighth notes at 90 BPM, written into a file that claims 120, starting off the beat.
    const eighth = (0.5 * 120) / 90;
    for (let i = 0; i < 120; i++) {
      track.addNote({ midi: 60 + (i % 5) * 2, ticks: Math.round((0.37 + i * eighth) * ppq), durationTicks: Math.round(eighth * 0.8 * ppq) });
    }
    const project = midiToProject(midi.toArray(), 'Free running');
    expect(project.bpm).toBe(90);
    const starts = project.tracks[0].notes.map((note) => note.startBeat);
    expect(starts[0] % 0.5).toBe(0);
    expect(starts[10] - starts[0]).toBeCloseTo(5);
    // The song still lasts as long as it did.
    expect((starts[119] - starts[0]) * (60 / 90)).toBeCloseTo((119 * eighth * 60) / 120, 1);
  });

  it('keeps the tempo of a file that is only shifted off the grid', () => {
    const midi = new Midi();
    midi.header.setTempo(168);
    const track = midi.addTrack();
    for (let i = 0; i < 120; i++) track.addNote({ midi: 60, ticks: 77 + i * 240, durationTicks: 200 });
    const project = midiToProject(midi.toArray(), 'Shifted');
    expect(project.bpm).toBe(168);
    expect(project.tracks[0].notes[0].startBeat % 0.5).toBe(0);
  });

  it('leaves a file that is already on the grid alone', () => {
    const midi = new Midi();
    midi.header.setTempo(100);
    const track = midi.addTrack();
    for (let i = 0; i < 120; i++) track.addNote({ midi: 60, ticks: i * 240, durationTicks: 200 });
    const project = midiToProject(midi.toArray(), 'Sequenced');
    expect(project.bpm).toBe(100);
    expect(project.tracks[0].notes[4].startBeat).toBe(2);
  });

  it('lifts a quiet file without changing its balance', () => {
    const midi = new Midi();
    const track = midi.addTrack();
    for (let i = 0; i < 12; i++) track.addNote({ midi: 60, ticks: i * 480, durationTicks: 400, velocity: i % 2 ? 0.3 : 0.15 });
    const velocities = midiToProject(midi.toArray(), 'Quiet').tracks[0].notes.map((note) => note.velocity);
    expect(Math.max(...velocities)).toBeCloseTo(0.9);
    expect(Math.min(...velocities)).toBeCloseTo(0.45);
  });
});
