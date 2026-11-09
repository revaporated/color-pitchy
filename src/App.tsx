import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { FiCircle, FiDownload, FiMaximize, FiMic, FiMinimize, FiSquare } from 'react-icons/fi';
import { FrameRing } from './audio/frames';
import { NavBar } from './components/NavBar';
import { PitchControls } from './components/PitchControls';
import { PitchGraph } from './components/PitchGraph';
import { EngineStats } from './components/EngineStats';
import { RecordingControls } from './components/RecordingControls';
import { useLiveRecording } from './hooks/useLiveRecording';
import { usePitchEngine } from './hooks/usePitchEngine';
import { usePitchSettings } from './hooks/usePitchSettings';
import './index.css';

const LIVE_HISTORY_CAPACITY = 4096; // > 10 s at the detection rate

/** Live mode: mic pitch on a rolling graph, independent of any audio. */
export default function App() {
  const { controls, filter } = usePitchSettings();
  const [armed, setArmed] = useState(false);
  const [frozenAt, setFrozenAt] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const [statsCollapsed, setStatsCollapsed] = useState(false);
  // Until the mic is first turned on, the graph shows a prompt instead of an empty grid.
  const [hasStarted, setHasStarted] = useState(false);
  const [ring] = useState(() => new FrameRing(LIVE_HISTORY_CAPACITY));

  const { engine, error } = usePitchEngine({ armed, fftSize: controls.fftSize });
  const recording = useLiveRecording(engine);

  useEffect(() => engine.subscribe((frame) => ring.push(frame)), [engine, ring]);

  // Freeze the graph when the mic stops so the last few seconds stay visible.
  // Stopping the mic also ends a recording in progress.
  const setArmedAndFreeze: Dispatch<SetStateAction<boolean>> = (next) => {
    const value = typeof next === 'function' ? next(armed) : next;
    setArmed(value);
    if (value) setHasStarted(true);
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
        {!isFullscreen && (
          <div className="toolbar" role="toolbar" aria-label="Live">
            <div className="toolbar__group">
              <button
                type="button"
                className="toggle-button"
                aria-pressed={armed}
                onClick={() => setArmedAndFreeze((value) => !value)}
              >
                <FiMic /> Mic
              </button>
              <button
                type="button"
                className={`toggle-button record-button${recording.isRecording ? ' recording' : ''}`}
                aria-pressed={recording.isRecording}
                onClick={recording.isRecording ? recording.stopRecording : recording.startRecording}
                disabled={!armed}
                title={armed ? 'Record what you sing so you can save it as MIDI' : 'Turn the mic on to record'}
              >
                {recording.isRecording ? <FiSquare /> : <FiCircle />}
                {recording.isRecording ? 'Stop recording' : 'Rec'}
              </button>
              {recording.canDownloadMidi && (
                <button type="button" className="toggle-button" onClick={downloadMidi}>
                  <FiDownload /> Save MIDI
                </button>
              )}
            </div>
            <span className="toolbar__spacer" />
            <button
              type="button"
              className="icon-button btn-ghost"
              onClick={() => setIsFullscreen(true)}
              aria-label="Enter fullscreen"
              title="Fullscreen"
            >
              <FiMaximize />
            </button>
          </div>
        )}
        <div className="graph-card__body">
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
            trailOpacity={controls.trailOpacity}
            showDiagnostics={controls.showDiagnostics}
            height={isFullscreen ? undefined : 320}
          />
          {!isFullscreen && armed && <EngineStats engine={engine} filter={filter} layout="overlay" />}
          {!isFullscreen && !hasStarted && (
            <div className="graph-overlay">
              <div className="graph-overlay__box">
                <p>
                  <strong>Turn on the mic to see your pitch.</strong>
                </p>
                <p className="hint">Sing or play a note and it's drawn here in its Colorchord color.</p>
                <button type="button" className="btn-primary" onClick={() => setArmedAndFreeze(true)}>
                  <FiMic /> Turn on mic
                </button>
              </div>
            </div>
          )}
        </div>
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
          <EngineStats
            engine={engine}
            filter={filter}
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
          <PitchControls {...controls} enabled={armed} setEnabled={setArmedAndFreeze} showMicButton={false} />
        </>
      )}
    </div>
  );
}
