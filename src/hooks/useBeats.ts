import { useEffect, useState } from 'react';
import type { BeatRequest, BeatResponse } from '../workers/beats.worker';
import type { MonoTrack } from './useReferenceTrack';

export type BeatState =
  | { status: 'idle' | 'detecting'; beats: null; bpm: 0 }
  | { status: 'ready'; beats: Float64Array; bpm: number }
  | { status: 'error'; beats: null; bpm: 0; message: string };

const IDLE: BeatState = { status: 'idle', beats: null, bpm: 0 };
const DETECTING: BeatState = { status: 'detecting', beats: null, bpm: 0 };

/** Detects the track's beats in a worker, once per track (about a second for a few minutes of audio). */
export function useBeats(mono: MonoTrack | null): BeatState {
  const [result, setResult] = useState<{ mono: MonoTrack; state: BeatState } | null>(null);

  useEffect(() => {
    if (!mono) return;
    let cancelled = false;
    const worker = new Worker(new URL('../workers/beats.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<BeatResponse>) => {
      if (cancelled) return;
      const message = event.data;
      setResult({
        mono,
        state:
          message.type === 'result'
            ? { status: 'ready', beats: message.beats, bpm: message.bpm }
            : { status: 'error', beats: null, bpm: 0, message: message.message },
      });
      worker.terminate();
    };
    worker.onerror = (event) => {
      if (cancelled) return;
      setResult({ mono, state: { status: 'error', beats: null, bpm: 0, message: event.message || 'Beat detection failed.' } });
      worker.terminate();
    };
    // A copy: the mono track is still used by the spectrogram.
    const samples = mono.samples.slice();
    const request: BeatRequest = { samples, sampleRate: mono.sampleRate };
    worker.postMessage(request, [samples.buffer]);
    return () => {
      cancelled = true;
      worker.terminate();
    };
  }, [mono]);

  if (!mono) return IDLE;
  return result && result.mono === mono ? result.state : DETECTING;
}
