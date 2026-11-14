import type { NoteEdits } from '../audio/noteEdits';
import type { ProjectStore } from '../project/projectStore';
import { useProjectState } from '../project/useProject';

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

/** The project's note edits with undo/redo. The project store loads and saves them. */
export function useNoteEdits(store: ProjectStore): NoteEditsApi {
  const { edits, editsLoaded, history } = useProjectState(store);
  return {
    edits,
    loaded: editsLoaded,
    apply: store.applyEdit,
    preview: store.previewEdit,
    commit: store.commitEdit,
    cancel: store.cancelEdit,
    undo: store.undo,
    redo: store.redo,
    reset: store.resetEdits,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}
