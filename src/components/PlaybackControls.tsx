type Props = {
  isPlaying: boolean
  hasAudio: boolean
  currentTime: number
  duration: number
  onPlayPause: () => void
  onStop: () => void
}

const formatTimecode = (time: number) => {
  const totalHundredths = Math.max(0, Math.round(time * 100))
  const minutes = Math.floor(totalHundredths / 6000)
  const seconds = Math.floor((totalHundredths % 6000) / 100)
  const hundredths = totalHundredths % 100

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(
    hundredths,
  ).padStart(2, '0')}`
}

export const PlaybackControls = ({
  isPlaying,
  hasAudio,
  currentTime,
  duration,
  onPlayPause,
  onStop,
}: Props) => {
  const displayTime = duration > 0 ? Math.min(currentTime, duration) : currentTime

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
          {formatTimecode(displayTime)}/{formatTimecode(duration)}
        </span>
      )}
    </div>
  )
}
