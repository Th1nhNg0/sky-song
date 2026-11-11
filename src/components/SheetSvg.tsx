import { memo, useId, type MouseEvent, type Ref } from 'react';
import { isTonicDegree } from '../music/keys';
import { padKey } from '../music/padKeys';
import { resolvePad } from '../music/pitch';
import type { SheetGeometry, SheetLine } from '../music/sheet';
import type { InstrumentDefinition } from '../music/types';

export type SheetLabels = 'shapes' | 'notes' | 'keys';

export interface SheetTheme {
  /** Painted behind the sheet; null leaves it see-through. */
  background: string | null;
  frameFill: string;
  frameStroke: string;
  rule: string;
  ink: string;
  soft: string;
  /** Key colour for each row of the instrument, top first. */
  rows: [string, string, string];
  onKey: string;
  cursor: string;
}

/** Colours are plain values, not CSS variables, so a printed sheet does not depend on the page's styles. */
export const SHEET_THEMES: Record<'screen' | 'paper', SheetTheme> = {
  screen: {
    background: null,
    frameFill: 'rgba(8, 7, 14, 0.42)',
    frameStroke: 'rgba(255, 236, 205, 0.34)',
    rule: 'rgba(255, 236, 205, 0.1)',
    ink: '#f4ecdf',
    soft: '#8d8399',
    rows: ['#7fdc8c', '#6cc4ff', '#ff9fbf'],
    onKey: '#14121d',
    cursor: '#ffd38a',
  },
  paper: {
    background: '#ffffff',
    frameFill: '#ffffff',
    frameStroke: '#8f8a95',
    rule: '#dcd8e0',
    ink: '#1c1a22',
    soft: '#77717f',
    rows: ['#2f9a45', '#1c7fd0', '#d04a84'],
    onKey: '#ffffff',
    cursor: '#1c1a22',
  },
};

export const SHEET_MARGIN = 24;
/** Width the lines of frames fill; the drawing adds a margin either side. */
export const SHEET_CONTENT_WIDTH = 992;
/** The same on a phone held upright: fewer frames to a line, so each stays large enough to read. */
export const SHEET_NARROW_CONTENT_WIDTH = 440;
export const SHEET_WIDTH = SHEET_CONTENT_WIDTH + SHEET_MARGIN * 2;
const TITLE_HEIGHT = 58;
const TOP_SPACE = 12;
const FOOTER_HEIGHT = 22;
const FONT = '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif';

export interface SheetTitle {
  heading: string;
  detail: string;
}

export function sheetTop(title: boolean): number {
  return TOP_SPACE + (title ? TITLE_HEIGHT : 0);
}

export function sheetHeight(lineCount: number, geometry: SheetGeometry, title: boolean, footer: boolean): number {
  return sheetTop(title) + Math.max(1, lineCount) * geometry.lineHeight + (footer ? FOOTER_HEIGHT : 0);
}

/** How many lines fit on a page of the given height, leaving room for the footer. */
export function sheetLinesPerPage(pageHeight: number, geometry: SheetGeometry, title: boolean): number {
  return Math.max(1, Math.floor((pageHeight - sheetTop(title) - FOOTER_HEIGHT) / geometry.lineHeight));
}

function columnX(column: number, geometry: SheetGeometry): number {
  return SHEET_MARGIN + geometry.gutter + column * (geometry.frameWidth + geometry.gap);
}

/** Where each frame's box sits in the drawing, by frame index. */
export function framePositions(lines: SheetLine[], geometry: SheetGeometry, title: boolean): Map<number, { x: number; y: number }> {
  const positions = new Map<number, { x: number; y: number }>();
  lines.forEach((line, row) => {
    for (const cell of line.cells) {
      if (cell.kind !== 'frame') continue;
      positions.set(cell.frame.index, { x: columnX(cell.column, geometry), y: sheetTop(title) + row * geometry.lineHeight });
    }
  });
  return positions;
}

type KeyShape = 'circle' | 'diamond' | 'both';

/**
 * The mark on a key, matching how the instrument looks in the game so a player can find
 * the key by its shape: circles and diamonds alternate, and the home note carries both.
 */
function keyShape(instrument: InstrumentDefinition, pad: number): KeyShape {
  const { degree, col } = instrument.pads[pad];
  if (isTonicDegree(degree)) return 'both';
  return instrument.padLayout.cols === 5 && col % 2 === 1 ? 'diamond' : 'circle';
}

function keyText(instrument: InstrumentDefinition, projectKey: number, pad: number, labels: SheetLabels): string | null {
  if (labels === 'keys') return padKey(instrument, pad);
  if (labels === 'notes') {
    const resolved = resolvePad(instrument, projectKey, pad);
    return resolved.pitched ? (resolved.noteName?.replace(/\d/, '') ?? null) : null;
  }
  return null;
}

const diamond = (cx: number, cy: number, reach: number) =>
  `M${cx} ${cy - reach}L${cx + reach} ${cy}L${cx} ${cy + reach}L${cx - reach} ${cy}Z`;

interface SheetSvgProps {
  lines: SheetLine[];
  instrument: InstrumentDefinition;
  projectKey: number;
  geometry: SheetGeometry;
  /** The width `geometry` was made for. A printed page's by default. */
  contentWidth?: number;
  theme: SheetTheme;
  labels: SheetLabels;
  title?: SheetTitle;
  footer?: string;
  /** Called with the index of a clicked frame. */
  onFrame?: (index: number) => void;
  svgRef?: Ref<SVGSVGElement>;
}

/**
 * One instrument's sheet as a single drawing: an even grid of frames, each showing the
 * instrument's keys with the ones to press filled in. It is drawn with attributes rather
 * than stylesheet classes, so the same drawing prints exactly as it looks.
 */
export const SheetSvg = memo(function SheetSvg({
  lines,
  instrument,
  projectKey,
  geometry,
  contentWidth = SHEET_CONTENT_WIDTH,
  theme,
  labels,
  title,
  footer,
  onFrame,
  svgRef,
}: SheetSvgProps) {
  const width = contentWidth + SHEET_MARGIN * 2;
  const dotsId = `sheet-dots-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const { cell, inset, frameWidth, frameHeight, lineGap, lineHeight } = geometry;
  const top = sheetTop(Boolean(title));
  const height = sheetHeight(lines.length, geometry, Boolean(title), Boolean(footer));
  const centre = (pad: number) => {
    const { row, col } = instrument.pads[pad];
    return { cx: inset + col * cell + cell / 2, cy: inset + row * cell + cell / 2, row };
  };
  const half = 6.2;

  const click = (event: MouseEvent<SVGSVGElement>) => {
    const index = (event.target as Element).closest('[data-frame]')?.getAttribute('data-frame');
    if (index != null) onFrame?.(Number(index));
  };

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      fontFamily={FONT}
      onClick={onFrame ? click : undefined}
    >
      {theme.background && <rect width={width} height={height} fill={theme.background} />}
      <defs>
        <g id={dotsId}>
          {instrument.pads.map((pad) => {
            const { cx, cy, row } = centre(pad.index);
            return <circle key={pad.index} cx={cx} cy={cy} r={1.4} fill={theme.rows[row % 3]} fillOpacity={0.7} />;
          })}
        </g>
      </defs>

      {title && (
        <>
          <text x={SHEET_MARGIN} y={TOP_SPACE + 22} fontSize={22} fontWeight={650} fill={theme.ink}>
            {title.heading}
          </text>
          <text x={SHEET_MARGIN} y={TOP_SPACE + 41} fontSize={12} fill={theme.soft}>
            {title.detail}
          </text>
        </>
      )}

      {lines.map((line, row) => (
        <g key={row} transform={`translate(0 ${top + row * lineHeight})`}>
          {row > 0 && (
            <line
              x1={SHEET_MARGIN}
              x2={width - SHEET_MARGIN}
              y1={-lineGap / 2}
              y2={-lineGap / 2}
              stroke={theme.rule}
            />
          )}
          <text x={SHEET_MARGIN} y={frameHeight / 2} dy="0.35em" fontSize={10} fill={theme.soft}>
            {line.bar + 1}
          </text>
          {line.cells.map((item) => {
            const x = columnX(item.column, geometry);
            if (item.kind === 'rest') {
              return (
                <g key={`rest-${item.fromBar}`} transform={`translate(${x} 0)`}>
                  <text x={frameWidth / 2} y={frameHeight / 2 - 3} fontSize={11} fontWeight={600} textAnchor="middle" fill={theme.soft}>
                    rest
                  </text>
                  <text x={frameWidth / 2} y={frameHeight / 2 + 11} fontSize={10} textAnchor="middle" fill={theme.soft}>
                    {item.bars} {item.bars === 1 ? 'bar' : 'bars'}
                  </text>
                </g>
              );
            }
            const { frame } = item;
            return (
              <g
                key={frame.index}
                data-frame={frame.index}
                transform={`translate(${x} 0)`}
                style={onFrame ? { cursor: 'pointer' } : undefined}
              >
                <rect width={frameWidth} height={frameHeight} rx={6} fill={theme.frameFill} stroke={theme.frameStroke} />
                <use href={`#${dotsId}`} />
                {frame.pads.map((pad) => {
                  const { cx, cy, row } = centre(pad);
                  const colour = theme.rows[row % 3];
                  const text = keyText(instrument, projectKey, pad, labels);
                  const shape = keyShape(instrument, pad);
                  return (
                    <g key={pad}>
                      <rect x={cx - half} y={cy - half} width={half * 2} height={half * 2} rx={3} fill={colour} />
                      {text ? (
                        <text
                          x={cx}
                          y={cy}
                          dy="0.36em"
                          fontSize={text.length > 1 ? 7 : 8.5}
                          fontWeight={700}
                          textAnchor="middle"
                          fill={theme.onKey}
                        >
                          {text}
                        </text>
                      ) : (
                        <g fill="none" stroke={theme.onKey} strokeWidth={1.25}>
                          {shape !== 'diamond' && <circle cx={cx} cy={cy} r={shape === 'both' ? 2 : 3.4} />}
                          {shape !== 'circle' && <path d={diamond(cx, cy, shape === 'both' ? 4.6 : 4)} strokeLinejoin="round" />}
                        </g>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </g>
      ))}

      {onFrame && (
        <rect
          data-cursor=""
          width={frameWidth + 8}
          height={frameHeight + 8}
          rx={9}
          fill="none"
          stroke={theme.cursor}
          strokeWidth={2.5}
          visibility="hidden"
          pointerEvents="none"
        />
      )}

      {footer && (
        <text x={SHEET_MARGIN} y={height - 7} fontSize={9.5} fill={theme.soft}>
          {footer}
        </text>
      )}
    </svg>
  );
});
