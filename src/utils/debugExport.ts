import type { PitchTrack } from '../audio/frames';
import { frequencyToMidi } from './pitch';

/** 16-bit PCM WAV of a decoded AudioBuffer, all channels, original sample rate. */
export function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const dataBytes = frames * channels * 2;
  const out = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(out);
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataBytes, true);

  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  const samples = new Int16Array(out, 44, frames * channels);
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      samples[i * channels + c] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
  }
  return out;
}

/** One row per grid bin: time, frequency (0 = none), clarity, fractional MIDI. Empty bins are skipped. */
export function contourCsv(track: PitchTrack): string {
  const rows = ['time,frequency,clarity,midi'];
  for (let b = 0; b < track.length; b += 1) {
    const clarity = track.clarity[b];
    if (Number.isNaN(clarity)) continue;
    const frequency = track.frequency[b];
    const midi = frequency > 0 ? frequencyToMidi(frequency).toFixed(3) : '';
    rows.push(`${(b / track.gridHz).toFixed(3)},${frequency.toFixed(2)},${clarity.toFixed(4)},${midi}`);
  }
  return rows.join('\n');
}

/** `name-YYYYMMDD-HHMMSS`, from the loaded file's name. */
export function debugExportBase(fileName: string | null, date = new Date()) {
  const base = (fileName ?? 'track').replace(/\.[^.]+$/, '');
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${base}-${stamp}`;
}

/**
 * Saves a file into the project's debug-exports/ folder through the dev
 * server (no save dialog). Outside `npm run dev` it falls back to a normal download.
 */
export async function saveDebugFile(name: string, data: BlobPart, type: string) {
  const blob = new Blob([data], { type });
  if (import.meta.env.DEV) {
    const response = await fetch(`/__debug-export?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      body: blob,
    });
    if (!response.ok) throw new Error(`Debug export failed: ${response.status}`);
    return `debug-exports/${name}`;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}
