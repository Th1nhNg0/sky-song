import { DEFAULT_REVERB_SPACE, isReverbSpaceId, type ReverbSpaceId } from '../audio/reverb';
import { isCompact } from '../state/layout';
import { clamp, clampNumber } from '../util';

export interface Preferences {
  reverbAmount: number;
  reverbSpace: ReverbSpaceId;
  masterVolume: number;
  metronomeEnabled: boolean;
  countInMeasures: number;
  latencyOffsetMs: number;
  onboardingDone: boolean;
  preserveOriginalTiming: boolean;
  snap: number;
  zoom: number;
  keysOpen: boolean;
  notePreview: boolean;
  stepInput: boolean;
}

const DEFAULT_PREFERENCES: Preferences = {
  reverbAmount: 0.24,
  reverbSpace: DEFAULT_REVERB_SPACE,
  masterVolume: 0.8,
  metronomeEnabled: false,
  countInMeasures: 0,
  latencyOffsetMs: 0,
  onboardingDone: false,
  preserveOriginalTiming: true,
  snap: 0.5,
  zoom: 56,
  keysOpen: true,
  notePreview: true,
  stepInput: false,
};

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 240;

const KEY = 'sky-music-studio:preferences:v1';

function normalizePreferences(raw: unknown): Preferences {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<Preferences>;
  return {
    reverbAmount: clampNumber(source.reverbAmount, 0, 1, DEFAULT_PREFERENCES.reverbAmount),
    reverbSpace: isReverbSpaceId(source.reverbSpace) ? source.reverbSpace : DEFAULT_PREFERENCES.reverbSpace,
    masterVolume: clampNumber(source.masterVolume, 0, 1, DEFAULT_PREFERENCES.masterVolume),
    metronomeEnabled: typeof source.metronomeEnabled === 'boolean' ? source.metronomeEnabled : false,
    countInMeasures:
      typeof source.countInMeasures === 'number' && Number.isInteger(source.countInMeasures)
        ? clamp(source.countInMeasures, 0, 4)
        : DEFAULT_PREFERENCES.countInMeasures,
    latencyOffsetMs: clampNumber(source.latencyOffsetMs, -500, 500, 0),
    onboardingDone: Boolean(source.onboardingDone),
    preserveOriginalTiming: source.preserveOriginalTiming !== false,
    snap: clampNumber(source.snap, 0, 4, DEFAULT_PREFERENCES.snap),
    zoom: clampNumber(source.zoom, MIN_ZOOM, MAX_ZOOM, DEFAULT_PREFERENCES.zoom),
    // Until someone chooses, a phone starts with the keys folded away so the notes have the screen.
    keysOpen: typeof source.keysOpen === 'boolean' ? source.keysOpen : !isCompact(),
    notePreview: source.notePreview !== false,
    stepInput: source.stepInput === true,
  };
}

export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(KEY);
    return normalizePreferences(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizePreferences(null);
  }
}

export function savePreferences(preferences: Preferences): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(preferences));
  } catch {
    // Preferences are non-critical; a full localStorage should not break editing.
  }
}
