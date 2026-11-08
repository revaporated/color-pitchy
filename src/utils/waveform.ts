export const PIXELS_PER_SECOND = 140.6 // 1406px viewer width / 10 seconds = 140.6px/second
export const WAVEFORM_HEIGHT = 140
export const PLAYHEAD_WIDTH = 2

/**
 * One peak (max absolute sample) per horizontal pixel of the waveform.
 * Pure, so it can run in a worker (see workers/trackPrep.worker.ts).
 */
export const computePeaks = (
  channelData: Float32Array,
  sampleRate: number,
  pixelsPerSecond: number = PIXELS_PER_SECOND,
) => {
  const duration = channelData.length / sampleRate
  const totalPeaks = Math.max(1, Math.floor(duration * pixelsPerSecond))
  const peaks = new Float32Array(totalPeaks)
  const samplesPerPeak = Math.max(1, Math.floor(channelData.length / totalPeaks))

  for (let i = 0; i < totalPeaks; i += 1) {
    const start = i * samplesPerPeak
    const end = i === totalPeaks - 1 ? channelData.length : start + samplesPerPeak
    let max = 0

    for (let j = start; j < end; j += 1) {
      const value = Math.abs(channelData[j])
      if (value > max) max = value
    }

    peaks[i] = max
  }

  return peaks
}
