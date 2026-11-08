import { PitchDetector } from 'pitchy';

type ConfigMessage = {
  type: 'config';
  fftSize?: number;
  detectionRateHz?: number;
  active?: boolean;
};

type ProcessorOptions = Omit<ConfigMessage, 'type'>;

/**
 * Windows quieter than this RMS (about -60 dBFS) skip the FFT and report "no
 * pitch". That is below any playable signal and around the mic's own noise
 * floor, so it only removes work spent measuring silence.
 */
const SILENCE_RMS = 0.001;

/**
 * Keeps a rolling window of the last `fftSize` mic samples and runs pitchy on it
 * `detectionRateHz` times per second.
 *
 * Settings can change at runtime through `port.postMessage({ type: 'config', ... })`,
 * so changing the FFT size no longer tears down the mic and AudioContext.
 * When `active` is false the processor keeps buffering but skips detection.
 */
class PitchDetectorProcessor extends AudioWorkletProcessor {
  private fftSize = 0;
  private detector: PitchDetector<Float32Array> | null = null;
  private buffer = new Float32Array(0);
  private window = new Float32Array(0);
  private writeIndex = 0;
  private filled = 0;
  // The engine always passes the real rate in processorOptions; this is only a fallback.
  private detectionInterval = 1 / 100;
  private nextEmitTime = 0;
  private active = true;

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const opts = (options.processorOptions ?? {}) as ProcessorOptions;
    this.allocate(opts.fftSize ?? 2048);
    if (opts.detectionRateHz) this.detectionInterval = 1 / opts.detectionRateHz;
    if (typeof opts.active === 'boolean') this.active = opts.active;
    this.port.onmessage = (event: MessageEvent<ConfigMessage>) => this.configure(event.data);
  }

  private allocate(size: number) {
    if (size === this.fftSize) return;
    this.fftSize = size;
    this.detector = PitchDetector.forFloat32Array(size);
    this.buffer = new Float32Array(size);
    this.window = new Float32Array(size);
    this.writeIndex = 0;
    this.filled = 0;
  }

  private configure(message: ConfigMessage) {
    if (!message || message.type !== 'config') return;
    if (message.fftSize) this.allocate(message.fftSize);
    if (message.detectionRateHz) this.detectionInterval = 1 / message.detectionRateHz;
    if (typeof message.active === 'boolean') this.active = message.active;
  }

  process(inputs: Float32Array[][]) {
    const input = inputs[0]?.[0];
    if (!input || !this.detector) return true;

    const size = this.fftSize;
    const buffer = this.buffer;
    let write = this.writeIndex;
    for (let i = 0; i < input.length; i += 1) {
      buffer[write] = input[i];
      write += 1;
      if (write === size) write = 0;
    }
    this.writeIndex = write;
    this.filled = Math.min(size, this.filled + input.length);

    if (!this.active || this.filled < size) return true;

    // Context time of the last sample in this render quantum.
    const windowEnd = currentTime + input.length / sampleRate;
    if (windowEnd < this.nextEmitTime) return true;
    this.nextEmitTime += this.detectionInterval;
    if (this.nextEmitTime < windowEnd) this.nextEmitTime = windowEnd + this.detectionInterval;

    // RMS doesn't care about sample order, so measure the ring as it is.
    let sumSquares = 0;
    for (let i = 0; i < size; i += 1) sumSquares += buffer[i] * buffer[i];
    const rms = Math.sqrt(sumSquares / size);

    let frequency = 0;
    let clarity = 0;
    if (rms >= SILENCE_RMS) {
      // Unroll the ring buffer, oldest sample first.
      const tail = buffer.subarray(write);
      this.window.set(tail, 0);
      this.window.set(buffer.subarray(0, write), tail.length);
      [frequency, clarity] = this.detector.findPitch(this.window, sampleRate);
    }

    // Silent windows still post a frame so takes get overwritten and graph lines break.
    this.port.postMessage({ frequency, clarity, rms, audioTime: windowEnd, windowSize: size });

    return true;
  }
}

registerProcessor('pitch-detector-processor', PitchDetectorProcessor);
