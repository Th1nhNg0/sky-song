import { create } from 'zustand';

interface ClockState {
  playhead: number;
  setPlayhead: (beat: number) => void;
}

/** High-frequency playhead store, kept separate so note grids do not re-render every frame. */
export const useClockStore = create<ClockState>()((set) => ({
  playhead: 0,
  setPlayhead: (playhead) => set({ playhead }),
}));

interface AudioState {
  status: 'locked' | 'starting' | 'ready' | 'error';
  message: string | null;
  setStatus: (status: AudioState['status'], message?: string | null) => void;
}

export const useAudioStore = create<AudioState>()((set) => ({
  status: 'locked',
  message: null,
  setStatus: (status, message = null) => set({ status, message }),
}));

export const LABEL_WIDTH = 196;

interface TimelineNavigation {
  zoomTo(px: number, anchorClientX?: number): void;
  zoomToFit(): void;
  scrollToBeat(beat: number): void;
}

interface ViewState {
  scrollLeft: number;
  /** Width of the visible note area, excluding the track header column. */
  viewWidth: number;
  totalBeats: number;
  hover: { beat: number; pad: number | null } | null;
  navigation: TimelineNavigation | null;
}

/** Scroll position and pointer readout, separate so scrolling never re-renders the editor. */
export const useViewStore = create<ViewState>()(() => ({
  scrollLeft: 0,
  viewWidth: 800,
  totalBeats: 32,
  hover: null,
  navigation: null,
}));
