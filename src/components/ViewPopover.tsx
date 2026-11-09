import type { Dispatch, SetStateAction } from 'react';
import { FiChevronDown, FiLayers } from 'react-icons/fi';
import type { SpectrogramView } from '../audio/spectrogramImage';
import { InfoTip } from './InfoTip';
import { Popover } from './Popover';
import { Stepper } from './Stepper';

type Props = {
  showReference: boolean;
  setShowReference: Dispatch<SetStateAction<boolean>>;
  referenceOpacity: number;
  setReferenceOpacity: Dispatch<SetStateAction<number>>;
  showSpectrogram: boolean;
  setShowSpectrogram: Dispatch<SetStateAction<boolean>>;
  spectrogramView: SpectrogramView;
  setSpectrogramView: Dispatch<SetStateAction<SpectrogramView>>;
  spectrogramRange: number;
  setSpectrogramRange: Dispatch<SetStateAction<number>>;
  spectrogramOpacity: number;
  setSpectrogramOpacity: Dispatch<SetStateAction<number>>;
  spectrogramStatus: string | null;
  showBeats: boolean;
  setShowBeats: Dispatch<SetStateAction<boolean>>;
  showNoteTrails: boolean;
  setShowNoteTrails: Dispatch<SetStateAction<boolean>>;
  trailOpacity: number;
  setTrailOpacity: Dispatch<SetStateAction<number>>;
  showNoteLines: boolean;
  setShowNoteLines: Dispatch<SetStateAction<boolean>>;
  colorizeMarker: boolean;
  setColorizeMarker: Dispatch<SetStateAction<boolean>>;
};

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** The graph's layers and how strongly each is drawn. */
export function ViewPopover(props: Props) {
  return (
    <Popover
      label="View"
      className="view-popover"
      trigger={(trigger) => (
        <button type="button" className="toggle-button" {...trigger} title="Layers shown on the graph">
          <FiLayers /> View <FiChevronDown />
        </button>
      )}
    >
      <div className="view-popover__layer">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={props.showReference}
            onChange={(event) => props.setShowReference(event.target.checked)}
          />
          Reference notes
        </label>
        {props.showReference && (
          <div className="view-popover__sub">
            <label className="inline-field">
              Opacity {percent(props.referenceOpacity)}
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.01}
                value={props.referenceOpacity}
                onChange={(event) => props.setReferenceOpacity(parseFloat(event.target.value))}
              />
            </label>
            <span className="hint">The Pen tool always shows them at full strength.</span>
          </div>
        )}
      </div>

      <div className="view-popover__layer">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={props.showSpectrogram}
            onChange={(event) => props.setShowSpectrogram(event.target.checked)}
          />
          Spectrogram
          {props.spectrogramStatus && <span className="hint">{props.spectrogramStatus}</span>}
        </label>
        {props.showSpectrogram && (
          <div className="view-popover__sub">
            <label className="inline-field">
              <span>
                Show{' '}
                <InfoTip>
                  Raw shows the energy at each semitone, so overtones appear as extra rows above a note.
                  Harmonic adds up each note's overtones and fades anything that doesn't stand out, so the
                  played notes light up. Notes only goes further and keeps roughly one bright row per
                  sounding note.
                </InfoTip>
              </span>
              <select
                value={props.spectrogramView}
                onChange={(event) => props.setSpectrogramView(event.target.value as SpectrogramView)}
              >
                <option value="peaks">Notes only</option>
                <option value="harmonic">Harmonic</option>
                <option value="raw">Raw</option>
              </select>
            </label>
            <Stepper
              label="Range"
              value={`${props.spectrogramRange} dB`}
              onStep={(direction) =>
                props.setSpectrogramRange((value) => Math.min(90, Math.max(20, value + direction * 5)))
              }
              canDecrease={props.spectrogramRange > 20}
              canIncrease={props.spectrogramRange < 90}
            />
            <label className="inline-field">
              Opacity {percent(props.spectrogramOpacity)}
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={props.spectrogramOpacity}
                onChange={(event) => props.setSpectrogramOpacity(parseFloat(event.target.value))}
              />
            </label>
          </div>
        )}
      </div>

      <div className="view-popover__layer">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={props.showNoteTrails}
            onChange={(event) => props.setShowNoteTrails(event.target.checked)}
          />
          Your note trails
        </label>
        {props.showNoteTrails && (
          <div className="view-popover__sub">
            <label className="inline-field">
              Opacity {percent(props.trailOpacity)}
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.01}
                value={props.trailOpacity}
                onChange={(event) => props.setTrailOpacity(parseFloat(event.target.value))}
              />
            </label>
          </div>
        )}
      </div>

      <div className="view-popover__layer">
        <label className="checkbox">
          <input type="checkbox" checked={props.showBeats} onChange={(event) => props.setShowBeats(event.target.checked)} />
          Beats
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={props.showNoteLines}
            onChange={(event) => props.setShowNoteLines(event.target.checked)}
          />
          Semitone lines
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={props.colorizeMarker}
            onChange={(event) => props.setColorizeMarker(event.target.checked)}
          />
          Color the live pitch marker
        </label>
      </div>
    </Popover>
  );
}
