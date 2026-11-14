import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import {
  FiCommand,
  FiDownload,
  FiEdit2,
  FiMoreHorizontal,
  FiPlay,
  FiTool,
  FiUploadCloud,
  FiSave,
  FiTrash2,
  FiUpload,
  FiXCircle,
} from 'react-icons/fi';
import { Link, useParams } from 'react-router-dom';
import { PitchTrack } from '../audio/frames';
import {
  addNote,
  applyEdits,
  deleteNote,
  EMPTY_EDITS,
  hasEdits,
  newManualId,
  updateNote,
  type NoteEdits,
} from '../audio/noteEdits';
import { NoteSet } from '../audio/noteSet';
import { SpectrogramImage } from '../audio/spectrogramImage';
import { BeatGrid } from '../audio/beatGrid';
import { BeatControls } from '../components/BeatControls';
import { BEAT_DETECTOR_VERSION, useBeats, type BeatState } from '../hooks/useBeats';
import { useSpectrogram } from '../hooks/useSpectrogram';
import { ReferencePlayer } from '../audio/referencePlayer';
import { FRAME_ORDER, onAnimationFrame } from '../audio/frameLoop';
import { PlaybackClock } from '../audio/playbackClock';
import { InfoTip } from '../components/InfoTip';
import { MenuItem, Popover } from '../components/Popover';
import { Panel } from '../components/Panel';
import { ShortcutsDialog } from '../components/ShortcutsDialog';
import { StudioToolbar, type StudioTool } from '../components/StudioToolbar';
import { TrackReferencePanel } from '../components/TrackReferencePanel';
import { ViewPopover } from '../components/ViewPopover';
import { NavBar } from '../components/NavBar';
import { PitchControls } from '../components/PitchControls';
import { PitchGraph, type PenGesture, type PenOptions } from '../components/PitchGraph';
import { useNoteEdits } from '../hooks/useNoteEdits';
import { EngineStats } from '../components/EngineStats';
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
  AUDIO_ACCEPT,
  isSupportedAudio,
  importProjectData,
  saveTake,
  setProjectAudio,
  UNSUPPORTED_AUDIO_MESSAGE,
  updateProject,
} from '../storage/projects';
import type { AudioRecord, ProjectMeta, TakeRecord } from '../storage/projects';
import { contourCsv, debugExportBase, encodeWav, saveDebugFile } from '../utils/debugExport';
import { buildMidiFile, downloadBytes } from '../utils/midi';
import { buildProjectExport, parseProjectExport } from '../project/projectDoc';
import { useProjectState, useProjectStore } from '../project/useProject';
import { collectPitches, segmentNotes } from '../utils/notes';
import type { DetectionFilter } from '../utils/pitch';
import { PIXELS_PER_SECOND } from '../utils/waveform';

const TAKE_GRID_HZ = 200;

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
  // Settings, note edits and beats of this project: one store, one save.
  const store = useProjectStore(project);
  const studio = useStudioSettings(store);

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

  // Playback speed, keeping pitch. The clock picks the rate up from the
  // element's ratechange event, so the graph, take, reference playback and
  // metronome all follow it.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.preservesPitch = true;
    audio.defaultPlaybackRate = studio.playbackRate;
    audio.playbackRate = studio.playbackRate;
  }, [audioRef, studio.playbackRate, audioUrl]);

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
  // is hidden, and on leaving Studio. `flushTakeRef` saves it now.
  const flushTakeRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => {
    let savedVersion = take.version;
    const flush = () => {
      if (take.version === savedVersion) return Promise.resolve();
      savedVersion = take.version;
      const record = take.hasData()
        ? { gridHz: take.gridHz, frequency: take.frequency.slice(), clarity: take.clarity.slice() }
        : null;
      return saveTake(projectId, record).catch((err) => console.error('Saving the take failed', err));
    };
    flushTakeRef.current = flush;
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
      void flush();
    };
  }, [take, projectId]);
  const preview = useMemo(() => new PitchTrack(duration, TAKE_GRID_HZ), [duration]);
  // 0: only show a saved analysis. Analyze bumps it, which lets the analysis run.
  const [runToken, setRunToken] = useState(0);
  const { analysis, setAnalysis } = studio;
  const { peaks, reference, mono } = useTrackAnalysis(audioBuffer, analysis, audio?.id ?? null, runToken);

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
  const noteEdits = useNoteEdits(store);
  const { preview: previewEdit, commit: commitEdit, cancel: cancelEdit, apply: applyEdit } = noteEdits;
  const { undo: undoEdit, redo: redoEdit, reset: resetEdits, edits: currentEdits } = noteEdits;
  // Pan and Select set what dragging the waveform does; Pen edits the reference notes on the graph.
  const [tool, setTool] = useState<StudioTool>('pan');
  const penMode = tool === 'pen';
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

  useEffect(() => {
    referencePlayer.setEnabled(studio.playReference && hasAudio);
    return () => referencePlayer.setEnabled(false);
  }, [referencePlayer, studio.playReference, hasAudio]);
  useEffect(() => {
    referencePlayer.setMetronome(beatGrid, studio.metronome && hasAudio);
    return () => referencePlayer.setMetronome(null, false);
  }, [referencePlayer, beatGrid, studio.metronome, hasAudio]);

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
  const viewMode = tool === 'select' ? 'select' : 'pan';
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
    [projectId, setError, stop, take, currentEdits, resetEdits],
  );

  const snapGrid = studio.snapLoopToBeats ? beatGrid : null;
  const handleSelectionChange = useCallback(
    (next: Selection | null) => {
      const snapped =
        next && snapGrid ? { start: snapGrid.nearest(next.start), end: snapGrid.nearest(next.end) } : next;
      setSelection(snapped);
      setLoopEnabled(Boolean(snapped));
    },
    [snapGrid],
  );

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
    downloadBytes(buildMidiFile(notes, { beats: beatGrid, trackName: `${baseName} take` }), `${baseName}-take.mid`);
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
    downloadBytes(
      buildMidiFile(notes, { beats: beatGrid, trackName: `${baseName} reference` }),
      `${baseName}-reference.mid`,
    );
  };

  // Backup of everything but the audio: settings, note edits, take and beats.
  const exportProjectData = async () => {
    store.flush(true);
    await flushTakeRef.current();
    const { settings, edits, beats } = store.getState();
    const json = buildProjectExport({
      name: project.name,
      audio: audio ? { fileName: audio.fileName, size: audio.size, duration: duration || null } : null,
      settings,
      edits,
      beats,
      take: take.hasData()
        ? { gridHz: take.gridHz, frequency: take.frequency.slice(), clarity: take.clarity.slice() }
        : null,
    });
    downloadBytes(new TextEncoder().encode(json), `${baseName}-project.json`, 'application/json');
  };

  const importInputRef = useRef<HTMLInputElement>(null);
  const importProjectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const data = parseProjectExport(await file.text());
      const sameAudio = Boolean(audio && data.audio && data.audio.fileName === audio.fileName && data.audio.size === audio.size);
      const warning =
        data.audio && !sameAudio
          ? `\n\nThis data was saved with the track "${data.audio.fileName}", and this project has ${
              audio ? `"${audio.fileName}"` : 'no track'
            }. Notes and the take may not line up.`
          : '';
      if (!window.confirm(`Replace this project's settings, note edits and take with "${data.name}"?${warning}`)) return;
      stop();
      store.flush(true);
      await flushTakeRef.current();
      store.discardPendingSaves();
      await importProjectData(projectId, data, sameAudio);
      window.location.reload();
    } catch (err) {
      window.alert(`Couldn't import the project data: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

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

  const goToStart = () => {
    seekTo(loopEnabled && selection ? Math.min(selection.start, selection.end) : 0);
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

  // Keyboard shortcuts (listed in ShortcutsDialog). The handler is refreshed
  // every render, so it always sees current state without re-subscribing.
  const onKeyRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    onKeyRef.current = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, select, textarea, [contenteditable="true"], [role="dialog"]')) return;
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

      if (event.key === ' ') {
        event.preventDefault();
        if (hasAudio) handlePlayPause();
        return;
      }
      if (event.key === '?') {
        setShowShortcuts(true);
        return;
      }
      if (key === 'home') {
        event.preventDefault();
        if (hasAudio) goToStart();
        return;
      }
      if (key === 'm') return setArmed((value) => !value);
      if (key === 'r' && hasAudio) return toggleRecord();
      if (key === 'l' && selection) return setLoopEnabled((value) => !value);
      if (key === 'h' && hasAudio) return changeTool('pan');
      if (key === 's' && hasAudio) return changeTool('select');
      if (key === 'p' && hasAudio && noteEdits.loaded) return changeTool(penMode ? 'pan' : 'pen');

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
      } else if (selectedNoteId && event.key.startsWith('Arrow')) {
        event.preventDefault();
        const step = event.shiftKey ? 12 : 1;
        const nudge = event.shiftKey ? 0.01 : 0.05;
        if (event.key === 'ArrowUp') nudgeSelected(step, 0);
        else if (event.key === 'ArrowDown') nudgeSelected(-step, 0);
        else if (event.key === 'ArrowLeft') nudgeSelected(0, -nudge);
        else if (event.key === 'ArrowRight') nudgeSelected(0, nudge);
      }
    };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => onKeyRef.current(event);
    // A focused button would also "click" on Space's keyup; Space means play/pause here.
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ' && (event.target as HTMLElement | null)?.closest('button')) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // What the graph says when there's nothing to show yet.
  let overlay: ReactNode = null;
  if (!hasAudio && trackError) {
    overlay = (
      <>
        <p>{trackError}</p>
        <button type="button" className="btn-primary" onClick={chooseFile}>
          <FiUpload /> Choose another file
        </button>
      </>
    );
  } else if (!audio) {
    overlay = (
      <>
        <p>
          <strong>This project has no track yet.</strong>
        </p>
        <p className="hint">
          Add an MP3, WAV, M4A, FLAC or OGG file. It's saved with the project, so you only do this once.
        </p>
        <button type="button" className="btn-primary" onClick={chooseFile}>
          <FiUpload /> Add track
        </button>
      </>
    );
  } else if (!hasAudio) {
    overlay = <p>Decoding audio...</p>;
  } else if (reference.status === 'analyzing') {
    overlay = <p>Analyzing the track... {Math.round(reference.progress * 100)}%</p>;
  } else if (needsAnalysis && studio.showReference) {
    overlay = (
      <>
        <p>
          <strong>Analyze this track to see its notes.</strong>
        </p>
        <p className="hint">Method, window and note range are under Track &amp; reference, below.</p>
        <button type="button" className="btn-primary" onClick={() => void analyze(analysis)}>
          <FiPlay /> Analyze
        </button>
      </>
    );
  }

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
    />
  );

  const menu = (
    <Popover
      kind="menu"
      label="More actions"
      trigger={(trigger) => (
        <button type="button" className="icon-button" {...trigger} aria-label="More actions" title="More actions">
          <FiMoreHorizontal />
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuItem close={close} icon={<FiDownload />} onSelect={exportTake} disabled={!hasAudio}>
            Export take as MIDI
          </MenuItem>
          <MenuItem close={close} icon={<FiDownload />} onSelect={exportReference} disabled={!referenceReady}>
            Export reference as MIDI
          </MenuItem>
          <div className="menu__sep" role="separator" />
          <MenuItem
            close={close}
            icon={<FiSave />}
            onSelect={() => void exportProjectData()}
            title="Save this project's settings, note edits, take and beats to a file (the audio is not included)"
          >
            Export project data
          </MenuItem>
          <MenuItem
            close={close}
            icon={<FiUploadCloud />}
            onSelect={() => importInputRef.current?.click()}
            title="Replace this project's settings, note edits, take and beats with a saved file"
          >
            Import project data...
          </MenuItem>
          <div className="menu__sep" role="separator" />
          <MenuItem close={close} icon={<FiTrash2 />} onSelect={clearTake} disabled={!hasAudio} danger>
            Clear take...
          </MenuItem>
          <MenuItem close={close} icon={<FiXCircle />} onSelect={clearEdits} disabled={editCount === 0} danger>
            Clear note edits...
          </MenuItem>
          <div className="menu__sep" role="separator" />
          <MenuItem
            close={close}
            icon={<FiTool />}
            onSelect={() => void debugExport()}
            disabled={!hasAudio}
            title="Save the decoded audio (WAV), reference contour (CSV) and settings (JSON) to debug-exports/ in the project"
          >
            Debug export
          </MenuItem>
          <MenuItem close={close} icon={<FiCommand />} onSelect={() => setShowShortcuts(true)}>
            Keyboard shortcuts <kbd>?</kbd>
          </MenuItem>
        </>
      )}
    </Popover>
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
                viewportRef,
                pixelsPerSecond: PIXELS_PER_SECOND,
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
              onSeek={hasAudio ? seekTo : undefined}
            />
            {armed && <EngineStats engine={engine} filter={filter} layout="overlay" />}
            {penMode && (
              <span className="pen-badge">
                <FiEdit2 aria-hidden="true" /> Pen: click to add, drag to move, right-click to delete
              </span>
            )}
            {overlay && (
              <div className="graph-overlay">
                <div className="graph-overlay__box" role="status">
                  {overlay}
                </div>
              </div>
            )}
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
            viewportRef={viewportRef}
            playheadXRef={playheadXRef}
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
