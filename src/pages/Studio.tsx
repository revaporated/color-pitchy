import { useCallback, useEffect, useState } from 'react'
import type { ChangeEvent, RefObject } from 'react'
import { AudioUpload as Studio_AudioUpload } from '../components/studio/Studio_AudioUpload';
import { WaveformViewer as Studio_WaveformViewer } from '../components/studio/Studio_WaveformViewer';
import { PlaybackControls as Studio_PlaybackControls } from '../components/studio/Studio_PlaybackControls';
import { PitchGraph as Studio_PitchGraph } from '../components/studio/Studio_PitchGraph';
import { useAudioFile } from '../hooks/useAudioFile';
import { useAudioPlayback } from '../hooks/useAudioPlayback';
import { usePitchDetector } from '../hooks/usePitchDetector';
import { PIXELS_PER_SECOND } from '../utils/waveform';

/**
 * Studio Mode (Experimental)
 * This page will eventually integrate the duplicated components from src/components/studio/
 */
export default function StudioPage() {
  const {
    audioUrl,
    audioBuffer,
    fileName,
    isDecoding,
    error,
    duration,
    setError,
    handleFileChange,
  } = useAudioFile()

  const handlePlayError = useCallback(() => {
    setError('Unable to start playback.')
  }, [setError])

  const { audioRef, isPlaying, currentTime, playPause, stop, seek } =
    useAudioPlayback({
      onPlayError: handlePlayError,
    })

  // Pitch Detection
  const historyDuration = 10
  const clarityThreshold = 0.75
  const centsThreshold = 45
  const colorizeMarker = true
  const showNoteLines = false
  const showNoteTrails = true

  const { sample } = usePitchDetector({
    enabled: isPlaying,
    clarityThreshold,
    centsThreshold,
  })

  const [pitchResetKey, setPitchResetKey] = useState(0)

  const [viewMode, setViewMode] = useState<'pan' | 'select'>('pan')
  const [loopEnabled, setLoopEnabled] = useState(false)
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(
    null,
  )
  const [hoverTime, setHoverTime] = useState<number | null>(null)

  const handleStop = useCallback(() => {
    stop()
    setPitchResetKey((value) => value + 1)
  }, [stop])

  const handleWaveformClick = useCallback(() => {
    setPitchResetKey((value) => value + 1)
  }, [])

  const handleUpload = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      handleStop()
      setSelection(null)
      setLoopEnabled(false)
      handleFileChange(event)
    },
    [handleFileChange, handleStop],
  )

  const hasAudio = Boolean(audioUrl && audioBuffer)

  const handleSelectionChange = useCallback(
    (nextSelection: { start: number; end: number } | null) => {
      setSelection(nextSelection)
      setLoopEnabled(Boolean(nextSelection))
    },
    [],
  )

  const handleSelectionClear = useCallback(() => {
    setSelection(null)
    setLoopEnabled(false)
  }, [])

  const handlePlayPause = useCallback(() => {
    if (!isPlaying && loopEnabled && selection) {
      const start = Math.min(selection.start, selection.end)
      const end = Math.max(selection.start, selection.end)
      if (currentTime < start || currentTime > end) {
        seek(start)
      }
    }

    playPause()
  }, [currentTime, isPlaying, loopEnabled, playPause, seek, selection])

  useEffect(() => {
    if (!isPlaying || !loopEnabled || !selection) return

    const start = Math.min(selection.start, selection.end)
    const end = Math.max(selection.start, selection.end)
    if (end <= start) return

    const epsilon = 0.03
    if (currentTime >= end - epsilon) {
      seek(start)
    }
  }, [currentTime, isPlaying, loopEnabled, seek, selection])

  return (
    <div className="app">
      {/* <header className="card nav-header">
        <nav>
          <Link to="/">Pitch Detection</Link>
          <Link to="/songs">Songs</Link>
          <Link to="/studio" className="active">Studio Mode</Link>
        </nav>
      </header>

      <div className="card">
        <h1>Studio Mode</h1>
        <p>
          Welcome to the Studio. This is an experimental area for recording over audio tracks
          and analyzing pitch in real-time.
        </p>
      </div> */}

      <div className="card waveform-card">
        <Studio_PitchGraph
          sample={sample}
          historyDuration={historyDuration}
          colorizeMarker={colorizeMarker}
          showNoteLines={showNoteLines}
          showNoteTrails={showNoteTrails}
          currentTime={currentTime}
          duration={duration}
          isPlaying={isPlaying}
          pixelsPerSecond={PIXELS_PER_SECOND}
          resetKey={pitchResetKey}
          showDiagnostics={false}
          height={500}
        />

        <Studio_WaveformViewer
          audioBuffer={audioBuffer}
          audioRef={audioRef as RefObject<HTMLAudioElement>}
          duration={duration}
          isPlaying={isPlaying}
          currentTime={currentTime}
          onSeek={seek}
          onWaveformClick={handleWaveformClick}
          onHoverTimeChange={setHoverTime}
          viewMode={viewMode}
          panMode="scroll"
          selection={selection}
          onSelectionChange={handleSelectionChange}
        />

        <Studio_PlaybackControls
          isPlaying={isPlaying}
          hasAudio={hasAudio}
          currentTime={currentTime}
          duration={duration}
          hoverTime={hoverTime}
          viewMode={viewMode}
          loopEnabled={loopEnabled}
          hasSelection={Boolean(selection)}
          onPlayPause={handlePlayPause}
          onStop={handleStop}
          onViewModeChange={setViewMode}
          onToggleLoop={() => setLoopEnabled((value) => !value)}
          onClearSelection={handleSelectionClear}
        />

        <audio ref={audioRef} src={audioUrl ?? undefined} preload="auto" hidden />
      </div>

      <Studio_AudioUpload
        fileName={fileName}
        isDecoding={isDecoding}
        error={error}
        onFileChange={handleUpload}
      />
    </div>
  );
}