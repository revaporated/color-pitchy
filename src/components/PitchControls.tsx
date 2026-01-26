import type { Dispatch, SetStateAction } from 'react';

type Props = {
  enabled: boolean;
  clarityThreshold: number;
  historyDuration: number;
  fftSize: number;
  setEnabled: Dispatch<SetStateAction<boolean>>;
  setClarityThreshold: Dispatch<SetStateAction<number>>;
  setHistoryDuration: Dispatch<SetStateAction<number>>;
  setFftSize: Dispatch<SetStateAction<number>>;
};

const FFT_SIZES = [1024, 2048, 4096, 8192] as const;

export function PitchControls({
  enabled,
  clarityThreshold,
  historyDuration,
  fftSize,
  setEnabled,
  setClarityThreshold,
  setHistoryDuration,
  setFftSize,
}: Props) {
  const fallbackIndex = 1;
  const foundIndex = FFT_SIZES.findIndex((value) => value === fftSize);
  const fftIndex = foundIndex === -1 ? fallbackIndex : foundIndex;

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
    </div>
  );
}
