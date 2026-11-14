import type { NoteSet } from '../../audio/noteSet';
import { graphPalette } from '../../theme';
import { mapMidiToY, NOTE_FILL } from './draw';

/** Note bars, which (unlike runs) may overlap. */
export function drawNotes(
  ctx: CanvasRenderingContext2D,
  notes: NoteSet,
  t0: number,
  t1: number,
  xScale: number,
  xOffset: number,
  lo: number,
  hi: number,
  h: number,
  width: number,
  alpha: number,
  selectedId: string | null = null,
  /** Outline every note (pen mode), not only hand-edited ones. */
  outlineAll = false,
) {
  if (notes.count === 0) return;
  ctx.save();
  // Hand-edited notes are drawn stronger and outlined so you can tell them apart.
  const manualAlpha = Math.min(1, Math.max(alpha * 2, 0.6));
  let selected: { x: number; y: number; w: number; h: number } | null = null;
  notes.forEachOverlapping(t0 - 2 / xScale, t1, (note) => {
    const left = Math.max(0, xScale * note.start + xOffset);
    const right = Math.min(width, xScale * note.end + xOffset);
    if (right <= 0 || left >= width) return;
    const top = mapMidiToY(note.midi + 0.5, h, lo, hi);
    const bottom = mapMidiToY(note.midi - 0.5, h, lo, hi);
    const x = left;
    const y = Math.min(top, bottom);
    const w = Math.max(2, right - left);
    const barHeight = Math.abs(bottom - top);
    const manual = note.origin === 'manual';
    ctx.globalAlpha = manual ? manualAlpha : alpha;
    ctx.fillStyle = NOTE_FILL[((note.midi % 12) + 12) % 12];
    ctx.fillRect(x, y, w, barHeight);
    if (manual || outlineAll) {
      ctx.globalAlpha = manual ? 0.8 : 0.35;
      ctx.strokeStyle = graphPalette.ink;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, barHeight - 1));
    }
    if (note.id === selectedId) selected = { x, y, w, h: barHeight };
  });
  if (selected) {
    const box = selected as { x: number; y: number; w: number; h: number };
    ctx.globalAlpha = 1;
    ctx.strokeStyle = graphPalette.ink;
    ctx.lineWidth = 2;
    ctx.strokeRect(box.x - 1, box.y - 1, box.w + 2, box.h + 2);
  }
  ctx.restore();
}

