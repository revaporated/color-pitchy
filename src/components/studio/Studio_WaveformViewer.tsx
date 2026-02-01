import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import {
  PIXELS_PER_SECOND,
  PLAYHEAD_WIDTH,
  WAVEFORM_HEIGHT,
  buildPeaks,
} from '../../utils/waveform'

const formatMarkerLabel = (seconds: number) => {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60

  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
}

type Props = {
  audioBuffer: AudioBuffer | null
  audioRef: RefObject<HTMLAudioElement>
  duration: number
  isPlaying: boolean
  currentTime: number
  onSeek: (time: number) => void
  viewMode: 'pan' | 'select'
  panMode: 'scroll' | 'scrub'
  selection: { start: number; end: number } | null
  onSelectionChange: (selection: { start: number; end: number } | null) => void
}

export const WaveformViewer = ({
  audioBuffer,
  audioRef,
  duration,
  isPlaying,
  currentTime,
  onSeek,
  viewMode,
  panMode,
  selection,
  onSelectionChange,
}: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const hoverLineRef = useRef<HTMLDivElement>(null)
  const hoverOffsetRef = useRef<number | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const dragRef = useRef<
    | {
        type: 'pan-scroll'
        startX: number
        startScrollLeft: number
      }
    | {
        type: 'pan-scrub'
      }
    | {
        type: 'select-create'
        anchorTime: number
        startX: number
      }
    | {
        type: 'select-move'
        startX: number
        startTime: number
        endTime: number
      }
    | {
        type: 'select-resize-start'
        startX: number
        endTime: number
      }
    | {
        type: 'select-resize-end'
        startX: number
        startTime: number
      }
  >(null)
  const suppressClickRef = useRef(false)
  const dragMovedRef = useRef(false)
  const isUserInteractingRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)

  const peaks = useMemo(
    () => (audioBuffer ? buildPeaks(audioBuffer) : null),
    [audioBuffer],
  )
  const waveformWidth = peaks?.length ?? 0
  const hasWaveform = Boolean(peaks)
  const markers = useMemo(() => {
    if (!duration || waveformWidth === 0) return []

    const lastSecond = Math.max(0, Math.floor(duration))
    const items: Array<{
      second: number
      isMajor: boolean
      label: string | null
      left: number
    }> = []

    for (let second = 0; second <= lastSecond; second += 1) {
      const isMajor = second % 5 === 0
      items.push({
        second,
        isMajor,
        label: isMajor ? formatMarkerLabel(second) : null,
        left: second * PIXELS_PER_SECOND,
      })
    }

    return items
  }, [duration, waveformWidth])

  const normalizedSelection = useMemo(() => {
    if (!selection) return null
    const start = Math.min(selection.start, selection.end)
    const end = Math.max(selection.start, selection.end)
    return { start, end }
  }, [selection])

  const selectionPixels = useMemo(() => {
    if (!normalizedSelection || waveformWidth === 0) return null
    const startPx = normalizedSelection.start * PIXELS_PER_SECOND
    const endPx = normalizedSelection.end * PIXELS_PER_SECOND
    const clampedStart = Math.max(0, Math.min(startPx, waveformWidth))
    const clampedEnd = Math.max(0, Math.min(endPx, waveformWidth))
    const left = Math.min(clampedStart, clampedEnd)
    const width = Math.abs(clampedEnd - clampedStart)
    return { left, width, startPx: clampedStart, endPx: clampedEnd }
  }, [normalizedSelection, waveformWidth])

  const getMaxTime = () => duration || audioRef.current?.duration || 0

  const clampTime = (time: number) => {
    const maxTime = getMaxTime()
    return Math.max(0, Math.min(time, maxTime))
  }

  const getPointerPosition = (event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current
    if (!viewport) return null
    const rect = viewport.getBoundingClientRect()
    const offsetX = event.clientX - rect.left
    const absoluteX = viewport.scrollLeft + offsetX
    return { offsetX, absoluteX }
  }

  const updateHoverLine = useCallback(
    (nextOffsetX?: number) => {
      const viewport = viewportRef.current
      const hoverLine = hoverLineRef.current
      if (!viewport || !hoverLine || waveformWidth === 0) return

      const viewportWidth = viewport.clientWidth
      const offsetX = nextOffsetX ?? hoverOffsetRef.current
      if (offsetX === null || offsetX === undefined) {
        hoverLine.style.opacity = '0'
        return
      }

      const clampedOffsetX = Math.max(0, Math.min(offsetX, viewportWidth))
      hoverOffsetRef.current = clampedOffsetX
      const absoluteX = viewport.scrollLeft + clampedOffsetX
      const maxLeft = Math.max(0, waveformWidth - 1)
      const clampedLeft = Math.max(0, Math.min(absoluteX, maxLeft))

      hoverLine.style.left = `${clampedLeft}px`
      hoverLine.style.opacity = '1'
    },
    [waveformWidth],
  )

  const scrollToTime = useCallback(
    (time: number) => {
      const viewport = viewportRef.current
      if (!viewport || waveformWidth === 0) return

      const viewportWidth = viewport.clientWidth
      const targetLeft = time * PIXELS_PER_SECOND - viewportWidth / 2
      const maxScroll = Math.max(0, waveformWidth - viewportWidth)
      const clamped = Math.max(0, Math.min(targetLeft, maxScroll))

      const shouldKeepScroll =
        isUserInteractingRef.current && viewMode === 'pan' && panMode === 'scroll'
      if (!shouldKeepScroll) {
        viewport.scrollLeft = clamped
      }
      const activeScrollLeft = shouldKeepScroll ? viewport.scrollLeft : clamped
      const playhead = playheadRef.current
      if (playhead) {
        const rawPlayheadLeft = time * PIXELS_PER_SECOND - activeScrollLeft
        const maxPlayheadLeft = Math.max(0, viewportWidth - PLAYHEAD_WIDTH)
        const playheadLeft = Math.max(0, Math.min(rawPlayheadLeft, maxPlayheadLeft))
        const compensatedLeft = playheadLeft + activeScrollLeft
        playhead.style.left = `${compensatedLeft}px`
      }

      updateHoverLine()
    },
    [panMode, updateHoverLine, viewMode, waveformWidth],
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
    if (viewMode !== 'pan' || suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    const viewport = viewportRef.current
    if (!viewport || waveformWidth === 0) return

    const rect = viewport.getBoundingClientRect()
    const offsetX = event.clientX - rect.left
    const absoluteX = viewport.scrollLeft + offsetX
    const nextTime = absoluteX / PIXELS_PER_SECOND
    const maxTime = duration || audioRef.current?.duration || 0
    const clampedTime = Math.max(0, Math.min(nextTime, maxTime))

    if (isPlaying) {
      audioRef.current?.pause()
    }

    onSeek(clampedTime)
    scrollToTime(clampedTime)
  }

  const handleWaveformMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!hasWaveform) return
    const viewport = viewportRef.current
    if (!viewport) return

    const rect = viewport.getBoundingClientRect()
    const offsetX = event.clientX - rect.left
    updateHoverLine(offsetX)
  }

  const handleWaveformLeave = () => {
    hoverOffsetRef.current = null
    const hoverLine = hoverLineRef.current
    if (hoverLine) {
      hoverLine.style.opacity = '0'
    }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!hasWaveform || event.button !== 0) return
    const viewport = viewportRef.current
    if (!viewport) return

    event.preventDefault()
    dragMovedRef.current = false
    suppressClickRef.current = false
    viewport.setPointerCapture(event.pointerId)
    setIsDragging(true)

    const pointer = getPointerPosition(event)
    if (!pointer) return

    if (viewMode === 'pan') {
      if (panMode === 'scrub') {
        const audio = audioRef.current
        if (audio && !audio.paused) {
          audio.pause()
        }
        const time = clampTime(pointer.absoluteX / PIXELS_PER_SECOND)
        onSeek(time)
        suppressClickRef.current = true
        dragRef.current = { type: 'pan-scrub' }
        return
      }

      isUserInteractingRef.current = true
      dragRef.current = {
        type: 'pan-scroll',
        startX: event.clientX,
        startScrollLeft: viewport.scrollLeft,
      }
      return
    }

    if (selectionPixels && normalizedSelection) {
      const handleRadius = 6
      const distanceToStart = Math.abs(pointer.absoluteX - selectionPixels.startPx)
      const distanceToEnd = Math.abs(pointer.absoluteX - selectionPixels.endPx)

      if (distanceToStart <= handleRadius) {
        dragRef.current = {
          type: 'select-resize-start',
          startX: event.clientX,
          endTime: normalizedSelection.end,
        }
        return
      }

      if (distanceToEnd <= handleRadius) {
        dragRef.current = {
          type: 'select-resize-end',
          startX: event.clientX,
          startTime: normalizedSelection.start,
        }
        return
      }

      if (
        pointer.absoluteX >= selectionPixels.left &&
        pointer.absoluteX <= selectionPixels.left + selectionPixels.width
      ) {
        dragRef.current = {
          type: 'select-move',
          startX: event.clientX,
          startTime: normalizedSelection.start,
          endTime: normalizedSelection.end,
        }
        return
      }
    }

    dragRef.current = {
      type: 'select-create',
      anchorTime: clampTime(pointer.absoluteX / PIXELS_PER_SECOND),
      startX: event.clientX,
    }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragRef.current
    if (!dragState) return
    const viewport = viewportRef.current
    if (!viewport) return

    if (dragState.type === 'pan-scrub') {
      const pointer = getPointerPosition(event)
      if (!pointer) return
      const time = clampTime(pointer.absoluteX / PIXELS_PER_SECOND)
      onSeek(time)
      return
    }

    const deltaX = event.clientX - dragState.startX
    const hasMoved = Math.abs(deltaX) >= 2
    if (!dragMovedRef.current && hasMoved) {
      dragMovedRef.current = true
      suppressClickRef.current = true
    }

    if (!dragMovedRef.current && dragState.type === 'select-create') {
      return
    }

    if (dragState.type === 'pan-scroll') {
      const maxScroll = Math.max(0, waveformWidth - viewport.clientWidth)
      const nextScroll = Math.max(0, Math.min(dragState.startScrollLeft - deltaX, maxScroll))
      viewport.scrollLeft = nextScroll
      updateHoverLine()
      return
    }

    const pointer = getPointerPosition(event)
    if (!pointer) return
    const time = clampTime(pointer.absoluteX / PIXELS_PER_SECOND)

    if (dragState.type === 'select-create') {
      onSelectionChange({ start: dragState.anchorTime, end: time })
      return
    }

    if (dragState.type === 'select-resize-start') {
      onSelectionChange({ start: time, end: dragState.endTime })
      return
    }

    if (dragState.type === 'select-resize-end') {
      onSelectionChange({ start: dragState.startTime, end: time })
      return
    }

    if (dragState.type === 'select-move') {
      const maxTime = getMaxTime()
      const deltaTime = deltaX / PIXELS_PER_SECOND
      const length = dragState.endTime - dragState.startTime
      let nextStart = dragState.startTime + deltaTime
      let nextEnd = dragState.endTime + deltaTime

      if (nextStart < 0) {
        nextStart = 0
        nextEnd = Math.max(0, length)
      }

      if (nextEnd > maxTime) {
        nextEnd = maxTime
        nextStart = Math.max(0, maxTime - length)
      }

      onSelectionChange({ start: nextStart, end: nextEnd })
    }
  }

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
    isUserInteractingRef.current = false
    setIsDragging(false)
  }

  const selectionWidth = selectionPixels ? Math.max(1, selectionPixels.width) : 0

  return (
    <div
      className={`waveform-viewport${
        hasWaveform ? ' waveform-viewport--interactive' : ''
      }${viewMode === 'pan' ? ' waveform-viewport--pan' : ' waveform-viewport--select'}${
        panMode === 'scrub' ? ' waveform-viewport--scrub' : ''
      }${isDragging ? ' waveform-viewport--dragging' : ''}`}
      ref={viewportRef}
      onClick={handleWaveformClick}
      onMouseMove={handleWaveformMove}
      onMouseLeave={handleWaveformLeave}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerLeave={handlePointerEnd}
    >
      {hasWaveform ? (
        <>
          <div
            className="waveform-markers"
            style={{ width: `${waveformWidth}px` }}
            aria-hidden="true"
          >
            {markers.map((marker) => (
              <div
                key={marker.second}
                className={`waveform-marker${marker.isMajor ? ' waveform-marker--major' : ''}`}
                style={{ left: `${marker.left}px` }}
              >
                {marker.label && (
                  <span className="waveform-marker-label">{marker.label}</span>
                )}
              </div>
            ))}
          </div>
          <canvas ref={canvasRef} className="waveform-canvas" />
          {selectionPixels && (
            <div
              className="waveform-selection"
              style={{ left: `${selectionPixels.left}px`, width: `${selectionWidth}px` }}
              aria-hidden="true"
            >
              <div className="waveform-selection-handle waveform-selection-handle--start" />
              <div className="waveform-selection-handle waveform-selection-handle--end" />
            </div>
          )}
        </>
      ) : (
        <div className="waveform-placeholder">Upload an MP3 to see the waveform.</div>
      )}
      <div ref={hoverLineRef} className="waveform-hover-line" aria-hidden="true" />
      <div ref={playheadRef} className="waveform-playhead" aria-hidden="true" />
    </div>
  )
}
