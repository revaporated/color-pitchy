import type { Dispatch, SetStateAction } from 'react';
import { FiCircle, FiDownload, FiTrash2 } from 'react-icons/fi';
import type { ReferenceState } from '../hooks/useReferenceTrack';

type Props = {
  hasAudio: boolean;
  micArmed: boolean;
  recordTake: boolean;
  setRecordTake: Dispatch<SetStateAction<boolean>>;
  onlyWhilePlaying: boolean;
  setOnlyWhilePlaying: Dispatch<SetStateAction<boolean>>;
  showReference: boolean;
  setShowReference: Dispatch<SetStateAction<boolean>>;
  referenceClarity: number;
  setReferenceClarity: Dispatch<SetStateAction<number>>;
  syncOffsetMs: number;
  setSyncOffsetMs: Dispatch<SetStateAction<number>>;
  reference: ReferenceState;
  onClearTake: () => void;
  onExportTake: () => void;
  onExportReference: () => void;
};

export function StudioControls({
  hasAudio,
  micArmed,
  recordTake,
  setRecordTake,
  onlyWhilePlaying,
  setOnlyWhilePlaying,
  showReference,
  setShowReference,
  referenceClarity,
  setReferenceClarity,
  syncOffsetMs,
  setSyncOffsetMs,
  reference,
  onClearTake,
  onExportTake,
  onExportReference,
}: Props) {
  const referenceStatus =
    reference.status === 'analyzing'
      ? `Analyzing track... ${Math.round(reference.progress * 100)}%`
      : reference.status === 'ready'
        ? 'Reference contour ready'
        : reference.status === 'error'
          ? `Reference analysis failed: ${reference.message}`
          : 'Load a track to analyze its pitch';

  return (
    <div className="card controls studio-controls">
      <div className="studio-controls__row">
        <button
          type="button"
          className={`toggle-button record-toggle${recordTake ? ' is-active recording' : ''}`}
          onClick={() => setRecordTake((value) => !value)}
          disabled={!hasAudio}
          aria-pressed={recordTake}
          title="While on, the mic pitch is written onto the take whenever the track plays. Singing over a passage again replaces it."
        >
          <FiCircle /> {recordTake ? 'Recording take' : 'Record take'}
        </button>
        <button type="button" className="toggle-button" onClick={onClearTake} disabled={!hasAudio}>
          <FiTrash2 /> Clear take
        </button>
        <button type="button" className="toggle-button" onClick={onExportTake} disabled={!hasAudio}>
          <FiDownload /> Take MIDI
        </button>
        <button
          type="button"
          className="toggle-button"
          onClick={onExportReference}
          disabled={reference.status !== 'ready'}
        >
          <FiDownload /> Reference MIDI
        </button>
        {recordTake && !micArmed && <span className="studio-hint">Start the mic to record.</span>}
      </div>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={onlyWhilePlaying}
          onChange={(event) => setOnlyWhilePlaying(event.target.checked)}
        />
        Only detect while the track is playing
      </label>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={showReference}
          onChange={(event) => setShowReference(event.target.checked)}
        />
        Show reference contour
        <span className="studio-hint">{referenceStatus}</span>
      </label>

      <label>
        Reference clarity: {Math.round(referenceClarity * 100)}%
        <input
          type="range"
          min={0.3}
          max={1}
          step={0.01}
          value={referenceClarity}
          onChange={(event) => setReferenceClarity(parseFloat(event.target.value))}
        />
      </label>

      <label>
        Sync offset: {syncOffsetMs} ms
        <input
          type="range"
          min={-200}
          max={400}
          step={5}
          value={syncOffsetMs}
          onChange={(event) => setSyncOffsetMs(parseInt(event.target.value, 10))}
        />
        <span className="studio-hint">
          Shifts your take earlier to cancel mic and speaker latency. Sing along with a clear part
          of the track and adjust until your line sits on the reference.
        </span>
      </label>
    </div>
  );
}
