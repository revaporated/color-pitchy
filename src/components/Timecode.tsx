import { useEffect, useRef } from 'react';
import { FRAME_ORDER, onAnimationFrame } from '../audio/frameLoop';

const formatTimecode = (time: number) => {
  const totalHundredths = Math.max(0, Math.round(time * 100));
  const minutes = Math.floor(totalHundredths / 6000);
  const seconds = Math.floor((totalHundredths % 6000) / 100);
  const hundredths = totalHundredths % 100;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
};

/**
 * Song position / duration, plus the time under the mouse. Updates its own
 * text on the shared animation loop, so playback never re-renders the page.
 */
export function Timecode({
  getTime,
  getHoverTime,
  duration,
  className = 'toolbar__time',
}: {
  getTime: () => number;
  getHoverTime?: () => number | null;
  duration: number;
  className?: string;
}) {
  const timeRef = useRef<HTMLSpanElement>(null);
  const hoverRef = useRef<HTMLSpanElement>(null);

  useEffect(
    () =>
      onAnimationFrame(() => {
        const time = Math.min(Math.max(0, getTime()), duration);
        const text = `${formatTimecode(time)} / ${formatTimecode(duration)}`;
        if (timeRef.current && timeRef.current.textContent !== text) timeRef.current.textContent = text;
        const hover = getHoverTime?.() ?? null;
        const hoverText = hover === null ? '' : ` [${formatTimecode(hover)}]`;
        if (hoverRef.current && hoverRef.current.textContent !== hoverText) hoverRef.current.textContent = hoverText;
      }, FRAME_ORDER.text),
    [duration, getHoverTime, getTime],
  );

  return (
    <span className={className}>
      <span ref={timeRef} />
      <span ref={hoverRef} className="hover-timecode" />
    </span>
  );
}
