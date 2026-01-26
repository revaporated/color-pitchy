import { useEffect, useRef, useState } from 'react';
import { PitchDetector } from 'pitchy';
import { frequencyToMidi } from '../utils/pitch';

export type PitchSample = {
  timestamp: number;
  frequency: number | null;
  clarity: number | null;
  midi: number | null;
};

type Options = {
  enabled: boolean;
  clarityThreshold: number; // 0.0 to 1.0
  fftSize?: number;
};

export function usePitchDetector({
  enabled,
  clarityThreshold,
  fftSize = 2048,
}: Options) {
  const [sample, setSample] = useState<PitchSample>({
    timestamp: 0,
    frequency: null,
    clarity: null,
    midi: null,
  });
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const cleanup = () => {
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    analyserRef.current = null;

    setSample({
      timestamp: performance.now(),
      frequency: null,
      clarity: null,
      midi: null,
    });
  };

  useEffect(() => {
    if (!enabled) {
      cleanup();
      return;
    }

    let cancelled = false;

    const setup = async () => {
      try {
        const AudioContextClass =
          window.AudioContext || (window as any).webkitAudioContext;
        const audioContext = new AudioContextClass();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = fftSize;
        analyser.smoothingTimeConstant = 0;

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        audioContextRef.current = audioContext;
        analyserRef.current = analyser;
        streamRef.current = stream;

        const detector = PitchDetector.forFloat32Array(analyser.fftSize);
        const input = new Float32Array(detector.inputLength);

        const tick = () => {
          if (!analyserRef.current || !audioContextRef.current) return;

          analyserRef.current.getFloatTimeDomainData(input);
          const [frequency, clarity] = detector.findPitch(
            input,
            audioContextRef.current.sampleRate
          );

          const hasPitch =
            Number.isFinite(frequency) &&
            frequency > 0 &&
            clarity != null &&
            clarity >= clarityThreshold;

          const midi = hasPitch ? frequencyToMidi(frequency) : null;

          if (!cancelled) {
            setSample({
              timestamp: performance.now(),
              frequency: hasPitch ? frequency : null,
              clarity: clarity ?? null,
              midi,
            });
            rafIdRef.current = requestAnimationFrame(tick);
          }
        };

        setError(null);
        tick();
      } catch (err) {
        console.error(err);
        setError('Microphone access failed.');
      }
    };

    setup();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [enabled, clarityThreshold, fftSize]);

  return { sample, error };
}