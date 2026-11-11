import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { prepareCloudflareAssets } from './scripts/cloudflareAssets';

// Project packs are versioned alongside the app. Vite's public directory serves
// the same files in dev and copies them into production builds and previews.
function prepareProjectSoundPacks(): void {
  const directory = fileURLToPath(new URL('./public/sound-packs/', import.meta.url));
  fs.mkdirSync(directory, { recursive: true });
  const manifest = fs.readdirSync(directory).filter((file) => file.endsWith('.skypack.json')).sort().map((file) => {
    const pack = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
    if (
      pack.format !== 'skymusic-soundpack' || pack.version !== 1 || typeof pack.id !== 'string' ||
      typeof pack.updatedAt !== 'string' || typeof pack.instrumentId !== 'string'
    ) {
      throw new Error(`Invalid project sound pack: ${file}`);
    }
    // Naming the instrument lets the app fetch a pack only when a song uses that instrument.
    return { id: pack.id as string, updatedAt: pack.updatedAt as string, instrumentId: pack.instrumentId as string, file };
  });
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
}

prepareProjectSoundPacks();

// Static-only app: no backend, no API keys. Relative base makes it deployable
// to any static host or subdirectory (including GitHub Pages style hosting).
export default defineConfig({
  base: './',
  plugins: [react(), {
    name: 'cloudflare-sound-pack-assets',
    apply: 'build',
    writeBundle(options) {
      prepareCloudflareAssets(path.join(options.dir!, 'sound-packs'));
    },
  }],
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
  preview: {
    port: 4173,
    host: '127.0.0.1',
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
