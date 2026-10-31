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
