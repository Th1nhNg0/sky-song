/**
 * In-memory bank of the user's sound packs, and the bridge the synth uses to decide
 * between a recorded sample and the original synthesizer.
 *
 * A pack is "active" for an instrument when it is enabled. If several are enabled,
 * the most recently updated one wins. Instruments without an active pack always fall
 * back to the synth; the UI exposes which path is in use.
 *
 * The packs the app ships are large, so each one is read only when its instrument is
 * first needed: a phone opening a four-instrument song fetches four packs, not all of them.
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
  /** Null for a shipped pack that has not been read yet. */
  pack: SoundPack | null;
  sampleCount: number;
}

/** A pack the app ships, as its manifest lists it. */
interface ShippedPack {
  id: string;
  updatedAt: string;
  files: string[];
  /** Named by current manifests. Without it the pack must be read to learn what it plays. */
  instrumentId: string | null;
}

const SHIPPED_BASE = `${import.meta.env.BASE_URL}sound-packs/`;
/** How long a shipped pack that failed to arrive is left alone before another try. */
const RETRY_AFTER_MS = 30_000;

let packs: SoundPack[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
let shipped: ShippedPack[] | null = null;
/** Shipped packs still to be read, by the instrument they play. */
const waiting = new Map<string, ShippedPack[]>();
/** Shipped packs read during this visit. */
const opened = new Set<string>();
const opening = new Map<string, Promise<void>>();
const failedAt = new Map<string, number>();
let version = 0;
const listeners = new Set<() => void>();

const newestFirst = (a: SoundPack, b: SoundPack) => (a.updatedAt < b.updatedAt ? 1 : -1);

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

/**
 * Learns which packs exist and reads the ones that cannot wait: the user's own, and
 * shipped packs whose manifest does not say what they play. Safe to call repeatedly.
 */
export async function ensureSoundPacksLoaded(force = false): Promise<void> {
  if (loaded && !force) return;
  if (loading) return loading;
  loading = (async () => {
    try {
      const storage = getSoundPackStorage();
      const firstVisit = shipped === null;
      if (shipped === null) shipped = typeof window === 'undefined' ? [] : await readManifest();
      const lazy = new Map(shipped.filter((entry) => entry.instrumentId).map((entry) => [entry.id, entry]));
      const available = new Map<string, SoundPack>();
      for (const id of await storage.keys()) {
        // A shipped pack nothing has asked for yet stays on disk.
        if (lazy.has(id) && !opened.has(id)) continue;
        const pack = await storage.load(id);
        if (pack) available.set(id, pack);
      }
      // Fetch these in this promise so the first note cannot race their import
      // and briefly fall back to the synthesizer.
      if (firstVisit) {
        for (const entry of shipped) {
          if (!entry.instrumentId) await readShippedPack(entry, available);
        }
      }
      waiting.clear();
      for (const entry of lazy.values()) {
        if (opened.has(entry.id)) continue;
        const list = waiting.get(entry.instrumentId!) ?? [];
        waiting.set(entry.instrumentId!, [...list, entry]);
      }
      packs = [...available.values()].sort(newestFirst);
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

/**
 * Makes the recordings for these instruments ready to play, fetching the shipped packs
 * that have not been read yet. Resolves once they are in, or have failed and the
 * synthesizer stands in.
 */
export async function ensureSoundsFor(instrumentIds: Iterable<string>): Promise<void> {
  await ensureSoundPacksLoaded();
  const jobs: Promise<void>[] = [];
  for (const instrumentId of new Set(instrumentIds)) {
    for (const entry of waiting.get(instrumentId) ?? []) jobs.push(openShippedPack(entry));
  }
  await Promise.all(jobs);
}

function openShippedPack(entry: ShippedPack): Promise<void> {
  const underWay = opening.get(entry.id);
  if (underWay) return underWay;
  const failed = failedAt.get(entry.id);
  if (failed !== undefined && performance.now() - failed < RETRY_AFTER_MS) return Promise.resolve();
  const job = (async () => {
    const available = new Map<string, SoundPack>();
    const stored = await getSoundPackStorage().load(entry.id);
    if (stored) available.set(entry.id, stored);
    await readShippedPack(entry, available);
    const pack = available.get(entry.id);
    if (!pack) {
      failedAt.set(entry.id, performance.now());
      return;
    }
    failedAt.delete(entry.id);
    opened.add(entry.id);
    const rest = (waiting.get(entry.instrumentId!) ?? []).filter((item) => item.id !== entry.id);
    if (rest.length) waiting.set(entry.instrumentId!, rest);
    else waiting.delete(entry.instrumentId!);
    packs = [...packs.filter((item) => item.id !== pack.id), pack].sort(newestFirst);
    notify();
  })().finally(() => opening.delete(entry.id));
  opening.set(entry.id, job);
  return job;
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
  // A shipped pack that has not been read yet still counts: it is what the instrument will play.
  const coming = !pack && waiting.has(instrumentId);
  return {
    kind: pack || coming ? 'sample' : 'synth',
    pack,
    sampleCount: pack?.samples.length ?? 0,
  };
}

// In the browser, learn which packs exist as soon as the module is imported so the UI
// and the engine agree about the active source before the first note.
if (typeof window !== 'undefined') {
  void ensureSoundPacksLoaded();
}

/** Lists the packs shipped with this build, in dev and built previews alike. */
async function readManifest(): Promise<ShippedPack[]> {
  try {
    const response = await fetch(`${SHIPPED_BASE}manifest.json`, { cache: 'no-cache' });
    if (!response.ok) return [];
    const manifest = (await response.json()) as {
      id: string;
      updatedAt: string;
      instrumentId?: string;
      file?: string;
      parts?: string[];
    }[];
    if (!Array.isArray(manifest)) return [];
    const entries: ShippedPack[] = [];
    for (const entry of manifest) {
      // Only filenames on this app's origin are allowed, including when hosted
      // below a subdirectory. A manifest cannot redirect a pack request elsewhere.
      if (!entry || typeof entry.id !== 'string' || typeof entry.updatedAt !== 'string') continue;
      const files = Array.isArray(entry.parts) ? entry.parts : [entry.file];
      if (!files.length || !files.every((file) => typeof file === 'string' && /^[\w-]+\.skypack\.json$/.test(file))) continue;
      entries.push({
        id: entry.id,
        updatedAt: entry.updatedAt,
        files: files as string[],
        instrumentId: typeof entry.instrumentId === 'string' ? entry.instrumentId : null,
      });
    }
    return entries;
  } catch (error) {
    console.warn('Could not load the project sound-pack manifest.', error);
    return [];
  }
}

/**
 * Puts a shipped pack into `available`, from the copy already in this browser or, when
 * that is missing or older, from the app's own files. A failure leaves `available` alone.
 */
async function readShippedPack(entry: ShippedPack, available: Map<string, SoundPack>): Promise<void> {
  const existing = available.get(entry.id);
  if (existing && existing.updatedAt >= entry.updatedAt) return;
  try {
    let pack: SoundPack | null = null;
    for (const filename of entry.files) {
      const file = await fetch(`${SHIPPED_BASE}${filename}?v=${encodeURIComponent(entry.updatedAt)}`);
      if (!file.ok) throw new Error(`Could not load ${filename}`);
      const part = packFromJson(await file.text());
      if (part.id !== entry.id || part.updatedAt !== entry.updatedAt) throw new Error(`Pack metadata mismatch: ${filename}`);
      if (entry.instrumentId && part.instrumentId !== entry.instrumentId) throw new Error(`Pack instrument mismatch: ${filename}`);
      if (pack) pack.samples.push(...part.samples);
      else pack = part;
    }
    if (!pack) return;
    if (existing) pack.enabled = existing.enabled;
    available.set(pack.id, pack);
    // A quota failure must not discard a usable pack for this session.
    await getSoundPackStorage().save(pack);
  } catch (error) {
    console.warn('Could not cache a project sound pack.', error);
  }
}
