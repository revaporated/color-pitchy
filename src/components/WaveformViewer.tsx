import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import {
  PIXELS_PER_SECOND,
  PLAYHEAD_WIDTH,
  WAVEFORM_HEIGHT,
  buildPeaks,
} from '../utils/waveform'

type Props = {
  audioBuffer: AudioBuffer | null
  audioRef: RefObject<HTMLAudioElement>
  duration: number
  isPlaying: boolean
  currentTime: number
  onSeek: (time: number) => void
}

export const WaveformViewer = ({
  audioBuffer,
  audioRef,
  duration,
  isPlaying,
  currentTime,
  onSeek,
}: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)

  const peaks = useMemo(
    () => (audioBuffer ? buildPeaks(audioBuffer) : null),
    [audioBuffer],
  )
  const waveformWidth = peaks?.length ?? 0

  const scrollToTime = useCallback(
    (time: number) => {
      const viewport = viewportRef.current
      if (!viewport || waveformWidth === 0) return

      const viewportWidth = viewport.clientWidth
      const targetLeft = time * PIXELS_PER_SECOND - viewportWidth / 2
      const maxScroll = Math.max(0, waveformWidth - viewportWidth)
      const clamped = Math.max(0, Math.min(targetLeft, maxScroll))

      viewport.scrollLeft = clamped
      const playhead = playheadRef.current
      if (playhead) {
        const rawPlayheadLeft = time * PIXELS_PER_SECOND - clamped
        const maxPlayheadLeft = Math.max(0, viewportWidth - PLAYHEAD_WIDTH)
        const playheadLeft = Math.max(0, Math.min(rawPlayheadLeft, maxPlayheadLeft))
        const compensatedLeft = playheadLeft + clamped
        playhead.style.left = `${compensatedLeft}px`
      }
    },
    [waveformWidth],
  )

  useEffect(() => {
    if (!peaks || !canvasRef.current) return

    const canvas = canvasRef.current
    const dpr = window.devicePixelRatio || 1
    const width = peaks.length
    const height = WAVEFORM_HEIGHT
    const context = canvas.getContext('2d')

    if (!context) return

    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, width, height)
    context.fillStyle = '#f97316'

    const mid = height / 2

    for (let x = 0; x < width; x += 1) {
      const value = peaks[x]
      const barHeight = Math.max(1, value * mid)
      context.fillRect(x, mid - barHeight, 1, barHeight * 2)
    }
  }, [peaks])

  useEffect(() => {
    if (audioBuffer) {
      scrollToTime(0)
    }
  }, [audioBuffer, scrollToTime])

  useEffect(() => {
    if (!isPlaying) {
      scrollToTime(currentTime)
    }
  }, [currentTime, isPlaying, scrollToTime])

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      return
    }

    const update = () => {
      const audio = audioRef.current
      if (!audio) return
      scrollToTime(audio.currentTime)
      rafRef.current = requestAnimationFrame(update)
    }

    rafRef.current = requestAnimationFrame(update)

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [audioRef, isPlaying, scrollToTime])

  useEffect(() => {
    const handleResize = () => {
      const audio = audioRef.current
      if (!audio) return
      scrollToTime(audio.currentTime)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [audioRef, scrollToTime])

  const handleWaveformClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current
    if (!viewport || waveformWidth === 0) return

    const rect = viewport.getBoundingClientRect()
    const offsetX = event.clientX - rect.left
    const absoluteX = viewport.scrollLeft + offsetX
    const nextTime = absoluteX / PIXELS_PER_SECOND
    const maxTime = duration || audioRef.current?.duration || 0
    const clampedTime = Math.max(0, Math.min(nextTime, maxTime))

    onSeek(clampedTime)
    scrollToTime(clampedTime)
  }

  const hasWaveform = Boolean(peaks)

  return (
    <div
      className={`waveform-viewport${
        hasWaveform ? ' waveform-viewport--interactive' : ''
      }`}
      ref={viewportRef}
      onClick={handleWaveformClick}
    >
      {hasWaveform ? (
        <canvas ref={canvasRef} className="waveform-canvas" />
      ) : (
        <div className="waveform-placeholder">Upload an MP3 to see the waveform.</div>
      )}
      <div ref={playheadRef} className="waveform-playhead" aria-hidden="true" />
    </div>
  )
}
