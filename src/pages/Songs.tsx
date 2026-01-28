import { useCallback } from 'react'
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

  const handleUpload = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      stop()
      handleFileChange(event)
    },
    [handleFileChange, stop],
  )

  const hasAudio = Boolean(audioUrl && audioBuffer)

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
        />

        <PlaybackControls
          isPlaying={isPlaying}
          hasAudio={hasAudio}
          currentTime={currentTime}
          duration={duration}
          onPlayPause={playPause}
          onStop={stop}
        />

        <audio ref={audioRef} src={audioUrl ?? undefined} preload="auto" hidden />
      </div>
    </div>
  )
}
