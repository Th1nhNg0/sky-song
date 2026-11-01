/** The instrument's picture, tinted with the colour of the track around it. */
export function InstrumentIcon({ instrumentId, size = 20 }: { instrumentId: string; size?: number }) {
  const url = `url("${import.meta.env.BASE_URL}instrument-icons/${instrumentId}.png")`;
  return (
    <span
      className="instrument-icon"
      style={{ width: size, height: size, maskImage: url, WebkitMaskImage: url }}
      aria-hidden="true"
    />
  );
}
