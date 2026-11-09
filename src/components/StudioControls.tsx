import type { Dispatch, SetStateAction } from 'react';
import { FiCircle, FiDownload, FiTool, FiTrash2 } from 'react-icons/fi';
import { InfoTip } from './InfoTip';
import { Stepper } from './Stepper';
import type { SpectrogramView } from '../audio/spectrogramImage';

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
  setReferenceOpacity: Dispatch<SetStateAction<number>>;
  syncOffsetMs: number;
  setSyncOffsetMs: Dispatch<SetStateAction<number>>;
  playReference: boolean;
  setPlayReference: Dispatch<SetStateAction<boolean>>;
  referenceVolume: number;
  setReferenceVolume: Dispatch<SetStateAction<number>>;
  trackVolume: number;
  setTrackVolume: Dispatch<SetStateAction<number>>;

  onClearTake: () => void;
  onExportTake: () => void;
  onExportReference: () => void;
  onDebugExport: () => void;
  debugExportStatus: string | null;
  /** Whether there are reference notes to export. */
  referenceReady: boolean;
  showSpectrogram: boolean;
  setShowSpectrogram: Dispatch<SetStateAction<boolean>>;
  spectrogramView: SpectrogramView;
  setSpectrogramView: Dispatch<SetStateAction<SpectrogramView>>;
  spectrogramRange: number;
  setSpectrogramRange: Dispatch<SetStateAction<number>>;
  spectrogramOpacity: number;
  setSpectrogramOpacity: Dispatch<SetStateAction<number>>;
  /** Progress or error text, or null when idle/ready. */
  spectrogramStatus: string | null;
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
  syncOffsetMs,
  setSyncOffsetMs,
  playReference,
  setPlayReference,
  referenceVolume,
  setReferenceVolume,
  trackVolume,
  setTrackVolume,

  onClearTake,
  onExportTake,
  onExportReference,
  onDebugExport,
  debugExportStatus,
  referenceReady,
  showSpectrogram,
  setShowSpectrogram,
  spectrogramView,
  setSpectrogramView,
  spectrogramRange,
  setSpectrogramRange,
  spectrogramOpacity,
  setSpectrogramOpacity,
  spectrogramStatus,
}: Props) {
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
          disabled={!referenceReady}
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

      <div className="checkbox-group">
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
          Show reference
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={playReference}
            onChange={(event) => setPlayReference(event.target.checked)}
          />
          Play reference as MIDI
          <InfoTip>
            Plays the reference notes with a simple synth while the track plays, so you can hear
            where the analysis is wrong. Turn the track volume down to hear the notes on their own.
          </InfoTip>
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={showSpectrogram}
            onChange={(event) => setShowSpectrogram(event.target.checked)}
          />
          Show spectrogram
          {spectrogramStatus && <span className="studio-hint">{spectrogramStatus}</span>}
        </label>
      </div>

      {showSpectrogram && (
        <div className="stepper-group">
          <label className="inline-field">
            View
            <select
              className="analysis-panel__select"
              value={spectrogramView}
              onChange={(event) => setSpectrogramView(event.target.value as SpectrogramView)}
            >
              <option value="peaks">Notes only</option>
              <option value="harmonic">Harmonic</option>
              <option value="raw">Raw</option>
            </select>
            <InfoTip>
              Raw shows the energy at each semitone, so overtones appear as extra rows above a
              note. Harmonic adds up each note's overtones and fades anything that doesn't stand
              out, so the played notes light up. Notes only goes further and keeps roughly one
              bright row per sounding note.
            </InfoTip>
          </label>
          <Stepper
            label="Range"
            value={`${spectrogramRange} dB`}
            onStep={(direction) => setSpectrogramRange((value) => Math.min(90, Math.max(20, value + direction * 5)))}
            canDecrease={spectrogramRange > 20}
            canIncrease={spectrogramRange < 90}
          />
          <label className="inline-field">
            Opacity: {Math.round(spectrogramOpacity * 100)}%
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={spectrogramOpacity}
              onChange={(event) => setSpectrogramOpacity(parseFloat(event.target.value))}
            />
          </label>
        </div>
      )}

      <div className="control-pair">
        <label className="slider-row">
          <span className="slider-row__text">Reference volume: {Math.round(referenceVolume * 100)}%</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={referenceVolume}
            disabled={!playReference}
            title={playReference ? undefined : 'Turn on "Play reference as MIDI" to use this'}
            onChange={(event) => setReferenceVolume(parseFloat(event.target.value))}
          />
        </label>

        <label className="slider-row">
          <span className="slider-row__text">Track volume: {Math.round(trackVolume * 100)}%</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={trackVolume}
            onChange={(event) => setTrackVolume(parseFloat(event.target.value))}
          />
        </label>
      </div>

      <div className="control-pair">
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
      </div>

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
