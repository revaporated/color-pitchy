import type { ReactNode } from 'react';
import { FiPlay, FiUpload } from 'react-icons/fi';
import type { AnalysisSettings, ReferenceState } from '../../hooks/useReferenceTrack';

type Props = {
  hasAudio: boolean;
  trackError: string | null;
  chooseFile: () => void;
  hasTrack: boolean;
  reference: ReferenceState;
  needsAnalysis: boolean;
  studio: { showReference: boolean };
  analysis: AnalysisSettings;
  analyze: (settings: AnalysisSettings) => Promise<void>;
};

/** What the graph says when there's nothing to show yet (renders nothing otherwise). */
export function StudioOverlay({ hasAudio, trackError, chooseFile, hasTrack, reference, needsAnalysis, studio, analysis, analyze }: Props): ReactNode {
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
  } else if (!hasTrack) {
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

  if (!overlay) return null;
  return (
    <div className="graph-overlay">
      <div className="graph-overlay__box" role="status">
        {overlay}
      </div>
    </div>
  );
}
