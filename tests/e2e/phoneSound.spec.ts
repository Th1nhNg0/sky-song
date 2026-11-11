import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createSoundPack, normalizeSlice, packFromJson, packToJson } from '../../src/audio/soundPack';

// A phone: touch input, and a browser that only starts sound inside a gesture
// (the shared config switches that rule off for the other suites).
test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, launchOptions: { args: [] } });

// Generated test tones only. These tests never need the owner's recovered audio.
function shipped(instrumentId: string, midi: number) {
  const sample = normalizeSlice([Float32Array.from({ length: 4410 }, (_, i) => Math.sin((2 * Math.PI * 220 * i) / 44100) * 0.5)], 44100);
  sample.midi = midi;
  const pack = createSoundPack({
    id: `test-${instrumentId}`, name: `Test ${instrumentId}`, instrumentId,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', samples: [sample],
  });
  const file = `test-${instrumentId}.skypack.json`;
  return { pack, file, entry: { id: pack.id, updatedAt: pack.updatedAt, instrumentId, file } };
}
const bass = shipped('contrabass', 36);
const cello = shipped('cello', 48);

/** Opens the app on a one-note contrabass song, as a first visit would after choosing a song. */
async function openBassSong(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__SKY_MUSIC_STUDIO__);
  await page.evaluate(() => {
    const { store } = window.__SKY_MUSIC_STUDIO__!;
    store.getState().finishOnboarding();
    store.getState().newProject();
    store.getState().setTrackInstrument(store.getState().activeTrackId, 'contrabass');
    store.getState().addNote(0, 0, 1);
  });
  await expect(page.locator('.instrument-pick')).toHaveAttribute('data-instrument-id', 'contrabass');
}

const app = <T>(page: Page, read: string) =>
  page.evaluate(`(() => { const a = window.__SKY_MUSIC_STUDIO__; const s = a.store.getState(); return ${read}; })()`) as Promise<T>;

test('a tap starts sound at once, and the song joins in when its pack arrives', async ({ page }) => {
  let release = () => {};
  const arrived = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/sound-packs/manifest.json', (route) => route.fulfill({ json: [bass.entry] }));
  await page.route(`**/sound-packs/${bass.file}?*`, async (route) => {
    await arrived;
    await route.fulfill({ contentType: 'application/json', body: packToJson(bass.pack) });
  });
  await openBassSong(page);
  expect(await app(page, 'a.playback.engine.state')).toBe('uninitialized');

  await page.locator('.play-button').tap();
  // The context has to start inside the tap. Starting it after the download is too late on a phone.
  await expect.poll(() => app(page, 'a.playback.engine.state')).toBe('running');
  await expect(page.locator('.play-button')).toHaveAttribute('aria-busy', 'true');
  expect(await app(page, 's.isPlaying')).toBe(false);

  release();
  await expect.poll(() => app(page, 's.isPlaying')).toBe(true);
  expect(await app(page, "a.soundSourceInfo('contrabass').pack.id")).toBe(bass.pack.id);
  await expect.poll(() => app(page, 'a.getSampleVoiceCount()')).toBeGreaterThan(0);
});

test('only the packs a song uses are fetched, and the rest wait until they are wanted', async ({ page }) => {
  const requests = { bass: 0, cello: 0 };
  await page.route('**/sound-packs/manifest.json', (route) => route.fulfill({ json: [bass.entry, cello.entry] }));
  await page.route(`**/sound-packs/${bass.file}?*`, (route) => {
    requests.bass++;
    return route.fulfill({ contentType: 'application/json', body: packToJson(bass.pack) });
  });
  await page.route(`**/sound-packs/${cello.file}?*`, (route) => {
    requests.cello++;
    return route.fulfill({ contentType: 'application/json', body: packToJson(cello.pack) });
  });
  await openBassSong(page);
  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.playback.ensureAudio());
  expect(requests).toEqual({ bass: 1, cello: 0 });
  // The cello's recordings exist, so it is labelled as a game sound before they are read.
  expect(await app(page, "[a.soundSourceInfo('cello').kind, a.soundSourceInfo('cello').pack]")).toEqual(['sample', null]);

  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.playback.audition('cello'));
  expect(requests).toEqual({ bass: 1, cello: 1 });
  expect(await app(page, "a.soundSourceInfo('cello').sampleCount")).toBe(1);

  // Both now come from this browser's copy.
  await page.reload();
  await page.waitForFunction(() => window.__SKY_MUSIC_STUDIO__);
  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.playback.ensureAudio(['contrabass', 'cello']));
  expect(await app(page, "a.soundSourceInfo('cello').sampleCount + a.soundSourceInfo('contrabass').sampleCount")).toBe(2);
  expect(requests).toEqual({ bass: 1, cello: 1 });
});

test('a pack that never arrives does not keep the song silent', async ({ page }) => {
  await page.route('**/sound-packs/manifest.json', (route) => route.fulfill({ json: [bass.entry] }));
  await page.route(`**/sound-packs/${bass.file}?*`, () => {
    // Never answered: a stalled mobile connection.
  });
  await openBassSong(page);
  await page.locator('.play-button').tap();
  await expect.poll(() => app(page, 's.isPlaying'), { timeout: 15_000 }).toBe(true);
  await expect(page.locator('.play-button')).toHaveAttribute('aria-busy', 'false');
});

test('the deployed packs are a fraction of the size and play the very same samples', async ({ page }) => {
  // No routes here: this reads the build's own manifest and packed files.
  const fetched: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/sound-packs/')) fetched.push(response.url().split('/').pop()!.split('?')[0]);
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__SKY_MUSIC_STUDIO__);
  for (const [instrumentId, file] of [['harp', 'Game-harp-harp'], ['violin', 'Game-violin-violin']]) {
    const source = packFromJson(readFileSync(`public/sound-packs/${file}.skypack.json`, 'utf8'));
    // Each sample is compared by a digest of the 16-bit values its audio is made of.
    const played = await page.evaluate(async (id) => {
      const studio = window.__SKY_MUSIC_STUDIO__!;
      await studio.playback.ensureAudio([id]);
      const pack = studio.soundSourceInfo(id).pack!;
      const samples = [];
      for (const sample of pack.samples) {
        const digests = [];
        for (const channel of sample.channels) {
          const digest = await crypto.subtle.digest('SHA-256', Int16Array.from(channel, (value) => value * 32768));
          digests.push(Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''));
        }
        samples.push([sample.id, sample.midi, sample.gain, sample.sampleRate, ...digests]);
      }
      return { id: pack.id, name: pack.name, updatedAt: pack.updatedAt, samples };
    }, instrumentId);
    expect(played).toEqual({
      id: source.id,
      name: source.name,
      updatedAt: source.updatedAt,
      samples: source.samples.map((sample) => [
        sample.id, sample.midi, sample.gain, sample.sampleRate,
        ...sample.channels.map((channel) =>
          createHash('sha256').update(new Uint8Array(Int16Array.from(channel, (value) => value * 32768).buffer)).digest('hex'),
        ),
      ]),
    });
  }
  const packs = fetched.filter((name) => name !== 'manifest.json');
  expect(packs.every((name) => name.endsWith('.skyaudio'))).toBe(true);
  const bytes = packs.reduce((total, name) => total + statSync(`dist/sound-packs/${name}`).size, 0);
  const json = statSync('public/sound-packs/Game-harp-harp.skypack.json').size + statSync('public/sound-packs/Game-violin-violin.skypack.json').size;
  expect(bytes).toBeLessThan(json / 2);
});
