import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMidiFile, buildTempoMap } from '../src/utils/midi.ts';
import { readMidi } from './midiRead.mts';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

test('without beats the file is byte-for-byte what it was before (format 0, 120 bpm)', () => {
  const notes = [{ midi: 60, start: 0, end: 0.5 }, { midi: 62, start: 0.5, end: 1 }, { midi: 64, start: 1.2, end: 1.25 }];
  // Captured from the old buildMidiFile at e9ae998.
  const before = '4d546864000000060000000101e04d54726b0000002600ff510307a12000903c5a8360803c0000903e5a8360803e00814090405a3080400000ff2f00';
  assert.equal(hex(buildMidiFile(notes)), before);
  assert.equal(hex(buildMidiFile(notes, { beats: { times: [1], perGroup: 4, offset: 0 } })), before);
});

test('beat i of the grid is at a whole quarter note, and bar 1 starts on a downbeat', () => {
  // 100 bpm from 0.3 s; the first downbeat is grid beat 1.
  const times = Array.from({ length: 16 }, (_, i) => 0.3 + i * 0.6);
  const beats = { times, perGroup: 4, offset: 1 };
  const map = buildTempoMap(beats, 10)!;
  assert.ok(map.beatTimes[0] <= 0);
  for (let i = 0; i < times.length; i += 1) {
    assert.ok(Math.abs(map.toTick(times[i]) - (i + map.firstBeat) * 480) < 1e-6, `beat ${i}`);
  }
  // Grid beat 1 (the first downbeat) falls on a bar line.
  assert.equal((1 + map.firstBeat) % 4, 0);
  // A note half way between beats 2 and 3.
  assert.ok(Math.abs(map.toTick(times[2] + 0.3) - (2.5 + map.firstBeat) * 480) < 1e-6);

  const file = readMidi(buildMidiFile([{ midi: 60, start: times[1], end: times[2] }], { beats, trackName: 'melody' }));
  assert.equal(file.format, 1);
  assert.equal(file.tracks, 2);
  assert.deepEqual(file.timeSignature, { numerator: 4, denominator: 4 });
  assert.deepEqual(file.names, ['melody']);
  assert.equal(file.notes[0].startTick % (4 * 480), 0);
  assert.equal(file.notes[0].endTick - file.notes[0].startTick, 480);
  assert.ok(file.tempos.every((t) => t.us === 600_000));
});

test('a drifting tempo keeps every note within 1.5 ms of its song time', () => {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const times = [0.25];
  while (times[times.length - 1] < 200) times.push(times[times.length - 1] + 0.35 + random() * 0.1);
  // One voice, so every note pairs up unambiguously when read back. Runs past the last beat.
  const notes: { midi: number; start: number; end: number }[] = [];
  for (let t = random(); t < 205; t += 0.1 + random() * 0.4) {
    const end = t + 0.05 + random() * 0.04;
    notes.push({ midi: 48 + Math.floor(random() * 36), start: t, end });
  }
  const file = readMidi(buildMidiFile(notes, { beats: { times, perGroup: 3, offset: 2 } }));
  assert.deepEqual(file.timeSignature, { numerator: 3, denominator: 4 });
  const map = buildTempoMap({ times, perGroup: 3, offset: 2 }, 206)!;
  const shift = map.beatTimes[0]; // the file starts at the padded downbeat, before 0 s
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
  let worst = 0;
  file.notes.forEach((note, i) => {
    worst = Math.max(worst, Math.abs(note.start + shift - sorted[i].start), Math.abs(note.end + shift - sorted[i].end));
  });
  assert.ok(worst < 0.0015, `worst error ${(worst * 1000).toFixed(3)} ms`);
});

test('unusable grids fall back to the fixed tempo', () => {
  assert.equal(buildTempoMap({ times: [1, 1], perGroup: 4, offset: 0 }, 2), null);
  assert.equal(buildTempoMap({ times: [], perGroup: 4, offset: 0 }, 2), null);
});
