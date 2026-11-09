import type { NoteSet, RefNote } from './noteSet';
import type { PlaybackClock } from './playbackClock';

/** How far ahead (song seconds) notes are handed to the audio thread. */
const LOOKAHEAD_SECONDS = 0.2;
/** How often the scheduler wakes up. Must be well under the lookahead. */
const TICK_MS = 25;
const ATTACK = 0.006;
const DECAY = 0.12;
const SUSTAIN = 0.55;
const RELEASE = 0.06;
/** Per-note peak before the master volume, low enough that a few overlapping notes don't clip. */
const NOTE_PEAK = 0.22;

type Voice = { oscillators: OscillatorNode[]; gain: GainNode; end: number };

/**
 * Plays a NoteSet as a simple synth in time with the <audio> element.
 *
 * Song time comes from the PlaybackClock. Every tick, notes starting in the
 * next LOOKAHEAD_SECONDS are scheduled on the AudioContext clock, so timing
 * doesn't depend on when the timer fires. A seek, pause or loop (anything
 * that moves the clock's discontinuity mark) silences what's queued and
 * starts over from the new position, including notes already in progress.
 */
export class ReferencePlayer {
  private readonly clock: PlaybackClock;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private notes: NoteSet | null = null;
  private enabled = false;
  private volume = 0.5;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly voices = new Set<Voice>();
  /** Song time up to which notes have been scheduled, or null to restart at the playhead. */
  private scheduledUntil: number | null = null;
  private lastDiscontinuity = -1;

  constructor(clock: PlaybackClock) {
    this.clock = clock;
  }

  setNotes(notes: NoteSet | null) {
    if (notes === this.notes) return;
    this.notes = notes;
    this.restart();
  }

  setVolume(volume: number) {
    this.volume = volume;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.02);
  }

  setEnabled(enabled: boolean) {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this.ensureContext();
      this.timer = setInterval(() => this.tick(), TICK_MS);
      this.tick();
    } else {
      if (this.timer !== null) clearInterval(this.timer);
      this.timer = null;
      this.restart();
    }
  }

  /** Plays one short note right away (pen mode feedback), whether or not playback is on. */
  audition(midi: number, seconds = 0.25) {
    this.ensureContext();
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    this.play({ id: 'audition', midi, start: 0, end: seconds, voice: 0, origin: 'manual' }, now, now + seconds);
  }

  dispose() {
    this.setEnabled(false);
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.master = null;
  }

  private ensureContext() {
    if (this.ctx) return;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const master = ctx.createGain();
    master.gain.value = this.volume;
    // Takes the edge off the triangle wave's upper harmonics.
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3200;
    master.connect(tone).connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
  }

  /** Silences everything queued and schedules from the playhead on the next tick. */
  private restart() {
    this.scheduledUntil = null;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const voice of this.voices) {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(0, now, 0.01);
      for (const osc of voice.oscillators) {
        try {
          osc.stop(now + 0.05);
        } catch {
          // already stopped
        }
      }
    }
    this.voices.clear();
  }

  private tick() {
    const ctx = this.ctx;
    const clock = this.clock;
    if (!ctx || !this.enabled) return;

    if (!clock.isPlaying || !this.notes) {
      // Only on the transition out of playback, so pen-mode auditions aren't cut off.
      if (this.scheduledUntil !== null) this.restart();
      return;
    }
    if (ctx.state === 'suspended') void ctx.resume();
    if (clock.discontinuityPerfMs !== this.lastDiscontinuity) {
      this.lastDiscontinuity = clock.discontinuityPerfMs;
      this.restart();
    }

    const songNow = clock.songTimeAt(performance.now());
    // The timer stalled (e.g. a hidden tab): drop what was missed instead of playing it late.
    if (this.scheduledUntil !== null && this.scheduledUntil < songNow - 0.05) this.restart();
    const ctxNow = ctx.currentTime;
    const rate = clock.playbackRate || 1;
    const toCtx = (songTime: number) => ctxNow + (songTime - songNow) / rate;
    const horizon = songNow + LOOKAHEAD_SECONDS;
    const notes = this.notes;

    if (this.scheduledUntil === null) {
      // Fresh start: also pick up notes already sounding at the playhead.
      notes.forEachOverlapping(songNow, songNow, (note) => {
        if (note.start < songNow && note.end > songNow + 0.03) this.play(note, ctxNow, toCtx(note.end));
      });
      this.scheduledUntil = songNow;
    }

    for (let i = notes.firstStartingAt(this.scheduledUntil); i < notes.count; i += 1) {
      const note = notes.notes[i];
      if (note.start >= horizon) break;
      this.play(note, Math.max(ctxNow, toCtx(note.start)), toCtx(note.end));
    }
    this.scheduledUntil = horizon;

    // Forget voices that have finished.
    for (const voice of this.voices) if (voice.end < ctxNow) this.voices.delete(voice);
  }

  private play(note: RefNote, start: number, end: number) {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || end <= start) return;
    const frequency = 440 * 2 ** ((note.midi - 69) / 12);
    const gain = ctx.createGain();
    const g = gain.gain;
    // Short notes skip straight from attack to release so they don't click.
    const holdEnd = Math.max(start + ATTACK, end);
    g.setValueAtTime(0, start);
    g.linearRampToValueAtTime(NOTE_PEAK, start + ATTACK);
    g.setTargetAtTime(NOTE_PEAK * SUSTAIN, start + ATTACK, DECAY / 3);
    g.setTargetAtTime(0, holdEnd, RELEASE / 3);
    gain.connect(master);

    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.value = frequency;
    const shimmer = ctx.createOscillator();
    shimmer.type = 'sine';
    shimmer.frequency.value = frequency * 2;
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.value = 0.25;
    body.connect(gain);
    shimmer.connect(shimmerGain).connect(gain);

    const stopAt = holdEnd + RELEASE * 2;
    for (const osc of [body, shimmer]) {
      osc.start(start);
      osc.stop(stopAt);
    }
    const voice: Voice = { oscillators: [body, shimmer], gain, end: stopAt };
    body.onended = () => {
      gain.disconnect();
      this.voices.delete(voice);
    };
    this.voices.add(voice);
  }
}
