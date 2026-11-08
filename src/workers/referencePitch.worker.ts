import { PitchDetector } from 'pitchy';

/**
 * One slice of the reference analysis. The track is split across several of
 * these workers; each gets only the samples its bins need (plus half a window
 * either side) and returns the contour for bins [binStart, binEnd).
 */
export type ReferenceRequest = {
  samples: Float32Array; // mono slice, already decimated
  sampleOffset: number; // index of samples[0] in the whole track
  sampleRate: number;
  gridHz: number;
  windowSize: number;
  binStart: number;
  binEnd: number;
};

export type ReferenceResponse =
  | { type: 'progress'; progress: number }
  | { type: 'result'; frequency: Float32Array; clarity: Float32Array }
  | { type: 'error'; message: string };

// `self` is typed as Window under the DOM lib; describe the worker scope we use.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ReferenceRequest>) => void) | null;
  postMessage(message: ReferenceResponse, transfer?: Transferable[]): void;
};

scope.onmessage = (event) => {
  try {
    analyze(event.data);
  } catch (err) {
    scope.postMessage({ type: 'error', message: String(err) });
  }
};

/** One pitchy window centered on each grid bin. */
function analyze({ samples, sampleOffset, sampleRate, gridHz, windowSize, binStart, binEnd }: ReferenceRequest) {
  const detector = PitchDetector.forFloat32Array(windowSize);
  detector.minVolumeDecibels = -50; // treat near-silence as unvoiced
  const window = new Float32Array(windowSize);
  const halfWindow = windowSize / 2;

  const bins = Math.max(0, binEnd - binStart);
  const frequency = new Float32Array(bins);
  const clarity = new Float32Array(bins);

  for (let i = 0; i < bins; i += 1) {
    const b = binStart + i;
    const start = Math.round((b / gridHz) * sampleRate) - halfWindow - sampleOffset;
    if (start >= 0 && start + windowSize <= samples.length) {
      window.set(samples.subarray(start, start + windowSize));
    } else {
      // Only happens at the very start or end of the track: pad with silence.
      window.fill(0);
      for (let j = 0; j < windowSize; j += 1) {
        const index = start + j;
        if (index >= 0 && index < samples.length) window[j] = samples[index];
      }
    }

    const [f, c] = detector.findPitch(window, sampleRate);
    frequency[i] = Number.isFinite(f) && f > 0 ? f : 0;
    clarity[i] = Number.isFinite(c) ? c : 0;

    if (i % 500 === 0) scope.postMessage({ type: 'progress', progress: i / bins });
  }

  scope.postMessage({ type: 'result', frequency, clarity }, [frequency.buffer, clarity.buffer]);
}
