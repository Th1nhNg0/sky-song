import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const LOCAL_PACKS = path.join(os.homedir(), 'sky-game-sounds', 'packs');

// Dev server only: serves the owner's local packs. Nothing here reaches a build.
function localGamePacks(): Plugin {
  return {
    name: 'local-game-packs',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__local-packs', (req, res) => {
        const file = path.join(LOCAL_PACKS, path.basename(req.url ?? ''));
        if (!fs.existsSync(file)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Type', file.endsWith('.png') ? 'image/png' : file.endsWith('.mid') ? 'audio/midi' : 'application/json');
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

// Static-only app: no backend, no API keys. Relative base makes it deployable
// to any static host or subdirectory (including GitHub Pages style hosting).
export default defineConfig({
  base: './',
  plugins: [react(), localGamePacks()],
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
