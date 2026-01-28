import { useRef, useState } from 'react';
import { FiMaximize, FiMinimize } from 'react-icons/fi';
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
  const [colorizeMarker, setColorizeMarker] = useState(true);
  const [showNoteLines, setShowNoteLines] = useState(false);
  const [showNoteTrails, setShowNoteTrails] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const [statsCollapsed, setStatsCollapsed] = useState(false);
  const appRef = useRef<HTMLDivElement>(null);
  const graphCardRef = useRef<HTMLDivElement>(null);

  const { sample, error } = usePitchDetector({
    enabled,
    clarityThreshold,
    fftSize,
  });

  const graphHeight = isFullscreen ? undefined : 320;

  return (
    <div ref={appRef} className={`app${isFullscreen ? ' fullscreen' : ''}`}>

      {error && <div className="error">{error}</div>}

      <div
        ref={graphCardRef}
        className={`card graph-card${isFullscreen ? ' fullscreen' : ''}`}
      >
        <PitchGraph
          sample={sample}
          historyDuration={historyDuration}
          height={graphHeight}
          colorizeMarker={colorizeMarker}
          showNoteLines={showNoteLines}
          showNoteTrails={showNoteTrails}
        />
      </div>
      <button
        className="icon-button fullscreen-toggle-inline"
        onClick={() => setIsFullscreen((value) => !value)}
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      >
        {isFullscreen ? <FiMinimize /> : <FiMaximize />}
      </button>

      {isFullscreen ? (
        <div className="fullscreen-hud">
          <PitchControls
            enabled={enabled}
            clarityThreshold={clarityThreshold}
            historyDuration={historyDuration}
            fftSize={fftSize}
            colorizeMarker={colorizeMarker}
            showNoteLines={showNoteLines}
            showNoteTrails={showNoteTrails}
            setEnabled={setEnabled}
            setClarityThreshold={setClarityThreshold}
            setHistoryDuration={setHistoryDuration}
            setFftSize={setFftSize}
            setColorizeMarker={setColorizeMarker}
            setShowNoteLines={setShowNoteLines}
            setShowNoteTrails={setShowNoteTrails}
            isFullscreen
            collapsed={controlsCollapsed}
            onToggleCollapsed={() => setControlsCollapsed((value) => !value)}
          />

          <PitchStats
            sample={sample}
            isFullscreen
            collapsed={statsCollapsed}
            onToggleCollapsed={() => setStatsCollapsed((value) => !value)}
          />
          <div className="card fullscreen-toggle-card">
            <button
              className="icon-button"
              onClick={() => setIsFullscreen(false)}
              aria-label="Exit fullscreen"
            >
              <FiMinimize />
            </button>
          </div>
        </div>
      ) : (
        <>
          <PitchControls
            enabled={enabled}
            clarityThreshold={clarityThreshold}
            historyDuration={historyDuration}
            fftSize={fftSize}
            colorizeMarker={colorizeMarker}
            showNoteLines={showNoteLines}
            showNoteTrails={showNoteTrails}
            setEnabled={setEnabled}
            setClarityThreshold={setClarityThreshold}
            setHistoryDuration={setHistoryDuration}
            setFftSize={setFftSize}
            setColorizeMarker={setColorizeMarker}
            setShowNoteLines={setShowNoteLines}
            setShowNoteTrails={setShowNoteTrails}
          />

          <PitchStats sample={sample} />
        </>
      )}
    </div>
  );
}