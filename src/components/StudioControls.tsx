import type { Dispatch, SetStateAction } from 'react';
import { FiCircle, FiDownload, FiTool, FiTrash2 } from 'react-icons/fi';
import { InfoTip } from './InfoTip';
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
  referenceOpacity: number;
  topVoiceReference: boolean;
  setTopVoiceReference: Dispatch<SetStateAction<boolean>>;
  referenceSmoothing: number;
  setReferenceSmoothing: Dispatch<SetStateAction<number>>;
  setReferenceOpacity: Dispatch<SetStateAction<number>>;
  syncOffsetMs: number;
  setSyncOffsetMs: Dispatch<SetStateAction<number>>;
  reference: ReferenceState;
  onClearTake: () => void;
  onExportTake: () => void;
  onExportReference: () => void;
  onDebugExport: () => void;
  debugExportStatus: string | null;
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
  referenceOpacity,
  setReferenceOpacity,
  topVoiceReference,
  setTopVoiceReference,
  referenceSmoothing,
  setReferenceSmoothing,
  syncOffsetMs,
  setSyncOffsetMs,
  reference,
  onClearTake,
  onExportTake,
  onExportReference,
  onDebugExport,
  debugExportStatus,
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
        <button
          type="button"
          className="toggle-button"
          onClick={onDebugExport}
          disabled={!hasAudio}
          title="Save the decoded audio (WAV), reference contour (CSV) and settings (JSON) to debug-exports/ in the project"
        >
          <FiTool /> Debug export
        </button>
        {debugExportStatus && <span className="studio-hint">{debugExportStatus}</span>}
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

      <label className="checkbox">
        <input
          type="checkbox"
          checked={topVoiceReference}
          onChange={(event) => setTopVoiceReference(event.target.checked)}
        />
        Top-voice reference (for chords and piano)
      </label>

      {topVoiceReference && (
        <label className="slider-row">
          <span className="slider-row__text">Reference smoothing: {referenceSmoothing === 0 ? 'off' : referenceSmoothing}</span>
          <input
            type="range"
            min={0}
            max={10}
            step={1}
            value={referenceSmoothing}
            onChange={(event) => setReferenceSmoothing(parseInt(event.target.value, 10))}
          />
          <InfoTip>
            How reluctant the tracker is to change notes. Higher removes flicker and blips but can
            merge very fast notes. Re-analyzes the track. The tracker decides when a note is
            sounding, so Reference clarity has no effect while smoothing is on.
          </InfoTip>
        </label>
      )}

      <label className="slider-row">
        <span className="slider-row__text">Reference clarity: {Math.round(referenceClarity * 100)}%</span>
        <input
          type="range"
          min={0.3}
          max={1}
          step={0.01}
          value={referenceClarity}
          onChange={(event) => setReferenceClarity(parseFloat(event.target.value))}
        />
      </label>

      <label className="slider-row">
        <span className="slider-row__text">Reference opacity: {Math.round(referenceOpacity * 100)}%</span>
        <input
          type="range"
          min={0.05}
          max={1}
          step={0.01}
          value={referenceOpacity}
          onChange={(event) => setReferenceOpacity(parseFloat(event.target.value))}
        />
      </label>

      <label className="slider-row">
        <span className="slider-row__text">Sync offset: {syncOffsetMs} ms</span>
        <input
          type="range"
          min={-200}
          max={400}
          step={5}
          value={syncOffsetMs}
          onChange={(event) => setSyncOffsetMs(parseInt(event.target.value, 10))}
        />
        <InfoTip>
          Shifts your take earlier to cancel mic and speaker latency. Sing along with a clear part
          of the track and adjust until your line sits on the reference.
        </InfoTip>
      </label>
    </div>
  );
}
