import { useState } from 'react';
import { usePitchDetector } from './hooks/usePitchDetector';
import { PitchGraph } from './components/PitchGraph';
import { formatNoteLabel } from './utils/pitch';
import './index.css';

export default function App() {
  const [enabled, setEnabled] = useState(false);
  const [clarityThreshold, setClarityThreshold] = useState(0.9);
  const [historyDuration, setHistoryDuration] = useState(4);

  const { sample, error } = usePitchDetector({
    enabled,
    clarityThreshold,
  });

  const noteLabel = sample.midi != null ? formatNoteLabel(sample.midi) : '—';
  const frequencyLabel =
    sample.frequency != null ? `${sample.frequency.toFixed(2)} Hz` : '—';
  const clarityLabel =
    sample.clarity != null ? `${Math.round(sample.clarity * 100)}%` : '—';

  return (
    <div className="app">

      {error && <div className="error">{error}</div>}

      <div className="card">
        <PitchGraph sample={sample} historyDuration={historyDuration} height={320} />
      </div>

      <div className="card controls">
        <button onClick={() => setEnabled((v) => !v)}>
          {enabled ? 'Stop' : 'Start'}
        </button>

        <label>
          Clarity threshold: {Math.round(clarityThreshold * 100)}%
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={clarityThreshold}
            onChange={(e) => setClarityThreshold(parseFloat(e.target.value))}
          />
        </label>

        <label>
          History (seconds): {historyDuration}
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={historyDuration}
            onChange={(e) => setHistoryDuration(parseInt(e.target.value, 10))}
          />
        </label>
      </div>

      <div className="card stats">
        <div>Note: {noteLabel}</div>
        <div>Frequency: {frequencyLabel}</div>
        <div>Clarity: {clarityLabel}</div>
      </div>
    </div>
  );
}