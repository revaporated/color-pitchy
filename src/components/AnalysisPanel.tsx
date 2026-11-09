import { useState } from 'react';
import { FiPlay, FiRefreshCw, FiRotateCcw } from 'react-icons/fi';
import { InfoTip } from './InfoTip';
import { sameAnalysis, type AnalysisSettings, type ReferenceState } from '../hooks/useReferenceTrack';
import { midiToNoteName } from '../utils/pitch';

type Props = {
  hasAudio: boolean;
  /** The settings the current reference was (or will be) analyzed with. */
  applied: AnalysisSettings;
  reference: ReferenceState;
  noteCount: number | null;
  /** Apply `settings` and run the analysis. Same as `applied` means re-run from scratch. */
  onAnalyze: (settings: AnalysisSettings) => void;
};

const WINDOW_OPTIONS = [0, 23, 46, 93, 186];
/** C1 to C8. */
const RANGE_NOTES = Array.from({ length: 108 - 24 + 1 }, (_, i) => 24 + i);
/** Keep at least an octave between the range ends. */
const MIN_SPAN = 12;

function noteLabel(midi: number) {
  const { note, octave } = midiToNoteName(midi);
  return `${note}${octave}`;
}

/**
 * Reference analysis settings. Edits are a draft: nothing re-runs until you
 * press Analyze, so you can set everything up before a long analysis.
 */
export function AnalysisPanel({ hasAudio, applied, reference, noteCount, onAnalyze }: Props) {
  const [draft, setDraft] = useState(applied);
  // Follow the applied settings when they change from outside (e.g. after Analyze).
  const [lastApplied, setLastApplied] = useState(applied);
  if (lastApplied !== applied) {
    setLastApplied(applied);
    setDraft(applied);
  }

  const dirty = !sameAnalysis(draft, applied);
  const update = (patch: Partial<AnalysisSettings>) => setDraft((value) => ({ ...value, ...patch }));
  const analyzing = reference.status === 'analyzing';
  const needsAnalysis = reference.status === 'idle' && reference.needsAnalysis === true;

  let status: string;
  if (!hasAudio) status = 'Load a track to analyze it.';
  else if (analyzing) status = `Analyzing... ${Math.round(reference.progress * 100)}%`;
  else if (reference.status === 'error') status = `Analysis failed: ${reference.message}`;
  else if (dirty) status = 'Settings changed. Press Analyze to apply them.';
  else if (needsAnalysis) status = 'Not analyzed with these settings yet.';
  else if (reference.status === 'ready') status = `Reference ready: ${noteCount ?? 0} notes.`;
  else status = 'Checking for a saved analysis...';

  const rerun = !dirty && reference.status === 'ready';

  return (
    <div className="card controls analysis-panel">
      <div className="analysis-panel__header">
        <strong>Reference analysis</strong>
        <span className="studio-hint">{status}</span>
      </div>

      <div className="slider-row" role="radiogroup" aria-label="Analysis method">
        <span className="slider-row__text">Method</span>
        <div className="analysis-panel__choices">
          <label className="checkbox">
            <input
              type="radio"
              name="analysis-method"
              checked={draft.method === 'pitchy'}
              onChange={() => update({ method: 'pitchy' })}
            />
            Single voice
          </label>
          <label className="checkbox">
            <input
              type="radio"
              name="analysis-method"
              checked={draft.method === 'topVoice'}
              onChange={() => update({ method: 'topVoice' })}
            />
            Top voice (chords, piano)
          </label>
        </div>
        <InfoTip>
          Single voice follows one clear melody line, such as a singer or a solo instrument. Top voice
          looks for the highest strong note in a mix, which works better for piano and chords.
        </InfoTip>
      </div>

      {draft.method === 'topVoice' && (
        <label className="slider-row">
          <span className="slider-row__text">Smoothing: {draft.smoothing === 0 ? 'off' : draft.smoothing}</span>
          <input
            type="range"
            min={0}
            max={10}
            step={1}
            value={draft.smoothing}
            onChange={(event) => update({ smoothing: parseInt(event.target.value, 10) })}
          />
          <InfoTip>
            How reluctant the tracker is to change notes. Higher removes flicker and blips but can
            merge very fast notes. The tracker decides when a note is sounding, so Reference clarity
            has no effect while smoothing is on.
          </InfoTip>
        </label>
      )}

      <label className="slider-row">
        <span className="slider-row__text">Window</span>
        <select
          className="analysis-panel__select"
          value={draft.windowMs}
          onChange={(event) => update({ windowMs: parseInt(event.target.value, 10) })}
        >
          {WINDOW_OPTIONS.map((ms) => (
            <option key={ms} value={ms}>
              {ms === 0 ? `Automatic (~${draft.method === 'topVoice' ? 93 : 46} ms)` : `~${ms} ms`}
            </option>
          ))}
        </select>
        <InfoTip>
          How much audio each pitch estimate looks at. Longer windows tell low notes apart better but
          blur fast passages. Shorter windows react faster but get unreliable below about C3.
        </InfoTip>
      </label>

      <div className="slider-row">
        <span className="slider-row__text">Note range</span>
        <div className="analysis-panel__choices">
          <select
            className="analysis-panel__select"
            aria-label="Lowest note"
            value={draft.minMidi}
            onChange={(event) => update({ minMidi: parseInt(event.target.value, 10) })}
          >
            {RANGE_NOTES.filter((m) => m <= draft.maxMidi - MIN_SPAN).map((m) => (
              <option key={m} value={m}>
                {noteLabel(m)}
              </option>
            ))}
          </select>
          to
          <select
            className="analysis-panel__select"
            aria-label="Highest note"
            value={draft.maxMidi}
            onChange={(event) => update({ maxMidi: parseInt(event.target.value, 10) })}
          >
            {RANGE_NOTES.filter((m) => m >= draft.minMidi + MIN_SPAN).map((m) => (
              <option key={m} value={m}>
                {noteLabel(m)}
              </option>
            ))}
          </select>
        </div>
        <InfoTip>
          Notes outside this range are ignored. Narrowing it to the part you care about cuts out bass
          and octave mistakes. Top voice also runs faster with a smaller range.
        </InfoTip>
      </div>

      <div className="studio-controls__row">
        <button
          type="button"
          className={`toggle-button${dirty || needsAnalysis ? ' is-primary' : ''}`}
          disabled={!hasAudio || analyzing}
          onClick={() => onAnalyze(draft)}
          title={rerun ? 'Discard the saved analysis and run it again' : undefined}
        >
          {rerun ? <FiRefreshCw /> : <FiPlay />} {rerun ? 'Re-analyze' : 'Analyze'}
        </button>
        {dirty && (
          <button type="button" className="toggle-button" onClick={() => setDraft(applied)}>
            <FiRotateCcw /> Revert
          </button>
        )}
      </div>
    </div>
  );
}
