import { useEffect, useState } from 'react';
import { PitchTrack } from '../audio/frames';
import { PIXELS_PER_SECOND } from '../utils/waveform';
import type { PrepRequest, PrepResponse } from '../workers/trackPrep.worker';
import type { ReferenceRequest, ReferenceResponse } from '../workers/referencePitch.worker';

const REFERENCE_WINDOW_SECONDS = 0.046; // about 2048 samples at 44.1 kHz
/** Tracks longer than this get a 50 Hz reference grid instead of 100 Hz, halving the analysis. */
const LONG_TRACK_SECONDS = 600;
/** Upper bound on parallel reference workers. */
const MAX_REFERENCE_WORKERS = 4;

export type ReferenceState =
  | { status: 'idle'; track: null; progress: 0 }
  | { status: 'analyzing'; track: null; progress: number }
  | { status: 'ready'; track: PitchTrack; progress: 1 }
  | { status: 'error'; track: null; progress: 0; message: string };

export type TrackAnalysis = {
  /** Waveform peaks, one per pixel at PIXELS_PER_SECOND. Null until computed. */
  peaks: Float32Array | null;
  reference: ReferenceState;
};

const IDLE: ReferenceState = { status: 'idle', track: null, progress: 0 };

function referenceWorkerCount() {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  // Leave a core for the main thread and the audio thread.
  return Math.max(1, Math.min(MAX_REFERENCE_WORKERS, cores - 1));
}

/**
 * All load-time analysis of a decoded track, off the main thread:
 * 1. a prep worker computes waveform peaks and the mono downmix;
 * 2. the downmix is split across several workers that run pitchy over their
 *    part of the track, and the parts are stitched into one reference contour.
 * The main thread only copies the channel data out of the AudioBuffer.
 */
export function useTrackAnalysis(audioBuffer: AudioBuffer | null): TrackAnalysis {
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [reference, setReference] = useState<ReferenceState>(IDLE);

  useEffect(() => {
    setPeaks(null);
    if (!audioBuffer) {
      setReference(IDLE);
      return;
    }
    setReference({ status: 'analyzing', track: null, progress: 0 });

    let cancelled = false;
    const workers: Worker[] = [];
    const stopAll = () => workers.forEach((worker) => worker.terminate());
    const fail = (message: string) => {
      if (cancelled) return;
      cancelled = true;
      stopAll();
      setReference({ status: 'error', track: null, progress: 0, message });
    };

    const runReference = (samples: Float32Array, sampleRate: number) => {
      const duration = samples.length / sampleRate;
      const gridHz = duration > LONG_TRACK_SECONDS ? 50 : 100;
      const windowSize = 2 ** Math.round(Math.log2(Math.max(256, REFERENCE_WINDOW_SECONDS * sampleRate)));
      const halfWindow = windowSize / 2;
      const bins = Math.max(1, Math.ceil(duration * gridHz) + 1);
      const frequency = new Float32Array(bins);
      const clarity = new Float32Array(bins);

      const parts = Math.min(referenceWorkerCount(), bins);
      const progress = new Float64Array(parts);
      let remaining = parts;

      for (let part = 0; part < parts; part += 1) {
        const binStart = Math.floor((bins * part) / parts);
        const binEnd = Math.floor((bins * (part + 1)) / parts);
        // Same window placement as the worker uses, so the slice covers every window.
        const sampleStart = Math.max(0, Math.round((binStart / gridHz) * sampleRate) - halfWindow);
        const sampleEnd = Math.min(
          samples.length,
          Math.round(((binEnd - 1) / gridHz) * sampleRate) - halfWindow + windowSize,
        );
        const slice = samples.slice(sampleStart, Math.max(sampleStart, sampleEnd));

        const worker = new Worker(new URL('../workers/referencePitch.worker.ts', import.meta.url), {
          type: 'module',
        });
        workers.push(worker);
        worker.onmessage = (event: MessageEvent<ReferenceResponse>) => {
          if (cancelled) return;
          const message = event.data;
          if (message.type === 'progress') {
            progress[part] = message.progress;
            let sum = 0;
            for (let i = 0; i < parts; i += 1) sum += progress[i];
            setReference({ status: 'analyzing', track: null, progress: sum / parts });
          } else if (message.type === 'result') {
            frequency.set(message.frequency, binStart);
            clarity.set(message.clarity, binStart);
            worker.terminate();
            remaining -= 1;
            if (remaining === 0) {
              setReference({
                status: 'ready',
                track: PitchTrack.fromArrays(frequency, clarity, gridHz),
                progress: 1,
              });
            }
          } else {
            fail(message.message);
          }
        };
        worker.onerror = (event) => fail(event.message || 'Reference analysis failed.');

        const request: ReferenceRequest = {
          samples: slice,
          sampleOffset: sampleStart,
          sampleRate,
          gridHz,
          windowSize,
          binStart,
          binEnd,
        };
        worker.postMessage(request, [slice.buffer]);
      }
    };

    const prep = new Worker(new URL('../workers/trackPrep.worker.ts', import.meta.url), { type: 'module' });
    workers.push(prep);
    prep.onmessage = (event: MessageEvent<PrepResponse>) => {
      if (cancelled) return;
      const message = event.data;
      if (message.type === 'peaks') {
        setPeaks(message.peaks);
      } else if (message.type === 'mono') {
        prep.terminate();
        runReference(message.samples, message.sampleRate);
      } else {
        fail(message.message);
      }
    };
    prep.onerror = (event) => fail(event.message || 'Track analysis failed.');

    // Copies, because the AudioBuffer keeps its own data and transferring would detach it.
    const channels: Float32Array[] = [];
    for (let c = 0; c < audioBuffer.numberOfChannels; c += 1) channels.push(audioBuffer.getChannelData(c).slice());
    const request: PrepRequest = {
      channels,
      sampleRate: audioBuffer.sampleRate,
      pixelsPerSecond: PIXELS_PER_SECOND,
    };
    prep.postMessage(
      request,
      channels.map((channel) => channel.buffer),
    );

    return () => {
      cancelled = true;
      stopAll();
    };
  }, [audioBuffer]);

  return { peaks, reference };
}
