import { expect, test, type Page } from '@playwright/test';
import { createSoundPack, normalizeSlice, packToJson, type SoundPack } from '../../src/audio/soundPack';

// Generated test tones only. These tests never need the owner's recovered audio.
const RATE = 44100;

/** Decaying tones with a gap after each. A scale recording starts with silence; a single-note file does not. */
function tones(midis: number[], leadSeconds = 0): Float32Array {
  const noteFrames = Math.floor(0.5 * RATE);
  const gapFrames = Math.floor(0.25 * RATE);
  const leadFrames = Math.floor(leadSeconds * RATE);
  const out = new Float32Array(leadFrames + midis.length * (noteFrames + gapFrames));
  midis.forEach((midi, index) => {
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    for (let i = 0; i < noteFrames; i++) {
      const t = i / RATE;
      out[leadFrames + index * (noteFrames + gapFrames) + i] = 0.6 * Math.exp(-t * 6) * Math.sin(2 * Math.PI * frequency * t);
    }
  });
  return out;
}

function wav(samples: Float32Array): Buffer {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(RATE, 24);
  buffer.writeUInt32LE(RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, index) => buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + index * 2));
  return buffer;
}

const audioFile = (name: string, midis: number[], leadSeconds = 0) => ({
  name,
  mimeType: 'audio/wav',
  buffer: wav(tones(midis, leadSeconds)),
});

function pack(id: string, name: string, instrumentId: string, midi: number): SoundPack {
  const sample = normalizeSlice([tones([midi])], RATE);
  sample.midi = midi;
  return createSoundPack({
    id, name, instrumentId, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', samples: [sample],
  });
}

const packFile = (item: SoundPack) => ({ name: `${item.id}.skypack.json`, mimeType: 'application/json', buffer: Buffer.from(packToJson(item)) });

async function openSounds(page: Page) {
  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().setPanel('settings'));
  await expect(page.locator('.sounds-panel')).toBeVisible();
}

async function boot(page: Page) {
  await page.route('**/sound-packs/manifest.json', (route) => route.fulfill({ json: [] }));
  await page.goto('/');
  await page.waitForFunction(() => window.__SKY_MUSIC_STUDIO__);
  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().finishOnboarding());
  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().newProject());
  await openSounds(page);
}

const sourceKind = (page: Page, instrumentId: string) =>
  page.evaluate((id) => window.__SKY_MUSIC_STUDIO__!.soundSourceInfo(id).kind, instrumentId);
const sampleVoices = (page: Page) => page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.getSampleVoiceCount());

const packInput = '.sounds-panel input[type="file"][accept="application/json,.json"]';
const audioInput = '.sounds-panel input[type="file"][accept^="audio"]';

test('a pack file is imported, switched off and on, and deleted', async ({ page }) => {
  await boot(page);
  const panel = page.locator('.sounds-panel');
  await expect(panel.locator('.sounds-source')).toContainText('Synthesizer in use — original approximation');
  await expect(panel).toContainText('No packs yet.');

  await page.setInputFiles(packInput, packFile(pack('test-harp', 'Test harp', 'harp', 48)));
  await expect(panel.locator('.sounds-notice')).toHaveText('Imported “Test harp” for Harp.');
  const row = panel.locator('.sounds-pack-row');
  await expect(row).toHaveCount(1);
  await expect(row.locator('.sounds-pack-info strong')).toHaveText('Test harp');
  await expect(row.locator('.sounds-pack-info span')).toContainText('1 sample · ');
  await expect(row.locator('.sounds-pack-info span')).toContainText('MB · pitched · updated');
  await expect(row.getByRole('checkbox')).toBeChecked();
  await expect(row.locator('.sounds-pack-active')).toHaveText('Active');
  await expect(panel.locator('.sounds-source')).toHaveClass(/sample/);
  await expect(panel.locator('.sounds-source strong')).toHaveText('Recorded pack in use: Test harp');
  await expect(panel.locator('.sounds-source p')).toContainText('1 recorded note. Notes between recordings are pitch-shifted');
  expect(await sourceKind(page, 'harp')).toBe('sample');

  // The harp's first pad is C3, the note that was recorded.
  const cells = panel.locator('.sounds-map-cell');
  await expect(cells).toHaveCount(15);
  await expect(cells.nth(0)).toHaveText('C3exact recording');
  await expect(cells.nth(1)).toHaveText('D3shift +2 semitones');
  const before = await sampleVoices(page);
  await cells.nth(1).click();
  await expect.poll(() => sampleVoices(page)).toBe(before + 1);

  await panel.getByRole('button', { name: 'Use synth instead' }).click();
  await expect(page.locator('.toast')).toContainText('Back to the synthesizer for Harp.');
  await expect(panel.locator('.sounds-source strong')).toHaveText('Synthesizer in use — original approximation');
  await expect(row.getByRole('checkbox')).not.toBeChecked();
  await expect(row.locator('.sounds-pack-active')).toHaveText('Use');
  await expect(cells).toHaveCount(0);
  expect(await sourceKind(page, 'harp')).toBe('synth');

  await row.getByRole('checkbox').click();
  await expect(page.locator('.toast')).toContainText('Using “Test harp” for Harp.');
  expect(await sourceKind(page, 'harp')).toBe('sample');

  await page.setInputFiles(packInput, packFile(pack('test-nope', 'Lost', 'nope', 60)));
  await expect(panel.locator('.sounds-error')).toHaveText('This pack targets an unknown instrument “nope”.');

  // A pack for another instrument takes the panel to that instrument.
  await page.setInputFiles(packInput, packFile(pack('test-piano', 'Test piano', 'piano', 60)));
  await expect(panel.locator('.sounds-notice')).toHaveText('Imported “Test piano” for Piano.');
  await expect(panel.locator('.sounds-instrument-select select')).toHaveValue('piano');
  await expect(row.locator('.sounds-pack-info strong')).toHaveText('Test piano');

  await panel.locator('.sounds-instrument-select select').selectOption('harp');
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toBe('Delete “Test harp”? The recordings will be removed from this browser.');
    void dialog.accept();
  });
  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(panel.locator('.sounds-notice')).toHaveText('Deleted “Test harp”.');
  await expect(row).toHaveCount(0);
  expect(await sourceKind(page, 'harp')).toBe('synth');
  expect(await sourceKind(page, 'piano')).toBe('sample');
});

test('one file per note becomes a saved pack that takes over from the active one', async ({ page }) => {
  await boot(page);
  const panel = page.locator('.sounds-panel');
  await page.setInputFiles(packInput, packFile(pack('old-harp', 'Old harp', 'harp', 48)));
  await expect(panel.locator('.sounds-pack-row')).toHaveCount(1);

  await panel.getByLabel('One audio file per note').check();
  await page.setInputFiles(audioInput, [audioFile('c4.wav', [60]), audioFile('e4.wav', [64])]);
  await expect(panel.locator('.sounds-notice')).toHaveText('2 files loaded. Detected notes are shown; correct any octave errors.');
  await expect(panel.locator('.sounds-draft h4')).toHaveText('2 prepared samples');
  const rows = panel.locator('.sounds-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('.sounds-midi-input')).toHaveValue('60');
  await expect(rows.nth(1).locator('.sounds-midi-input')).toHaveValue('64');
  await expect(rows.nth(0).locator('.sounds-note-name')).toHaveText('C4');
  await expect(rows.nth(0).locator('.mini-chip')).toContainText('detected C4 · ');

  // Notes can be corrected by a semitone or typed, and stay inside the MIDI range.
  await rows.nth(0).getByRole('button', { name: 'One semitone higher' }).click();
  await expect(rows.nth(0).locator('.sounds-midi-input')).toHaveValue('61');
  await rows.nth(0).getByRole('button', { name: 'One semitone lower' }).click();
  await expect(rows.nth(0).locator('.sounds-midi-input')).toHaveValue('60');
  await rows.nth(1).locator('.sounds-midi-input').fill('200');
  await expect(rows.nth(1).locator('.sounds-midi-input')).toHaveValue('127');
  await rows.nth(1).locator('.sounds-midi-input').fill('64');
  await expect(rows.nth(1).locator('.mini-chip')).toContainText('detected E4 · ');

  const before = await sampleVoices(page);
  await rows.nth(0).getByRole('button', { name: '▶ Preview' }).click();
  await expect.poll(() => sampleVoices(page)).toBe(before + 1);

  await panel.locator('.sounds-name-field input').fill('My harp');
  await panel.getByRole('button', { name: 'Save pack in this browser' }).click();
  await expect(panel.locator('.sounds-notice')).toHaveText('Saved “My harp” for Harp. 2 samples, stored only in this browser.');
  await expect(panel.locator('.sounds-draft')).toHaveCount(0);
  const packs = panel.locator('.sounds-pack-row');
  await expect(packs).toHaveCount(2);
  await expect(packs.nth(0).locator('.sounds-pack-info strong')).toHaveText('My harp');
  await expect(packs.nth(0).getByRole('checkbox')).toBeChecked();
  await expect(packs.nth(1).locator('.sounds-pack-info strong')).toHaveText('Old harp');
  await expect(packs.nth(1).getByRole('checkbox')).not.toBeChecked();
  await expect(panel.locator('.sounds-source strong')).toHaveText('Recorded pack in use: My harp');
  // C4 and E4 are the harp's eighth and tenth pads; the pad above them is shifted up from E4.
  await expect(panel.locator('.sounds-map-cell').nth(7)).toHaveText('C4exact recording');
  await expect(panel.locator('.sounds-map-cell').nth(9)).toHaveText('E4exact recording');
  await expect(panel.locator('.sounds-map-cell').nth(10)).toHaveText('F4shift +1 semitones');

  // Switching the old pack back on switches the new one off.
  await packs.nth(1).getByRole('checkbox').click();
  await expect(page.locator('.toast')).toContainText('Using “Old harp” for Harp.');
  await expect(panel.locator('.sounds-source strong')).toHaveText('Recorded pack in use: Old harp');
  await expect(packs.nth(0).locator('.sounds-pack-info strong')).toHaveText('Old harp');
  await expect(packs.nth(1).getByRole('checkbox')).not.toBeChecked();

  await page.reload();
  await page.waitForFunction(() => window.__SKY_MUSIC_STUDIO__);
  await openSounds(page);
  await expect(packs).toHaveCount(2);
  await expect(packs.nth(0).locator('.sounds-pack-info strong')).toHaveText('Old harp');
  await expect(packs.nth(0).getByRole('checkbox')).toBeChecked();
  await expect(packs.nth(1).getByRole('checkbox')).not.toBeChecked();
});

test('a played scale is sliced at its onsets, and a drum maps the slices to pads', async ({ page }) => {
  await boot(page);
  const panel = page.locator('.sounds-panel');
  await page.setInputFiles(audioInput, audioFile('scale.wav', [60, 64, 67], 0.25));
  await expect(panel.locator('.sounds-notice')).toHaveText(
    '3 slices detected from scale.wav. Check the notes below and correct any mistakes.',
  );
  await expect(panel).toContainText('scale.wav · 2.50 s · 44100 Hz · mono');
  await expect(panel.locator('.sounds-midi-input')).toHaveCount(3);
  await expect(panel.locator('.sounds-midi-input').nth(2)).toHaveValue('67');

  // Notes this far apart survive the widest minimum gap.
  await panel.locator('.sounds-controls input[type="range"]').nth(1).fill('400');
  await panel.getByRole('button', { name: 'Re-slice with these settings' }).click();
  await expect(panel.locator('.sounds-row')).toHaveCount(3);

  // Changing instrument throws the draft away.
  await panel.locator('.sounds-instrument-select select').selectOption('drum');
  await expect(panel.locator('.sounds-row')).toHaveCount(0);
  await expect(panel).toContainText('Percussion packs are mapped by pad rather than pitch.');

  await page.setInputFiles(audioInput, audioFile('hits.wav', [60, 64, 67], 0.25));
  await expect(panel.locator('.sounds-notice')).toHaveText(
    '3 slices detected from hits.wav. Check the notes below and correct any mistakes.',
  );
  const selects = panel.locator('.sounds-pad-select');
  await expect(selects).toHaveCount(3);
  await expect(selects.nth(0)).toHaveValue('0');
  await expect(selects.nth(2)).toHaveValue('2');
  await selects.nth(2).selectOption('7');
  await expect(panel.locator('.sounds-draft .mini-chip')).toHaveText('assign to pads');

  await panel.getByRole('button', { name: 'Save pack in this browser' }).click();
  await expect(panel.locator('.sounds-notice')).toHaveText('Saved “Drum recording” for Drum. 3 samples, stored only in this browser.');
  const row = panel.locator('.sounds-pack-row');
  await expect(row.locator('.sounds-pack-info strong')).toHaveText('Drum recording');
  await expect(row.locator('.sounds-pack-info span')).toContainText('3 samples · ');
  await expect(row.locator('.sounds-pack-info span')).toContainText('pad-mapped');
  const pads = await page.evaluate(() =>
    window.__SKY_MUSIC_STUDIO__!.soundSourceInfo('drum').pack!.samples.map((sample) => [sample.padIndex, sample.midi]),
  );
  expect(pads).toEqual([[0, null], [1, null], [7, null]]);
});
