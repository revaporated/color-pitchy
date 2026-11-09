import { NoteSet, type RefNote } from './noteSet';

/** Pitch and time of a note, without identity. */
export type NoteSpan = { midi: number; start: number; end: number };

/**
 * Your changes to the reference, kept apart from the analysis so re-analyzing
 * (new settings, new clarity) never wipes them:
 * - `added`: notes you drew, or auto notes you moved or trimmed (as copies);
 * - `removed`: auto notes you deleted or replaced, matched by pitch and overlap,
 *   so a removal still applies when re-analysis shifts the note slightly.
 * Immutable: every operation returns a new object, which is what undo stores.
 */
export type NoteEdits = {
  readonly added: readonly RefNote[];
  readonly removed: readonly NoteSpan[];
};

export const EMPTY_EDITS: NoteEdits = { added: [], removed: [] };

/** Shortest note an edit can make, in seconds. */
export const MIN_NOTE_SECONDS = 0.03;

let idCounter = 0;
export function newManualId() {
  idCounter += 1;
  return `m:${Date.now().toString(36)}:${idCounter}`;
}

export function hasEdits(edits: NoteEdits) {
  return edits.added.length > 0 || edits.removed.length > 0;
}

/** An auto note counts as removed when a removal has its pitch and covers half of the shorter of the two. */
function isRemoved(note: RefNote, removed: readonly NoteSpan[]) {
  for (const span of removed) {
    if (span.midi !== note.midi) continue;
    const overlap = Math.min(span.end, note.end) - Math.max(span.start, note.start);
    if (overlap <= 0) continue;
    const shorter = Math.min(span.end - span.start, note.end - note.start);
    if (overlap >= 0.5 * shorter) return true;
  }
  return false;
}

/** The notes you hear and see: the analysis minus your removals, plus your additions. */
export function applyEdits(auto: NoteSet | null, edits: NoteEdits): NoteSet | null {
  if (!hasEdits(edits)) return auto;
  const kept = auto ? auto.notes.filter((note) => !isRemoved(note, edits.removed)) : [];
  return new NoteSet([...kept, ...edits.added]);
}

function span(note: NoteSpan): NoteSpan {
  return { midi: note.midi, start: note.start, end: note.end };
}

function normalize(patch: NoteSpan): NoteSpan {
  const start = Math.max(0, Math.min(patch.start, patch.end));
  const end = Math.max(start + MIN_NOTE_SECONDS, Math.max(patch.start, patch.end));
  return { midi: Math.round(patch.midi), start, end };
}

export function addNote(edits: NoteEdits, note: NoteSpan, id: string): NoteEdits {
  const added: RefNote = { ...normalize(note), id, voice: 0, origin: 'manual' };
  return { added: [...edits.added, added], removed: edits.removed };
}

/**
 * Moves or trims `note`. A manual note is changed in place. An auto note is
 * removed and replaced by a manual copy with id `newId`, so the change
 * survives re-analysis.
 */
export function updateNote(edits: NoteEdits, note: RefNote, patch: NoteSpan, newId: string): NoteEdits {
  const next = normalize(patch);
  if (note.origin === 'manual') {
    return {
      added: edits.added.map((other) => (other.id === note.id ? { ...other, ...next } : other)),
      removed: edits.removed,
    };
  }
  const copy: RefNote = { ...note, ...next, id: newId, origin: 'manual' };
  return { added: [...edits.added, copy], removed: [...edits.removed, span(note)] };
}

export function deleteNote(edits: NoteEdits, note: RefNote): NoteEdits {
  if (note.origin === 'manual') {
    return { added: edits.added.filter((other) => other.id !== note.id), removed: edits.removed };
  }
  return { added: edits.added, removed: [...edits.removed, span(note)] };
}
