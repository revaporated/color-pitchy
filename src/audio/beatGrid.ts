/** How the detected beats are used: as found, every other one, or with a beat between each pair. */
export type BeatScale = 0.5 | 1 | 2;

/**
 * The beats the app works with: the detected beats rescaled (detectors often
 * land on half or double the felt tempo), counted in groups of `perGroup`
 * (bars, usually) starting at beat `offset`.
 */
export class BeatGrid {
  readonly times: Float64Array;
  readonly perGroup: number;
  readonly offset: number;
  readonly bpm: number;

  constructor(detected: Float64Array, scale: BeatScale, perGroup: number, offset: number) {
    this.times = rescale(detected, scale);
    this.perGroup = Math.max(1, perGroup);
    this.offset = ((offset % this.perGroup) + this.perGroup) % this.perGroup;
    this.bpm = medianBpm(this.times);
  }

  get count() {
    return this.times.length;
  }

  /** Which group (bar) beat `i` is in. Beats before `offset` belong to group -1. */
  groupOf(i: number) {
    return Math.floor((i - this.offset) / this.perGroup);
  }

  isGroupStart(i: number) {
    return (i - this.offset) % this.perGroup === 0;
  }

  /** Index of the first beat at or after `time`. */
  firstAtOrAfter(time: number) {
    let low = 0;
    let high = this.times.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.times[mid] < time) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  /** The beat nearest `time`, or `time` itself if there are no beats. */
  nearest(time: number) {
    if (this.times.length === 0) return time;
    const i = this.firstAtOrAfter(time);
    if (i === 0) return this.times[0];
    if (i === this.times.length) return this.times[i - 1];
    return time - this.times[i - 1] <= this.times[i] - time ? this.times[i - 1] : this.times[i];
  }
}

function rescale(beats: Float64Array, scale: BeatScale) {
  if (scale === 1 || beats.length < 2) return beats;
  if (scale === 0.5) return beats.filter((_, i) => i % 2 === 0);
  const out = new Float64Array(beats.length * 2 - 1);
  for (let i = 0; i < beats.length; i += 1) {
    out[i * 2] = beats[i];
    if (i + 1 < beats.length) out[i * 2 + 1] = (beats[i] + beats[i + 1]) / 2;
  }
  return out;
}

function medianBpm(times: Float64Array) {
  if (times.length < 2) return 0;
  const gaps = Array.from({ length: times.length - 1 }, (_, i) => times[i + 1] - times[i]).sort((a, b) => a - b);
  const median = gaps[gaps.length >> 1];
  return median > 0 ? 60 / median : 0;
}
