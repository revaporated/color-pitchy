/** Shared pieces of the pitch graph's drawing: the pitch axis, colors and marks. */
import { PITCH_COLOR_SHAPE_MAP } from '../../utils/pitch';

export const MAX_GAP_SECONDS = 0.06; // break lines across gaps longer than this
// Built once so the draw loop doesn't allocate a color string per rectangle.
export const NOTE_FILL = Array.from({ length: 12 }, (_, i) =>
  `rgb(${PITCH_COLOR_SHAPE_MAP[i as keyof typeof PITCH_COLOR_SHAPE_MAP].rgb})`,
);

export function mapMidiToY(midi: number, height: number, lo: number, hi: number) {
  const clamped = Math.max(lo, Math.min(hi, midi));
  return ((hi - clamped) / (hi - lo)) * height;
}

/**
 * A full-height line as a filled rectangle whose left edge is snapped to a
 * device pixel. A stroked line centered on a fractional x is antialiased
 * across two pixels, and as x moves that blur shifts, which reads as jitter.
 */
export function drawVerticalLine(
  ctx: CanvasRenderingContext2D,
  x: number,
  h: number,
  color: string,
  lineWidth: number,
  alpha: number,
  dpr: number,
) {
  if (!Number.isFinite(x)) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.fillRect(Math.round(x * dpr) / dpr, 0, lineWidth, h);
  ctx.restore();
}

export function drawMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  shape: 'square' | 'circle',
  fill: string,
) {
  ctx.fillStyle = fill;
  if (shape === 'square') {
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    return;
  }
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

/** Same color as the waveform's selection (`.waveform-selection` in index.css). */
const SELECTION_FILL = 'rgba(148, 197, 255, 0.18)';

/** The selected passage as a full-height band. */
export function drawSelectionBand(
  ctx: CanvasRenderingContext2D,
  selection: { start: number; end: number },
  xScale: number,
  xOffset: number,
  width: number,
  h: number,
) {
  const left = Math.max(0, xScale * Math.min(selection.start, selection.end) + xOffset);
  const right = Math.min(width, xScale * Math.max(selection.start, selection.end) + xOffset);
  if (right <= left) return;
  ctx.save();
  ctx.fillStyle = SELECTION_FILL;
  ctx.fillRect(left, 0, right - left, h);
  ctx.restore();
}
