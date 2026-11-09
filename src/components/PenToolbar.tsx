import { FiCornerUpLeft, FiCornerUpRight, FiEdit2, FiXCircle } from 'react-icons/fi';
import { InfoTip } from './InfoTip';

type Props = {
  enabled: boolean;
  penMode: boolean;
  onTogglePen: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Notes added or changed plus auto notes removed. */
  editCount: number;
  onClearEdits: () => void;
};

/** Pen mode switch, undo/redo and edit count, above the pitch graph. */
export function PenToolbar({
  enabled,
  penMode,
  onTogglePen,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  editCount,
  onClearEdits,
}: Props) {
  return (
    <div className="studio-controls__row pen-toolbar">
      <button
        type="button"
        className={`toggle-button${penMode ? ' is-active' : ''}`}
        onClick={onTogglePen}
        disabled={!enabled}
        aria-pressed={penMode}
        title="Edit the reference notes (P)"
      >
        <FiEdit2 /> Pen
      </button>
      <button type="button" className="toggle-button" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
        <FiCornerUpLeft /> Undo
      </button>
      <button
        type="button"
        className="toggle-button"
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo (Ctrl+Shift+Z)"
      >
        <FiCornerUpRight /> Redo
      </button>
      <button
        type="button"
        className="toggle-button"
        onClick={onClearEdits}
        disabled={editCount === 0}
        title="Remove all hand edits and go back to the analysis"
      >
        <FiXCircle /> Clear edits
      </button>
      <span className="studio-hint">
        {editCount === 0 ? 'No edits' : `${editCount} edit${editCount === 1 ? '' : 's'}`}
      </span>
      {penMode && (
        <span className="pen-toolbar__help">
          <InfoTip>
            Click to add a note, or drag to draw a longer one. Drag a note to move it; hold Shift to
            change only its pitch. Drag either end to trim. Right-click a note, or select it and press
            Delete, to remove it. Esc cancels a drag. Your edits are kept when you re-analyze.
          </InfoTip>
        </span>
      )}
    </div>
  );
}
