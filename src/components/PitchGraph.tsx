import { useEffect, useLayoutEffect, useRef } from 'react';
import type { MouseEvent, PointerEvent, RefObject } from 'react';
import type { FrameSource } from '../audio/frames';
import { MIN_NOTE_SECONDS, newManualId, type NoteSpan } from '../audio/noteEdits';
import type { NoteSet, RefNote } from '../audio/noteSet';
import type { SpectrogramImage } from '../audio/spectrogramImage';
import { FRAME_ORDER, onAnimationFrame } from '../audio/frameLoop';
import type { PitchEngine } from '../audio/pitchEngine';
import type { PlaybackClock } from '../audio/playbackClock';
import {
  formatNoteLabel,
  frameToMidi,
  midiToNoteIndex,
  PITCH_COLOR_SHAPE_MAP,
  type DetectionFilter,
} from '../utils/pitch';
import { PLAYHEAD_WIDTH } from '../utils/waveform';

/** Live: a rolling window ending "now" on the performance clock. */
export type LiveGraphMode = {
  kind: 'live';
  source: FrameSource;
  historyDuration: number; // seconds
  /** performance seconds to freeze the view at (detection stopped), or null to follow now */
  frozenAt: number | null;
  recordingStartAt: number | null; // performance seconds
};

/** Timeline: x axis is song time, scrolled in lockstep with the waveform viewport. */
export type TimelineGraphMode = {
  kind: 'timeline';
  viewportRef: RefObject<HTMLDivElement | null>;
  pixelsPerSecond: number;
  clock: PlaybackClock;
  take: FrameSource;
  /** Recent mic pitch shown behind the playhead when not recording a take. */
  preview: FrameSource | null;
  /** How many seconds of `preview` to show behind the playhead. */
  previewSeconds: number;
  /** Reference notes, drawn as bars. May overlap (chords, several voices). */
  reference: NoteSet | null;
  referenceOpacity: number;
  /** The waveform's playhead x (viewport px). The graph draws its playhead there so the two line up exactly. */
  playheadXRef?: RefObject<number | null>;
  /** Draw the current mic pitch at the playhead. */
  showLiveMarker: boolean;
  /** The track's spectrogram, drawn behind everything else. Null when off. */
  spectrogram?: SpectrogramImage | null;
  spectrogramOpacity?: number;
  /** Pen mode: edit the reference notes with the mouse. Null when off. */
  pen?: PenOptions | null;
};

/**
 * A pen gesture on a reference note. `create` draws a new note; `edit` moves
 * or trims an existing one. For an auto note, `newId` is the id its edited
 * copy gets (see updateNote).
 */
export type PenGesture =
  | { kind: 'create'; id: string; span: NoteSpan }
  | { kind: 'edit'; note: RefNote; newId: string; span: NoteSpan };

export type PenOptions = {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** `preview` while dragging, then `commit` on release or `cancel` (Escape). */
  onGesture: (gesture: PenGesture, phase: 'preview' | 'commit' | 'cancel') => void;
  onDelete: (note: RefNote) => void;
  /** Play a short tone so you hear a pitch as you place it. */
  onAudition?: (midi: number) => void;
};

/** Length of a note made by a single click (no drag). */
const CLICK_NOTE_SECONDS = 0.25;
/** Pointer this close (px) to a note's end grabs the end for trimming. */
const EDGE_PX = 6;
/** Movement (px) before a press counts as a drag. */
const DRAG_PX = 3;

type PenDrag = {
  pointerId: number;
  kind: 'create' | 'move' | 'trim-start' | 'trim-end';
  note: RefNote | null;
  newId: string;
  downX: number;
  downY: number;
  downTime: number;
  downMidi: number;
  moved: boolean;
  lastMidi: number;
  last: PenGesture | null;
};

type Props = {
  mode: LiveGraphMode | TimelineGraphMode;
  engine: PitchEngine;
  filter: DetectionFilter;
  colorizeMarker: boolean;
  showNoteLines: boolean;
  showNoteTrails: boolean;
  trailOpacity: number;
  showDiagnostics: boolean;
  height?: number;
  /** Timeline only: clicking the graph seeks here (seconds). */
  onSeek?: (time: number) => void;
  className?: string;
};

const BACKGROUND = '#f8fafc';
const TAKE_LINE = '#334155';
const MAX_GAP_SECONDS = 0.06; // break lines across gaps longer than this
const MARKER_MAX_AGE = 0.25; // seconds; older frames don't get a "current" marker
/**
 * Live mode repaints only this much of the right edge each frame. Frames are
 * stamped at the middle of their analysis window and reach the main thread a
 * little late, so they land slightly left of "now"; this has to cover that delay.
 */
const LIVE_TAIL_SECONDS = 0.3;
// Built once so the draw loop doesn't allocate a color string per rectangle.
const NOTE_FILL = Array.from({ length: 12 }, (_, i) =>
  `rgb(${PITCH_COLOR_SHAPE_MAP[i as keyof typeof PITCH_COLOR_SHAPE_MAP].rgb})`,
);

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
    const staticKey = { width: 0, height: 0, dpr: 0, lo: Number.NaN, hi: Number.NaN, noteLines: false };
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

      const lo = p.filter.minMidi;
      const hi = Math.max(p.filter.maxMidi, lo + 1);

      // Grid lines change rarely; cache them on an offscreen canvas.
      if (
        staticKey.width !== pixelWidth ||
        staticKey.height !== pixelHeight ||
        staticKey.dpr !== dpr ||
        staticKey.lo !== lo ||
        staticKey.hi !== hi ||
        staticKey.noteLines !== p.showNoteLines
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
        const scrollLeft = mode.viewportRef.current?.scrollLeft ?? 0;
        xScale = mode.pixelsPerSecond;
        xOffset = -scrollLeft;
        t0 = scrollLeft / xScale;
        t1 = (scrollLeft + width) / xScale;
        const songNow = mode.clock.songTimeAt(nowMs);
        // Use the waveform's playhead position (it runs earlier in the same frame)
        // so both playheads are the same pixel. Fall back when there's no waveform.
        const sharedX = mode.playheadXRef?.current;
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
      ctx.fillStyle = BACKGROUND;
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
          drawVerticalLine(ctx, x, h, '#ef4444', 2, 0.7, dpr);
        }
      } else {
        if (mode.spectrogram) {
          mode.spectrogram.draw(ctx, t0, t1, xScale, xOffset, lo, hi, h, mode.spectrogramOpacity ?? 0.6);
        }
        if (reference) {
          const pen = mode.pen ?? null;
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
            // In pen mode the notes are what you're working on, so keep them visible.
            pen ? Math.max(mode.referenceOpacity, 0.35) : mode.referenceOpacity,
            pen?.selectedId ?? null,
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
        drawVerticalLine(ctx, markerX, h, '#94a3b8', 1, 0.7, dpr);
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
          p.colorizeMarker ? NOTE_FILL[midiToNoteIndex(latestMidi)] : '#0f172a',
        );
        ctx.fillStyle = '#0f172a';
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
        ctx.fillStyle = '#0f172a';
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

  const penDrag = useRef<PenDrag | null>(null);

  /** Song time, semitone and pixel position under the pointer (timeline only). */
  const locate = (event: { clientX: number; clientY: number }) => {
    const { mode, filter } = propsRef.current;
    const canvas = canvasRef.current;
    if (mode.kind !== 'timeline' || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const scrollLeft = mode.viewportRef.current?.scrollLeft ?? 0;
    const lo = filter.minMidi;
    const hi = Math.max(filter.maxMidi, lo + 1);
    const h = sizeRef.current.height;
    return {
      x,
      y,
      time: Math.max(0, (scrollLeft + x) / mode.pixelsPerSecond),
      midi: Math.round(hi - (y / h) * (hi - lo)),
      toX: (time: number) => time * mode.pixelsPerSecond - scrollLeft,
      slack: 3 / mode.pixelsPerSecond,
    };
  };

  const penOptions = () => {
    const { mode } = propsRef.current;
    return mode.kind === 'timeline' && mode.pen ? { pen: mode.pen, notes: mode.reference } : null;
  };

  /** What a press here would do: which note, and which part of it. */
  const penTarget = (spot: NonNullable<ReturnType<typeof locate>>) => {
    const notes = penOptions()?.notes;
    const note = notes?.noteAt(spot.time, spot.midi, spot.slack) ?? null;
    if (!note) return { note: null, kind: 'create' as const };
    const startX = spot.toX(note.start);
    const endX = spot.toX(note.end);
    const wide = endX - startX >= EDGE_PX * 3;
    if (Math.abs(spot.x - endX) <= EDGE_PX && spot.x >= startX + 2) return { note, kind: 'trim-end' as const };
    if (wide && Math.abs(spot.x - startX) <= EDGE_PX) return { note, kind: 'trim-start' as const };
    return { note, kind: 'move' as const };
  };

  const gestureFor = (drag: PenDrag, spot: NonNullable<ReturnType<typeof locate>>, pitchOnly: boolean): PenGesture => {
    if (drag.kind === 'create' || !drag.note) {
      const end = drag.moved ? spot.time : drag.downTime + CLICK_NOTE_SECONDS;
      return {
        kind: 'create',
        id: drag.newId,
        span: { midi: drag.downMidi, start: Math.min(drag.downTime, end), end: Math.max(drag.downTime, end) },
      };
    }
    const note = drag.note;
    let span: NoteSpan;
    if (drag.kind === 'move') {
      const dt = pitchOnly ? 0 : Math.max(-note.start, spot.time - drag.downTime);
      span = { midi: note.midi + spot.midi - drag.downMidi, start: note.start + dt, end: note.end + dt };
    } else if (drag.kind === 'trim-start') {
      span = { midi: note.midi, start: Math.min(spot.time, note.end - MIN_NOTE_SECONDS), end: note.end };
    } else {
      span = { midi: note.midi, start: note.start, end: Math.max(spot.time, note.start + MIN_NOTE_SECONDS) };
    }
    return { kind: 'edit', note, newId: drag.newId, span };
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const options = penOptions();
    if (!options || event.button !== 0) return;
    const spot = locate(event);
    if (!spot) return;
    event.preventDefault();
    const target = penTarget(spot);
    event.currentTarget.setPointerCapture(event.pointerId);
    penDrag.current = {
      pointerId: event.pointerId,
      kind: target.kind,
      note: target.note,
      newId: target.note?.origin === 'manual' ? target.note.id : newManualId(),
      downX: spot.x,
      downY: spot.y,
      downTime: spot.time,
      downMidi: spot.midi,
      moved: false,
      lastMidi: target.note?.midi ?? spot.midi,
      last: null,
    };
    options.pen.onSelect(target.note?.id ?? null);
    options.pen.onAudition?.(target.note?.midi ?? spot.midi);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const options = penOptions();
    const spot = options ? locate(event) : null;
    if (!options || !spot) {
      event.currentTarget.style.cursor = '';
      return;
    }
    const drag = penDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      // Hover: show what a press would do.
      const kind = penTarget(spot).kind;
      event.currentTarget.style.cursor =
        kind === 'create' ? 'crosshair' : kind === 'move' ? 'grab' : 'ew-resize';
      return;
    }
    if (!drag.moved && Math.hypot(spot.x - drag.downX, spot.y - drag.downY) < DRAG_PX) return;
    drag.moved = true;
    const gesture = gestureFor(drag, spot, event.shiftKey);
    drag.last = gesture;
    options.pen.onGesture(gesture, 'preview');
    if (gesture.span.midi !== drag.lastMidi) {
      drag.lastMidi = gesture.span.midi;
      options.pen.onAudition?.(gesture.span.midi);
    }
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const drag = penDrag.current;
    const options = penOptions();
    if (!drag || drag.pointerId !== event.pointerId) return;
    penDrag.current = null;
    if (!options) return;
    if (cancelled) {
      if (drag.last) options.pen.onGesture(drag.last, 'cancel');
      return;
    }
    const spot = locate(event);
    if (drag.kind === 'create' && spot) {
      // A click (no drag) makes a note of default length.
      options.pen.onGesture(gestureFor(drag, spot, event.shiftKey), 'commit');
      return;
    }
    if (drag.moved && spot) options.pen.onGesture(gestureFor(drag, spot, event.shiftKey), 'commit');
  };

  // Escape cancels a drag in progress.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !penDrag.current) return;
      const drag = penDrag.current;
      penDrag.current = null;
      const options = penOptions();
      if (options && drag.last) options.pen.onGesture(drag.last, 'cancel');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    const options = penOptions();
    const spot = options ? locate(event) : null;
    if (!options || !spot) return;
    event.preventDefault();
    const note = options.notes?.noteAt(spot.time, spot.midi, spot.slack);
    if (note) options.pen.onDelete(note);
  };

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const { mode, onSeek } = propsRef.current;
    if (mode.kind !== 'timeline' || !onSeek || mode.pen) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const scrollLeft = mode.viewportRef.current?.scrollLeft ?? 0;
    onSeek(Math.max(0, (scrollLeft + event.clientX - rect.left) / mode.pixelsPerSecond));
  };

  return (
    <div
      className={`pitch-graph${className ? ` ${className}` : ''}`}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => finishDrag(event, false)}
      onPointerCancel={(event) => finishDrag(event, true)}
      onPointerLeave={(event) => {
        if (!penDrag.current) event.currentTarget.style.cursor = '';
      }}
      onContextMenu={handleContextMenu}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}

function mapMidiToY(midi: number, height: number, lo: number, hi: number) {
  const clamped = Math.max(lo, Math.min(hi, midi));
  return ((hi - clamped) / (hi - lo)) * height;
}

function drawStaticLayer(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  lo: number,
  hi: number,
  showNoteLines: boolean,
) {
  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = 1;

  if (showNoteLines) {
    ctx.save();
    ctx.strokeStyle = '#e2e8f0';
    ctx.globalAlpha = 0.4;
    for (let midi = Math.ceil(lo); midi <= hi; midi += 1) {
      if (midiToNoteIndex(midi) === 0) continue;
      const y = mapMidiToY(midi, height, lo, hi);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Octave lines on every C in range.
  ctx.strokeStyle = '#e2e8f0';
  ctx.fillStyle = '#64748b';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'left';
  for (let midi = Math.ceil(lo / 12) * 12; midi <= hi; midi += 12) {
    const y = mapMidiToY(midi, height, lo, hi);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.fillText(`C${midi / 12 - 1}`, 6, y - 4);
  }
}

/**
 * Note trails as runs: one entry per stretch of frames on the same semitone,
 * so a held note is one rectangle instead of one per frame (which also stops
 * overlapping translucent rectangles from stacking into darker bands).
 * Typed arrays, grown as needed and reused, so building runs doesn't allocate per frame.
 */
class NoteRuns {
  starts = new Float64Array(256);
  ends = new Float64Array(256);
  notes = new Int16Array(256);
  /** 1 when the run ended at a gap, so its last frame gets a minimum 2 px width. */
  padded = new Uint8Array(256);
  count = 0;

  clear() {
    this.count = 0;
  }

  push(start: number, end: number, note: number, padded: number) {
    if (this.count === this.starts.length) this.grow();
    const i = this.count;
    this.starts[i] = start;
    this.ends[i] = end;
    this.notes[i] = note;
    this.padded[i] = padded;
    this.count = i + 1;
  }

  /** Index of the first run ending at or after `time` (runs are in time order). */
  firstEndingAfter(time: number) {
    let low = 0;
    let high = this.count;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.ends[mid] < time) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  private grow() {
    const size = this.starts.length * 2;
    const starts = new Float64Array(size);
    starts.set(this.starts);
    const ends = new Float64Array(size);
    ends.set(this.ends);
    const notes = new Int16Array(size);
    notes.set(this.notes);
    const padded = new Uint8Array(size);
    padded.set(this.padded);
    this.starts = starts;
    this.ends = ends;
    this.notes = notes;
    this.padded = padded;
  }
}

// Visitor state lives at module level so forEachInRange gets the same function
// every frame instead of a fresh closure. Drawing is never re-entrant.
const runState = {
  out: null as NoteRuns | null,
  filter: null as DetectionFilter | null,
  active: false,
  note: 0,
  start: 0,
  last: 0,
};

function visitRun(time: number, frequency: number, clarity: number) {
  const s = runState;
  const out = s.out;
  const filter = s.filter;
  if (!out || !filter) return;
  const midi = frameToMidi(frequency, clarity, filter);
  if (s.active) {
    if (time - s.last <= MAX_GAP_SECONDS) {
      if (midi !== null && Math.round(midi) === s.note) {
        s.last = time;
        return;
      }
      // Pitch changed or went unvoiced: the run reaches this frame.
      out.push(s.start, time, s.note, 0);
    } else {
      out.push(s.start, s.last, s.note, 1);
    }
  }
  if (midi === null) {
    s.active = false;
    return;
  }
  s.active = true;
  s.note = Math.round(midi);
  s.start = time;
  s.last = time;
}

function collectRuns(source: FrameSource, t0: number, t1: number, filter: DetectionFilter, out: NoteRuns) {
  out.clear();
  runState.out = out;
  runState.filter = filter;
  runState.active = false;
  source.forEachInRange(t0, t1, visitRun);
  if (runState.active) out.push(runState.start, runState.last, runState.note, 1);
  runState.out = null;
  runState.filter = null;
}

/** Translucent note-height bars in each note's color, for the runs visible in [t0, t1]. */
function drawRuns(
  ctx: CanvasRenderingContext2D,
  runs: NoteRuns,
  t0: number,
  t1: number,
  xScale: number,
  xOffset: number,
  lo: number,
  hi: number,
  h: number,
  width: number,
  alpha: number,
) {
  if (runs.count === 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  let currentFill = -1;
  for (let i = runs.firstEndingAfter(t0 - 2 / xScale); i < runs.count; i += 1) {
    const start = runs.starts[i];
    if (start > t1) break;
    const startX = xScale * start + xOffset;
    const endX = xScale * runs.ends[i] + xOffset + (runs.padded[i] ? 2 : 0);
    const left = Math.max(0, startX);
    const right = Math.min(width, endX);
    if (right <= 0 || left >= width) continue;
    const note = runs.notes[i];
    const top = mapMidiToY(note + 0.5, h, lo, hi);
    const bottom = mapMidiToY(note - 0.5, h, lo, hi);
    const fill = ((note % 12) + 12) % 12;
    if (fill !== currentFill) {
      ctx.fillStyle = NOTE_FILL[fill];
      currentFill = fill;
    }
    ctx.fillRect(left, Math.min(top, bottom), Math.max(2, right - left), Math.abs(bottom - top));
  }
  ctx.restore();
}

/** Note bars, which (unlike runs) may overlap. */
function drawNotes(
  ctx: CanvasRenderingContext2D,
  notes: NoteSet,
  t0: number,
  t1: number,
  xScale: number,
  xOffset: number,
  lo: number,
  hi: number,
  h: number,
  width: number,
  alpha: number,
  selectedId: string | null = null,
) {
  if (notes.count === 0) return;
  ctx.save();
  // Hand-edited notes are drawn stronger and outlined so you can tell them apart.
  const manualAlpha = Math.min(1, Math.max(alpha * 2, 0.6));
  let selected: { x: number; y: number; w: number; h: number } | null = null;
  notes.forEachOverlapping(t0 - 2 / xScale, t1, (note) => {
    const left = Math.max(0, xScale * note.start + xOffset);
    const right = Math.min(width, xScale * note.end + xOffset);
    if (right <= 0 || left >= width) return;
    const top = mapMidiToY(note.midi + 0.5, h, lo, hi);
    const bottom = mapMidiToY(note.midi - 0.5, h, lo, hi);
    const x = left;
    const y = Math.min(top, bottom);
    const w = Math.max(2, right - left);
    const barHeight = Math.abs(bottom - top);
    const manual = note.origin === 'manual';
    ctx.globalAlpha = manual ? manualAlpha : alpha;
    ctx.fillStyle = NOTE_FILL[((note.midi % 12) + 12) % 12];
    ctx.fillRect(x, y, w, barHeight);
    if (manual) {
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = TAKE_LINE;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, barHeight - 1));
    }
    if (note.id === selectedId) selected = { x, y, w, h: barHeight };
  });
  if (selected) {
    const box = selected as { x: number; y: number; w: number; h: number };
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.strokeRect(box.x - 1, box.y - 1, box.w + 2, box.h + 2);
  }
  ctx.restore();
}

const lineState = {
  ctx: null as CanvasRenderingContext2D | null,
  filter: null as DetectionFilter | null,
  xScale: 0,
  xOffset: 0,
  lo: 0,
  hi: 1,
  h: 0,
  drawing: false,
  previousTime: Number.NEGATIVE_INFINITY,
};

function visitLine(time: number, frequency: number, clarity: number) {
  const s = lineState;
  const ctx = s.ctx;
  const filter = s.filter;
  if (!ctx || !filter) return;
  const midi = frameToMidi(frequency, clarity, filter);
  if (midi === null || time - s.previousTime > MAX_GAP_SECONDS) s.drawing = false;
  s.previousTime = time;
  if (midi === null) return;
  const x = s.xScale * time + s.xOffset;
  const y = mapMidiToY(midi, s.h, s.lo, s.hi);
  if (s.drawing) {
    ctx.lineTo(x, y);
  } else {
    ctx.moveTo(x, y);
    s.drawing = true;
  }
}

/** Dark pitch line, broken at unvoiced frames and gaps. */
function drawPitchLine(
  ctx: CanvasRenderingContext2D,
  source: FrameSource,
  t0: number,
  t1: number,
  xScale: number,
  xOffset: number,
  lo: number,
  hi: number,
  h: number,
  filter: DetectionFilter,
  /** Extra time read past each edge so lines run off-canvas instead of stopping short. */
  margin: number,
) {
  ctx.save();
  ctx.strokeStyle = TAKE_LINE;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const s = lineState;
  s.ctx = ctx;
  s.filter = filter;
  s.xScale = xScale;
  s.xOffset = xOffset;
  s.lo = lo;
  s.hi = hi;
  s.h = h;
  s.drawing = false;
  s.previousTime = Number.NEGATIVE_INFINITY;
  source.forEachInRange(t0 - margin, t1 + margin, visitLine);
  s.ctx = null;
  s.filter = null;
  ctx.stroke();
  ctx.restore();
}

/**
 * Live mode's history (trails and pitch line) on an offscreen canvas that is
 * scrolled rather than redrawn: each frame shifts it left by whole device
 * pixels and repaints only the right-hand tail where new frames can land.
 * Anything that changes the picture (size, filter, trails toggle, window
 * length, freezing, a long stall) falls back to one full repaint.
 */
class LiveLayer {
  private front = document.createElement('canvas');
  private back = document.createElement('canvas');
  private source: FrameSource | null = null;
  private pixelWidth = 0;
  private pixelHeight = 0;
  private dpr = 0;
  private width = 0;
  private height = 0;
  private historyDuration = 0;
  private lo = Number.NaN;
  private hi = Number.NaN;
  private clarity = Number.NaN;
  private cents = Number.NaN;
  private showTrails = false;
  private trailOpacity = Number.NaN;
  /** Performance-clock time at the layer's right edge. */
  t1 = Number.NaN;

  render(
    source: FrameSource,
    t1: number,
    frozen: boolean,
    historyDuration: number,
    width: number,
    height: number,
    pixelWidth: number,
    pixelHeight: number,
    dpr: number,
    lo: number,
    hi: number,
    filter: DetectionFilter,
    showTrails: boolean,
    trailOpacity: number,
    runs: NoteRuns,
  ): HTMLCanvasElement {
    const changed =
      source !== this.source ||
      pixelWidth !== this.pixelWidth ||
      pixelHeight !== this.pixelHeight ||
      dpr !== this.dpr ||
      width !== this.width ||
      height !== this.height ||
      historyDuration !== this.historyDuration ||
      lo !== this.lo ||
      hi !== this.hi ||
      filter.clarityThreshold !== this.clarity ||
      filter.centsThreshold !== this.cents ||
      showTrails !== this.showTrails ||
      trailOpacity !== this.trailOpacity;

    if (changed) {
      if (pixelWidth !== this.pixelWidth || pixelHeight !== this.pixelHeight) {
        this.front.width = pixelWidth;
        this.front.height = pixelHeight;
        this.back.width = pixelWidth;
        this.back.height = pixelHeight;
      }
      this.source = source;
      this.pixelWidth = pixelWidth;
      this.pixelHeight = pixelHeight;
      this.dpr = dpr;
      this.width = width;
      this.height = height;
      this.historyDuration = historyDuration;
      this.lo = lo;
      this.hi = hi;
      this.clarity = filter.clarityThreshold;
      this.cents = filter.centsThreshold;
      this.showTrails = showTrails;
      this.trailOpacity = trailOpacity;
    }

    const pxPerSecond = width / historyDuration;
    const devicePxPerSecond = pxPerSecond * dpr;

    if (changed || frozen || !(t1 >= this.t1) || t1 - this.t1 >= historyDuration) {
      const ctx = this.front.getContext('2d');
      if (!ctx) return this.front;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, pixelWidth, pixelHeight);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.t1 = t1;
      this.paint(ctx, source, t1 - historyDuration, t1, pxPerSecond, filter, runs);
      return this.front;
    }

    // Whole device pixels only, so the copy stays sharp; the remainder carries over.
    const shift = Math.floor((t1 - this.t1) * devicePxPerSecond);
    if (shift > 0) {
      const backCtx = this.back.getContext('2d');
      if (backCtx) {
        backCtx.setTransform(1, 0, 0, 1, 0, 0);
        backCtx.clearRect(0, 0, pixelWidth, pixelHeight);
        backCtx.drawImage(this.front, -shift, 0);
        const swap = this.front;
        this.front = this.back;
        this.back = swap;
        this.t1 += shift / devicePxPerSecond;
      }
    }

    const ctx = this.front.getContext('2d');
    if (!ctx) return this.front;
    const repaint = Math.min(
      pixelWidth,
      Math.max(Math.ceil(LIVE_TAIL_SECONDS * devicePxPerSecond), shift + 2),
    );
    const left = pixelWidth - repaint;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(left, 0, repaint, pixelHeight);
    ctx.beginPath();
    ctx.rect(left, 0, repaint, pixelHeight);
    ctx.clip();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.paint(ctx, source, this.t1 - repaint / devicePxPerSecond, this.t1, pxPerSecond, filter, runs);
    ctx.restore();
    return this.front;
  }

  private paint(
    ctx: CanvasRenderingContext2D,
    source: FrameSource,
    from: number,
    to: number,
    pxPerSecond: number,
    filter: DetectionFilter,
    runs: NoteRuns,
  ) {
    const xOffset = this.width - this.t1 * pxPerSecond;
    if (this.showTrails) {
      collectRuns(source, from - MAX_GAP_SECONDS, to, filter, runs);
      drawRuns(ctx, runs, from, to, pxPerSecond, xOffset, this.lo, this.hi, this.height, this.width, this.trailOpacity);
    }
    drawPitchLine(ctx, source, from, to, pxPerSecond, xOffset, this.lo, this.hi, this.height, filter, MAX_GAP_SECONDS);
  }
}

/**
 * A full-height line as a filled rectangle whose left edge is snapped to a
 * device pixel. A stroked line centered on a fractional x is antialiased
 * across two pixels, and as x moves that blur shifts, which reads as jitter.
 */
function drawVerticalLine(
  ctx: CanvasRenderingContext2D,
  x: number,
  h: number,
  color: string,
  lineWidth: number,
  alpha: number,
  dpr: number,
) {
  if (!Number.isFinite(x)) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.fillRect(Math.round(x * dpr) / dpr, 0, lineWidth, h);
  ctx.restore();
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  shape: 'square' | 'circle',
  fill: string,
) {
  ctx.fillStyle = fill;
  if (shape === 'square') {
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    return;
  }
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}
