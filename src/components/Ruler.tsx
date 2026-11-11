import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { barLabelStep, meterBeat } from '../music/grid';
import { beatsPerMeasure, formatBarBeat, snapBeat } from '../music/time';
import type { LoopRegion } from '../music/types';
import { useClockStore } from '../state/clock';
import { playback } from '../state/playback';
import { LoopIcon } from './Icons';

/** Follows the clock without a React render, so playback never touches the editor tree. */
export function usePlayheadTransform<T extends HTMLElement>(px: number, offset = 0) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const place = (beat: number) => {
      if (ref.current) ref.current.style.transform = `translate3d(${offset + beat * px}px, 0, 0)`;
    };
    place(useClockStore.getState().playhead);
    return useClockStore.subscribe((state) => place(state.playhead));
  }, [px, offset]);
  return ref;
}

/** Follows the pointer across the window until it is released or the gesture is cancelled. */
function followPointer(onMove: (event: PointerEvent) => void, onEnd?: () => void): void {
  const end = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    onEnd?.();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

function RulerPlayhead({ px }: { px: number }) {
  const ref = usePlayheadTransform<HTMLDivElement>(px);
  return <div ref={ref} className="ruler-playhead" aria-hidden="true" />;
}

export function Ruler({
  px,
  totalBeats,
  meter,
  snap,
  windowStart,
  windowEnd,
}: {
  px: number;
  totalBeats: number;
  meter: [number, number];
  snap: number;
  windowStart: number;
  windowEnd: number;
}) {
  const barBeats = beatsPerMeasure(meter);
  const beat = meterBeat(meter);
  const step = barLabelStep(px, meter);
  const showBeats = beat * px >= 44;
  const firstBar = Math.max(0, Math.floor(windowStart / px / barBeats));
  const lastBar = Math.min(Math.ceil(totalBeats / barBeats), Math.ceil(windowEnd / px / barBeats));
  const marks = [];
  for (let bar = firstBar - (firstBar % step); bar <= lastBar; bar += step) {
    marks.push(
      <span key={bar} className="measure-label" style={{ left: bar * barBeats * px }}>
        {bar + 1}
      </span>,
    );
    if (showBeats) {
      const count = Math.round(barBeats / beat);
      for (let index = 1; index < count; index++) {
        marks.push(
          <span key={`${bar}.${index}`} className="beat-label" style={{ left: (bar * barBeats + index * beat) * px }}>
            {bar + 1}.{index + 1}
          </span>,
        );
      }
    }
  }

  const beatAt = (clientX: number, element: HTMLElement) => {
    const raw = Math.max(0, (clientX - element.getBoundingClientRect().left) / px);
    return snap > 0 ? snapBeat(raw, snap) : raw;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const element = event.currentTarget;
    playback.seek(beatAt(event.clientX, element));
    followPointer((next) => playback.seek(beatAt(next.clientX, element)));
  };

  return (
    <div
      className="ruler"
      style={{ width: totalBeats * px }}
      onPointerDown={onPointerDown}
      role="slider"
      aria-label="Timeline position"
      aria-valuemin={0}
      aria-valuemax={totalBeats}
      aria-valuenow={0}
      tabIndex={0}
      title="Click or drag to move the cursor"
    >
      {marks}
      <RulerPlayhead px={px} />
    </div>
  );
}

type LoopDrag = { mode: 'new' | 'start' | 'end' | 'move'; origin: number; region: { start: number; end: number } };

export function LoopLane({
  totalBeats,
  px,
  loop,
  meter,
  snap,
  onChange,
}: {
  totalBeats: number;
  px: number;
  loop: LoopRegion;
  meter: [number, number];
  snap: number;
  onChange: (loop: LoopRegion) => void;
}) {
  const laneRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ start: number; end: number } | null>(null);
  const step = snap > 0 ? snap : 0.25;

  const beatAt = (clientX: number) => {
    const left = laneRef.current?.getBoundingClientRect().left ?? 0;
    return snapBeat(Math.max(0, (clientX - left) / px), step);
  };

  const startDrag = (event: ReactPointerEvent, mode: LoopDrag['mode']) => {
    event.preventDefault();
    event.stopPropagation();
    const origin = beatAt(event.clientX);
    const drag: LoopDrag = { mode, origin, region: { start: loop.startBeat, end: loop.endBeat } };
    let latest: { start: number; end: number } | null = null;
    const move = (next: PointerEvent) => {
      const beat = beatAt(next.clientX);
      const { start, end } = drag.region;
      if (drag.mode === 'new') latest = { start: Math.min(origin, beat), end: Math.max(origin, beat) };
      else if (drag.mode === 'start') latest = { start: Math.min(beat, end - step), end };
      else if (drag.mode === 'end') latest = { start, end: Math.max(beat, start + step) };
      else {
        const shift = Math.max(beat - origin, -start);
        latest = { start: start + shift, end: end + shift };
      }
      setDraft(latest);
    };
    const up = () => {
      setDraft(null);
      if (latest && latest.end - latest.start >= step) {
        onChange({ enabled: true, startBeat: latest.start, endBeat: latest.end });
      } else if (drag.mode === 'new') {
        const bar = beatsPerMeasure(meter);
        const start = Math.floor(origin / bar) * bar;
        onChange({ enabled: true, startBeat: start, endBeat: start + bar });
      }
    };
    followPointer(move, up);
  };

  const shown = draft ?? { start: loop.startBeat, end: loop.endBeat };
  return (
    <div className="loop-row">
      <div className="loop-corner">
        <LoopIcon size={13} />
        <span>Loop</span>
      </div>
      <div
        className="loop-lane"
        ref={laneRef}
        style={{ width: totalBeats * px }}
        onPointerDown={(event) => startDrag(event, 'new')}
        title="Drag to set the loop, or click a bar to loop it"
      >
        <div
          className={`loop-region ${draft ? 'is-draft' : ''}`}
          style={{ left: shown.start * px, width: Math.max(4, (shown.end - shown.start) * px) }}
          onPointerDown={(event) => startDrag(event, 'move')}
        >
          <button type="button" className="loop-handle start" aria-label="Drag loop start" onPointerDown={(event) => startDrag(event, 'start')} />
          <span className="loop-label">
            {formatBarBeat(shown.start, meter)} – {formatBarBeat(shown.end, meter)}
          </span>
          <button type="button" className="loop-handle end" aria-label="Drag loop end" onPointerDown={(event) => startDrag(event, 'end')} />
        </div>
      </div>
    </div>
  );
}
