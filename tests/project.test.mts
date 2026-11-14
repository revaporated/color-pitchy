import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_SETTINGS,
  PROJECT_SCHEMA_VERSION,
  buildProjectExport,
  migrateProjectRecord,
  parseProjectExport,
  type ProjectData,
  type SavedBeats,
} from '../src/project/projectDoc.ts';
import { ProjectStore } from '../src/project/projectStore.ts';
import { addNote, EMPTY_EDITS, type NoteEdits } from '../src/audio/noteEdits.ts';

/** A project record as e9ae998 (IndexedDB version 2) wrote it, saved before referenceWindowMs and the range existed. */
const v2Record = {
  id: 'p1',
  name: 'Tangerine',
  createdAt: 1,
  updatedAt: 2,
  audioId: 'a1',
  fileName: 'tangerine.mp3',
  duration: 274,
  hasTake: true,
  settings: { showReference: false, referenceClarity: 0.55, referenceOpacity: 0.3, topVoiceReference: true, referenceSmoothing: 6, beatScale: 2, beatsPerGroup: 3, beatOffset: 1, playbackRate: 0.75 },
};

const beats: SavedBeats = { version: 1, audioId: 'a1', times: [0.1, 0.5, 0.9], bpm: 150 };

test('a version 2 record upgrades without losing anything', () => {
  const project = migrateProjectRecord(structuredClone(v2Record));
  assert.equal(project.schemaVersion, PROJECT_SCHEMA_VERSION);
  assert.equal(project.beats, null);
  assert.deepEqual(project.settings, {
    ...v2Record.settings,
    referenceWindowMs: BUILTIN_SETTINGS.referenceWindowMs,
    referenceMinMidi: BUILTIN_SETTINGS.referenceMinMidi,
    referenceMaxMidi: BUILTIN_SETTINGS.referenceMaxMidi,
  });
  const { settings: _s, ...rest } = v2Record;
  for (const [key, value] of Object.entries(rest)) assert.deepEqual((project as Record<string, unknown>)[key], value, key);
});

test('migration repairs bad fields and keeps unknown ones', () => {
  const project = migrateProjectRecord({ ...v2Record, settings: { beatScale: 'x', playbackRate: Number.NaN }, beats: { ...beats, times: [1, 0.5] }, extra: 7 });
  assert.equal(project.settings.beatScale, 1);
  assert.equal(project.settings.playbackRate, 1);
  assert.equal(project.beats, null); // beats out of order
  assert.equal((project as unknown as { extra: number }).extra, 7);
  assert.deepEqual(migrateProjectRecord({ ...v2Record, beats }).beats, beats);
  assert.throws(() => migrateProjectRecord({ name: 'no id' }));
});

const sample = (): ProjectData => {
  const clarity = new Float32Array([Number.NaN, 0.9, 0.8, Number.NaN]);
  return {
    name: 'Tangerine',
    audio: { fileName: 'tangerine.mp3', size: 1234, duration: 274 },
    settings: { ...BUILTIN_SETTINGS, beatOffset: 2 },
    edits: addNote({ added: [], removed: [{ midi: 60, start: 1, end: 2 }] }, { midi: 62, start: 3, end: 3.5 }, 'm:1'),
    beats,
    take: { gridHz: 200, frequency: new Float32Array([0, 220, 221.5, 0]), clarity },
  };
};

test('backup file round trip is exact, NaN included', () => {
  const data = sample();
  const back = parseProjectExport(buildProjectExport(data));
  assert.deepEqual({ ...back, take: null }, { ...data, take: null });
  assert.equal(back.take!.gridHz, 200);
  assert.deepEqual([...back.take!.frequency], [...data.take!.frequency]);
  assert.deepEqual([...back.take!.clarity].map(String), ['NaN', String(Math.fround(0.9)), String(Math.fround(0.8)), 'NaN']);
});

test('backup files are checked before anything is written', () => {
  assert.throws(() => parseProjectExport('{'), /not valid JSON/);
  assert.throws(() => parseProjectExport('{"format":"other"}'), /not a color-pitchy project/);
  assert.throws(() => parseProjectExport(JSON.stringify({ format: 'color-pitchy-project', schemaVersion: 99 })), /newer version/);
  const minimal = parseProjectExport(JSON.stringify({ format: 'color-pitchy-project', schemaVersion: 1, edits: { added: [{ midi: 60, start: 2, end: 1, id: 'bad' }] } }));
  assert.deepEqual(minimal.settings, BUILTIN_SETTINGS);
  assert.deepEqual(minimal.edits, { added: [], removed: [] });
  assert.equal(minimal.take, null);
});

function fakeStore() {
  const saved = { settings: [] as unknown[], edits: [] as NoteEdits[], beats: [] as unknown[] };
  const store = new ProjectStore(
    { settings: { ...BUILTIN_SETTINGS }, beats: null },
    {
      saveSettings: async (s) => saved.settings.push(s),
      saveEdits: async (e) => saved.edits.push(e),
      saveBeats: async (b) => saved.beats.push(b),
    },
  );
  return { store, saved };
}

const note = (id: string, start: number) => (edits: NoteEdits) => addNote(edits, { midi: 60, start, end: start + 1 }, id);

test('store: settings changes save once, no-ops do not', () => {
  const { store, saved } = fakeStore();
  let renders = 0;
  store.subscribe(() => renders++);
  store.setter('beatOffset')(2);
  store.setter('beatOffset')((v) => v + 1);
  store.updateSettings({ beatOffset: 3 }); // same value
  assert.equal(store.getState().settings.beatOffset, 3);
  assert.equal(renders, 2);
  store.flush();
  store.flush();
  assert.equal(saved.settings.length, 1);
  assert.equal((saved.settings[0] as { beatOffset: number }).beatOffset, 3);
  assert.equal(saved.edits.length, 0);
});

test('store: loading edits does not save them; undo and redo do', () => {
  const { store, saved } = fakeStore();
  const loaded = note('m:0', 0)(EMPTY_EDITS);
  store.loadEdits(loaded);
  store.flush();
  assert.equal(saved.edits.length, 0);
  store.applyEdit(note('m:1', 2));
  store.applyEdit(note('m:2', 4));
  store.undo();
  assert.equal(store.getState().edits.added.length, 2);
  store.redo();
  assert.equal(store.getState().edits.added.length, 3);
  store.undo();
  store.undo();
  assert.equal(store.getState().edits, loaded);
  assert.equal(store.getState().history.past.length, 0);
  store.flush();
  assert.deepEqual(saved.edits, [loaded]);
});

test('store: a drag is one undo step and is not saved half way', () => {
  const { store, saved } = fakeStore();
  store.loadEdits(EMPTY_EDITS);
  store.applyEdit(note('m:1', 0));
  const before = store.getState().edits;
  store.flush();
  store.previewEdit(note('m:2', 1));
  store.previewEdit(note('m:2', 2)); // starts again from the drag base
  assert.equal(store.getState().edits.added.length, 2);
  store.flush();
  assert.equal(saved.edits.length, 1); // nothing new mid-drag
  store.flush(true);
  assert.equal(saved.edits[1], before); // forced: the edits from before the drag
  store.commitEdit();
  store.flush();
  assert.equal(saved.edits[2].added[1].start, 2);
  store.undo();
  assert.equal(store.getState().edits, before);
  store.previewEdit(note('m:3', 5));
  store.cancelEdit();
  assert.equal(store.getState().edits, before);
});

test('store: beats, reset and discarded saves', () => {
  const { store, saved } = fakeStore();
  store.setBeats(beats);
  store.resetEdits();
  store.discardPendingSaves();
  store.flush();
  assert.equal(saved.beats.length + saved.edits.length, 0);
  store.setBeats(null);
  store.flush();
  assert.deepEqual(saved.beats, [null]);
});
