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
  /** 'pitchy': one pitch per window. 'topVoice': harmonic salience, highest strong note (for polyphony). */
  method: 'pitchy' | 'topVoice';
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

/** One window centered on each grid bin. */
function analyze({ samples, sampleOffset, sampleRate, gridHz, windowSize, binStart, binEnd, method }: ReferenceRequest) {
  const topVoice = method === 'topVoice' ? new TopVoice(windowSize * 2, sampleRate) : null;
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

    const [f, c] = topVoice ? topVoice.find(window) : detector.findPitch(window, sampleRate);
    frequency[i] = Number.isFinite(f) && f > 0 ? f : 0;
    clarity[i] = Number.isFinite(c) ? c : 0;

    if (i % 500 === 0) scope.postMessage({ type: 'progress', progress: i / bins });
  }

  scope.postMessage({ type: 'result', frequency, clarity }, [frequency.buffer, clarity.buffer]);
}

const MIN_MIDI = 48; // C3
const MAX_MIDI = 96; // C7
const HARMONICS = 8;

/**
 * Polyphonic melody guess without ML: score every semitone by the energy at
 * its harmonics (harmonic summation), then take the HIGHEST note that is a
 * local peak and at least half as strong as the strongest one, since the
 * melody is usually the top voice. A note is skipped if the note an octave
 * below scores higher, which is the usual octave-error signature.
 */
class TopVoice {
  private readonly size: number;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly hann: Float64Array;
  private readonly mag: Float64Array;
  private readonly salience = new Float64Array(MAX_MIDI + 1);
  private readonly sampleRate: number;

  constructor(size: number, sampleRate: number) {
    this.size = size;
    this.sampleRate = sampleRate;
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
    this.mag = new Float64Array(size / 2);
    this.hann = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i += 1) this.hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size / 2 - 1));
  }

  find(window: Float32Array): [number, number] {
    const n = this.size;
    const half = n / 2;
    let energy = 0;
    for (let i = 0; i < n; i += 1) {
      // Hann-windowed input, zero-padded 2x for finer frequency bins.
      this.re[i] = i < half ? window[i] * this.hann[i] : 0;
      this.im[i] = 0;
      energy += i < half ? window[i] * window[i] : 0;
    }
    if (Math.sqrt(energy / half) < 0.003) return [0, 0]; // silence
    fft(this.re, this.im);
    for (let k = 0; k < half; k += 1) this.mag[k] = Math.sqrt(Math.hypot(this.re[k], this.im[k])); // compressed

    const binHz = this.sampleRate / n;
    let max = 0;
    for (let m = MIN_MIDI; m <= MAX_MIDI; m += 1) {
      const f0 = 440 * 2 ** ((m - 69) / 12);
      let sum = 0;
      for (let h = 1; h <= HARMONICS; h += 1) {
        const k = Math.round((f0 * h) / binHz);
        if (k + 1 >= half) break;
        sum += 0.8 ** (h - 1) * Math.max(this.mag[k - 1], this.mag[k], this.mag[k + 1]);
      }
      this.salience[m] = sum;
      if (sum > max) max = sum;
    }
    if (max <= 0) return [0, 0];

    for (let m = MAX_MIDI - 1; m > MIN_MIDI; m -= 1) {
      const s = this.salience[m];
      if (s < 0.5 * max || s < this.salience[m - 1] || s < this.salience[m + 1]) continue;
      if (m - 12 >= MIN_MIDI && this.salience[m - 12] > s) continue;
      return [440 * 2 ** ((m - 69) / 12), s / max];
    }
    return [0, 0];
  }
}

/** In-place iterative radix-2 FFT. `re.length` must be a power of two. */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j += 1) {
        const a = i + j;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}
