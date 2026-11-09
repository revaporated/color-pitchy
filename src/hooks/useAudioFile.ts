import { useEffect, useState } from 'react';

export type AudioSource = { blob: Blob; fileName: string };

type Decoded = {
  source: AudioSource;
  url: string;
  buffer: AudioBuffer | null;
  error: string | null;
};

/**
 * Decodes an audio blob from the library and gives the <audio> element a URL
 * for it. Pass a new source object to switch tracks; pass null for no track.
 */
export function useAudioSource(source: AudioSource | null) {
  const [decoded, setDecoded] = useState<Decoded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    const url = URL.createObjectURL(source.blob);

    void (async () => {
      const context = new AudioContext();
      try {
        const data = await source.blob.arrayBuffer();
        const buffer = await context.decodeAudioData(data);
        if (!cancelled) setDecoded({ source, url, buffer, error: null });
      } catch {
        if (!cancelled) {
          setDecoded({ source, url, buffer: null, error: 'Unable to decode this audio file.' });
        }
      } finally {
        void context.close().catch(() => undefined);
      }
    })();

    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [source]);

  const current = source && decoded?.source === source ? decoded : null;

  return {
    audioUrl: current?.url ?? null,
    audioBuffer: current?.buffer ?? null,
    fileName: source?.fileName ?? null,
    isDecoding: Boolean(source) && !current,
    error: error ?? current?.error ?? null,
    duration: current?.buffer?.duration ?? 0,
    setError,
  };
}
