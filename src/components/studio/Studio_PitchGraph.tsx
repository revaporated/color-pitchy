import { useEffect, useRef } from 'react';
import type { PitchSample } from '../../hooks/usePitchDetector';
import { formatNoteLabel, midiToNoteIndex, PITCH_COLOR_SHAPE_MAP } from '../../utils/pitch';
import { PIXELS_PER_SECOND, PLAYHEAD_WIDTH } from '../../utils/waveform';

const LOWEST_NOTE = 36; // C2
const HIGHEST_NOTE = 96; // C8

type HistoryBuffer = {
  data: Array<PitchSample | null>;
  head: number;
  count: number;
  capacity: number;
};

type Props = {
  sample: PitchSample;
  historyDuration: number; // seconds
  colorizeMarker: boolean;
  showNoteLines: boolean;
  showNoteTrails: boolean;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  height?: number;
  pixelsPerSecond?: number;
  resetKey?: number;
  isRecording?: boolean;
  recordingStartAt?: number | null;
  detectionsPerSecond?: number;
  maxFps?: number;
  detectionRateHz?: number;
  showDiagnostics?: boolean;
};

export function PitchGraph({
  sample,
  historyDuration,
  colorizeMarker,
  showNoteLines,
  showNoteTrails,
  currentTime,
  duration,
  isPlaying,
  height,
  pixelsPerSecond = PIXELS_PER_SECOND,
  resetKey,
  isRecording = false,
  recordingStartAt = null,
  detectionsPerSecond = 0,
  maxFps = 165,
  detectionRateHz = 165,
  showDiagnostics = true,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<HistoryBuffer>({
    data: [],
    head: 0,
    count: 0,
    capacity: 0,
  });
  const detectionRateRef = useRef(detectionRateHz || maxFps);
  const sampleRef = useRef<PitchSample>(sample);
  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(duration);
  const isPlayingRef = useRef(isPlaying);
  const pixelsPerSecondRef = useRef(pixelsPerSecond);
  const playbackTimeRef = useRef(currentTime * 1000);
  const lastPlaybackFrameRef = useRef<number | null>(null);
  const sizeRef = useRef({ width: 800, height: height ?? 320 });
  const fpsRef = useRef({
    lastTime: performance.now(),
    frames: 0,
    value: 0,
  });
  const rafFpsRef = useRef({
    lastTime: performance.now(),
    frames: 0,
    value: 0,
  });
  const detectionsRef = useRef(detectionsPerSecond);
  const lastDrawRef = useRef(0);
  const canvasSizeRef = useRef({ width: 0, height: 0, dpr: 0 });
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const staticConfigRef = useRef({
    width: 0,
    height: 0,
    dpr: 0,
    showNoteLines: false,
  });

  useEffect(() => {
    sampleRef.current = sample;
  }, [sample]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    pixelsPerSecondRef.current = pixelsPerSecond;
  }, [pixelsPerSecond]);

  useEffect(() => {
    const nextTimeMs = currentTime * 1000;
    if (!isPlaying) {
      playbackTimeRef.current = nextTimeMs;
      lastPlaybackFrameRef.current = null;
      return;
    }
    const drift = Math.abs(nextTimeMs - playbackTimeRef.current);
    if (drift > 1000) {
      playbackTimeRef.current = nextTimeMs;
      lastPlaybackFrameRef.current = null;
    }
  }, [currentTime, isPlaying]);

  useEffect(() => {
    if (resetKey === undefined) return;
    const history = historyRef.current;
    history.data.fill(null);
    history.head = 0;
    history.count = 0;
    playbackTimeRef.current = currentTimeRef.current * 1000;
    lastPlaybackFrameRef.current = null;
  }, [resetKey]);

  useEffect(() => {
    detectionsRef.current = detectionsPerSecond;
  }, [detectionsPerSecond]);

  useEffect(() => {
    if (detectionRateHz > 0) {
      detectionRateRef.current = detectionRateHz;
    }
  }, [detectionRateHz]);

  const resizeHistoryBuffer = (capacity: number) => {
    const history = historyRef.current;
    if (capacity <= 0 || history.capacity === capacity) return;

    const nextData = new Array<PitchSample | null>(capacity).fill(null);
    const count = Math.min(history.count, capacity);

    if (history.count > 0 && history.capacity > 0 && count > 0) {
      const startIndex =
        (history.head - history.count + history.capacity) % history.capacity;
      const startOffset = Math.max(0, history.count - count);

      for (let i = 0; i < count; i += 1) {
        const sourceIndex =
          (startIndex + startOffset + i) % history.capacity;
        nextData[i] = history.data[sourceIndex];
      }
    }

    historyRef.current = {
      data: nextData,
      head: count % capacity,
      count,
      capacity,
    };
  };

  const getPlayheadX = (width: number, timeSeconds: number) => {
    if (!Number.isFinite(width) || width <= 0) return 0;
    const totalDuration = durationRef.current;
    const pps = pixelsPerSecondRef.current;
    if (!Number.isFinite(pps) || pps <= 0) return 0;

    const time = timeSeconds;
    const clampedTime =
      totalDuration > 0 ? Math.min(Math.max(time, 0), totalDuration) : Math.max(time, 0);
    const waveformWidth = Math.max(1, totalDuration * pps);
    const maxScroll = Math.max(0, waveformWidth - width);
    const targetLeft = clampedTime * pps - width / 2;
    const scrollLeft = Math.max(0, Math.min(targetLeft, maxScroll));
    const rawPlayheadLeft = clampedTime * pps - scrollLeft;
    const maxPlayheadLeft = Math.max(0, width - PLAYHEAD_WIDTH);
    return Math.max(0, Math.min(rawPlayheadLeft, maxPlayheadLeft));
  };

  useEffect(() => {
    const rate = detectionRateRef.current || 1;
    const capacity = Math.max(1, Math.ceil(rate * historyDuration));
    resizeHistoryBuffer(capacity);
  }, [historyDuration, detectionRateHz]);

  // Frame rate diagnostic for requestAnimationFrame
  useEffect(() => {
    if (!showDiagnostics) return;
    let rafId = 0;
    const tick = () => {
      const now = performance.now();
      rafFpsRef.current.frames += 1;
      const elapsed = now - rafFpsRef.current.lastTime;
      if (elapsed >= 500) {
        rafFpsRef.current.value = Math.round(
          (rafFpsRef.current.frames * 1000) / elapsed
        );
        rafFpsRef.current.frames = 0;
        rafFpsRef.current.lastTime = now;
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [showDiagnostics]);

  useEffect(() => {
    const history = historyRef.current;
    if (history.capacity === 0) {
      const rate = detectionRateRef.current || 1;
      resizeHistoryBuffer(Math.max(1, Math.ceil(rate * historyDuration)));
    }

    const now = playbackTimeRef.current;
    const nextIndex = history.head;
    const entry = history.data[nextIndex];
    if (entry) {
      entry.timestamp = now;
      entry.frequency = sample.frequency;
      entry.clarity = sample.clarity;
      entry.midi = sample.midi;
    } else {
      history.data[nextIndex] = {
        timestamp: now,
        frequency: sample.frequency,
        clarity: sample.clarity,
        midi: sample.midi,
      };
    }

    history.head = (nextIndex + 1) % history.capacity;
    history.count = Math.min(history.count + 1, history.capacity);
  }, [sample, historyDuration]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateSize = () => {
      const parent = canvas.parentElement;
      const width = parent ? parent.clientWidth : 800;
      const resolvedHeight = height ?? (parent ? parent.clientHeight : 320);
      sizeRef.current = { width, height: resolvedHeight };
    };

    updateSize();
    window.addEventListener('resize', updateSize);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      const parent = canvas.parentElement;
      if (parent) {
        observer = new ResizeObserver(() => updateSize());
        observer.observe(parent);
      }
    }

    return () => {
      window.removeEventListener('resize', updateSize);
      observer?.disconnect();
    };
  }, [height]);

  useEffect(() => {
    let rafId = 0;

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const now = performance.now();
      if (isPlayingRef.current) {
        if (lastPlaybackFrameRef.current === null) {
          lastPlaybackFrameRef.current = now;
        }
        const delta = now - lastPlaybackFrameRef.current;
        lastPlaybackFrameRef.current = now;
        playbackTimeRef.current += delta;
      } else {
        lastPlaybackFrameRef.current = null;
      }

      if (Number.isFinite(maxFps) && maxFps > 0) {
        const minFrameMs = 1000 / maxFps;
        if (now - lastDrawRef.current < minFrameMs) {
          rafId = requestAnimationFrame(draw);
          return;
        }
        lastDrawRef.current = now;
      }

      const { width, height: h } = sizeRef.current;
      const timelineNow = playbackTimeRef.current;
      const playheadTimeSeconds = isPlayingRef.current
        ? playbackTimeRef.current / 1000
        : currentTimeRef.current;
      const playheadX = getPlayheadX(width, playheadTimeSeconds);
      const dpr = window.devicePixelRatio || 1;
      const pixelWidth = Math.max(1, Math.round(width * dpr));
      const pixelHeight = Math.max(1, Math.round(h * dpr));

      if (
        canvasSizeRef.current.width !== pixelWidth ||
        canvasSizeRef.current.height !== pixelHeight ||
        canvasSizeRef.current.dpr !== dpr
      ) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${h}px`;
        canvasSizeRef.current = { width: pixelWidth, height: pixelHeight, dpr };
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, width, h);
      let staticCanvas = staticCanvasRef.current;
      if (!staticCanvas) {
        staticCanvas = document.createElement('canvas');
        staticCanvasRef.current = staticCanvas;
      }

      if (
        staticConfigRef.current.width !== pixelWidth ||
        staticConfigRef.current.height !== pixelHeight ||
        staticConfigRef.current.dpr !== dpr ||
        staticConfigRef.current.showNoteLines !== showNoteLines
      ) {
        staticCanvas.width = pixelWidth;
        staticCanvas.height = pixelHeight;
        const staticCtx = staticCanvas.getContext('2d');
        if (staticCtx) {
          staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
          staticCtx.clearRect(0, 0, width, h);
          drawStaticLayer(staticCtx, width, h, showNoteLines);
        }
        staticConfigRef.current = {
          width: pixelWidth,
          height: pixelHeight,
          dpr,
          showNoteLines,
        };
      }

      ctx.drawImage(staticCanvas, 0, 0, width, h);

      const pixelsPerMs = width / (historyDuration * 1000);
      const history = historyRef.current;
      const historyCount = history.count;
      const historyCapacity = history.capacity;
      const historyStartIndex =
        historyCount > 0 && historyCapacity > 0
          ? (history.head - historyCount + historyCapacity) % historyCapacity
          : 0;

      if (showNoteTrails && historyCount > 0 && historyCapacity > 0) {
        const minSegmentWidth = 2;

        ctx.save();
        ctx.globalAlpha = 0.28;

        for (let i = 0; i < historyCount; i += 1) {
          const s = history.data[(historyStartIndex + i) % historyCapacity];
          if (!s || s.midi == null) continue;
          if (timelineNow - s.timestamp > historyDuration * 1000) continue;

          const noteMidi = Math.round(s.midi);
          const noteIndex = midiToNoteIndex(noteMidi);
          const { rgb } = PITCH_COLOR_SHAPE_MAP[noteIndex];
          ctx.fillStyle = `rgb(${rgb})`;

          const x = playheadX - (timelineNow - s.timestamp) * pixelsPerMs;
          const next =
            i + 1 < historyCount
              ? history.data[(historyStartIndex + i + 1) % historyCapacity]
              : null;
          const hasNext =
            next != null &&
            next.midi != null &&
            timelineNow - next.timestamp <= historyDuration * 1000;
          const nextX =
            hasNext
              ? playheadX - (timelineNow - next.timestamp) * pixelsPerMs
              : x + minSegmentWidth;
          const startX = Math.min(x, nextX);
          const endX = Math.max(x, nextX);

          if (endX < 0 || startX > width) continue;

          const topY = mapMidiToY(noteMidi + 0.5, h);
          const bottomY = mapMidiToY(noteMidi - 0.5, h);
          const y = Math.min(topY, bottomY);
          const rectHeight = Math.abs(bottomY - topY);
          const rectX = Math.max(0, startX);
          const rectWidth = Math.min(width, endX) - rectX;

          if (rectWidth <= 0 || rectHeight <= 0) continue;
          ctx.fillRect(rectX, y, Math.max(minSegmentWidth, rectWidth), rectHeight);
        }

        ctx.restore();
      }

      if (isRecording && recordingStartAt != null) {
        const markerX = playheadX - (timelineNow - recordingStartAt) * pixelsPerMs;

        if (markerX >= 0 && markerX <= width) {
          ctx.save();
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2;
          ctx.globalAlpha = 0.7;
          ctx.beginPath();
          ctx.moveTo(markerX, 0);
          ctx.lineTo(markerX, h);
          ctx.stroke();
          ctx.restore();
        }
      }

      // Pitch line
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.beginPath();

      let drawing = false;
      if (historyCount > 0 && historyCapacity > 0) {
        for (let i = 0; i < historyCount; i += 1) {
          const s = history.data[(historyStartIndex + i) % historyCapacity];
          if (!s || s.midi == null) {
            drawing = false;
            continue;
          }

          if (timelineNow - s.timestamp > historyDuration * 1000) {
            drawing = false;
            continue;
          }

          const x = playheadX - (timelineNow - s.timestamp) * pixelsPerMs;
          if (x < 0) continue;

          const y = mapMidiToY(s.midi, h);

          if (!drawing) {
            ctx.moveTo(x, y);
            drawing = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
      }
      ctx.stroke();

      if (Number.isFinite(playheadX)) {
        ctx.save();
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(playheadX, 0);
        ctx.lineTo(playheadX, h);
        ctx.stroke();
        ctx.restore();
      }

      // Current point
      const current = sampleRef.current;
      if (current.midi != null) {
        const y = mapMidiToY(current.midi, h);
        const x = playheadX;

        const noteIndex = midiToNoteIndex(current.midi);
        const pitchStyle = PITCH_COLOR_SHAPE_MAP[noteIndex];
        const markerColor = colorizeMarker ? `rgb(${pitchStyle.rgb})` : '#0f172a';
        const markerShape = colorizeMarker ? pitchStyle.shape : 'circle';

        drawMarker(ctx, x, y, 7, markerShape, markerColor);

        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'right';
        const labelX = Math.max(10, playheadX - 10);
        ctx.fillText(formatNoteLabel(current.midi), labelX, y - 10);
      }

      if (showDiagnostics) {
        fpsRef.current.frames += 1;
        const fpsElapsed = now - fpsRef.current.lastTime;
        if (fpsElapsed >= 500) {
          fpsRef.current.value = Math.round(
            (fpsRef.current.frames * 1000) / fpsElapsed
          );
          fpsRef.current.frames = 0;
          fpsRef.current.lastTime = now;
        }

        ctx.save();
        ctx.fillStyle = '#0f172a';
        ctx.font = '12px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${fpsRef.current.value} FPS`, width - 8, 16);
        ctx.fillText(`${detectionsRef.current} det/s`, width - 8, 32);
        const detMs =
          detectionsRef.current > 0
            ? (1000 / detectionsRef.current).toFixed(2)
            : '0.00';
        ctx.fillText(`${detMs} ms`, width - 8, 48);
        ctx.fillText(`${rafFpsRef.current.value} rAF`, width - 8, 64);
        ctx.restore();
      }

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);

    return () => cancelAnimationFrame(rafId);
  }, [
    historyDuration,
    colorizeMarker,
    showNoteLines,
    showNoteTrails,
    isRecording,
    recordingStartAt,
    maxFps,
    showDiagnostics,
  ]);

  return (
    <div className="pitch-graph">
      <canvas ref={canvasRef} />
    </div>
  );
}

function mapMidiToY(midi: number, height: number) {
  const clamped = Math.max(LOWEST_NOTE, Math.min(HIGHEST_NOTE, midi));
  const range = HIGHEST_NOTE - LOWEST_NOTE;
  const normalized = (HIGHEST_NOTE - clamped) / range;
  return normalized * height;
}

function drawStaticLayer(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  showNoteLines: boolean
) {
  if (showNoteLines) {
    ctx.save();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.4;

    for (let midi = LOWEST_NOTE; midi <= HIGHEST_NOTE; midi += 1) {
      if (midiToNoteIndex(midi) === 0) continue;
      const y = mapMidiToY(midi, height);

      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    ctx.restore();
  }

  // Octave lines
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;

  for (let octave = 2; octave <= 8; octave++) {
    const midi = (octave + 1) * 12;
    const y = mapMidiToY(midi, height);

    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`C${octave}`, 6, y - 4);
  }
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  shape: 'square' | 'circle',
  fill: string
) {
  ctx.fillStyle = fill;

  if (shape === 'square') {
    const size = radius * 2;
    ctx.fillRect(x - radius, y - radius, size, size);
    return;
  }

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}