import { expect, test } from '@playwright/test';
import type { AudioEngine } from '../../src/audio/engine';
import type { MixGraph } from '../../src/audio/graph';

test.beforeEach(async ({ page }) => {
  await page.route('**/sound-packs/manifest.json', (route) => route.fulfill({ json: [] }));
});

// Exercise the production bundle's voice path, rather than a numeric synth mirror.
test('contrabass retains its low pitch and is audible without sub-bass reproduction', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__SKY_MUSIC_STUDIO__);
  const measurements = await page.evaluate(async () => {
    const { playback, instruments, soundSourceInfo } = window.__SKY_MUSIC_STUDIO__!;
    const instrument = instruments.find((item) => item.id === 'contrabass')!;
    if (soundSourceInfo(instrument.id).kind !== 'synth') throw new Error('Expected the built-in contrabass');
    const results = [];
    for (const keyIndex of [0, 5, 11]) {
      for (let pad = 0; pad < instrument.keyCount; pad++) {
        const rate = 44100;
        const ctx = new OfflineAudioContext(2, rate, rate);
        const input = ctx.createGain();
        const speaker = ctx.createBiquadFilter();
        speaker.type = 'highpass';
        speaker.frequency.value = 150;
        speaker.Q.value = Math.SQRT1_2;
        const channels = ctx.createChannelMerger(2);
        input.connect(channels, 0, 0);
        input.connect(speaker);
        speaker.connect(channels, 0, 1);
        channels.connect(ctx.destination);

        // Isolate the production voice on an offline bus so measurements are
        // repeatable and do not depend on the test machine's audio device.
        const engine = new (playback.engine.constructor as typeof AudioEngine)();
        engine.ctx = ctx as unknown as AudioContext;
        engine.graph = { previewBus: { input } } as unknown as MixGraph;
        engine.playPad({ instrument, keyIndex, pad, velocity: 0.8 });
        const rendered = await ctx.startRendering();
        const raw = rendered.getChannelData(0);
        const filtered = rendered.getChannelData(1);
        let energy = 0;
        let peak = 0;
        for (let i = Math.round(rate * 0.05); i < rate / 2; i++) {
          energy += filtered[i] ** 2;
          peak = Math.max(peak, Math.abs(raw[i]));
        }
        const amplitudeAt = (frequency: number) => {
          let real = 0;
          let imaginary = 0;
          for (let i = 0; i < raw.length; i++) {
            const phase = 2 * Math.PI * frequency * i / rate;
            real += raw[i] * Math.cos(phase);
            imaginary += raw[i] * Math.sin(phase);
          }
          return Math.hypot(real, imaginary) * 2 / raw.length;
        };
        const fundamental = 440 * 2 ** ((24 - 69) / 12); // C1, not C2
        results.push({
          keyIndex, pad, rms: Math.sqrt(energy / (rate / 2 - Math.round(rate * 0.05))), peak,
          fundamental: keyIndex === 0 && pad === 0 ? amplitudeAt(fundamental) : null,
          octave: keyIndex === 0 && pad === 0 ? amplitudeAt(fundamental * 2) : null,
        });
      }
    }
    return results;
  });
  for (const result of measurements) {
    // Prevent the lowest notes from disappearing on speakers with little output
    // below 150 Hz. The previous profile measured only ~0.005 RMS on C1.
    expect(result.rms, `key ${result.keyIndex}, pad ${result.pad}`).toBeGreaterThan(0.014);
    expect(result.peak).toBeLessThan(0.5);
  }
  expect(measurements[0].fundamental!).toBeGreaterThan(measurements[0].octave!);
});

test('contrabass keys and scheduled song notes reach the preview mixer', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.waitForFunction(() => window.__SKY_MUSIC_STUDIO__);
  await page.evaluate(() => {
    const state = window.__SKY_MUSIC_STUDIO__!.store.getState();
    state.finishOnboarding();
    state.newProject();
    state.addTrack('contrabass');
    state.addNote(0, 0, 0.5);
    state.setPreferences({ reverbAmount: 0, metronomeEnabled: false, countInMeasures: 0 });
  });
  await page.evaluate(async () => {
    const { playback } = window.__SKY_MUSIC_STUDIO__!;
    await playback.ensureAudio();
  });
  // Capture the real master output after all track/preview gain controls.
  const capture = () => page.evaluate(async () => {
    const { playback } = window.__SKY_MUSIC_STUDIO__!;
    const ctx = playback.engine.ctx!;
    const speaker = ctx.createBiquadFilter();
    speaker.type = 'highpass';
    speaker.frequency.value = 150;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 8192;
    playback.engine.graph!.masterOut.connect(speaker);
    speaker.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    await new Promise((resolve) => setTimeout(resolve, 220));
    analyser.getFloatTimeDomainData(data);
    playback.engine.graph!.masterOut.disconnect(speaker);
    speaker.disconnect();
    analyser.disconnect();
    return Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
  });
  await page.locator('.key-pad').first().dispatchEvent('pointerdown');
  expect(await capture()).toBeGreaterThan(0.003);
  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.playback.engine.stopAll());
  await page.waitForTimeout(100);
  await page.keyboard.press('Space');
  expect(await capture()).toBeGreaterThan(0.003);
  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.playback.stop());
  expect(errors).toEqual([]);
});

test('choosing a space in the toolbar changes the room a note rings in', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.waitForFunction(() => window.__SKY_MUSIC_STUDIO__);
  await page.evaluate(async () => {
    const { store, playback } = window.__SKY_MUSIC_STUDIO__!;
    const state = store.getState();
    state.finishOnboarding();
    state.newProject();
    state.setPreferences({ reverbAmount: 0.6, reverbSpace: 'cave' });
    await playback.ensureAudio();
    state.setPanel('settings');
  });
  const impulseSeconds = () =>
    page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.playback.engine.graph!.convolver.buffer!.duration);
  expect(await impulseSeconds()).toBeCloseTo(5.228, 2);

  // How loud the space answers a single key, heard after the dry note has gone.
  const ring = () =>
    page.evaluate(async () => {
      const { playback, instruments } = window.__SKY_MUSIC_STUDIO__!;
      const engine = playback.engine;
      const analyser = engine.ctx!.createAnalyser();
      analyser.fftSize = 8192;
      engine.graph!.reverbReturn.connect(analyser);
      engine.playPad({ instrument: instruments.find((item) => item.id === 'piano')!, keyIndex: 0, pad: 7, durationSeconds: 0.2 });
      await new Promise((resolve) => setTimeout(resolve, 700));
      const data = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(data);
      engine.graph!.reverbReturn.disconnect(analyser);
      engine.stopAll();
      return Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
    });
  expect(await ring()).toBeGreaterThan(0.0005);

  // The toolbar has the picker at hand, and Settings shows the same choice.
  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().setPanel(null));
  const space = page.getByLabel('Reverb space');
  await expect(space).toHaveValue('cave');
  await space.selectOption({ label: 'Great vault' });
  await page.getByLabel('Reverb amount').fill('0.5');
  expect(await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().preferences.reverbAmount)).toBe(0.5);
  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().setPanel('settings'));
  await expect(page.locator('.settings-card select').first()).toHaveValue('vault');
  await expect.poll(impulseSeconds).toBeCloseTo(8.56, 2);
  expect(await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().preferences.reverbSpace)).toBe('vault');
  await page.waitForTimeout(300);
  expect(await ring()).toBeGreaterThan(0.0005);

  // The choice is kept for the next visit.
  await page.reload();
  await page.waitForFunction(() => window.__SKY_MUSIC_STUDIO__);
  expect(await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().preferences.reverbSpace)).toBe('vault');

  // At 0% the space is silent whichever one is chosen.
  await page.evaluate(async () => {
    const { store, playback } = window.__SKY_MUSIC_STUDIO__!;
    store.getState().setPreferences({ reverbAmount: 0 });
    await playback.ensureAudio();
  });
  await page.waitForTimeout(400);
  expect(await ring()).toBeLessThan(0.00005);
  expect(errors).toEqual([]);
});
