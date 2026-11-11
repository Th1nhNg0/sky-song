/**
 * In-memory bank of the user's sound packs, and the bridge the synth uses to decide
 * between a recorded sample and the original synthesizer.
 *
 * A pack is "active" for an instrument when it is enabled. If several are enabled,
 * the most recently updated one wins. Instruments without an active pack always fall
 * back to the synth; the UI exposes which path is in use.
 */

import { getSoundPackStorage } from '../storage/soundPacks';
import { reverbSendLevel } from './graph';
import {
  packFromJson,
  nearestSample,
  playbackRateFor,
  sampleForPad,
  type PackSample,
  type SoundPack,
} from './soundPack';

export interface SampleSelection {
  pack: SoundPack;
  sample: PackSample;
  /** Requested MIDI note (null for unpitched pads). */
  targetMidi: number | null;
  /** 1 means the recording is played at its original pitch. */
  playbackRate: number;
}

export interface SoundSourceInfo {
  kind: 'sample' | 'synth';
  pack: SoundPack | null;
  sampleCount: number;
}

let packs: SoundPack[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
let projectPacksChecked = false;
let version = 0;
const listeners = new Set<() => void>();

function notify(): void {
  version += 1;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A bad listener must not break playback.
    }
  }
}

export function subscribeSoundBank(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSoundBankVersion(): number {
  return version;
}

export function getLoadedSoundPacks(): readonly SoundPack[] {
  return packs;
}

/** Loads every stored pack into memory. Safe to call repeatedly. */
export async function ensureSoundPacksLoaded(force = false): Promise<void> {
  if (loaded && !force) return;
  if (loading) return loading;
  loading = (async () => {
    try {
      const storage = getSoundPackStorage();
      let stored = await storage.loadAll();
      // Include project packs in this promise so the first note cannot race
      // their import and briefly fall back to the synthesizer.
      if (typeof window !== 'undefined' && !projectPacksChecked) {
        stored = await syncProjectSoundPacks(stored);
        projectPacksChecked = true;
      }
      packs = stored.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    } catch {
      packs = [];
    } finally {
      loaded = true;
      loading = null;
      notify();
    }
  })();
  return loading;
}

/** Re-reads storage after the user saves or deletes a pack. */
export async function refreshSoundPacks(): Promise<void> {
  loaded = false;
  await ensureSoundPacksLoaded(true);
}

/**
 * Saves a pack as the only one that can be active for its instrument: every other enabled
 * pack for that instrument is switched off first, so "newest enabled" has one answer.
 */
export async function saveExclusivePack(pack: SoundPack): Promise<void> {
  const storage = getSoundPackStorage();
  for (const other of await storage.loadAll()) {
    if (other.id !== pack.id && other.instrumentId === pack.instrumentId && other.enabled) {
      await storage.save({ ...other, enabled: false });
    }
  }
  await storage.save(pack);
  await refreshSoundPacks();
}

function activePackFor(instrumentId: string): SoundPack | null {
  for (const pack of packs) {
    if (pack.instrumentId === instrumentId && pack.enabled) return pack;
  }
  return null;
}

/** Real game samples carry their own tone, so they only get a trace of the app's reverb. */
export function trackSendLevel(reverbAmount: number, instrument: { id: string; reverbSend: number }): number {
  const level = reverbSendLevel(reverbAmount, instrument.reverbSend);
  return activePackFor(instrument.id) ? level * 0.15 : level;
}

/**
 * Chooses the recorded sample for a note. Pitched instruments use the nearest
 * recorded MIDI note and pitch-shift it; unpitched instruments use an explicit pad
 * assignment because pitch is meaningless for drums.
 */
export function resolveSampleForNote(
  instrumentId: string,
  targetMidi: number | null,
  padIndex: number,
): SampleSelection | null {
  const pack = activePackFor(instrumentId);
  if (!pack || pack.samples.length === 0) return null;
  if (targetMidi !== null) {
    const sample = nearestSample(pack, targetMidi);
    if (!sample) return null;
    return {
      pack,
      sample,
      targetMidi,
      playbackRate: playbackRateFor(sample, targetMidi),
    };
  }
  const sample = sampleForPad(pack, padIndex);
  if (!sample) return null;
  return { pack, sample, targetMidi: null, playbackRate: 1 };
}

export function soundSourceInfo(instrumentId: string): SoundSourceInfo {
  const pack = activePackFor(instrumentId);
  return {
    kind: pack ? 'sample' : 'synth',
    pack,
    sampleCount: pack?.samples.length ?? 0,
  };
}

// In the browser, load packs as soon as the module is imported so the UI and the
// engine agree about the active source before the first note.
if (typeof window !== 'undefined') {
  void ensureSoundPacksLoaded();
}

/** Imports this checkout's personal packs in both dev and built previews. */
async function syncProjectSoundPacks(stored: SoundPack[]): Promise<SoundPack[]> {
  const available = new Map(stored.map((pack) => [pack.id, pack]));
  const base = `${import.meta.env.BASE_URL}sound-packs/`;
  try {
    const response = await fetch(`${base}manifest.json`, { cache: 'no-cache' });
    if (!response.ok) return stored;
    const manifest = (await response.json()) as { id: string; updatedAt: string; file?: string; parts?: string[] }[];
    if (!Array.isArray(manifest)) return stored;
    for (const entry of manifest) {
      // Only filenames on this app's origin are allowed, including when hosted
      // below a subdirectory. A manifest cannot redirect a pack request elsewhere.
      if (!entry || typeof entry.id !== 'string' || typeof entry.updatedAt !== 'string') continue;
      const files = Array.isArray(entry.parts) ? entry.parts : [entry.file];
      if (!files.length || !files.every((file) => typeof file === 'string' && /^[\w-]+\.skypack\.json$/.test(file))) continue;
      const existing = available.get(entry.id);
      if (existing && existing.updatedAt >= entry.updatedAt) continue;
      try {
        let pack: SoundPack | null = null;
        for (const filename of files) {
          const file = await fetch(`${base}${filename}?v=${encodeURIComponent(entry.updatedAt)}`);
          if (!file.ok) throw new Error(`Could not load ${filename}`);
          const part = packFromJson(await file.text());
          if (part.id !== entry.id || part.updatedAt !== entry.updatedAt) throw new Error(`Pack metadata mismatch: ${filename}`);
          if (pack) pack.samples.push(...part.samples);
          else pack = part;
        }
        if (!pack) continue;
        if (existing) pack.enabled = existing.enabled;
        available.set(pack.id, pack);
        // A quota failure must not discard a usable pack for this session.
        await getSoundPackStorage().save(pack);
      } catch (error) {
        console.warn('Could not cache a project sound pack.', error);
      }
    }
  } catch (error) {
    console.warn('Could not load the project sound-pack manifest.', error);
  }
  return [...available.values()];
}
