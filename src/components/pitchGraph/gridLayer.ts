import { graphPalette } from '../../theme';
import { midiToNoteIndex } from '../../utils/pitch';
import { mapMidiToY } from './draw';

/** Octave lines and labels, plus optional semitone lines. Cached on an offscreen canvas by the graph. */
export function drawStaticLayer(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  lo: number,
  hi: number,
  showNoteLines: boolean,
) {
  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = 1;

  if (showNoteLines) {
    ctx.save();
    ctx.strokeStyle = graphPalette.grid;
    ctx.globalAlpha = 0.4;
    for (let midi = Math.ceil(lo); midi <= hi; midi += 1) {
      if (midiToNoteIndex(midi) === 0) continue;
      const y = mapMidiToY(midi, height, lo, hi);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Octave lines on every C in range.
  ctx.strokeStyle = graphPalette.grid;
  ctx.fillStyle = graphPalette.label;
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'left';
  for (let midi = Math.ceil(lo / 12) * 12; midi <= hi; midi += 12) {
    const y = mapMidiToY(midi, height, lo, hi);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.fillText(`C${midi / 12 - 1}`, 6, y - 4);
  }
}

