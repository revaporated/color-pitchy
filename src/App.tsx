import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { FiMaximize, FiMinimize } from 'react-icons/fi';
import { FrameRing } from './audio/frames';
import { NavBar } from './components/NavBar';
import { PitchControls } from './components/PitchControls';
import { PitchGraph } from './components/PitchGraph';
import { PitchStats } from './components/PitchStats';
import { RecordingControls } from './components/RecordingControls';
import { useLiveRecording } from './hooks/useLiveRecording';
import { useEngineStats, usePitchEngine } from './hooks/usePitchEngine';
import { usePitchSettings } from './hooks/usePitchSettings';
import './index.css';

const GRAPH_MAX_FPS = 165;
const LIVE_HISTORY_CAPACITY = 4096; // > 10 s at the detection rate

/** Live mode: mic pitch on a rolling graph, independent of any audio. */
export default function App() {
  const { controls, filter } = usePitchSettings();
  const [armed, setArmed] = useState(false);
  const [frozenAt, setFrozenAt] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const [statsCollapsed, setStatsCollapsed] = useState(false);
  const [ring] = useState(() => new FrameRing(LIVE_HISTORY_CAPACITY));

  const { engine, error } = usePitchEngine({ armed, fftSize: controls.fftSize });
  const { sample } = useEngineStats(engine, filter);
  const recording = useLiveRecording(engine);

  useEffect(() => engine.subscribe((frame) => ring.push(frame)), [engine, ring]);

  // Freeze the graph when the mic stops so the last few seconds stay visible.
  // Stopping the mic also ends a recording in progress.
  const setArmedAndFreeze: Dispatch<SetStateAction<boolean>> = (next) => {
    const value = typeof next === 'function' ? next(armed) : next;
    setArmed(value);
    setFrozenAt(value ? null : performance.now() / 1000);
    if (!value && recording.isRecording) recording.stopRecording();
  };

  const downloadMidi = () => {
    if (recording.downloadMidi(filter) === 0) {
      window.alert('No notes passed the current detection filter.');
    }
  };

  const recordingControls = (
    <RecordingControls
      enabled={armed}
      isRecording={recording.isRecording}
      canDownloadMidi={recording.canDownloadMidi}
      onStart={recording.startRecording}
      onStop={recording.stopRecording}
      onDownload={downloadMidi}
    />
  );

  return (
    <div className={`app${isFullscreen ? ' fullscreen' : ''}`}>
      {!isFullscreen && <NavBar />}
      {error && <div className="error">{error}</div>}

      <div className={`card graph-card${isFullscreen ? ' fullscreen' : ''}`}>
        <PitchGraph
          mode={{
            kind: 'live',
            source: ring,
            historyDuration: controls.historyDuration,
            frozenAt: armed ? null : frozenAt,
            recordingStartAt: recording.recordingStartAt,
          }}
          engine={engine}
          filter={filter}
          colorizeMarker={controls.colorizeMarker}
          showNoteLines={controls.showNoteLines}
          showNoteTrails={controls.showNoteTrails}
          showDiagnostics={controls.showDiagnostics}
          height={isFullscreen ? undefined : 320}
          maxFps={GRAPH_MAX_FPS}
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
        {recordingControls}
      </div>

      {isFullscreen ? (
        <div className="fullscreen-hud">
          <PitchControls
            {...controls}
            enabled={armed}
            setEnabled={setArmedAndFreeze}
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
          <div className="card recording-card">{recordingControls}</div>
        </div>
      ) : (
        <>
          <PitchControls {...controls} enabled={armed} setEnabled={setArmedAndFreeze} />
          <PitchStats sample={sample} />
        </>
      )}
    </div>
  );
}
