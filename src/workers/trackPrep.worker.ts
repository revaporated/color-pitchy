import { computePeaks } from '../utils/waveform';

export type PrepRequest = {
  channels: Float32Array[];
  sampleRate: number;
  pixelsPerSecond: number;
};

export type PrepResponse =
  | { type: 'peaks'; peaks: Float32Array }
  | { type: 'mono'; samples: Float32Array; sampleRate: number }
  | { type: 'error'; message: string };

// `self` is typed as Window under the DOM lib; describe the worker scope we use.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<PrepRequest>) => void) | null;
  postMessage(message: PrepResponse, transfer?: Transferable[]): void;
};

/**
 * Load-time work that used to run on the main thread: waveform peaks (from
 * the first channel, as before) and the mono downmix for the reference
 * analysis. Audio at 32 kHz or above is decimated 2x for the reference, which
 * halves its work and still covers the vocal and most instrumental range.
 */
scope.onmessage = (event) => {
  try {
    const { channels, sampleRate, pixelsPerSecond } = event.data;
    const first = channels[0];
    if (!first) throw new Error('The track has no audio channels.');

    const peaks = computePeaks(first, sampleRate, pixelsPerSecond);
    scope.postMessage({ type: 'peaks', peaks }, [peaks.buffer]);

    const length = first.length;
    const count = channels.length;
    const decimate = sampleRate >= 32000;
    const step = decimate ? 2 : 1;
    const out = new Float32Array(Math.floor(length / step));
    const scale = 1 / (count * step);
    for (let c = 0; c < count; c += 1) {
      const data = channels[c];
      if (decimate) {
        for (let i = 0; i < out.length; i += 1) out[i] += (data[2 * i] + data[2 * i + 1]) * scale;
      } else {
        for (let i = 0; i < out.length; i += 1) out[i] += data[i] * scale;
      }
    }
    scope.postMessage({ type: 'mono', samples: out, sampleRate: sampleRate / step }, [out.buffer]);
  } catch (err) {
    scope.postMessage({ type: 'error', message: String(err) });
  }
};
