/** Core music types for Sky Music Studio. */

export const PROJECT_SCHEMA_VERSION = 1;
export const CATALOG_VERSION = '2026.11.1';

export type SheetPart = 'melody' | 'sub' | 'bass' | 'percussion';
export type Confidence = 'verified' | 'community-reported' | 'inferred';
export type InstrumentStatus = 'playable' | 'approximate' | 'research-pending' | 'special';
type RenderingMode = 'pitched' | 'unpitched' | 'sequencer';

export type PercussionVoiceId =
  | 'drum-low'
  | 'drum-mid'
  | 'drum-high'
  | 'drum-rim'
  | 'drum-snare'
  | 'drum-tom'
  | 'drum-shaker'
  | 'drum-crash'
  | 'drum-kick'
  | 'cymbal-crash'
  | 'cymbal-splash'
  | 'cymbal-china'
  | 'cymbal-ride';

export interface PadLayout {
  rows: number;
  cols: number;
}

export interface PadDefinition {
  /** 0-based physical pad index; the UI displays index + 1. */
  index: number;
  row: number;
  col: number;
  /** 1..15 scale degree for pitched pads; null for unpitched pads. */
  degree: number | null;
  /** Semitones above the key tonic for pitched pads; null for unpitched pads. */
  semitone: number | null;
  pitched: boolean;
  percussionVoice?: PercussionVoiceId;
  /** General MIDI percussion note used for MIDI export of unpitched pads. */
  gmDrum?: number;
  /** Human-readable pad label for unpitched instruments. */
  label?: string;
}

export type SoundProfileId =
  | 'harp'
  | 'piano'
  | 'grand-piano'
  | 'bright-piano'
  | 'guitar'
  | 'electric-guitar'
  | 'ukulele'
  | 'pipa'
  | 'lute'
  | 'kalimba'
  | 'xylophone'
  | 'violin'
  | 'cello'
  | 'contrabass'
  | 'voice'
  | 'horn'
  | 'bugle'
  | 'trumpet'
  | 'flute'
  | 'panflute'
  | 'ocarina'
  | 'saxophone'
  | 'harmonica'
  | 'bell'
  | 'handpan'
  | 'drum'
  | 'cymbal';

export interface InstrumentDefinition {
  id: string;
  displayName: string;
  shortName: string;
  category: string;
  nativeSheetPart: SheetPart;
  /** Native sheet part code (M1..M12, S1..S9, B1..B2, PD/PB/PP/FD). */
  nativePartCode: string;
  keyCount: number;
  padLayout: PadLayout;
  pads: PadDefinition[];
  /** Octave for pad 1's mapping (e.g. 3 = C3 for a C-major harp). */
  baseOctave: number;
  supportsHold: boolean;
  soundProfile: SoundProfileId;
  renderingMode: RenderingMode;
  /** An app-level safety cap only; game limits are not documented. */
  maxHoldBeats: number;
  /** Relative reverb send for this instrument (0..1). */
  reverbSend: number;
  /** Semitone detune of the synth profile, for subtle variation between variants. */
  detuneCents: number;
  evidence: string[];
  confidence: Confidence;
  status: InstrumentStatus;
  aliases: string[];
  notes?: string;
  selectable: boolean;
  accent: string;
}

export interface Note {
  id: string;
  /** Physical pad index, 0-based. */
  pad: number;
  startBeat: number;
  durationBeats: number;
  /** 0..1 performance velocity. */
  velocity: number;
  /** Timing preserved before an explicit quantize, so quantize is reversible. */
  original?: { startBeat: number; durationBeats: number };
}

export interface Track {
  id: string;
  name: string;
  instrumentId: string;
  color: string;
  volume: number;
  muted: boolean;
  solo: boolean;
  notes: Note[];
}

export interface LoopRegion {
  enabled: boolean;
  startBeat: number;
  endBeat: number;
}

export interface Project {
  schemaVersion: number;
  app: 'sky-music-studio';
  catalogVersion: string;
  id: string;
  title: string;
  bpm: number;
  timeSignature: [number, number];
  /** 0..11, C..B major. */
  key: number;
  tracks: Track[];
  loop: LoopRegion;
  createdAt: string;
  updatedAt: string;
}

export interface MusicKey {
  index: number;
  /** Pitch class of the major tonic, 0 = C. */
  tonicPc: number;
  /** Letter index of the tonic (C=0, D=1, ...). */
  tonicLetter: number;
  name: string;
  altName: string;
  accidentals: string;
  /** Letter-name spelling for scale degrees 1..15. */
  degreeNames: string[];
}

export interface ResolvedPad {
  padIndex: number;
  pitched: boolean;
  midi: number | null;
  frequency: number | null;
  /** Note name including octave, e.g. "F♯4". Null for unpitched pads. */
  noteName: string | null;
  /** Scale degree, e.g. 8 for the second tonic. Null for unpitched pads. */
  degree: number | null;
  degreeLabel: string;
  drumNote: number | null;
  label: string;
}

export interface ValidationIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  project?: Project;
}
