import { useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { addNote, deleteNote, updateNote, type NoteEdits } from '../../audio/noteEdits';
import type { ReferencePlayer } from '../../audio/referencePlayer';
import type { PenGesture, PenOptions } from '../../components/PitchGraph';
import type { NoteEditsApi } from '../../hooks/useNoteEdits';

/** What the Pen tool does on the graph: gestures become note edits, with undo. Null when the Pen is off. */
export function usePenOptions(
  penMode: boolean,
  noteEdits: NoteEditsApi,
  hasAudio: boolean,
  selectedNoteId: string | null,
  setSelectedNoteId: Dispatch<SetStateAction<string | null>>,
  referencePlayer: ReferencePlayer,
) {
  const { preview: previewEdit, commit: commitEdit, cancel: cancelEdit, apply: applyEdit } = noteEdits;
  const pen: PenOptions | null = useMemo(() => {
    if (!penMode || !noteEdits.loaded || !hasAudio) return null;
    const run = (gesture: PenGesture) => (edits: NoteEdits) =>
      gesture.kind === 'create'
        ? addNote(edits, gesture.span, gesture.id)
        : updateNote(edits, gesture.note, gesture.span, gesture.newId);
    return {
      selectedId: selectedNoteId,
      onSelect: setSelectedNoteId,
      onGesture: (gesture, phase) => {
        if (phase === 'cancel') {
          cancelEdit();
          return;
        }
        previewEdit(run(gesture));
        if (phase === 'commit') commitEdit();
        setSelectedNoteId(
          gesture.kind === 'create'
            ? gesture.id
            : gesture.note.origin === 'manual'
              ? gesture.note.id
              : gesture.newId,
        );
      },
      onDelete: (note) => {
        applyEdit((edits) => deleteNote(edits, note));
        setSelectedNoteId(null);
      },
      onAudition: (midi) => referencePlayer.audition(midi),
    };
  }, [
    penMode,
    noteEdits.loaded,
    hasAudio,
    selectedNoteId,
    previewEdit,
    commitEdit,
    cancelEdit,
    applyEdit,
    referencePlayer,
  ]);

  return pen;
}
