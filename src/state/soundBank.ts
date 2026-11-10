import { useSyncExternalStore } from 'react';
import { getSoundBankVersion, subscribeSoundBank } from '../audio/sampleBank';

/** Re-renders the caller whenever sound packs load, change or go away. */
export function useSoundBankVersion(): number {
  return useSyncExternalStore(subscribeSoundBank, getSoundBankVersion, getSoundBankVersion);
}
