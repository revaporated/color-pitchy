import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PitchTrack } from '../audio/frames';
import {
  addNote,
  applyEdits,
  deleteNote,
  EMPTY_EDITS,
  hasEdits,
  updateNote,
  type NoteEdits,
} from '../audio/noteEdits';
import { NoteSet } from '../audio/noteSet';
import { SpectrogramImage } from '../audio/spectrogramImage';
import { useSpectrogram } from '../hooks/useSpectrogram';
import { ReferencePlayer } from '../audio/referencePlayer';
import { FRAME_ORDER, onAnimationFrame } from '../audio/frameLoop';
import { PlaybackClock } from '../audio/playbackClock';
import { AnalysisPanel } from '../components/AnalysisPanel';
import { AudioUpload } from '../components/AudioUpload';
import { NavBar } from '../components/NavBar';
import { PitchControls } from '../components/PitchControls';
import { PitchGraph, type PenGesture, type PenOptions } from '../components/PitchGraph';
import { PenToolbar } from '../components/PenToolbar';
import { useNoteEdits } from '../hooks/useNoteEdits';
import { EngineStats } from '../components/EngineStats';
import { PlaybackControls } from '../components/PlaybackControls';
import { StudioControls } from '../components/StudioControls';
import { WaveformViewer } from '../components/WaveformViewer';
import { useAudioSource } from '../hooks/useAudioFile';
import { useAudioPlayback } from '../hooks/useAudioPlayback';
import { usePitchEngine } from '../hooks/usePitchEngine';
import { usePitchSettings, useStudioSettings } from '../hooks/usePitchSettings';
import { sameAnalysis, useTrackAnalysis, type AnalysisSettings } from '../hooks/useReferenceTrack';
import {
  clearReferences,
  getAudio,
  getProject,
  getTake,
  isSupportedAudio,
  rememberProjectSettings,
  saveTake,
  setProjectAudio,
  updateProject,
} from '../storage/projects';
import type { AudioRecord, ProjectMeta, TakeRecord } from '../storage/projects';
import { contourCsv, debugExportBase, encodeWav, saveDebugFile } from '../utils/debugExport';
import { buildMidiFile, downloadBytes } from '../utils/midi';
import { collectPitches, segmentNotes } from '../utils/notes';
import type { DetectionFilter } from '../utils/pitch';
import { PIXELS_PER_SECOND } from '../utils/waveform';

const TAKE_GRID_HZ = 200;
const GRAPH_HEIGHT = 420;

type Selection = { start: number; end: number };

type LoadedProject = {
  id: string;
  project: ProjectMeta | null;
  audio: AudioRecord | null;
  take: TakeRecord | null;
  error?: string;
};

/** Loads the project named in the URL from the library, then opens it. */
export default function StudioPage() {
  const { projectId = '' } = useParams();
  const [loaded, setLoaded] = useState<LoadedProject | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const project = (await getProject(projectId)) ?? null;
        const [audio, take] = project
          ? await Promise.all([
              project.audioId ? getAudio(project.audioId) : undefined,
              getTake(project.id),
            ])
          : [undefined, undefined];
        if (!cancelled) setLoaded({ id: projectId, project, audio: audio ?? null, take: take ?? null });
      } catch (err) {
        if (!cancelled) {
          setLoaded({ id: projectId, project: null, audio: null, take: null, error: String(err) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!loaded || loaded.id !== projectId) {
    return (
      <div className="app">
        <NavBar />
        <div className="card">Loading project...</div>
      </div>
    );
  }

  if (!loaded.project) {
    return (
      <div className="app">
        <NavBar />
        <div className="card">
          {loaded.error ? `Couldn't open the project: ${loaded.error}` : "This project doesn't exist."}{' '}
          <Link to="/library">Back to the library</Link>
        </div>
      </div>
    );
  }

  return (
    <StudioSession
      key={loaded.project.id}
      project={loaded.project}
      initialAudio={loaded.audio}
      initialTake={loaded.take}
    />
  );
}

type SessionProps = {
  project: ProjectMeta;
  initialAudio: AudioRecord | null;
  initialTake: TakeRecord | null;
};

/**
 * Studio mode: everything in Live, plus a track. The pitch graph shares the
 * waveform's x axis, so the take is drawn at the song position it was sung at,
 * on top of the track's own pitch contour, and stays put when you seek.
 */
function StudioSession({ project, initialAudio, initialTake }: SessionProps) {
  const projectId = project.id;
  const { controls, filter } = usePitchSettings();
  const studio = useStudioSettings(project.settings);

  const [audio, setAudio] = useState<AudioRecord | null>(initialAudio);
  // The saved take to restore once the track has decoded (null after a track change).
  const [storedTake, setStoredTake] = useState<TakeRecord | null>(initialTake);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { audioUrl, audioBuffer, fileName, isDecoding, error, duration, setError } =
    useAudioSource(audio);
  const handlePlayError = useCallback(() => setError('Unable to start playback.'), [setError]);
  const { audioRef, isPlaying, currentTime, playPause, stop, seek } = useAudioPlayback({
    onPlayError: handlePlayError,
  });
  const hasAudio = Boolean(audioUrl && audioBuffer);

  // Save the project's settings when they change (debounced, skipping the initial values).
  const savedSettingsRef = useRef(studio.projectSettings);
  useEffect(() => {
    const settings = studio.projectSettings;
    if (settings === savedSettingsRef.current) return;
    const timer = setTimeout(() => {
      savedSettingsRef.current = settings;
      rememberProjectSettings(settings);
      void updateProject(projectId, { settings });
    }, 400);
    return () => clearTimeout(timer);
  }, [projectId, studio.projectSettings]);

  // Fill in the duration in the library listing if it wasn't known yet.
  useEffect(() => {
    if (duration > 0 && Math.abs((project.duration ?? 0) - duration) > 0.01) {
      void updateProject(projectId, { duration, updatedAt: project.updatedAt });
    }
  }, [duration, project.duration, project.updatedAt, projectId]);

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

  // Track volume (lets you mute the song to hear the reference on its own).
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = studio.trackVolume;
  }, [audioRef, studio.trackVolume, audioUrl]);

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
  // is hidden, and on leaving Studio.
  useEffect(() => {
    let savedVersion = take.version;
    const flush = () => {
      if (take.version === savedVersion) return;
      savedVersion = take.version;
      const record = take.hasData()
        ? { gridHz: take.gridHz, frequency: take.frequency.slice(), clarity: take.clarity.slice() }
        : null;
      void saveTake(projectId, record).catch((err) => console.error('Saving the take failed', err));
    };
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
      flush();
    };
  }, [take, projectId]);
  const preview = useMemo(() => new PitchTrack(duration, TAKE_GRID_HZ), [duration]);
  // 0: only show a saved analysis. Analyze bumps it, which lets the analysis run.
  const [runToken, setRunToken] = useState(0);
  const { analysis, setAnalysis } = studio;
  const { peaks, reference, mono } = useTrackAnalysis(audioBuffer, analysis, audio?.id ?? null, runToken);

  // Spectrogram: computed once per track when first shown; the image is
  // rebuilt (cheaply) when the view or range changes.
  const spectrogram = useSpectrogram(mono, studio.showSpectrogram && hasAudio);
  const spectrogramImage = useMemo(
    () =>
      spectrogram.data
        ? new SpectrogramImage(spectrogram.data, studio.spectrogramView, studio.spectrogramRange)
        : null,
    [spectrogram.data, studio.spectrogramView, studio.spectrogramRange],
  );
  const analyze = async (next: AnalysisSettings) => {
    if (sameAnalysis(next, analysis)) {
      // Same settings: throw the saved result away and run again.
      if (audio) await clearReferences(audio.id).catch(() => undefined);
    } else {
      setAnalysis(next);
    }
    setRunToken((value) => value + 1);
  };
  const [referencePlayer] = useState(() => new ReferencePlayer(clock));
  useEffect(() => () => referencePlayer.dispose(), [referencePlayer]);
  useEffect(() => referencePlayer.setVolume(studio.referenceVolume), [referencePlayer, studio.referenceVolume]);

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

  // Pen mode: your edits sit on top of the analysis (see noteEdits.ts), so
  // re-analyzing replaces the auto notes but keeps what you changed by hand.
  const noteEdits = useNoteEdits(projectId);
  const { preview: previewEdit, commit: commitEdit, cancel: cancelEdit, apply: applyEdit } = noteEdits;
  const { undo: undoEdit, redo: redoEdit, reset: resetEdits, edits: currentEdits } = noteEdits;
  const [penMode, setPenMode] = useState(false);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const referenceNotes = useMemo(() => applyEdits(autoNotes, currentEdits), [autoNotes, currentEdits]);
  useEffect(() => referencePlayer.setNotes(referenceNotes), [referencePlayer, referenceNotes]);

  const pen: PenOptions | null = useMemo(() => {
    if (!penMode || !noteEdits.loaded || !hasAudio) return null;
    const run = (gesture: PenGesture) => (edits: NoteEdits) =>
      gesture.kind === 'create'
        ? addNote(edits, gesture.span, gesture.id)
        : updateNote(edits, gesture.note, gesture.span, gesture.newId);
    return {
      selectedId: selectedNoteId,
      onSelect: setSelectedNoteId,
      onGesture: (gesture, phase) => {
        if (phase === 'cancel') {
          cancelEdit();
          return;
        }
        previewEdit(run(gesture));
        if (phase === 'commit') commitEdit();
        setSelectedNoteId(
          gesture.kind === 'create'
            ? gesture.id
            : gesture.note.origin === 'manual'
              ? gesture.note.id
              : gesture.newId,
        );
      },
      onDelete: (note) => {
        applyEdit((edits) => deleteNote(edits, note));
        setSelectedNoteId(null);
      },
      onAudition: (midi) => referencePlayer.audition(midi),
    };
  }, [
    penMode,
    noteEdits.loaded,
    hasAudio,
    selectedNoteId,
    previewEdit,
    commitEdit,
    cancelEdit,
    applyEdit,
    referencePlayer,
  ]);

  const clearEdits = () => {
    if (!window.confirm('Remove all your note edits? (You can undo this.)')) return;
    applyEdit(() => EMPTY_EDITS);
    setSelectedNoteId(null);
  };

  // Shortcuts: P toggles pen mode, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl+Y
  // redo, Delete/Backspace removes the selected note, Escape deselects.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, select, textarea, [contenteditable="true"]')) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoEdit();
        else undoEdit();
        return;
      }
      if (mod && key === 'y') {
        event.preventDefault();
        redoEdit();
        return;
      }
      if (mod || event.altKey) return;
      if (key === 'p' && hasAudio) {
        setPenMode((value) => !value);
        return;
      }
      if (!penMode) return;
      if ((key === 'delete' || key === 'backspace') && selectedNoteId) {
        const note = referenceNotes?.findById(selectedNoteId);
        if (note) {
          event.preventDefault();
          applyEdit((edits) => deleteNote(edits, note));
          setSelectedNoteId(null);
        }
      } else if (key === 'escape') {
        setSelectedNoteId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasAudio, penMode, selectedNoteId, referenceNotes, applyEdit, undoEdit, redoEdit]);
  useEffect(() => {
    referencePlayer.setEnabled(studio.playReference && hasAudio);
    return () => referencePlayer.setEnabled(false);
  }, [referencePlayer, studio.playReference, hasAudio]);

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

  // Adds a track to the project, or replaces it (which deletes the take).
  const handleUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      if (!isSupportedAudio(file)) {
        setUploadError('Please choose an MP3 file.');
        return;
      }
      const losing = [take.hasData() && 'take', hasEdits(currentEdits) && 'note edits'].filter(Boolean);
      if (
        losing.length > 0 &&
        !window.confirm(`Replacing the track deletes this project's ${losing.join(' and ')}. Continue?`)
      ) {
        return;
      }
      setUploadError(null);
      setError(null);
      stop();
      setSelection(null);
      setLoopEnabled(false);
      take.clear();
      try {
        const { audio: added } = await setProjectAudio(projectId, file);
        setStoredTake(null);
        setRunToken(0); // a new track waits for Analyze, so its settings can be chosen first
        resetEdits();
        setSelectedNoteId(null);
        setAudio(added);
      } catch (err) {
        setUploadError(`Couldn't save the track: ${String(err)}`);
      }
    },
    [projectId, setError, stop, take, currentEdits, resetEdits],
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
          ...analysis,
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
    if (!referenceNotes) return;
    const notes = referenceNotes.notes;
    if (notes.length === 0) {
      window.alert('No reference notes pass the current reference clarity.');
      return;
    }
    downloadBytes(buildMidiFile([...notes]), `${baseName}-reference.mid`);
  };

  return (
    <div className="app">
      <NavBar title={project.name} />
      <EngineStats engine={engine} filter={filter} layout="row" />
      {micError && <div className="error">{micError}</div>}

      <div className="card waveform-card">
        <PenToolbar
          enabled={hasAudio && noteEdits.loaded}
          penMode={penMode}
          onTogglePen={() => setPenMode((value) => !value)}
          canUndo={noteEdits.canUndo}
          canRedo={noteEdits.canRedo}
          onUndo={undoEdit}
          onRedo={redoEdit}
          editCount={currentEdits.added.length + currentEdits.removed.length}
          onClearEdits={clearEdits}
        />
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
            reference: studio.showReference || pen ? referenceNotes : null,
            pen,
            spectrogram: studio.showSpectrogram ? spectrogramImage : null,
            spectrogramOpacity: studio.spectrogramOpacity,
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
        error={uploadError ?? error}
        collapsed={hasAudio && !isDecoding && !error && !uploadError}
        onFileChange={(event) => void handleUpload(event)}
      />

      <AnalysisPanel
        hasAudio={hasAudio}
        applied={analysis}
        reference={reference}
        noteCount={referenceNotes?.count ?? null}
        onAnalyze={(next) => void analyze(next)}
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
        setReferenceOpacity={studio.setReferenceOpacity}
        syncOffsetMs={studio.syncOffsetMs}
        setSyncOffsetMs={studio.setSyncOffsetMs}
        playReference={studio.playReference}
        setPlayReference={studio.setPlayReference}
        referenceVolume={studio.referenceVolume}
        setReferenceVolume={studio.setReferenceVolume}
        trackVolume={studio.trackVolume}
        setTrackVolume={studio.setTrackVolume}

        referenceReady={reference.status === 'ready'}
        showSpectrogram={studio.showSpectrogram}
        setShowSpectrogram={studio.setShowSpectrogram}
        spectrogramView={studio.spectrogramView}
        setSpectrogramView={studio.setSpectrogramView}
        spectrogramRange={studio.spectrogramRange}
        setSpectrogramRange={studio.setSpectrogramRange}
        spectrogramOpacity={studio.spectrogramOpacity}
        setSpectrogramOpacity={studio.setSpectrogramOpacity}
        spectrogramStatus={
          spectrogram.status === 'computing'
            ? `Computing... ${Math.round(spectrogram.progress * 100)}%`
            : spectrogram.status === 'error'
              ? `Failed: ${spectrogram.message}`
              : null
        }
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
