#!/usr/bin/env node
/**
 * Runner for scripts/midi-to-project.ts.
 *
 * The repo is TypeScript with bundler-style (extensionless) imports, which Node
 * cannot execute directly, so this bundles the CLI with esbuild into a temp file
 * and imports it. It keeps the converter source typed and lintable instead of
 * forking the importer logic into a separate plain-JS copy.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const result = await build({
  entryPoints: [join(here, 'midi-to-project.ts')],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'silent',
});

const dir = mkdtempSync(join(tmpdir(), 'midi2sky-'));
const entry = join(dir, 'midi-to-project.mjs');
const cleanup = () => rmSync(dir, { recursive: true, force: true });

try {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(entry, result.outputFiles[0].text, 'utf8');
  await import(pathToFileURL(entry).href);
} finally {
  cleanup();
}
