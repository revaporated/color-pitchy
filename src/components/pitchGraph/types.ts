import type { RefObject } from 'react';
import type { BeatGrid } from '../../audio/beatGrid';
import type { FrameSource } from '../../audio/frames';
import type { NoteSpan } from '../../audio/noteEdits';
import type { NoteSet, RefNote } from '../../audio/noteSet';
import type { PlaybackClock } from '../../audio/playbackClock';
import type { SpectrogramImage } from '../../audio/spectrogramImage';

/** Live: a rolling window ending "now" on the performance clock. */
export type LiveGraphMode = {
  kind: 'live';
  source: FrameSource;
  historyDuration: number; // seconds
  /** performance seconds to freeze the view at (detection stopped), or null to follow now */
  frozenAt: number | null;
  recordingStartAt: number | null; // performance seconds
};

/** Timeline: x axis is song time, scrolled in lockstep with the waveform viewport. */
export type TimelineGraphMode = {
  kind: 'timeline';
  viewportRef: RefObject<HTMLDivElement | null>;
  pixelsPerSecond: number;
  clock: PlaybackClock;
  take: FrameSource;
  /** Recent mic pitch shown behind the playhead when not recording a take. */
  preview: FrameSource | null;
  /** How many seconds of `preview` to show behind the playhead. */
  previewSeconds: number;
  /** Reference notes, drawn as bars. May overlap (chords, several voices). */
  reference: NoteSet | null;
  referenceOpacity: number;
  /** The waveform's playhead x (viewport px). The graph draws its playhead there so the two line up exactly. */
  playheadXRef?: RefObject<number | null>;
  /** Draw the current mic pitch at the playhead. */
  showLiveMarker: boolean;
  /** Beat ticks and alternating group shading. Null when off. */
  beats?: BeatGrid | null;
  /** The track's spectrogram, drawn behind everything else. Null when off. */
  spectrogram?: SpectrogramImage | null;
  spectrogramOpacity?: number;
  /** Pen mode: edit the reference notes with the mouse. Null when off. */
  pen?: PenOptions | null;
};

/**
 * A pen gesture on a reference note. `create` draws a new note; `edit` moves
 * or trims an existing one. For an auto note, `newId` is the id its edited
 * copy gets (see updateNote).
 */
export type PenGesture =
  | { kind: 'create'; id: string; span: NoteSpan }
  | { kind: 'edit'; note: RefNote; newId: string; span: NoteSpan };

export type PenOptions = {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** `preview` while dragging, then `commit` on release or `cancel` (Escape). */
  onGesture: (gesture: PenGesture, phase: 'preview' | 'commit' | 'cancel') => void;
  onDelete: (note: RefNote) => void;
  /** Play a short tone so you hear a pitch as you place it. */
  onAudition?: (midi: number) => void;
};
