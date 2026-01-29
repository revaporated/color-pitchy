import MidiWriter from 'midi-writer-js';
import { midiToNoteName } from './pitch';

export type RecordedPitchSample = {
  timestampMs: number;
  midi: number | null;
  clarity: number | null;
};

export type RecordedNote = {
  midiNote: number;
  startMs: number;
  endMs: number;
  durationMs: number;
};

const TEMPO_BPM = 120;
const TICKS_PER_BEAT = 128;
const MS_PER_BEAT = 60000 / TEMPO_BPM;

const msToTicks = (ms: number) =>
  Math.max(1, Math.round((ms / MS_PER_BEAT) * TICKS_PER_BEAT));

export const formatMidiFilename = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}${seconds}.mid`;
};

export const buildNotesFromSamples = (
  samples: RecordedPitchSample[],
  recordingEndMs: number
) => {
  if (samples.length === 0) return [];

  const notes: RecordedNote[] = [];
  let activeMidi: number | null = null;
  let noteStart = 0;

  for (const sample of samples) {
    const currentMidi = sample.midi == null ? null : Math.round(sample.midi);
    const timestamp = sample.timestampMs;

    if (activeMidi == null && currentMidi != null) {
      activeMidi = currentMidi;
      noteStart = timestamp;
      continue;
    }

    if (activeMidi != null && currentMidi !== activeMidi) {
      const endMs = timestamp;
      const durationMs = endMs - noteStart;
      if (durationMs > 0) {
        notes.push({
          midiNote: activeMidi,
          startMs: noteStart,
          endMs,
          durationMs,
        });
      }
      activeMidi = currentMidi;
      if (currentMidi != null) {
        noteStart = timestamp;
      }
    }
  }

  if (activeMidi != null) {
    const endMs = Math.max(noteStart, recordingEndMs);
    const durationMs = endMs - noteStart;
    if (durationMs > 0) {
      notes.push({
        midiNote: activeMidi,
        startMs: noteStart,
        endMs,
        durationMs,
      });
    }
  }

  return notes;
};

export const buildMidiBlob = (notes: RecordedNote[]) => {
  if (notes.length === 0) return null;

  const track = new MidiWriter.Track();
  track.setTempo(TEMPO_BPM);

  let lastEndMs = 0;
  for (const note of notes) {
    const { note: noteName, octave } = midiToNoteName(note.midiNote);
    const pitch = `${noteName}${octave}`;
    const durationTicks = msToTicks(note.durationMs);
    const gapMs = Math.max(0, note.startMs - lastEndMs);
    const waitTicks = gapMs > 0 ? msToTicks(gapMs) : 0;

    const eventOptions: {
      pitch: string[];
      duration: string;
      wait?: string;
    } = {
      pitch: [pitch],
      duration: `T${durationTicks}`,
    };

    if (waitTicks > 0) {
      eventOptions.wait = `T${waitTicks}`;
    }

    track.addEvent(new MidiWriter.NoteEvent(eventOptions));
    lastEndMs = note.endMs;
  }

  const writer = new MidiWriter.Writer([track]);
  const midiData = writer.buildFile();

  return new Blob([midiData], { type: 'audio/midi' });
};
