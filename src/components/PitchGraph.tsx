import { useEffect, useLayoutEffect, useRef } from 'react';
import type { MouseEvent, RefObject } from 'react';
import type { FrameSource } from '../audio/frames';
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
  reference: FrameSource | null;
  referenceFilter: DetectionFilter;
  /** Draw the current mic pitch at the playhead. */
  showLiveMarker: boolean;
};

type Props = {
  mode: LiveGraphMode | TimelineGraphMode;
  engine: PitchEngine;
  filter: DetectionFilter;
  colorizeMarker: boolean;
  showNoteLines: boolean;
  showNoteTrails: boolean;
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
const TRAIL_ALPHA = 0.28;
const REFERENCE_ALPHA = 0.16;
// Built once so the draw loop doesn't allocate a color string per rectangle.
const NOTE_FILL = Array.from({ length: 12 }, (_, i) =>
  `rgb(${PITCH_COLOR_SHAPE_MAP[i as keyof typeof PITCH_COLOR_SHAPE_MAP].rgb})`,
);

/** What the last repaint showed. A frame whose state matches this can be skipped. */
type DrawState = {
  canvasKey: string;
  t0: number;
  t1: number;
  markerX: number;
  markerDrawn: boolean;
  main: FrameSource;
  mainVersion: number;
  preview: FrameSource | null;
  previewVersion: number;
  reference: FrameSource | null;
  referenceVersion: number;
};

function sameDrawState(a: DrawState, b: DrawState) {
  return (
    a.canvasKey === b.canvasKey &&
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

  useEffect(() => props.engine.subscribe(() => {
    dirtyRef.current = true;
  }), [props.engine]);

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
    let canvasKey = '';
    let staticKey = '';
    let seen: DrawState | null = null;
    const staticCanvas = document.createElement('canvas');
    const fps = { last: performance.now(), frames: 0, value: 0 };

    // `frameNow` is the rAF timestamp shared by every callback in this frame,
    // so the graph and the waveform compute song time from the same instant.
    const draw = (frameNow: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;

      const p = propsRef.current;
      const nowMs = frameNow;

      const { width, height: h } = sizeRef.current;
      const dpr = window.devicePixelRatio || 1;
      const pixelWidth = Math.max(1, Math.round(width * dpr));
      const pixelHeight = Math.max(1, Math.round(h * dpr));
      const nextCanvasKey = `${pixelWidth}x${pixelHeight}@${dpr}`;
      if (nextCanvasKey !== canvasKey) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${h}px`;
        canvasKey = nextCanvasKey;
      }

      const lo = p.filter.minMidi;
      const hi = Math.max(p.filter.maxMidi, lo + 1);
      const yOf = (midi: number) => mapMidiToY(midi, h, lo, hi);

      // Grid lines change rarely; cache them on an offscreen canvas.
      const nextStaticKey = `${nextCanvasKey}|${p.showNoteLines}|${lo}-${hi}`;
      if (nextStaticKey !== staticKey) {
        staticCanvas.width = pixelWidth;
        staticCanvas.height = pixelHeight;
        const staticCtx = staticCanvas.getContext('2d');
        if (staticCtx) {
          staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
          drawStaticLayer(staticCtx, width, h, lo, hi, p.showNoteLines);
        }
        staticKey = nextStaticKey;
      }

      const mode = p.mode;
      let t0: number;
      let t1: number;
      let xOf: (time: number) => number;
      let markerX: number;
      let showMarker: boolean;
      let mainSource: FrameSource;
      let preview: { source: FrameSource; t0: number; t1: number } | null = null;

      if (mode.kind === 'live') {
        t1 = mode.frozenAt ?? nowMs / 1000;
        t0 = t1 - mode.historyDuration;
        const pxPerSecond = width / mode.historyDuration;
        xOf = (time) => width - (t1 - time) * pxPerSecond;
        markerX = width - 2;
        showMarker = mode.frozenAt === null;
        mainSource = mode.source;

        if (mode.recordingStartAt !== null) {
          drawVerticalLine(ctx, xOf(mode.recordingStartAt), h, '#ef4444', 2, 0.7);
        }
      } else {
        const viewport = mode.viewportRef.current;
        const scrollLeft = viewport?.scrollLeft ?? 0;
        const pps = mode.pixelsPerSecond;
        t0 = scrollLeft / pps;
        t1 = (scrollLeft + width) / pps;
        xOf = (time) => time * pps - scrollLeft;
        const songNow = mode.clock.songTimeAt(nowMs);
        markerX = Math.max(0, Math.min(xOf(songNow), width - PLAYHEAD_WIDTH));
        showMarker = mode.showLiveMarker;
        mainSource = mode.take;

        if (mode.preview) {
          preview = {
            source: mode.preview,
            t0: Math.max(t0, songNow - mode.previewSeconds),
            t1: Math.min(t1, songNow),
          };
        }
      }

      const latest = p.engine.latest;
      const markerDrawn =
        showMarker &&
        latest !== null &&
        nowMs / 1000 - latest.time < MARKER_MAX_AGE &&
        frameToMidi(latest.frequency, latest.clarity, p.filter) !== null;

      // Skip the repaint when nothing visible has changed. A following live
      // view and a playing timeline always move, so they always draw.
      const animating = mode.kind === 'live' ? mode.frozenAt === null : mode.clock.isPlaying;
      const reference = mode.kind === 'timeline' ? mode.reference : null;
      const previewSource = preview?.source ?? null;
      const next: DrawState = {
        canvasKey: nextCanvasKey,
        t0,
        t1,
        markerX,
        markerDrawn,
        main: mainSource,
        mainVersion: mainSource.version,
        preview: previewSource,
        previewVersion: previewSource?.version ?? -1,
        reference,
        referenceVersion: reference?.version ?? -1,
      };
      if (!animating && !p.showDiagnostics && !dirtyRef.current && seen !== null && sameDrawState(seen, next)) {
        return;
      }
      dirtyRef.current = false;
      seen = next;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = BACKGROUND;
      ctx.fillRect(0, 0, width, h);
      ctx.drawImage(staticCanvas, 0, 0, width, h);

      if (mode.kind === 'timeline' && mode.reference) {
        drawTrails(ctx, mode.reference, t0, t1, xOf, lo, hi, h, width, mode.referenceFilter, REFERENCE_ALPHA);
      }

      if (p.showNoteTrails) {
        drawTrails(ctx, mainSource, t0, t1, xOf, lo, hi, h, width, p.filter, TRAIL_ALPHA);
        if (preview && preview.t1 > preview.t0) {
          drawTrails(ctx, preview.source, preview.t0, preview.t1, xOf, lo, hi, h, width, p.filter, TRAIL_ALPHA);
        }
      }
      drawPitchLine(ctx, mainSource, t0, t1, xOf, yOf, p.filter);
      if (preview && preview.t1 > preview.t0) {
        drawPitchLine(ctx, preview.source, preview.t0, preview.t1, xOf, yOf, p.filter, 0);
      }

      if (mode.kind === 'timeline') {
        drawVerticalLine(ctx, markerX, h, '#94a3b8', 1, 0.7);
      }

      if (showMarker && latest && nowMs / 1000 - latest.time < MARKER_MAX_AGE) {
        const midi = frameToMidi(latest.frequency, latest.clarity, p.filter);
        if (midi !== null) {
          const style = PITCH_COLOR_SHAPE_MAP[midiToNoteIndex(midi)];
          const y = yOf(midi);
          drawMarker(
            ctx,
            markerX,
            y,
            mode.kind === 'live' ? 5 : 7,
            p.colorizeMarker ? style.shape : 'circle',
            p.colorizeMarker ? `rgb(${style.rgb})` : '#0f172a',
          );
          ctx.fillStyle = '#0f172a';
          ctx.font = 'bold 13px sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText(formatNoteLabel(midi), Math.max(110, markerX - 10), y - 10);
        }
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

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const { mode, onSeek } = propsRef.current;
    if (mode.kind !== 'timeline' || !onSeek) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const scrollLeft = mode.viewportRef.current?.scrollLeft ?? 0;
    onSeek(Math.max(0, (scrollLeft + event.clientX - rect.left) / mode.pixelsPerSecond));
  };

  return (
    <div className={`pitch-graph${className ? ` ${className}` : ''}`} onClick={handleClick}>
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

type XOf = (time: number) => number;
type YOf = (midi: number) => number;

/** Dark pitch line, broken at unvoiced frames and gaps. */
function drawPitchLine(
  ctx: CanvasRenderingContext2D,
  source: FrameSource,
  t0: number,
  t1: number,
  xOf: XOf,
  yOf: YOf,
  filter: DetectionFilter,
  /** Extra time read past each edge so lines run off-canvas instead of stopping short. */
  margin = MAX_GAP_SECONDS,
) {
  ctx.save();
  ctx.strokeStyle = TAKE_LINE;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let drawing = false;
  let previousTime = -Infinity;
  source.forEachInRange(t0 - margin, t1 + margin, (time, frequency, clarity) => {
    const midi = frameToMidi(frequency, clarity, filter);
    if (midi === null || time - previousTime > MAX_GAP_SECONDS) drawing = false;
    previousTime = time;
    if (midi === null) return;
    const x = xOf(time);
    const y = yOf(midi);
    if (drawing) {
      ctx.lineTo(x, y);
    } else {
      ctx.moveTo(x, y);
      drawing = true;
    }
  });
  ctx.stroke();
  ctx.restore();
}

/** Translucent note-height bars in each note's color. */
function drawTrails(
  ctx: CanvasRenderingContext2D,
  source: FrameSource,
  t0: number,
  t1: number,
  xOf: XOf,
  lo: number,
  hi: number,
  h: number,
  width: number,
  filter: DetectionFilter,
  alpha: number,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  let previous: { x: number; note: number; time: number } | null = null;

  const flush = (endX: number) => {
    if (!previous) return;
    const startX = Math.max(0, Math.min(previous.x, endX));
    const stopX = Math.min(width, Math.max(previous.x, endX));
    if (stopX <= 0 || startX >= width) return;
    const top = mapMidiToY(previous.note + 0.5, h, lo, hi);
    const bottom = mapMidiToY(previous.note - 0.5, h, lo, hi);
    ctx.fillStyle = NOTE_FILL[midiToNoteIndex(previous.note)];
    ctx.fillRect(startX, Math.min(top, bottom), Math.max(2, stopX - startX), Math.abs(bottom - top));
  };

  source.forEachInRange(t0 - MAX_GAP_SECONDS, t1, (time, frequency, clarity) => {
    const midi = frameToMidi(frequency, clarity, filter);
    const x = xOf(time);
    if (previous) flush(time - previous.time <= MAX_GAP_SECONDS ? x : previous.x + 2);
    previous = midi === null ? null : { x, note: Math.round(midi), time };
  });
  if (previous) flush((previous as { x: number }).x + 2);
  ctx.restore();
}

function drawVerticalLine(
  ctx: CanvasRenderingContext2D,
  x: number,
  h: number,
  color: string,
  lineWidth: number,
  alpha: number,
) {
  if (!Number.isFinite(x)) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, h);
  ctx.stroke();
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
