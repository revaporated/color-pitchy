/**
 * Pitch detections per second. Each one is an FFT over the whole analysis
 * window (2048 samples by default, ~43 ms), so hops much shorter than ~10 ms
 * mostly re-measure the same audio. 100 Hz matches the reference contour's grid.
 */
export const DETECTION_RATE_HZ = 100;

/**
 * Detections the worklet collects before posting them to the main thread in
 * one message. Fewer messages means fewer main-thread wakeups, but each frame
 * waits for its batch, so the live marker lags by up to (n - 1) / rate seconds.
 * 2 at 100 Hz halves the messages for at most 10 ms of extra lag.
 */
export const FRAMES_PER_MESSAGE = 2;

/** Numbers per frame in a worklet batch: frequency, clarity, rms, audioTime. */
export const FRAME_STRIDE = 4;
