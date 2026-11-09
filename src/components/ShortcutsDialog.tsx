import { useEffect, useRef } from 'react';
import { FiX } from 'react-icons/fi';

const SHORTCUTS: [string[], string][] = [
  [['Space'], 'Play / pause'],
  [['Home'], 'Back to the start (or the loop start)'],
  [['L'], 'Loop the selection on / off'],
  [['M'], 'Mic on / off'],
  [['R'], 'Record take on / off'],
  [['H'], 'Pan tool'],
  [['S'], 'Select tool (drag on the waveform to loop a passage)'],
  [['P'], 'Pen tool (edit the reference notes)'],
  [['Ctrl', 'Z'], 'Undo note edit'],
  [['Ctrl', 'Shift', 'Z'], 'Redo note edit'],
  [['↑', '↓'], 'Pen: move the selected note a semitone (Shift: an octave)'],
  [['←', '→'], 'Pen: nudge the selected note 50 ms (Shift: 10 ms)'],
  [['Delete'], 'Pen: delete the selected note'],
  [['Esc'], 'Pen: deselect, or cancel a drag'],
  [['?'], 'Show this list'],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="card dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
        <div className="dialog__header">
          <h2 id="shortcuts-title">Keyboard shortcuts</h2>
          <button ref={closeRef} type="button" className="icon-button btn-ghost" onClick={onClose} aria-label="Close">
            <FiX />
          </button>
        </div>
        <dl className="shortcut-list">
          {SHORTCUTS.map(([keys, action]) => (
            <div key={action} style={{ display: 'contents' }}>
              <dt>
                {keys.map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
