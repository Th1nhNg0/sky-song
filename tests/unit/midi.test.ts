import { describe, expect, it } from 'vitest';
import { Midi } from '@tonejs/midi';
import { exportProjectToMidi } from '../../src/audio/midi';
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
});
