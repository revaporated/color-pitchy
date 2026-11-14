import type { FrameSource } from '../../audio/frames';
import { graphPalette } from '../../theme';
import { frameToMidi, type DetectionFilter } from '../../utils/pitch';
import { MAX_GAP_SECONDS, mapMidiToY } from './draw';

const lineState = {
  ctx: null as CanvasRenderingContext2D | null,
  filter: null as DetectionFilter | null,
  xScale: 0,
  xOffset: 0,
  lo: 0,
  hi: 1,
  h: 0,
  drawing: false,
  previousTime: Number.NEGATIVE_INFINITY,
};

function visitLine(time: number, frequency: number, clarity: number) {
  const s = lineState;
  const ctx = s.ctx;
  const filter = s.filter;
  if (!ctx || !filter) return;
  const midi = frameToMidi(frequency, clarity, filter);
  if (midi === null || time - s.previousTime > MAX_GAP_SECONDS) s.drawing = false;
  s.previousTime = time;
  if (midi === null) return;
  const x = s.xScale * time + s.xOffset;
  const y = mapMidiToY(midi, s.h, s.lo, s.hi);
  if (s.drawing) {
    ctx.lineTo(x, y);
  } else {
    ctx.moveTo(x, y);
    s.drawing = true;
  }
}

/** Dark pitch line, broken at unvoiced frames and gaps. */
export function drawPitchLine(
  ctx: CanvasRenderingContext2D,
  source: FrameSource,
  t0: number,
  t1: number,
  xScale: number,
  xOffset: number,
  lo: number,
  hi: number,
  h: number,
  filter: DetectionFilter,
  /** Extra time read past each edge so lines run off-canvas instead of stopping short. */
  margin: number,
) {
  ctx.save();
  ctx.strokeStyle = graphPalette.takeLine;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const s = lineState;
  s.ctx = ctx;
  s.filter = filter;
  s.xScale = xScale;
  s.xOffset = xOffset;
  s.lo = lo;
  s.hi = hi;
  s.h = h;
  s.drawing = false;
  s.previousTime = Number.NEGATIVE_INFINITY;
  source.forEachInRange(t0 - margin, t1 + margin, visitLine);
  s.ctx = null;
  s.filter = null;
  ctx.stroke();
  ctx.restore();
}

