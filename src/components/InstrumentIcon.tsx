import { MusicIcon } from './Icons';

// Icons come from the owner's local folder through the dev server, so a production
// build has none and shows the generic note instead.
export function InstrumentIcon({ instrumentId, size = 20 }: { instrumentId: string; size?: number }) {
  if (!import.meta.env.DEV) return <MusicIcon size={size} />;
  const url = `url("/__local-packs/icon-${instrumentId}.png")`;
  return (
    <span
      className="instrument-icon"
      style={{ width: size, height: size, maskImage: url, WebkitMaskImage: url }}
      aria-hidden="true"
    />
  );
}
