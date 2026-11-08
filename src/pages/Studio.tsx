import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { PitchTrack } from '../audio/frames';
import { PlaybackClock } from '../audio/playbackClock';
import { AudioUpload } from '../components/AudioUpload';
import { NavBar } from '../components/NavBar';
import { PitchControls } from '../components/PitchControls';
import { PitchGraph } from '../components/PitchGraph';
import { PitchStats } from '../components/PitchStats';
import { PlaybackControls } from '../components/PlaybackControls';
import { StudioControls } from '../components/StudioControls';
import { WaveformViewer } from '../components/WaveformViewer';
import { useAudioFile } from '../hooks/useAudioFile';
import { useAudioPlayback } from '../hooks/useAudioPlayback';
import { useEngineStats, usePitchEngine } from '../hooks/usePitchEngine';
import { usePitchSettings, useStudioSettings } from '../hooks/usePitchSettings';
import { useReferenceTrack } from '../hooks/useReferenceTrack';
import { buildMidiFile, downloadBytes } from '../utils/midi';
import { collectPitches, segmentNotes } from '../utils/notes';
import type { DetectionFilter } from '../utils/pitch';
import { PIXELS_PER_SECOND } from '../utils/waveform';

const TAKE_GRID_HZ = 200;
const GRAPH_HEIGHT = 420;

type Selection = { start: number; end: number };

/**
 * Studio mode: everything in Live, plus a track. The pitch graph shares the
 * waveform's x axis, so the take is drawn at the song position it was sung at,
 * on top of the track's own pitch contour, and stays put when you seek.
 */
export default function StudioPage() {
  const { controls, filter } = usePitchSettings();
  const studio = useStudioSettings();

  const { audioUrl, audioBuffer, fileName, isDecoding, error, duration, setError, handleFileChange } =
    useAudioFile();
  const handlePlayError = useCallback(() => setError('Unable to start playback.'), [setError]);
  const { audioRef, isPlaying, currentTime, playPause, stop, seek } = useAudioPlayback({
    onPlayError: handlePlayError,
  });
  const hasAudio = Boolean(audioUrl && audioBuffer);

  // Mic
  const [armed, setArmed] = useState(false);
  const detectionActive = !studio.onlyWhilePlaying || isPlaying;
  const { engine, error: micError } = usePitchEngine({
    armed,
    fftSize: controls.fftSize,
    active: detectionActive,
  });
  const { sample } = useEngineStats(engine, filter);

  // Song clock, take and reference
  const [clock] = useState(() => new PlaybackClock());
  useEffect(() => {
    clock.attach(audioRef.current);
    return () => clock.attach(null);
  }, [clock, audioRef]);

  const take = useMemo(() => new PitchTrack(duration, TAKE_GRID_HZ), [duration]);
  const reference = useReferenceTrack(audioBuffer);
  const referenceFilter: DetectionFilter = useMemo(
    () => ({
      clarityThreshold: studio.referenceClarity,
      centsThreshold: 50, // recorded performances drift; don't cents-gate the reference
      minMidi: filter.minMidi,
      maxMidi: filter.maxMidi,
    }),
    [studio.referenceClarity, filter.minMidi, filter.maxMidi],
  );

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
        if (!recordingRef.current) return;
        clock.sync();
        if (!clock.isPlaying) return;
        const perfMs = frame.time * 1000;
        if (perfMs < clock.discontinuityPerfMs) return; // sung before the last seek
        take.write(clock.songTimeAt(perfMs) - offsetSecondsRef.current, frame.frequency, frame.clarity);
      }),
    [engine, clock, take],
  );

  // Waveform view state
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<'pan' | 'select'>('pan');
  const [panMode, setPanMode] = useState<'scroll' | 'scrub'>('scroll');
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  const seekTo = useCallback(
    (time: number) => {
      take.breakContinuity();
      seek(Math.max(0, Math.min(time, duration || time)));
    },
    [duration, seek, take],
  );

  const handleUpload = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      stop();
      setSelection(null);
      setLoopEnabled(false);
      handleFileChange(event);
    },
    [handleFileChange, stop],
  );

  const handleSelectionChange = useCallback((next: Selection | null) => {
    setSelection(next);
    setLoopEnabled(Boolean(next));
  }, []);

  const handleSelectionClear = useCallback(() => {
    setSelection(null);
    setLoopEnabled(false);
  }, []);

  const handlePlayPause = useCallback(() => {
    if (!isPlaying && loopEnabled && selection) {
      const start = Math.min(selection.start, selection.end);
      const end = Math.max(selection.start, selection.end);
      if (currentTime < start || currentTime > end) seekTo(start);
    }
    playPause();
  }, [currentTime, isPlaying, loopEnabled, playPause, seekTo, selection]);

  // Loop the selection. Checked every animation frame against the audio element
  // itself, since the React currentTime state is throttled.
  useEffect(() => {
    if (!isPlaying || !loopEnabled || !selection) return;
    const start = Math.min(selection.start, selection.end);
    const end = Math.max(selection.start, selection.end);
    if (end - start < 0.05) return;

    let rafId = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio && audio.currentTime >= end - 0.01) seekTo(start);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [audioRef, isPlaying, loopEnabled, seekTo, selection]);

  // Take / reference actions
  const baseName = fileName ? fileName.replace(/\.[^.]+$/, '') : 'track';

  const clearTake = () => {
    if (take.hasData() && !window.confirm('Clear the recorded take?')) return;
    take.clear();
  };

  const exportTake = () => {
    const notes = segmentNotes(collectPitches(take, 0, duration, filter));
    if (notes.length === 0) {
      window.alert('The take has no notes that pass the current detection filter.');
      return;
    }
    downloadBytes(buildMidiFile(notes), `${baseName}-take.mid`);
  };

  const exportReference = () => {
    if (!reference.track) return;
    const notes = segmentNotes(collectPitches(reference.track, 0, duration, referenceFilter), {
      minDuration: 0.08,
    });
    if (notes.length === 0) {
      window.alert('No reference notes pass the current reference clarity.');
      return;
    }
    downloadBytes(buildMidiFile(notes), `${baseName}-reference.mid`);
  };

  return (
    <div className="app">
      <NavBar />
      {micError && <div className="error">{micError}</div>}

      <div className="card waveform-card">
        <PitchGraph
          className="studio-graph"
          mode={{
            kind: 'timeline',
            viewportRef,
            pixelsPerSecond: PIXELS_PER_SECOND,
            clock,
            take,
            reference: studio.showReference ? reference.track : null,
            referenceFilter,
            showLiveMarker: armed && detectionActive,
          }}
          engine={engine}
          filter={filter}
          colorizeMarker={controls.colorizeMarker}
          showNoteLines={controls.showNoteLines}
          showNoteTrails={controls.showNoteTrails}
          showDiagnostics={controls.showDiagnostics}
          height={GRAPH_HEIGHT}
          onSeek={hasAudio ? seekTo : undefined}
        />

        <WaveformViewer
          audioBuffer={audioBuffer}
          audioRef={audioRef}
          duration={duration}
          isPlaying={isPlaying}
          currentTime={currentTime}
          onSeek={seekTo}
          onHoverTimeChange={setHoverTime}
          viewMode={viewMode}
          panMode={panMode}
          viewportRef={viewportRef}
          selection={selection}
          onSelectionChange={handleSelectionChange}
        />

        <PlaybackControls
          isPlaying={isPlaying}
          hasAudio={hasAudio}
          currentTime={currentTime}
          duration={duration}
          hoverTime={hoverTime}
          viewMode={viewMode}
          panMode={panMode}
          loopEnabled={loopEnabled}
          hasSelection={Boolean(selection)}
          onPlayPause={handlePlayPause}
          onStop={() => {
            stop();
            take.breakContinuity();
          }}
          onViewModeChange={setViewMode}
          onPanModeChange={setPanMode}
          onToggleLoop={() => setLoopEnabled((value) => !value)}
          onClearSelection={handleSelectionClear}
        />

        <audio ref={audioRef} src={audioUrl ?? undefined} preload="auto" hidden />
      </div>

      <StudioControls
        hasAudio={hasAudio}
        micArmed={armed}
        recordTake={studio.recordTake}
        setRecordTake={studio.setRecordTake}
        onlyWhilePlaying={studio.onlyWhilePlaying}
        setOnlyWhilePlaying={studio.setOnlyWhilePlaying}
        showReference={studio.showReference}
        setShowReference={studio.setShowReference}
        referenceClarity={studio.referenceClarity}
        setReferenceClarity={studio.setReferenceClarity}
        syncOffsetMs={studio.syncOffsetMs}
        setSyncOffsetMs={studio.setSyncOffsetMs}
        reference={reference}
        onClearTake={clearTake}
        onExportTake={exportTake}
        onExportReference={exportReference}
      />

      <AudioUpload
        fileName={fileName}
        isDecoding={isDecoding}
        error={error}
        onFileChange={handleUpload}
      />

      <PitchControls
        {...controls}
        enabled={armed}
        setEnabled={setArmed}
        showHistory={false}
      />
      <PitchStats sample={sample} />
    </div>
  );
}
