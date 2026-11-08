import type { FrameSource } from '../audio/frames';
import { frameToMidi, type DetectionFilter } from './pitch';

export type NoteEvent = {
  midi: number; // integer MIDI note
  start: number; // seconds
  end: number; // seconds
};

type TimedPitch = { time: number; midi: number | null };

type SegmentOptions = {
  /** Frames further apart than this start a new note. */
  maxGap?: number;
  /** Notes shorter than this are dropped (filters blips and scoops). */
  minDuration?: number;
  /** Median filter width in frames, applied before rounding to semitones. */
  medianWindow?: number;
};

/** Reads every frame from a source in [t0, t1] and applies the detection filter. */
export function collectPitches(
  source: FrameSource,
  t0: number,
  t1: number,
  filter: DetectionFilter,
  timeOffset = 0,
): TimedPitch[] {
  const out: TimedPitch[] = [];
  source.forEachInRange(t0, t1, (time, frequency, clarity) => {
    out.push({ time: time - timeOffset, midi: frameToMidi(frequency, clarity, filter) });
  });
  return out;
}

/**
 * Turns a pitch contour into discrete notes: median-smooth, round to the
 * nearest semitone, split on pitch changes and gaps, drop very short notes,
 * then merge same-pitch neighbours separated by a short gap.
 */
export function segmentNotes(
  frames: TimedPitch[],
  { maxGap = 0.06, minDuration = 0.06, medianWindow = 5 }: SegmentOptions = {},
): NoteEvent[] {
  if (frames.length === 0) return [];

  const frameDuration = estimateFrameDuration(frames);
  const half = Math.floor(medianWindow / 2);
  const smoothed: TimedPitch[] = frames.map((frame, i) => {
    if (frame.midi == null) return frame;
    const window: number[] = [];
    for (let j = Math.max(0, i - half); j <= Math.min(frames.length - 1, i + half); j += 1) {
      const other = frames[j];
      if (other.midi != null && Math.abs(other.time - frame.time) <= maxGap * half) {
        window.push(other.midi);
      }
    }
    window.sort((a, b) => a - b);
    return { time: frame.time, midi: window[Math.floor(window.length / 2)] };
  });

  const raw: NoteEvent[] = [];
  let current: { midi: number; start: number; last: number } | null = null;
  const close = () => {
    if (current) raw.push({ midi: current.midi, start: current.start, end: current.last + frameDuration });
    current = null;
  };

  for (const frame of smoothed) {
    if (frame.midi == null) {
      close();
      continue;
    }
    const note = Math.round(frame.midi);
    if (current && current.midi === note && frame.time - current.last <= maxGap) {
      current.last = frame.time;
    } else {
      close();
      current = { midi: note, start: frame.time, last: frame.time };
    }
  }
  close();

  const merged: NoteEvent[] = [];
  for (const note of raw) {
    if (note.end - note.start < minDuration) continue;
    const previous = merged[merged.length - 1];
    if (previous && previous.midi === note.midi && note.start - previous.end <= maxGap) {
      previous.end = note.end;
    } else {
      merged.push({ ...note });
    }
  }
  return merged;
}

function estimateFrameDuration(frames: TimedPitch[]) {
  const deltas: number[] = [];
  for (let i = 1; i < frames.length && deltas.length < 200; i += 1) {
    const dt = frames[i].time - frames[i - 1].time;
    if (dt > 0) deltas.push(dt);
  }
  if (deltas.length === 0) return 1 / 165;
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)];
}
