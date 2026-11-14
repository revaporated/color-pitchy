import { useEffect, useMemo } from 'react';
import { BeatGrid } from '../../audio/beatGrid';
import { BEAT_DETECTOR_VERSION, useBeats, type BeatState } from '../../hooks/useBeats';
import type { MonoTrack } from '../../hooks/useReferenceTrack';
import type { ProjectStore } from '../../project/projectStore';
import { useProjectState } from '../../project/useProject';
import type { AudioRecord } from '../../storage/projects';

/** The track's beats (saved with the project, or detected once) and the grid built from them. */
export function useProjectBeats(
  store: ProjectStore,
  audio: AudioRecord | null,
  mono: MonoTrack | null,
  studio: { beatScale: 0.5 | 1 | 2; beatsPerGroup: number; beatOffset: number },
) {
  // Beats: detected once per track and saved with the project, so reopening
  // shows them at once. The grid applies your tempo and bar fixes.
  const { beats: projectBeats } = useProjectState(store);
  const savedBeats =
    projectBeats && audio && projectBeats.audioId === audio.id && projectBeats.version === BEAT_DETECTOR_VERSION
      ? projectBeats
      : null;
  const detectedBeats = useBeats(savedBeats ? null : mono);
  const savedBeatState: BeatState | null = useMemo(
    () => (savedBeats ? { status: 'ready', beats: Float64Array.from(savedBeats.times), bpm: savedBeats.bpm } : null),
    [savedBeats],
  );
  const beatDetection = savedBeatState ?? detectedBeats;
  useEffect(() => {
    if (savedBeats || !audio || detectedBeats.status !== 'ready') return;
    store.setBeats({
      version: BEAT_DETECTOR_VERSION,
      audioId: audio.id,
      times: Array.from(detectedBeats.beats),
      bpm: detectedBeats.bpm,
    });
  }, [store, savedBeats, audio, detectedBeats]);
  const beatGrid = useMemo(
    () =>
      beatDetection.beats
        ? new BeatGrid(beatDetection.beats, studio.beatScale, studio.beatsPerGroup, studio.beatOffset)
        : null,
    [beatDetection.beats, studio.beatScale, studio.beatsPerGroup, studio.beatOffset],
  );

  return { beatDetection, beatGrid };
}
