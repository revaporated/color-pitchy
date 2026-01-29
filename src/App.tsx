import { useRef, useState } from 'react';
import { FiMaximize, FiMinimize } from 'react-icons/fi';
import { usePitchDetector } from './hooks/usePitchDetector';
import { usePitchRecording } from './hooks/usePitchRecording';
import { PitchControls } from './components/PitchControls';
import { PitchGraph } from './components/PitchGraph';
import { PitchStats } from './components/PitchStats';
import { RecordingControls } from './components/RecordingControls';
import './index.css';

const GRAPH_MAX_FPS = 165; // Main control for pitch graph animation frame rate
const DETECTION_RATE_HZ = 165;

export default function App() {
  const [enabled, setEnabled] = useState(false);
  const [clarityThreshold, setClarityThreshold] = useState(0.9);
  const [historyDuration, setHistoryDuration] = useState(4);
  const [fftSize, setFftSize] = useState(2048);
  const [colorizeMarker, setColorizeMarker] = useState(true);
  const [showNoteLines, setShowNoteLines] = useState(false);
  const [showNoteTrails, setShowNoteTrails] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [minDetectableNote, setMinDetectableNote] = useState(36);
  const [maxDetectableNote, setMaxDetectableNote] = useState(96);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const [statsCollapsed, setStatsCollapsed] = useState(false);
  const appRef = useRef<HTMLDivElement>(null);
  const graphCardRef = useRef<HTMLDivElement>(null);

  const { sample, error, detectionsPerSecond } = usePitchDetector({
    enabled,
    clarityThreshold,
    fftSize,
    detectionRateHz: DETECTION_RATE_HZ,
    trackDetectionsPerSecond: showDiagnostics,
    minMidi: minDetectableNote,
    maxMidi: maxDetectableNote,
  });
  const {
    isRecording,
    recordingStartAt,
    canDownloadMidi,
    startRecording,
    stopRecording,
    downloadMidi,
  } = usePitchRecording({ sample, enabled });

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
          isRecording={isRecording}
          recordingStartAt={recordingStartAt}
          maxFps={GRAPH_MAX_FPS}
          detectionsPerSecond={detectionsPerSecond}
          detectionRateHz={DETECTION_RATE_HZ}
          showDiagnostics={showDiagnostics}
        />
      </div>
      <div className="graph-actions">
        <button
          type="button"
          className="icon-button fullscreen-toggle-inline"
          onClick={() => setIsFullscreen((value) => !value)}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {isFullscreen ? <FiMinimize /> : <FiMaximize />}
        </button>
        <RecordingControls
          enabled={enabled}
          isRecording={isRecording}
          canDownloadMidi={canDownloadMidi}
          onStart={startRecording}
          onStop={stopRecording}
          onDownload={downloadMidi}
        />
      </div>

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
            showDiagnostics={showDiagnostics}
            minDetectableNote={minDetectableNote}
            maxDetectableNote={maxDetectableNote}
            setMinDetectableNote={setMinDetectableNote}
            setMaxDetectableNote={setMaxDetectableNote}
            setEnabled={setEnabled}
            setClarityThreshold={setClarityThreshold}
            setHistoryDuration={setHistoryDuration}
            setFftSize={setFftSize}
            setColorizeMarker={setColorizeMarker}
            setShowNoteLines={setShowNoteLines}
            setShowNoteTrails={setShowNoteTrails}
            setShowDiagnostics={setShowDiagnostics}
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
              type="button"
              className="icon-button"
              onClick={() => setIsFullscreen(false)}
              aria-label="Exit fullscreen"
            >
              <FiMinimize />
            </button>
          </div>
          <div className="card recording-card">
            <RecordingControls
              enabled={enabled}
              isRecording={isRecording}
              canDownloadMidi={canDownloadMidi}
              onStart={startRecording}
              onStop={stopRecording}
              onDownload={downloadMidi}
            />
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
            showDiagnostics={showDiagnostics}
            minDetectableNote={minDetectableNote}
            maxDetectableNote={maxDetectableNote}
            setMinDetectableNote={setMinDetectableNote}
            setMaxDetectableNote={setMaxDetectableNote}
            setEnabled={setEnabled}
            setClarityThreshold={setClarityThreshold}
            setHistoryDuration={setHistoryDuration}
            setFftSize={setFftSize}
            setColorizeMarker={setColorizeMarker}
            setShowNoteLines={setShowNoteLines}
            setShowNoteTrails={setShowNoteTrails}
            setShowDiagnostics={setShowDiagnostics}
          />

          <PitchStats sample={sample} />
        </>
      )}
    </div>
  );
}
