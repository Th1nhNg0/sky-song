import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { defaultSampleId, writeCompactAudio } from '../src/audio/compactPack';
import type { PackFile } from '../src/audio/soundPack';
import { MAX_ASSET_BYTES } from './cloudflareAssets';

interface ManifestEntry {
  id: string;
  updatedAt: string;
  instrumentId?: string;
  file?: string;
  parts?: string[];
  audio?: string;
  pack?: { name: string; notes: string; createdAt: string; sampleIds?: string[] };
}

/** One channel of a pack file's 16-bit audio. */
function pcm16(base64: string): Int16Array {
  const bytes = Buffer.from(base64, 'base64');
  const samples = new Int16Array(bytes.length >> 1);
  for (let i = 0; i < samples.length; i++) samples[i] = bytes.readInt16LE(i * 2);
  return samples;
}

/**
 * Rewrites a build's `.skypack.json` files as `.skyaudio` files, which hold the same
 * audio in about a third of the space, and points the manifest at them. A file is named
 * after its contents, so instruments that play the same recordings share one. The
 * repository's packs are left as they are; only the built copies change.
 */
export function compactSoundPacks(directory: string, maxBytes = MAX_ASSET_BYTES): void {
  const manifestPath = path.join(directory, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ManifestEntry[];
  for (const entry of manifest) {
    // The app only reads a packed file for an entry that names its instrument.
    if (!entry.file || !entry.instrumentId) continue;
    const original = path.join(directory, entry.file);
    const pack = JSON.parse(fs.readFileSync(original, 'utf8')) as PackFile;
    const bytes = writeCompactAudio(
      pack.samples.map(({ id: _id, data, ...details }) => {
        const channels = (data ?? []).slice(0, 2).map(pcm16);
        if (channels.length === 0) throw new Error(`A sample in ${entry.file} has no audio data.`);
        const frames = Math.min(...channels.map((channel) => channel.length));
        return { details, channels: channels.map((channel) => channel.subarray(0, frames)) };
      }),
    );
    // Too large to deploy as one file: leave the JSON for the step that splits it.
    if (bytes.length > maxBytes) continue;
    const audio = `samples-${crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 20)}.skyaudio`;
    fs.writeFileSync(path.join(directory, audio), bytes);
    fs.unlinkSync(original);
    const plainIds = pack.samples.every((sample, index) => sample.id === defaultSampleId(pack.id, index));
    entry.audio = audio;
    entry.pack = {
      name: pack.name,
      notes: pack.notes,
      createdAt: pack.createdAt,
      ...(plainIds ? {} : { sampleIds: pack.samples.map((sample) => sample.id) }),
    };
    delete entry.file;
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
}
