import { useEffect, useState } from 'react';
import type { SpectrogramData } from '../audio/spectrogramImage';
import type { SpectrogramRequest, SpectrogramResponse } from '../workers/spectrogram.worker';
import type { MonoTrack } from './useReferenceTrack';

/** C1 to C8, enough for any display range the graph offers. */
const MIN_MIDI = 24;
const MAX_MIDI = 108;
/** ~93 ms: long enough to separate neighbouring low semitones. */
const WINDOW_SECONDS = 0.093;
const MAX_WORKERS = 4;

export type SpectrogramState =
  | { status: 'idle'; data: null; progress: 0 }
  | { status: 'computing'; data: null; progress: number }
  | { status: 'ready'; data: SpectrogramData; progress: 1 }
  | { status: 'error'; data: null; progress: 0; message: string };

const IDLE: SpectrogramState = { status: 'idle', data: null, progress: 0 };

/**
 * Computes the track's per-semitone spectrogram in workers, once per track,
 * the first time it's enabled. Turning it off keeps the result.
 */
export function useSpectrogram(mono: MonoTrack | null, enabled: boolean): SpectrogramState {
  const [result, setResult] = useState<{ mono: MonoTrack; state: SpectrogramState } | null>(null);
  const current = result && result.mono === mono ? result.state : IDLE;
  // True while computing too, so the effect (and its workers) stays put until done.
  const needed = enabled && mono !== null && current.status !== 'ready' && current.status !== 'error';

  useEffect(() => {
    if (!needed || !mono) return;
    const { samples, sampleRate } = mono;
    const duration = samples.length / sampleRate;
    const gridHz = duration > 600 ? 25 : 50;
    const windowSize = 2 ** Math.round(Math.log2(WINDOW_SECONDS * sampleRate));
    const halfWindow = windowSize / 2;
    const frames = Math.max(1, Math.ceil(duration * gridHz) + 1);
    const notes = MAX_MIDI - MIN_MIDI + 1;
    const raw = new Float32Array(frames * notes);
    const harmonic = new Float32Array(frames * notes);

    const cores = navigator.hardwareConcurrency || 2;
    const parts = Math.min(Math.max(1, Math.min(MAX_WORKERS, cores - 1)), frames);
    const progress = new Float64Array(parts);
    const workers: Worker[] = [];
    let remaining = parts;
    let cancelled = false;
    const set = (state: SpectrogramState) => {
      if (!cancelled) setResult({ mono, state });
    };
    const fail = (message: string) => {
      workers.forEach((worker) => worker.terminate());
      set({ status: 'error', data: null, progress: 0, message });
      cancelled = true;
    };
    set({ status: 'computing', data: null, progress: 0 });

    for (let part = 0; part < parts; part += 1) {
      const binStart = Math.floor((frames * part) / parts);
      const binEnd = Math.floor((frames * (part + 1)) / parts);
      const sampleStart = Math.max(0, Math.round((binStart / gridHz) * sampleRate) - halfWindow);
      const sampleEnd = Math.min(samples.length, Math.round(((binEnd - 1) / gridHz) * sampleRate) + halfWindow);
      const slice = samples.slice(sampleStart, Math.max(sampleStart, sampleEnd));
      const worker = new Worker(new URL('../workers/spectrogram.worker.ts', import.meta.url), { type: 'module' });
      workers.push(worker);
      worker.onmessage = (event: MessageEvent<SpectrogramResponse>) => {
        if (cancelled) return;
        const message = event.data;
        if (message.type === 'progress') {
          progress[part] = message.progress;
          set({ status: 'computing', data: null, progress: progress.reduce((a, b) => a + b, 0) / parts });
        } else if (message.type === 'result') {
          raw.set(message.raw, binStart * notes);
          harmonic.set(message.harmonic, binStart * notes);
          worker.terminate();
          remaining -= 1;
          if (remaining === 0) {
            set({
              status: 'ready',
              data: { raw, harmonic, frames, gridHz, minMidi: MIN_MIDI, maxMidi: MAX_MIDI },
              progress: 1,
            });
          }
        } else {
          fail(message.message);
        }
      };
      worker.onerror = (event) => fail(event.message || 'Spectrogram failed.');
      const request: SpectrogramRequest = {
        samples: slice,
        sampleOffset: sampleStart,
        sampleRate,
        gridHz,
        windowSize,
        binStart,
        binEnd,
        minMidi: MIN_MIDI,
        maxMidi: MAX_MIDI,
      };
      worker.postMessage(request, [slice.buffer]);
    }

    return () => {
      cancelled = true;
      workers.forEach((worker) => worker.terminate());
      // Unfinished (turned off mid-way): forget it so it starts again next time.
      setResult((previous) =>
        previous && (previous.state.status === 'ready' || previous.state.status === 'error') ? previous : null,
      );
    };
  }, [needed, mono]);

  return current;
}
