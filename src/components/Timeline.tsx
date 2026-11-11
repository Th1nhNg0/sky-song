import { useEffect, useRef, useState } from 'react';
import { getInstrument } from '../music/instruments';
import { isTrackAudible, projectEndBeat } from '../music/project';
import { beatsPerMeasure } from '../music/time';
import { soundSourceInfo } from '../audio/sampleBank';
import { useViewStore } from '../state/clock';
import { useCompact, useLabelWidth, useTouch } from '../state/layout';
import { useSoundBankVersion } from '../state/soundBank';
import { useAppStore } from '../state/store';
import { clamp } from '../util';
import type { CatalogIntent } from './CatalogPanel';
import { ChevronDownIcon, PlusIcon, VolumeIcon } from './Icons';
import { InstrumentIcon } from './InstrumentIcon';
import { PianoRoll } from './PianoRoll';
import { LoopLane, Ruler, usePlayheadTransform } from './Ruler';
import { SelectionBar } from './SelectionBar';
import { LANE_HEIGHT, TrackLane, TrackMixButtons } from './TrackLane';
import type { DragState } from './useNoteGestures';
import { OVERSCAN, useTimelineView, WINDOW_STEP } from './useTimelineView';

const ACTIVE_HEADER_HEIGHT = 38;
const RULER_HEIGHT = 34;
const LOOP_HEIGHT = 26;
const ADD_ROW_HEIGHT = 38;
const MIN_ROW = 20;
/** A row a finger can hit. The roll scrolls up and down when they do not all fit. */
const MIN_TOUCH_ROW = 30;
const MAX_ROW = 42;

function PlayheadLine({ px, offset }: { px: number; offset: number }) {
  const ref = usePlayheadTransform<HTMLDivElement>(px, offset);
  return <div ref={ref} className="playhead-line" aria-hidden="true" />;
}

function ActiveVolume({ trackId, volume, name }: { trackId: string; volume: number; name: string }) {
  const setVolume = useAppStore((state) => state.setTrackVolume);
  const beginGesture = useAppStore((state) => state.beginGesture);
  const endGesture = useAppStore((state) => state.endGesture);
  return (
    <label className="active-volume" title={`Volume ${Math.round(volume * 100)}%`}>
      <VolumeIcon size={14} />
      <input
        type="range"
        min={0}
        max={1.2}
        step={0.01}
        value={volume}
        aria-label={`${name} volume`}
        onChange={(event) => setVolume(trackId, Number(event.target.value))}
        onPointerDown={beginGesture}
        onPointerUp={(event) => {
          endGesture();
          event.currentTarget.blur();
        }}
      />
    </label>
  );
}

/** The song as lanes: one track open as a piano roll, the others collapsed beneath the ruler. */
export function Timeline({ onOpenCatalog }: { onOpenCatalog: (intent: CatalogIntent) => void }) {
  const project = useAppStore((state) => state.project);
  const activeTrackId = useAppStore((state) => state.activeTrackId);
  const px = useAppStore((state) => state.preferences.zoom);
  const snap = useAppStore((state) => state.preferences.snap);
  const setLoop = useAppStore((state) => state.setLoop);
  const setActiveTrack = useAppStore((state) => state.setActiveTrack);
  const [minimizedId, setMinimizedId] = useState<string | null>(null);
  useSoundBankVersion();

  const labelWidth = useLabelWidth();
  const compact = useCompact();
  const touch = useTouch();
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const { viewHeight, viewWidth, windowStart } = useTimelineView(scrollRef, px, dragRef, labelWidth);

  const activeTrack = project.tracks.find((track) => track.id === activeTrackId) ?? project.tracks[0];
  const instrument = getInstrument(activeTrack.instrumentId);
  const hold = instrument.supportsHold;
  const minimized = minimizedId === activeTrack.id;
  const beatsPerBar = beatsPerMeasure(project.timeSignature);
  const contentEnd = Math.max(projectEndBeat(project), project.loop.endBeat);
  const totalBeats =
    Math.ceil(Math.max(contentEnd + beatsPerBar * 4, viewWidth / px) / beatsPerBar) * beatsPerBar;

  // The open track's rows share the height left over by everything else in the timeline.
  const openRows = minimized ? 0 : ACTIVE_HEADER_HEIGHT;
  const chrome =
    RULER_HEIGHT +
    (project.loop.enabled ? LOOP_HEIGHT : 0) +
    openRows +
    (project.tracks.length - (minimized ? 0 : 1)) * LANE_HEIGHT +
    ADD_ROW_HEIGHT;
  const rowHeight = clamp(Math.floor((viewHeight - chrome) / instrument.keyCount), touch ? MIN_TOUCH_ROW : MIN_ROW, MAX_ROW);

  useEffect(() => {
    useViewStore.setState({ totalBeats });
  }, [totalBeats]);

  const selectTrack = (id: string) => {
    setMinimizedId(null);
    setActiveTrack(id);
  };

  const isGame = soundSourceInfo(instrument.id).kind === 'sample';

  return (
    <section className="timeline" aria-label="Song editor">
      <SelectionBar />
      <div className="timeline-scroll" ref={scrollRef}>
        <div
          className="timeline-content"
          style={{ width: labelWidth + totalBeats * px, ['--label-width' as string]: `${labelWidth}px` }}
        >
          <div className="ruler-wrap">
            <div className="ruler-row">
              <div className="ruler-corner">Bars</div>
              <Ruler
                px={px}
                totalBeats={totalBeats}
                meter={project.timeSignature}
                snap={snap}
                windowStart={Math.max(0, windowStart - OVERSCAN)}
                windowEnd={windowStart + viewWidth + OVERSCAN + WINDOW_STEP}
              />
            </div>
            {project.loop.enabled && (
              <LoopLane totalBeats={totalBeats} px={px} loop={project.loop} meter={project.timeSignature} snap={snap} onChange={setLoop} />
            )}
          </div>

          <div className="timeline-body">
            {project.loop.enabled && (
              <div
                className="loop-band"
                style={{ left: labelWidth + project.loop.startBeat * px, width: (project.loop.endBeat - project.loop.startBeat) * px }}
                aria-hidden="true"
              />
            )}
            {project.tracks.map((track) =>
              track.id === activeTrack.id && !minimized ? (
                <div key={track.id} className="track-active" style={{ ['--track-color' as string]: track.color }}>
                  <div className="track-active-head" style={{ height: ACTIVE_HEADER_HEIGHT }}>
                    <button
                      type="button"
                      className="instrument-pick"
                      data-track-id={track.id}
                      data-instrument-id={track.instrumentId}
                      onClick={() => onOpenCatalog({ mode: 'change', trackId: track.id })}
                      aria-label={`Change instrument for ${track.name}`}
                      title="Change instrument"
                    >
                      <InstrumentIcon instrumentId={track.instrumentId} size={22} />
                      <span>{track.name}</span>
                      <ChevronDownIcon size={13} />
                    </button>
                    <span className="track-facts">
                      <em className={`sound-source ${isGame ? 'is-game' : ''}`}>{isGame ? 'Game' : 'Synth'}</em>
                      <span>{hold ? 'Held notes' : 'One-shot'}</span>
                      <span>{track.notes.length} notes</span>
                    </span>
                    <TrackMixButtons track={track} />
                    {/* A phone has no room for the slider here; Mix has every track's level. */}
                    {!compact && <ActiveVolume trackId={track.id} volume={track.volume} name={track.name} />}
                    <button
                      type="button"
                      className="track-minimize"
                      onClick={() => {
                        useAppStore.getState().clearSelection();
                        setMinimizedId(track.id);
                      }}
                      aria-label={`Minimize ${track.name}`}
                      title="Collapse to a lane"
                    >
                      <ChevronDownIcon size={15} />
                    </button>
                  </div>
                  <PianoRoll
                    track={track}
                    instrument={instrument}
                    projectKey={project.key}
                    meter={project.timeSignature}
                    px={px}
                    snap={snap}
                    rowHeight={rowHeight}
                    totalBeats={totalBeats}
                    windowStart={windowStart}
                    viewWidth={viewWidth}
                    scrollRef={scrollRef}
                    dragRef={dragRef}
                  />
                </div>
              ) : (
                <TrackLane
                  key={track.id}
                  track={track}
                  px={px}
                  totalBeats={totalBeats}
                  silent={!isTrackAudible(project, track)}
                  onSelect={selectTrack}
                />
              ),
            )}
            <div className="add-track-row" style={{ height: ADD_ROW_HEIGHT }}>
              <button type="button" className="add-track-button" onClick={() => onOpenCatalog({ mode: 'add' })}>
                <PlusIcon size={15} />
                <span>Add instrument</span>
              </button>
            </div>
            <PlayheadLine px={px} offset={labelWidth} />
          </div>
        </div>
      </div>
    </section>
  );
}
