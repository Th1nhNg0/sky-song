import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __errors: string[];
  }
}

const store = <T>(page: Page, read: string) =>
  page.evaluate(`(() => { const s = window.__SKY_MUSIC_STUDIO__.store.getState(); return ${read}; })()`) as Promise<T>;
const noteCount = (page: Page) => store<number>(page, 's.activeTrack().notes.length');

async function boot(page: Page) {
  // Keep editor tests independent of the owner's optional personal packs.
  await page.route('**/sound-packs/manifest.json', (route) => route.fulfill({ json: [] }));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__SKY_MUSIC_STUDIO__);
  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().finishOnboarding());
  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().newProject());
  await expect(page.locator('.roll-grid')).toBeVisible();
  return errors;
}

/** Client position of a beat on a pad row of the open track. */
async function cell(page: Page, beat: number, pad: number) {
  const [box, px, rows] = await Promise.all([
    page.locator('.roll-grid').boundingBox(),
    store<number>(page, 's.preferences.zoom'),
    page.locator('.roll-label').count(),
  ]);
  return { x: box!.x + beat * px + 2, y: box!.y + ((pad + 0.5) * box!.height) / rows };
}

async function clickCell(page: Page, beat: number, pad: number) {
  const { x, y } = await cell(page, beat, pad);
  await page.mouse.click(x, y);
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

test('1-3, 5: compose a song from scratch and edit it', async ({ page }) => {
  const errors = await boot(page);

  await clickCell(page, 0, 0);
  await clickCell(page, 1, 4);
  await clickCell(page, 2, 7);
  await page.mouse.move(10, 10);
  await expect(page.locator('.roll-note')).toHaveCount(3);

  // Move one note with the mouse: it lands on the grid.
  const start = await cell(page, 1, 4);
  await drag(page, { x: start.x + 8, y: start.y }, await cell(page, 3, 6));
  await expect.poll(() => store<number[]>(page, 's.activeTrack().notes.map((n) => n.startBeat)')).toEqual([0, 2, 3]);
  expect(await store<number[]>(page, 's.activeTrack().notes.map((n) => n.pad)')).toEqual([0, 7, 6]);

  // Undo and redo that drag as a single step.
  await page.keyboard.press('Control+z');
  expect(await store<number[]>(page, 's.activeTrack().notes.map((n) => n.startBeat)')).toEqual([0, 1, 2]);
  await page.keyboard.press('Control+Shift+z');
  expect(await store<number[]>(page, 's.activeTrack().notes.map((n) => n.startBeat)')).toEqual([0, 2, 3]);

  // Box select everything with the Edit tool, then copy and paste with the keyboard.
  await page.keyboard.press('2');
  const box = await page.locator('.roll-grid').boundingBox();
  await drag(page, { x: box!.x + 1, y: box!.y + 1 }, { x: box!.x + 300, y: box!.y + box!.height - 4 });
  await expect(page.locator('.roll-note.is-selected')).toHaveCount(3);
  await expect(page.locator('.selection-bar strong')).toHaveText('3 selected');
  await page.keyboard.press('Control+c');
  await page.keyboard.press('End');
  await page.keyboard.press('Control+v');
  expect(await noteCount(page)).toBe(6);

  // Nudge with the arrow keys, keeping the shape of the selection.
  const pads = await store<number[]>(page, 's.activeTrack().notes.slice(3).map((n) => n.pad)');
  await page.keyboard.press('ArrowDown');
  expect(await store<number[]>(page, 's.activeTrack().notes.slice(3).map((n) => n.pad)')).toEqual(pads.map((p) => p + 1));

  // Delete, then right-click delete.
  await page.keyboard.press('Delete');
  expect(await noteCount(page)).toBe(3);
  const note = await cell(page, 0, 0);
  await page.mouse.click(note.x + 6, note.y, { button: 'right' });
  expect(await noteCount(page)).toBe(2);
  expect(errors).toEqual([]);
});

test('2, 3: held instruments stretch, one-shots do not, and mix controls work', async ({ page }) => {
  const errors = await boot(page);

  // Add a cello through the real instrument picker.
  await page.getByRole('button', { name: 'Add instrument' }).click();
  await page.locator('.modal, [role=dialog]').first().waitFor();
  await page.evaluate(() => {
    const state = window.__SKY_MUSIC_STUDIO__!.store.getState();
    state.setPanel(null);
    state.addTrack('cello');
  });
  await expect(page.locator('.track-facts')).toContainText('Held notes');

  const from = await cell(page, 1, 3);
  await drag(page, from, { x: from.x + 150, y: from.y });
  const held = await store<number>(page, 's.activeTrack().notes[0].durationBeats');
  expect(held).toBeGreaterThan(2);

  // Mute on a collapsed lane changes the audible state immediately.
  const lane = page.locator('.track-lane').first();
  await lane.getByRole('button', { name: /^Mute/ }).click();
  expect(await store<boolean>(page, 's.project.tracks[0].muted')).toBe(true);
  await expect(lane).toHaveClass(/is-silent/);
  await page.keyboard.press('Control+z');
  expect(await store<boolean>(page, 's.project.tracks[0].muted')).toBe(false);

  // Opening the harp lane switches the roll to the one-shot look.
  await lane.locator('.track-header-open').click();
  await expect(page.locator('.track-facts')).toContainText('One-shot');
  expect(errors).toEqual([]);
});

test('3: the keys play, and step input writes notes that advance the cursor', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('q');
  expect(await noteCount(page)).toBe(0);
  await page.getByRole('button', { name: 'Step input' }).click();
  await page.keyboard.press('q');
  await page.keyboard.press('w');
  await page.locator('.key-pad').nth(7).dispatchEvent('pointerdown');
  expect(await store<[number, number][]>(page, 's.activeTrack().notes.map((n) => [n.pad, n.startBeat])')).toEqual([
    [0, 0],
    [1, 0.5],
    [7, 1],
  ]);
  await page.getByRole('button', { name: 'Step input' }).click();
});

test('4: tracks play together, loop, and resume from the cursor', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().newProject({ demo: true }));
  await page.locator('.ruler').click({ position: { x: 300, y: 10 } });
  const cursor = await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.playback.position());
  expect(cursor).toBeGreaterThan(4);

  await page.keyboard.press('Space');
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.playback.engineInfo);
  expect(info.state).toBe('running');
  expect(info.tracks.length).toBe(6);
  expect(info.activeVoices).toBeGreaterThan(0);
  const played = await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.playback.position());
  expect(played).toBeGreaterThan(cursor + 1);

  // Tempo changes mid-play keep the position.
  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().setBpm(120));
  const after = await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.playback.position());
  expect(after).toBeGreaterThanOrEqual(played);

  await page.keyboard.press('Space');
  await expect.poll(() => store<boolean>(page, 's.isPlaying')).toBe(false);

  await page.evaluate(() => {
    const state = window.__SKY_MUSIC_STUDIO__!.store.getState();
    state.setLoop({ enabled: true, startBeat: 8, endBeat: 9 });
    window.__SKY_MUSIC_STUDIO__!.playback.seek(8);
  });
  await expect(page.locator('.loop-region')).toBeVisible();
  await page.keyboard.press('Space');
  const seen: number[] = [];
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(120);
    seen.push(await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.playback.position()));
  }
  await page.keyboard.press('Shift+Space');
  expect(Math.min(...seen)).toBeGreaterThanOrEqual(8);
  expect(Math.max(...seen)).toBeLessThan(9);
  expect(seen.some((value, index) => index > 0 && value < seen[index - 1])).toBe(true);
  expect(errors).toEqual([]);
});

test('6: MIDI export and import through the real file controls', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => {
    const state = window.__SKY_MUSIC_STUDIO__!.store.getState();
    state.newProject({ demo: true });
  });
  const before = await store<{ instruments: string[]; counts: number[]; bpm: number }>(
    page,
    '({ instruments: s.project.tracks.map((t) => t.instrumentId), counts: s.project.tracks.map((t) => t.notes.length), bpm: s.project.bpm })',
  );
  await page.getByRole('button', { name: 'Export' }).click();
  const download = page.waitForEvent('download');
  await page.locator('.modal, [role=dialog]').getByRole('button', { name: /MIDI/ }).first().click();
  const file = await (await download).path();
  await page.keyboard.press('Escape');

  await page.setInputFiles('input[aria-label="Import song or MIDI"]', {
    name: 'round-trip.mid',
    mimeType: 'audio/midi',
    buffer: readFileSync(file),
  });
  await expect(page.locator('.project-title')).toHaveValue('round-trip');
  const after = await store<typeof before>(
    page,
    '({ instruments: s.project.tracks.map((t) => t.instrumentId), counts: s.project.tracks.map((t) => t.notes.length), bpm: s.project.bpm })',
  );
  expect(after).toEqual(before);
  expect(errors).toEqual([]);
});

test('7: a song survives a page reload', async ({ page }) => {
  await boot(page);
  await clickCell(page, 2, 5);
  await page.locator('.project-title').fill('Keep me');
  await page.locator('.project-title').press('Enter');
  await page.getByRole('slider', { name: 'Timeline position' }).focus();
  await page.waitForFunction(() => window.__SKY_MUSIC_STUDIO__!.store.getState().saveState === 'saved');
  await page.waitForTimeout(1100);
  await page.waitForFunction(() => window.__SKY_MUSIC_STUDIO__!.store.getState().saveState === 'saved');
  await page.reload();
  await expect(page.locator('.project-title')).toHaveValue('Keep me');
  expect(await noteCount(page)).toBe(1);
  expect(await store<number>(page, 's.activeTrack().notes[0].pad')).toBe(5);
});

test('8: a 20,000-note song stays fast to navigate and edit', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => {
    const { store: app } = window.__SKY_MUSIC_STUDIO__!;
    const state = app.getState();
    const project = structuredClone(state.project);
    for (const id of ['flute', 'cello', 'drum']) {
      state.addTrack(id);
    }
    const tracks = structuredClone(app.getState().project.tracks);
    tracks.forEach((track, t) => {
      track.notes = Array.from({ length: 5000 }, (_, i) => ({
        id: `n${t}-${i}`,
        pad: i % (track.instrumentId === 'drum' ? 8 : 15),
        startBeat: i / 4,
        durationBeats: 0.25,
        velocity: 0.8,
      }));
    });
    state.setProject({ ...project, tracks });
  });
  await expect(page.locator('.roll-note').first()).toBeVisible();
  expect(await page.locator('.roll-note').count()).toBeLessThan(300);

  await page.getByRole('button', { name: 'Zoom to fit' }).click();
  const fitted = await page.locator('.timeline-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth + 400);
  expect(fitted).toBe(true);
  await page.getByRole('button', { name: 'Zoom in' }).click();

  // Jump from the overview to the far end of the song and find its notes there.
  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().setPreferences({ zoom: 56 }));
  const overview = await page.locator('.overview').boundingBox();
  await page.mouse.click(overview!.x + overview!.width * 0.9, overview!.y + 10);
  await expect.poll(() => page.locator('.timeline-scroll').evaluate((el) => el.scrollLeft)).toBeGreaterThan(40000);
  await expect(page.locator('.roll-note').first()).toBeVisible();

  // A store edit on this size of song must stay well inside one frame.
  const editMs = await page.evaluate(() => {
    const state = window.__SKY_MUSIC_STUDIO__!.store.getState();
    const id = state.activeTrack().notes[2500].id;
    const started = performance.now();
    for (let i = 0; i < 20; i++) state.dragSelectedNotes({ [id]: { startBeat: 600, pad: 2 } }, i, 0);
    return (performance.now() - started) / 20;
  });
  expect(editMs).toBeLessThan(8);

  const frames = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const { playback } = window.__SKY_MUSIC_STUDIO__!;
        void playback.play().then(() => {
          let count = 0;
          const started = performance.now();
          const frame = () => {
            count++;
            if (performance.now() - started < 1500) requestAnimationFrame(frame);
            else {
              playback.stop();
              resolve(count / 1.5);
            }
          };
          requestAnimationFrame(frame);
        });
      }),
  );
  expect(frames).toBeGreaterThan(30);
  expect(errors).toEqual([]);
});

for (const [width, height] of [[1920, 1080], [1440, 900], [1180, 720], [1024, 700]]) {
  test(`9: the editor fits at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await boot(page);
    await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().newProject({ demo: true }));
    await expect(page.locator('.roll-note').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    for (const selector of ['.studio-bar', '.editor-toolbar', '.status-bar', '.key-panel']) {
      const box = await page.locator(selector).boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(height);
    }
    const fits = await page.locator('.editor-toolbar').evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(fits).toBe(true);
  });
}

test('10: older saved songs still open and play', async ({ page }) => {
  const errors = await boot(page);
  const legacy = {
    title: 'Old song',
    schemaVersion: 0,
    bpm: 100,
    timeSignature: [3, 4],
    key: 0,
    tracks: [
      {
        id: 't1',
        name: 'Old piano',
        instrumentId: 'piano-keyboard',
        color: '#ff0000',
        volume: 0.7,
        muted: false,
        solo: false,
        notes: [{ id: 'a', pad: 3, startBeat: 1, durationBeats: 0.5, velocity: 0.9 }],
      },
    ],
  };
  const ok = await page.evaluate(
    (text) => window.__SKY_MUSIC_STUDIO__!.store.getState().importProjectJson(text),
    JSON.stringify(legacy),
  );
  expect(ok).toBe(true);
  await expect(page.locator('.project-title')).toHaveValue('Old song');
  await expect(page.locator('.roll-note')).toHaveCount(1);
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  await page.keyboard.press('Shift+Space');
  expect(errors).toEqual([]);
});

test('3: Alt-drag copies notes and one undo removes the copy', async ({ page }) => {
  const errors = await boot(page);
  await clickCell(page, 0, 3);
  await page.mouse.move(10, 10);
  const from = await cell(page, 0, 3);
  const to = await cell(page, 2, 3);
  await page.keyboard.down('Alt');
  await drag(page, { x: from.x + 8, y: from.y }, to);
  await page.keyboard.up('Alt');
  expect(await store<number[]>(page, 's.activeTrack().notes.map((n) => n.startBeat)')).toEqual([0, 2]);
  await page.keyboard.press('Control+z');
  expect(await noteCount(page)).toBe(1);
  expect(errors).toEqual([]);
});

test('8: wheel zoom holds the beat under the pointer, and playback follows the view', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().newProject({ demo: true }));
  await page.locator('.roll-note').first().waitFor();
  const grid = await page.locator('.timeline-scroll').boundingBox();
  const pointerX = grid!.x + 700;
  await page.mouse.move(pointerX, grid!.y + 200);
  await page.locator('.timeline-scroll').evaluate((el) => (el.scrollLeft = 900));
  await page.waitForTimeout(100);
  const beatUnderPointer = () =>
    page.evaluate((x) => {
      const box = document.querySelector('.roll-grid')!.getBoundingClientRect();
      return (x - box.left) / window.__SKY_MUSIC_STUDIO__!.store.getState().preferences.zoom;
    }, pointerX);
  const before = await beatUnderPointer();
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -240);
  await page.keyboard.up('Control');
  await page.waitForTimeout(150);
  expect(Math.abs((await beatUnderPointer()) - before)).toBeLessThan(0.05);

  await page.evaluate(() => {
    const { store, playback } = window.__SKY_MUSIC_STUDIO__!;
    store.getState().setPreferences({ zoom: 200 });
    store.getState().setBpm(240);
    playback.seek(0);
  });
  await page.waitForTimeout(100);
  const start = await page.locator('.timeline-scroll').evaluate((el) => el.scrollLeft);
  await page.keyboard.press('Space');
  await page.waitForTimeout(4000);
  await page.keyboard.press('Space');
  const end = await page.locator('.timeline-scroll').evaluate((el) => el.scrollLeft);
  expect(end).toBeGreaterThan(start + 400);
  expect(errors).toEqual([]);
});

test('instrument lines can be removed directly and restored with undo', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => {
    const state = window.__SKY_MUSIC_STUDIO__!.store.getState();
    state.addNote(3, 0, 0.5);
    state.addTrack('light-guitar');
    state.addNote(2, 0, 1);
    state.addTrack('cello');
    state.addNote(1, 0, 2);
  });
  const names = await store<string[]>(page, 's.project.tracks.map((track) => track.name)');
  const active = page.locator('.track-active-head');
  await active.getByRole('button', { name: `Remove ${names[2]}`, exact: true }).click();
  expect(await store<number>(page, 's.project.tracks.length')).toBe(2);
  await page.keyboard.press('Control+z');
  expect(await store<number[]>(page, 's.project.tracks.map((track) => track.notes.length)')).toEqual([1, 1, 1]);

  // A collapsed lane shows its remove button on hover, leaving room for the name.
  const collapsed = page.locator('.track-lane').filter({ has: page.getByRole('button', { name: `Mute ${names[0]}`, exact: true }) });
  await expect(collapsed.getByRole('button', { name: `Remove ${names[0]}`, exact: true })).toBeHidden();
  await collapsed.hover();
  await collapsed.getByRole('button', { name: `Remove ${names[0]}`, exact: true }).click();
  expect(await store<number>(page, 's.project.tracks.length')).toBe(2);
  await page.keyboard.press('Control+z');
  expect(await store<number[]>(page, 's.project.tracks.map((track) => track.notes.length)')).toEqual([1, 1, 1]);

  const lane = (name: string) => page.locator('.track-lane').filter({ has: page.getByRole('button', { name: `Mute ${name}`, exact: true }) });
  await lane(names[2]).hover();
  await page.getByRole('button', { name: `Remove ${names[2]}`, exact: true }).click();
  await lane(names[0]).hover();
  await page.getByRole('button', { name: `Remove ${names[0]}`, exact: true }).click();
  await expect(page.getByRole('button', { name: `Remove ${names[1]}`, exact: true })).toBeDisabled();
  expect(await store<number>(page, 's.project.tracks.length')).toBe(1);
  expect(errors).toEqual([]);
});

test('instrument pictures load from the app itself in a production build', async ({ page }) => {
  const responses: { url: string; status: number }[] = [];
  page.on('response', (response) => responses.push({ url: response.url(), status: response.status() }));
  await boot(page);
  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().newProject({ demo: true }));
  await expect(page.locator('.instrument-icon').first()).toBeVisible();
  await expect.poll(() => responses.filter((item) => item.url.includes('/instrument-icons/')).length).toBeGreaterThan(3);
  for (const item of responses.filter((entry) => entry.url.includes('/instrument-icons/'))) {
    expect(item.url.startsWith('http://127.0.0.1:4188/')).toBe(true);
    expect(item.status).toBeLessThan(400);
  }
  expect(responses.filter((item) => item.url.includes('__local-packs'))).toEqual([]);
});

test('Escape cancels editing the title, a track name and the tempo', async ({ page }) => {
  const errors = await boot(page);
  const title = page.locator('.project-title');
  await title.fill('Thrown away');
  await title.press('Escape');
  await expect(title).toHaveValue('Untitled Song');
  expect(await store<string>(page, 's.project.title')).toBe('Untitled Song');

  const bpm = page.getByLabel('Tempo in beats per minute');
  await bpm.fill('150');
  await bpm.press('Escape');
  await bpm.fill('');
  await bpm.press('Enter');
  await expect(bpm).toHaveValue('90');
  expect(await store<number>(page, 's.project.bpm')).toBe(90);

  await page.getByRole('button', { name: 'Mix' }).click();
  const name = page.locator('.track-name-input').first();
  await name.fill('Thrown away');
  await name.press('Escape');
  await expect(name).toHaveValue('Harp · Performer');
  expect(await store<string>(page, 's.project.tracks[0].name')).toBe('Harp · Performer');
  expect(errors).toEqual([]);
});

test('End goes to the end of the longest note, and a new song starts from the top', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => {
    const state = window.__SKY_MUSIC_STUDIO__!.store.getState();
    state.setTrackInstrument(state.project.tracks[0].id, 'cello');
    state.addNote(0, 0, 12);
    state.addNote(1, 4, 1);
    state.clearSelection();
  });
  await expect(page.locator('.instrument-pick')).toContainText('Cello · Performer');
  await page.keyboard.press('End');
  const position = () => page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.playback.position());
  expect(await position()).toBe(12);

  await page.keyboard.press('Home');
  await page.keyboard.press('Space');
  await expect.poll(() => store<boolean>(page, 's.isPlaying')).toBe(true);
  await expect.poll(position).toBeGreaterThan(1);
  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().newProject({ demo: true }));
  expect(await store<boolean>(page, 's.isPlaying')).toBe(false);
  expect(await position()).toBe(0);
  await expect(page.locator('.time-readout .clock')).toHaveText('0:00');
  expect(errors).toEqual([]);
});

test('dropping a MIDI or project file on the window opens it', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().newProject({ demo: true }));
  const demo = await store<number[]>(page, 's.project.tracks.map((t) => t.notes.length)');
  await page.getByRole('button', { name: 'Export' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export MIDI' }).click();
  const midi = readFileSync(await (await download).path());
  await page.keyboard.press('Escape');
  const json = await store<string>(page, 's.exportProjectJson()');
  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().newProject());

  const drop = async (name: string, type: string, bytes: number[]) => {
    const transfer = await page.evaluateHandle(({ name, type, bytes }) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], name, { type }));
      return data;
    }, { name, type, bytes });
    await page.dispatchEvent('.timeline', 'dragenter', { dataTransfer: transfer });
    await expect(page.locator('.file-drop')).toBeVisible();
    await page.dispatchEvent('.timeline', 'dragover', { dataTransfer: transfer });
    await page.dispatchEvent('.timeline', 'drop', { dataTransfer: transfer });
    await expect(page.locator('.file-drop')).toHaveCount(0);
  };

  await drop('dropped tune.mid', 'audio/midi', [...midi]);
  await expect(page.locator('.project-title')).toHaveValue('dropped tune');
  expect(await store<number[]>(page, 's.project.tracks.map((t) => t.notes.length)')).toEqual(demo);

  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().newProject());
  await drop('Lanterns.skymusic.json', 'application/json', [...Buffer.from(json)]);
  await expect(page.locator('.project-title')).toHaveValue('Lanterns Over the Valley');

  await drop('photo.png', 'image/png', [1, 2, 3]);
  await expect(page.locator('.toast')).toContainText('not a song file');
  await expect(page.locator('.project-title')).toHaveValue('Lanterns Over the Valley');
  expect(errors).toEqual([]);
});

test('Import in the top bar opens a saved song as well as MIDI', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().newProject({ demo: true }));
  const json = await store<string>(page, 's.exportProjectJson()');
  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().newProject());
  await page.setInputFiles('input[aria-label="Import song or MIDI"]', {
    name: 'lanterns.skymusic.json',
    mimeType: 'application/json',
    buffer: Buffer.from(json),
  });
  await expect(page.locator('.project-title')).toHaveValue('Lanterns Over the Valley');
  expect(await store<number>(page, 's.project.tracks.length')).toBe(6);
  expect(errors).toEqual([]);
});

test('the selection bar shows every action, and a blank new song waits for an edit before saving', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().newProject({ demo: true }));
  await page.keyboard.press('2');
  await page.keyboard.press('Control+a');
  const done = page.locator('.selection-bar').getByRole('button', { name: 'Clear selection' });
  await expect(done).toBeVisible();
  const [bar, button] = await Promise.all([page.locator('.selection-bar').boundingBox(), done.boundingBox()]);
  expect(button!.x + button!.width).toBeLessThanOrEqual(bar!.x + bar!.width);

  const titles = async () => {
    await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().refreshLibrary());
    return (await store<string[]>(page, 's.library.map((entry) => entry.title)')).sort();
  };
  await expect.poll(titles).toEqual(['Lanterns Over the Valley']);
  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().newProject());
  await page.waitForTimeout(1200);
  expect(await titles()).toEqual(['Lanterns Over the Valley']);
  await page.keyboard.press('1');
  await clickCell(page, 0, 0);
  expect(await noteCount(page)).toBe(1);
  await expect.poll(titles).toEqual(['Lanterns Over the Valley', 'Untitled Song']);
  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().newProject());
  await expect(page.locator('.project-title')).toHaveValue('Untitled Song 2');
  expect(errors).toEqual([]);
});
