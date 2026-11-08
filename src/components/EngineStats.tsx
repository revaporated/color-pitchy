import type { ComponentProps } from 'react';
import type { PitchEngine } from '../audio/pitchEngine';
import { useEngineStats } from '../hooks/usePitchEngine';
import type { DetectionFilter } from '../utils/pitch';
import { PitchStats } from './PitchStats';

type Props = Omit<ComponentProps<typeof PitchStats>, 'sample'> & {
  engine: PitchEngine;
  filter: DetectionFilter;
};

/**
 * PitchStats fed straight from the engine. The ~12 Hz readout state lives
 * here, so it re-renders this card only, not the whole page.
 */
export function EngineStats({ engine, filter, ...rest }: Props) {
  const { sample } = useEngineStats(engine, filter);
  return <PitchStats sample={sample} {...rest} />;
}
