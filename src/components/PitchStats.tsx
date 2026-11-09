import { FiBarChart2, FiEyeOff } from 'react-icons/fi';
import { formatNoteLabel, type PitchSample } from '../utils/pitch';

type Props = {
  sample: PitchSample;
  isFullscreen?: boolean;
  /** 'row' lays the readouts out horizontally in a normal card; 'overlay' floats them over the graph. */
  layout?: 'stack' | 'row' | 'overlay';
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
};

export function PitchStats({
  sample,
  isFullscreen = false,
  layout = 'stack',
  collapsed = false,
  onToggleCollapsed,
}: Props) {
  const noteLabel = sample.midi != null ? formatNoteLabel(sample.midi) : '—';
  const frequencyLabel =
    sample.frequency != null ? `${sample.frequency.toFixed(2)} Hz` : '—';
  const clarityLabel =
    sample.clarity != null ? `${Math.round(sample.clarity * 100)}%` : '—';

  if (isFullscreen) {
    return (
      <div
        className={`card stats stats--fullscreen${
          collapsed ? ' card--collapsed' : ''
        }`}
      >
        {collapsed ? (
          <button
            className="icon-button"
            onClick={() => onToggleCollapsed?.()}
            aria-label="Show stats"
          >
            <FiBarChart2 />
          </button>
        ) : (
          <div className="stats-row">
            <div className="stat">
              <span className="stat-label">Note</span>
              <span className="stat-value">{noteLabel}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Frequency</span>
              <span className="stat-value">{frequencyLabel}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Clarity</span>
              <span className="stat-value">{clarityLabel}</span>
            </div>
            <button
              className="icon-button card-hide"
              onClick={() => onToggleCollapsed?.()}
              aria-label="Hide stats"
            >
              <FiEyeOff />
            </button>
          </div>
        )}
      </div>
    );
  }

  if (layout === 'overlay') {
    return (
      <div className="graph-stats" aria-live="off">
        <div className="stat">
          <span className="stat-label">Note</span>
          <span className="stat-value">{noteLabel}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Frequency</span>
          <span className="stat-value">{frequencyLabel}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Clarity</span>
          <span className="stat-value">{clarityLabel}</span>
        </div>
      </div>
    );
  }

  if (layout === 'row') {
    return (
      <div className="card stats stats--row">
        <div className="stats-row">
          <div className="stat">
            <span className="stat-label">Note</span>
            <span className="stat-value">{noteLabel}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Frequency</span>
            <span className="stat-value">{frequencyLabel}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Clarity</span>
            <span className="stat-value">{clarityLabel}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card stats">
      <div>Note: {noteLabel}</div>
      <div>Frequency: {frequencyLabel}</div>
      <div>Clarity: {clarityLabel}</div>
    </div>
  );
}
