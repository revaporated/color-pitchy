import { PitchDetector } from 'pitchy';

export type ReferenceRequest = {
  id: number;
  samples: Float32Array; // mono
  sampleRate: number;
  gridHz: number;
  windowSeconds: number;
};

export type ReferenceResponse =
  | { type: 'progress'; id: number; progress: number }
  | { type: 'result'; id: number; frequency: Float32Array; clarity: Float32Array; gridHz: number }
  | { type: 'error'; id: number; message: string };

// `self` is typed as Window under the DOM lib; describe the worker scope we use.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ReferenceRequest>) => void) | null;
  postMessage(message: ReferenceResponse, transfer?: Transferable[]): void;
};

scope.onmessage = (event) => {
  const { id } = event.data;
  try {
    analyze(event.data);
  } catch (err) {
    scope.postMessage({ type: 'error', id, message: String(err) });
  }
};

/**
 * Offline pitch contour of a whole track: one pitchy window centered on each
 * grid bin. Audio at 32 kHz or above is decimated 2x first, which halves the
 * work and still covers the vocal and most instrumental range.
 */
function analyze({ id, samples, sampleRate, gridHz, windowSeconds }: ReferenceRequest) {
  let data = samples;
  let rate = sampleRate;
  if (rate >= 32000) {
    const half = new Float32Array(Math.floor(data.length / 2));
    for (let i = 0; i < half.length; i += 1) half[i] = (data[2 * i] + data[2 * i + 1]) * 0.5;
    data = half;
    rate /= 2;
  }

  const windowSize = 2 ** Math.round(Math.log2(Math.max(256, windowSeconds * rate)));
  const detector = PitchDetector.forFloat32Array(windowSize);
  detector.minVolumeDecibels = -50; // treat near-silence as unvoiced
  const window = new Float32Array(windowSize);

  const duration = data.length / rate;
  const bins = Math.max(1, Math.ceil(duration * gridHz) + 1);
  const frequency = new Float32Array(bins);
  const clarity = new Float32Array(bins);
  const halfWindow = windowSize / 2;

  for (let b = 0; b < bins; b += 1) {
    const start = Math.round((b / gridHz) * rate) - halfWindow;
    if (start >= 0 && start + windowSize <= data.length) {
      window.set(data.subarray(start, start + windowSize));
    } else {
      window.fill(0);
      for (let i = 0; i < windowSize; i += 1) {
        const index = start + i;
        if (index >= 0 && index < data.length) window[i] = data[index];
      }
    }

    const [f, c] = detector.findPitch(window, rate);
    frequency[b] = Number.isFinite(f) && f > 0 ? f : 0;
    clarity[b] = Number.isFinite(c) ? c : 0;

    if (b % 500 === 0) scope.postMessage({ type: 'progress', id, progress: b / bins });
  }

  scope.postMessage({ type: 'result', id, frequency, clarity, gridHz }, [
    frequency.buffer,
    clarity.buffer,
  ]);
}
