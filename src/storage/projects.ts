/**
 * Library storage. Everything lives in IndexedDB (audio files are far too big
 * for localStorage):
 *
 * - projects:   one record per project (name, which audio, per-project settings,
 *               detected beats; see project/projectDoc.ts for the shape and upgrades)
 * - audio:      the uploaded files, shared by every project that uses them
 * - takes:      the recorded take of each project
 * - references: cached reference contours, per audio file and analysis settings
 * - edits:      your hand edits to the reference notes (pen mode), per project
 */

import type { NoteEdits } from '../audio/noteEdits';
import {
  BUILTIN_SETTINGS,
  migrateProjectRecord,
  PROJECT_SCHEMA_VERSION,
  type ProjectData,
  type ProjectMeta,
  type ProjectSettings,
} from '../project/projectDoc';

export type { ProjectMeta, ProjectSettings } from '../project/projectDoc';

const DB_NAME = 'color-pitchy';
const DB_VERSION = 2;
const LEGACY_PREFIX = 'color-pitchy:studio.';

export type AudioRecord = {
  id: string;
  blob: Blob;
  fileName: string;
  size: number;
  addedAt: number;
};

export type TakeRecord = {
  projectId: string;
  gridHz: number;
  frequency: Float32Array;
  clarity: Float32Array;
};

export type ReferenceRecord = {
  key: string;
  audioId: string;
  gridHz: number;
  frequency: Float32Array;
  clarity: Float32Array;
};

/** Settings that only make sense for the song they were set on, so a new project doesn't inherit them. */
const SONG_SPECIFIC = new Set<keyof ProjectSettings>(['beatScale', 'beatOffset', 'playbackRate']);

/**
 * Settings for a new project: whatever was last used in Studio (kept in
 * localStorage under the old global keys), falling back to the built-in defaults.
 */
export function defaultProjectSettings(): ProjectSettings {
  const settings = { ...BUILTIN_SETTINGS };
  for (const key of Object.keys(settings) as (keyof ProjectSettings)[]) {
    if (SONG_SPECIFIC.has(key)) continue;
    try {
      const raw = localStorage.getItem(LEGACY_PREFIX + key);
      if (raw === null) continue;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === typeof settings[key]) (settings as Record<string, unknown>)[key] = parsed;
    } catch {
      // ignore
    }
  }
  return settings;
}

/** Remember the settings so the next new project starts from them. */
export function rememberProjectSettings(settings: ProjectSettings) {
  for (const [key, value] of Object.entries(settings)) {
    try {
      localStorage.setItem(LEGACY_PREFIX + key, JSON.stringify(value));
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// IndexedDB plumbing

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('takes')) db.createObjectStore('takes', { keyPath: 'projectId' });
        if (!db.objectStoreNames.contains('edits')) db.createObjectStore('edits', { keyPath: 'projectId' });
        if (!db.objectStoreNames.contains('references')) {
          const store = db.createObjectStore('references', { keyPath: 'key' });
          store.createIndex('audioId', 'audioId');
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        // Another tab is upgrading the schema: let it, and reopen on next use.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        dbPromise = null;
        reject(request.error ?? new Error('Unable to open the library database.'));
      };
    });
  }
  return dbPromise;
}

type StoreName = 'projects' | 'audio' | 'takes' | 'references' | 'edits';

export type EditsRecord = NoteEdits & { projectId: string };

function asPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Run `work` in one transaction and resolve with its result once the transaction commits. */
async function transact<T>(
  stores: StoreName[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted.'));
  });
  const result = await work(tx);
  await done;
  return result;
}

function newId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Ask the browser not to evict the library under storage pressure. */
export function requestPersistentStorage() {
  void navigator.storage?.persist?.().catch(() => undefined);
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate) return null;
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch {
    return null;
  }
}

/** Reads a file's duration from its metadata without decoding all of it. */
export function probeDuration(blob: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    const finish = (value: number | null) => {
      clearTimeout(timer);
      audio.removeAttribute('src');
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 5000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) ? audio.duration : null);
    audio.onerror = () => finish(null);
    audio.src = url;
  });
}

/** Formats browsers can decode reliably. */
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'webm'];

/** For <input type="file" accept>. */
export const AUDIO_ACCEPT = ['audio/*', ...AUDIO_EXTENSIONS.map((ext) => `.${ext}`)].join(',');

export const UNSUPPORTED_AUDIO_MESSAGE = 'Please choose an audio file: MP3, WAV, M4A, FLAC or OGG.';

export function isSupportedAudio(file: File) {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  return AUDIO_EXTENSIONS.includes(ext) || file.type.startsWith('audio/');
}

function displayNameFromFile(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '');
}

// ---------------------------------------------------------------------------
// Projects

export async function listProjects(): Promise<ProjectMeta[]> {
  const projects = await transact(['projects'], 'readonly', (tx) =>
    asPromise(tx.objectStore('projects').getAll() as IDBRequest<ProjectMeta[]>),
  );
  return projects.map(migrateProjectRecord).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<ProjectMeta | undefined> {
  const project = await transact(['projects'], 'readonly', (tx) =>
    asPromise(tx.objectStore('projects').get(id) as IDBRequest<ProjectMeta | undefined>),
  );
  return project ? migrateProjectRecord(project) : undefined;
}

/**
 * Changes some fields of a project. `touch: false` keeps `updatedAt` (for
 * data the app derives, such as detected beats, rather than your work).
 */
export async function updateProject(
  id: string,
  patch: Partial<Omit<ProjectMeta, 'id'>>,
  { touch = true }: { touch?: boolean } = {},
) {
  return transact(['projects'], 'readwrite', async (tx) => {
    const store = tx.objectStore('projects');
    const current = (await asPromise(store.get(id))) as ProjectMeta | undefined;
    if (!current) return undefined;
    const updatedAt = patch.updatedAt ?? (touch ? Date.now() : current.updatedAt);
    const next: ProjectMeta = { ...current, ...patch, updatedAt, schemaVersion: PROJECT_SCHEMA_VERSION };
    store.put(next);
    return next;
  });
}

async function addAudio(file: File): Promise<AudioRecord> {
  const record: AudioRecord = {
    id: newId(),
    blob: file,
    fileName: file.name,
    size: file.size,
    addedAt: Date.now(),
  };
  await transact(['audio'], 'readwrite', (tx) => {
    tx.objectStore('audio').put(record);
  });
  return record;
}

export type NewProject = {
  name?: string;
  /** Upload a new file... */
  file?: File | null;
  /** ...or reuse audio already in the library. */
  audioId?: string | null;
};

export async function createProject({ name, file, audioId }: NewProject): Promise<ProjectMeta> {
  let audio: Pick<AudioRecord, 'id' | 'fileName' | 'blob'> | null = null;
  if (file) audio = await addAudio(file);
  else if (audioId) audio = (await getAudio(audioId)) ?? null;

  const duration = audio ? await probeDuration(audio.blob) : null;
  const now = Date.now();
  const project: ProjectMeta = {
    id: newId(),
    name: name?.trim() || (audio ? displayNameFromFile(audio.fileName) : 'Untitled project'),
    createdAt: now,
    updatedAt: now,
    audioId: audio?.id ?? null,
    fileName: audio?.fileName ?? null,
    duration,
    hasTake: false,
    settings: defaultProjectSettings(),
    beats: null,
    schemaVersion: PROJECT_SCHEMA_VERSION,
  };
  await transact(['projects'], 'readwrite', (tx) => {
    tx.objectStore('projects').put(project);
  });
  requestPersistentStorage();
  return project;
}

/** Copies a project, take included. The copy shares the same stored audio. */
export async function duplicateProject(id: string): Promise<ProjectMeta | undefined> {
  const source = await getProject(id);
  if (!source) return undefined;
  const take = await getTake(id);
  const edits = await getEdits(id);
  const now = Date.now();
  const copy: ProjectMeta = {
    ...source,
    id: newId(),
    name: `${source.name} (copy)`,
    createdAt: now,
    updatedAt: now,
    settings: { ...source.settings },
  };
  await transact(['projects', 'takes', 'edits'], 'readwrite', (tx) => {
    tx.objectStore('projects').put(copy);
    if (take) tx.objectStore('takes').put({ ...take, projectId: copy.id });
    if (edits) tx.objectStore('edits').put({ ...edits, projectId: copy.id });
  });
  return copy;
}

/** Deletes the audio file and its cached analysis if no project uses it any more. */
async function deleteAudioIfUnused(audioId: string) {
  const projects = await listProjects();
  if (projects.some((project) => project.audioId === audioId)) return;
  await transact(['audio', 'references'], 'readwrite', async (tx) => {
    tx.objectStore('audio').delete(audioId);
    const index = tx.objectStore('references').index('audioId');
    const keys = await asPromise(index.getAllKeys(audioId));
    for (const key of keys) tx.objectStore('references').delete(key);
  });
}

export async function deleteProject(id: string) {
  const project = await getProject(id);
  await transact(['projects', 'takes', 'edits'], 'readwrite', (tx) => {
    tx.objectStore('projects').delete(id);
    tx.objectStore('takes').delete(id);
    tx.objectStore('edits').delete(id);
  });
  if (project?.audioId) await deleteAudioIfUnused(project.audioId);
}

/** Replaces a project's track. The old take and note edits no longer line up, so they are deleted. */
export async function setProjectAudio(id: string, file: File) {
  const previous = await getProject(id);
  const audio = await addAudio(file);
  const duration = await probeDuration(file);
  await transact(['takes', 'edits'], 'readwrite', (tx) => {
    tx.objectStore('takes').delete(id);
    tx.objectStore('edits').delete(id);
  });
  const project = await updateProject(id, {
    audioId: audio.id,
    fileName: audio.fileName,
    duration,
    hasTake: false,
    beats: null,
  });
  if (previous?.audioId) await deleteAudioIfUnused(previous.audioId);
  return { project, audio };
}

// ---------------------------------------------------------------------------
// Audio

export function getAudio(id: string): Promise<AudioRecord | undefined> {
  return transact(['audio'], 'readonly', (tx) =>
    asPromise(tx.objectStore('audio').get(id) as IDBRequest<AudioRecord | undefined>),
  );
}

export type AudioSummary = Omit<AudioRecord, 'blob'>;

export async function listAudio(): Promise<AudioSummary[]> {
  const records = await transact(['audio'], 'readonly', (tx) =>
    asPromise(tx.objectStore('audio').getAll() as IDBRequest<AudioRecord[]>),
  );
  return records
    .map(({ id, fileName, size, addedAt }) => ({ id, fileName, size, addedAt }))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
}

// ---------------------------------------------------------------------------
// Takes

export function getTake(projectId: string): Promise<TakeRecord | undefined> {
  return transact(['takes'], 'readonly', (tx) =>
    asPromise(tx.objectStore('takes').get(projectId) as IDBRequest<TakeRecord | undefined>),
  );
}

/** Saves (or, when `take` is null, deletes) a project's take. */
export async function saveTake(projectId: string, take: Omit<TakeRecord, 'projectId'> | null) {
  await transact(['takes'], 'readwrite', (tx) => {
    if (take) tx.objectStore('takes').put({ ...take, projectId });
    else tx.objectStore('takes').delete(projectId);
  });
  await updateProject(projectId, { hasTake: Boolean(take) });
}

// ---------------------------------------------------------------------------
// Reference contour cache

export function getReference(key: string): Promise<ReferenceRecord | undefined> {
  return transact(['references'], 'readonly', (tx) =>
    asPromise(tx.objectStore('references').get(key) as IDBRequest<ReferenceRecord | undefined>),
  );
}

export async function saveReference(record: ReferenceRecord) {
  await transact(['references'], 'readwrite', (tx) => {
    tx.objectStore('references').put(record);
  });
}

export async function clearReferences(audioId: string) {
  await transact(['references'], 'readwrite', async (tx) => {
    const keys = await asPromise(tx.objectStore('references').index('audioId').getAllKeys(audioId));
    for (const key of keys) tx.objectStore('references').delete(key);
  });
}

/** For the library listing: which tracks have a saved analysis, and how many edits each project has. */
export async function libraryStatus(): Promise<{ analyzedAudio: Set<string>; editCounts: Map<string, number> }> {
  return transact(['references', 'edits'], 'readonly', async (tx) => {
    const editsRequest = asPromise(tx.objectStore('edits').getAll() as IDBRequest<EditsRecord[]>);
    // Walk the audioId index's keys: one entry per cached analysis, keyed by its track.
    const analyzedAudio = new Set<string>();
    await new Promise<void>((resolve, reject) => {
      const request = tx.objectStore('references').index('audioId').openKeyCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        analyzedAudio.add(String(cursor.key));
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
    const edits = await editsRequest;
    const editCounts = new Map(edits.map((record) => [record.projectId, record.added.length + record.removed.length]));
    return { analyzedAudio, editCounts };
  });
}

// ---------------------------------------------------------------------------
// Note edits

export async function getEdits(projectId: string): Promise<NoteEdits | undefined> {
  const record = await transact(['edits'], 'readonly', (tx) =>
    asPromise(tx.objectStore('edits').get(projectId) as IDBRequest<EditsRecord | undefined>),
  );
  return record ? { added: record.added, removed: record.removed } : undefined;
}

/** Saves a project's note edits, or deletes them when there are none. */
export async function saveEdits(projectId: string, edits: NoteEdits) {
  await transact(['edits'], 'readwrite', (tx) => {
    if (edits.added.length > 0 || edits.removed.length > 0) {
      const record: EditsRecord = { projectId, added: [...edits.added], removed: [...edits.removed] };
      tx.objectStore('edits').put(record);
    } else {
      tx.objectStore('edits').delete(projectId);
    }
  });
}

// ---------------------------------------------------------------------------
// Backup import

/**
 * Replaces a project's settings, note edits, take and beats with the ones in
 * a backup file, in one transaction. The project keeps its own audio. Beats
 * are kept only when `sameAudio` says the backup was made from the same file.
 */
export async function importProjectData(id: string, data: ProjectData, sameAudio: boolean) {
  await transact(['projects', 'edits', 'takes'], 'readwrite', async (tx) => {
    const projects = tx.objectStore('projects');
    const current = (await asPromise(projects.get(id))) as ProjectMeta | undefined;
    if (!current) throw new Error('The project no longer exists.');
    const beats = sameAudio && data.beats && current.audioId ? { ...data.beats, audioId: current.audioId } : null;
    projects.put({
      ...current,
      settings: data.settings,
      beats,
      hasTake: data.take !== null,
      updatedAt: Date.now(),
      schemaVersion: PROJECT_SCHEMA_VERSION,
    } satisfies ProjectMeta);
    if (data.edits.added.length > 0 || data.edits.removed.length > 0) {
      tx.objectStore('edits').put({ projectId: id, added: [...data.edits.added], removed: [...data.edits.removed] });
    } else {
      tx.objectStore('edits').delete(id);
    }
    if (data.take) tx.objectStore('takes').put({ projectId: id, ...data.take });
    else tx.objectStore('takes').delete(id);
  });
}
