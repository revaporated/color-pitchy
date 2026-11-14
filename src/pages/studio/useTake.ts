import { useCallback, useEffect, useMemo, useRef } from 'react';
import { PitchTrack } from '../../audio/frames';
import type { PitchEngine } from '../../audio/pitchEngine';
import type { PlaybackClock } from '../../audio/playbackClock';
import { saveTake, type TakeRecord } from '../../storage/projects';

export const TAKE_GRID_HZ = 200;

type Options = {
  projectId: string;
  duration: number;
  /** The saved take to restore once the track has decoded (null after a track change). */
  storedTake: TakeRecord | null;
  engine: PitchEngine;
  clock: PlaybackClock;
  hasAudio: boolean;
  studio: { recordTake: boolean; syncOffsetMs: number };
};

/**
 * Your sung pitch in song time: the recorded take (autosaved) and the short
 * preview trail. Mic frames are written at the song position they were sung at.
 */
export function useTake({ projectId, duration, storedTake, engine, clock, hasAudio, studio }: Options) {
  // `take` keeps what you record. `preview` always follows the mic while the
  // track plays and is drawn as a short trail behind the playhead when you
  // aren't recording; it's cleared on every seek so it only shows this pass.
  const take = useMemo(() => {
    const track = new PitchTrack(duration, TAKE_GRID_HZ);
    if (duration > 0 && storedTake && storedTake.gridHz === TAKE_GRID_HZ) {
      const n = Math.min(track.length, storedTake.frequency.length, storedTake.clarity.length);
      track.frequency.set(storedTake.frequency.subarray(0, n));
      track.clarity.set(storedTake.clarity.subarray(0, n));
    }
    return track;
  }, [duration, storedTake]);

  // Autosave the take: every couple of seconds while it changes, when the tab
  // is hidden, and on leaving Studio. `flushTakeRef` saves it now.
  const flushTakeRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => {
    let savedVersion = take.version;
    const flush = () => {
      if (take.version === savedVersion) return Promise.resolve();
      savedVersion = take.version;
      const record = take.hasData()
        ? { gridHz: take.gridHz, frequency: take.frequency.slice(), clarity: take.clarity.slice() }
        : null;
      return saveTake(projectId, record).catch((err) => console.error('Saving the take failed', err));
    };
    flushTakeRef.current = flush;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    const timer = setInterval(flush, 2000);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      void flush();
    };
  }, [take, projectId]);
  const preview = useMemo(() => new PitchTrack(duration, TAKE_GRID_HZ), [duration]);
  // Write mic frames onto the take at the song position they were sung at.
  const recordingRef = useRef(false);
  const offsetSecondsRef = useRef(0);
  useEffect(() => {
    recordingRef.current = studio.recordTake && hasAudio;
    offsetSecondsRef.current = studio.syncOffsetMs / 1000;
  }, [studio.recordTake, studio.syncOffsetMs, hasAudio]);

  useEffect(
    () =>
      engine.subscribe((frame) => {
        // The frame loop syncs the clock every animation frame. Only sync here
        // when it has fallen behind, e.g. the tab is hidden and rAF is paused.
        if (performance.now() - clock.lastSyncPerfMs > 100) clock.sync();
        if (!clock.isPlaying) return;
        const perfMs = frame.time * 1000;
        if (perfMs < clock.discontinuityPerfMs) return; // sung before the last seek
        const songTime = clock.songTimeAt(perfMs) - offsetSecondsRef.current;
        preview.write(songTime, frame.frequency, frame.clarity);
        if (recordingRef.current) take.write(songTime, frame.frequency, frame.clarity);
      }),
    [engine, clock, take, preview],
  );

  const resetPreview = useCallback(() => {
    take.breakContinuity();
    preview.clear();
  }, [preview, take]);

  return { take, preview, flushTakeRef, resetPreview };
}
