import { useEffect, useRef } from 'react'
import { FiPause, FiPlay, FiSquare } from 'react-icons/fi'
import { FRAME_ORDER, onAnimationFrame } from '../audio/frameLoop'
import { LuHand, LuTextCursor } from 'react-icons/lu'
import { Stepper } from './Stepper'

type Props = {
  isPlaying: boolean
  hasAudio: boolean
  /** Current song position; read every animation frame. */
  getTime: () => number
  duration: number
  /** Time under the mouse on the waveform, shown next to the timecode; read every animation frame. */
  getHoverTime?: () => number | null
  viewMode: 'pan' | 'select'
  panMode: 'scroll' | 'scrub'
  loopEnabled: boolean
  hasSelection: boolean
  onPlayPause: () => void
  onStop: () => void
  onViewModeChange: (mode: 'pan' | 'select') => void
  onPanModeChange: (mode: 'scroll' | 'scrub') => void
  onToggleLoop: () => void
  onClearSelection: () => void
  /** Playback speed (1 = normal). Pitch is kept. Omit to hide the control. */
  playbackRate?: number
  onPlaybackRateChange?: (rate: number) => void
}

const MIN_RATE = 0.25
const MAX_RATE = 2

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
  getTime,
  duration,
  getHoverTime,
  viewMode,
  panMode,
  loopEnabled,
  hasSelection,
  onPlayPause,
  onStop,
  onViewModeChange,
  onPanModeChange,
  onToggleLoop,
  onClearSelection,
  playbackRate,
  onPlaybackRateChange,
}: Props) => {
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
          <Timecode getTime={getTime} getHoverTime={getHoverTime} duration={duration} />
        )}
        {playbackRate !== undefined && onPlaybackRateChange && (
          <span className="playback-controls__speed">
            <Stepper
              label="Speed"
              value={`${Math.round(playbackRate * 100)}%`}
              onStep={(direction) =>
                onPlaybackRateChange(
                  Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round((playbackRate + direction * 0.05) * 100) / 100)),
                )
              }
              canDecrease={hasAudio && playbackRate > MIN_RATE}
              canIncrease={hasAudio && playbackRate < MAX_RATE}
            />
            {playbackRate !== 1 && (
              <button type="button" className="link-button" onClick={() => onPlaybackRateChange(1)}>
                Reset
              </button>
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
        {viewMode === 'pan' && (
          <div className="playback-controls__group">
            <button
              type="button"
              onClick={() => onPanModeChange('scroll')}
              disabled={!hasAudio}
              className={`toggle-button${panMode === 'scroll' ? ' is-active' : ''}`}
              aria-pressed={panMode === 'scroll'}
            >
              Scroll
            </button>
            <button
              type="button"
              onClick={() => onPanModeChange('scrub')}
              disabled={!hasAudio}
              className={`toggle-button${panMode === 'scrub' ? ' is-active' : ''}`}
              aria-pressed={panMode === 'scrub'}
            >
              Scrub
            </button>
          </div>
        )}
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

/**
 * Updates its own text on the shared animation loop, so playback never
 * re-renders the page just to move the clock.
 */
function Timecode({
  getTime,
  getHoverTime,
  duration,
}: {
  getTime: () => number
  getHoverTime?: () => number | null
  duration: number
}) {
  const timeRef = useRef<HTMLSpanElement>(null)
  const hoverRef = useRef<HTMLSpanElement>(null)

  useEffect(
    () =>
      onAnimationFrame(() => {
        const time = Math.min(Math.max(0, getTime()), duration)
        const text = `${formatTimecode(time)}/${formatTimecode(duration)}`
        if (timeRef.current && timeRef.current.textContent !== text) timeRef.current.textContent = text

        const hover = getHoverTime?.() ?? null
        const hoverText = hover === null ? '' : ` [${formatTimecode(hover)}]`
        if (hoverRef.current && hoverRef.current.textContent !== hoverText) {
          hoverRef.current.textContent = hoverText
        }
      }, FRAME_ORDER.text),
    [duration, getHoverTime, getTime],
  )

  return (
    <span className="file-meta">
      <span ref={timeRef} />
      <span ref={hoverRef} className="hover-timecode" />
    </span>
  )
}
