import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { createDemoProject } from './fixtures/demoProject';

// A phone: a narrow window driven by a finger. Touches go through Chromium's own input
// pipeline, so a drag really scrolls and really cancels the pointer that started it.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

type Point = { x: number; y: number };

const store = <T>(page: Page, read: string) =>
  page.evaluate(`(() => { const s = window.__SKY_MUSIC_STUDIO__.store.getState(); return ${read}; })()`) as Promise<T>;
const notes = (page: Page) => store<[number, number][]>(page, 's.activeTrack().notes.map((n) => [n.pad, n.startBeat])');
const selected = (page: Page) => store<number>(page, 's.selectedNoteIds.length');
const scrollLeft = (page: Page) => page.locator('.timeline-scroll').evaluate((element) => element.scrollLeft);

async function boot(page: Page) {
  await page.route('**/sound-packs/manifest.json', (route) => route.fulfill({ json: [] }));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__SKY_MUSIC_STUDIO__);
  await page.evaluate(() => {
    const { store: app } = window.__SKY_MUSIC_STUDIO__!;
    app.getState().finishOnboarding();
    app.getState().newProject();
  });
  await expect(page.locator('.roll-grid')).toBeVisible();
  return errors;
}

const loadDemo = (page: Page) =>
  page.evaluate((json) => {
    window.__SKY_MUSIC_STUDIO__!.store.getState().importProjectJson(json);
  }, JSON.stringify(createDemoProject()));

/** How far inside a cell a touch lands, so it is clear of the cell's left edge. */
const INSET = 10;

/** A touch point on a beat of a pad row of the open track. */
async function cell(page: Page, beat: number, pad: number): Promise<Point> {
  const [box, px, rows, scrolled] = await Promise.all([
    page.locator('.roll-grid').boundingBox(),
    store<number>(page, 's.preferences.zoom'),
    page.locator('.roll-label').count(),
    scrollLeft(page),
  ]);
  // The grid's box is clipped to what is on screen once the timeline has scrolled.
  const labels = (await page.locator('.roll-labels').boundingBox())!;
  const left = labels.x + labels.width - scrolled;
  return { x: left + beat * px + INSET, y: box!.y + ((pad + 0.5) * box!.height) / rows };
}

function fingers(client: CDPSession, page: Page) {
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: Point[]) =>
    client.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((point, id) => ({ ...point, id })) });
  const between = (from: Point, to: Point, part: number) => ({ x: from.x + (to.x - from.x) * part, y: from.y + (to.y - from.y) * part });
  return {
    async tap(at: Point) {
      await send('touchStart', [at]);
      await page.waitForTimeout(40);
      await send('touchEnd', []);
      // Longer than a double tap, so two taps in a row stay two taps.
      await page.waitForTimeout(350);
    },
    async drag(from: Point, to: Point, holdMs = 0) {
      await send('touchStart', [from]);
      if (holdMs) await page.waitForTimeout(holdMs);
      for (let step = 1; step <= 8; step++) {
        await send('touchMove', [between(from, to, step / 8)]);
        await page.waitForTimeout(16);
      }
      await send('touchEnd', []);
      await page.waitForTimeout(350);
    },
    async pinch(centre: Point, fromSpread: number, toSpread: number) {
      const at = (spread: number) => [{ x: centre.x - spread / 2, y: centre.y }, { x: centre.x + spread / 2, y: centre.y }];
      await send('touchStart', at(fromSpread));
      for (let step = 1; step <= 8; step++) {
        await send('touchMove', at(fromSpread + ((toSpread - fromSpread) * step) / 8));
        await page.waitForTimeout(16);
      }
      await send('touchEnd', []);
      await page.waitForTimeout(200);
    },
  };
}

for (const [width, height] of [[390, 844], [360, 640], [844, 390]]) {
  test(`the studio fits a phone at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors = await boot(page);
    await loadDemo(page);
    await expect(page.locator('.roll-note').first()).toBeVisible();
    // A first visit on a phone starts with the keys closed, leaving the screen to the notes.
    expect(await store<boolean>(page, 's.preferences.keysOpen')).toBe(false);

    const inside = async (selector: string) => {
      const box = (await page.locator(selector).boundingBox())!;
      expect(box.x, selector).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, selector).toBeLessThanOrEqual(width);
      expect(box.y + box.height, selector).toBeLessThanOrEqual(height);
    };
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    for (const selector of ['.studio-bar', '.editor-toolbar', '.timeline', '.play-button', '.project-title', '.more-button']) {
      await inside(selector);
    }
    // The notes get most of the width: the label column is narrow here.
    const labels = (await page.locator('.roll-labels').boundingBox())!;
    expect(labels.width).toBeLessThan(80);

    // Every tool is in the one row, which scrolls sideways to the last of them.
    const mix = page.locator('.editor-toolbar').getByRole('button', { name: 'Mix' });
    await mix.scrollIntoViewIfNeeded();
    await inside('.editor-toolbar .icon-text-button');
    await page.locator('.editor-toolbar').getByRole('button', { name: 'Keys' }).tap();
    await inside('.key-panel');
    await inside('.key-pad >> nth=-1');

    // What the top bar holds on a desktop is in the menu.
    await page.locator('.more-button').tap();
    await inside('.more-menu');
    const menu = page.locator('.more-menu');
    for (const name of ['Song library', 'My songs', 'Sheet', 'Export']) {
      await expect(menu.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expect(menu.getByLabel('Import song or MIDI')).toBeAttached();
    await expect(menu.getByLabel('Tempo in beats per minute')).toHaveValue('82');
    await menu.getByRole('button', { name: 'Sheet', exact: true }).tap();
    await expect(page.locator('.more-menu')).toBeHidden();
    await expect(page.getByRole('dialog', { name: 'Sheet' })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('a tap places a note, a drag scrolls, and a selected note follows the finger', async ({ page }) => {
  const errors = await boot(page);
  const finger = fingers(await page.context().newCDPSession(page), page);

  await finger.tap(await cell(page, 1, 2));
  expect(await notes(page)).toEqual([[2, 1]]);
  expect(await selected(page)).toBe(1);

  // A drag across empty grid scrolls the song. With a mouse it would draw.
  await finger.drag(await cell(page, 4, 6), await cell(page, 1, 6));
  expect(await scrollLeft(page)).toBeGreaterThan(100);
  expect(await notes(page)).toEqual([[2, 1]]);
  await finger.drag(await cell(page, 5, 6), await cell(page, 9, 6));
  expect(await scrollLeft(page)).toBe(0);

  // The selected note goes with the finger, as one undo step.
  const steps = await store<number>(page, 's.history.past.length');
  await finger.drag(await cell(page, 1, 2), await cell(page, 3, 4));
  expect(await notes(page)).toEqual([[4, 3]]);
  expect(await scrollLeft(page)).toBe(0);
  expect(await store<number>(page, 's.history.past.length')).toBe(steps + 1);

  // Tapping the only selected note lets it go; then a drag that starts on it scrolls.
  await finger.tap(await cell(page, 3, 4));
  expect(await selected(page)).toBe(0);
  await finger.drag(await cell(page, 3, 4), await cell(page, 1, 4));
  expect(await scrollLeft(page)).toBeGreaterThan(60);
  expect(await notes(page)).toEqual([[4, 3]]);
  await finger.drag(await cell(page, 5, 8), await cell(page, 9, 8));

  // Tapping it selects it again, and the selection bar's buttons stay in reach.
  await finger.tap(await cell(page, 3, 4));
  expect(await selected(page)).toBe(1);
  const bar = (await page.locator('.selection-bar').boundingBox())!;
  const remove = page.getByRole('button', { name: 'Delete selected notes' });
  const removeBox = (await remove.boundingBox())!;
  expect(removeBox.x + removeBox.width).toBeLessThanOrEqual(bar.x + bar.width);
  await remove.tap();
  expect(await notes(page)).toEqual([]);

  // With Edit on, a tap on empty grid places nothing.
  await page.getByRole('button', { name: 'Edit', exact: true }).tap();
  await finger.tap(await cell(page, 2, 5));
  expect(await notes(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('a long press starts a box or adds to the selection, and a pinch zooms', async ({ page }) => {
  const errors = await boot(page);
  const finger = fingers(await page.context().newCDPSession(page), page);
  for (const [beat, pad] of [[1, 1], [2, 5], [3, 7]]) await finger.tap(await cell(page, beat, pad));
  await page.evaluate(() => window.__SKY_MUSIC_STUDIO__!.store.getState().clearSelection());

  // Holding still first makes the drag a box; nothing scrolls and nothing is drawn.
  await finger.drag(await cell(page, 1.4, 4.4), await cell(page, 4, 7.6), 600);
  expect(await selected(page)).toBe(2);
  expect(await scrollLeft(page)).toBe(0);
  expect((await notes(page)).length).toBe(3);

  // A long press on a note adds it to what is selected, and does not delete it.
  const first = await cell(page, 1, 1);
  await finger.drag(first, first, 600);
  expect(await selected(page)).toBe(3);
  expect((await notes(page)).length).toBe(3);

  // Spreading two fingers zooms in around the beat between them, and closing them zooms back.
  const zoom = await store<number>(page, 's.preferences.zoom');
  const between = await cell(page, 3, 10);
  const beatUnder = async () => {
    const start = await cell(page, 0, 10);
    return (between.x - (start.x - INSET)) / (await store<number>(page, 's.preferences.zoom'));
  };
  const beat = await beatUnder();
  await finger.pinch(between, 60, 180);
  expect(await store<number>(page, 's.preferences.zoom')).toBeGreaterThan(zoom * 2);
  expect(Math.abs((await beatUnder()) - beat)).toBeLessThan(0.1);
  await finger.pinch(between, 180, 60);
  expect(await store<number>(page, 's.preferences.zoom')).toBeLessThan(zoom * 1.2);
  expect((await notes(page)).length).toBe(3);
  expect(errors).toEqual([]);
});

test('panels rise as full-width sheets, and the sheet is drawn for the narrow screen', async ({ page }) => {
  const errors = await boot(page);
  await loadDemo(page);
  for (const panel of ['songs', 'catalog', 'tracks', 'settings', 'sheet']) {
    await page.evaluate((kind) => window.__SKY_MUSIC_STUDIO__!.store.getState().setPanel(kind as 'songs'), panel);
    await page.locator('.modal').evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    const box = (await page.locator('.modal').boundingBox())!;
    expect([box.x, box.width, Math.round(box.y + box.height)], panel).toEqual([0, 390, 844]);
    const overflow = await page.locator('.modal-body').evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow, panel).toBeLessThanOrEqual(0);
  }
  // Four frames to a line here, where a printed page has nine.
  const frames = page.locator('.sheet-section svg').first();
  expect(await frames.evaluate((svg: SVGSVGElement) => svg.viewBox.baseVal.width)).toBeLessThan(500);
  const frame = (await frames.locator('[data-frame]').first().boundingBox())!;
  expect(frame.width).toBeGreaterThan(60);
  expect(errors).toEqual([]);
});
