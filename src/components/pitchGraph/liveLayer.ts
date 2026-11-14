import type { FrameSource } from '../../audio/frames';
import { graphPalette } from '../../theme';
import type { DetectionFilter } from '../../utils/pitch';
import { MAX_GAP_SECONDS } from './draw';
import { drawPitchLine } from './pitchLineLayer';
import { collectRuns, drawRuns, type NoteRuns } from './trailsLayer';

/**
 * Live mode repaints only this much of the right edge each frame. Frames are
 * stamped at the middle of their analysis window and reach the main thread a
 * little late, so they land slightly left of "now"; this has to cover that delay.
 */
const LIVE_TAIL_SECONDS = 0.3;
/**
 * Live mode's history (trails and pitch line) on an offscreen canvas that is
 * scrolled rather than redrawn: each frame shifts it left by whole device
 * pixels and repaints only the right-hand tail where new frames can land.
 * Anything that changes the picture (size, filter, trails toggle, window
 * length, freezing, a long stall) falls back to one full repaint.
 */
export class LiveLayer {
  private front = document.createElement('canvas');
  private back = document.createElement('canvas');
  private source: FrameSource | null = null;
  private pixelWidth = 0;
  private pixelHeight = 0;
  private dpr = 0;
  private width = 0;
  private height = 0;
  private historyDuration = 0;
  private lo = Number.NaN;
  private hi = Number.NaN;
  private clarity = Number.NaN;
  private cents = Number.NaN;
  private showTrails = false;
  private trailOpacity = Number.NaN;
  private palette = -1;
  /** Performance-clock time at the layer's right edge. */
  t1 = Number.NaN;

  render(
    source: FrameSource,
    t1: number,
    frozen: boolean,
    historyDuration: number,
    width: number,
    height: number,
    pixelWidth: number,
    pixelHeight: number,
    dpr: number,
    lo: number,
    hi: number,
    filter: DetectionFilter,
    showTrails: boolean,
    trailOpacity: number,
    runs: NoteRuns,
  ): HTMLCanvasElement {
    const changed =
      source !== this.source ||
      pixelWidth !== this.pixelWidth ||
      pixelHeight !== this.pixelHeight ||
      dpr !== this.dpr ||
      width !== this.width ||
      height !== this.height ||
      historyDuration !== this.historyDuration ||
      lo !== this.lo ||
      hi !== this.hi ||
      filter.clarityThreshold !== this.clarity ||
      filter.centsThreshold !== this.cents ||
      showTrails !== this.showTrails ||
      trailOpacity !== this.trailOpacity ||
      graphPalette.version !== this.palette;

    if (changed) {
      this.palette = graphPalette.version;
      if (pixelWidth !== this.pixelWidth || pixelHeight !== this.pixelHeight) {
        this.front.width = pixelWidth;
        this.front.height = pixelHeight;
        this.back.width = pixelWidth;
        this.back.height = pixelHeight;
      }
      this.source = source;
      this.pixelWidth = pixelWidth;
      this.pixelHeight = pixelHeight;
      this.dpr = dpr;
      this.width = width;
      this.height = height;
      this.historyDuration = historyDuration;
      this.lo = lo;
      this.hi = hi;
      this.clarity = filter.clarityThreshold;
      this.cents = filter.centsThreshold;
      this.showTrails = showTrails;
      this.trailOpacity = trailOpacity;
    }

    const pxPerSecond = width / historyDuration;
    const devicePxPerSecond = pxPerSecond * dpr;

    if (changed || frozen || !(t1 >= this.t1) || t1 - this.t1 >= historyDuration) {
      const ctx = this.front.getContext('2d');
      if (!ctx) return this.front;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, pixelWidth, pixelHeight);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.t1 = t1;
      this.paint(ctx, source, t1 - historyDuration, t1, pxPerSecond, filter, runs);
      return this.front;
    }

    // Whole device pixels only, so the copy stays sharp; the remainder carries over.
    const shift = Math.floor((t1 - this.t1) * devicePxPerSecond);
    if (shift > 0) {
      const backCtx = this.back.getContext('2d');
      if (backCtx) {
        backCtx.setTransform(1, 0, 0, 1, 0, 0);
        backCtx.clearRect(0, 0, pixelWidth, pixelHeight);
        backCtx.drawImage(this.front, -shift, 0);
        const swap = this.front;
        this.front = this.back;
        this.back = swap;
        this.t1 += shift / devicePxPerSecond;
      }
    }

    const ctx = this.front.getContext('2d');
    if (!ctx) return this.front;
    const repaint = Math.min(
      pixelWidth,
      Math.max(Math.ceil(LIVE_TAIL_SECONDS * devicePxPerSecond), shift + 2),
    );
    const left = pixelWidth - repaint;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(left, 0, repaint, pixelHeight);
    ctx.beginPath();
    ctx.rect(left, 0, repaint, pixelHeight);
    ctx.clip();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.paint(ctx, source, this.t1 - repaint / devicePxPerSecond, this.t1, pxPerSecond, filter, runs);
    ctx.restore();
    return this.front;
  }

  private paint(
    ctx: CanvasRenderingContext2D,
    source: FrameSource,
    from: number,
    to: number,
    pxPerSecond: number,
    filter: DetectionFilter,
    runs: NoteRuns,
  ) {
    const xOffset = this.width - this.t1 * pxPerSecond;
    if (this.showTrails) {
      collectRuns(source, from - MAX_GAP_SECONDS, to, filter, runs);
      drawRuns(ctx, runs, from, to, pxPerSecond, xOffset, this.lo, this.hi, this.height, this.width, this.trailOpacity);
    }
    drawPitchLine(ctx, source, from, to, pxPerSecond, xOffset, this.lo, this.hi, this.height, filter, MAX_GAP_SECONDS);
  }
}

