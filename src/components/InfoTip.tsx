import type { ReactNode } from 'react';
import { FiInfo } from 'react-icons/fi';

/** Small info icon that reveals `children` in a tooltip on hover or keyboard focus. */
export function InfoTip({ children }: { children: ReactNode }) {
  return (
    <span className="info-tip" tabIndex={0} role="note">
      <FiInfo aria-hidden="true" />
      <span className="info-tip__bubble">{children}</span>
    </span>
  );
}
