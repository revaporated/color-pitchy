/**
 * Maps performance-clock time to song position for an <audio> element.
 *
 * `audio.currentTime` updates in coarse steps, so this keeps an anchor
 * (performance time, song time) and extrapolates from it, nudging toward
 * `currentTime` on every `sync()` and re-anchoring hard on seeks, play and pause.
 */
export class PlaybackClock {
  private audio: HTMLAudioElement | null = null;
  private anchorPerfMs = 0;
  private anchorSong = 0;
  private playing = false;
  private rate = 1;
  private detach: (() => void) | null = null;

  /** performance.now() of the last seek, play or pause. Frames older than this can't be placed reliably. */
  discontinuityPerfMs = 0;

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

  hardSync() {
    const audio = this.audio;
    const now = performance.now();
    this.anchorPerfMs = now;
    this.anchorSong = audio ? audio.currentTime : 0;
    this.playing = Boolean(audio && !audio.paused && !audio.ended);
    this.rate = audio?.playbackRate || 1;
    this.discontinuityPerfMs = now;
  }

  /** Cheap; call once per animation frame (and as often as you like otherwise). */
  sync() {
    const audio = this.audio;
    if (!audio) return;
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
    const error = audio.currentTime - predicted;
    if (Math.abs(error) > 0.15) {
      this.hardSync();
      return;
    }
    this.anchorPerfMs = now;
    this.anchorSong = predicted + error * 0.1;
  }

  songTimeAt(perfMs: number) {
    if (!this.playing) return this.anchorSong;
    return this.anchorSong + ((perfMs - this.anchorPerfMs) / 1000) * this.rate;
  }
}
