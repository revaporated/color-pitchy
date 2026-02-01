import { FiPause, FiPlay, FiSquare } from 'react-icons/fi'
import { LuHand, LuTextCursor } from 'react-icons/lu'

type Props = {
  isPlaying: boolean
  hasAudio: boolean
  currentTime: number
  duration: number
  hoverTime: number | null
  viewMode: 'pan' | 'select'
  loopEnabled: boolean
  hasSelection: boolean
  onPlayPause: () => void
  onStop: () => void
  onViewModeChange: (mode: 'pan' | 'select') => void
  onToggleLoop: () => void
  onClearSelection: () => void
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
  hoverTime,
  viewMode,
  loopEnabled,
  hasSelection,
  onPlayPause,
  onStop,
  onViewModeChange,
  onToggleLoop,
  onClearSelection,
}: Props) => {
  const displayTime = duration > 0 ? Math.min(currentTime, duration) : currentTime

  return (
    <div className="playback-controls">
      <div className="playback-controls__row">
        <button
          type="button"
          onClick={onPlayPause}
          disabled={!hasAudio}
          className="icon-button"
          aria-label={isPlaying ? 'Pause playback' : 'Play audio'}
        >
          {isPlaying ? <FiPause /> : <FiPlay />}
        </button>
        <button
          type="button"
          onClick={onStop}
          disabled={!hasAudio}
          className="icon-button"
          aria-label="Stop playback"
        >
          <FiSquare />
        </button>
        {hasAudio && duration > 0 && (
          <span className="file-meta">
            {formatTimecode(displayTime)} | {formatTimecode(duration)}
            {hoverTime !== null && (
              <span className="hover-timecode">
                {' '}
                [{formatTimecode(hoverTime)}]
              </span>
            )}
          </span>
        )}
      </div>
      <div className="playback-controls__row playback-controls__row--modes">
        <button
          type="button"
          onClick={() => onViewModeChange('pan')}
          disabled={!hasAudio}
          className={`icon-button${viewMode === 'pan' ? ' is-active' : ''}`}
          aria-label="Pan mode"
          aria-pressed={viewMode === 'pan'}
        >
          <LuHand />
        </button>
      </div>
      <div className="playback-controls__row playback-controls__row--secondary">
        <button
          type="button"
          onClick={() => onViewModeChange('select')}
          disabled={!hasAudio}
          className={`icon-button${viewMode === 'select' ? ' is-active' : ''}`}
          aria-label="Select mode"
          aria-pressed={viewMode === 'select'}
        >
          <LuTextCursor />
        </button>
        {hasSelection && (
          <>
            <button
              type="button"
              onClick={onToggleLoop}
              disabled={!hasAudio}
              className={`toggle-button${loopEnabled ? ' is-active' : ''}`}
              aria-pressed={loopEnabled}
            >
              Loop
            </button>
            <button
              type="button"
              onClick={onClearSelection}
              disabled={!hasSelection}
              className="toggle-button"
            >
              Clear
            </button>
          </>
        )}
      </div>
    </div>
  )
}
