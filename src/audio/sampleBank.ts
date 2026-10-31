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
      const stored = await storage.loadAll();
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
// engine agree about the active source before the first note. Node tests use the
// explicit test seam below and never touch browser storage.
if (typeof window !== 'undefined') {
  void ensureSoundPacksLoaded().then(() => (import.meta.env.DEV ? syncLocalGamePacks() : undefined));
}

/** Dev only: copies new or rebuilt packs from the owner's local folder into the browser. */
async function syncLocalGamePacks(): Promise<void> {
  const response = await fetch('/__local-packs/manifest.json');
  if (!response.ok) return;
  const manifest = (await response.json()) as { id: string; updatedAt: string; file: string }[];
  const storage = getSoundPackStorage();
  let changed = false;
  for (const entry of manifest) {
    if (packs.some((pack) => pack.id === entry.id && pack.updatedAt === entry.updatedAt)) continue;
    const file = await fetch(`/__local-packs/${entry.file}`);
    if (!file.ok) continue;
    await storage.save(packFromJson(await file.text()));
    changed = true;
  }
  if (changed) await refreshSoundPacks();
}
