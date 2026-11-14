import type { BeatGrid } from '../../audio/beatGrid';
import { graphPalette } from '../../theme';

/** Every other group of beats (bar) gets a faint dark band. */
export function drawBeatBands(
  ctx: CanvasRenderingContext2D,
  beats: BeatGrid,
  t0: number,
  t1: number,
  xScale: number,
  xOffset: number,
  width: number,
  h: number,
) {
  const times = beats.times;
  if (times.length < 2) return;
  ctx.save();
  ctx.fillStyle = graphPalette.beatBand;
  // Start a group back so a band that began off-screen is still drawn.
  const first = Math.max(0, beats.firstAtOrAfter(t0) - beats.perGroup);
  for (let i = first; i < times.length; i += 1) {
    if (times[i] > t1) break;
    const group = beats.groupOf(i);
    if (group % 2 === 0 || !beats.isGroupStart(i)) continue;
    const end = i + beats.perGroup < times.length ? times[i + beats.perGroup] : times[times.length - 1];
    const left = Math.max(0, xScale * times[i] + xOffset);
    const right = Math.min(width, xScale * end + xOffset);
    if (right > left) ctx.fillRect(left, 0, right - left, h);
  }
  ctx.restore();
}

/** Short ticks on the top and bottom edges at each beat, longer on group starts. */
export function drawBeatTicks(
  ctx: CanvasRenderingContext2D,
  beats: BeatGrid,
  t0: number,
  t1: number,
  xScale: number,
  xOffset: number,
  h: number,
) {
  const times = beats.times;
  ctx.save();
  ctx.lineWidth = 1;
  for (let i = beats.firstAtOrAfter(t0 - 1 / xScale); i < times.length; i += 1) {
    if (times[i] > t1) break;
    const x = Math.round(xScale * times[i] + xOffset) + 0.5;
    const major = beats.isGroupStart(i);
    const length = major ? 12 : 6;
    ctx.strokeStyle = major ? graphPalette.beatTickMajor : graphPalette.beatTick;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, length);
    ctx.moveTo(x, h - length);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  ctx.restore();
}

