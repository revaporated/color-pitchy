import type { Dispatch, SetStateAction } from 'react';
import {
  FiChevronDown,
  FiChevronUp,
  FiEyeOff,
  FiPause,
  FiPlay,
  FiSettings,
} from 'react-icons/fi';
import { midiToNoteName } from '../utils/pitch';

type Props = {
  enabled: boolean;
  clarityThreshold: number;
  centsThreshold: number;
  historyDuration: number;
  fftSize: number;
  colorizeMarker: boolean;
  showNoteLines: boolean;
  showNoteTrails: boolean;
  trailOpacity: number;
  showDiagnostics: boolean;
  minDetectableNote: number;
  maxDetectableNote: number;
  setEnabled: Dispatch<SetStateAction<boolean>>;
  setClarityThreshold: Dispatch<SetStateAction<number>>;
  setCentsThreshold: Dispatch<SetStateAction<number>>;
  setHistoryDuration: Dispatch<SetStateAction<number>>;
  setFftSize: Dispatch<SetStateAction<number>>;
  setColorizeMarker: Dispatch<SetStateAction<boolean>>;
  setShowNoteLines: Dispatch<SetStateAction<boolean>>;
  setShowNoteTrails: Dispatch<SetStateAction<boolean>>;
  setTrailOpacity: Dispatch<SetStateAction<number>>;
  setShowDiagnostics: Dispatch<SetStateAction<boolean>>;
  setMinDetectableNote: Dispatch<SetStateAction<number>>;
  setMaxDetectableNote: Dispatch<SetStateAction<number>>;
  /** Hide the History control (Studio's graph follows the song timeline instead). */
  showHistory?: boolean;
  isFullscreen?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
};

const FFT_SIZES = [256, 512, 1024, 2048, 4096, 8192, 16384] as const;

export function PitchControls({
  enabled,
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
  setEnabled,
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
  showHistory = true,
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

  const adjustCentsThreshold = (delta: number) => {
    setCentsThreshold((value) => clamp(value + delta, 5, 49));
  };

  const adjustMinNote = (delta: number) => {
    setMinDetectableNote((value) => {
      const next = clamp(value + delta, 24, 84);
      return next > maxDetectableNote ? maxDetectableNote : next;
    });
  };

  const adjustMaxNote = (delta: number) => {
    setMaxDetectableNote((value) => {
      const next = clamp(value + delta, 84, 96);
      return next < minDetectableNote ? minDetectableNote : next;
    });
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
          <div className="controls-stack">
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

              {showHistory && (
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
              )}

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

              <div className="toggle-row">
                <span className="stepper-label">Diagnostics</span>
                <button
                  onClick={() => setShowDiagnostics((value) => !value)}
                  className="toggle-button"
                >
                  {showDiagnostics ? 'On' : 'Off'}
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

            <div className="controls-row">
              <div className="stepper-row">
                <div className="stepper-text">
                  <span className="stepper-label">Min detect</span>
                  <span className="stepper-value">
                    {midiToNoteName(minDetectableNote).note}
                    {midiToNoteName(minDetectableNote).octave} ({minDetectableNote})
                  </span>
                </div>
                <div className="stepper-buttons">
                  <button
                    className="icon-button"
                    onClick={() => adjustMinNote(1)}
                    aria-label="Increase min detectable note"
                  >
                    <FiChevronUp />
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => adjustMinNote(-1)}
                    aria-label="Decrease min detectable note"
                  >
                    <FiChevronDown />
                  </button>
                </div>
              </div>

              <div className="stepper-row">
                <div className="stepper-text">
                  <span className="stepper-label">Max detect</span>
                  <span className="stepper-value">
                    {midiToNoteName(maxDetectableNote).note}
                    {midiToNoteName(maxDetectableNote).octave} ({maxDetectableNote})
                  </span>
                </div>
                <div className="stepper-buttons">
                  <button
                    className="icon-button"
                    onClick={() => adjustMaxNote(1)}
                    aria-label="Increase max detectable note"
                  >
                    <FiChevronUp />
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => adjustMaxNote(-1)}
                    aria-label="Decrease max detectable note"
                  >
                    <FiChevronDown />
                  </button>
                </div>
              </div>

              <div className="stepper-row">
                <div className="stepper-text">
                  <span className="stepper-label">Cents threshold</span>
                  <span className="stepper-value">±{centsThreshold}c</span>
                </div>
                <div className="stepper-buttons">
                  <button
                    className="icon-button"
                    onClick={() => adjustCentsThreshold(1)}
                    aria-label="Increase cents threshold"
                  >
                    <FiChevronUp />
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => adjustCentsThreshold(-1)}
                    aria-label="Decrease cents threshold"
                  >
                    <FiChevronDown />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card controls">
      <button onClick={() => setEnabled((value) => !value)}>
        {enabled ? 'Stop mic' : 'Start mic'}
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

      {showHistory && (
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
      )}

      <label>
        Cents threshold: ±{centsThreshold}c
        <input
          type="range"
          min={5}
          max={49}
          step={1}
          value={centsThreshold}
          onChange={(event) =>
            setCentsThreshold(parseInt(event.target.value, 10))
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

      <label>
        Trail opacity: {Math.round(trailOpacity * 100)}%
        <input
          type="range"
          min={0.05}
          max={1}
          step={0.01}
          value={trailOpacity}
          onChange={(event) => setTrailOpacity(parseFloat(event.target.value))}
        />
      </label>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={showDiagnostics}
          onChange={(event) => setShowDiagnostics(event.target.checked)}
        />
        Diagnostics
      </label>

      <label>
        Min detect: {midiToNoteName(minDetectableNote).note}{midiToNoteName(minDetectableNote).octave} ({minDetectableNote})
        <input
          type="range"
          min={24}
          max={84}
          step={1}
          value={minDetectableNote}
          onChange={(event) => {
            const val = parseInt(event.target.value, 10);
            setMinDetectableNote(val);
            if (val > maxDetectableNote) setMaxDetectableNote(val);
          }}
        />
      </label>

      <label>
        Max detect: {midiToNoteName(maxDetectableNote).note}{midiToNoteName(maxDetectableNote).octave} ({maxDetectableNote})
        <input
          type="range"
          min={84}
          max={96}
          step={1}
          value={maxDetectableNote}
          onChange={(event) => {
            const val = parseInt(event.target.value, 10);
            setMaxDetectableNote(val);
            if (val < minDetectableNote) setMinDetectableNote(val);
          }}
        />
      </label>
    </div>
  );
}
