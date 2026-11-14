import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { deleteNote, type NoteEdits } from '../../audio/noteEdits';
import type { NoteSet } from '../../audio/noteSet';
import type { StudioTool } from '../../components/StudioToolbar';
import type { NoteEditsApi } from '../../hooks/useNoteEdits';
import type { Selection } from './useLoopSelection';

export type ShortcutContext = {
  hasAudio: boolean;
  handlePlayPause: () => void;
  goToStart: () => void;
  setShowShortcuts: Dispatch<SetStateAction<boolean>>;
  setArmed: Dispatch<SetStateAction<boolean>>;
  toggleRecord: () => void;
  selection: Selection | null;
  setLoopEnabled: Dispatch<SetStateAction<boolean>>;
  changeTool: (tool: StudioTool) => void;
  noteEdits: NoteEditsApi;
  penMode: boolean;
  selectedNoteId: string | null;
  setSelectedNoteId: Dispatch<SetStateAction<string | null>>;
  referenceNotes: NoteSet | null;
  applyEdit: (change: (edits: NoteEdits) => NoteEdits) => void;
  undoEdit: () => void;
  redoEdit: () => void;
  nudgeSelected: (semitones: number, seconds: number) => void;
};

/** Studio's keyboard shortcuts (listed in ShortcutsDialog). */
export function useStudioShortcuts(context: ShortcutContext) {
  // Keyboard shortcuts (listed in ShortcutsDialog). The handler is refreshed
  // every render, so it always sees current state without re-subscribing.
  const onKeyRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    onKeyRef.current = (event: KeyboardEvent) => {
      const {
        hasAudio,
        handlePlayPause,
        goToStart,
        setShowShortcuts,
        setArmed,
        toggleRecord,
        selection,
        setLoopEnabled,
        changeTool,
        noteEdits,
        penMode,
        selectedNoteId,
        setSelectedNoteId,
        referenceNotes,
        applyEdit,
        undoEdit,
        redoEdit,
        nudgeSelected,
      } = context;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, select, textarea, [contenteditable="true"], [role="dialog"]')) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoEdit();
        else undoEdit();
        return;
      }
      if (mod && key === 'y') {
        event.preventDefault();
        redoEdit();
        return;
      }
      if (mod || event.altKey) return;

      if (event.key === ' ') {
        event.preventDefault();
        if (hasAudio) handlePlayPause();
        return;
      }
      if (event.key === '?') {
        setShowShortcuts(true);
        return;
      }
      if (key === 'home') {
        event.preventDefault();
        if (hasAudio) goToStart();
        return;
      }
      if (key === 'm') return setArmed((value) => !value);
      if (key === 'r' && hasAudio) return toggleRecord();
      if (key === 'l' && selection) return setLoopEnabled((value) => !value);
      if (key === 'h' && hasAudio) return changeTool('pan');
      if (key === 's' && hasAudio) return changeTool('select');
      if (key === 'p' && hasAudio && noteEdits.loaded) return changeTool(penMode ? 'pan' : 'pen');

      if (!penMode) return;
      if ((key === 'delete' || key === 'backspace') && selectedNoteId) {
        const note = referenceNotes?.findById(selectedNoteId);
        if (note) {
          event.preventDefault();
          applyEdit((edits) => deleteNote(edits, note));
          setSelectedNoteId(null);
        }
      } else if (key === 'escape') {
        setSelectedNoteId(null);
      } else if (selectedNoteId && event.key.startsWith('Arrow')) {
        event.preventDefault();
        const step = event.shiftKey ? 12 : 1;
        const nudge = event.shiftKey ? 0.01 : 0.05;
        if (event.key === 'ArrowUp') nudgeSelected(step, 0);
        else if (event.key === 'ArrowDown') nudgeSelected(-step, 0);
        else if (event.key === 'ArrowLeft') nudgeSelected(0, -nudge);
        else if (event.key === 'ArrowRight') nudgeSelected(0, nudge);
      }
    };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => onKeyRef.current(event);
    // A focused button would also "click" on Space's keyup; Space means play/pause here.
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ' && (event.target as HTMLElement | null)?.closest('button')) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

}
