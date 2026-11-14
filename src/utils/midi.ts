import type { NoteEvent } from './notes';

/**
 * The beats an export follows: beat times in seconds, counted in bars of
 * `perGroup` beats, with beat `offset` the first downbeat. `BeatGrid` fits.
 */
export type MidiBeatGrid = {
  times: ArrayLike<number>;
  perGroup: number;
  offset: number;
};

type MidiOptions = {
  /** Fixed tempo, used only without `beats`. */
  bpm?: number;
  ppq?: number;
  velocity?: number;
  /** With two or more beats, the file follows them (see `buildTempoMap`). */
  beats?: MidiBeatGrid | null;
  /** Name of the note track (beat-aligned files only). */
  trackName?: string;
};

type Event = { tick: number; order: number; bytes: number[] };

/** Meta events first at a tick, then note-offs, then note-ons, so repeated notes don't overlap. */
const ORDER_META = -1;
const ORDER_OFF = 0;
const ORDER_ON = 1;

/**
 * Writes a Standard MIDI File. Note times are kept exact, not snapped to a grid.
 *
 * - With `beats`: format 1. Track 1 holds the tempo map (one tempo event per
 *   beat, so beat i is at tick i * ppq) and the time signature; track 2 holds
 *   the notes. Bars in a MIDI editor then line up with the music.
 * - Without: format 0 at a fixed `bpm`, as before.
 */
export function buildMidiFile(
  notes: readonly NoteEvent[],
  { bpm = 120, ppq = 480, velocity = 90, beats = null, trackName }: MidiOptions = {},
): Uint8Array {
  let end = 0;
  for (const note of notes) end = Math.max(end, note.end);
  const map = beats ? buildTempoMap(beats, end, ppq) : null;

  if (!map) {
    const ticksPerSecond = (ppq * bpm) / 60;
    const events = noteEvents(notes, (seconds) => seconds * ticksPerSecond, velocity);
    events.push({ tick: 0, order: ORDER_META, bytes: tempoBytes(Math.round(60_000_000 / bpm)) });
    return midiFile(0, ppq, [trackBytes(events)]);
  }

  const conductor: Event[] = [
    { tick: 0, order: ORDER_META, bytes: timeSignatureBytes(map.beatsPerBar) },
  ];
  for (let k = 0; k + 1 < map.beatTimes.length; k += 1) {
    const microseconds = Math.round((map.beatTimes[k + 1] - map.beatTimes[k]) * 1_000_000);
    conductor.push({ tick: k * ppq, order: ORDER_META, bytes: tempoBytes(microseconds) });
  }
  const track = noteEvents(notes, map.toTick, velocity);
  if (trackName) track.push({ tick: 0, order: ORDER_META, bytes: textMeta(0x03, trackName) });
  return midiFile(1, ppq, [trackBytes(conductor), trackBytes(track)]);
}

export type TempoMap = {
  ppq: number;
  /** One time per MIDI beat: beat k of the file is at beatTimes[k] seconds. */
  beatTimes: Float64Array;
  beatsPerBar: number;
  /** Index into `beatTimes` of the grid's beat 0. */
  firstBeat: number;
  /** Song seconds to ticks, by interpolation between the two beats around the time. */
  toTick: (seconds: number) => number;
};

/**
 * Maps song time to MIDI ticks so that each beat of the grid is one quarter note.
 *
 * The grid is extended backwards with its first interval to a downbeat at or
 * before 0 s, so the file starts on a bar line and every bar is whole (a pickup
 * becomes a partly empty first bar). It is extended forwards with its last
 * interval to cover `endTime`. Returns null with fewer than two usable beats.
 */
export function buildTempoMap(beats: MidiBeatGrid, endTime: number, ppq = 480): TempoMap | null {
  const src = beats.times;
  const n = src.length;
  if (n < 2) return null;
  const first = src[1] - src[0];
  const last = src[n - 1] - src[n - 2];
  if (!(first > 0) || !(last > 0)) return null;
  const perBar = Math.max(1, Math.round(beats.perGroup));
  const offset = mod(Math.round(beats.offset), perBar);

  const timeOf = (i: number) => (i < 0 ? src[0] + i * first : i < n ? src[i] : src[n - 1] + (i - n + 1) * last);
  let start = 0;
  while (!(timeOf(start) <= 0 && mod(start - offset, perBar) === 0)) start -= 1;
  let stop = n - 1;
  while (timeOf(stop) < endTime) stop += 1;
  stop = Math.max(stop, start + 1);

  const beatTimes = new Float64Array(stop - start + 1);
  for (let k = 0; k < beatTimes.length; k += 1) beatTimes[k] = timeOf(start + k);
  for (let k = 1; k < beatTimes.length; k += 1) {
    if (!(beatTimes[k] > beatTimes[k - 1])) return null;
  }

  const lastIndex = beatTimes.length - 1;
  const toTick = (seconds: number) => {
    let low = 0;
    let high = lastIndex;
    // Largest k with beatTimes[k] <= seconds, kept within [0, lastIndex - 1].
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (beatTimes[mid] <= seconds) low = mid;
      else high = mid - 1;
    }
    const k = Math.min(low, lastIndex - 1);
    const beat = k + (seconds - beatTimes[k]) / (beatTimes[k + 1] - beatTimes[k]);
    return beat * ppq;
  };

  return { ppq, beatTimes, beatsPerBar: perBar, firstBeat: -start, toTick };
}

function noteEvents(notes: readonly NoteEvent[], toTick: (seconds: number) => number, velocity: number): Event[] {
  const events: Event[] = [];
  for (const note of notes) {
    const pitch = Math.max(0, Math.min(127, Math.round(note.midi)));
    const on = Math.max(0, Math.round(toTick(note.start)));
    const off = Math.max(on + 1, Math.round(toTick(note.end)));
    events.push({ tick: on, order: ORDER_ON, bytes: [0x90, pitch, velocity] });
    events.push({ tick: off, order: ORDER_OFF, bytes: [0x80, pitch, 0] });
  }
  return events;
}

function trackBytes(events: Event[]): number[] {
  const sorted = events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.tick - b.event.tick || a.event.order - b.event.order || a.index - b.index);
  const out: number[] = [];
  let lastTick = 0;
  for (const { event } of sorted) {
    out.push(...variableLength(event.tick - lastTick), ...event.bytes);
    lastTick = event.tick;
  }
  out.push(0x00, 0xff, 0x2f, 0x00);
  return out;
}

function midiFile(format: 0 | 1, ppq: number, tracks: number[][]): Uint8Array {
  const bytes: number[] = [
    ...ascii('MThd'), 0, 0, 0, 6,
    0, format,
    (tracks.length >> 8) & 0xff, tracks.length & 0xff,
    (ppq >> 8) & 0xff, ppq & 0xff,
  ];
  for (const track of tracks) bytes.push(...ascii('MTrk'), ...uint32(track.length), ...track);
  return new Uint8Array(bytes);
}

function tempoBytes(microsecondsPerBeat: number) {
  const us = Math.max(1, Math.min(0xffffff, microsecondsPerBeat));
  return [0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff];
}

/** n/4, 24 MIDI clocks per click, 8 32nds per quarter. */
function timeSignatureBytes(beatsPerBar: number) {
  return [0xff, 0x58, 0x04, Math.min(255, beatsPerBar), 2, 24, 8];
}

function textMeta(type: number, text: string) {
  const data = Array.from(new TextEncoder().encode(text));
  return [0xff, type, ...variableLength(data.length), ...data];
}

function mod(value: number, by: number) {
  return ((value % by) + by) % by;
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
