import { PITCH_COLOR_SHAPE_MAP, type NoteIndex } from '../utils/pitch';

/** Output of the spectrogram workers for a whole track. */
export type SpectrogramData = {
  raw: Float32Array;
  harmonic: Float32Array;
  frames: number;
  gridHz: number;
  minMidi: number;
  maxMidi: number;
};

/**
 * - raw: energy in each semitone's band (overtones show as extra rows);
 * - harmonic: harmonic sum, keeping only what stands out from the frame's
 *   background level, so notes light up rather than noise and overtones;
 * - peaks: harmonic, plus anything that isn't a local peak across semitones
 *   is dimmed, and so (less) is a peak quieter than the note an octave below,
 *   leaving roughly one bright row per sounding note.
 */
export type SpectrogramView = 'raw' | 'harmonic' | 'peaks';

/** Frames per tile canvas; well under the browser's canvas size limit. */
const TILE_FRAMES = 4096;
/** How far (dB) above the frame's median a value must be to count fully. */
const STAND_OUT_DB = 12;
const NON_PEAK_GAIN = 0.15;
/** "Notes only": a note quieter than the one an octave below is likely its overtone. */
const OVERTONE_GAIN = 0.4;

/**
 * The spectrogram as tile canvases, one pixel per frame and per semitone,
 * highest note at the top. Each row is its note's Colorchord color; alpha is
 * the strength. Rebuilt when the view or range changes.
 */
export class SpectrogramImage {
  readonly gridHz: number;
  readonly minMidi: number;
  readonly maxMidi: number;
  readonly frames: number;
  private readonly tiles: { canvas: HTMLCanvasElement; f0: number; width: number }[] = [];

  constructor(data: SpectrogramData, view: SpectrogramView, rangeDb: number) {
    this.gridHz = data.gridHz;
    this.minMidi = data.minMidi;
    this.maxMidi = data.maxMidi;
    this.frames = data.frames;
    const notes = data.maxMidi - data.minMidi + 1;
    const alpha = strengths(data, view, rangeDb, notes);

    const rgb = Array.from({ length: notes }, (_, k) => {
      const pc = (((data.minMidi + k) % 12) + 12) % 12;
      return PITCH_COLOR_SHAPE_MAP[pc as NoteIndex].rgb.split(',').map(Number);
    });

    for (let f0 = 0; f0 < data.frames; f0 += TILE_FRAMES) {
      const width = Math.min(TILE_FRAMES, data.frames - f0);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = notes;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      const image = ctx.createImageData(width, notes);
      const px = image.data;
      for (let x = 0; x < width; x += 1) {
        const base = (f0 + x) * notes;
        for (let k = 0; k < notes; k += 1) {
          const a = alpha[base + k];
          if (a === 0) continue;
          const row = notes - 1 - k;
          const i = (row * width + x) * 4;
          const [r, g, b] = rgb[k];
          px[i] = r;
          px[i + 1] = g;
          px[i + 2] = b;
          px[i + 3] = a;
        }
      }
      ctx.putImageData(image, 0, 0);
      this.tiles.push({ canvas, f0, width });
    }
  }

  /** Draws the visible part. Same time and pitch mapping as the note bars. */
  draw(
    ctx: CanvasRenderingContext2D,
    t0: number,
    t1: number,
    xScale: number,
    xOffset: number,
    lo: number,
    hi: number,
    h: number,
    opacity: number,
  ) {
    const top = Math.min(hi, this.maxMidi);
    const bottom = Math.max(lo, this.minMidi);
    if (top < bottom || opacity <= 0) return;
    const rowH = h / (hi - lo);
    const srcY = this.maxMidi - top;
    const srcH = top - bottom + 1;
    const destY = (hi - top) * rowH - rowH / 2;
    const destH = srcH * rowH;
    const first = Math.max(0, Math.floor(t0 * this.gridHz) - 1);
    const last = Math.min(this.frames, Math.ceil(t1 * this.gridHz) + 2);

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.imageSmoothingEnabled = false;
    for (const tile of this.tiles) {
      const s = Math.max(first, tile.f0);
      const e = Math.min(last, tile.f0 + tile.width);
      if (e <= s) continue;
      const destX = xScale * ((s - 0.5) / this.gridHz) + xOffset;
      const destW = ((e - s) / this.gridHz) * xScale;
      ctx.drawImage(tile.canvas, s - tile.f0, srcY, e - s, srcH, destX, destY, destW, destH);
    }
    ctx.restore();
  }
}

/** 0-255 strength per frame and semitone for the chosen view. */
export function strengths(data: SpectrogramData, view: SpectrogramView, rangeDb: number, notes: number) {
  const source = view === 'raw' ? data.raw : data.harmonic;
  // Harmonic values are sums of square-rooted magnitudes, so 40 log10 puts them on a dB-like scale.
  const scale = view === 'raw' ? 20 : 40;
  const db = new Float32Array(source.length);
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < source.length; i += 1) {
    const value = scale * Math.log10(source[i] + 1e-9);
    db[i] = value;
    if (value > max) max = value;
  }
  const floor = max - rangeDb;
  const out = new Uint8ClampedArray(source.length);
  const sorted = new Float32Array(notes);

  for (let f = 0; f < data.frames; f += 1) {
    const base = f * notes;
    let median = Number.NEGATIVE_INFINITY;
    if (view !== 'raw') {
      sorted.set(db.subarray(base, base + notes));
      sorted.sort();
      median = sorted[notes >> 1];
    }
    for (let k = 0; k < notes; k += 1) {
      const value = db[base + k];
      let level = (value - floor) / rangeDb;
      if (level <= 0) continue;
      if (view !== 'raw') level *= Math.min(1, Math.max(0, (value - median - 3) / STAND_OUT_DB));
      if (view === 'peaks') {
        const below = k > 0 ? db[base + k - 1] : Number.NEGATIVE_INFINITY;
        const above = k < notes - 1 ? db[base + k + 1] : Number.NEGATIVE_INFINITY;
        if (value < below || value < above) level *= NON_PEAK_GAIN;
        else if (k >= 12 && db[base + k - 12] > value) level *= OVERTONE_GAIN;
      }
      out[base + k] = Math.round(Math.min(1, level) * 255);
    }
  }
  return out;
}
