import { useEffect, useLayoutEffect, useRef } from 'react';
import type { MouseEvent, PointerEvent } from 'react';
import type { FrameSource } from '../audio/frames';
import type { NoteSet } from '../audio/noteSet';
import { FRAME_ORDER, onAnimationFrame } from '../audio/frameLoop';
import type { PitchEngine } from '../audio/pitchEngine';
import { formatNoteLabel, frameToMidi, midiToNoteIndex, PITCH_COLOR_SHAPE_MAP, type DetectionFilter } from '../utils/pitch';
import { PLAYHEAD_WIDTH } from '../utils/waveform';
import { graphPalette, subscribeTheme } from '../theme';
import { drawBeatBands, drawBeatTicks } from './pitchGraph/beatsLayer';
import { drawMarker, drawSelectionBand, drawVerticalLine, MAX_GAP_SECONDS, mapMidiToY, NOTE_FILL } from './pitchGraph/draw';
import { drawStaticLayer } from './pitchGraph/gridLayer';
import { LiveLayer } from './pitchGraph/liveLayer';
import { drawNotes } from './pitchGraph/notesLayer';
import { drawPitchLine } from './pitchGraph/pitchLineLayer';
import { collectRuns, drawRuns, NoteRuns } from './pitchGraph/trailsLayer';
import type { LiveGraphMode, TimelineGraphMode } from './pitchGraph/types';
import { usePenHandlers } from './pitchGraph/usePenHandlers';

export type { LiveGraphMode, PenGesture, PenOptions, TimelineGraphMode } from './pitchGraph/types';

type Props = {
  mode: LiveGraphMode | TimelineGraphMode;
  engine: PitchEngine;
  filter: DetectionFilter;
  colorizeMarker: boolean;
  showNoteLines: boolean;
  showNoteTrails: boolean;
  trailOpacity: number;
  showDiagnostics: boolean;
  /** Pitch range of the vertical axis. Defaults to the filter's range (Live). */
  range?: { minMidi: number; maxMidi: number };
  height?: number;
  /** Timeline only: clicking the graph seeks here (seconds). */
  onSeek?: (time: number) => void;
  className?: string;
};

const MARKER_MAX_AGE = 0.25; // seconds; older frames don't get a "current" marker
/** What the last repaint showed. A frame whose state matches this can be skipped. */
type DrawState = {
  pixelWidth: number;
  pixelHeight: number;
  dpr: number;
  t0: number;
  t1: number;
  markerX: number;
  markerDrawn: boolean;
  main: FrameSource | null;
  mainVersion: number;
  preview: FrameSource | null;
  previewVersion: number;
  reference: NoteSet | null;
  referenceVersion: number;
};

function emptyDrawState(): DrawState {
  return {
    pixelWidth: 0,
    pixelHeight: 0,
    dpr: 0,
    t0: 0,
    t1: 0,
    markerX: 0,
    markerDrawn: false,
    main: null,
    mainVersion: -1,
    preview: null,
    previewVersion: -1,
    reference: null,
    referenceVersion: -1,
  };
}

function sameDrawState(a: DrawState, b: DrawState) {
  return (
    a.pixelWidth === b.pixelWidth &&
    a.pixelHeight === b.pixelHeight &&
    a.dpr === b.dpr &&
    a.t0 === b.t0 &&
    a.t1 === b.t1 &&
    a.markerX === b.markerX &&
    a.markerDrawn === b.markerDrawn &&
    a.main === b.main &&
    a.mainVersion === b.mainVersion &&
    a.preview === b.preview &&
    a.previewVersion === b.previewVersion &&
    a.reference === b.reference &&
    a.referenceVersion === b.referenceVersion
  );
}

export function PitchGraph(props: Props) {
  const { height, className } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  const sizeRef = useRef({ width: 800, height: height ?? 320 });
  // Set when a prop changes or a new frame arrives. Lets a frozen view skip repaints.
  const dirtyRef = useRef(true);

  // The draw loop runs once and reads the latest props from here, so prop
  // changes never restart it and parents don't need to re-render per frame.
  useLayoutEffect(() => {
    propsRef.current = props;
    dirtyRef.current = true;
  });

  useEffect(
    () =>
      props.engine.subscribe(() => {
        dirtyRef.current = true;
      }),
    [props.engine],
  );

  // Repaint in the new colors when the theme changes.
  useEffect(
    () =>
      subscribeTheme(() => {
        dirtyRef.current = true;
      }),
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;

    const updateSize = () => {
      const width = parent ? parent.clientWidth : 800;
      const resolvedHeight = height ?? (parent ? parent.clientHeight : 320);
      sizeRef.current = { width, height: resolvedHeight };
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    const observer = typeof ResizeObserver !== 'undefined' && parent ? new ResizeObserver(updateSize) : null;
    if (observer && parent) observer.observe(parent);

    return () => {
      window.removeEventListener('resize', updateSize);
      observer?.disconnect();
    };
  }, [height]);

  useEffect(() => {
    let canvasWidth = 0;
    let canvasHeight = 0;
    let canvasDpr = 0;
    const staticCanvas = document.createElement('canvas');
    const staticKey = { width: 0, height: 0, dpr: 0, lo: Number.NaN, hi: Number.NaN, noteLines: false, palette: -1 };
    // Two draw states, reused every frame so the skip check doesn't allocate.
    const seen = emptyDrawState();
    const next = emptyDrawState();
    let hasSeen = false;
    const scratchRuns = new NoteRuns();
    const liveLayer = new LiveLayer();
    const fps = { last: performance.now(), frames: 0, value: 0 };

    // `nowMs` is the rAF timestamp shared by every callback in this frame,
    // so the graph and the waveform compute song time from the same instant.
    const draw = (nowMs: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;

      const p = propsRef.current;
      const { width, height: h } = sizeRef.current;
      const dpr = window.devicePixelRatio || 1;
      const pixelWidth = Math.max(1, Math.round(width * dpr));
      const pixelHeight = Math.max(1, Math.round(h * dpr));
      if (pixelWidth !== canvasWidth || pixelHeight !== canvasHeight || dpr !== canvasDpr) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${h}px`;
        canvasWidth = pixelWidth;
        canvasHeight = pixelHeight;
        canvasDpr = dpr;
      }

      const axis = p.range ?? p.filter;
      const lo = axis.minMidi;
      const hi = Math.max(axis.maxMidi, lo + 1);

      // Grid lines change rarely; cache them on an offscreen canvas.
      if (
        staticKey.width !== pixelWidth ||
        staticKey.height !== pixelHeight ||
        staticKey.dpr !== dpr ||
        staticKey.lo !== lo ||
        staticKey.hi !== hi ||
        staticKey.noteLines !== p.showNoteLines ||
        staticKey.palette !== graphPalette.version
      ) {
        staticCanvas.width = pixelWidth;
        staticCanvas.height = pixelHeight;
        const staticCtx = staticCanvas.getContext('2d');
        if (staticCtx) {
          staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
          drawStaticLayer(staticCtx, width, h, lo, hi, p.showNoteLines);
        }
        staticKey.width = pixelWidth;
        staticKey.height = pixelHeight;
        staticKey.dpr = dpr;
        staticKey.lo = lo;
        staticKey.hi = hi;
        staticKey.noteLines = p.showNoteLines;
        staticKey.palette = graphPalette.version;
      }

      // Both modes map time to x linearly: x = xScale * time + xOffset.
      const mode = p.mode;
      let t0: number;
      let t1: number;
      let xScale: number;
      let xOffset: number;
      let markerX: number;
      let showMarker: boolean;
      let mainSource: FrameSource;
      let previewSource: FrameSource | null = null;
      let previewT0 = 0;
      let previewT1 = 0;
      let reference: NoteSet | null = null;

      if (mode.kind === 'live') {
        t1 = mode.frozenAt ?? nowMs / 1000;
        t0 = t1 - mode.historyDuration;
        xScale = width / mode.historyDuration;
        xOffset = width - t1 * xScale;
        markerX = width - 2;
        showMarker = mode.frozenAt === null;
        mainSource = mode.source;
      } else {
        const scrollLeft = mode.view.scrollLeft;
        xScale = mode.view.pixelsPerSecond;
        xOffset = -scrollLeft;
        t0 = scrollLeft / xScale;
        t1 = (scrollLeft + width) / xScale;
        const songNow = mode.clock.songTimeAt(nowMs);
        // Use the waveform's playhead position (it runs earlier in the same frame)
        // so both playheads are the same pixel. Fall back when there's no waveform.
        const sharedX = mode.view.playheadX;
        markerX =
          sharedX != null
            ? sharedX
            : Math.max(0, Math.min(songNow * xScale + xOffset, width - PLAYHEAD_WIDTH));
        showMarker = mode.showLiveMarker;
        mainSource = mode.take;
        reference = mode.reference;
        if (mode.preview) {
          previewSource = mode.preview;
          previewT0 = Math.max(t0, songNow - mode.previewSeconds);
          previewT1 = Math.min(t1, songNow);
        }
      }

      const latest = p.engine.latest;
      const latestMidi =
        showMarker && latest !== null && nowMs / 1000 - latest.time < MARKER_MAX_AGE
          ? frameToMidi(latest.frequency, latest.clarity, p.filter)
          : null;

      // Skip the repaint when nothing visible has changed. A following live
      // view and a playing timeline always move, so they always draw.
      const animating = mode.kind === 'live' ? mode.frozenAt === null : mode.clock.isPlaying;
      next.pixelWidth = pixelWidth;
      next.pixelHeight = pixelHeight;
      next.dpr = dpr;
      next.t0 = t0;
      next.t1 = t1;
      next.markerX = markerX;
      next.markerDrawn = latestMidi !== null;
      next.main = mainSource;
      next.mainVersion = mainSource.version;
      next.preview = previewSource;
      next.previewVersion = previewSource?.version ?? -1;
      next.reference = reference;
      next.referenceVersion = reference?.version ?? -1;
      if (!animating && !p.showDiagnostics && !dirtyRef.current && hasSeen && sameDrawState(seen, next)) {
        return;
      }
      dirtyRef.current = false;
      Object.assign(seen, next);
      hasSeen = true;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = graphPalette.background;
      ctx.fillRect(0, 0, width, h);
      ctx.drawImage(staticCanvas, 0, 0, width, h);

      if (mode.kind === 'live') {
        const layer = liveLayer.render(
          mainSource,
          t1,
          mode.frozenAt !== null,
          mode.historyDuration,
          width,
          h,
          pixelWidth,
          pixelHeight,
          dpr,
          lo,
          hi,
          p.filter,
          p.showNoteTrails,
          p.trailOpacity,
          scratchRuns,
        );
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(layer, 0, 0);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        if (mode.recordingStartAt !== null) {
          // Use the layer's edge time so the line stays glued to the scrolled history.
          const x = width - (liveLayer.t1 - mode.recordingStartAt) * xScale;
          drawVerticalLine(ctx, x, h, graphPalette.recordLine, 2, 0.7, dpr);
        }
      } else {
        if (mode.beats) drawBeatBands(ctx, mode.beats, t0, t1, xScale, xOffset, width, h);
        const pen = mode.pen ?? null;
        if (mode.spectrogram) {
          // In pen mode the spectrogram is a guide under the notes you're editing, so keep it faint.
          const opacity = mode.spectrogramOpacity ?? 0.6;
          mode.spectrogram.draw(ctx, t0, t1, xScale, xOffset, lo, hi, h, pen ? Math.min(opacity, 0.3) : opacity);
        }
        if (mode.selection) drawSelectionBand(ctx, mode.selection, xScale, xOffset, width, h);
        if (reference) {
          drawNotes(
            ctx,
            reference,
            t0,
            t1,
            xScale,
            xOffset,
            lo,
            hi,
            h,
            width,
            // In pen mode the notes are what you're working on: draw them solid and outlined.
            pen ? Math.max(mode.referenceOpacity, 0.85) : mode.referenceOpacity,
            pen?.selectedId ?? null,
            pen !== null,
          );
        }
        const hasPreview = previewSource !== null && previewT1 > previewT0;
        if (p.showNoteTrails) {
          collectRuns(mainSource, t0 - MAX_GAP_SECONDS, t1, p.filter, scratchRuns);
          drawRuns(ctx, scratchRuns, t0, t1, xScale, xOffset, lo, hi, h, width, p.trailOpacity);
          if (previewSource && hasPreview) {
            collectRuns(previewSource, previewT0 - MAX_GAP_SECONDS, previewT1, p.filter, scratchRuns);
            drawRuns(ctx, scratchRuns, previewT0, previewT1, xScale, xOffset, lo, hi, h, width, p.trailOpacity);
          }
        }
        drawPitchLine(ctx, mainSource, t0, t1, xScale, xOffset, lo, hi, h, p.filter, MAX_GAP_SECONDS);
        if (previewSource && hasPreview) {
          drawPitchLine(ctx, previewSource, previewT0, previewT1, xScale, xOffset, lo, hi, h, p.filter, 0);
        }
        if (mode.beats) drawBeatTicks(ctx, mode.beats, t0, t1, xScale, xOffset, h);
        drawVerticalLine(ctx, markerX, h, graphPalette.playhead, 1, 0.7, dpr);
      }

      if (latestMidi !== null) {
        const style = PITCH_COLOR_SHAPE_MAP[midiToNoteIndex(latestMidi)];
        const y = mapMidiToY(latestMidi, h, lo, hi);
        drawMarker(
          ctx,
          markerX,
          y,
          mode.kind === 'live' ? 5 : 7,
          p.colorizeMarker ? style.shape : 'circle',
          p.colorizeMarker ? NOTE_FILL[midiToNoteIndex(latestMidi)] : graphPalette.ink,
        );
        ctx.fillStyle = graphPalette.ink;
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(formatNoteLabel(latestMidi), Math.max(110, markerX - 10), y - 10);
      }

      if (p.showDiagnostics) {
        fps.frames += 1;
        if (nowMs - fps.last >= 500) {
          fps.value = Math.round((fps.frames * 1000) / (nowMs - fps.last));
          fps.frames = 0;
          fps.last = nowMs;
        }
        const det = p.engine.detectionsPerSecond;
        ctx.save();
        ctx.fillStyle = graphPalette.ink;
        ctx.font = '12px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${fps.value} FPS`, width - 8, 16);
        ctx.fillText(`${det} det/s`, width - 8, 32);
        ctx.fillText(`${det > 0 ? (1000 / det).toFixed(2) : '0.00'} ms`, width - 8, 48);
        ctx.restore();
      }
    };

    return onAnimationFrame(draw, FRAME_ORDER.graph);
  }, []);

  const { penDrag, handlePointerDown, handlePointerMove, finishDrag, handleContextMenu } = usePenHandlers(
    propsRef,
    canvasRef,
    sizeRef,
  );

  // Select tool: drag across the graph to select a passage, as on the waveform.
  const selectDrag = useRef<{ pointerId: number; anchor: number; downX: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const startSelect = (event: PointerEvent<HTMLDivElement>) => {
    const { mode } = propsRef.current;
    if (mode.kind !== 'timeline' || !mode.onSelect || mode.pen || event.button !== 0) return;
    const x = event.clientX - event.currentTarget.getBoundingClientRect().left;
    event.currentTarget.setPointerCapture(event.pointerId);
    selectDrag.current = { pointerId: event.pointerId, anchor: mode.view.clampedTimeAt(x), downX: event.clientX, moved: false };
  };
  const moveSelect = (event: PointerEvent<HTMLDivElement>) => {
    const drag = selectDrag.current;
    const { mode } = propsRef.current;
    if (!drag || drag.pointerId !== event.pointerId || mode.kind !== 'timeline' || !mode.onSelect) return;
    if (!drag.moved && Math.abs(event.clientX - drag.downX) < 2) return;
    drag.moved = true;
    const x = event.clientX - event.currentTarget.getBoundingClientRect().left;
    mode.onSelect({ start: drag.anchor, end: mode.view.clampedTimeAt(x) });
  };
  const endSelect = (event: PointerEvent<HTMLDivElement>) => {
    const drag = selectDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    selectDrag.current = null;
    // A drag ends in a click; don't let it seek.
    if (drag.moved) suppressClick.current = true;
  };

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const { mode, onSeek } = propsRef.current;
    if (mode.kind !== 'timeline' || !onSeek || mode.pen) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, mode.view.xToTime(event.clientX - rect.left)));
  };

  return (
    <div
      className={`pitch-graph${className ? ` ${className}` : ''}`}
      onClick={handleClick}
      onPointerDown={(event) => {
        handlePointerDown(event);
        startSelect(event);
      }}
      onPointerMove={(event) => {
        handlePointerMove(event);
        moveSelect(event);
      }}
      onPointerUp={(event) => {
        finishDrag(event, false);
        endSelect(event);
      }}
      onPointerCancel={(event) => {
        finishDrag(event, true);
        endSelect(event);
      }}
      onPointerLeave={(event) => {
        if (!penDrag.current) event.currentTarget.style.cursor = '';
      }}
      onContextMenu={handleContextMenu}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
