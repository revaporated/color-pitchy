import { FiCircle, FiDownload, FiSquare } from 'react-icons/fi';

type Props = {
  enabled: boolean;
  isRecording: boolean;
  canDownloadMidi: boolean;
  onStart: () => void;
  onStop: () => void;
  onDownload: () => void;
  className?: string;
};

export const RecordingControls = ({
  enabled,
  isRecording,
  canDownloadMidi,
  onStart,
  onStop,
  onDownload,
  className,
}: Props) => {
  const content = (
    <>
      <button
        type="button"
        className={`icon-button record-button${isRecording ? ' recording' : ''}`}
        onClick={isRecording ? onStop : onStart}
        disabled={!enabled}
        aria-label={isRecording ? 'Stop recording' : 'Start recording'}
      >
        {isRecording ? <FiSquare /> : <FiCircle />}
      </button>
      {canDownloadMidi && (
        <button
          type="button"
          className="icon-button"
          onClick={onDownload}
          aria-label="Download MIDI file"
        >
          <FiDownload />
        </button>
      )}
    </>
  );

  if (className) {
    return <div className={className}>{content}</div>;
  }

  return content;
};
