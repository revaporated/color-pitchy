/**
 * One requestAnimationFrame loop for the whole app.
 *
 * Callbacks run in `order` (lowest first) inside the same frame, so the song
 * clock is synced before the waveform scrolls, and the waveform scrolls before
 * the pitch graph reads its scroll position. Separate rAF loops would run in
 * arbitrary order and let the graph lag the waveform by a frame.
 */
type Callback = (now: number) => void;
type Entry = { callback: Callback; order: number };

export const FRAME_ORDER = {
  clock: -10,
  waveform: 0,
  graph: 10,
  text: 20,
} as const;

const entries: Entry[] = [];
let rafId = 0;

function tick(now: number) {
  rafId = entries.length > 0 ? requestAnimationFrame(tick) : 0;
  // Copy so callbacks can unsubscribe during the frame.
  for (const entry of entries.slice()) entry.callback(now);
}

export function onAnimationFrame(callback: Callback, order = 0) {
  const entry: Entry = { callback, order };
  const index = entries.findIndex((e) => e.order > order);
  if (index === -1) entries.push(entry);
  else entries.splice(index, 0, entry);
  if (!rafId) rafId = requestAnimationFrame(tick);

  return () => {
    const i = entries.indexOf(entry);
    if (i !== -1) entries.splice(i, 1);
    if (entries.length === 0 && rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };
}
