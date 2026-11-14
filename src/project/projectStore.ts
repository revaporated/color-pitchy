import { EMPTY_EDITS, type NoteEdits } from '../audio/noteEdits';
import type { ProjectSettings, SavedBeats } from './projectDoc';

const MAX_UNDO = 200;
/** Changes are saved this long after they stop (one timer for everything). */
export const SAVE_DELAY_MS = 500;

export type EditHistory = {
  past: NoteEdits[];
  future: NoteEdits[];
  /** Edits when the current drag began, or null when not dragging. */
  dragBase: NoteEdits | null;
};

export type ProjectState = {
  settings: ProjectSettings;
  edits: NoteEdits;
  /** False until the saved edits have loaded (editing is blocked until then). */
  editsLoaded: boolean;
  history: EditHistory;
  beats: SavedBeats | null;
};

/** Where the store writes. The app passes IndexedDB; tests pass a fake. */
export interface ProjectPersistence {
  saveSettings(settings: ProjectSettings): Promise<unknown>;
  saveEdits(edits: NoteEdits): Promise<unknown>;
  saveBeats(beats: SavedBeats | null): Promise<unknown>;
}

type Part = 'settings' | 'edits' | 'beats';
type Updater<T> = T | ((current: T) => T);

const NO_HISTORY: EditHistory = { past: [], future: [], dragBase: null };

/**
 * One owner for a project's document: per-project settings, note edits (with
 * undo) and detected beats. Immutable state, read with useSyncExternalStore.
 * Every change marks its part dirty; one debounced save writes the dirty parts.
 * The take is not here: it is a large mutable buffer with its own autosave.
 */
export class ProjectStore {
  private state: ProjectState;
  private readonly listeners = new Set<() => void>();
  private readonly dirty = new Set<Part>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly persistence: ProjectPersistence;
  private readonly onError: (err: unknown) => void;

  constructor(
    initial: { settings: ProjectSettings; beats: SavedBeats | null },
    persistence: ProjectPersistence,
    onError: (err: unknown) => void = (err) => console.error('Saving the project failed', err),
  ) {
    this.state = { ...initial, edits: EMPTY_EDITS, editsLoaded: false, history: NO_HISTORY };
    this.persistence = persistence;
    this.onError = onError;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  get hasUnsavedChanges() {
    return this.dirty.size > 0;
  }

  private set(next: Partial<ProjectState>, changed: Part | null) {
    this.state = { ...this.state, ...next };
    if (changed) {
      this.dirty.add(changed);
      this.schedule();
    }
    for (const listener of this.listeners) listener();
  }

  // -- Settings -------------------------------------------------------------

  updateSettings(patch: Partial<ProjectSettings> | ((current: ProjectSettings) => Partial<ProjectSettings>)) {
    const current = this.state.settings;
    const values = typeof patch === 'function' ? patch(current) : patch;
    const changed = (Object.keys(values) as (keyof ProjectSettings)[]).some((key) => values[key] !== current[key]);
    if (changed) this.set({ settings: { ...current, ...values } }, 'settings');
  }

  /** A setter for one setting, shaped like React's state setters. */
  setter<K extends keyof ProjectSettings>(key: K) {
    return (value: Updater<ProjectSettings[K]>) =>
      this.updateSettings((current) => ({
        [key]: typeof value === 'function' ? (value as (v: ProjectSettings[K]) => ProjectSettings[K])(current[key]) : value,
      }) as Partial<ProjectSettings>);
  }

  // -- Beats ----------------------------------------------------------------

  setBeats(beats: SavedBeats | null) {
    if (beats !== this.state.beats) this.set({ beats }, 'beats');
  }

  // -- Note edits -----------------------------------------------------------

  /** The saved edits, once read from storage. Not saved again, and clears undo. */
  loadEdits(edits: NoteEdits) {
    this.set({ edits, editsLoaded: true, history: NO_HISTORY }, null);
  }

  /** One finished change: applied and added to undo. */
  applyEdit = (change: (edits: NoteEdits) => NoteEdits) => {
    const { history, edits } = this.state;
    const base = history.dragBase ?? edits;
    const next = change(base);
    if (next === base && !history.dragBase) return;
    this.set({ edits: next, history: { past: [...history.past, base].slice(-MAX_UNDO), future: [], dragBase: null } }, 'edits');
  };

  /**
   * Live update during a drag. Every call starts again from the edits as they
   * were when the drag began, so a whole drag becomes one undo step on `commit`.
   */
  previewEdit = (change: (base: NoteEdits) => NoteEdits) => {
    const { history, edits } = this.state;
    const base = history.dragBase ?? edits;
    this.set({ edits: change(base), history: { ...history, dragBase: base } }, 'edits');
  };

  commitEdit = () => {
    const { history, edits } = this.state;
    if (!history.dragBase) return;
    if (edits === history.dragBase) {
      this.set({ history: { ...history, dragBase: null } }, null);
      return;
    }
    this.set({ history: { past: [...history.past, history.dragBase].slice(-MAX_UNDO), future: [], dragBase: null } }, 'edits');
  };

  cancelEdit = () => {
    const { history } = this.state;
    if (history.dragBase) this.set({ edits: history.dragBase, history: { ...history, dragBase: null } }, 'edits');
  };

  undo = () => {
    const { history } = this.state;
    const present = history.dragBase ?? this.state.edits;
    if (history.past.length === 0) {
      if (history.dragBase) this.set({ edits: present, history: { ...history, dragBase: null } }, 'edits');
      return;
    }
    this.set(
      {
        edits: history.past[history.past.length - 1],
        history: { past: history.past.slice(0, -1), future: [present, ...history.future], dragBase: null },
      },
      'edits',
    );
  };

  redo = () => {
    const { history, edits } = this.state;
    if (history.future.length === 0 || history.dragBase) return;
    this.set(
      { edits: history.future[0], history: { past: [...history.past, edits], future: history.future.slice(1), dragBase: null } },
      'edits',
    );
  };

  /** Drops all edits and the undo history (e.g. the track was replaced). */
  resetEdits = () => {
    this.set({ edits: EMPTY_EDITS, history: NO_HISTORY }, 'edits');
  };

  // -- Saving ---------------------------------------------------------------

  private schedule() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  /**
   * Writes the dirty parts now. Mid-drag, edits wait for the drag to end,
   * unless `force` (leaving the page), which saves the edits from before the drag.
   */
  flush(force = false) {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const { settings, edits, beats, history } = this.state;
    const save = (promise: Promise<unknown>) => void promise.catch(this.onError);
    if (this.dirty.has('settings')) save(this.persistence.saveSettings(settings));
    if (this.dirty.has('beats')) save(this.persistence.saveBeats(beats));
    const dragging = history.dragBase !== null;
    if (this.dirty.has('edits') && (!dragging || force)) save(this.persistence.saveEdits(history.dragBase ?? edits));
    const keepEdits = this.dirty.has('edits') && dragging && !force;
    this.dirty.clear();
    if (keepEdits) this.dirty.add('edits');
  }

  /** Forgets unsaved changes (before an import overwrites the stored project). */
  discardPendingSaves() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.dirty.clear();
  }
}
