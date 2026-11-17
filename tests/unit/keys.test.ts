import { beforeEach, describe, expect, it } from 'vitest';
import { exportProjectToMidi } from '../../src/export/midi';
import { getInstrument } from '../../src/music/instruments';
import { midiToProject } from '../../src/music/midiImport';
import { resolvePad } from '../../src/music/pitch';
import { createNote, createProject, createTrack, projectToJson, trackKey, transposeProject } from '../../src/music/project';
import type { Project, Track } from '../../src/music/types';
import { parseProjectJson } from '../../src/music/validation';
import { useAppStore } from '../../src/state/store';

const store = () => useAppStore.getState();
const sounding = (project: Project, track: Track) =>
  track.notes.map((note) => resolvePad(getInstrument(track.instrumentId), trackKey(project, track), note.pad).midi);

/** A piano in the song's key with a layer for its sharps and flats, as a MIDI import makes them. */
function layered(key: number, layerKey: number): Project {
  const project = createProject({ title: 'Layered', key });
  const main = project.tracks[0];
  main.instrumentId = 'piano';
  main.name = 'Piano · Melody';
  main.notes = [createNote(0, 0, 1), createNote(4, 1, 1)];
  const layer = createTrack('piano', { name: 'Piano · Melody · in B' });
  layer.key = layerKey;
  layer.notes = [createNote(3, 2, 1), createNote(10, 3, 1)];
  project.tracks.push(layer);
  return project;
}

beforeEach(() => {
  store().setProject(createProject({ title: 'Test' }));
});

describe('song and track keys', () => {
  it('opens a song in its own key', () => {
    store().setProject(createProject({ title: 'In D', key: 2 }));
    expect(store().project.key).toBe(2);
  });

  it('moves every track with the song, a layer included', () => {
    const before = layered(0, 11);
    before.tracks[1].notes = [createNote(3, 2, 1), createNote(5, 3, 1)];
    const after = transposeProject(before, 2);
    expect(after.key).toBe(2);
    expect(after.tracks[1].key).toBe(1);
    const move = (index: number) =>
      sounding(after, after.tracks[index]).map((pitch, note) => pitch! - sounding(before, before.tracks[index])[note]!);
    expect(move(0)).toEqual([2, 2]);
    // B to C sharp wraps past C, ten semitones down: the notes go up an octave on the pads, so the layer rises by 2 too.
    expect(after.tracks[1].notes.map((note) => note.pad)).toEqual([10, 12]);
    expect(move(1)).toEqual([2, 2]);
  });

  it('keeps a layer an octave off rather than lose notes when its pads cannot move', () => {
    const before = layered(0, 11);
    before.tracks[1].notes = [createNote(0, 2, 1), createNote(14, 3, 1)];
    const after = transposeProject(before, 2);
    expect(after.tracks[1].notes.map((note) => note.pad)).toEqual([0, 14]);
    expect(after.tracks[1].key).toBe(1);
  });

  it('sets and clears a track key through the store, with undo', () => {
    store().setProject(createProject({ title: 'Keys', key: 4 }));
    const id = store().activeTrack().id;
    store().setTrackKey(id, 9);
    expect(store().activeTrack().key).toBe(9);
    store().setTrackKey(id, 4);
    expect(store().activeTrack().key).toBeUndefined();
    store().undo();
    expect(store().activeTrack().key).toBe(9);
    store().setKey(7);
    expect(store().project.key).toBe(7);
    expect(store().activeTrack().key).toBe(0);
  });

  it('gives a drum no key', () => {
    const project = createProject({ title: 'Drums' });
    project.tracks[0] = createTrack('drum', { name: 'Drum' });
    store().setProject(project);
    store().setTrackKey(store().activeTrack().id, 3);
    expect(store().activeTrack().key).toBeUndefined();
  });

  it('drops a track key when the instrument changes to a drum', () => {
    store().setProject(layered(0, 11));
    const layerId = store().project.tracks[1].id;
    store().setTrackInstrument(layerId, 'drum');
    expect(store().project.tracks[1].key).toBeUndefined();
    store().setTrackInstrument(store().project.tracks[0].id, 'harp');
    expect(store().project.tracks[0].instrumentId).toBe('harp');
  });

  it('reads a track key from a song file, and only a real one', () => {
    const project = layered(5, 4);
    const raw = JSON.parse(projectToJson(project));
    raw.tracks.push({ ...raw.tracks[0], id: 'same', key: 5 }, { ...raw.tracks[0], id: 'bad', key: 12 });
    const drum = { ...raw.tracks[0], id: 'drum', instrumentId: 'drum', key: 2, notes: [] };
    raw.tracks.push(drum);
    const { project: read, warnings } = parseProjectJson(JSON.stringify(raw));
    expect(read.key).toBe(5);
    expect(read.tracks.map((track) => track.key)).toEqual([undefined, 4, undefined, undefined, undefined]);
    expect(warnings.filter((warning) => warning.path.endsWith('.key'))).toHaveLength(2);
  });

  it('round-trips a layer through MIDI, key and pitch', () => {
    const project = layered(9, 8);
    const bytes = exportProjectToMidi(project).bytes;
    const back = midiToProject(bytes, 'Layered');
    expect(back.key).toBe(9);
    expect(back.tracks.map((track) => track.key)).toEqual([undefined, 8]);
    expect(back.tracks.map((track) => track.notes.map((note) => note.pad))).toEqual(project.tracks.map((track) => track.notes.map((note) => note.pad)));
    expect(sounding(back, back.tracks[1])).toEqual(sounding(project, project.tracks[1]));
  });
});
