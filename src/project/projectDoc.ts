/**
 * The project document: what a project holds, how stored records are
 * upgraded, and the backup file format. Pure, so it runs in tests.
 *
 * Storage layout (IndexedDB version 2, unchanged by this module):
 * - `projects` record: metadata, `settings`, `beats`, `schemaVersion`;
 * - `edits` and `takes`: one record per project, as before.
 * Fields are only ever added, so older builds can still open the library.
 */

import type { NoteEdits, NoteSpan } from '../audio/noteEdits';
import type { RefNote } from '../audio/noteSet';

/** Bump when the project record gains fields that need upgrading in `migrateProjectRecord`. */
export const PROJECT_SCHEMA_VERSION = 1;

export type ProjectSettings = {
  showReference: boolean;
  referenceClarity: number;
  referenceOpacity: number;
  topVoiceReference: boolean;
  referenceSmoothing: number;
  /** Analysis window in ms, 0 = automatic. */
  referenceWindowMs: number;
  /** Note range the reference analysis reports (MIDI). */
  referenceMinMidi: number;
  referenceMaxMidi: number;
  /** Detected beats used as found (1), halved (0.5) or doubled (2). */
  beatScale: number;
  /** Beats per shaded group (usually a bar). */
  beatsPerGroup: number;
  /** Which beat starts the first group, 0..beatsPerGroup-1. */
  beatOffset: number;
  /** Playback speed; pitch is kept. */
  playbackRate: number;
};

export const BUILTIN_SETTINGS: ProjectSettings = {
  showReference: true,
  referenceClarity: 0.8,
  referenceOpacity: 0.16,
  topVoiceReference: false,
  referenceSmoothing: 4,
  referenceWindowMs: 0,
  referenceMinMidi: 48,
  referenceMaxMidi: 96,
  beatScale: 1,
  beatsPerGroup: 4,
  beatOffset: 0,
  playbackRate: 1,
};

/**
 * Beats as the detector found them for one audio file. Saved with the
 * project so reopening doesn't detect again, and so later beat edits have a
 * fixed base. Ignored when `audioId` or `version` no longer match.
 */
export type SavedBeats = {
  version: number;
  audioId: string;
  times: number[];
  bpm: number;
};

export type ProjectMeta = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  audioId: string | null;
  fileName: string | null;
  duration: number | null;
  hasTake: boolean;
  settings: ProjectSettings;
  beats: SavedBeats | null;
  schemaVersion: number;
};

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Known settings with the right type are kept; anything else gets the built-in default. */
export function migrateSettings(raw: unknown): ProjectSettings {
  const settings = { ...BUILTIN_SETTINGS };
  if (!isObject(raw)) return settings;
  for (const key of Object.keys(settings) as (keyof ProjectSettings)[]) {
    const value = raw[key];
    if (typeof value === typeof settings[key] && (typeof value !== 'number' || Number.isFinite(value))) {
      (settings as Record<string, unknown>)[key] = value;
    }
  }
  return settings;
}

export function validBeats(raw: unknown): SavedBeats | null {
  if (!isObject(raw) || !isNumber(raw.version) || typeof raw.audioId !== 'string' || !isNumber(raw.bpm)) return null;
  if (!Array.isArray(raw.times) || !raw.times.every(isNumber)) return null;
  for (let i = 1; i < raw.times.length; i += 1) if (!(raw.times[i] > raw.times[i - 1])) return null;
  return { version: raw.version, audioId: raw.audioId, times: [...raw.times], bpm: raw.bpm };
}

/**
 * Upgrades a stored project record to the current shape. Version 2 records
 * (Nov 2026 and earlier) have no `beats` or `schemaVersion`, and may lack
 * settings added after they were saved. Unknown fields are kept.
 */
export function migrateProjectRecord(raw: unknown): ProjectMeta {
  if (!isObject(raw) || typeof raw.id !== 'string') throw new Error('Not a project record.');
  return {
    ...(raw as unknown as ProjectMeta),
    settings: migrateSettings(raw.settings),
    beats: validBeats(raw.beats),
    schemaVersion: PROJECT_SCHEMA_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Backup file ("Export project data"). The audio itself is not included.

export const PROJECT_EXPORT_FORMAT = 'color-pitchy-project';

export type TakeData = { gridHz: number; frequency: Float32Array; clarity: Float32Array };

export type ProjectData = {
  name: string;
  audio: { fileName: string; size: number; duration: number | null } | null;
  settings: ProjectSettings;
  edits: NoteEdits;
  beats: SavedBeats | null;
  take: TakeData | null;
};

export function buildProjectExport(data: ProjectData, now = new Date()): string {
  return JSON.stringify({
    format: PROJECT_EXPORT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    name: data.name,
    audio: data.audio,
    settings: data.settings,
    edits: { added: data.edits.added, removed: data.edits.removed },
    beats: data.beats,
    // Typed arrays as base64 of their bytes, which keeps NaN (empty bins) exact.
    take: data.take
      ? { gridHz: data.take.gridHz, frequency: floatsToBase64(data.take.frequency), clarity: floatsToBase64(data.take.clarity) }
      : null,
  });
}

/** Reads a backup file. Throws an Error with a message for the user when it can't. */
export function parseProjectExport(text: string): ProjectData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!isObject(raw) || raw.format !== PROJECT_EXPORT_FORMAT) throw new Error('This is not a color-pitchy project file.');
  if (!isNumber(raw.schemaVersion) || raw.schemaVersion > PROJECT_SCHEMA_VERSION) {
    throw new Error('This file was saved by a newer version of color-pitchy.');
  }
  const audio = isObject(raw.audio) && typeof raw.audio.fileName === 'string' && isNumber(raw.audio.size)
    ? { fileName: raw.audio.fileName, size: raw.audio.size, duration: isNumber(raw.audio.duration) ? raw.audio.duration : null }
    : null;
  return {
    name: typeof raw.name === 'string' ? raw.name : 'Imported project',
    audio,
    settings: migrateSettings(raw.settings),
    edits: parseEdits(raw.edits),
    beats: validBeats(raw.beats),
    take: parseTake(raw.take),
  };
}

function parseEdits(raw: unknown): NoteEdits {
  if (!isObject(raw)) return { added: [], removed: [] };
  const span = (value: unknown): value is NoteSpan =>
    isObject(value) && isNumber(value.midi) && isNumber(value.start) && isNumber(value.end) && value.end > value.start;
  const added = (Array.isArray(raw.added) ? raw.added : [])
    .filter((note): note is RefNote => span(note) && typeof (note as Json).id === 'string')
    .map((note) => ({ id: note.id, midi: note.midi, start: note.start, end: note.end, voice: isNumber(note.voice) ? note.voice : 0, origin: 'manual' as const }));
  const removed = (Array.isArray(raw.removed) ? raw.removed : [])
    .filter(span)
    .map((note) => ({ midi: note.midi, start: note.start, end: note.end }));
  return { added, removed };
}

function parseTake(raw: unknown): TakeData | null {
  if (!isObject(raw) || !isNumber(raw.gridHz) || typeof raw.frequency !== 'string' || typeof raw.clarity !== 'string') return null;
  const frequency = base64ToFloats(raw.frequency);
  const clarity = base64ToFloats(raw.clarity);
  if (frequency.length !== clarity.length) throw new Error('The take in this file is damaged.');
  return { gridHz: raw.gridHz, frequency, clarity };
}

function floatsToBase64(values: Float32Array): string {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function base64ToFloats(text: string): Float32Array {
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    throw new Error('The take in this file is damaged.');
  }
  if (binary.length % 4 !== 0) throw new Error('The take in this file is damaged.');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}
