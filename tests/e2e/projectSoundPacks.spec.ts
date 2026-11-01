import { expect, test } from '@playwright/test';
import { createSoundPack, normalizeSlice, packToJson } from '../../src/audio/soundPack';

// Generated test tones only. These tests never need the owner's recovered audio.
const sample = normalizeSlice([Float32Array.from({ length: 4410 }, (_, i) => Math.sin(2 * Math.PI * 130.81 * i / 44100) * 0.5)], 44100);
sample.midi = 48;
const pack = createSoundPack({
  id: 'test-project-bass', name: 'Test project bass', instrumentId: 'contrabass',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', samples: [sample],
});
const file = 'test-bass.skypack.json';
const entry = { id: pack.id, updatedAt: pack.updatedAt, file };

test('split deployment assets assemble into one complete sound pack', async ({ page }) => {
  const second = { ...pack, samples: [{ ...sample, id: 'second-sample', midi: 60 }] };
  await page.route('**/sound-packs/manifest.json', (route) => route.fulfill({ json: [{
    id: pack.id, updatedAt: pack.updatedAt, parts: ['bass-part-1.skypack.json', 'bass-part-2.skypack.json'],
  }] }));
  await page.route('**/sound-packs/bass-part-1.skypack.json?*', (route) => route.fulfill({ body: packToJson(pack) }));
  await page.route('**/sound-packs/bass-part-2.skypack.json?*', (route) => route.fulfill({ body: packToJson(second) }));
  await page.goto('/');
  await page.waitForFunction(() => window.__SKY_MUSIC_STUDIO__);
  const notes = await page.evaluate(async () => {
    const app = window.__SKY_MUSIC_STUDIO__!;
    await app.playback.ensureAudio();
    return app.soundSourceInfo('contrabass').pack!.samples.map((item) => item.midi);
  });
  expect(notes).toEqual([48, 60]);
});

test('built preview awaits project packs for the first note and caches them across reloads', async ({ page }) => {
  let requests = 0;
  await page.route('**/sound-packs/manifest.json', (route) => route.fulfill({ json: [entry] }));
  await page.route('**/sound-packs/test-bass.skypack.json?*', async (route) => {
    requests++;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ contentType: 'application/json', body: packToJson(pack) });
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__SKY_MUSIC_STUDIO__);
  const first = await page.evaluate(async () => {
    const app = window.__SKY_MUSIC_STUDIO__!;
    await app.playback.ensureAudio();
    const before = app.getSampleVoiceCount();
    await app.playback.previewPad('contrabass', 0, 0.8, true);
    return { kind: app.soundSourceInfo('contrabass').kind, voices: app.getSampleVoiceCount() - before };
  });
  expect(first).toEqual({ kind: 'sample', voices: 1 });
  expect(requests).toBe(1);

  // Simulate a user disabling the pack through Settings, then reloading.
  await page.evaluate(async () => {
    const source = window.__SKY_MUSIC_STUDIO__!.soundSourceInfo('contrabass').pack!;
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('sky-music-studio-sounds', 1);
      open.onsuccess = () => {
        const tx = open.result.transaction('packs', 'readwrite');
        tx.objectStore('packs').put({ ...source, enabled: false });
        tx.oncomplete = () => { open.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
  });
  await page.reload();
  await page.waitForFunction(() => window.__SKY_MUSIC_STUDIO__);
  const kind = await page.evaluate(async () => {
    const app = window.__SKY_MUSIC_STUDIO__!;
    await app.playback.ensureAudio();
    return app.soundSourceInfo('contrabass').kind;
  });
  expect(kind).toBe('synth');
  expect(requests).toBe(1); // Same version comes from IndexedDB, including its disabled state.
});

test('a broken project pack does not prevent other packs or audio from loading', async ({ page }) => {
  await page.route('**/sound-packs/manifest.json', (route) => route.fulfill({ json: [
    { id: 'broken', updatedAt: pack.updatedAt, file: 'broken.skypack.json' }, entry,
    { id: 'external', updatedAt: pack.updatedAt, file: 'https://example.com/external.skypack.json' },
  ] }));
  await page.route('**/sound-packs/broken.skypack.json?*', (route) => route.fulfill({ body: 'invalid JSON' }));
  await page.route('**/sound-packs/test-bass.skypack.json?*', (route) => route.fulfill({ body: packToJson(pack) }));
  let externalRequests = 0;
  await page.route('https://example.com/**', (route) => { externalRequests++; return route.abort(); });
  await page.goto('/');
  await page.waitForFunction(() => window.__SKY_MUSIC_STUDIO__);
  const source = await page.evaluate(async () => {
    const app = window.__SKY_MUSIC_STUDIO__!;
    await app.playback.ensureAudio();
    return app.soundSourceInfo('contrabass').kind;
  });
  expect(source).toBe('sample');
  expect(externalRequests).toBe(0);
});
