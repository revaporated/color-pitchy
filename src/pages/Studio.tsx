import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { PitchTrack } from '../audio/frames';
import { FRAME_ORDER, onAnimationFrame } from '../audio/frameLoop';
import { PlaybackClock } from '../audio/playbackClock';
import { AudioUpload } from '../components/AudioUpload';
import { NavBar } from '../components/NavBar';
import { PitchControls } from '../components/PitchControls';
import { PitchGraph } from '../components/PitchGraph';
import { EngineStats } from '../components/EngineStats';
import { PlaybackControls } from '../components/PlaybackControls';
import { StudioControls } from '../components/StudioControls';
import { WaveformViewer } from '../components/WaveformViewer';
import { useAudioFile } from '../hooks/useAudioFile';
import { useAudioPlayback } from '../hooks/useAudioPlayback';
import { usePitchEngine } from '../hooks/usePitchEngine';
import { usePitchSettings, useStudioSettings } from '../hooks/usePitchSettings';
import { useTrackAnalysis } from '../hooks/useReferenceTrack';
import { contourCsv, debugExportBase, encodeWav, saveDebugFile } from '../utils/debugExport';
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

  // Song clock, take and reference
  const [clock] = useState(() => new PlaybackClock());
  useEffect(() => {
    clock.attach(audioRef.current);
    return () => clock.attach(null);
  }, [clock, audioRef]);
  // Sync the clock once per frame, before the waveform and graph read it.
  useEffect(() => onAnimationFrame(() => clock.sync(), FRAME_ORDER.clock), [clock]);

  // `take` keeps what you record. `preview` always follows the mic while the
  // track plays and is drawn as a short trail behind the playhead when you
  // aren't recording; it's cleared on every seek so it only shows this pass.
  const take = useMemo(() => new PitchTrack(duration, TAKE_GRID_HZ), [duration]);
  const preview = useMemo(() => new PitchTrack(duration, TAKE_GRID_HZ), [duration]);
  const { peaks, reference } = useTrackAnalysis(
    audioBuffer,
    studio.topVoiceReference ? 'topVoice' : 'pitchy',
    studio.referenceSmoothing,
  );
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

  // Waveform view state
  const viewportRef = useRef<HTMLDivElement>(null);
  const playheadXRef = useRef<number | null>(null);
  const [viewMode, setViewMode] = useState<'pan' | 'select'>('pan');
  const [panMode, setPanMode] = useState<'scroll' | 'scrub'>('scroll');
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const hoverTimeRef = useRef<number | null>(null);
  const getSongTime = useCallback(() => clock.songTimeAt(performance.now()), [clock]);
  const getHoverTime = useCallback(() => hoverTimeRef.current, []);

  const resetPreview = useCallback(() => {
    take.breakContinuity();
    preview.clear();
  }, [preview, take]);

  const seekTo = useCallback(
    (time: number) => {
      resetPreview();
      seek(Math.max(0, Math.min(time, duration || time)));
    },
    [duration, resetPreview, seek],
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

  // Writes the decoded audio, the reference contour and the settings that
  // produced it to debug-exports/ (dev server), named after the track + time.
  const [debugExportStatus, setDebugExportStatus] = useState<string | null>(null);
  const debugExport = async () => {
    if (!audioBuffer) return;
    const base = debugExportBase(fileName);
    setDebugExportStatus('Exporting...');
    try {
      const track = reference.track;
      const info = {
        file: fileName,
        exportedAt: new Date().toISOString(),
        audio: {
          sampleRate: audioBuffer.sampleRate,
          channels: audioBuffer.numberOfChannels,
          duration: audioBuffer.duration,
        },
        reference: {
          method: studio.topVoiceReference ? 'topVoice' : 'pitchy',
          smoothing: studio.referenceSmoothing,
          status: reference.status,
          gridHz: track?.gridHz ?? null,
          filter: referenceFilter,
        },
        filter,
        syncOffsetMs: studio.syncOffsetMs,
      };
      await saveDebugFile(`${base}.json`, JSON.stringify(info, null, 2), 'application/json');
      if (track) await saveDebugFile(`${base}.contour.csv`, contourCsv(track), 'text/csv');
      await saveDebugFile(`${base}.wav`, encodeWav(audioBuffer), 'audio/wav');
      setDebugExportStatus(`Saved debug-exports/${base}.*`);
    } catch (err) {
      setDebugExportStatus(String(err));
    }
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
      <EngineStats engine={engine} filter={filter} layout="row" />
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
            preview: studio.recordTake ? null : preview,
            previewSeconds: controls.historyDuration,
            reference: studio.showReference ? reference.track : null,
            referenceFilter,
            referenceOpacity: studio.referenceOpacity,
            playheadXRef,
            showLiveMarker: armed && detectionActive,
          }}
          engine={engine}
          filter={filter}
          colorizeMarker={controls.colorizeMarker}
          showNoteLines={controls.showNoteLines}
          showNoteTrails={controls.showNoteTrails}
          trailOpacity={controls.trailOpacity}
          showDiagnostics={controls.showDiagnostics}
          height={GRAPH_HEIGHT}
          onSeek={hasAudio ? seekTo : undefined}
        />

        <WaveformViewer
          peaks={peaks}
          audioRef={audioRef}
          duration={duration}
          isPlaying={isPlaying}
          currentTime={currentTime}
          onSeek={seekTo}
          clock={clock}
          hoverTimeRef={hoverTimeRef}
          viewMode={viewMode}
          panMode={panMode}
          viewportRef={viewportRef}
          playheadXRef={playheadXRef}
          selection={selection}
          onSelectionChange={handleSelectionChange}
        />

        <PlaybackControls
          isPlaying={isPlaying}
          hasAudio={hasAudio}
          getTime={getSongTime}
          duration={duration}
          getHoverTime={getHoverTime}
          viewMode={viewMode}
          panMode={panMode}
          loopEnabled={loopEnabled}
          hasSelection={Boolean(selection)}
          onPlayPause={handlePlayPause}
          onStop={() => {
            stop();
            resetPreview();
          }}
          onViewModeChange={setViewMode}
          onPanModeChange={setPanMode}
          onToggleLoop={() => setLoopEnabled((value) => !value)}
          onClearSelection={handleSelectionClear}
        />

        <audio ref={audioRef} src={audioUrl ?? undefined} preload="auto" hidden />
      </div>

      <AudioUpload
        fileName={fileName}
        isDecoding={isDecoding}
        error={error}
        collapsed={hasAudio && !isDecoding && !error}
        onFileChange={handleUpload}
      />

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
        referenceOpacity={studio.referenceOpacity}
        topVoiceReference={studio.topVoiceReference}
        setTopVoiceReference={studio.setTopVoiceReference}
        referenceSmoothing={studio.referenceSmoothing}
        setReferenceSmoothing={studio.setReferenceSmoothing}
        setReferenceOpacity={studio.setReferenceOpacity}
        syncOffsetMs={studio.syncOffsetMs}
        setSyncOffsetMs={studio.setSyncOffsetMs}
        reference={reference}
        onClearTake={clearTake}
        onExportTake={exportTake}
        onExportReference={exportReference}
        onDebugExport={() => void debugExport()}
        debugExportStatus={debugExportStatus}
      />



      <PitchControls
        {...controls}
        enabled={armed}
        setEnabled={setArmed}
      />
    </div>
  );
}
