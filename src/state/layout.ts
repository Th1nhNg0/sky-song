import { useSyncExternalStore } from 'react';

/** Windows a phone can show: narrow, or wide but short like a phone on its side. */
const COMPACT_QUERY = '(max-width: 899px), (max-height: 520px)';
/** A phone held upright, where panels are sheets as wide as the screen. */
const NARROW_QUERY = '(max-width: 639px)';
/** A finger rather than a mouse: targets grow, and hints about keys and hovering go. */
const TOUCH_QUERY = '(pointer: coarse)';

/** Width of the column of track names and pad names at the left of the timeline. */
const LABEL_WIDTH = 196;
const COMPACT_LABEL_WIDTH = 64;

function watch(query: string) {
  const list = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query) : null;
  const matches = () => list?.matches ?? false;
  const subscribe = (onChange: () => void) => {
    list?.addEventListener('change', onChange);
    return () => list?.removeEventListener('change', onChange);
  };
  return { matches, use: () => useSyncExternalStore(subscribe, matches, () => false) };
}

const compact = watch(COMPACT_QUERY);
const narrow = watch(NARROW_QUERY);
const touch = watch(TOUCH_QUERY);

export const isCompact = compact.matches;
/** True in a phone-sized window, where the studio folds its bars and menus down. */
export const useCompact = compact.use;
export const useNarrow = narrow.use;
export const useTouch = touch.use;

/** The label column's width right now, for code that runs outside a render. */
export const labelWidth = () => (isCompact() ? COMPACT_LABEL_WIDTH : LABEL_WIDTH);
export const useLabelWidth = () => (useCompact() ? COMPACT_LABEL_WIDTH : LABEL_WIDTH);
