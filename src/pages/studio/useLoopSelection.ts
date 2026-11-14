import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { BeatGrid } from '../../audio/beatGrid';
import { FRAME_ORDER, onAnimationFrame } from '../../audio/frameLoop';

export type Selection = { start: number; end: number };

/** The selected passage and the loop over it (snapped to beats when `snapGrid` is set). */
export function useLoopSelection(
  audioRef: RefObject<HTMLAudioElement>,
  isPlaying: boolean,
  playPause: () => void,
  seekTo: (time: number) => void,
  snapGrid: BeatGrid | null,
) {
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);

  const handleSelectionChange = useCallback(
    (next: Selection | null) => {
      const snapped =
        next && snapGrid ? { start: snapGrid.nearest(next.start), end: snapGrid.nearest(next.end) } : next;
      setSelection(snapped);
      setLoopEnabled(Boolean(snapped));
    },
    [snapGrid],
  );

  const handleSelectionClear = useCallback(() => {
    setSelection(null);
    setLoopEnabled(false);
  }, []);

  const handlePlayPause = useCallback(() => {
    if (!isPlaying && loopEnabled && selection) {
      const start = Math.min(selection.start, selection.end);
      const end = Math.max(selection.start, selection.end);
      const position = audioRef.current?.currentTime ?? 0;
      if (position < start || position > end) seekTo(start);
    }
    playPause();
  }, [audioRef, isPlaying, loopEnabled, playPause, seekTo, selection]);

  // Loop the selection. Checked every animation frame against the audio element
  // itself, since the React currentTime state isn't updated during playback.
  useEffect(() => {
    if (!isPlaying || !loopEnabled || !selection) return;
    const start = Math.min(selection.start, selection.end);
    const end = Math.max(selection.start, selection.end);
    if (end - start < 0.05) return;

    return onAnimationFrame(() => {
      const audio = audioRef.current;
      if (audio && audio.currentTime >= end - 0.01) seekTo(start);
    }, FRAME_ORDER.clock - 1);
  }, [audioRef, isPlaying, loopEnabled, seekTo, selection]);

  const goToStart = () => {
    seekTo(loopEnabled && selection ? Math.min(selection.start, selection.end) : 0);
  };


  return {
    selection,
    setSelection,
    loopEnabled,
    setLoopEnabled,
    handleSelectionChange,
    handleSelectionClear,
    handlePlayPause,
    goToStart,
  };
}
