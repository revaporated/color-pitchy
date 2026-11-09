import { PitchDetector } from 'pitchy';
import { fft } from '../audio/fft';

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
  /**
   * topVoice only: cost of switching notes in the tracker (0 = no tracking,
   * pick each frame independently). Higher values remove more flicker and
   * blips but can merge very fast notes.
   */
  smoothing: number;
  /** Lowest and highest MIDI note to report. topVoice only searches this range. */
  minMidi: number;
  maxMidi: number;
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
function analyze(request: ReferenceRequest) {
  if (request.method === 'topVoice') {
    analyzeTopVoice(request);
    return;
  }
  const { samples, sampleOffset, sampleRate, gridHz, windowSize, binStart, binEnd } = request;
  // Allow a quarter tone either side so notes at the edges of the range survive rounding.
  const minHz = 440 * 2 ** ((request.minMidi - 0.5 - 69) / 12);
  const maxHz = 440 * 2 ** ((request.maxMidi + 0.5 - 69) / 12);
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
    const inRange = Number.isFinite(f) && f >= minHz && f <= maxHz;
    frequency[i] = inRange ? f : 0;
    clarity[i] = inRange && Number.isFinite(c) ? c : 0;

    if (i % 500 === 0) scope.postMessage({ type: 'progress', progress: i / bins });
  }

  scope.postMessage({ type: 'result', frequency, clarity }, [frequency.buffer, clarity.buffer]);
}

const HARMONICS = 8;

/** Tracker emission for a frame with sound but the "no note" state chosen. */
const NO_NOTE_SCORE = Math.log(0.15);
/** Score for a note that isn't a candidate in this frame. */
const NON_CANDIDATE_SCORE = Math.log(1e-3);
/** Candidates below the top one are scored down by this, so the top voice wins unless it's unstable. */
const LOWER_VOICE_WEIGHT = 0.5;

/**
 * Polyphonic melody guess without ML, in two passes over this worker's slice.
 *
 * 1. Salience: every semitone C3-C7 is scored by the energy at its harmonics
 *    (harmonic summation). Candidates are local peaks at least half as strong
 *    as the strongest, skipping any note whose octave-below scores higher (the
 *    usual octave-error signature). The highest candidate is the top voice.
 * 2. Tracking (Viterbi): picks the note sequence that best follows the
 *    candidates while paying `smoothing` for every note change. That removes
 *    one-frame flips between neighbouring notes and brief in-between blips.
 *    With smoothing 0 each frame just takes its top voice.
 */
function analyzeTopVoice({
  samples,
  sampleOffset,
  sampleRate,
  gridHz,
  windowSize,
  binStart,
  binEnd,
  smoothing,
  minMidi,
  maxMidi,
}: ReferenceRequest) {
  const range: NoteRange = { min: minMidi, count: maxMidi - minMidi + 1 };
  const NOTE_COUNT = range.count;
  const salience = new Salience(windowSize * 2, sampleRate, range);
  const window = new Float32Array(windowSize);
  const halfWindow = windowSize / 2;
  const bins = Math.max(0, binEnd - binStart);
  // Per frame: one score per note, or NaN in the first slot for silence.
  const scores = new Float32Array(bins * NOTE_COUNT);

  for (let i = 0; i < bins; i += 1) {
    const start = Math.round(((binStart + i) / gridHz) * sampleRate) - halfWindow - sampleOffset;
    for (let j = 0; j < windowSize; j += 1) {
      const index = start + j;
      window[j] = index >= 0 && index < samples.length ? samples[index] : 0;
    }
    salience.candidates(window, scores.subarray(i * NOTE_COUNT, (i + 1) * NOTE_COUNT));
    if (i % 500 === 0) scope.postMessage({ type: 'progress', progress: (0.95 * i) / bins });
  }

  const path = smoothing > 0 ? viterbi(scores, bins, smoothing, range) : topEachFrame(scores, bins, range);
  const frequency = new Float32Array(bins);
  const clarity = new Float32Array(bins);
  for (let i = 0; i < bins; i += 1) {
    const m = path[i];
    if (m < 0) continue;
    frequency[i] = 440 * 2 ** ((m - 69) / 12);
    // The tracker decides voicing, so a tracked note is fully "clear". With
    // smoothing off, report the note's strength relative to the frame's best.
    clarity[i] = smoothing > 0 ? 1 : Math.exp(scores[i * NOTE_COUNT + m - minMidi]);
  }
  scope.postMessage({ type: 'result', frequency, clarity }, [frequency.buffer, clarity.buffer]);
}

/** The notes the top-voice analysis searches: MIDI `min` up to `min + count - 1`. */
type NoteRange = { min: number; count: number };

/** Per-frame top voice, no tracking. Returns MIDI per frame or -1. */
function topEachFrame(scores: Float32Array, bins: number, { min: MIN_MIDI, count: NOTE_COUNT }: NoteRange) {
  const path = new Int16Array(bins).fill(-1);
  for (let i = 0; i < bins; i += 1) {
    const base = i * NOTE_COUNT;
    if (Number.isNaN(scores[base])) continue;
    // Candidates are found top-down, so the highest-pitched one is the top voice.
    for (let k = NOTE_COUNT - 1; k >= 0; k -= 1) {
      if (scores[base + k] > NON_CANDIDATE_SCORE) {
        path[i] = MIN_MIDI + k;
        break;
      }
    }
  }
  return path;
}

/**
 * Best path through states [no note, C3 .. C7]. Staying costs nothing,
 * changing to any other state costs `switchCost`. Returns MIDI per frame or -1.
 */
function viterbi(scores: Float32Array, bins: number, switchCost: number, { min: MIN_MIDI, count: NOTE_COUNT }: NoteRange) {
  const states = NOTE_COUNT + 1;
  let total = new Float64Array(states);
  let next = new Float64Array(states);
  const back = new Uint8Array(bins * states);

  for (let i = 0; i < bins; i += 1) {
    const base = i * NOTE_COUNT;
    const silent = Number.isNaN(scores[base]);
    let best = 0;
    for (let k = 1; k < states; k += 1) if (total[k] > total[best]) best = k;
    const switched = total[best] - switchCost;
    for (let k = 0; k < states; k += 1) {
      const emit = k === 0 ? (silent ? 0 : NO_NOTE_SCORE) : silent ? NON_CANDIDATE_SCORE : scores[base + k - 1];
      if (total[k] >= switched) {
        next[k] = total[k] + emit;
        back[i * states + k] = k;
      } else {
        next[k] = switched + emit;
        back[i * states + k] = best;
      }
    }
    const swap = total;
    total = next;
    next = swap;
  }

  let k = 0;
  for (let s = 1; s < states; s += 1) if (total[s] > total[k]) k = s;
  const path = new Int16Array(bins);
  for (let i = bins - 1; i >= 0; i -= 1) {
    path[i] = k === 0 ? -1 : MIN_MIDI + k - 1;
    k = back[i * states + k];
  }
  return path;
}

/** Harmonic-summation salience for one window, written as log scores per note. */
class Salience {
  private readonly size: number;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly hann: Float64Array;
  private readonly mag: Float64Array;
  private readonly raw: Float64Array;
  private readonly sampleRate: number;
  private readonly minMidi: number;
  private readonly maxMidi: number;

  constructor(size: number, sampleRate: number, range: NoteRange) {
    this.size = size;
    this.sampleRate = sampleRate;
    this.minMidi = range.min;
    this.maxMidi = range.min + range.count - 1;
    // One extra note scored past each end, so the end notes can be tested as peaks.
    this.raw = new Float64Array(this.maxMidi + 2);
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
    this.mag = new Float64Array(size / 2);
    this.hann = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i += 1) this.hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size / 2 - 1));
  }

  /**
   * Fills `out` (one slot per note, MIN_MIDI first) with log scores: the
   * top candidate gets log(strength), lower candidates log(strength * 0.5),
   * everything else a floor value. Silence sets out[0] to NaN.
   */
  candidates(window: Float32Array, out: Float32Array) {
    const n = this.size;
    const half = n / 2;
    let energy = 0;
    for (let i = 0; i < n; i += 1) {
      // Hann-windowed input, zero-padded 2x for finer frequency bins.
      const x = i < half ? window[i] : 0;
      this.re[i] = i < half ? x * this.hann[i] : 0;
      this.im[i] = 0;
      energy += x * x;
    }
    out.fill(NON_CANDIDATE_SCORE);
    if (Math.sqrt(energy / half) < 0.003) {
      out[0] = Number.NaN;
      return;
    }
    fft(this.re, this.im);
    for (let k = 0; k < half; k += 1) this.mag[k] = Math.sqrt(Math.hypot(this.re[k], this.im[k])); // compressed

    const s = this.raw;
    const MIN_MIDI = this.minMidi;
    const MAX_MIDI = this.maxMidi;
    const binHz = this.sampleRate / n;
    let max = 0;
    for (let m = MIN_MIDI - 1; m <= MAX_MIDI + 1; m += 1) {
      const f0 = 440 * 2 ** ((m - 69) / 12);
      let sum = 0;
      for (let h = 1; h <= HARMONICS; h += 1) {
        const k = Math.round((f0 * h) / binHz);
        if (k + 1 >= half) break;
        sum += 0.8 ** (h - 1) * Math.max(this.mag[k - 1], this.mag[k], this.mag[k + 1]);
      }
      s[m] = sum;
      if (sum > max && m >= MIN_MIDI && m <= MAX_MIDI) max = sum;
    }
    if (max <= 0) {
      out[0] = Number.NaN;
      return;
    }

    let top = true;
    for (let m = MAX_MIDI; m >= MIN_MIDI; m -= 1) {
      const v = s[m];
      if (v < 0.5 * max || v < s[m - 1] || v < s[m + 1]) continue;
      if (m - 12 >= MIN_MIDI && s[m - 12] > v) continue;
      out[m - MIN_MIDI] = Math.log((v / max) * (top ? 1 : LOWER_VOICE_WEIGHT));
      top = false;
    }
  }
}
