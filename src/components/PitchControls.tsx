import type { Dispatch, SetStateAction } from 'react';

type Props = {
  enabled: boolean;
  clarityThreshold: number;
  historyDuration: number;
  setEnabled: Dispatch<SetStateAction<boolean>>;
  setClarityThreshold: Dispatch<SetStateAction<number>>;
  setHistoryDuration: Dispatch<SetStateAction<number>>;
};

export function PitchControls({
  enabled,
  clarityThreshold,
  historyDuration,
  setEnabled,
  setClarityThreshold,
  setHistoryDuration,
}: Props) {
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
