import { StrictMode } from 'react';
import { version } from '../package.json';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { useAppStore } from './state/store';
import { playback } from './state/playback';
import { INSTRUMENTS } from './music/instruments';
import { getSampleVoiceCount } from './audio/sampleVoice';
import { soundSourceInfo } from './audio/sampleBank';

// Small, explicit debug surface for automated browser verification and support.
declare global {
  interface Window {
    __SKY_MUSIC_STUDIO__?: {
      store: typeof useAppStore;
      playback: typeof playback;
      version: string;
      instruments: typeof INSTRUMENTS;
      getSampleVoiceCount: typeof getSampleVoiceCount;
      soundSourceInfo: typeof soundSourceInfo;
    };
  }
}
window.__SKY_MUSIC_STUDIO__ = {
  store: useAppStore,
  playback,
  version,
  instruments: INSTRUMENTS,
  getSampleVoiceCount,
  soundSourceInfo,
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
