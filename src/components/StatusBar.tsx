import { useEffect, useRef } from 'react';
import { getInstrument } from '../music/instruments';
import { resolvePad } from '../music/pitch';
import { formatBarBeat } from '../music/time';
import { useClockStore, useViewStore } from '../state/clock';
import { useAppStore } from '../state/store';

const OVERVIEW_HEIGHT = 30;

/** The whole song at a glance; click or drag to travel through it. */
function Overview() {
  const tracks = useAppStore((state) => state.project.tracks);
  const totalBeats = useViewStore((state) => state.totalBeats);
  const scrollLeft = useViewStore((state) => state.scrollLeft);
  const viewWidth = useViewStore((state) => state.viewWidth);
  const zoom = useAppStore((state) => state.preferences.zoom);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!root || !canvas || !ctx) return;
    let frame = 0;
    const draw = () => {
      frame = 0;
      const ratio = window.devicePixelRatio || 1;
      const width = root.clientWidth;
      canvas.width = width * ratio;
      canvas.height = OVERVIEW_HEIGHT * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const laneHeight = OVERVIEW_HEIGHT / Math.max(1, tracks.length);
      tracks.forEach((track, index) => {
        ctx.fillStyle = track.color;
        ctx.globalAlpha = track.muted ? 0.3 : 0.85;
        const y = index * laneHeight;
        for (const note of track.notes) {
          ctx.fillRect((note.startBeat / totalBeats) * width, y, Math.max(1, (note.durationBeats / totalBeats) * width), Math.max(1, laneHeight - 0.5));
        }
      });
    };
    const request = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    request();
    const observer = new ResizeObserver(request);
    observer.observe(root);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [tracks, totalBeats]);

  useEffect(() => {
    const place = (beat: number) => {
      if (cursorRef.current) cursorRef.current.style.left = `${(beat / totalBeats) * 100}%`;
    };
    place(useClockStore.getState().playhead);
    return useClockStore.subscribe((state) => place(state.playhead));
  }, [totalBeats]);

  const travel = (clientX: number) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const fraction = (clientX - rect.left) / rect.width;
    const visibleBeats = viewWidth / zoom;
    useViewStore.getState().navigation?.scrollToBeat(fraction * totalBeats - visibleBeats / 2);
  };

  const total = totalBeats * zoom;
  return (
    <div
      className="overview"
      ref={rootRef}
      role="scrollbar"
      aria-label="Song overview"
      aria-orientation="horizontal"
      aria-controls="timeline"
      aria-valuenow={Math.round((scrollLeft / Math.max(1, total)) * 100)}
      onPointerDown={(event) => {
        event.preventDefault();
        travel(event.clientX);
        const move = (next: PointerEvent) => travel(next.clientX);
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
    >
      <canvas ref={canvasRef} style={{ height: OVERVIEW_HEIGHT }} aria-hidden="true" />
      <div
        className="overview-window"
        style={{ left: `${(scrollLeft / total) * 100}%`, width: `${Math.min(100, (viewWidth / total) * 100)}%` }}
      />
      <div ref={cursorRef} className="overview-cursor" />
    </div>
  );
}

function PointerReadout() {
  const hover = useViewStore((state) => state.hover);
  const meter = useAppStore((state) => state.project.timeSignature);
  const key = useAppStore((state) => state.project.key);
  const instrumentId = useAppStore((state) => state.activeTrack().instrumentId);
  if (!hover) return <span className="pointer-readout is-idle">Point at the grid for position</span>;
  const instrument = getInstrument(instrumentId);
  const resolved = hover.pad !== null && hover.pad < instrument.keyCount ? resolvePad(instrument, key, hover.pad) : null;
  return (
    <span className="pointer-readout">
      <b>{formatBarBeat(hover.beat, meter)}</b>
      {resolved && <span>{resolved.noteName ?? resolved.label}</span>}
      {hover.pad !== null && <span>Pad {hover.pad + 1}</span>}
    </span>
  );
}

export function StatusBar() {
  return (
    <footer className="status-bar">
      <PointerReadout />
      <Overview />
    </footer>
  );
}
