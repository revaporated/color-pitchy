import pitchWorkletUrl from '../worklets/pitch-detector.worklet.ts?worker&url';
import { DETECTION_RATE_HZ, FRAME_STRIDE } from './constants';

/** One raw detection. `time` is in performance-clock seconds (performance.now() / 1000). */
export type EngineFrame = {
  time: number;
  frequency: number; // Hz, 0 when pitchy found nothing
  clarity: number; // 0..1
  rms: number;
};

export type EngineStatus = 'idle' | 'starting' | 'running' | 'error';

type Options = {
  fftSize?: number;
  detectionRateHz?: number;
};

/**
 * Framework-free mic -> AudioWorklet -> pitchy engine.
 *
 * - Emits *raw* frames. Clarity, cents and range filtering happen where the
 *   frames are drawn or exported (see `frameToMidi`), so changing a threshold
 *   never restarts the mic and can be applied after the fact.
 * - Requests the mic with echo cancellation, noise suppression and auto gain off,
 *   since those processors distort pitch.
 * - Timestamps each frame at the *center* of its analysis window, on the
 *   performance clock, so it can be lined up against song playback.
 */
export class PitchEngine {
  status: EngineStatus = 'idle';
  error: string | null = null;
  latest: EngineFrame | null = null;
  detectionsPerSecond = 0;

  private fftSize: number;
  private readonly detectionRateHz: number;
  private active = true;

  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;

  private readonly frameListeners = new Set<(frame: EngineFrame) => void>();
  private readonly statusListeners = new Set<() => void>();

  private startToken = 0;
  private offsetMs: number | null = null;
  private statCount = 0;
  private statStart = 0;

  constructor({ fftSize = 2048, detectionRateHz = DETECTION_RATE_HZ }: Options = {}) {
    this.fftSize = fftSize;
    this.detectionRateHz = detectionRateHz;
  }

  subscribe(listener: (frame: EngineFrame) => void) {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  onStatusChange(listener: () => void) {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  async start() {
    if (this.status === 'running' || this.status === 'starting') return;
    const token = ++this.startToken;
    this.error = null;
    this.setStatus('starting');

    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (token !== this.startToken) throw new CancelledStart();

      context = new AudioContext({ latencyHint: 'interactive' });
      await context.audioWorklet.addModule(pitchWorkletUrl);
      if (token !== this.startToken) throw new CancelledStart();

      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, 'pitch-detector-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: {
          fftSize: this.fftSize,
          detectionRateHz: this.detectionRateHz,
          active: this.active,
        },
      });
      // The worklet has to be connected to the destination to keep processing.
      const sink = context.createGain();
      sink.gain.value = 0;
      source.connect(node);
      node.connect(sink).connect(context.destination);
      node.port.onmessage = (event) => this.handleMessage(event.data);

      if (context.state === 'suspended') await context.resume();
      if (token !== this.startToken) throw new CancelledStart();

      this.stream = stream;
      this.context = context;
      this.source = source;
      this.node = node;
      this.sink = sink;
      this.offsetMs = null;
      this.statCount = 0;
      this.statStart = performance.now();
      this.setStatus('running');
    } catch (err) {
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close().catch(() => {});
      if (err instanceof CancelledStart) return;
      console.error(err);
      this.error = describeError(err);
      this.setStatus('error');
    }
  }

  stop() {
    this.startToken += 1;
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
    }
    this.source?.disconnect();
    this.sink?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.context?.close().catch(() => {});
    this.node = null;
    this.source = null;
    this.sink = null;
    this.stream = null;
    this.context = null;
    this.latest = null;
    this.detectionsPerSecond = 0;
    if (this.status !== 'idle') this.setStatus('idle');
  }

  setFftSize(fftSize: number) {
    if (fftSize === this.fftSize) return;
    this.fftSize = fftSize;
    this.node?.port.postMessage({ type: 'config', fftSize });
  }

  /** When inactive the mic stays open but no detection runs (and no frames are emitted). */
  setActive(active: boolean) {
    if (active === this.active) return;
    this.active = active;
    this.node?.port.postMessage({ type: 'config', active });
    if (!active) this.latest = null;
  }

  /** One batch from the worklet: FRAME_STRIDE numbers per frame (frequency, clarity, rms, audioTime). */
  private handleMessage(data: { frames: Float64Array; windowSize: number }) {
    const context = this.context;
    const frames = data?.frames;
    if (!context || !frames) return;
    const count = Math.floor(frames.length / FRAME_STRIDE);
    if (count === 0) return;

    const now = performance.now();

    // Messages can arrive late but never early, so the smallest observed
    // (arrival - audio time) is the best estimate of the clock offset.
    // Let it creep upward slowly in case the clocks drift. Only the newest
    // frame in a batch is used: the older ones waited for the batch to fill,
    // which would bias the estimate late.
    const newestEndMs = frames[(count - 1) * FRAME_STRIDE + 3] * 1000;
    const candidate = now - newestEndMs;
    if (this.offsetMs === null || candidate < this.offsetMs) {
      this.offsetMs = candidate;
    } else {
      this.offsetMs += (candidate - this.offsetMs) * 0.002;
    }
    const offsetMs = this.offsetMs;
    const halfWindowMs = (data.windowSize / context.sampleRate) * 500;

    for (let i = 0; i < count; i += 1) {
      const base = i * FRAME_STRIDE;
      const frequency = frames[base];
      const clarity = frames[base + 1];
      const rms = frames[base + 2];
      const frame: EngineFrame = {
        time: (frames[base + 3] * 1000 - halfWindowMs + offsetMs) / 1000,
        frequency: Number.isFinite(frequency) && frequency > 0 ? frequency : 0,
        clarity: Number.isFinite(clarity) ? clarity : 0,
        rms: Number.isFinite(rms) ? rms : 0,
      };
      this.latest = frame;
      for (const listener of this.frameListeners) listener(frame);
    }

    this.statCount += count;
    const elapsed = now - this.statStart;
    if (elapsed >= 500) {
      this.detectionsPerSecond = Math.round((this.statCount * 1000) / elapsed);
      this.statCount = 0;
      this.statStart = now;
    }
  }

  private setStatus(status: EngineStatus) {
    this.status = status;
    for (const listener of this.statusListeners) listener();
  }
}

class CancelledStart extends Error {}

function describeError(err: unknown) {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') return 'Microphone permission was denied.';
    if (err.name === 'NotFoundError') return 'No microphone was found.';
  }
  return 'Microphone access failed.';
}
