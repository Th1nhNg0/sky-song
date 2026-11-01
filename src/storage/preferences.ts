export interface Preferences {
  reverbAmount: number;
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
    masterVolume: clampNumber(source.masterVolume, 0, 1, DEFAULT_PREFERENCES.masterVolume),
    metronomeEnabled: typeof source.metronomeEnabled === 'boolean' ? source.metronomeEnabled : false,
    countInMeasures:
      typeof source.countInMeasures === 'number' && Number.isInteger(source.countInMeasures)
        ? Math.min(4, Math.max(0, source.countInMeasures))
        : DEFAULT_PREFERENCES.countInMeasures,
    latencyOffsetMs: clampNumber(source.latencyOffsetMs, -500, 500, 0),
    onboardingDone: Boolean(source.onboardingDone),
    preserveOriginalTiming: source.preserveOriginalTiming !== false,
    snap: clampNumber(source.snap, 0, 4, DEFAULT_PREFERENCES.snap),
    zoom: clampNumber(source.zoom, MIN_ZOOM, MAX_ZOOM, DEFAULT_PREFERENCES.zoom),
    keysOpen: source.keysOpen !== false,
    notePreview: source.notePreview !== false,
    stepInput: source.stepInput === true,
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return normalizePreferences(DEFAULT_PREFERENCES);
    return normalizePreferences(JSON.parse(raw));
  } catch {
    return normalizePreferences(DEFAULT_PREFERENCES);
  }
}

export function savePreferences(preferences: Preferences): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(preferences));
  } catch {
    // Preferences are non-critical; a full localStorage should not break editing.
  }
}
