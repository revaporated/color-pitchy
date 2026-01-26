import { useState } from 'react';
import { usePitchDetector } from './hooks/usePitchDetector';
import { PitchControls } from './components/PitchControls';
import { PitchGraph } from './components/PitchGraph';
import { PitchStats } from './components/PitchStats';
import './index.css';

export default function App() {
  const [enabled, setEnabled] = useState(false);
  const [clarityThreshold, setClarityThreshold] = useState(0.9);
  const [historyDuration, setHistoryDuration] = useState(4);
  const [fftSize, setFftSize] = useState(2048);

  const { sample, error } = usePitchDetector({
    enabled,
    clarityThreshold,
    fftSize,
  });

  return (
    <div className="app">

      {error && <div className="error">{error}</div>}

      <div className="card">
        <PitchGraph sample={sample} historyDuration={historyDuration} height={320} />
      </div>

      <PitchControls
        enabled={enabled}
        clarityThreshold={clarityThreshold}
        historyDuration={historyDuration}
        fftSize={fftSize}
        setEnabled={setEnabled}
        setClarityThreshold={setClarityThreshold}
        setHistoryDuration={setHistoryDuration}
        setFftSize={setFftSize}
      />

      <PitchStats sample={sample} />
    </div>
  );
}