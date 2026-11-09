import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_EDITS, type NoteEdits } from '../audio/noteEdits';
import { getEdits, saveEdits } from '../storage/projects';

const MAX_UNDO = 200;
const SAVE_DELAY_MS = 600;

type History = {
  past: NoteEdits[];
  present: NoteEdits;
  future: NoteEdits[];
  /** Edits when the current drag began, or null when not dragging. */
  dragBase: NoteEdits | null;
};

const START: History = { past: [], present: EMPTY_EDITS, future: [], dragBase: null };

export type NoteEditsApi = {
  edits: NoteEdits;
  /** False until the saved edits have loaded (editing is blocked until then). */
  loaded: boolean;
  /** One finished change: applied and added to undo. */
  apply: (change: (edits: NoteEdits) => NoteEdits) => void;
  /**
   * Live update during a drag. Every call starts again from the edits as they
   * were when the drag began, so a whole drag becomes one undo step on `commit`.
   */
  preview: (change: (base: NoteEdits) => NoteEdits) => void;
  commit: () => void;
  cancel: () => void;
  undo: () => void;
  redo: () => void;
  /** Drops all edits and the undo history (e.g. the track was replaced). */
  reset: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

/** A project's note edits with undo/redo, loaded from and autosaved to the library. */
export function useNoteEdits(projectId: string): NoteEditsApi {
  const [history, setHistory] = useState<History>(START);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getEdits(projectId)
      .catch((err) => {
        console.error('Loading note edits failed', err);
        return undefined;
      })
      .then((saved) => {
        if (cancelled) return;
        setHistory({ ...START, present: saved ?? EMPTY_EDITS });
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Autosave shortly after changes settle (not mid-drag), and on leaving.
  const present = history.present;
  const dragging = history.dragBase !== null;
  const savedRef = useRef<NoteEdits | null>(null);
  useEffect(() => {
    if (!loaded || dragging) return;
    if (savedRef.current === null) {
      savedRef.current = present; // what was just loaded
      return;
    }
    if (present === savedRef.current) return;
    const save = () => {
      savedRef.current = present;
      void saveEdits(projectId, present).catch((err) => console.error('Saving note edits failed', err));
    };
    const timer = setTimeout(save, SAVE_DELAY_MS);
    return () => {
      clearTimeout(timer);
      if (savedRef.current !== present) save();
    };
  }, [loaded, dragging, present, projectId]);

  const apply = useCallback((change: (edits: NoteEdits) => NoteEdits) => {
    setHistory((h) => {
      const base = h.dragBase ?? h.present;
      const next = change(base);
      if (next === base && !h.dragBase) return h;
      return { past: [...h.past, base].slice(-MAX_UNDO), present: next, future: [], dragBase: null };
    });
  }, []);

  const preview = useCallback((change: (base: NoteEdits) => NoteEdits) => {
    setHistory((h) => {
      const base = h.dragBase ?? h.present;
      return { ...h, dragBase: base, present: change(base) };
    });
  }, []);

  const commit = useCallback(() => {
    setHistory((h) => {
      if (!h.dragBase) return h;
      if (h.present === h.dragBase) return { ...h, dragBase: null };
      return { past: [...h.past, h.dragBase].slice(-MAX_UNDO), present: h.present, future: [], dragBase: null };
    });
  }, []);

  const cancel = useCallback(() => {
    setHistory((h) => (h.dragBase ? { ...h, present: h.dragBase, dragBase: null } : h));
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => {
      const present = h.dragBase ?? h.present;
      if (h.past.length === 0) return h.dragBase ? { ...h, present, dragBase: null } : h;
      return {
        past: h.past.slice(0, -1),
        present: h.past[h.past.length - 1],
        future: [present, ...h.future],
        dragBase: null,
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((h) => {
      if (h.future.length === 0 || h.dragBase) return h;
      return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), dragBase: null };
    });
  }, []);

  const reset = useCallback(() => setHistory(START), []);

  return {
    edits: present,
    reset,
    loaded,
    apply,
    preview,
    commit,
    cancel,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}
