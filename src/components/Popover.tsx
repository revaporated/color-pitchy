import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type Props = {
  /** Renders the trigger. Spread `props` onto a <button>. */
  trigger: (props: {
    onClick: () => void;
    'aria-expanded': boolean;
    'aria-haspopup': 'dialog' | 'menu';
    'aria-controls': string;
  }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  /** 'menu' for a list of actions, 'dialog' for a panel of settings. */
  kind?: 'dialog' | 'menu';
  align?: 'left' | 'right';
  className?: string;
  label: string;
};

/** A button that opens a floating panel. Closes on outside click and Escape. */
export function Popover({ trigger, children, kind = 'dialog', align = 'right', className, label }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      rootRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <span className="popover-anchor" ref={rootRef}>
      {trigger({
        onClick: () => setOpen((value) => !value),
        'aria-expanded': open,
        'aria-haspopup': kind,
        'aria-controls': id,
      })}
      {open && (
        <div
          id={id}
          role={kind}
          aria-label={label}
          className={`popover${kind === 'menu' ? ' menu' : ''}${align === 'left' ? ' popover--left' : ''}${
            className ? ` ${className}` : ''
          }`}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </span>
  );
}

type ItemProps = {
  onSelect: () => void;
  close: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
};

export function MenuItem({ onSelect, close, icon, danger, disabled, title, children }: ItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`menu__item${danger ? ' menu__item--danger' : ''}`}
      disabled={disabled}
      title={title}
      onClick={() => {
        close();
        onSelect();
      }}
    >
      {icon}
      {children}
    </button>
  );
}
