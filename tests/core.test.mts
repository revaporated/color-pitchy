import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PITCH_COLOR_SHAPE_MAP, frameToMidi, midiToNoteIndex, midiToNoteName } from '../src/utils/pitch.ts';
import { segmentNotes } from '../src/utils/notes.ts';
import { NoteSet, type RefNote } from '../src/audio/noteSet.ts';
import { EMPTY_EDITS, addNote, applyEdits, deleteNote, updateNote } from '../src/audio/noteEdits.ts';
import { BeatGrid } from '../src/audio/beatGrid.ts';
import { PitchTrack } from '../src/audio/frames.ts';

test('palette is exactly the Colorchord mapping', () => {
  assert.deepEqual(PITCH_COLOR_SHAPE_MAP, {
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
  });
});

test('pitch helpers', () => {
  const filter = { clarityThreshold: 0.9, centsThreshold: 25, minMidi: 36, maxMidi: 96 };
  assert.equal(frameToMidi(440, 0.95, filter), 69);
  assert.equal(frameToMidi(440, 0.5, filter), null);
  assert.equal(frameToMidi(30, 0.95, filter), null);
  assert.equal(frameToMidi(452, 0.95, filter), null); // +47 cents fails the 25 c gate
  assert.ok(Math.abs(frameToMidi(452, 0.95, { ...filter, centsThreshold: 50 })! - 69.466) < 0.01);
  assert.equal(midiToNoteIndex(-1), 11);
  assert.deepEqual(midiToNoteName(60.2), { note: 'C', octave: 4, cents: 20 });
});

test('segmentNotes splits on pitch changes and drops blips', () => {
  const frames = [];
  for (let i = 0; i < 30; i += 1) frames.push({ time: i * 0.01, midi: 60.1 });
  frames.push({ time: 0.3, midi: 67 }); // one-frame blip
  for (let i = 31; i < 60; i += 1) frames.push({ time: i * 0.01, midi: 62 });
  const notes = segmentNotes(frames);
  assert.deepEqual(notes.map((n) => n.midi), [60, 62]);
  assert.equal(notes[0].start, 0);
});

test('PitchTrack punch-in and range reads', () => {
  const track = new PitchTrack(1, 100);
  track.write(0.1, 220, 0.9);
  track.write(0.13, 230, 0.9); // fills the bins in between
  const seen: number[] = [];
  track.forEachInRange(0, 1, (_t, f) => seen.push(f));
  assert.deepEqual(seen, [220, 230, 230, 230]);
});

const auto = (midi: number, start: number, end: number): RefNote => ({ midi, start, end, id: `a:${midi}:${start}`, voice: 0, origin: 'auto' });

test('NoteSet range lookup and hit test', () => {
  const set = new NoteSet([auto(62, 1, 1.5), auto(60, 0, 2), auto(64, 3, 3.2)]);
  const hit: number[] = [];
  set.forEachOverlapping(1.2, 1.3, (n) => hit.push(n.midi));
  assert.deepEqual(hit, [60, 62]);
  assert.equal(set.noteAt(1.2, 62)?.midi, 62);
  assert.equal(set.noteAt(2.5, 60), null);
  assert.equal(set.firstStartingAt(2), 2);
});

test('note edits survive re-analysis', () => {
  const analysis = new NoteSet([auto(60, 0, 1), auto(62, 1, 2)]);
  let edits = deleteNote(EMPTY_EDITS, analysis.notes[0]);
  edits = updateNote(edits, analysis.notes[1], { midi: 63, start: 1, end: 2 }, 'm:1');
  edits = addNote(edits, { midi: 70, start: 3, end: 3.01 }, 'm:2');
  // Re-analysis shifts the notes slightly; the removals still match.
  const reanalysed = new NoteSet([auto(60, 0.02, 1.01), auto(62, 1.01, 1.98)]);
  const result = applyEdits(reanalysed, edits)!;
  assert.deepEqual(result.notes.map((n) => [n.midi, n.origin]), [[63, 'manual'], [70, 'manual']]);
  assert.ok(result.notes[1].end - result.notes[1].start >= 0.03 - 1e-9); // minimum length
  assert.equal(applyEdits(analysis, EMPTY_EDITS), analysis);
});

test('BeatGrid rescale, groups and snapping', () => {
  const beats = Float64Array.from([0, 0.5, 1, 1.5, 2]);
  const grid = new BeatGrid(beats, 1, 4, 1);
  assert.equal(grid.bpm, 120);
  assert.equal(grid.isGroupStart(1), true);
  assert.equal(grid.isGroupStart(5), true);
  assert.equal(grid.groupOf(0), -1);
  assert.equal(grid.nearest(0.7), 0.5);
  assert.deepEqual([...new BeatGrid(beats, 2, 4, 0).times], [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
  assert.deepEqual([...new BeatGrid(beats, 0.5, 4, 0).times], [0, 1, 2]);
  assert.equal(new BeatGrid(beats, 1, 4, -1).offset, 3);
});
