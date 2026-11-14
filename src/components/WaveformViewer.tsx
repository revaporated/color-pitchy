import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { FRAME_ORDER, onAnimationFrame } from '../audio/frameLoop'
import type { PlaybackClock } from '../audio/playbackClock'
import type { TimelineView } from '../audio/timelineView'
import {
  PIXELS_PER_SECOND,
  PLAYHEAD_WIDTH,
  WAVEFORM_HEIGHT,
} from '../utils/waveform'

// Browsers cap canvas size (about 32k px per side), so the waveform is drawn
// as a row of tiles instead of one canvas as wide as the song.
const TILE_WIDTH = 4096

// Which peaks array each tile canvas was last painted with, so remounting or
// re-rendering a tile only repaints it when the track changed.
const paintedTiles = new WeakMap<HTMLCanvasElement, Float32Array>()

function paintTile(canvas: HTMLCanvasElement, peaks: Float32Array, tile: number) {
  if (paintedTiles.get(canvas) === peaks) return
  const context = canvas.getContext('2d')
  if (!context) return

  const dpr = window.devicePixelRatio || 1
  const height = WAVEFORM_HEIGHT
  const mid = height / 2
  const start = tile * TILE_WIDTH
  const width = Math.max(0, Math.min(TILE_WIDTH, peaks.length - start))
  canvas.width = Math.max(1, Math.round(width * dpr))
  canvas.height = Math.round(height * dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`

  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, width, height)
  context.fillStyle = '#f97316'
  for (let x = 0; x < width; x += 1) {
    const barHeight = Math.max(1, peaks[start + x] * mid)
    context.fillRect(x, mid - barHeight, 1, barHeight * 2)
  }
  paintedTiles.set(canvas, peaks)
}

const formatMarkerLabel = (seconds: number) => {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60

  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
}

type Props = {
  /** Waveform peaks, one per pixel at PIXELS_PER_SECOND (computed in a worker). */
  peaks: Float32Array | null
  audioRef: RefObject<HTMLAudioElement>
  duration: number
  isPlaying: boolean
  currentTime: number
  onSeek: (time: number) => void
  onWaveformClick?: (time: number) => void
  /** Written with the time under the mouse (or null); read by the timecode readout. */
  hoverTimeRef?: RefObject<number | null>
  /** Smoothed song clock. When given, playback scrolling follows it instead of the stepwise audio.currentTime. */
  clock?: PlaybackClock
  viewMode: 'pan' | 'select'
  panMode?: 'scroll' | 'scrub'
  /** The shared time axis. This viewer writes its scroll, size and playhead x there for the pitch graph. */
  view: TimelineView
  selection: { start: number; end: number } | null
  onSelectionChange: (selection: { start: number; end: number } | null) => void
}

export const WaveformViewer = ({
  peaks,
  audioRef,
  duration,
  isPlaying,
  currentTime,
  onSeek,
  onWaveformClick,
  hoverTimeRef,
  clock,
  viewMode,
  panMode = 'scroll',
  view,
  selection,
  onSelectionChange,
}: Props) => {
  const playheadRef = useRef<HTMLDivElement>(null)
  const hoverLineRef = useRef<HTMLDivElement>(null)
  const hoverOffsetRef = useRef<number | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)

  // Keep the shared timeline view in step with this viewport's scroll and size.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const sync = () => view.setViewport(viewport.scrollLeft, viewport.clientWidth)
    sync()
    viewport.addEventListener('scroll', sync, { passive: true })
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null
    observer?.observe(viewport)
    return () => {
      viewport.removeEventListener('scroll', sync)
      observer?.disconnect()
    }
  }, [view])

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

  const waveformWidth = peaks?.length ?? 0
  const tileCount = Math.ceil(waveformWidth / TILE_WIDTH)
  const hasWaveform = Boolean(peaks)

  useEffect(() => {
    view.setContent(waveformWidth, duration)
  }, [view, waveformWidth, duration])

  // Only the tiles (and second markers) around the viewport are mounted: the
  // visible ones plus one tile either side. Updated from scroll events, and only
  // re-renders when the range actually changes (every few thousand pixels).
  const [tileRange, setTileRange] = useState({ first: 0, last: 1 })
  const updateTileRange = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport || tileCount === 0) return
    const first = Math.max(0, Math.floor(viewport.scrollLeft / TILE_WIDTH) - 1)
    const last = Math.min(
      tileCount - 1,
      Math.floor((viewport.scrollLeft + viewport.clientWidth) / TILE_WIDTH) + 1,
    )
    setTileRange((prev) => (prev.first === first && prev.last === last ? prev : { first, last }))
  }, [tileCount])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    updateTileRange()
    viewport.addEventListener('scroll', updateTileRange, { passive: true })
    window.addEventListener('resize', updateTileRange)
    return () => {
      viewport.removeEventListener('scroll', updateTileRange)
      window.removeEventListener('resize', updateTileRange)
    }
  }, [updateTileRange])

  const firstTile = Math.min(tileRange.first, Math.max(0, tileCount - 1))
  const lastTile = Math.min(tileRange.last, tileCount - 1)

  const markers = useMemo(() => {
    if (!duration || waveformWidth === 0) return []

    const lastSecond = Math.max(0, Math.floor(duration))
    const fromSecond = Math.max(0, Math.floor((firstTile * TILE_WIDTH) / PIXELS_PER_SECOND))
    const toSecond = Math.min(lastSecond, Math.ceil(((lastTile + 1) * TILE_WIDTH) / PIXELS_PER_SECOND))
    const items: Array<{
      second: number
      isMajor: boolean
      label: string | null
      left: number
    }> = []

    for (let second = fromSecond; second <= toSecond; second += 1) {
      const isMajor = second % 5 === 0
      items.push({
        second,
        isMajor,
        label: isMajor ? formatMarkerLabel(second) : null,
        left: second * PIXELS_PER_SECOND,
      })
    }

    return items
  }, [duration, waveformWidth, firstTile, lastTile])

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

  const calculateHoverTime = useCallback(
    (offsetX: number) => {
      const viewport = viewportRef.current
      if (!viewport || waveformWidth === 0) return null

      const absoluteX = viewport.scrollLeft + offsetX
      const hoverTime = absoluteX / PIXELS_PER_SECOND
      const maxTime = duration || audioRef.current?.duration || 0
      return Math.max(0, Math.min(hoverTime, maxTime))
    },
    [duration, audioRef, waveformWidth],
  )

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

      hoverLine.style.transform = `translateX(${clampedLeft}px)`
      hoverLine.style.opacity = '1'
    },
    [waveformWidth],
  )

  const scrollToTime = useCallback(
    (time: number) => {
      const viewport = viewportRef.current
      if (!viewport || waveformWidth === 0) return

      view.setViewport(viewport.scrollLeft, viewport.clientWidth)
      view.setContent(waveformWidth, duration)
      const clamped = view.centeredScroll(time)
      const shouldKeepScroll =
        isUserInteractingRef.current && viewMode === 'pan' && panMode === 'scroll'
      if (!shouldKeepScroll) {
        viewport.scrollLeft = clamped
      }
      // The browser rounds scrollLeft to whole (device) pixels, so the scroll it
      // actually applied can differ from `clamped` by a fraction of a pixel.
      const appliedScrollLeft = viewport.scrollLeft
      view.setViewport(appliedScrollLeft, viewport.clientWidth)
      // Place the playhead from the scroll we asked for, so while following it
      // sits exactly at the center instead of wobbling with that rounding.
      const desiredScrollLeft = shouldKeepScroll ? appliedScrollLeft : clamped
      const playheadLeft = view.playheadXFor(time, desiredScrollLeft, window.devicePixelRatio || 1, PLAYHEAD_WIDTH)
      view.setPlayheadX(playheadLeft)
      const playhead = playheadRef.current
      if (playhead) {
        // Offset by the scroll that was really applied, since it lives inside the scrolled content.
        playhead.style.transform = `translateX(${playheadLeft + appliedScrollLeft}px)`
      }

      updateHoverLine()
    },
    [duration, panMode, updateHoverLine, view, viewMode, waveformWidth],
  )

  useEffect(() => {
    if (peaks) {
      scrollToTime(0)
    }
  }, [peaks, scrollToTime])

  useEffect(() => {
    if (!isPlaying) {
      scrollToTime(currentTime)
    }
  }, [currentTime, isPlaying, scrollToTime])

  useEffect(() => {
    if (!isPlaying) return

    return onAnimationFrame((now) => {
      const audio = audioRef.current
      if (!audio) return
      scrollToTime(clock ? clock.songTimeAt(now) : audio.currentTime)

      // The waveform scrolls under a stationary cursor, so the hover time changes too.
      if (hoverTimeRef && hoverOffsetRef.current !== null) {
        hoverTimeRef.current = calculateHoverTime(hoverOffsetRef.current)
      }
    }, FRAME_ORDER.waveform)
  }, [audioRef, clock, isPlaying, scrollToTime, calculateHoverTime, hoverTimeRef])

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
    onWaveformClick?.(clampedTime)
  }

  const handleWaveformMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!hasWaveform) return
    const viewport = viewportRef.current
    if (!viewport) return

    const rect = viewport.getBoundingClientRect()
    const offsetX = event.clientX - rect.left
    updateHoverLine(offsetX)

    if (hoverTimeRef) hoverTimeRef.current = calculateHoverTime(offsetX)
  }

  const handleWaveformLeave = () => {
    hoverOffsetRef.current = null
    const hoverLine = hoverLineRef.current
    if (hoverLine) {
      hoverLine.style.opacity = '0'
    }
    if (hoverTimeRef) hoverTimeRef.current = null
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
      view.setViewport(viewport.scrollLeft, viewport.clientWidth)
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
          <div
            className="waveform-canvas"
            style={{ width: `${waveformWidth}px`, height: `${WAVEFORM_HEIGHT}px` }}
          >
            {tileCount > 0 &&
              Array.from({ length: lastTile - firstTile + 1 }, (_, i) => {
                const tile = firstTile + i
                return (
                  <canvas
                    key={tile}
                    ref={(element) => {
                      if (element && peaks) paintTile(element, peaks, tile)
                    }}
                    style={{ left: `${tile * TILE_WIDTH}px` }}
                  />
                )
              })}
          </div>
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
        <div className="waveform-placeholder">Add a track to see the waveform.</div>
      )}
      <div ref={hoverLineRef} className="waveform-hover-line" aria-hidden="true" />
      <div ref={playheadRef} className="waveform-playhead" aria-hidden="true" />
    </div>
  )
}
