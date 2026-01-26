const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function frequencyToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
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