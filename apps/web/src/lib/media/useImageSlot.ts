import { useMemo, useRef } from 'react';
import { recordImage, type ImageOutcome, type ImageSurface } from './imageAudit';

/**
 * A component's handle on the image audit: each (outcome, picture, slot) is
 * reported once per mounted component, so re-renders and effect re-runs never
 * double count. `slotKey` names what the slot currently stands for (a story
 * url, a person) so a reused component that is re-pointed counts again.
 */
export function useImageSlot(surface: ImageSurface) {
  const seen = useRef(new Set<string>());
  return useMemo(() => ({
    report(outcome: ImageOutcome, src?: string | null, slotKey = ''): void {
      const k = `${outcome}|${slotKey}|${src ?? ''}`;
      if (seen.current.has(k)) return;
      seen.current.add(k);
      recordImage(surface, outcome, src);
    },
  }), [surface]);
}
