import type { Dispatch, SetStateAction } from 'react';
import type { BeatScale } from '../audio/beatGrid';
import type { BeatState } from '../hooks/useBeats';
import { InfoTip } from './InfoTip';
import { Stepper } from './Stepper';

type Props = {
  hasAudio: boolean;
  detection: BeatState;
  /** Tempo of the beats in use (after halving/doubling), or 0. */
  bpm: number;
  snapLoop: boolean;
  setSnapLoop: Dispatch<SetStateAction<boolean>>;
  metronome: boolean;
  setMetronome: Dispatch<SetStateAction<boolean>>;
  metronomeVolume: number;
  setMetronomeVolume: Dispatch<SetStateAction<number>>;
  beatScale: BeatScale;
  setBeatScale: Dispatch<SetStateAction<BeatScale>>;
  beatsPerGroup: number;
  setBeatsPerGroup: Dispatch<SetStateAction<number>>;
  beatOffset: number;
  setBeatOffset: Dispatch<SetStateAction<number>>;
};

const SCALES: BeatScale[] = [0.5, 1, 2];

/** Detected beats: what to show, the metronome, and fixing tempo and bar alignment. */
export function BeatControls(props: Props) {
  const {
    hasAudio,
    detection,
    bpm,
    snapLoop,
    setSnapLoop,
    metronome,
    setMetronome,
    metronomeVolume,
    setMetronomeVolume,
    beatScale,
    setBeatScale,
    beatsPerGroup,
    setBeatsPerGroup,
    beatOffset,
    setBeatOffset,
  } = props;

  const status = !hasAudio
    ? 'Load a track to find its beats.'
    : detection.status === 'detecting' || detection.status === 'idle'
      ? 'Finding beats...'
      : detection.status === 'error'
        ? `Beat detection failed: ${detection.message}`
        : `${Math.round(bpm)} BPM`;
  const ready = detection.status === 'ready';
  const scaleIndex = SCALES.indexOf(beatScale);

  return (
    <>
      <div className="panel__section">
        <div className="analysis-panel__header">
          <span className="section-label">Detected</span>
          <span className="hint" role="status">{status}</span>
        </div>
      <div className="checkbox-group">
        <label className="checkbox">
          <input type="checkbox" checked={snapLoop} onChange={(event) => setSnapLoop(event.target.checked)} />
          Snap loop to beats
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={metronome} onChange={(event) => setMetronome(event.target.checked)} />
          Metronome
        </label>
        <label className="inline-field">
          Volume: {Math.round(metronomeVolume * 100)}%
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={metronomeVolume}
            disabled={!metronome}
            onChange={(event) => setMetronomeVolume(parseFloat(event.target.value))}
          />
        </label>
      </div>
      </div>

      <div className="panel__section">
        <span className="section-label">Fix tempo and bars</span>
      <div className="stepper-group">
        <Stepper
          label="Tempo"
          value={beatScale === 1 ? 'as found' : beatScale === 2 ? '×2' : '÷2'}
          onStep={(direction) => {
            const next = SCALES[Math.max(0, Math.min(SCALES.length - 1, scaleIndex + direction))];
            setBeatScale(next);
          }}
          canDecrease={ready && scaleIndex > 0}
          canIncrease={ready && scaleIndex < SCALES.length - 1}
        />
        <Stepper
          label="Beats per group"
          value={String(beatsPerGroup)}
          onStep={(direction) => {
            setBeatsPerGroup((value) => Math.max(1, Math.min(16, value + direction)));
            setBeatOffset(0);
          }}
          canDecrease={beatsPerGroup > 1}
          canIncrease={beatsPerGroup < 16}
        />
        <Stepper
          label="Shift groups"
          value={`${beatOffset} beat${beatOffset === 1 ? '' : 's'}`}
          onStep={(direction) => setBeatOffset((value) => (value + direction + beatsPerGroup) % beatsPerGroup)}
          canDecrease={ready}
          canIncrease={ready}
        />
        <InfoTip>
          Beat trackers often lock on to half or double the tempo you'd tap; Tempo fixes that.
          Groups are shaded alternately (set 4 for bars of 4/4). If the shading doesn't start on the
          downbeat, shift it until it does. The metronome accents the first beat of each group.
        </InfoTip>
      </div>
      </div>
    </>
  );
}
