# color-pitchy

A real-time pitch detector and pitch-history graph for the browser, where every note is drawn in its [Colorchord](https://github.com/revaporated/colorchord-refactor) color and shape. Sing or play into your mic, watch the pitch trace scroll by, and record what you played as a MIDI file.

This is the TypeScript/Vite rewrite of the pitch features from [`pitchy-test`](https://github.com/revaporated/pitchy-test) (Create React App, plain JS, Mar–Apr 2025). `pitchy-test` is kept only as a reference. See [What didn't carry over](#what-didnt-carry-over).

## Run it

```bash
npm install
npm run dev      # Vite dev server
npm run build    # tsc -b && vite build
npm run lint
```

Needs a Node version that Vite 7 supports (20.19+ or 22.12+). The browser will ask for microphone permission the first time you press play on the main page. Use `localhost` or HTTPS, since `getUserMedia` won't work on plain HTTP.

## Pages

| Route | What it does |
|---|---|
| `/` | Live mic pitch detection: scrolling pitch graph, controls, stats, MIDI recording, fullscreen. |
| `/songs` | Load an audio file, see its waveform, play it, pan or select a region and loop it. Display only: **no pitch analysis of the file**. |
| `/studio` | Experimental. The pitch graph sits above the waveform and follows the playhead, with hover timecode and loop selection. Pitch comes from the **microphone** while the track plays, so it's for singing or playing along with a track, not for analyzing the track itself. Use headphones. |

## How detection works

1. `usePitchDetector` opens the mic, builds an `AudioContext`, and loads `src/worklets/pitch-detector.worklet.ts`.
2. The worklet keeps a ring buffer of the last `fftSize` samples and runs [pitchy](https://github.com/ianprime0509/pitchy) on it at `detectionRateHz` (165 Hz). It posts `{frequency, clarity, audioTime}` to the main thread.
3. The hook turns each result into a sample. It drops the sample if clarity is below the **clarity threshold**, the note is outside the **min/max detectable range**, or the pitch is farther than the **cents threshold** from the nearest semitone.
4. Timestamps come from the audio clock (`audioTime`) rather than arrival time, so the graph isn't thrown off by main-thread jitter.
5. `PitchGraph` draws from a history ring buffer on its own `requestAnimationFrame` loop (`GRAPH_MAX_FPS`), separate from the detection rate.

### Controls

| Control | Range / options |
|---|---|
| Clarity | 0–100% (default 90%) |
| Cents threshold | 5–49¢ (default 25¢) |
| Min / max detectable note | min MIDI 24–84, max MIDI 84–96 (default 36–96, C2–C7) |
| FFT size | 256 to 16384 (default 2048) |
| History | 1–10 s |
| Color marker, note lines, note trails, diagnostics | toggles |

## Recording to MIDI

Press record on `/`, play or sing, press stop, then download the `.mid` file. The conversion (`src/utils/recording.ts`) is deliberately simple. It rounds each sample to the nearest semitone, ends a note whenever that rounded pitch changes, and writes a fixed 120 bpm, 128 ticks-per-beat track with [midi-writer-js](https://github.com/grimmdude/MidiWriterJS). There's no smoothing, minimum note length, vibrato handling or tempo/grid quantization, so expect extra short notes. It's a starting point, not a transcriber.

## Colors and shapes

`src/utils/pitch.ts` holds `PITCH_COLOR_SHAPE_MAP`: one color per pitch class, plus a shape (square or circle) that marks which whole-tone scale the note belongs to.

| Pitch class | Color | Shape |
|---|---|---|
| C | red | square |
| C♯ | green-blue | circle |
| D | orange | square |
| D♯ | blue-purple | circle |
| E | yellow | square |
| F | purple-red | circle |
| F♯ | green | square |
| G | red-orange | circle |
| G♯ | blue | square |
| A | orange-yellow | circle |
| A♯ | purple | square |
| B | yellow-green | circle |

This table is one of several copies of the palette across the Colorchord repos. When a shared package exists, this file should import from it.

## Project layout

```
src/
  main.tsx                 routes: / , /songs , /studio
  App.tsx                  main detection page
  pages/                   Songs.tsx, Studio.tsx
  hooks/
    usePitchDetector.ts    mic -> worklet -> pitch samples
    usePitchRecording.ts   collects samples while recording
    useAudioFile.ts        file upload + decode
    useAudioPlayback.ts    <audio> element playback state
  worklets/
    pitch-detector.worklet.ts
  components/              PitchGraph, PitchControls, PitchStats, RecordingControls,
                           WaveformViewer, PlaybackControls, AudioUpload
    studio/                Studio_* copies of the above (see Known issues)
  utils/                   pitch.ts, recording.ts, waveform.ts
```

## Known issues

- **Mic restarts when you change a detection setting.** The detector's effect depends on clarity, cents, range and FFT size, so changing any of them tears down and recreates the whole `AudioContext`, stream and worklet.
- **Echo cancellation, noise suppression and auto-gain are on.** The mic is requested with `{ audio: true }`, and those browser processors distort pitch tracking. They should be turned off in `getUserMedia`.
- **The main component re-renders at the detection rate.** `setSample` runs on every worklet message (up to 165 times a second). While recording, `setRecordingSamples` copies the whole array on each sample.
- **`components/studio/` is a copy-paste fork** of the main components (about 1.9k lines). `PitchControls` and `PitchStats` are nearly identical to the originals, and `PitchGraph` and `WaveformViewer` differ by a few dozen to a hundred-odd lines. These should become one set of shared components.
- **Uploaded files are never pitch-analyzed.** Detection only reads the mic.
- **MIDI recording is naive** (see above).
- **No tests**, and the template's favicon and page title are still in `index.html`.

## What didn't carry over

Features still only in `pitchy-test`:

- Chroma detector (meyda), at `/chroma`.
- Metronome and tick marks, and the separate time-based graph.
- Pitch deviation meter (tuner view).
- Sticky header and nav. The nav in `Studio.tsx` is commented out here.

Items that were on `pitchy-test`'s TODO and aren't built in either repo: clarity grace period, minimum note duration, audio preprocessing, tempo detection, dark mode, settings persistence.

## Stack

React 19, TypeScript 5.9, Vite 7, Tailwind 4, React Router 7, pitchy 4, meyda (installed, currently unused here), midi-writer-js, react-icons.
