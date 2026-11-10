#!/usr/bin/env node
/**
 * Packs a folder of `.skymusic.json` projects into the app's built-in song library.
 *
 *   node scripts/build-song-library.mjs <folder>
 *
 * The folder needs a `meta.json` mapping each file's base name to `{ artist, year }`;
 * only songs listed there are packed. Each song is written to `public/songs/` without
 * note ids (the app makes new ones on open), which keeps the files small, and
 * `public/songs/catalog.json` gets the details the browser panel shows before a song
 * is downloaded.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHAPE_STEPS = 40;
const source = process.argv[2] && resolve(process.argv[2]);
if (!source) {
  process.stderr.write('usage: node scripts/build-song-library.mjs <folder with .skymusic.json files and meta.json>\n');
  process.exit(1);
}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'songs');
const meta = JSON.parse(readFileSync(join(source, 'meta.json'), 'utf8'));
const round = (value, places) => Number(value.toFixed(places));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const catalog = [];
for (const name of readdirSync(source).sort()) {
  if (!name.endsWith('.skymusic.json')) continue;
  const slug = name.replace(/\.skymusic\.json$/, '');
  const details = meta[slug];
  if (!details) continue;
  const project = JSON.parse(readFileSync(join(source, name), 'utf8'));
  const tracks = project.tracks.filter((track) => track.notes.length > 0);
  const notes = tracks.flatMap((track) => track.notes);
  const endBeat = Math.max(...notes.map((note) => note.startBeat + note.durationBeats));

  // How busy the song is from start to end, drawn as the card's little skyline.
  const shape = new Array(SHAPE_STEPS).fill(0);
  for (const note of notes) shape[Math.min(SHAPE_STEPS - 1, Math.floor((note.startBeat / endBeat) * SHAPE_STEPS))] += 1;
  const peak = Math.max(...shape);

  const packed = {
    ...project,
    id: `song-${slug}`,
    tracks: tracks.map(({ id: _trackId, notes: trackNotes, ...track }) => ({
      ...track,
      notes: trackNotes.map((note) => ({
        pad: note.pad,
        startBeat: round(note.startBeat, 4),
        durationBeats: round(note.durationBeats, 4),
        velocity: round(note.velocity, 2),
      })),
    })),
  };
  const file = `${slug}.skymusic.json`;
  writeFileSync(join(out, file), JSON.stringify(packed));
  catalog.push({
    id: packed.id,
    title: project.title,
    artist: details.artist,
    year: details.year,
    file,
    bpm: project.bpm,
    seconds: Math.round((endBeat * 60) / project.bpm),
    notes: notes.length,
    instruments: tracks.map((track) => track.instrumentId),
    shape: shape.map((count) => round(count / peak, 2)),
  });
}

catalog.sort((a, b) => a.title.localeCompare(b.title));
writeFileSync(join(out, 'catalog.json'), `${JSON.stringify(catalog, null, 1)}\n`);
process.stdout.write(`Packed ${catalog.length} songs into ${out}\n`);
