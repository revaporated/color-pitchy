import { PitchDetector } from 'pitchy';

type WorkletOptions = {
  fftSize?: number;
  detectionRateHz?: number;
};

class PitchDetectorProcessor extends AudioWorkletProcessor {
  private detector: ReturnType<typeof PitchDetector.forFloat32Array>;
  private fftSize: number;
  private buffer: Float32Array;
  private bufferIndex: number;
  private bufferFilled: boolean;
  private detectionInterval: number;
  private nextEmitTime: number;

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const processorOptions = (options.processorOptions || {}) as WorkletOptions;
    const fftSize = processorOptions.fftSize ?? 2048;
    const detectionRateHz = processorOptions.detectionRateHz ?? 165;

    this.fftSize = fftSize;
    this.detector = PitchDetector.forFloat32Array(this.fftSize);
    this.buffer = new Float32Array(this.fftSize);
    this.bufferIndex = 0;
    this.bufferFilled = false;
    this.detectionInterval = 1 / detectionRateHz;
    this.nextEmitTime = currentTime + this.detectionInterval;
  }

  process(inputs: Float32Array[][]) {
    const input = inputs[0]?.[0];
    if (!input) return true;

    for (let i = 0; i < input.length; i += 1) {
      this.buffer[this.bufferIndex] = input[i];
      this.bufferIndex = (this.bufferIndex + 1) % this.fftSize;
      if (this.bufferIndex === 0) {
        this.bufferFilled = true;
      }
    }

    if (!this.bufferFilled) {
      return true;
    }

    if (currentTime >= this.nextEmitTime) {
      const window = new Float32Array(this.fftSize);
      const tail = this.buffer.subarray(this.bufferIndex);
      window.set(tail, 0);
      window.set(this.buffer.subarray(0, this.bufferIndex), tail.length);

      const [frequency, clarity] = this.detector.findPitch(window, sampleRate);
      this.port.postMessage({ frequency, clarity, audioTime: currentTime });
      this.nextEmitTime = currentTime + this.detectionInterval;
    }

    return true;
  }
}

registerProcessor('pitch-detector-processor', PitchDetectorProcessor);
