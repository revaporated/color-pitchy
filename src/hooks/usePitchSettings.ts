import { useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { DetectionFilter } from '../utils/pitch';

const PREFIX = 'color-pitchy:';

/** useState that survives reloads via localStorage. */
export function usePersistentState<T>(
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === typeof initial) return parsed as T;
      }
    } catch {
      // storage unavailable or corrupt: fall back to the default
    }
    return initial;
  });

  useEffect(() => {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      // ignore quota / privacy-mode errors
    }
  }, [key, value]);

  return [value, setValue];
}

/** Detection and display settings shared by Live and Studio. */
export function usePitchSettings() {
  const [clarityThreshold, setClarityThreshold] = usePersistentState('clarityThreshold', 0.9);
  const [centsThreshold, setCentsThreshold] = usePersistentState('centsThreshold', 25);
  const [historyDuration, setHistoryDuration] = usePersistentState('historyDuration', 4);
  const [fftSize, setFftSize] = usePersistentState('fftSize', 2048);
  const [colorizeMarker, setColorizeMarker] = usePersistentState('colorizeMarker', true);
  const [showNoteLines, setShowNoteLines] = usePersistentState('showNoteLines', false);
  const [showNoteTrails, setShowNoteTrails] = usePersistentState('showNoteTrails', false);
  const [trailOpacity, setTrailOpacity] = usePersistentState('trailOpacity', 0.28);
  const [showDiagnostics, setShowDiagnostics] = usePersistentState('showDiagnostics', false);
  const [minDetectableNote, setMinDetectableNote] = usePersistentState('minDetectableNote', 36);
  const [maxDetectableNote, setMaxDetectableNote] = usePersistentState('maxDetectableNote', 96);

  const filter: DetectionFilter = useMemo(
    () => ({
      clarityThreshold,
      centsThreshold,
      minMidi: minDetectableNote,
      maxMidi: maxDetectableNote,
    }),
    [clarityThreshold, centsThreshold, minDetectableNote, maxDetectableNote],
  );

  // Shaped to spread straight into <PitchControls />.
  const controls = {
    clarityThreshold,
    centsThreshold,
    historyDuration,
    fftSize,
    colorizeMarker,
    showNoteLines,
    showNoteTrails,
    trailOpacity,
    showDiagnostics,
    minDetectableNote,
    maxDetectableNote,
    setClarityThreshold,
    setCentsThreshold,
    setHistoryDuration,
    setFftSize,
    setColorizeMarker,
    setShowNoteLines,
    setShowNoteTrails,
    setTrailOpacity,
    setShowDiagnostics,
    setMinDetectableNote,
    setMaxDetectableNote,
  };

  return { controls, filter };
}

/** Settings that only Studio uses. */
export function useStudioSettings() {
  const [recordTake, setRecordTake] = usePersistentState('studio.recordTake', false);
  const [onlyWhilePlaying, setOnlyWhilePlaying] = usePersistentState('studio.onlyWhilePlaying', true);
  const [showReference, setShowReference] = usePersistentState('studio.showReference', true);
  const [referenceClarity, setReferenceClarity] = usePersistentState('studio.referenceClarity', 0.8);
  const [topVoiceReference, setTopVoiceReference] = usePersistentState('studio.topVoiceReference', false);
  const [referenceOpacity, setReferenceOpacity] = usePersistentState('studio.referenceOpacity', 0.16);
  const [syncOffsetMs, setSyncOffsetMs] = usePersistentState('studio.syncOffsetMs', 0);

  return {
    recordTake,
    setRecordTake,
    onlyWhilePlaying,
    setOnlyWhilePlaying,
    showReference,
    setShowReference,
    referenceClarity,
    setReferenceClarity,
    referenceOpacity,
    setReferenceOpacity,
    topVoiceReference,
    setTopVoiceReference,
    syncOffsetMs,
    setSyncOffsetMs,
  };
}
