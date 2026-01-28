import type { Dispatch, SetStateAction } from 'react';
import {
  FiChevronDown,
  FiChevronUp,
  FiEyeOff,
  FiPause,
  FiPlay,
  FiSettings,
} from 'react-icons/fi';

type Props = {
  enabled: boolean;
  clarityThreshold: number;
  historyDuration: number;
  fftSize: number;
  colorizeMarker: boolean;
  showNoteLines: boolean;
  showNoteTrails: boolean;
  setEnabled: Dispatch<SetStateAction<boolean>>;
  setClarityThreshold: Dispatch<SetStateAction<number>>;
  setHistoryDuration: Dispatch<SetStateAction<number>>;
  setFftSize: Dispatch<SetStateAction<number>>;
  setColorizeMarker: Dispatch<SetStateAction<boolean>>;
  setShowNoteLines: Dispatch<SetStateAction<boolean>>;
  setShowNoteTrails: Dispatch<SetStateAction<boolean>>;
  isFullscreen?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
};

const FFT_SIZES = [256, 512, 1024, 2048, 4096, 8192, 16384] as const;

export function PitchControls({
  enabled,
  clarityThreshold,
  historyDuration,
  fftSize,
  colorizeMarker,
  showNoteLines,
  showNoteTrails,
  setEnabled,
  setClarityThreshold,
  setHistoryDuration,
  setFftSize,
  setColorizeMarker,
  setShowNoteLines,
  setShowNoteTrails,
  isFullscreen = false,
  collapsed = false,
  onToggleCollapsed,
}: Props) {
  const fallbackIndex = 1;
  const foundIndex = FFT_SIZES.findIndex((value) => value === fftSize);
  const fftIndex = foundIndex === -1 ? fallbackIndex : foundIndex;
  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

  const adjustClarity = (delta: number) => {
    setClarityThreshold((value) =>
      clamp(parseFloat((value + delta).toFixed(2)), 0, 1)
    );
  };

  const adjustHistory = (delta: number) => {
    setHistoryDuration((value) => clamp(value + delta, 1, 10));
  };

  const adjustFft = (delta: number) => {
    setFftSize((value) => {
      const currentIndex = FFT_SIZES.findIndex((size) => size === value);
      const startIndex = currentIndex === -1 ? fallbackIndex : currentIndex;
      const nextIndex = clamp(startIndex + delta, 0, FFT_SIZES.length - 1);
      return FFT_SIZES[nextIndex];
    });
  };

  if (isFullscreen) {
    return (
      <div
        className={`card controls controls--fullscreen${
          collapsed ? ' card--collapsed' : ''
        }`}
      >
        {collapsed ? (
          <button
            className="icon-button"
            onClick={() => onToggleCollapsed?.()}
            aria-label="Show controls"
          >
            <FiSettings />
          </button>
        ) : (
          <div className="controls-row">
            <button
              className="icon-button control-action"
              onClick={() => setEnabled((value) => !value)}
              aria-label={enabled ? 'Pause detection' : 'Start detection'}
            >
              {enabled ? <FiPause /> : <FiPlay />}
            </button>

            <div className="stepper-row">
              <div className="stepper-text">
                <span className="stepper-label">Clarity</span>
                <span className="stepper-value">
                  {Math.round(clarityThreshold * 100)}%
                </span>
              </div>
              <div className="stepper-buttons">
                <button
                  className="icon-button"
                  onClick={() => adjustClarity(0.01)}
                  aria-label="Increase clarity threshold"
                >
                  <FiChevronUp />
                </button>
                <button
                  className="icon-button"
                  onClick={() => adjustClarity(-0.01)}
                  aria-label="Decrease clarity threshold"
                >
                  <FiChevronDown />
                </button>
              </div>
            </div>

            <div className="stepper-row">
              <div className="stepper-text">
                <span className="stepper-label">FFT size</span>
                <span className="stepper-value">{FFT_SIZES[fftIndex]}</span>
              </div>
              <div className="stepper-buttons">
                <button
                  className="icon-button"
                  onClick={() => adjustFft(1)}
                  aria-label="Increase FFT size"
                >
                  <FiChevronUp />
                </button>
                <button
                  className="icon-button"
                  onClick={() => adjustFft(-1)}
                  aria-label="Decrease FFT size"
                >
                  <FiChevronDown />
                </button>
              </div>
            </div>

            <div className="stepper-row">
              <div className="stepper-text">
                <span className="stepper-label">History</span>
                <span className="stepper-value">{historyDuration}s</span>
              </div>
              <div className="stepper-buttons">
                <button
                  className="icon-button"
                  onClick={() => adjustHistory(1)}
                  aria-label="Increase history duration"
                >
                  <FiChevronUp />
                </button>
                <button
                  className="icon-button"
                  onClick={() => adjustHistory(-1)}
                  aria-label="Decrease history duration"
                >
                  <FiChevronDown />
                </button>
              </div>
            </div>

            <div className="toggle-row">
              <span className="stepper-label">Color marker</span>
              <button
                onClick={() => setColorizeMarker((value) => !value)}
                className="toggle-button"
              >
                {colorizeMarker ? 'On' : 'Off'}
              </button>
            </div>

            <div className="toggle-row">
              <span className="stepper-label">Note lines</span>
              <button
                onClick={() => setShowNoteLines((value) => !value)}
                className="toggle-button"
              >
                {showNoteLines ? 'On' : 'Off'}
              </button>
            </div>

            <div className="toggle-row">
              <span className="stepper-label">Note trails</span>
              <button
                onClick={() => setShowNoteTrails((value) => !value)}
                className="toggle-button"
              >
                {showNoteTrails ? 'On' : 'Off'}
              </button>
            </div>

            <button
              className="icon-button card-hide"
              onClick={() => onToggleCollapsed?.()}
              aria-label="Hide controls"
            >
              <FiEyeOff />
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card controls">
      <button onClick={() => setEnabled((value) => !value)}>
        {enabled ? 'Stop' : 'Start'}
      </button>

      <label>
        Clarity threshold: {Math.round(clarityThreshold * 100)}%
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={clarityThreshold}
          onChange={(event) => setClarityThreshold(parseFloat(event.target.value))}
        />
      </label>

      <label>
        FFT size: {FFT_SIZES[fftIndex]}
        <input
          type="range"
          min={0}
          max={FFT_SIZES.length - 1}
          step={1}
          value={fftIndex}
          onChange={(event) =>
            setFftSize(FFT_SIZES[parseInt(event.target.value, 10)])
          }
        />
      </label>

      <label>
        History (seconds): {historyDuration}
        <input
          type="range"
          min={1}
          max={10}
          step={1}
          value={historyDuration}
          onChange={(event) =>
            setHistoryDuration(parseInt(event.target.value, 10))
          }
        />
      </label>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={colorizeMarker}
          onChange={(event) => setColorizeMarker(event.target.checked)}
        />
        Color marker
      </label>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={showNoteLines}
          onChange={(event) => setShowNoteLines(event.target.checked)}
        />
        Note lines
      </label>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={showNoteTrails}
          onChange={(event) => setShowNoteTrails(event.target.checked)}
        />
        Note trails
      </label>
    </div>
  );
}
