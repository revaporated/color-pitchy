import { useEffect, useState } from 'react';
import { PitchEngine, type EngineStatus } from '../audio/pitchEngine';
import { frameToMidi, type DetectionFilter, type PitchSample } from '../utils/pitch';

export const DETECTION_RATE_HZ = 165;

type Options = {
  /** Mic open. */
  armed: boolean;
  fftSize: number;
  /** Detection running. False keeps the mic open but pauses analysis. */
  active?: boolean;
};

export function usePitchEngine({ armed, fftSize, active = true }: Options) {
  const [engine] = useState(() => new PitchEngine({ fftSize, detectionRateHz: DETECTION_RATE_HZ }));
  const [status, setStatus] = useState<EngineStatus>(engine.status);

  useEffect(() => engine.onStatusChange(() => setStatus(engine.status)), [engine]);

  useEffect(() => {
    if (!armed) return;
    void engine.start();
    return () => engine.stop();
  }, [armed, engine]);

  useEffect(() => engine.setFftSize(fftSize), [engine, fftSize]);
  useEffect(() => engine.setActive(active), [engine, active]);

  return { engine, status, error: status === 'error' ? engine.error : null };
}

const EMPTY_SAMPLE: PitchSample = { timestamp: 0, frequency: null, clarity: null, midi: null };

/**
 * Low-rate snapshot of the latest frame for text readouts. Updates React state
 * about a dozen times a second instead of on every detection.
 */
export function useEngineStats(engine: PitchEngine, filter: DetectionFilter, hz = 12) {
  const [sample, setSample] = useState<PitchSample>(EMPTY_SAMPLE);
  const [detectionsPerSecond, setDetectionsPerSecond] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      const frame = engine.latest;
      const fresh = frame !== null && performance.now() / 1000 - frame.time < 0.3;
      const next: PitchSample = fresh
        ? {
            timestamp: frame.time * 1000,
            frequency:
              frame.frequency > 0 && frame.clarity >= filter.clarityThreshold ? frame.frequency : null,
            clarity: frame.clarity,
            midi: frameToMidi(frame.frequency, frame.clarity, filter),
          }
        : EMPTY_SAMPLE;
      setSample((prev) =>
        prev.frequency === next.frequency && prev.clarity === next.clarity && prev.midi === next.midi
          ? prev
          : next,
      );
      setDetectionsPerSecond(engine.detectionsPerSecond);
    }, 1000 / hz);
    return () => window.clearInterval(id);
  }, [engine, filter, hz]);

  return { sample, detectionsPerSecond };
}
