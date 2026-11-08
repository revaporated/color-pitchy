/** Called once per stored frame, in time order. */
export type FrameVisitor = (time: number, frequency: number, clarity: number) => void;

/** Anything the pitch graph or the MIDI exporter can read frames from. */
export interface FrameSource {
  /** Bumped on every write or clear, so renderers can tell whether anything changed. */
  readonly version: number;
  forEachInRange(t0: number, t1: number, visit: FrameVisitor): void;
}

/**
 * Fixed-size ring of recent frames, used by Live mode.
 * Times are whatever clock the caller pushes (Live uses performance seconds).
 */
export class FrameRing implements FrameSource {
  private readonly times: Float64Array;
  private readonly frequencies: Float32Array;
  private readonly clarities: Float32Array;
  private head = 0;
  private count = 0;
  readonly capacity: number;
  version = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.times = new Float64Array(capacity);
    this.frequencies = new Float32Array(capacity);
    this.clarities = new Float32Array(capacity);
  }

  push(frame: { time: number; frequency: number; clarity: number }) {
    this.times[this.head] = frame.time;
    this.frequencies[this.head] = frame.frequency;
    this.clarities[this.head] = frame.clarity;
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
    this.version += 1;
  }

  clear() {
    this.head = 0;
    this.count = 0;
    this.version += 1;
  }

  forEachInRange(t0: number, t1: number, visit: FrameVisitor) {
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i += 1) {
      const index = (start + i) % this.capacity;
      const time = this.times[index];
      if (time < t0) continue;
      if (time > t1) break;
      visit(time, this.frequencies[index], this.clarities[index]);
    }
  }
}

/**
 * Pitch data on a fixed time grid (bins of 1 / gridHz seconds), indexed by
 * position in a song. Used for both the Studio take and the reference contour.
 *
 * Writing over a region replaces what was there ("punch in"), so re-singing a
 * passage overwrites the old attempt while the rest of the take is kept.
 * Empty bins have NaN clarity.
 */
export class PitchTrack implements FrameSource {
  readonly gridHz: number;
  readonly frequency: Float32Array;
  readonly clarity: Float32Array;
  version = 0;
  private lastBin = -1;
  private readonly maxFillBins: number;

  constructor(durationSeconds: number, gridHz: number) {
    this.gridHz = gridHz;
    const length = Math.max(1, Math.ceil(Math.max(0, durationSeconds) * gridHz) + 1);
    this.frequency = new Float32Array(length);
    this.clarity = new Float32Array(length).fill(Number.NaN);
    this.maxFillBins = Math.ceil(gridHz * 0.05);
  }

  static fromArrays(frequency: Float32Array, clarity: Float32Array, gridHz: number) {
    const track = new PitchTrack((frequency.length - 1) / gridHz, gridHz);
    track.frequency.set(frequency.subarray(0, track.frequency.length));
    track.clarity.set(clarity.subarray(0, track.clarity.length));
    return track;
  }

  get length() {
    return this.frequency.length;
  }

  write(time: number, frequency: number, clarity: number) {
    const bin = Math.floor(time * this.gridHz);
    if (bin < 0 || bin >= this.length) {
      this.lastBin = -1;
      return;
    }

    // Within one continuous pass, fill the bins since the previous write so
    // stale data from an earlier take doesn't show through the gaps.
    const gap = bin - this.lastBin;
    const from = this.lastBin >= 0 && gap > 0 && gap <= this.maxFillBins ? this.lastBin + 1 : bin;
    for (let b = from; b <= bin; b += 1) {
      this.frequency[b] = frequency;
      this.clarity[b] = clarity;
    }
    this.lastBin = bin;
    this.version += 1;
  }

  /** Call after a seek so the next write doesn't bridge the jump. */
  breakContinuity() {
    this.lastBin = -1;
  }

  clear() {
    this.frequency.fill(0);
    this.clarity.fill(Number.NaN);
    this.lastBin = -1;
    this.version += 1;
  }

  hasData() {
    for (let b = 0; b < this.length; b += 1) {
      if (!Number.isNaN(this.clarity[b])) return true;
    }
    return false;
  }

  forEachInRange(t0: number, t1: number, visit: FrameVisitor) {
    const b0 = Math.max(0, Math.floor(t0 * this.gridHz));
    const b1 = Math.min(this.length - 1, Math.ceil(t1 * this.gridHz));
    for (let b = b0; b <= b1; b += 1) {
      const clarity = this.clarity[b];
      if (Number.isNaN(clarity)) continue;
      visit(b / this.gridHz, this.frequency[b], clarity);
    }
  }
}
