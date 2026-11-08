import { PitchDetector } from 'pitchy';

type ConfigMessage = {
  type: 'config';
  fftSize?: number;
  detectionRateHz?: number;
  active?: boolean;
};

type ProcessorOptions = Omit<ConfigMessage, 'type'>;

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
  private detectionInterval = 1 / 165;
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
    for (let i = 0; i < input.length; i += 1) {
      this.buffer[this.writeIndex] = input[i];
      this.writeIndex = (this.writeIndex + 1) % size;
    }
    this.filled = Math.min(size, this.filled + input.length);

    if (!this.active || this.filled < size) return true;

    // Context time of the last sample in this render quantum.
    const windowEnd = currentTime + input.length / sampleRate;
    if (windowEnd < this.nextEmitTime) return true;
    this.nextEmitTime += this.detectionInterval;
    if (this.nextEmitTime < windowEnd) this.nextEmitTime = windowEnd + this.detectionInterval;

    // Unroll the ring buffer, oldest sample first.
    const tail = this.buffer.subarray(this.writeIndex);
    this.window.set(tail, 0);
    this.window.set(this.buffer.subarray(0, this.writeIndex), tail.length);

    let sumSquares = 0;
    for (let i = 0; i < size; i += 1) sumSquares += this.window[i] * this.window[i];

    const [frequency, clarity] = this.detector.findPitch(this.window, sampleRate);
    this.port.postMessage({
      frequency,
      clarity,
      rms: Math.sqrt(sumSquares / size),
      audioTime: windowEnd,
      windowSize: size,
    });

    return true;
  }
}

registerProcessor('pitch-detector-processor', PitchDetectorProcessor);
