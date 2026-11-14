import type { FrameSource } from '../../audio/frames';
import { frameToMidi, type DetectionFilter } from '../../utils/pitch';
import { MAX_GAP_SECONDS, mapMidiToY, NOTE_FILL } from './draw';

/**
 * Note trails as runs: one entry per stretch of frames on the same semitone,
 * so a held note is one rectangle instead of one per frame (which also stops
 * overlapping translucent rectangles from stacking into darker bands).
 * Typed arrays, grown as needed and reused, so building runs doesn't allocate per frame.
 */
export class NoteRuns {
  starts = new Float64Array(256);
  ends = new Float64Array(256);
  notes = new Int16Array(256);
  /** 1 when the run ended at a gap, so its last frame gets a minimum 2 px width. */
  padded = new Uint8Array(256);
  count = 0;

  clear() {
    this.count = 0;
  }

  push(start: number, end: number, note: number, padded: number) {
    if (this.count === this.starts.length) this.grow();
    const i = this.count;
    this.starts[i] = start;
    this.ends[i] = end;
    this.notes[i] = note;
    this.padded[i] = padded;
    this.count = i + 1;
  }

  /** Index of the first run ending at or after `time` (runs are in time order). */
  firstEndingAfter(time: number) {
    let low = 0;
    let high = this.count;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.ends[mid] < time) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  private grow() {
    const size = this.starts.length * 2;
    const starts = new Float64Array(size);
    starts.set(this.starts);
    const ends = new Float64Array(size);
    ends.set(this.ends);
    const notes = new Int16Array(size);
    notes.set(this.notes);
    const padded = new Uint8Array(size);
    padded.set(this.padded);
    this.starts = starts;
    this.ends = ends;
    this.notes = notes;
    this.padded = padded;
  }
}

// Visitor state lives at module level so forEachInRange gets the same function
// every frame instead of a fresh closure. Drawing is never re-entrant.
const runState = {
  out: null as NoteRuns | null,
  filter: null as DetectionFilter | null,
  active: false,
  note: 0,
  start: 0,
  last: 0,
};

function visitRun(time: number, frequency: number, clarity: number) {
  const s = runState;
  const out = s.out;
  const filter = s.filter;
  if (!out || !filter) return;
  const midi = frameToMidi(frequency, clarity, filter);
  if (s.active) {
    if (time - s.last <= MAX_GAP_SECONDS) {
      if (midi !== null && Math.round(midi) === s.note) {
        s.last = time;
        return;
      }
      // Pitch changed or went unvoiced: the run reaches this frame.
      out.push(s.start, time, s.note, 0);
    } else {
      out.push(s.start, s.last, s.note, 1);
    }
  }
  if (midi === null) {
    s.active = false;
    return;
  }
  s.active = true;
  s.note = Math.round(midi);
  s.start = time;
  s.last = time;
}

export function collectRuns(source: FrameSource, t0: number, t1: number, filter: DetectionFilter, out: NoteRuns) {
  out.clear();
  runState.out = out;
  runState.filter = filter;
  runState.active = false;
  source.forEachInRange(t0, t1, visitRun);
  if (runState.active) out.push(runState.start, runState.last, runState.note, 1);
  runState.out = null;
  runState.filter = null;
}

/** Translucent note-height bars in each note's color, for the runs visible in [t0, t1]. */
export function drawRuns(
  ctx: CanvasRenderingContext2D,
  runs: NoteRuns,
  t0: number,
  t1: number,
  xScale: number,
  xOffset: number,
  lo: number,
  hi: number,
  h: number,
  width: number,
  alpha: number,
) {
  if (runs.count === 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  let currentFill = -1;
  for (let i = runs.firstEndingAfter(t0 - 2 / xScale); i < runs.count; i += 1) {
    const start = runs.starts[i];
    if (start > t1) break;
    const startX = xScale * start + xOffset;
    const endX = xScale * runs.ends[i] + xOffset + (runs.padded[i] ? 2 : 0);
    const left = Math.max(0, startX);
    const right = Math.min(width, endX);
    if (right <= 0 || left >= width) continue;
    const note = runs.notes[i];
    const top = mapMidiToY(note + 0.5, h, lo, hi);
    const bottom = mapMidiToY(note - 0.5, h, lo, hi);
    const fill = ((note % 12) + 12) % 12;
    if (fill !== currentFill) {
      ctx.fillStyle = NOTE_FILL[fill];
      currentFill = fill;
    }
    ctx.fillRect(left, Math.min(top, bottom), Math.max(2, right - left), Math.abs(bottom - top));
  }
  ctx.restore();
}

