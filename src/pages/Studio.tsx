import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { FiEdit2 } from 'react-icons/fi';
import { Link, useParams } from 'react-router-dom';
import { applyEdits, EMPTY_EDITS, hasEdits, newManualId, updateNote } from '../audio/noteEdits';
import { SpectrogramImage } from '../audio/spectrogramImage';
import { TimelineView } from '../audio/timelineView';
import { ReferencePlayer } from '../audio/referencePlayer';
import { BeatControls } from '../components/BeatControls';
import { EngineStats } from '../components/EngineStats';
import { InfoTip } from '../components/InfoTip';
import { NavBar } from '../components/NavBar';
import { Panel } from '../components/Panel';
import { PitchControls } from '../components/PitchControls';
import { PitchGraph } from '../components/PitchGraph';
import { ShortcutsDialog } from '../components/ShortcutsDialog';
import { StudioToolbar, type StudioTool } from '../components/StudioToolbar';
import { TrackReferencePanel } from '../components/TrackReferencePanel';
import { ViewPopover } from '../components/ViewPopover';
import { WaveformViewer } from '../components/WaveformViewer';
import { useAudioSource } from '../hooks/useAudioFile';
import { useAudioPlayback } from '../hooks/useAudioPlayback';
import { useNoteEdits } from '../hooks/useNoteEdits';
import { usePitchEngine } from '../hooks/usePitchEngine';
import { usePitchSettings, useStudioSettings } from '../hooks/usePitchSettings';
import { sameAnalysis, useTrackAnalysis, type AnalysisSettings } from '../hooks/useReferenceTrack';
import { useSpectrogram } from '../hooks/useSpectrogram';
import { useProjectStore } from '../project/useProject';
import {
  AUDIO_ACCEPT,
  clearReferences,
  getAudio,
  getProject,
  getTake,
  isSupportedAudio,
  setProjectAudio,
  UNSUPPORTED_AUDIO_MESSAGE,
  updateProject,
} from '../storage/projects';
import type { AudioRecord, ProjectMeta, TakeRecord } from '../storage/projects';
import { StudioMenu } from './studio/StudioMenu';
import { StudioOverlay } from './studio/StudioOverlay';
import { useLoopSelection } from './studio/useLoopSelection';
import { usePenOptions } from './studio/usePenOptions';
import { usePlaybackClock } from './studio/usePlaybackClock';
import { useProjectBeats } from './studio/useProjectBeats';
import { useReferenceNotes } from './studio/useReferenceNotes';
import { useStudioFiles } from './studio/useStudioFiles';
import { useStudioShortcuts } from './studio/useStudioShortcuts';
import { useTake } from './studio/useTake';

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
  // Settings, note edits and beats of this project: one store, one save.
  const store = useProjectStore(project);
  const studio = useStudioSettings(store, { minMidi: controls.minDetectableNote, maxMidi: controls.maxDetectableNote });
  const { graphMinMidi, graphMaxMidi } = studio;
  const graphRange = useMemo(() => ({ minMidi: graphMinMidi, maxMidi: graphMaxMidi }), [graphMinMidi, graphMaxMidi]);

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
  const clock = usePlaybackClock(audioRef, audioUrl, studio);

  const { take, preview, flushTakeRef, resetPreview } = useTake({
    projectId,
    duration,
    storedTake,
    engine,
    clock,
    hasAudio,
    studio,
  });
  // 0: only show a saved analysis. Analyze bumps it, which lets the analysis run.
  const [runToken, setRunToken] = useState(0);
  const { analysis, setAnalysis } = studio;
  const { peaks, reference, mono } = useTrackAnalysis(audioBuffer, analysis, audio?.id ?? null, runToken);

  // Beats: saved with the project, or detected once per track.
  const { beatDetection, beatGrid } = useProjectBeats(store, audio, mono, studio);

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
  useEffect(
    () => referencePlayer.setMetronomeVolume(studio.metronomeVolume),
    [referencePlayer, studio.metronomeVolume],
  );

  const { referenceFilter, autoNotes } = useReferenceNotes(reference, duration, analysis, studio);

  // Pen mode: your edits sit on top of the analysis (see noteEdits.ts), so
  // re-analyzing replaces the auto notes but keeps what you changed by hand.
  const noteEdits = useNoteEdits(store);
  const { apply: applyEdit } = noteEdits;
  const { undo: undoEdit, redo: redoEdit, reset: resetEdits, edits: currentEdits } = noteEdits;
  // Pan and Select set what dragging the waveform does; Pen edits the reference notes on the graph.
  const [tool, setTool] = useState<StudioTool>('pan');
  const penMode = tool === 'pen';
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const referenceNotes = useMemo(() => applyEdits(autoNotes, currentEdits), [autoNotes, currentEdits]);
  useEffect(() => referencePlayer.setNotes(referenceNotes), [referencePlayer, referenceNotes]);

  const pen = usePenOptions(penMode, noteEdits, hasAudio, selectedNoteId, setSelectedNoteId, referencePlayer);

  const clearEdits = () => {
    if (!window.confirm('Remove all your note edits? (You can undo this.)')) return;
    applyEdit(() => EMPTY_EDITS);
    setSelectedNoteId(null);
  };

  useEffect(() => {
    referencePlayer.setEnabled(studio.playReference && hasAudio);
    return () => referencePlayer.setEnabled(false);
  }, [referencePlayer, studio.playReference, hasAudio]);
  useEffect(() => {
    referencePlayer.setMetronome(beatGrid, studio.metronome && hasAudio);
    return () => referencePlayer.setMetronome(null, false);
  }, [referencePlayer, beatGrid, studio.metronome, hasAudio]);

  // Waveform view state
  // The time axis the waveform and the graph share.
  const [timeline] = useState(() => new TimelineView());
  const viewMode = tool === 'select' ? 'select' : 'pan';
  const [panMode, setPanMode] = useState<'scroll' | 'scrub'>('scroll');
  const hoverTimeRef = useRef<number | null>(null);
  const getSongTime = useCallback(() => clock.songTimeAt(performance.now()), [clock]);
  const getHoverTime = useCallback(() => hoverTimeRef.current, []);

  const seekTo = useCallback(
    (time: number) => {
      resetPreview();
      seek(Math.max(0, Math.min(time, duration || time)));
    },
    [duration, resetPreview, seek],
  );

  const snapGrid = studio.snapLoopToBeats ? beatGrid : null;
  const {
    selection,
    setSelection,
    loopEnabled,
    setLoopEnabled,
    handleSelectionChange,
    handleSelectionClear,
    handlePlayPause,
    goToStart,
  } = useLoopSelection(audioRef, isPlaying, playPause, seekTo, snapGrid);

  // Adds a track to the project, or replaces it (which deletes the take).
  const handleUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      if (!isSupportedAudio(file)) {
        setUploadError(UNSUPPORTED_AUDIO_MESSAGE);
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
    [projectId, setError, stop, take, currentEdits, resetEdits, setSelection, setLoopEnabled],
  );

  // Take / reference actions
  const baseName = fileName ? fileName.replace(/\.[^.]+$/, '') : 'track';

  const clearTake = () => {
    if (take.hasData() && !window.confirm('Clear the recorded take?')) return;
    take.clear();
  };

  const {
    exportTake,
    exportReference,
    debugExport,
    debugExportStatus,
    exportProjectData,
    importInputRef,
    importProjectFile,
  } = useStudioFiles({
    project,
    projectId,
    store,
    audio,
    audioBuffer,
    fileName,
    baseName,
    duration,
    take,
    flushTakeRef,
    filter,
    analysis,
    reference,
    referenceFilter,
    referenceNotes,
    beatGrid,
    studio,
    stop,
  });

  const editCount = currentEdits.added.length + currentEdits.removed.length;
  const noteCount = referenceNotes?.count ?? null;
  const referenceReady = reference.status === 'ready';
  const needsAnalysis = hasAudio && reference.status === 'idle' && reference.needsAnalysis === true;
  const trackError = uploadError ?? error;

  // Hidden file input shared by every "Add track" / "Change track" button.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chooseFile = () => fileInputRef.current?.click();

  const [showShortcuts, setShowShortcuts] = useState(false);
  const closeShortcuts = useCallback(() => setShowShortcuts(false), []);

  // Rec arms the mic too, so recording is one press.
  const recording = studio.recordTake && armed;
  const toggleRecord = () => {
    if (recording) {
      studio.setRecordTake(false);
    } else {
      studio.setRecordTake(true);
      setArmed(true);
    }
  };

  /** Moves the selected note by `semitones` and `seconds`. */
  const nudgeSelected = (semitones: number, seconds: number) => {
    const note = selectedNoteId ? referenceNotes?.findById(selectedNoteId) : null;
    if (!note) return;
    const dt = Math.max(-note.start, seconds);
    const span = { midi: note.midi + semitones, start: note.start + dt, end: note.end + dt };
    const newId = note.origin === 'manual' ? note.id : newManualId();
    applyEdit((edits) => updateNote(edits, note, span, newId));
    setSelectedNoteId(newId);
    if (semitones !== 0) referencePlayer.audition(span.midi);
  };

  const changeTool = (next: StudioTool) => {
    setTool(next);
    if (next !== 'pen') setSelectedNoteId(null);
  };

  useStudioShortcuts({
    hasAudio,
    handlePlayPause,
    goToStart,
    setShowShortcuts,
    setArmed,
    toggleRecord,
    selection,
    setLoopEnabled,
    changeTool,
    noteEdits,
    penMode,
    selectedNoteId,
    setSelectedNoteId,
    referenceNotes,
    applyEdit,
    undoEdit,
    redoEdit,
    nudgeSelected,
  });


  const trackSummary = fileName
    ? `${fileName}${
        referenceReady
          ? ` · ${noteCount ?? 0} notes`
          : needsAnalysis
            ? ' · not analyzed'
            : reference.status === 'analyzing'
              ? ' · analyzing'
              : ''
      }`
    : 'No track';
  const beatSummary = !hasAudio
    ? undefined
    : beatDetection.status === 'ready'
      ? `${Math.round(beatGrid?.bpm ?? 0)} BPM${studio.metronome ? ' · metronome on' : ''}`
      : beatDetection.status === 'error'
        ? 'Detection failed'
        : 'Finding beats...';
  const micSummary = `${armed ? 'Mic on' : 'Mic off'} · clarity ${Math.round(controls.clarityThreshold * 100)}%${
    studio.syncOffsetMs ? ` · offset ${studio.syncOffsetMs} ms` : ''
  }`;

  const view = (
    <ViewPopover
      showReference={studio.showReference}
      setShowReference={studio.setShowReference}
      referenceOpacity={studio.referenceOpacity}
      setReferenceOpacity={studio.setReferenceOpacity}
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
      showBeats={studio.showBeats}
      setShowBeats={studio.setShowBeats}
      showNoteTrails={controls.showNoteTrails}
      setShowNoteTrails={controls.setShowNoteTrails}
      trailOpacity={controls.trailOpacity}
      setTrailOpacity={controls.setTrailOpacity}
      showNoteLines={controls.showNoteLines}
      setShowNoteLines={controls.setShowNoteLines}
      colorizeMarker={controls.colorizeMarker}
      setColorizeMarker={controls.setColorizeMarker}
      graphMinMidi={studio.graphMinMidi}
      setGraphMinMidi={studio.setGraphMinMidi}
      graphMaxMidi={studio.graphMaxMidi}
      setGraphMaxMidi={studio.setGraphMaxMidi}
    />
  );

  const menu = (
    <StudioMenu
      hasAudio={hasAudio}
      referenceReady={referenceReady}
      editCount={editCount}
      exportTake={exportTake}
      exportReference={exportReference}
      exportProjectData={exportProjectData}
      importInputRef={importInputRef}
      clearTake={clearTake}
      clearEdits={clearEdits}
      debugExport={debugExport}
      setShowShortcuts={setShowShortcuts}
    />
  );

  return (
    <div className="app">
      <NavBar title={project.name} />
      {micError && <div className="error">{micError}</div>}

      <div className="card workspace">
        <StudioToolbar
          hasAudio={hasAudio}
          isPlaying={isPlaying}
          getTime={getSongTime}
          getHoverTime={getHoverTime}
          duration={duration}
          onPlayPause={handlePlayPause}
          onStop={() => {
            stop();
            resetPreview();
          }}
          micOn={armed}
          onToggleMic={() => setArmed((value) => !value)}
          recording={recording}
          onToggleRecord={toggleRecord}
          hasSelection={Boolean(selection)}
          loopEnabled={loopEnabled}
          onToggleLoop={() => setLoopEnabled((value) => !value)}
          onClearSelection={handleSelectionClear}
          tool={tool}
          onToolChange={changeTool}
          penAvailable={noteEdits.loaded}
          panMode={panMode}
          onPanModeChange={setPanMode}
          canUndo={noteEdits.canUndo}
          canRedo={noteEdits.canRedo}
          onUndo={undoEdit}
          onRedo={redoEdit}
          editCount={editCount}
          playbackRate={studio.playbackRate}
          onPlaybackRateChange={studio.setPlaybackRate}
          view={view}
          menu={menu}
          status={debugExportStatus}
        />

        <div className="workspace__canvas">
          <div className="graph-wrap">
            <PitchGraph
              className={`studio-graph${penMode ? ' studio-graph--pen' : ''}`}
              mode={{
                kind: 'timeline',
                view: timeline,
                clock,
                take,
                preview: studio.recordTake ? null : preview,
                previewSeconds: controls.historyDuration,
                reference: studio.showReference || pen ? referenceNotes : null,
                pen,
                spectrogram: studio.showSpectrogram ? spectrogramImage : null,
                beats: studio.showBeats ? beatGrid : null,
                spectrogramOpacity: studio.spectrogramOpacity,
                referenceOpacity: studio.referenceOpacity,
                selection,
                onSelect: tool === 'select' && hasAudio ? handleSelectionChange : undefined,
                showLiveMarker: armed && detectionActive,
              }}
              engine={engine}
              filter={filter}
              range={graphRange}
              colorizeMarker={controls.colorizeMarker}
              showNoteLines={controls.showNoteLines}
              showNoteTrails={controls.showNoteTrails}
              trailOpacity={controls.trailOpacity}
              showDiagnostics={controls.showDiagnostics}
              onSeek={hasAudio ? seekTo : undefined}
            />
            {armed && <EngineStats engine={engine} filter={filter} layout="overlay" />}
            {penMode && (
              <span className="pen-badge">
                <FiEdit2 aria-hidden="true" /> Pen: click to add, drag to move, right-click to delete
              </span>
            )}
            <StudioOverlay
              hasAudio={hasAudio}
              trackError={trackError}
              chooseFile={chooseFile}
              hasTrack={audio !== null}
              reference={reference}
              needsAnalysis={needsAnalysis}
              studio={studio}
              analysis={analysis}
              analyze={analyze}
            />
          </div>

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
            view={timeline}
            selection={selection}
            onSelectionChange={handleSelectionChange}
          />
        </div>

        <audio ref={audioRef} src={audioUrl ?? undefined} preload="auto" hidden />
        <input
          ref={fileInputRef}
          type="file"
          accept={AUDIO_ACCEPT}
          hidden
          onChange={(event) => void handleUpload(event)}
        />
        <input
          ref={importInputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => void importProjectFile(event)}
        />
      </div>

      <div className="panels">
        <Panel id="studio.track" title="Track & reference" summary={trackSummary} defaultOpen>
          <TrackReferencePanel
            hasAudio={hasAudio}
            fileName={fileName}
            isDecoding={isDecoding}
            error={trackError}
            onChooseFile={chooseFile}
            applied={analysis}
            reference={reference}
            noteCount={noteCount}
            onAnalyze={(next) => void analyze(next)}
            referenceClarity={studio.referenceClarity}
            setReferenceClarity={studio.setReferenceClarity}
            playReference={studio.playReference}
            setPlayReference={studio.setPlayReference}
            referenceVolume={studio.referenceVolume}
            setReferenceVolume={studio.setReferenceVolume}
            trackVolume={studio.trackVolume}
            setTrackVolume={studio.setTrackVolume}
          />
        </Panel>

        <Panel id="studio.beats" title="Beats" summary={beatSummary}>
          <BeatControls
            hasAudio={hasAudio}
            detection={beatDetection}
            bpm={beatGrid?.bpm ?? 0}
            snapLoop={studio.snapLoopToBeats}
            setSnapLoop={studio.setSnapLoopToBeats}
            metronome={studio.metronome}
            setMetronome={studio.setMetronome}
            metronomeVolume={studio.metronomeVolume}
            setMetronomeVolume={studio.setMetronomeVolume}
            beatScale={studio.beatScale}
            setBeatScale={studio.setBeatScale}
            beatsPerGroup={studio.beatsPerGroup}
            setBeatsPerGroup={studio.setBeatsPerGroup}
            beatOffset={studio.beatOffset}
            setBeatOffset={studio.setBeatOffset}
          />
        </Panel>

        <Panel id="studio.mic" title="Mic & detection" summary={micSummary}>
          <div className="panel__section">
            <span className="section-label">While singing</span>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={studio.onlyWhilePlaying}
                onChange={(event) => studio.setOnlyWhilePlaying(event.target.checked)}
              />
              Only detect while the track is playing
            </label>
            <label className="slider-row">
              <span className="slider-row__text">Sync offset: {studio.syncOffsetMs} ms</span>
              <input
                type="range"
                min={-200}
                max={400}
                step={5}
                value={studio.syncOffsetMs}
                onChange={(event) => studio.setSyncOffsetMs(parseInt(event.target.value, 10))}
              />
              <InfoTip>
                Shifts your take earlier to cancel mic and speaker latency. Sing along with a clear part of
                the track and adjust until your line sits on the reference.
              </InfoTip>
            </label>
          </div>
          <PitchControls
            {...controls}
            enabled={armed}
            setEnabled={setArmed}
            bare
            showMicButton={false}
            showDisplay={false}
          />
        </Panel>
      </div>

      {showShortcuts && <ShortcutsDialog onClose={closeShortcuts} />}
    </div>
  );
}
