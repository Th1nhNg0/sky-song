import fs from 'node:fs';
import path from 'node:path';

export const MAX_ASSET_BYTES = 24 * 1024 * 1024;

interface ManifestEntry {
  id: string;
  updatedAt: string;
  file?: string;
  parts?: string[];
}

/** Split oversized built packs without changing any recorded sample data. */
export function prepareCloudflareAssets(directory: string, maxBytes = MAX_ASSET_BYTES): void {
  const manifestPath = path.join(directory, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ManifestEntry[];
  for (const entry of manifest) {
    if (!entry.file) continue;
    const original = path.join(directory, entry.file);
    if (fs.statSync(original).size <= maxBytes) continue;
    const pack = JSON.parse(fs.readFileSync(original, 'utf8')) as { samples: unknown[]; [key: string]: unknown };
    const overhead = Buffer.byteLength(JSON.stringify({ ...pack, samples: [] }));
    const groups: unknown[][] = [];
    let group: unknown[] = [];
    let bytes = overhead;
    for (const sample of pack.samples) {
      const size = Buffer.byteLength(JSON.stringify(sample));
      if (overhead + size > maxBytes) throw new Error(`A sample in ${entry.file} exceeds the asset limit.`);
      if (group.length && bytes + size + 1 > maxBytes) {
        groups.push(group);
        group = [];
        bytes = overhead;
      }
      bytes += size + (group.length ? 1 : 0);
      group.push(sample);
    }
    if (group.length) groups.push(group);
    entry.parts = groups.map((samples, index) => {
      const filename = entry.file!.replace(/\.skypack\.json$/, `-part-${index + 1}.skypack.json`);
      const content = JSON.stringify({ ...pack, samples });
      if (Buffer.byteLength(content) > maxBytes) throw new Error(`Oversized pack part: ${filename}`);
      fs.writeFileSync(path.join(directory, filename), content);
      return filename;
    });
    fs.unlinkSync(original);
    delete entry.file;
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
}
