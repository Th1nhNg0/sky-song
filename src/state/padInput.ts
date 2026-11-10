import { getInstrument } from '../music/instruments';
import { snapBeat } from '../music/time';
import { playback } from './playback';
import { useAppStore } from './store';

/** Sounds a pad and, with step input on, writes it into the song. */
export function pressPad(pad: number): void {
  const state = useAppStore.getState();
  const track = state.activeTrack();
  const instrument = getInstrument(track.instrumentId);
  void playback.previewPad(instrument.id, pad, 0.85, !state.isPlaying);
  if (!state.preferences.stepInput) return;
  const step = state.preferences.snap || 0.25;
  const cursor = playback.position();
  const beat = snapBeat(cursor, step);
  state.addNote(pad, beat, instrument.supportsHold ? Math.max(1, step) : 0.5, { select: false });
  if (!state.isPlaying) playback.seek(beat + step);
}
