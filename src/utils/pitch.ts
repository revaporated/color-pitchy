const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export type NoteIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export type PitchColorShape = {
  color: string;
  shape: 'square' | 'circle';
  rgb: string;
};

export const PITCH_COLOR_SHAPE_MAP: Record<NoteIndex, PitchColorShape> = {
  0: { color: 'red', shape: 'square', rgb: '219,50,73' },
  1: { color: 'green-blue', shape: 'circle', rgb: '0,176,164' },
  2: { color: 'orange', shape: 'square', rgb: '245,137,43' },
  3: { color: 'blue-purple', shape: 'circle', rgb: '67,70,180' },
  4: { color: 'yellow', shape: 'square', rgb: '245,222,0' },
  5: { color: 'purple-red', shape: 'circle', rgb: '194,44,147' },
  6: { color: 'green', shape: 'square', rgb: '58,160,70' },
  7: { color: 'red-orange', shape: 'circle', rgb: '255,86,47' },
  8: { color: 'blue', shape: 'square', rgb: '0,114,221' },
  9: { color: 'orange-yellow', shape: 'circle', rgb: '252,185,30' },
  10: { color: 'purple', shape: 'square', rgb: '110,51,128' },
  11: { color: 'yellow-green', shape: 'circle', rgb: '172,207,67' },
};

/** What the stats panel shows. `midi` is null when the frame fails the filter. */
export type PitchSample = {
  timestamp: number;
  frequency: number | null;
  clarity: number | null;
  midi: number | null;
};

/** Which raw frames count as a detected note. Applied at draw/export time, not at detection. */
export type DetectionFilter = {
  clarityThreshold: number; // 0..1
  centsThreshold: number; // 0..50; 50 or more disables the cents gate
  minMidi: number;
  maxMidi: number;
};

export function frequencyToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

/** Returns the fractional MIDI note for a raw frame, or null if it fails the filter. */
export function frameToMidi(
  frequency: number,
  clarity: number,
  filter: DetectionFilter,
): number | null {
  if (!(frequency > 0) || !(clarity >= filter.clarityThreshold)) return null;
  const midi = frequencyToMidi(frequency);
  if (midi < filter.minMidi || midi > filter.maxMidi) return null;
  if (filter.centsThreshold < 50) {
    const cents = Math.abs(midi - Math.round(midi)) * 100;
    if (cents > filter.centsThreshold) return null;
  }
  return midi;
}

export function midiToNoteIndex(midi: number): NoteIndex {
  const nearest = Math.round(midi);
  const noteIndex = ((nearest % 12) + 12) % 12;
  return noteIndex as NoteIndex;
}

export function midiToNoteName(midi: number) {
  const nearest = Math.round(midi);
  const noteIndex = ((nearest % 12) + 12) % 12;
  const octave = Math.floor(nearest / 12) - 1;
  const cents = Math.round((midi - nearest) * 100);

  return { note: NOTE_NAMES[noteIndex], octave, cents };
}

export function formatNoteLabel(midi: number) {
  const { note, octave, cents } = midiToNoteName(midi);
  const sign = cents >= 0 ? '+' : '';
  return `${note}${octave} (${sign}${cents}c)`;
}
