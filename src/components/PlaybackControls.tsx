type Props = {
  isPlaying: boolean
  hasAudio: boolean
  currentTime: number
  duration: number
  onPlayPause: () => void
  onStop: () => void
}

export const PlaybackControls = ({
  isPlaying,
  hasAudio,
  currentTime,
  duration,
  onPlayPause,
  onStop,
}: Props) => {
  return (
    <div className="playback-controls">
      <button type="button" onClick={onPlayPause} disabled={!hasAudio}>
        {isPlaying ? 'Pause' : 'Play'}
      </button>
      <button type="button" onClick={onStop} disabled={!hasAudio}>
        Stop
      </button>
      {hasAudio && duration > 0 && (
        <span className="file-meta">
          {Math.floor(currentTime)}s / {Math.floor(duration)}s
        </span>
      )}
    </div>
  )
}
