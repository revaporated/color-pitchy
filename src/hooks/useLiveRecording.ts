import { useCallback, useEffect, useRef, useState } from 'react';
import { FrameRing } from '../audio/frames';
import type { EngineFrame, PitchEngine } from '../audio/pitchEngine';
import { buildMidiFile, downloadBytes, formatTimestampFilename } from '../utils/midi';
import { collectPitches, segmentNotes } from '../utils/notes';
import type { DetectionFilter } from '../utils/pitch';

/** Upper bound on a Live recording: 30 minutes at the detection rate. */
const MAX_RECORDING_FRAMES = 165 * 60 * 30;

/**
 * Records raw frames in Live mode. Notes are built when you download, using
 * the current filter, so you can adjust thresholds after recording.
 */
export function useLiveRecording(engine: PitchEngine) {
  const framesRef = useRef<FrameRing | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStartAt, setRecordingStartAt] = useState<number | null>(null); // perf seconds
  const [lastRecording, setLastRecording] = useState<{ start: number; end: number } | null>(null);

  useEffect(() => {
    if (!isRecording) return;
    return engine.subscribe((frame: EngineFrame) => framesRef.current?.push(frame));
  }, [engine, isRecording]);

  const startRef = useRef<number | null>(null);

  const startRecording = useCallback(() => {
    framesRef.current = framesRef.current ?? new FrameRing(MAX_RECORDING_FRAMES);
    framesRef.current.clear();
    const now = performance.now() / 1000;
    startRef.current = now;
    setRecordingStartAt(now);
    setLastRecording(null);
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback(() => {
    const start = startRef.current;
    startRef.current = null;
    setIsRecording(false);
    setRecordingStartAt(null);
    if (start !== null) setLastRecording({ start, end: performance.now() / 1000 });
  }, []);

  const downloadMidi = useCallback(
    (filter: DetectionFilter) => {
      const frames = framesRef.current;
      if (!frames || !lastRecording) return 0;
      const pitches = collectPitches(frames, lastRecording.start, lastRecording.end, filter, lastRecording.start);
      const notes = segmentNotes(pitches);
      if (notes.length > 0) downloadBytes(buildMidiFile(notes), formatTimestampFilename(new Date()));
      return notes.length;
    },
    [lastRecording],
  );

  return {
    isRecording,
    recordingStartAt,
    canDownloadMidi: !isRecording && lastRecording !== null,
    startRecording,
    stopRecording,
    downloadMidi,
  };
}
