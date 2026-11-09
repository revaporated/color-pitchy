import { fft } from '../audio/fft';

export type BeatRequest = { samples: Float32Array; sampleRate: number };
export type BeatResponse =
  | { type: 'result'; beats: Float64Array; bpm: number }
  | { type: 'error'; message: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<BeatRequest>) => void) | null;
  postMessage(message: BeatResponse, transfer?: Transferable[]): void;
};

const FRAME = 1024;
const HOP = 256;
const MIN_BPM = 40;
const MAX_BPM = 220;
/** Tempo prior: log-normal around this, one octave wide. */
const PRIOR_BPM = 120;
/** How strongly beats keep to the tempo versus following onsets (Ellis 2007). */
const TIGHTNESS = 100;
/** Ignore content above this (cymbal hiss adds little beat information). */
const MAX_FLUX_HZ = 8000;

scope.onmessage = (event) => {
  try {
    const { beats, bpm } = detectBeats(event.data.samples, event.data.sampleRate);
    scope.postMessage({ type: 'result', beats, bpm }, [beats.buffer]);
  } catch (err) {
    scope.postMessage({ type: 'error', message: String(err) });
  }
};

/**
 * Offline beat tracking:
 * 1. Onset strength: positive spectral flux of log magnitudes, per hop.
 * 2. Tempo: autocorrelation of the onset strength, weighted by a prior.
 * 3. Beats: dynamic programming that places beats on strong onsets while
 *    penalizing intervals that stray from the tempo, then backtracks.
 */
export function detectBeats(samples: Float32Array, sampleRate: number) {
  const onset = onsetStrength(samples, sampleRate);
  const frameRate = sampleRate / HOP;
  const period = estimatePeriod(onset, frameRate);
  const frames = trackBeats(onset, period);
  const beats = new Float64Array(frames.length);
  // Flux peaks about one hop before the window's centre reaches the attack
  // (measured on click tracks), so shift by that to land on the attack.
  for (let i = 0; i < frames.length; i += 1) beats[i] = (frames[i] * HOP + FRAME / 2 + HOP) / sampleRate;
  return { beats, bpm: (60 * frameRate) / period };
}

function onsetStrength(samples: Float32Array, sampleRate: number) {
  const count = Math.max(0, Math.floor((samples.length - FRAME) / HOP) + 1);
  const bins = Math.min(FRAME / 2, Math.ceil((MAX_FLUX_HZ * FRAME) / sampleRate));
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  const hann = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i += 1) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
  let previous = new Float64Array(bins);
  let current = new Float64Array(bins);
  const flux = new Float64Array(count);

  for (let f = 0; f < count; f += 1) {
    const start = f * HOP;
    for (let i = 0; i < FRAME; i += 1) {
      re[i] = samples[start + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    let sum = 0;
    for (let b = 1; b < bins; b += 1) {
      current[b] = Math.log1p(1000 * Math.hypot(re[b], im[b]));
      if (f > 0) {
        const rise = current[b] - previous[b];
        if (rise > 0) sum += rise;
      }
    }
    flux[f] = sum;
    const swap = previous;
    previous = current;
    current = swap;
  }

  // Remove the slowly varying level (about 0.4 s moving average), keep the rises, normalize.
  const half = Math.round((0.2 * sampleRate) / HOP);
  const out = new Float64Array(count);
  let windowSum = 0;
  let lo = 0;
  let hi = -1;
  for (let f = 0; f < count; f += 1) {
    while (hi < Math.min(count - 1, f + half)) windowSum += flux[++hi];
    while (lo < f - half) windowSum -= flux[lo++];
    out[f] = Math.max(0, flux[f] - windowSum / (hi - lo + 1));
  }
  let sq = 0;
  for (let f = 0; f < count; f += 1) sq += out[f] * out[f];
  const std = Math.sqrt(sq / Math.max(1, count)) || 1;
  for (let f = 0; f < count; f += 1) out[f] /= std;
  return out;
}

/** Beat period in onset frames (fractional). */
function estimatePeriod(onset: Float64Array, frameRate: number) {
  const minLag = Math.max(1, Math.floor((60 * frameRate) / MAX_BPM));
  const maxLag = Math.ceil((60 * frameRate) / MIN_BPM);
  const n = onset.length;
  const scores = new Float64Array(maxLag + 2);
  let best = minLag;
  for (let lag = minLag; lag <= maxLag + 1 && lag < n; lag += 1) {
    let acc = 0;
    for (let i = lag; i < n; i += 1) acc += onset[i] * onset[i - lag];
    acc /= n - lag;
    const bpm = (60 * frameRate) / lag;
    const prior = Math.exp(-0.5 * Math.log2(bpm / PRIOR_BPM) ** 2);
    scores[lag] = acc * prior;
    if (lag <= maxLag && scores[lag] > scores[best]) best = lag;
  }
  // Parabolic interpolation for a sub-frame period.
  const a = scores[best - 1] ?? 0;
  const b = scores[best];
  const c = scores[best + 1] ?? 0;
  const denom = a - 2 * b + c;
  const shift = denom < 0 ? (0.5 * (a - c)) / denom : 0;
  return best + Math.max(-0.5, Math.min(0.5, shift));
}

/** Frame indices of the beats. */
function trackBeats(onset: Float64Array, period: number) {
  const n = onset.length;
  if (n === 0) return [];
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2);
  const hi = Math.round(period * 2);
  for (let t = 0; t < n; t += 1) {
    let best = 0;
    let from = -1;
    for (let prev = t - hi; prev <= t - lo; prev += 1) {
      if (prev < 0) continue;
      const stretch = Math.log((t - prev) / period);
      const value = score[prev] - TIGHTNESS * stretch * stretch;
      if (from === -1 || value > best) {
        best = value;
        from = prev;
      }
    }
    score[t] = onset[t] + (from === -1 ? 0 : best);
    back[t] = from;
  }

  // End on the best-scoring frame within the last period, then follow back.
  let end = n - 1;
  for (let t = Math.max(0, n - Math.round(period)); t < n; t += 1) if (score[t] > score[end]) end = t;
  const frames: number[] = [];
  for (let t = end; t >= 0; t = back[t]) frames.push(t);
  frames.reverse();

  // Drop beats carried through silence before the first clear onset or after the last.
  let first = 0;
  while (first < n && onset[first] < 1) first += 1;
  let last = n - 1;
  while (last > 0 && onset[last] < 1) last -= 1;
  return frames.filter((t) => t >= first - period * 0.5 && t <= last + period * 0.5);
}
