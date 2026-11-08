/**
 * Pitch detections per second. Each one is an FFT over the whole analysis
 * window (2048 samples by default, ~43 ms), so hops much shorter than ~10 ms
 * mostly re-measure the same audio. 100 Hz matches the reference contour's grid.
 */
export const DETECTION_RATE_HZ = 100;
