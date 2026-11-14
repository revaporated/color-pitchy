import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { BeatGrid } from '../../audio/beatGrid';
import type { PitchTrack } from '../../audio/frames';
import type { NoteSet } from '../../audio/noteSet';
import type { AnalysisSettings, ReferenceState } from '../../hooks/useReferenceTrack';
import { buildProjectExport, parseProjectExport, type ProjectMeta } from '../../project/projectDoc';
import type { ProjectStore } from '../../project/projectStore';
import { importProjectData, type AudioRecord } from '../../storage/projects';
import { contourCsv, debugExportBase, encodeWav, saveDebugFile } from '../../utils/debugExport';
import { buildMidiFile, downloadBytes } from '../../utils/midi';
import { collectPitches, segmentNotes } from '../../utils/notes';
import type { DetectionFilter } from '../../utils/pitch';

type Context = {
  project: ProjectMeta;
  projectId: string;
  store: ProjectStore;
  audio: AudioRecord | null;
  audioBuffer: AudioBuffer | null;
  fileName: string | null;
  baseName: string;
  duration: number;
  take: PitchTrack;
  flushTakeRef: { current: () => Promise<void> };
  filter: DetectionFilter;
  analysis: AnalysisSettings;
  reference: ReferenceState;
  referenceFilter: DetectionFilter;
  referenceNotes: NoteSet | null;
  beatGrid: BeatGrid | null;
  studio: { syncOffsetMs: number };
  stop: () => void;
};

/** Everything Studio writes to or reads from files: MIDI exports, the debug export, project backups. */
export function useStudioFiles(context: Context) {
  const {
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
  } = context;
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

  return {
    exportTake,
    exportReference,
    debugExport,
    debugExportStatus,
    exportProjectData,
    importInputRef,
    importProjectFile,
  };
}
