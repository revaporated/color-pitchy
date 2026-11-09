import type { Dispatch, SetStateAction } from 'react';
import { FiUpload } from 'react-icons/fi';
import type { AnalysisSettings, ReferenceState } from '../hooks/useReferenceTrack';
import { AnalysisPanel } from './AnalysisPanel';
import { InfoTip } from './InfoTip';

type Props = {
  hasAudio: boolean;
  fileName: string | null;
  isDecoding: boolean;
  error: string | null;
  onChooseFile: () => void;

  applied: AnalysisSettings;
  reference: ReferenceState;
  noteCount: number | null;
  onAnalyze: (settings: AnalysisSettings) => void;

  referenceClarity: number;
  setReferenceClarity: Dispatch<SetStateAction<number>>;
  playReference: boolean;
  setPlayReference: Dispatch<SetStateAction<boolean>>;
  referenceVolume: number;
  setReferenceVolume: Dispatch<SetStateAction<number>>;
  trackVolume: number;
  setTrackVolume: Dispatch<SetStateAction<number>>;
};

/** The track, how its reference notes are found, which notes are kept, and how they sound. */
export function TrackReferencePanel(props: Props) {
  const { hasAudio } = props;
  return (
    <>
      <div className="panel__section">
        <span className="section-label">Track</span>
        <div className="file-row">
          {props.fileName ? (
            <span className="file-meta">{props.fileName}</span>
          ) : (
            <span className="hint">No track yet</span>
          )}
          {props.isDecoding && <span className="hint">Decoding audio...</span>}
          <button
            type="button"
            className={props.fileName ? 'toggle-button' : 'toggle-button btn-primary'}
            onClick={props.onChooseFile}
          >
            <FiUpload /> {props.fileName ? 'Change track' : 'Add track'}
          </button>
        </div>
        {props.error && <div className="error">{props.error}</div>}
      </div>

      <AnalysisPanel
        hasAudio={hasAudio}
        applied={props.applied}
        reference={props.reference}
        noteCount={props.noteCount}
        onAnalyze={props.onAnalyze}
      />

      <div className="panel__section">
        <span className="section-label">Notes kept</span>
        <label className="slider-row">
          <span className="slider-row__text">Min confidence: {Math.round(props.referenceClarity * 100)}%</span>
          <input
            type="range"
            min={0.3}
            max={1}
            step={0.01}
            value={props.referenceClarity}
            onChange={(event) => props.setReferenceClarity(parseFloat(event.target.value))}
          />
          <InfoTip>
            Drops reference notes the analysis wasn't sure about. Raise it to clear out noise, lower it
            to keep quieter or less certain notes. This filters the existing analysis, so it doesn't need
            a re-run.
          </InfoTip>
        </label>
      </div>

      <div className="panel__section">
        <span className="section-label">Listen</span>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={props.playReference}
            onChange={(event) => props.setPlayReference(event.target.checked)}
          />
          Play reference notes as MIDI
          <InfoTip>
            Plays the reference notes with a simple synth while the track plays, so you can hear where
            the analysis is wrong. Turn the track volume down to hear the notes on their own.
          </InfoTip>
        </label>
        <label className="slider-row">
          <span className="slider-row__text">Reference volume: {Math.round(props.referenceVolume * 100)}%</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={props.referenceVolume}
            disabled={!props.playReference}
            title={props.playReference ? undefined : 'Turn on "Play reference notes as MIDI" to use this'}
            onChange={(event) => props.setReferenceVolume(parseFloat(event.target.value))}
          />
        </label>
        <label className="slider-row">
          <span className="slider-row__text">Track volume: {Math.round(props.trackVolume * 100)}%</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={props.trackVolume}
            onChange={(event) => props.setTrackVolume(parseFloat(event.target.value))}
          />
        </label>
      </div>
    </>
  );
}
