import { useEffect, useState } from 'react';
import { PitchTrack } from '../audio/frames';
import type { ReferenceRequest, ReferenceResponse } from '../workers/referencePitch.worker';

export const REFERENCE_GRID_HZ = 100;
const REFERENCE_WINDOW_SECONDS = 0.046; // about 2048 samples at 44.1 kHz

export type ReferenceState =
  | { status: 'idle'; track: null; progress: 0 }
  | { status: 'analyzing'; track: null; progress: number }
  | { status: 'ready'; track: PitchTrack; progress: 1 }
  | { status: 'error'; track: null; progress: 0; message: string };

const IDLE: ReferenceState = { status: 'idle', track: null, progress: 0 };
let nextRequestId = 1;

/** Runs pitchy over the whole decoded track in a Web Worker and returns its contour. */
export function useReferenceTrack(audioBuffer: AudioBuffer | null): ReferenceState {
  const [state, setState] = useState<ReferenceState>(IDLE);

  useEffect(() => {
    if (!audioBuffer) {
      setState(IDLE);
      return;
    }

    const id = nextRequestId++;
    const worker = new Worker(new URL('../workers/referencePitch.worker.ts', import.meta.url), {
      type: 'module',
    });
    setState({ status: 'analyzing', track: null, progress: 0 });

    worker.onmessage = (event: MessageEvent<ReferenceResponse>) => {
      const message = event.data;
      if (message.id !== id) return;
      if (message.type === 'progress') {
        setState({ status: 'analyzing', track: null, progress: message.progress });
      } else if (message.type === 'result') {
        setState({
          status: 'ready',
          track: PitchTrack.fromArrays(message.frequency, message.clarity, message.gridHz),
          progress: 1,
        });
        worker.terminate();
      } else {
        setState({ status: 'error', track: null, progress: 0, message: message.message });
        worker.terminate();
      }
    };
    worker.onerror = (event) => {
      setState({ status: 'error', track: null, progress: 0, message: event.message });
    };

    const samples = downmix(audioBuffer);
    const request: ReferenceRequest = {
      id,
      samples,
      sampleRate: audioBuffer.sampleRate,
      gridHz: REFERENCE_GRID_HZ,
      windowSeconds: REFERENCE_WINDOW_SECONDS,
    };
    worker.postMessage(request, [samples.buffer]);

    return () => worker.terminate();
  }, [audioBuffer]);

  return state;
}

function downmix(buffer: AudioBuffer) {
  const mono = new Float32Array(buffer.length);
  const channels = buffer.numberOfChannels;
  for (let c = 0; c < channels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < mono.length; i += 1) mono[i] += data[i] / channels;
  }
  return mono;
}
