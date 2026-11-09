import { useEffect, useRef } from 'react';
import { FiMinus, FiPlus } from 'react-icons/fi';

type Props = {
  label: string;
  /** Formatted current value. */
  value: string;
  /** Called with -1 or +1 per step. */
  onStep: (direction: -1 | 1) => void;
  canDecrease?: boolean;
  canIncrease?: boolean;
};

const REPEAT_DELAY_MS = 350;
const REPEAT_EVERY_MS = 60;

/**
 * Compact "Label  [-] value [+]" control. Holding a button repeats the step,
 * so fine-grained values (like clarity in 1% steps) are still quick to change.
 */
export function Stepper({ label, value, onStep, canDecrease = true, canIncrease = true }: Props) {
  const timers = useRef<{ delay?: ReturnType<typeof setTimeout>; repeat?: ReturnType<typeof setInterval> }>({});
  const stepRef = useRef(onStep);
  useEffect(() => {
    stepRef.current = onStep;
  }, [onStep]);

  const stop = () => {
    clearTimeout(timers.current.delay);
    clearInterval(timers.current.repeat);
    timers.current = {};
  };
  useEffect(() => stop, []);

  const start = (direction: -1 | 1) => {
    stop();
    stepRef.current(direction);
    timers.current.delay = setTimeout(() => {
      timers.current.repeat = setInterval(() => stepRef.current(direction), REPEAT_EVERY_MS);
    }, REPEAT_DELAY_MS);
  };

  const button = (direction: -1 | 1, enabled: boolean) => (
    <button
      type="button"
      className="stepper__button"
      disabled={!enabled}
      aria-label={`${direction < 0 ? 'Decrease' : 'Increase'} ${label.toLowerCase()}`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        start(direction);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          stepRef.current(direction);
        }
      }}
    >
      {direction < 0 ? <FiMinus /> : <FiPlus />}
    </button>
  );

  return (
    <div className="stepper" role="group" aria-label={label}>
      <span className="stepper__label">{label}</span>
      {button(-1, canDecrease)}
      <span className="stepper__value" aria-live="polite">
        {value}
      </span>
      {button(1, canIncrease)}
    </div>
  );
}
