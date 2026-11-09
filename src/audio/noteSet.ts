import type { FrameSource } from './frames';
import { collectPitches, segmentNotes, type NoteEvent } from '../utils/notes';
import type { DetectionFilter } from '../utils/pitch';

/** Where a note came from. Re-analysis may replace 'auto' notes; 'manual' ones are yours. */
export type NoteOrigin = 'auto' | 'manual';

/**
 * One reference note. Unlike a contour frame, notes can overlap in time, so a
 * set of them can hold chords or several voices.
 */
export type RefNote = NoteEvent & {
  /**
   * Stable within a set. Manual notes keep theirs across re-analysis; an auto
   * note's id is derived from its pitch and start, so it changes if they do.
   */
  id: string;
  /** 0 = top voice. Lower voices count up from there. */
  voice: number;
  origin: NoteOrigin;
};

export type ContourNoteOptions = {
  /** Median filter width in frames before rounding. 1 turns it off (use for tracked contours). */
  medianWindow?: number;
  /** Notes shorter than this (seconds) are dropped. */
  minDuration?: number;
};

let nextVersion = 1;

/**
 * An immutable, start-sorted list of notes with fast range lookup. Anything
 * that changes the notes builds a new set, so React can compare by identity
 * and the graph and player can tell by `version` that they need to redo work.
 */
export class NoteSet {
  readonly notes: readonly RefNote[];
  readonly version = nextVersion++;
  /** Longest note, so a range query knows how far back an overlapping note can start. */
  private readonly maxDuration: number;

  constructor(notes: readonly RefNote[]) {
    const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
    this.notes = sorted;
    let longest = 0;
    for (const note of sorted) longest = Math.max(longest, note.end - note.start);
    this.maxDuration = longest;
  }

  /**
   * Segments a single-voice contour into notes (one voice, all 'auto').
   * Frames are filtered by `filter`, then rounded and split on pitch changes and gaps.
   */
  static fromContour(
    source: FrameSource,
    duration: number,
    filter: DetectionFilter,
    { medianWindow = 5, minDuration = 0.08 }: ContourNoteOptions = {},
  ) {
    const events = segmentNotes(collectPitches(source, 0, duration, filter), { medianWindow, minDuration });
    return new NoteSet(
      events.map((event) => ({
        ...event,
        id: `a:${event.midi}:${event.start.toFixed(3)}`,
        voice: 0,
        origin: 'auto' as const,
      })),
    );
  }

  get count() {
    return this.notes.length;
  }

  /** Index of the first note that could still be sounding at `time`. */
  private firstPossiblyOverlapping(time: number) {
    const from = time - this.maxDuration;
    let low = 0;
    let high = this.notes.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.notes[mid].start < from) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  /** Visits every note overlapping [t0, t1], in start order. */
  forEachOverlapping(t0: number, t1: number, visit: (note: RefNote) => void) {
    for (let i = this.firstPossiblyOverlapping(t0); i < this.notes.length; i += 1) {
      const note = this.notes[i];
      if (note.start > t1) break;
      if (note.end >= t0) visit(note);
    }
  }

  /**
   * The note drawn at (time, midi), if any. Manual notes win over auto ones,
   * then the latest start. `slack` widens short notes so they stay clickable.
   */
  noteAt(time: number, midi: number, slack = 0) {
    let best: RefNote | null = null;
    this.forEachOverlapping(time - slack, time + slack, (note) => {
      if (note.midi !== midi) return;
      if (time < note.start - slack || time > note.end + slack) return;
      if (
        !best ||
        (note.origin === 'manual' && best.origin !== 'manual') ||
        (note.origin === best.origin && note.start >= best.start)
      ) {
        best = note;
      }
    });
    return best as RefNote | null;
  }

  findById(id: string) {
    return this.notes.find((note) => note.id === id) ?? null;
  }

  /** Index of the first note starting at or after `time`. */
  firstStartingAt(time: number) {
    let low = 0;
    let high = this.notes.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.notes[mid].start < time) low = mid + 1;
      else high = mid;
    }
    return low;
  }
}
