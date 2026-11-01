import type { ReactNode } from 'react';
import { getInstrument } from '../music/instruments';

const STRINGS = <path d="M9 5v14M12 4v16M15 5v14" />;

/** One original line drawing per instrument family, shipped in the bundle. */
const FAMILY_ICONS: Record<string, ReactNode> = {
  Keys: (
    <>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <path d="M8 6v12M12 6v12M16 6v12" />
      <path d="M8 6v6M12 6v6M16 6v6" strokeWidth="3" />
    </>
  ),
  Plucked: (
    <>
      <circle cx="9" cy="15.5" r="4.5" />
      <path d="M12.3 12.2 20 4.5M9 15.5h.01M18 3.5l2.5 2.5" />
    </>
  ),
  Bowed: (
    <>
      <path d="M12 4c-2 0-3 1.2-3 3 0 1.2.8 1.8.8 3 0 .9-2.3 1.7-2.3 5 0 3 2 5 4.5 5s4.5-2 4.5-5c0-3.3-2.3-4.1-2.3-5 0-1.2.8-1.8.8-3 0-1.8-1-3-3-3Z" />
      <path d="M12 8v8" />
    </>
  ),
  'Bowed bass': (
    <>
      <path d="M12 3c-1.6 0-2.6 1-2.6 2.6 0 1.5.9 2 .9 3.2 0 1.2-3.3 2.2-3.3 6.2 0 3.4 2.2 6 5 6s5-2.6 5-6c0-4-3.3-5-3.3-6.2 0-1.2.9-1.7.9-3.2C14.6 4 13.6 3 12 3Z" />
      <path d="M10 15.5h4M10 18h4" />
    </>
  ),
  Wind: (
    <>
      <rect x="2.5" y="10" width="19" height="4" rx="2" />
      <path d="M8 12h.01M12 12h.01M16 12h.01" />
    </>
  ),
  Brass: (
    <>
      <path d="M3 10v4h4l9 4.5v-13L7 10H3Z" />
      <path d="M16 8.5c3 .4 5 1.7 5 3.5s-2 3.1-5 3.5" />
    </>
  ),
  Reed: (
    <>
      <path d="M15 4h4l-3 2v9a4.5 4.5 0 0 1-9 0v-1" />
      <path d="M5 14h4M12 9h.01M12 13h.01" />
    </>
  ),
  Voice: (
    <>
      <path d="M4 12h1.5M8 8v8M12 5v14M16 8v8M18.5 12H20" />
    </>
  ),
  Bells: (
    <>
      <path d="M6 16.5c1.3-1.3 1.5-3 1.5-5.5a4.5 4.5 0 0 1 9 0c0 2.5.2 4.2 1.5 5.5H6Z" />
      <path d="M10.5 19.5a1.7 1.7 0 0 0 3 0M12 6.5V4.5" />
    </>
  ),
  Handpan: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 5.8h.01M18.2 12h.01M12 18.2h.01M5.8 12h.01" />
    </>
  ),
  Struck: (
    <>
      <path d="M5 8h14M7 12h10M9 16h6" />
      <path d="M4 20 11 5M20 20 13 5" strokeWidth="1.2" />
    </>
  ),
  Percussion: (
    <>
      <ellipse cx="12" cy="8" rx="8" ry="3.5" />
      <path d="M4 8v8c0 1.9 3.6 3.5 8 3.5s8-1.6 8-3.5V8M8 11v8M16 11v8" />
    </>
  ),
};

export function InstrumentIcon({ instrumentId, size = 20 }: { instrumentId: string; size?: number }) {
  const { category } = getInstrument(instrumentId);
  return (
    <svg
      className="instrument-icon"
      data-family={category}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {FAMILY_ICONS[category] ?? STRINGS}
    </svg>
  );
}
