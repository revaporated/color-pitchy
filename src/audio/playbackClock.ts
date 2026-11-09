/**
 * Maps performance-clock time to song position for an <audio> element.
 *
 * `audio.currentTime` updates in coarse steps, so this keeps an anchor
 * (performance time, song time) and extrapolates from it, nudging toward
 * `currentTime` on every `sync()` and re-anchoring hard on seeks, play and pause.
 */
/**
 * How much of the measured error to correct per new audio.currentTime value.
 * audio.currentTime is noisy by a few ms; correcting hard against it makes
 * the extrapolated time (and everything scrolled by it) wobble. A small gain
 * averages that noise out; real drift is slow, and jumps over 150 ms re-anchor.
 */
const CORRECTION_GAIN = 0.03;

export class PlaybackClock {
  private audio: HTMLAudioElement | null = null;
  private anchorPerfMs = 0;
  private anchorSong = 0;
  private playing = false;
  private rate = 1;
  /** audio.currentTime at the last sync, to tell whether it has moved since. */
  private lastReported = Number.NaN;
  private detach: (() => void) | null = null;

  /** performance.now() of the last seek, play or pause. Frames older than this can't be placed reliably. */
  discontinuityPerfMs = 0;
  /** performance.now() of the last sync or hard sync. */
  lastSyncPerfMs = 0;

  attach(audio: HTMLAudioElement | null) {
    this.detach?.();
    this.detach = null;
    this.audio = audio;
    if (!audio) return;

    const onJump = () => this.hardSync();
    const events = ['play', 'playing', 'pause', 'seeking', 'seeked', 'ended', 'ratechange', 'loadedmetadata'];
    events.forEach((name) => audio.addEventListener(name, onJump));
    this.detach = () => events.forEach((name) => audio.removeEventListener(name, onJump));
    this.hardSync();
  }

  get isPlaying() {
    return this.playing;
  }

  /** Song seconds per real second. */
  get playbackRate() {
    return this.rate;
  }

  hardSync() {
    const audio = this.audio;
    const now = performance.now();
    this.anchorPerfMs = now;
    this.lastSyncPerfMs = now;
    this.anchorSong = audio ? audio.currentTime : 0;
    this.lastReported = this.anchorSong;
    this.playing = Boolean(audio && !audio.paused && !audio.ended);
    this.rate = audio?.playbackRate || 1;
    this.discontinuityPerfMs = now;
  }

  /** Cheap; call once per animation frame (and as often as you like otherwise). */
  sync() {
    const audio = this.audio;
    if (!audio) return;
    this.lastSyncPerfMs = performance.now();
    const isPlayingNow = !audio.paused && !audio.ended;
    if (isPlayingNow !== this.playing) {
      this.hardSync();
      return;
    }

    const now = performance.now();
    if (!this.playing) {
      this.anchorPerfMs = now;
      this.anchorSong = audio.currentTime;
      return;
    }

    const predicted = this.songTimeAt(now);
    const reported = audio.currentTime;
    this.anchorPerfMs = now;
    if (reported === this.lastReported) {
      // currentTime only updates in steps. Between steps it's stale, and
      // correcting toward a stale value drags the clock back every frame.
      this.anchorSong = predicted;
      return;
    }
    this.lastReported = reported;
    const error = reported - predicted;
    if (Math.abs(error) > 0.15) {
      this.hardSync();
      return;
    }
    this.anchorSong = predicted + error * CORRECTION_GAIN;
  }

  songTimeAt(perfMs: number) {
    if (!this.playing) return this.anchorSong;
    return this.anchorSong + ((perfMs - this.anchorPerfMs) / 1000) * this.rate;
  }
}
