import { useCallback, useEffect, useState } from 'react';
import type { PitchSample } from './usePitchDetector';
import {
  buildMidiBlob,
  buildNotesFromSamples,
  formatMidiFilename,
  type RecordedNote,
  type RecordedPitchSample,
} from '../utils/recording';

type Options = {
  sample: PitchSample;
  enabled: boolean;
};

type PitchRecordingState = {
  isRecording: boolean;
  recordingStartAt: number | null;
  recordedNotes: RecordedNote[];
  canDownloadMidi: boolean;
  startRecording: () => void;
  stopRecording: () => void;
  downloadMidi: () => void;
};

export const usePitchRecording = ({
  sample,
  enabled,
}: Options): PitchRecordingState => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStartAt, setRecordingStartAt] = useState<number | null>(null);
  const [recordingSamples, setRecordingSamples] = useState<RecordedPitchSample[]>(
    []
  );
  const [recordedNotes, setRecordedNotes] = useState<RecordedNote[]>([]);
  const [midiDownloadUrl, setMidiDownloadUrl] = useState<string | null>(null);
  const [midiFilename, setMidiFilename] = useState<string | null>(null);

  const finalizeRecording = useCallback(
    (samples: RecordedPitchSample[], recordingEndMs: number) => {
      const notes = buildNotesFromSamples(samples, recordingEndMs);
      const midiBlob = buildMidiBlob(notes);

      setRecordedNotes(notes);
      setMidiFilename(notes.length > 0 ? formatMidiFilename(new Date()) : null);
      setIsRecording(false);
      setRecordingStartAt(null);
      setRecordingSamples([]);

      setMidiDownloadUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return midiBlob ? URL.createObjectURL(midiBlob) : null;
      });
    },
    []
  );

  useEffect(() => {
    if (!isRecording || recordingStartAt == null || sample.timestamp === 0) return;

    const timestampMs = Math.max(0, sample.timestamp - recordingStartAt);
    setRecordingSamples((prev) => [
      ...prev,
      { timestampMs, midi: sample.midi, clarity: sample.clarity },
    ]);
  }, [isRecording, recordingStartAt, sample]);

  useEffect(() => {
    if (enabled || !isRecording) return;

    const now = performance.now();
    const startAt = recordingStartAt ?? now;
    const recordingEndMs = Math.max(0, now - startAt);
    finalizeRecording(recordingSamples, recordingEndMs);
  }, [enabled, isRecording, recordingSamples, recordingStartAt, finalizeRecording]);

  useEffect(() => {
    return () => {
      if (midiDownloadUrl) {
        URL.revokeObjectURL(midiDownloadUrl);
      }
    };
  }, [midiDownloadUrl]);

  const startRecording = useCallback(() => {
    const startAt = performance.now();
    setRecordingStartAt(startAt);
    setRecordingSamples([]);
    setRecordedNotes([]);
    setMidiFilename(null);
    setIsRecording(true);
    setMidiDownloadUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const stopRecording = useCallback(() => {
    const now = performance.now();
    const startAt = recordingStartAt ?? now;
    const recordingEndMs = Math.max(0, now - startAt);
    finalizeRecording(recordingSamples, recordingEndMs);
  }, [finalizeRecording, recordingSamples, recordingStartAt]);

  const downloadMidi = useCallback(() => {
    if (!midiDownloadUrl) return;

    const link = document.createElement('a');
    link.href = midiDownloadUrl;
    link.download = midiFilename ?? formatMidiFilename(new Date());
    link.click();
  }, [midiDownloadUrl, midiFilename]);

  const canDownloadMidi = Boolean(midiDownloadUrl && recordedNotes.length > 0);

  return {
    isRecording,
    recordingStartAt,
    recordedNotes,
    canDownloadMidi,
    startRecording,
    stopRecording,
    downloadMidi,
  };
};
