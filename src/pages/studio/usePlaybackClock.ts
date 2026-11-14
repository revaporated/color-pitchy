import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { FRAME_ORDER, onAnimationFrame } from '../../audio/frameLoop';
import { PlaybackClock } from '../../audio/playbackClock';

/**
 * The song clock for the track's <audio> element, synced once per animation
 * frame, plus the element's volume and speed.
 */
export function usePlaybackClock(
  audioRef: RefObject<HTMLAudioElement>,
  audioUrl: string | null,
  studio: { trackVolume: number; playbackRate: number },
) {
  const [clock] = useState(() => new PlaybackClock());
  useEffect(() => {
    clock.attach(audioRef.current);
    return () => clock.attach(null);
  }, [clock, audioRef]);
  // Sync the clock once per frame, before the waveform and graph read it.
  useEffect(() => onAnimationFrame(() => clock.sync(), FRAME_ORDER.clock), [clock]);

  // Track volume (lets you mute the song to hear the reference on its own).
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = studio.trackVolume;
  }, [audioRef, studio.trackVolume, audioUrl]);

  // Playback speed, keeping pitch. The clock picks the rate up from the
  // element's ratechange event, so the graph, take, reference playback and
  // metronome all follow it.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.preservesPitch = true;
    audio.defaultPlaybackRate = studio.playbackRate;
    audio.playbackRate = studio.playbackRate;
  }, [audioRef, studio.playbackRate, audioUrl]);

  return clock;
}
