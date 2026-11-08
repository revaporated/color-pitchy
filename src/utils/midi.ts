import type { NoteEvent } from './notes';

type MidiOptions = {
  bpm?: number;
  ppq?: number;
  velocity?: number;
};

/**
 * Writes a format-0 Standard MIDI File. Note times are kept exact (in seconds
 * at the given tempo), not snapped to a grid.
 */
export function buildMidiFile(
  notes: NoteEvent[],
  { bpm = 120, ppq = 480, velocity = 90 }: MidiOptions = {},
): Uint8Array {
  const ticksPerSecond = (ppq * bpm) / 60;
  type Event = { tick: number; order: number; bytes: number[] };
  const events: Event[] = [];

  for (const note of notes) {
    const pitch = Math.max(0, Math.min(127, Math.round(note.midi)));
    const on = Math.max(0, Math.round(note.start * ticksPerSecond));
    const off = Math.max(on + 1, Math.round(note.end * ticksPerSecond));
    events.push({ tick: on, order: 1, bytes: [0x90, pitch, velocity] });
    events.push({ tick: off, order: 0, bytes: [0x80, pitch, 0] });
  }
  // Note-offs before note-ons at the same tick, so repeated notes don't overlap.
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const microsecondsPerBeat = Math.round(60_000_000 / bpm);
  const track: number[] = [
    0x00, 0xff, 0x51, 0x03,
    (microsecondsPerBeat >> 16) & 0xff,
    (microsecondsPerBeat >> 8) & 0xff,
    microsecondsPerBeat & 0xff,
  ];

  let lastTick = 0;
  for (const event of events) {
    track.push(...variableLength(event.tick - lastTick), ...event.bytes);
    lastTick = event.tick;
  }
  track.push(0x00, 0xff, 0x2f, 0x00);

  const header = [
    ...ascii('MThd'), 0, 0, 0, 6,
    0, 0, // format 0
    0, 1, // one track
    (ppq >> 8) & 0xff, ppq & 0xff,
  ];
  const trackHeader = [...ascii('MTrk'), ...uint32(track.length)];
  return new Uint8Array([...header, ...trackHeader, ...track]);
}

export function downloadBytes(bytes: Uint8Array, filename: string, type = 'audio/midi') {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatTimestampFilename(date: Date, suffix = '') {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${stamp}${suffix}.mid`;
}

function variableLength(value: number) {
  let v = Math.max(0, Math.round(value));
  const bytes = [v & 0x7f];
  v >>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

function uint32(value: number) {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function ascii(text: string) {
  return Array.from(text, (ch) => ch.charCodeAt(0));
}
