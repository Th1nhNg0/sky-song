import { describe, expect, it } from 'vitest';
import { countInBeats, projectToSkyModSong, skyModFilename } from '../../src/export/skymod';
import { createNote, createProject, createTrack } from '../../src/music/project';

describe('sky-mod export', () => {
  it('puts every track on one clock after the count-in', () => {
    const project = createProject({ title: 'Layers', bpm: 120 });
    project.tracks[0].notes = [createNote(7, 1, 0.5), createNote(0, 0, 0.5), createNote(3, 0, 0.5)];
    const cello = createTrack('cello', { name: 'Cello' });
    cello.notes = [createNote(14, 0.5, 2)];
    project.tracks.push(cello);

    const song = projectToSkyModSong(project);

    expect(song.format).toBe('sky-mod-song');
    expect(song.countIn).toEqual({ beats: 4, beatMs: 500 });
    expect(song.tracks[0].songNotes).toEqual([
      { time: 2000, key: 'Key0' },
      { time: 2000, key: 'Key3' },
      { time: 2500, key: 'Key7' },
    ]);
    expect(song.tracks[1].songNotes).toEqual([{ time: 2250, key: 'Key14' }]);
    expect(song.tracks[1].name).toBe('Cello');
    expect(song.durationMs).toBe(3250);
  });

  it('leaves out tracks with no notes', () => {
    const project = createProject({ title: 'Empty', bpm: 120 });
    project.tracks.push(createTrack('cello'));
    project.tracks[0].notes = [createNote(0, 0, 1)];
    expect(projectToSkyModSong(project).tracks).toHaveLength(1);
  });

  it('counts in at least four whole beats', () => {
    expect(countInBeats([4, 4])).toBe(4);
    expect(countInBeats([3, 4])).toBe(6);
    expect(countInBeats([2, 4])).toBe(4);
    expect(countInBeats([6, 8])).toBe(6);
    expect(countInBeats([7, 8])).toBe(4);
    expect(countInBeats([5, 4])).toBe(5);
  });

  it('keeps the file name plain ASCII', () => {
    expect(skyModFilename('Bến Thượng Hải / 2')).toBe('Ben_Thuong_Hai_2.skymod.json');
    expect(skyModFilename('花')).toBe('sky-song.skymod.json');
  });
});
