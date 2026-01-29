import { useEffect, useRef, useState } from 'react';
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

const DETECTION_RATE_HZ = 165; // Main control for pitch detection rate

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
  const [detectionsPerSecond, setDetectionsPerSecond] = useState(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const outputGainRef = useRef<GainNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timeOffsetRef = useRef(0);
  const detectionStatsRef = useRef({ lastTime: performance.now(), count: 0 });

  const cleanup = () => {
    if (workletNodeRef.current) {
      workletNodeRef.current.port.onmessage = null;
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (outputGainRef.current) {
      outputGainRef.current.disconnect();
      outputGainRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    setSample({
      timestamp: performance.now(),
      frequency: null,
      clarity: null,
      midi: null,
    });
    setDetectionsPerSecond(0);
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

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = audioContext.createMediaStreamSource(stream);

        audioContextRef.current = audioContext;
        streamRef.current = stream;

        const workletUrl = new URL(
          '../worklets/pitch-detector.worklet.ts',
          import.meta.url
        );
        await audioContext.audioWorklet.addModule(workletUrl);

        const workletNode = new AudioWorkletNode(
          audioContext,
          'pitch-detector-processor',
          {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            processorOptions: {
              fftSize,
              detectionRateHz: DETECTION_RATE_HZ,
            },
          }
        );
        const outputGain = audioContext.createGain();
        outputGain.gain.value = 0;

        source.connect(workletNode);
        workletNode.connect(outputGain).connect(audioContext.destination);

        workletNodeRef.current = workletNode;
        outputGainRef.current = outputGain;
        timeOffsetRef.current =
          performance.now() - audioContext.currentTime * 1000;
        detectionStatsRef.current = {
          lastTime: performance.now(),
          count: 0,
        };

        workletNode.port.onmessage = (event) => {
          const { frequency, clarity, audioTime } = event.data ?? {};
          const now = performance.now();
          detectionStatsRef.current.count += 1;

          const elapsed = now - detectionStatsRef.current.lastTime;
          if (elapsed >= 500) {
            const rate = Math.round(
              (detectionStatsRef.current.count * 1000) / elapsed
            );
            setDetectionsPerSecond(rate);
            detectionStatsRef.current.count = 0;
            detectionStatsRef.current.lastTime = now;
          }

          const hasPitch =
            Number.isFinite(frequency) &&
            frequency > 0 &&
            clarity != null &&
            clarity >= clarityThreshold;

          const midi = hasPitch ? frequencyToMidi(frequency) : null;
          const timestamp =
            typeof audioTime === 'number'
              ? timeOffsetRef.current + audioTime * 1000
              : now;

          if (!cancelled) {
            setSample({
              timestamp,
              frequency: hasPitch ? frequency : null,
              clarity: clarity ?? null,
              midi,
            });
          }
        };

        setError(null);
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

  return { sample, error, detectionsPerSecond };
}