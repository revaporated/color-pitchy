import { fft } from '../audio/fft';

/**
 * One slice of the spectrogram. Like the reference analysis, the track is
 * split across several workers; each returns frames [binStart, binEnd).
 */
export type SpectrogramRequest = {
  samples: Float32Array; // mono slice
  sampleOffset: number; // index of samples[0] in the whole track
  sampleRate: number;
  gridHz: number;
  windowSize: number; // power of two
  binStart: number;
  binEnd: number;
  minMidi: number;
  maxMidi: number;
};

/**
 * Per frame, one value per semitone (minMidi first):
 * - raw: strongest FFT magnitude within the semitone's band;
 * - harmonic: weighted sum over the note's first harmonics (compressed
 *   magnitudes), scaled by how much of that is at the fundamental itself.
 *   The sum lights up notes rather than their overtones; the scaling stops
 *   it also lighting the octaves below, whose "harmonics" are a real note's.
 */
export type SpectrogramResponse =
  | { type: 'progress'; progress: number }
  | { type: 'result'; raw: Float32Array; harmonic: Float32Array }
  | { type: 'error'; message: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SpectrogramRequest>) => void) | null;
  postMessage(message: SpectrogramResponse, transfer?: Transferable[]): void;
};

const HARMONICS = 6;

scope.onmessage = (event) => {
  try {
    run(event.data);
  } catch (err) {
    scope.postMessage({ type: 'error', message: String(err) });
  }
};

function run({ samples, sampleOffset, sampleRate, gridHz, windowSize, binStart, binEnd, minMidi, maxMidi }: SpectrogramRequest) {
  const notes = maxMidi - minMidi + 1;
  const n = windowSize * 2; // zero-padded 2x for finer bins
  const half = n / 2;
  const binHz = sampleRate / n;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const mag = new Float64Array(half);
  const soft = new Float64Array(half);
  const hann = new Float64Array(windowSize);
  for (let i = 0; i < windowSize; i += 1) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (windowSize - 1));

  // Each semitone's band [lo, hi] in FFT bins, at least the nearest bin.
  const bandLo = new Int32Array(notes);
  const bandHi = new Int32Array(notes);
  const f0 = new Float64Array(notes);
  for (let k = 0; k < notes; k += 1) {
    const m = minMidi + k;
    f0[k] = 440 * 2 ** ((m - 69) / 12);
    const lo = Math.ceil((440 * 2 ** ((m - 0.5 - 69) / 12)) / binHz);
    const hi = Math.floor((440 * 2 ** ((m + 0.5 - 69) / 12)) / binHz);
    const center = Math.round(f0[k] / binHz);
    bandLo[k] = Math.max(1, Math.min(lo, center));
    bandHi[k] = Math.min(half - 1, Math.max(hi, center));
  }

  const frames = Math.max(0, binEnd - binStart);
  const raw = new Float32Array(frames * notes);
  const harmonic = new Float32Array(frames * notes);
  const halfWindow = windowSize / 2;

  for (let i = 0; i < frames; i += 1) {
    const start = Math.round(((binStart + i) / gridHz) * sampleRate) - halfWindow - sampleOffset;
    for (let j = 0; j < n; j += 1) {
      const index = start + j;
      re[j] = j < windowSize && index >= 0 && index < samples.length ? samples[index] * hann[j] : 0;
      im[j] = 0;
    }
    fft(re, im);
    for (let b = 0; b < half; b += 1) {
      mag[b] = Math.hypot(re[b], im[b]);
      soft[b] = Math.sqrt(mag[b]);
    }

    const base = i * notes;
    for (let k = 0; k < notes; k += 1) {
      let peak = 0;
      for (let b = bandLo[k]; b <= bandHi[k]; b += 1) if (mag[b] > peak) peak = mag[b];
      raw[base + k] = peak;

      let sum = 0;
      let fundamental = 0;
      let strongest = 0;
      for (let h = 1; h <= HARMONICS; h += 1) {
        const b = Math.round((f0[k] * h) / binHz);
        if (b + 1 >= half) break;
        const v = Math.max(soft[b - 1], soft[b], soft[b + 1]);
        if (h === 1) fundamental = v;
        if (v > strongest) strongest = v;
        sum += 0.8 ** (h - 1) * v;
      }
      harmonic[base + k] = strongest > 0 ? sum * (fundamental / strongest) : 0;
    }

    if (i % 500 === 0) scope.postMessage({ type: 'progress', progress: i / frames });
  }

  scope.postMessage({ type: 'result', raw, harmonic }, [raw.buffer, harmonic.buffer]);
}
