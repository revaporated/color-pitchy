import { useEffect, useRef } from 'react';
import type { PitchSample } from '../hooks/usePitchDetector';
import { formatNoteLabel, midiToNoteIndex, PITCH_COLOR_SHAPE_MAP } from '../utils/pitch';

const LOWEST_NOTE = 36; // C2
const HIGHEST_NOTE = 96; // C8

type Props = {
  sample: PitchSample;
  historyDuration: number; // seconds
  colorizeMarker: boolean;
  showNoteLines: boolean;
  height?: number;
};

export function PitchGraph({
  sample,
  historyDuration,
  colorizeMarker,
  showNoteLines,
  height,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<PitchSample[]>([]);
  const sampleRef = useRef<PitchSample>(sample);
  const sizeRef = useRef({ width: 800, height: height ?? 320 });

  useEffect(() => {
    sampleRef.current = sample;
  }, [sample]);

  useEffect(() => {
    const now = sample.timestamp || performance.now();
    historyRef.current = [...historyRef.current, { ...sample, timestamp: now }];

    const cutoff = now - historyDuration * 1000;
    historyRef.current = historyRef.current.filter((s) => s.timestamp >= cutoff);
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

      const { width, height: h } = sizeRef.current;
      const dpr = window.devicePixelRatio || 1;

      canvas.width = width * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, width, h);

      if (showNoteLines) {
        ctx.save();
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.4;

        for (let midi = LOWEST_NOTE; midi <= HIGHEST_NOTE; midi += 1) {
          if (midiToNoteIndex(midi) === 0) continue;
          const y = mapMidiToY(midi, h);

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
        const y = mapMidiToY(midi, h);

        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();

        ctx.fillStyle = '#64748b';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`C${octave}`, 6, y - 4);
      }

      const now = performance.now();
      const pixelsPerMs = width / (historyDuration * 1000);

      // Pitch line
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.beginPath();

      let drawing = false;
      for (const s of historyRef.current) {
        if (s.midi == null) {
          drawing = false;
          continue;
        }

        const x = width - (now - s.timestamp) * pixelsPerMs;
        if (x < 0) continue;

        const y = mapMidiToY(s.midi, h);

        if (!drawing) {
          ctx.moveTo(x, y);
          drawing = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      // Current point
      const current = sampleRef.current;
      if (current.midi != null) {
        const y = mapMidiToY(current.midi, h);
        const x = width - 2;

        const noteIndex = midiToNoteIndex(current.midi);
        const pitchStyle = PITCH_COLOR_SHAPE_MAP[noteIndex];
        const markerColor = colorizeMarker ? `rgb(${pitchStyle.rgb})` : '#0f172a';
        const markerShape = colorizeMarker ? pitchStyle.shape : 'circle';

        drawMarker(ctx, x, y, 5, markerShape, markerColor);

        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(formatNoteLabel(current.midi), width - 10, y - 10);
      }

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);

    return () => cancelAnimationFrame(rafId);
  }, [historyDuration, colorizeMarker, showNoteLines]);

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