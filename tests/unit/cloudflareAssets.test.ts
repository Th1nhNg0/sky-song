import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { prepareCloudflareAssets } from '../../scripts/cloudflareAssets';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true }); });

test('oversized packs split below the asset limit and preserve all samples in order', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-assets-'));
  directories.push(directory);
  const pack = { id: 'voice', updatedAt: '2026-11-01', samples: Array.from({ length: 8 }, (_, i) => ({ id: i, data: 'abc'.repeat(80) })) };
  const file = 'voice.skypack.json';
  fs.writeFileSync(path.join(directory, file), JSON.stringify(pack));
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify([{ id: pack.id, updatedAt: pack.updatedAt, file }]));
  prepareCloudflareAssets(directory, 1024);
  const [entry] = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  expect(entry.file).toBeUndefined();
  expect(entry.parts.length).toBeGreaterThan(1);
  expect(fs.existsSync(path.join(directory, file))).toBe(false);
  const samples = entry.parts.flatMap((part: string) => {
    const content = fs.readFileSync(path.join(directory, part), 'utf8');
    expect(Buffer.byteLength(content)).toBeLessThanOrEqual(1024);
    const chunk = JSON.parse(content);
    expect(chunk.id).toBe(pack.id);
    return chunk.samples;
  });
  expect(samples).toEqual(pack.samples);
  prepareCloudflareAssets(directory, 1024); // Re-running leaves an already split manifest usable.
  expect(JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'))[0]).toEqual(entry);
});
