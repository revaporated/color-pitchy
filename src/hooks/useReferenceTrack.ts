import { useEffect, useState } from 'react';
import { PitchTrack } from '../audio/frames';
import { getReference, saveReference } from '../storage/projects';
import { PIXELS_PER_SECOND } from '../utils/waveform';
import type { PrepRequest, PrepResponse } from '../workers/trackPrep.worker';
import type { ReferenceRequest, ReferenceResponse } from '../workers/referencePitch.worker';

const REFERENCE_WINDOW_SECONDS = 0.046; // about 2048 samples at 44.1 kHz
/** Tracks longer than this get a 50 Hz reference grid instead of 100 Hz, halving the analysis. */
const LONG_TRACK_SECONDS = 600;
/** Upper bound on parallel reference workers. */
const MAX_REFERENCE_WORKERS = 4;
/**
 * Bump whenever the reference analysis changes (worker code, window sizes,
 * grid), so contours cached in the library are recomputed instead of reused.
 */
export const REFERENCE_CACHE_VERSION = 2;

/** Everything that changes the reference analysis. Edited as a draft and applied with Analyze. */
export type AnalysisSettings = {
  method: ReferenceRequest['method'];
  /** Top-voice tracker switch cost (see ReferenceRequest.smoothing). */
  smoothing: number;
  /** Analysis window in milliseconds, or 0 for automatic (~46 ms pitchy, ~93 ms top voice). */
  windowMs: number;
  minMidi: number;
  maxMidi: number;
};

export const DEFAULT_ANALYSIS: AnalysisSettings = {
  method: 'pitchy',
  smoothing: 4,
  windowMs: 0,
  minMidi: 48, // C3
  maxMidi: 96, // C7
};

export function sameAnalysis(a: AnalysisSettings, b: AnalysisSettings) {
  return (
    a.method === b.method &&
    (a.method !== 'topVoice' || a.smoothing === b.smoothing) &&
    a.windowMs === b.windowMs &&
    a.minMidi === b.minMidi &&
    a.maxMidi === b.maxMidi
  );
}

/** Cache key for a reference contour. Smoothing only affects the top-voice tracker. */
export function referenceCacheKey(audioId: string, settings: AnalysisSettings) {
  const { method, smoothing, windowMs, minMidi, maxMidi } = settings;
  const variant = method === 'topVoice' ? `topVoice:${smoothing}` : method;
  return `${audioId}|${variant}|w${windowMs}|${minMidi}-${maxMidi}|v${REFERENCE_CACHE_VERSION}`;
}

/** Samples in the analysis window: a power of two near the requested length. */
export function analysisWindowSize(settings: AnalysisSettings, sampleRate: number) {
  const seconds =
    settings.windowMs > 0
      ? settings.windowMs / 1000
      : // Top voice defaults to twice as long (~93 ms): neighbouring semitones in
        // the lower register need the finer frequency resolution to stay apart.
        REFERENCE_WINDOW_SECONDS * (settings.method === 'topVoice' ? 2 : 1);
  return 2 ** Math.round(Math.log2(Math.max(256, seconds * sampleRate)));
}

export type ReferenceState =
  /** No track, or (`needsAnalysis`) a track with nothing cached for these settings yet. */
  | { status: 'idle'; track: null; progress: 0; needsAnalysis?: boolean }
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
export function useTrackAnalysis(
  audioBuffer: AudioBuffer | null,
  settings: AnalysisSettings,
  /**
   * Library id of the audio. When set, the contour is read from and written to
   * the library's cache, so reopening a project skips the analysis.
   */
  audioId: string | null = null,
  /**
   * 0: only show a cached contour; with nothing cached, wait (status idle,
   * needsAnalysis). Any higher value allows computing, and changing it re-runs
   * the analysis (clear the cache first to force a recompute).
   */
  runToken = 0,
): TrackAnalysis {
  const { method, smoothing, windowMs, minMidi, maxMidi } = settings;
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [reference, setReference] = useState<ReferenceState>(IDLE);

  useEffect(() => {
    setPeaks(null);
    if (!audioBuffer) {
      setReference(IDLE);
      return;
    }
    setReference(
      runToken > 0
        ? { status: 'analyzing', track: null, progress: 0 }
        : IDLE, // until the cache answers
    );

    let cancelled = false;
    const workers: Worker[] = [];
    const stopAll = () => workers.forEach((worker) => worker.terminate());
    const fail = (message: string) => {
      if (cancelled) return;
      cancelled = true;
      stopAll();
      setReference({ status: 'error', track: null, progress: 0, message });
    };

    const analysis: AnalysisSettings = { method, smoothing, windowMs, minMidi, maxMidi };
    const cacheKey = audioId ? referenceCacheKey(audioId, analysis) : null;
    const cached: Promise<PitchTrack | null> = cacheKey
      ? getReference(cacheKey)
          .then((record) =>
            record ? PitchTrack.fromArrays(record.frequency, record.clarity, record.gridHz) : null,
          )
          .catch(() => null)
      : Promise.resolve(null);
    // A cached contour is shown straight away, before the peaks are even ready.
    void cached.then((track) => {
      if (!cancelled && track) setReference({ status: 'ready', track, progress: 1 });
    });

    const runReference = (samples: Float32Array, sampleRate: number) => {
      setReference({ status: 'analyzing', track: null, progress: 0 });
      const duration = samples.length / sampleRate;
      const gridHz = duration > LONG_TRACK_SECONDS ? 50 : 100;
      const windowSize = analysisWindowSize(analysis, sampleRate);
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
              if (cacheKey && audioId) {
                void saveReference({ key: cacheKey, audioId, gridHz, frequency, clarity }).catch(
                  () => undefined,
                );
              }
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
          method,
          smoothing,
          minMidi,
          maxMidi,
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
        const { samples, sampleRate } = message;
        void cached.then((track) => {
          if (cancelled || track) return;
          if (runToken > 0) runReference(samples, sampleRate);
          else setReference({ status: 'idle', track: null, progress: 0, needsAnalysis: true });
        });
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
  }, [audioBuffer, method, smoothing, windowMs, minMidi, maxMidi, audioId, runToken]);

  return { peaks, reference };
}
