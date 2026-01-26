import type { PitchSample } from '../hooks/usePitchDetector';
import { formatNoteLabel } from '../utils/pitch';

type Props = {
  sample: PitchSample;
};

export function PitchStats({ sample }: Props) {
  const noteLabel = sample.midi != null ? formatNoteLabel(sample.midi) : '—';
  const frequencyLabel =
    sample.frequency != null ? `${sample.frequency.toFixed(2)} Hz` : '—';
  const clarityLabel =
    sample.clarity != null ? `${Math.round(sample.clarity * 100)}%` : '—';

  return (
    <div className="card stats">
      <div>Note: {noteLabel}</div>
      <div>Frequency: {frequencyLabel}</div>
      <div>Clarity: {clarityLabel}</div>
    </div>
  );
}
