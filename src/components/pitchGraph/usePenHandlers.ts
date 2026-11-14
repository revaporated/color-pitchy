import { useEffect, useRef } from 'react';
import type { MouseEvent, PointerEvent, RefObject } from 'react';
import { MIN_NOTE_SECONDS, newManualId, type NoteSpan } from '../../audio/noteEdits';
import type { RefNote } from '../../audio/noteSet';
import type { DetectionFilter } from '../../utils/pitch';
import type { LiveGraphMode, PenGesture, TimelineGraphMode } from './types';

/** Length of a note made by a single click (no drag). */
const CLICK_NOTE_SECONDS = 0.25;
/** Pointer this close (px) to a note's end grabs the end for trimming. */
const EDGE_PX = 6;
/** Movement (px) before a press counts as a drag. */
const DRAG_PX = 3;

type PenDrag = {
  pointerId: number;
  kind: 'create' | 'move' | 'trim-start' | 'trim-end';
  note: RefNote | null;
  newId: string;
  downX: number;
  downY: number;
  downTime: number;
  downMidi: number;
  moved: boolean;
  lastMidi: number;
  last: PenGesture | null;
};

/**
 * Pen mode on the timeline graph: pointer handlers that turn presses and drags
 * into note gestures (create, move, trim), Escape to cancel, right-click to delete.
 * Reads the graph's latest props from `propsRef`, so the handlers never go stale.
 */
export function usePenHandlers(
  propsRef: RefObject<{
    mode: LiveGraphMode | TimelineGraphMode;
    filter: DetectionFilter;
    range?: { minMidi: number; maxMidi: number };
  }>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  sizeRef: RefObject<{ width: number; height: number }>,
) {
  const penDrag = useRef<PenDrag | null>(null);

  /** Song time, semitone and pixel position under the pointer (timeline only). */
  const locate = (event: { clientX: number; clientY: number }) => {
    const { mode, filter, range } = propsRef.current;
    const canvas = canvasRef.current;
    if (mode.kind !== 'timeline' || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const { view } = mode;
    const axis = range ?? filter;
    const lo = axis.minMidi;
    const hi = Math.max(axis.maxMidi, lo + 1);
    const h = sizeRef.current.height;
    return {
      x,
      y,
      time: Math.max(0, view.xToTime(x)),
      midi: Math.round(hi - (y / h) * (hi - lo)),
      toX: (time: number) => view.timeToX(time),
      slack: 3 / view.pixelsPerSecond,
    };
  };

  const penOptions = () => {
    const { mode } = propsRef.current;
    return mode.kind === 'timeline' && mode.pen ? { pen: mode.pen, notes: mode.reference } : null;
  };

  /** What a press here would do: which note, and which part of it. */
  const penTarget = (spot: NonNullable<ReturnType<typeof locate>>) => {
    const notes = penOptions()?.notes;
    const note = notes?.noteAt(spot.time, spot.midi, spot.slack) ?? null;
    if (!note) return { note: null, kind: 'create' as const };
    const startX = spot.toX(note.start);
    const endX = spot.toX(note.end);
    const wide = endX - startX >= EDGE_PX * 3;
    if (Math.abs(spot.x - endX) <= EDGE_PX && spot.x >= startX + 2) return { note, kind: 'trim-end' as const };
    if (wide && Math.abs(spot.x - startX) <= EDGE_PX) return { note, kind: 'trim-start' as const };
    return { note, kind: 'move' as const };
  };

  const gestureFor = (drag: PenDrag, spot: NonNullable<ReturnType<typeof locate>>, pitchOnly: boolean): PenGesture => {
    if (drag.kind === 'create' || !drag.note) {
      const end = drag.moved ? spot.time : drag.downTime + CLICK_NOTE_SECONDS;
      return {
        kind: 'create',
        id: drag.newId,
        span: { midi: drag.downMidi, start: Math.min(drag.downTime, end), end: Math.max(drag.downTime, end) },
      };
    }
    const note = drag.note;
    let span: NoteSpan;
    if (drag.kind === 'move') {
      const dt = pitchOnly ? 0 : Math.max(-note.start, spot.time - drag.downTime);
      span = { midi: note.midi + spot.midi - drag.downMidi, start: note.start + dt, end: note.end + dt };
    } else if (drag.kind === 'trim-start') {
      span = { midi: note.midi, start: Math.min(spot.time, note.end - MIN_NOTE_SECONDS), end: note.end };
    } else {
      span = { midi: note.midi, start: note.start, end: Math.max(spot.time, note.start + MIN_NOTE_SECONDS) };
    }
    return { kind: 'edit', note, newId: drag.newId, span };
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const options = penOptions();
    if (!options || event.button !== 0) return;
    const spot = locate(event);
    if (!spot) return;
    event.preventDefault();
    const target = penTarget(spot);
    event.currentTarget.setPointerCapture(event.pointerId);
    penDrag.current = {
      pointerId: event.pointerId,
      kind: target.kind,
      note: target.note,
      newId: target.note?.origin === 'manual' ? target.note.id : newManualId(),
      downX: spot.x,
      downY: spot.y,
      downTime: spot.time,
      downMidi: spot.midi,
      moved: false,
      lastMidi: target.note?.midi ?? spot.midi,
      last: null,
    };
    options.pen.onSelect(target.note?.id ?? null);
    options.pen.onAudition?.(target.note?.midi ?? spot.midi);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const options = penOptions();
    const spot = options ? locate(event) : null;
    if (!options || !spot) {
      event.currentTarget.style.cursor = '';
      return;
    }
    const drag = penDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      // Hover: show what a press would do.
      const kind = penTarget(spot).kind;
      event.currentTarget.style.cursor =
        kind === 'create' ? 'crosshair' : kind === 'move' ? 'grab' : 'ew-resize';
      return;
    }
    if (!drag.moved && Math.hypot(spot.x - drag.downX, spot.y - drag.downY) < DRAG_PX) return;
    drag.moved = true;
    const gesture = gestureFor(drag, spot, event.shiftKey);
    drag.last = gesture;
    options.pen.onGesture(gesture, 'preview');
    if (gesture.span.midi !== drag.lastMidi) {
      drag.lastMidi = gesture.span.midi;
      options.pen.onAudition?.(gesture.span.midi);
    }
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const drag = penDrag.current;
    const options = penOptions();
    if (!drag || drag.pointerId !== event.pointerId) return;
    penDrag.current = null;
    if (!options) return;
    if (cancelled) {
      if (drag.last) options.pen.onGesture(drag.last, 'cancel');
      return;
    }
    const spot = locate(event);
    if (drag.kind === 'create' && spot) {
      // A click (no drag) makes a note of default length.
      options.pen.onGesture(gestureFor(drag, spot, event.shiftKey), 'commit');
      return;
    }
    if (drag.moved && spot) options.pen.onGesture(gestureFor(drag, spot, event.shiftKey), 'commit');
  };

  // Escape cancels a drag in progress.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !penDrag.current) return;
      const drag = penDrag.current;
      penDrag.current = null;
      const { mode } = propsRef.current;
      if (mode.kind === 'timeline' && mode.pen && drag.last) mode.pen.onGesture(drag.last, 'cancel');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [propsRef]);

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    const options = penOptions();
    const spot = options ? locate(event) : null;
    if (!options || !spot) return;
    event.preventDefault();
    const note = options.notes?.noteAt(spot.time, spot.midi, spot.slack);
    if (note) options.pen.onDelete(note);
  };

  return { penDrag, handlePointerDown, handlePointerMove, finishDrag, handleContextMenu };
}
