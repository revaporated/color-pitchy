import { PIXELS_PER_SECOND } from '../utils/waveform';

/**
 * The shared time axis of the Studio timeline: how song time maps to x in the
 * waveform and the pitch graph. The waveform owns the scrolling and writes
 * `scrollLeft`, `width`, `contentWidth` and `playheadX` here; the graph and
 * the pen read them. Plain mutable fields, read on every animation frame.
 */
export class TimelineView {
  readonly pixelsPerSecond: number;
  /** Scroll position of the timeline, in px from song time 0. */
  scrollLeft = 0;
  /** Visible width in px. */
  width = 0;
  /** Width of the whole song in px. */
  contentWidth = 0;
  /** Song length in seconds, 0 when unknown. */
  duration = 0;
  /** The playhead's x in the viewport as the waveform last placed it, or null. The graph draws its playhead here. */
  playheadX: number | null = null;

  constructor(pixelsPerSecond = PIXELS_PER_SECOND) {
    this.pixelsPerSecond = pixelsPerSecond;
  }

  /** Called by the waveform when its viewport scrolls or resizes. */
  setViewport(scrollLeft: number, width: number) {
    this.scrollLeft = scrollLeft;
    this.width = width;
  }

  /** Called by the waveform when the track (and so the content) changes. */
  setContent(contentWidth: number, duration: number) {
    this.contentWidth = contentWidth;
    this.duration = duration;
  }

  setPlayheadX(x: number | null) {
    this.playheadX = x;
  }

  /** Viewport x of a song time. */
  timeToX(time: number) {
    return time * this.pixelsPerSecond - this.scrollLeft;
  }

  /** Song time at a viewport x (not clamped). */
  xToTime(x: number) {
    return (x + this.scrollLeft) / this.pixelsPerSecond;
  }

  /** Song time at a viewport x, kept within the song. */
  clampedTimeAt(x: number) {
    const time = Math.max(0, this.xToTime(x));
    return this.duration > 0 ? Math.min(time, this.duration) : time;
  }

  get startTime() {
    return this.scrollLeft / this.pixelsPerSecond;
  }

  get endTime() {
    return (this.scrollLeft + this.width) / this.pixelsPerSecond;
  }

  get maxScroll() {
    return Math.max(0, this.contentWidth - this.width);
  }

  /** The scroll that puts `time` in the middle of the view, kept within the content. */
  centeredScroll(time: number) {
    return Math.max(0, Math.min(time * this.pixelsPerSecond - this.width / 2, this.maxScroll));
  }

  /**
   * Playhead x for `time` with the view scrolled to `scroll`: kept inside the
   * viewport and snapped to a device pixel, so it never straddles two pixels.
   */
  playheadXFor(time: number, scroll: number, dpr: number, playheadWidth: number) {
    const raw = time * this.pixelsPerSecond - scroll;
    const max = Math.max(0, this.width - playheadWidth);
    return Math.round(Math.max(0, Math.min(raw, max)) * dpr) / dpr;
  }
}
