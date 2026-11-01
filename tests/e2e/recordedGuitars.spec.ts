import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { AudioEngine } from '../../src/audio/engine';
import type { MixGraph } from '../../src/audio/graph';

for (const instrumentId of ['light-guitar', 'electric-guitar']) {
  test(`${instrumentId} recorded short notes have an audible attack without clipping`, async ({ page }) => {
    const filename = `Game-${instrumentId}-${instrumentId}.skypack.json`;
    const body = readFileSync(`public/sound-packs/${filename}`, 'utf8');
    const pack = JSON.parse(body);
    await page.route('**/sound-packs/manifest.json', (route) => route.fulfill({ json: [{ id: pack.id, updatedAt: pack.updatedAt, file: filename }] }));
    await page.route(`**/sound-packs/${filename}?*`, (route) => route.fulfill({ body }));
    await page.goto('/');
    await page.waitForFunction(() => window.__SKY_MUSIC_STUDIO__);
    const measurements = await page.evaluate(async (id) => {
      const { playback, instruments, soundSourceInfo } = window.__SKY_MUSIC_STUDIO__!;
      await playback.ensureAudio();
      if (soundSourceInfo(id).kind !== 'sample') throw new Error('Expected the recorded guitar');
      const instrument = instruments.find((item) => item.id === id)!;
      const results = [];
      for (const keyIndex of [0, 11]) {
        for (let pad = 0; pad < instrument.keyCount; pad++) {
          const rate = 44100;
          const ctx = new OfflineAudioContext(1, rate / 2, rate);
          const engine = new (playback.engine.constructor as typeof AudioEngine)();
          engine.ctx = ctx as unknown as AudioContext;
          engine.graph = { previewBus: { input: ctx.destination } } as unknown as MixGraph;
          engine.playPad({ instrument, keyIndex, pad, velocity: 0.8, durationSeconds: 0.25 });
          const data = (await ctx.startRendering()).getChannelData(0);
          const start = Math.round(rate * 0.02);
          const end = Math.round(rate * 0.2);
          let energy = 0;
          let peak = 0;
          for (let i = 0; i < data.length; i++) {
            peak = Math.max(peak, Math.abs(data[i]));
            if (i >= start && i < end) energy += data[i] ** 2;
          }
          results.push({ keyIndex, pad, rms: Math.sqrt(energy / (end - start)), peak });
        }
      }
      return results;
    }, instrumentId);
    for (const result of measurements) {
      expect(result.rms, `key ${result.keyIndex}, pad ${result.pad}`).toBeGreaterThan(0.015);
      expect(result.peak).toBeLessThan(0.3);
    }
  });
}
