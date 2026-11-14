import { useMemo } from 'react';
import type { PitchTrack } from '../../audio/frames';
import { NoteSet } from '../../audio/noteSet';
import type { AnalysisSettings } from '../../hooks/useReferenceTrack';
import type { DetectionFilter } from '../../utils/pitch';

/** The reference contour as notes, before your edits, and the filter that keeps them. */
export function useReferenceNotes(
  reference: { track: PitchTrack | null },
  duration: number,
  analysis: AnalysisSettings,
  studio: { referenceClarity: number },
  filter: DetectionFilter,
) {
  const referenceFilter: DetectionFilter = useMemo(
    () => ({
      clarityThreshold: studio.referenceClarity,
      centsThreshold: 50, // recorded performances drift; don't cents-gate the reference
      minMidi: filter.minMidi,
      maxMidi: filter.maxMidi,
    }),
    [studio.referenceClarity, filter.minMidi, filter.maxMidi],
  );

  // The reference as notes: what the graph draws, the player plays and the
  // MIDI export writes. A tracked top-voice contour is already smooth, so it
  // skips the median filter and keeps shorter notes.
  const trackedReference = analysis.method === 'topVoice' && analysis.smoothing > 0;
  const autoNotes = useMemo(
    () =>
      reference.track
        ? NoteSet.fromContour(reference.track, duration, referenceFilter, {
            medianWindow: trackedReference ? 1 : 5,
            minDuration: trackedReference ? 0.05 : 0.08,
          })
        : null,
    [reference.track, duration, referenceFilter, trackedReference],
  );

  return { referenceFilter, autoNotes };
}
