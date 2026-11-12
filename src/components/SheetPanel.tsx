import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getInstrument } from '../music/instruments';
import { keyShortLabel } from '../music/keys';
import {
  buildSheetFrames,
  frameAtBeat,
  layoutSheet,
  paginateSheet,
  sheetGeometry,
  type SheetFrame,
  type SheetGeometry,
  type SheetLine,
} from '../music/sheet';
import { describeTiming, timingOf } from '../music/timing';
import type { InstrumentDefinition, Track } from '../music/types';
import { useClockStore } from '../state/clock';
import { useNarrow, useTouch } from '../state/layout';
import { playback } from '../state/playback';
import { useAppStore } from '../state/store';
import { MusicIcon, PauseIcon, PlayIcon, PrintIcon } from './Icons';
import { InstrumentIcon } from './InstrumentIcon';
import { Modal } from './Modal';
import {
  framePositions,
  SHEET_CONTENT_WIDTH,
  SHEET_NARROW_CONTENT_WIDTH,
  SHEET_THEMES,
  SHEET_WIDTH,
  SheetSvg,
  sheetLinesPerPage,
  type SheetLabels,
  type SheetTitle,
} from './SheetSvg';

const ALL = 'all';
/** Printed pages are drawn a little squarer than A4 or Letter, so each fits either paper. */
const PAGE_HEIGHT = SHEET_WIDTH * 1.3;

const LABELS: { value: SheetLabels; label: string; title: string }[] = [
  { value: 'shapes', label: 'Shapes', title: 'Show each key with its shape, as in the game' },
  { value: 'notes', label: 'Notes', title: 'Write the note name on each key' },
  { value: 'keys', label: 'Keyboard', title: 'Write the computer key for each pad' },
];

interface Section {
  track: Track;
  instrument: InstrumentDefinition;
  geometry: SheetGeometry;
  frames: SheetFrame[];
  lines: SheetLine[];
  positions: Map<number, { x: number; y: number }>;
  title: SheetTitle;
}

function trackLabel(track: Track, instrument: InstrumentDefinition): string {
  return track.name.toLowerCase().includes(instrument.displayName.toLowerCase())
    ? track.name
    : `${track.name} (${instrument.displayName})`;
}

/** Scrolls the sheet so the frame being played stays in view. */
function reveal(svg: SVGSVGElement, y: number, geometry: SheetGeometry) {
  const scroller = svg.closest<HTMLElement>('.modal-body');
  if (!scroller) return;
  const box = svg.getBoundingClientRect();
  const scale = box.width / svg.viewBox.baseVal.width;
  const top = box.top - scroller.getBoundingClientRect().top + y * scale;
  const bottom = top + geometry.frameHeight * scale;
  const toolbar = 84;
  if (top >= toolbar && bottom <= scroller.clientHeight - 24) return;
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  scroller.scrollBy({ top: top - toolbar - geometry.lineHeight * scale, behavior: calm ? 'auto' : 'smooth' });
}

export function SheetPanel({ onClose }: { onClose: () => void }) {
  const project = useAppStore((state) => state.project);
  const activeTrackId = useAppStore((state) => state.activeTrackId);
  const isPlaying = useAppStore((state) => state.isPlaying);
  const playable = useMemo(() => project.tracks.filter((track) => track.notes.length > 0), [project.tracks]);
  const [choice, setChoice] = useState(() =>
    playable.some((track) => track.id === activeTrackId) ? activeTrackId : (playable[0]?.id ?? ALL),
  );
  const [labels, setLabels] = useState<SheetLabels>('shapes');
  const [printing, setPrinting] = useState(false);
  const svgs = useRef(new Map<string, SVGSVGElement>());
  const touch = useTouch();
  // On screen the sheet fits the window; printed, it always fills a page.
  const contentWidth = useNarrow() ? SHEET_NARROW_CONTENT_WIDTH : SHEET_CONTENT_WIDTH;

  const shown = choice === ALL || !playable.some((track) => track.id === choice) ? ALL : choice;
  const timing = timingOf(project);
  const timingText = describeTiming(project);
  const sections = useMemo<Section[]>(() => {
    const detail = `${timingText} · key ${keyShortLabel(project.key)}`;
    return playable
      .filter((track) => shown === ALL || track.id === shown)
      .map((track) => {
        const instrument = getInstrument(track.instrumentId);
        const geometry = sheetGeometry(instrument, contentWidth);
        const frames = buildSheetFrames(track.notes, instrument, timing);
        const lines = layoutSheet(frames, geometry.columns);
        return {
          track,
          instrument,
          geometry,
          frames,
          lines,
          positions: framePositions(lines, geometry, false),
          title: { heading: project.title, detail: `${trackLabel(track, instrument)} · ${detail}` },
        };
      });
  }, [playable, shown, contentWidth, timing, timingText, project.key, project.title]);
  const single = sections.length === 1 ? sections[0] : null;

  // The cursor follows the playhead by moving one outline, so playing never redraws the sheet.
  useEffect(() => {
    const current = new Map<string, number>();
    const follow = (beat: number) => {
      for (const section of sections) {
        const index = frameAtBeat(section.frames, beat);
        if (current.get(section.track.id) === index) continue;
        current.set(section.track.id, index);
        const svg = svgs.current.get(section.track.id);
        const cursor = svg?.querySelector('[data-cursor]');
        if (!svg || !cursor) continue;
        const position = section.positions.get(index);
        if (!position) {
          cursor.setAttribute('visibility', 'hidden');
          continue;
        }
        cursor.setAttribute('x', String(position.x - 4));
        cursor.setAttribute('y', String(position.y - 4));
        cursor.setAttribute('visibility', 'visible');
        if (sections.length === 1) reveal(svg, position.y, section.geometry);
      }
    };
    follow(useClockStore.getState().playhead);
    return useClockStore.subscribe((clock) => follow(clock.playhead));
  }, [sections]);

  const handlers = useMemo(() => {
    const goTo = (section: Section, index: number) => {
      const frame = section.frames[index];
      if (!frame) return;
      playback.seek(frame.startBeat);
      if (useAppStore.getState().isPlaying) return;
      for (const pad of frame.pads) void playback.previewPad(section.instrument.id, pad, 0.85, true);
    };
    return new Map(sections.map((section) => [section.track.id, (index: number) => goTo(section, index)]));
  }, [sections]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const tag = (event.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (event.key === ' ') {
        // A focused button already takes Space as a click.
        if (tag === 'BUTTON') return;
        event.preventDefault();
        void playback.togglePlay();
        return;
      }
      if (!single || (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft')) return;
      event.preventDefault();
      const beat = playback.position();
      const at = frameAtBeat(single.frames, beat);
      const onFrame = at >= 0 && Math.abs(single.frames[at].startBeat - beat) < 1e-3;
      const next = event.key === 'ArrowRight' ? at + 1 : onFrame ? at - 1 : at;
      handlers.get(single.track.id)?.(Math.max(0, Math.min(single.frames.length - 1, next)));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [single, handlers]);

  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done, { once: true });
    // Wait a frame so the pages are in the document before the print dialog reads it.
    const frame = requestAnimationFrame(() => window.print());
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('afterprint', done);
    };
  }, [printing]);

  return (
    <Modal
      title="Sheet"
      eyebrow={`${project.title} · read it, play along, or print it`}
      onClose={onClose}
      size="wide"
    >
      {playable.length === 0 ? (
        <div className="empty-state">
          <MusicIcon size={22} />
          <p>This song has no notes yet. Add some, then come back for the sheet.</p>
        </div>
      ) : (
        <>
          <div className="sheet-toolbar">
            <button
              type="button"
              className="btn primary sheet-play"
              onClick={() => void playback.togglePlay()}
              title="Play or pause (Space)"
            >
              {isPlaying ? <PauseIcon size={14} /> : <PlayIcon size={14} />} {isPlaying ? 'Pause' : 'Play'}
            </button>
            <select
              className="select sheet-track"
              aria-label="Instrument"
              value={shown}
              onChange={(event) => setChoice(event.target.value)}
            >
              {playable.map((track) => (
                <option key={track.id} value={track.id}>
                  {trackLabel(track, getInstrument(track.instrumentId))}
                </option>
              ))}
              {playable.length > 1 && <option value={ALL}>All instruments</option>}
            </select>
            <div className="catalog-parts" role="group" aria-label="What to write on the keys">
              {LABELS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={labels === item.value ? 'is-on' : ''}
                  aria-pressed={labels === item.value}
                  title={item.title}
                  onClick={() => setLabels(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <span className="sheet-toolbar-space" />
            <button
              type="button"
              className="btn"
              disabled={printing}
              onClick={() => setPrinting(true)}
              title="Print the sheet, or choose “Save as PDF” in the print window"
            >
              <PrintIcon size={15} /> Print or save PDF
            </button>
          </div>

          {sections.map((section) => (
            <section key={section.track.id} className="sheet-section" style={{ ['--track-color' as string]: section.track.color }}>
              <header className="sheet-section-head">
                <InstrumentIcon instrumentId={section.instrument.id} size={22} />
                <h3>{trackLabel(section.track, section.instrument)}</h3>
                <span>
                  {section.frames.length.toLocaleString()} {section.frames.length === 1 ? 'frame' : 'frames'}
                </span>
              </header>
              <SheetSvg
                svgRef={(element) => {
                  if (element) svgs.current.set(section.track.id, element);
                  else svgs.current.delete(section.track.id);
                }}
                lines={section.lines}
                instrument={section.instrument}
                projectKey={project.key}
                geometry={section.geometry}
                contentWidth={contentWidth}
                theme={SHEET_THEMES.screen}
                labels={labels}
                onFrame={handlers.get(section.track.id)}
              />
            </section>
          ))}

          <p className="sheet-legend">
            <span><i className="sheet-key" /> Press the filled keys together, one frame after another.</span>
            <span>The small number is the bar each line starts on.</span>
            <span>{touch ? 'Tap' : 'Click'} a frame to hear it{single && !touch ? ', or step with ← and →' : ''}.</span>
          </p>

          {printing &&
            createPortal(
              <div className="print-root">
                {sections.flatMap((section) => {
                  const geometry = sheetGeometry(section.instrument, SHEET_CONTENT_WIDTH);
                  const pages = paginateSheet(
                    layoutSheet(section.frames, geometry.columns),
                    sheetLinesPerPage(PAGE_HEIGHT, geometry, true),
                    sheetLinesPerPage(PAGE_HEIGHT, geometry, false),
                  );
                  return pages.map((lines, page) => (
                    <div key={`${section.track.id}-${page}`} className="print-page">
                      <SheetSvg
                        lines={lines}
                        instrument={section.instrument}
                        projectKey={project.key}
                        geometry={geometry}
                        theme={SHEET_THEMES.paper}
                        labels={labels}
                        title={page === 0 ? section.title : undefined}
                        footer={`${project.title} · ${trackLabel(section.track, section.instrument)} · page ${page + 1} of ${pages.length} · Sky Music Studio`}
                      />
                    </div>
                  ));
                })}
              </div>,
              document.body,
            )}
        </>
      )}
    </Modal>
  );
}
