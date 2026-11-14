import type { RefObject } from 'react';
import { FiCommand, FiDownload, FiMoreHorizontal, FiSave, FiTool, FiTrash2, FiUploadCloud, FiXCircle } from 'react-icons/fi';
import { MenuItem, Popover } from '../../components/Popover';

type Props = {
  hasAudio: boolean;
  referenceReady: boolean;
  editCount: number;
  exportTake: () => void;
  exportReference: () => void;
  exportProjectData: () => Promise<void>;
  importInputRef: RefObject<HTMLInputElement | null>;
  clearTake: () => void;
  clearEdits: () => void;
  debugExport: () => Promise<void>;
  setShowShortcuts: (show: boolean) => void;
};

/** The Studio toolbar's ⋯ menu. */
export function StudioMenu({
  hasAudio,
  referenceReady,
  editCount,
  exportTake,
  exportReference,
  exportProjectData,
  importInputRef,
  clearTake,
  clearEdits,
  debugExport,
  setShowShortcuts,
}: Props) {
  return (
    <Popover
      kind="menu"
      label="More actions"
      trigger={(trigger) => (
        <button type="button" className="icon-button" {...trigger} aria-label="More actions" title="More actions">
          <FiMoreHorizontal />
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuItem close={close} icon={<FiDownload />} onSelect={exportTake} disabled={!hasAudio}>
            Export take as MIDI
          </MenuItem>
          <MenuItem close={close} icon={<FiDownload />} onSelect={exportReference} disabled={!referenceReady}>
            Export reference as MIDI
          </MenuItem>
          <div className="menu__sep" role="separator" />
          <MenuItem
            close={close}
            icon={<FiSave />}
            onSelect={() => void exportProjectData()}
            title="Save this project's settings, note edits, take and beats to a file (the audio is not included)"
          >
            Export project data
          </MenuItem>
          <MenuItem
            close={close}
            icon={<FiUploadCloud />}
            onSelect={() => importInputRef.current?.click()}
            title="Replace this project's settings, note edits, take and beats with a saved file"
          >
            Import project data...
          </MenuItem>
          <div className="menu__sep" role="separator" />
          <MenuItem close={close} icon={<FiTrash2 />} onSelect={clearTake} disabled={!hasAudio} danger>
            Clear take...
          </MenuItem>
          <MenuItem close={close} icon={<FiXCircle />} onSelect={clearEdits} disabled={editCount === 0} danger>
            Clear note edits...
          </MenuItem>
          <div className="menu__sep" role="separator" />
          <MenuItem
            close={close}
            icon={<FiTool />}
            onSelect={() => void debugExport()}
            disabled={!hasAudio}
            title="Save the decoded audio (WAV), reference contour (CSV) and settings (JSON) to debug-exports/ in the project"
          >
            Debug export
          </MenuItem>
          <MenuItem close={close} icon={<FiCommand />} onSelect={() => setShowShortcuts(true)}>
            Keyboard shortcuts <kbd>?</kbd>
          </MenuItem>
        </>
      )}
    </Popover>
  );
}
