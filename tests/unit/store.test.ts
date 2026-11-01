import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../src/state/store';
import { createNote, createProject } from '../../src/music/project';
import { snapBeat } from '../../src/music/time';

const store = () => useAppStore.getState();
const notes = () => store().activeTrack().notes;

beforeEach(() => {
  const project = createProject({ title: 'Test' });
  project.tracks[0].notes = [createNote(2, 0, 0.5), createNote(5, 1, 0.5), createNote(9, 2, 0.5)];
  store().setProject(project);
  store().setPreferences({ snap: 0.5 });
});

describe('editing', () => {
  it('undoes and redoes a whole drag as one step', () => {
    const [first] = notes();
    const before = store().project;
    store().selectNotes([first.id]);
    store().beginGesture();
    store().dragSelectedNotes({ [first.id]: { startBeat: 0, pad: 2 } }, 1, 1);
    store().dragSelectedNotes({ [first.id]: { startBeat: 0, pad: 2 } }, 2, 3);
    store().endGesture();
    expect(store().history.past).toHaveLength(1);
    store().undo();
    expect(store().project).toBe(before);
    store().redo();
    expect(notes().find((note) => note.id === first.id)).toMatchObject({ startBeat: 2, pad: 5 });
  });

  it('adds no history entry for a click that moves nothing', () => {
    store().beginGesture();
    store().endGesture();
    expect(store().history.past).toHaveLength(0);
  });

  it('keeps a chord intact when it is dragged against the edge of the instrument', () => {
    const [a, , c] = notes();
    const originals = { [a.id]: { startBeat: 0, pad: 2 }, [c.id]: { startBeat: 2, pad: 9 } };
    store().dragSelectedNotes(originals, 0, 40);
    const pads = notes().filter((note) => originals[note.id]).map((note) => note.pad).sort((x, y) => x - y);
    expect(pads).toEqual([7, 14]);
  });

  it('keeps untouched tracks and notes by reference so edits and undo stay cheap', () => {
    store().addTrack('flute');
    const other = store().project.tracks[1];
    store().setActiveTrack(store().project.tracks[0].id);
    const untouched = notes()[1];
    store().selectNotes([notes()[0].id]);
    store().nudgeSelection(0.5, 0);
    expect(store().project.tracks[1]).toBe(other);
    expect(notes().find((note) => note.id === untouched.id)).toBe(untouched);
  });

  it('copies, pastes and returns the beat after the pasted phrase', () => {
    store().selectNotes(notes().map((note) => note.id));
    store().copySelection();
    expect(store().pasteClipboard(8)).toBe(10.5);
    expect(notes()).toHaveLength(6);
    expect(notes().map((note) => note.startBeat)).toEqual([0, 1, 2, 8, 9, 10]);
  });

  it('places a duplicate straight after the selected phrase', () => {
    store().selectNotes(notes().map((note) => note.id));
    store().duplicateSelection();
    expect(notes().slice(3).map((note) => note.startBeat)).toEqual([2.5, 3.5, 4.5]);
  });

  it('keeps one-shot durations when quantizing but restores exact timing', () => {
    const project = createProject();
    project.tracks[0].notes = [createNote(0, 1.13, 0.7)];
    store().setProject(project);
    store().quantizeSelection(0.25, true);
    expect(notes()[0]).toMatchObject({ startBeat: 1.25, durationBeats: 0.7 });
    store().restoreOriginalTiming();
    expect(notes()[0]).toMatchObject({ startBeat: 1.13, durationBeats: 0.7 });
    expect(notes()[0].original).toBeUndefined();
  });

  it('refuses to resize a one-shot instrument', () => {
    const [note] = notes();
    store().resizeNote(note.id, 4);
    expect(notes()[0].durationBeats).toBe(0.5);
  });

  it('keeps the surviving selection through undo', () => {
    const [a, b] = notes();
    store().selectNotes([a.id, b.id]);
    store().nudgeSelection(0, 1);
    store().undo();
    expect(store().selectedNoteIds).toEqual([a.id, b.id]);
  });

  it('snaps to triplets without drifting', () => {
    expect(snapBeat(0.34, 1 / 3)).toBeCloseTo(1 / 3, 10);
  });
});
