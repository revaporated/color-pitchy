import type { ReactNode } from 'react';
import {
  FiCircle,
  FiCornerUpLeft,
  FiCornerUpRight,
  FiEdit2,
  FiMic,
  FiPause,
  FiPlay,
  FiRepeat,
  FiSquare,
  FiX,
} from 'react-icons/fi';
import { LuHand, LuTextCursor } from 'react-icons/lu';
import { InfoTip } from './InfoTip';
import { Stepper } from './Stepper';
import { Timecode } from './Timecode';

export type StudioTool = 'pan' | 'select' | 'pen';

type Props = {
  hasAudio: boolean;
  isPlaying: boolean;
  getTime: () => number;
  getHoverTime: () => number | null;
  duration: number;
  onPlayPause: () => void;
  onStop: () => void;

  micOn: boolean;
  onToggleMic: () => void;
  recording: boolean;
  onToggleRecord: () => void;

  hasSelection: boolean;
  loopEnabled: boolean;
  onToggleLoop: () => void;
  onClearSelection: () => void;

  tool: StudioTool;
  onToolChange: (tool: StudioTool) => void;
  penAvailable: boolean;
  panMode: 'scroll' | 'scrub';
  onPanModeChange: (mode: 'scroll' | 'scrub') => void;

  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  editCount: number;

  playbackRate: number;
  onPlaybackRateChange: (rate: number) => void;

  /** The View popover and the ⋯ menu, built by the page. */
  view: ReactNode;
  menu: ReactNode;
  /** Short message from the last action (e.g. debug export). */
  status?: string | null;
};

const MIN_RATE = 0.25;
const MAX_RATE = 2;

/**
 * Everything you use while working, in one bar pinned to the top of the
 * workspace: transport, mic and record, loop, tools, undo and view.
 */
export function StudioToolbar(props: Props) {
  const {
    hasAudio,
    isPlaying,
    tool,
    onToolChange,
    playbackRate,
    onPlaybackRateChange,
  } = props;

  const toolButton = (value: StudioTool, label: string, key: string, icon: ReactNode, disabled = false) => (
    <button
      type="button"
      className="toggle-button"
      aria-pressed={tool === value}
      onClick={() => onToolChange(value)}
      disabled={!hasAudio || disabled}
      title={`${label} (${key})`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="toolbar" role="toolbar" aria-label="Studio">
      <div className="toolbar__group">
        <button
          type="button"
          className="icon-button"
          onClick={props.onPlayPause}
          disabled={!hasAudio}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          title={`${isPlaying ? 'Pause' : 'Play'} (Space)`}
        >
          {isPlaying ? <FiPause /> : <FiPlay />}
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={props.onStop}
          disabled={!hasAudio}
          aria-label="Stop"
          title="Stop"
        >
          <FiSquare />
        </button>
        {hasAudio && props.duration > 0 && (
          <Timecode getTime={props.getTime} getHoverTime={props.getHoverTime} duration={props.duration} />
        )}
      </div>

      <span className="toolbar__sep" aria-hidden="true" />

      <div className="toolbar__group">
        <button
          type="button"
          className="toggle-button"
          aria-pressed={props.micOn}
          onClick={props.onToggleMic}
          title="Mic on / off (M)"
        >
          <FiMic /> Mic
        </button>
        <button
          type="button"
          className="toggle-button record-button"
          aria-pressed={props.recording}
          onClick={props.onToggleRecord}
          disabled={!hasAudio}
          title="Record take (R). While on, your pitch is written onto the take whenever the track plays; singing a passage again replaces it. Turns the mic on."
        >
          <FiCircle /> {props.recording ? 'Recording' : 'Rec'}
        </button>
        <button
          type="button"
          className="toggle-button"
          aria-pressed={props.loopEnabled}
          onClick={props.onToggleLoop}
          disabled={!props.hasSelection}
          title={props.hasSelection ? 'Loop the selection (L)' : 'Select a passage with the Select tool to loop it'}
        >
          <FiRepeat /> Loop
        </button>
        {props.hasSelection && (
          <button
            type="button"
            className="icon-button btn-ghost"
            onClick={props.onClearSelection}
            aria-label="Clear selection"
            title="Clear selection"
          >
            <FiX />
          </button>
        )}
      </div>

      <span className="toolbar__sep" aria-hidden="true" />

      <div className="toolbar__group">
        <div className="segmented" role="group" aria-label="Tool">
          {toolButton('pan', 'Pan', 'H', <LuHand />)}
          {toolButton('select', 'Select', 'S', <LuTextCursor />)}
          {toolButton('pen', 'Pen', 'P', <FiEdit2 />, !props.penAvailable)}
        </div>
        {tool === 'pan' && (
          <div className="segmented" role="group" aria-label="Drag on the waveform to">
            <button
              type="button"
              className="toggle-button"
              aria-pressed={props.panMode === 'scroll'}
              onClick={() => props.onPanModeChange('scroll')}
              disabled={!hasAudio}
              title="Dragging the waveform scrolls the view"
            >
              Scroll
            </button>
            <button
              type="button"
              className="toggle-button"
              aria-pressed={props.panMode === 'scrub'}
              onClick={() => props.onPanModeChange('scrub')}
              disabled={!hasAudio}
              title="Dragging the waveform moves the playhead"
            >
              Scrub
            </button>
          </div>
        )}
        {tool === 'pen' && (
          <>
            <button
              type="button"
              className="icon-button btn-ghost"
              onClick={props.onUndo}
              disabled={!props.canUndo}
              aria-label="Undo"
              title="Undo (Ctrl+Z)"
            >
              <FiCornerUpLeft />
            </button>
            <button
              type="button"
              className="icon-button btn-ghost"
              onClick={props.onRedo}
              disabled={!props.canRedo}
              aria-label="Redo"
              title="Redo (Ctrl+Shift+Z)"
            >
              <FiCornerUpRight />
            </button>
            <span className="hint">
              {props.editCount === 0 ? 'No edits' : `${props.editCount} edit${props.editCount === 1 ? '' : 's'}`}
            </span>
            <InfoTip>
              Click to add a note, or drag to draw a longer one. Drag a note to move it; hold Shift to change
              only its pitch. Drag either end to trim. Right-click a note, or select it and press Delete, to
              remove it. Arrow keys nudge the selected note. Your edits are kept when you re-analyze.
            </InfoTip>
          </>
        )}
      </div>

      <span className="toolbar__spacer" />
      {props.status && <span className="hint">{props.status}</span>}

      <div className="toolbar__group">
        <Stepper
          label="Speed"
          value={`${Math.round(playbackRate * 100)}%`}
          onStep={(direction) =>
            onPlaybackRateChange(
              Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round((playbackRate + direction * 0.05) * 100) / 100)),
            )
          }
          canDecrease={hasAudio && playbackRate > MIN_RATE}
          canIncrease={hasAudio && playbackRate < MAX_RATE}
        />
        {playbackRate !== 1 && (
          <button type="button" className="link-button" onClick={() => onPlaybackRateChange(1)}>
            Reset
          </button>
        )}
      </div>

      <div className="toolbar__group">
        {props.view}
        {props.menu}
      </div>
    </div>
  );
}
