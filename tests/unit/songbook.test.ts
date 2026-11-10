import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseProjectJson } from '../../src/music/validation';
import { INSTRUMENTS } from '../../src/music/instruments';
import type { SongbookEntry } from '../../src/state/songbook';

const directory = path.resolve(__dirname, '../../public/songs');
const catalog = JSON.parse(fs.readFileSync(path.join(directory, 'catalog.json'), 'utf8')) as SongbookEntry[];

describe('built-in song library', () => {
  it('lists every packed song exactly once', () => {
    const files = fs.readdirSync(directory).filter((name) => name.endsWith('.skymusic.json')).sort();
    expect(catalog.map((song) => song.file).sort()).toEqual(files);
    expect(new Set(catalog.map((song) => song.id)).size).toBe(catalog.length);
  });

  it('describes each song the way the app opens it', () => {
    const known = new Set(INSTRUMENTS.map((instrument) => instrument.id));
    for (const song of catalog) {
      const { project, warnings } = parseProjectJson(fs.readFileSync(path.join(directory, song.file), 'utf8'));
      expect(warnings, song.file).toEqual([]);
      expect(project.id).toBe(song.id);
      expect(project.title).toBe(song.title);
      expect(project.bpm).toBe(song.bpm);
      expect(project.tracks.map((track) => track.instrumentId)).toEqual(song.instruments);
      expect(project.tracks.reduce((sum, track) => sum + track.notes.length, 0)).toBe(song.notes);
      expect(song.instruments.every((id) => known.has(id))).toBe(true);
    }
  });
});
