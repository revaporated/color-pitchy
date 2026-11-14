import { useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ProjectStore } from '../project/projectStore';
import { useProjectState } from '../project/useProject';
import type { AnalysisSettings } from './useReferenceTrack';
import type { SpectrogramView } from '../audio/spectrogramImage';
import type { BeatScale } from '../audio/beatGrid';
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

/**
 * Settings that only Studio uses. The reference and beat settings belong to
 * the open project (they depend on the song) and live in its store; the rest
 * depend on your setup and are global.
 */
export function useStudioSettings(store: ProjectStore) {
  const [recordTake, setRecordTake] = usePersistentState('studio.recordTake', false);
  const [onlyWhilePlaying, setOnlyWhilePlaying] = usePersistentState('studio.onlyWhilePlaying', true);
  const [syncOffsetMs, setSyncOffsetMs] = usePersistentState('studio.syncOffsetMs', 0);
  // Listening preferences, so global rather than per project.
  const [playReference, setPlayReference] = usePersistentState('studio.playReference', false);
  const [referenceVolume, setReferenceVolume] = usePersistentState('studio.referenceVolume', 0.5);
  const [trackVolume, setTrackVolume] = usePersistentState('studio.trackVolume', 1);
  const [showSpectrogram, setShowSpectrogram] = usePersistentState('studio.showSpectrogram', false);
  const [spectrogramView, setSpectrogramView] = usePersistentState<SpectrogramView>('studio.spectrogramView', 'peaks');
  const [spectrogramRange, setSpectrogramRange] = usePersistentState('studio.spectrogramRange', 50);
  const [spectrogramOpacity, setSpectrogramOpacity] = usePersistentState('studio.spectrogramOpacity', 0.6);
  const [showBeats, setShowBeats] = usePersistentState('studio.showBeats', true);
  const [snapLoopToBeats, setSnapLoopToBeats] = usePersistentState('studio.snapLoopToBeats', true);
  const [metronome, setMetronome] = usePersistentState('studio.metronome', false);
  const [metronomeVolume, setMetronomeVolume] = usePersistentState('studio.metronomeVolume', 0.6);

  // Per project: they depend on the song.
  const { settings } = useProjectState(store);
  const setters = useMemo(
    () => ({
      setShowReference: store.setter('showReference'),
      setReferenceClarity: store.setter('referenceClarity'),
      setReferenceOpacity: store.setter('referenceOpacity'),
      setBeatsPerGroup: store.setter('beatsPerGroup'),
      setBeatOffset: store.setter('beatOffset'),
      setPlaybackRate: store.setter('playbackRate'),
      setBeatScale: store.setter('beatScale') as Dispatch<SetStateAction<BeatScale>>,
      /** Applied analysis settings. The panel edits a draft and applies it with Analyze. */
      setAnalysis: (next: AnalysisSettings) =>
        store.updateSettings({
          topVoiceReference: next.method === 'topVoice',
          referenceSmoothing: next.smoothing,
          referenceWindowMs: next.windowMs,
          referenceMinMidi: next.minMidi,
          referenceMaxMidi: next.maxMidi,
        }),
    }),
    [store],
  );
  const beatScale: BeatScale = settings.beatScale === 0.5 ? 0.5 : settings.beatScale === 2 ? 2 : 1;
  const { topVoiceReference, referenceSmoothing, referenceWindowMs, referenceMinMidi, referenceMaxMidi } = settings;
  const analysis: AnalysisSettings = useMemo(
    () => ({
      method: topVoiceReference ? 'topVoice' : 'pitchy',
      smoothing: referenceSmoothing,
      windowMs: referenceWindowMs,
      minMidi: referenceMinMidi,
      maxMidi: referenceMaxMidi,
    }),
    [topVoiceReference, referenceSmoothing, referenceWindowMs, referenceMinMidi, referenceMaxMidi],
  );

  return {
    ...setters,
    recordTake,
    setRecordTake,
    onlyWhilePlaying,
    setOnlyWhilePlaying,
    showReference: settings.showReference,
    referenceClarity: settings.referenceClarity,
    referenceOpacity: settings.referenceOpacity,
    analysis,
    syncOffsetMs,
    setSyncOffsetMs,
    playReference,
    setPlayReference,
    referenceVolume,
    setReferenceVolume,
    trackVolume,
    setTrackVolume,
    showSpectrogram,
    setShowSpectrogram,
    spectrogramView,
    setSpectrogramView,
    spectrogramRange,
    setSpectrogramRange,
    spectrogramOpacity,
    setSpectrogramOpacity,
    showBeats,
    setShowBeats,
    snapLoopToBeats,
    setSnapLoopToBeats,
    metronome,
    setMetronome,
    metronomeVolume,
    setMetronomeVolume,
    beatScale,
    beatsPerGroup: settings.beatsPerGroup,
    beatOffset: settings.beatOffset,
    playbackRate: settings.playbackRate,
  };
}
