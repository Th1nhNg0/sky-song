/**
 * Headless MIDI → `.skymusic.json` converter.
 *
 * Runs the app's own importer (`src/music/midiImport.ts`) outside the browser so a
 * MIDI file you already have can be turned into a project file and imported back
 * into Sky Music Studio. It goes through the same `parseProjectJson` validation the
 * app runs on import, so anything this writes is a file the app accepts.
 *
 * Nothing here contains song data: all musical content comes from the MIDI argument.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { midiToProject } from '../src/music/midiImport';
import { getInstrument } from '../src/music/instruments';
import { keyShortLabel } from '../src/music/keys';
import { resolvePad } from '../src/music/pitch';
import { projectEndBeat, projectToJson } from '../src/music/project';
import { beatsPerMeasure, MAX_BPM, MIN_BPM } from '../src/music/time';
import { parseProjectJson, ProjectImportError } from '../src/music/validation';
import type { Project, Track, ValidationIssue } from '../src/music/types';

const USAGE = `sky-music-studio · MIDI → .skymusic.json

  npm run midi2sky -- <file.mid> [options]
  node scripts/midi2sky.mjs <file.mid> [options]

Options
  -o, --out <path>     output file (default: next to the input, .skymusic.json)
  -t, --title <name>   project title (default: the MIDI file's name)
  -b, --bpm <n>        tempo in ${MIN_BPM}–${MAX_BPM} (default: the MIDI tempo)
  -k, --key <key>      major key: 0–11 or C, D♭, D, E♭, E, F, G♭, G, A♭, A, B♭, B
                       (also accepts Db / C# / F# style spellings)
  -s, --stdout         print the project JSON instead of writing a file
  -q, --quiet          only print errors
  -h, --help           show this text

Notes
  The importer keeps up to 6 pitched parts (plus a drum track), moving any extra part
  onto the nearest one. Notes a part can't reach go to one that can, adding Contrabass
  or Xylophone only when they would carry a tenth of the song. It snaps note times to a 0.25-beat grid (a triplet-friendly
  1/12 grid for swung songs), folds everything onto the instrument's real Sky pads, and
  picks one whole-song transpose so the song lands on the diatonic pads where it can.
  A single-track piano file is split into Melody / Chords / Bass parts.
  Pad indices are physical, so --key transposes playback without editing any note.
`;

const KEY_ALIASES: Record<string, number> = {
  C: 0,
  DB: 1,
  'C#': 1,
  D: 2,
  EB: 3,
  'D#': 3,
  E: 4,
  F: 5,
  GB: 6,
  'F#': 6,
  G: 7,
  AB: 8,
  'G#': 8,
  A: 9,
  BB: 10,
  'A#': 10,
  B: 11,
};

interface Options {
  input?: string;
  out?: string;
  title?: string;
  bpm?: number;
  key?: number;
  stdout: boolean;
  quiet: boolean;
  help: boolean;
}

function fail(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

function parseKey(raw: string): number {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const index = Number(trimmed);
    if (index >= 0 && index <= 11) return index;
    fail(`key ${raw} is out of range (0–11)`);
  }
  const normalized = trimmed
    .replace(/♭/g, 'b')
    .replace(/♯/g, '#')
    .replace(/^([a-g])/, (letter) => letter.toUpperCase())
    .toUpperCase();
  const index = KEY_ALIASES[normalized];
  if (index === undefined) fail(`unknown key "${raw}" (try 0–11 or C, Db, F#, B♭…)`);
  return index;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { stdout: false, quiet: false, help: false };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const take = (label: string): string => {
      const value = argv[++i];
      if (value === undefined) fail(`${label} needs a value`);
      return value;
    };
    switch (arg) {
      case '-o':
      case '--out':
        options.out = take(arg);
        break;
      case '-t':
      case '--title':
        options.title = take(arg);
        break;
      case '-b':
      case '--bpm': {
        const value = Number(take(arg));
        if (!Number.isFinite(value)) fail('--bpm must be a number');
        if (value < MIN_BPM || value > MAX_BPM) fail(`--bpm must be ${MIN_BPM}–${MAX_BPM}`);
        options.bpm = Math.round(value);
        break;
      }
      case '-k':
      case '--key':
        options.key = parseKey(take(arg));
        break;
      case '-s':
      case '--stdout':
        options.stdout = true;
        break;
      case '-q':
      case '--quiet':
        options.quiet = true;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      default:
        if (arg.startsWith('-')) fail(`unknown option ${arg}`);
        rest.push(arg);
    }
  }
  if (rest.length > 1) fail('pass exactly one MIDI file');
  options.input = rest[0];
  return options;
}

function padRange(track: Track): string {
  if (track.notes.length === 0) return '–';
  const pads = track.notes.map((note) => note.pad + 1);
  const low = Math.min(...pads);
  const high = Math.max(...pads);
  return low === high ? `${low}` : `${low}–${high}`;
}

function formatDuration(beats: number, bpm: number): string {
  const seconds = Math.round((beats * 60) / bpm);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function report(project: Project, inputPath: string, outPath: string | null, warnings: ValidationIssue[]) {
  const lines: string[] = [];
  const meter = project.timeSignature;
  const bars = Math.ceil(projectEndBeat(project) / beatsPerMeasure(meter));
  const totalNotes = project.tracks.reduce((sum, track) => sum + track.notes.length, 0);

  lines.push(`✓ ${project.title}`);
  lines.push(
    `  ${project.bpm} BPM · ${meter[0]}/${meter[1]} · key ${keyShortLabel(project.key)} · ` +
      `${bars} bars · ${formatDuration(projectEndBeat(project), project.bpm)} · ${totalNotes} notes`,
  );
  lines.push('');

  const width = Math.max(...project.tracks.map((track) => track.name.length), 4);
  lines.push(`  ${'track'.padEnd(width)}  instrument        notes  pads  hold`);
  for (const track of project.tracks) {
    const instrument = getInstrument(track.instrumentId);
    const longest = track.notes.reduce((max, note) => Math.max(max, note.durationBeats), 0);
    const pitched = track.notes.some((note) => resolvePad(instrument, project.key, note.pad).pitched);
    lines.push(
      `  ${track.name.padEnd(width)}  ${instrument.displayName.padEnd(16)}  ` +
        `${String(track.notes.length).padStart(5)}  ${padRange(track).padStart(4)}  ` +
        `${pitched ? `${longest.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}b` : '–'}`,
    );
  }

  if (warnings.length > 0) {
    lines.push('');
    for (const warning of warnings) lines.push(`  ! ${warning.path}: ${warning.message}`);
  }

  lines.push('');
  lines.push(inputPath);
  if (outPath) {
    lines.push(`→ ${outPath}`);
    lines.push('');
    lines.push('  Import it in the app: More → Import project (or Library → open).');
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (!options.input) {
    process.stderr.write(USAGE);
    process.exit(1);
  }

  const inputPath = resolve(options.input);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(inputPath));
  } catch {
    fail(`cannot read ${inputPath}`);
  }
  if (bytes.byteLength === 0) fail(`${inputPath} is empty`);

  const fallbackTitle = basename(inputPath, extname(inputPath));
  let project: Project;
  try {
    project = midiToProject(bytes, options.title ?? fallbackTitle);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  if (options.title) project.title = options.title.slice(0, 120);
  if (options.bpm !== undefined) project.bpm = options.bpm;
  // Pads are physical, so the key only changes the pitch the same pads produce.
  if (options.key !== undefined) project.key = options.key;
  project.updatedAt = new Date().toISOString();

  const json = projectToJson(project);
  let validated: Project;
  let warnings: ValidationIssue[];
  try {
    const result = parseProjectJson(json);
    validated = result.project;
    warnings = result.warnings;
  } catch (error) {
    if (error instanceof ProjectImportError) {
      const detail = error.errors.map((entry) => `${entry.path}: ${entry.message}`).join('\n  ');
      fail(`the app would reject this project:\n  ${detail}`);
    }
    throw error;
  }

  if (options.stdout) {
    process.stdout.write(`${projectToJson(validated)}\n`);
    return;
  }

  const outPath = resolve(
    options.out ?? `${inputPath.replace(/\.(mid|midi)$/i, '')}.skymusic.json`,
  );
  try {
    writeFileSync(outPath, projectToJson(validated), 'utf8');
  } catch {
    fail(`cannot write ${outPath}`);
  }

  if (!options.quiet) report(validated, inputPath, outPath, warnings);
}

main();
