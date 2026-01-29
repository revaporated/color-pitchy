import { useCallback, useEffect, useState } from 'react'
import type { ChangeEvent, RefObject } from 'react'
import { AudioUpload } from '../components/AudioUpload'
import { PlaybackControls } from '../components/PlaybackControls'
import { WaveformViewer } from '../components/WaveformViewer'
import { useAudioFile } from '../hooks/useAudioFile'
import { useAudioPlayback } from '../hooks/useAudioPlayback'

export default function SongsPage() {
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

  const [viewMode, setViewMode] = useState<'pan' | 'select'>('pan')
  const [panMode, setPanMode] = useState<'scroll' | 'scrub'>('scroll')
  const [loopEnabled, setLoopEnabled] = useState(false)
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(
    null,
  )

  const handleUpload = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      stop()
      setSelection(null)
      setLoopEnabled(false)
      handleFileChange(event)
    },
    [handleFileChange, stop],
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
      <AudioUpload
        fileName={fileName}
        isDecoding={isDecoding}
        error={error}
        onFileChange={handleUpload}
      />

      <div className="card waveform-card">
        <WaveformViewer
          audioBuffer={audioBuffer}
          audioRef={audioRef as RefObject<HTMLAudioElement>}
          duration={duration}
          isPlaying={isPlaying}
          currentTime={currentTime}
          onSeek={seek}
          viewMode={viewMode}
          panMode={panMode}
          selection={selection}
          onSelectionChange={handleSelectionChange}
        />

        <PlaybackControls
          isPlaying={isPlaying}
          hasAudio={hasAudio}
          currentTime={currentTime}
          duration={duration}
          viewMode={viewMode}
          panMode={panMode}
          loopEnabled={loopEnabled}
          hasSelection={Boolean(selection)}
          onPlayPause={handlePlayPause}
          onStop={stop}
          onViewModeChange={setViewMode}
          onPanModeChange={setPanMode}
          onToggleLoop={() => setLoopEnabled((value) => !value)}
          onClearSelection={handleSelectionClear}
        />

        <audio ref={audioRef} src={audioUrl ?? undefined} preload="auto" hidden />
      </div>
    </div>
  )
}
