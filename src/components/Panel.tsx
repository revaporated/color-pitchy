import { useId } from 'react';
import type { ReactNode } from 'react';
import { FiChevronRight } from 'react-icons/fi';
import { usePersistentState } from '../hooks/usePitchSettings';

type Props = {
  /** Remembers whether the panel is open. */
  id: string;
  title: string;
  /** Short status shown on the header, so a closed panel still says where things stand. */
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
};

/** A settings card that collapses to its header. */
export function Panel({ id, title, summary, defaultOpen = false, children }: Props) {
  const [open, setOpen] = usePersistentState(`panel.${id}`, defaultOpen);
  const bodyId = useId();
  return (
    <section className="card panel">
      <button
        type="button"
        className="panel__header"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
      >
        <FiChevronRight aria-hidden="true" />
        <span>{title}</span>
        {summary && <span className="panel__summary">{summary}</span>}
      </button>
      {open && (
        <div id={bodyId} className="panel__body controls">
          {children}
        </div>
      )}
    </section>
  );
}
