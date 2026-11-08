# color-pitchy

A real-time pitch detector and pitch-history graph for the browser, where every note is drawn in its [Colorchord](https://github.com/revaporated/colorchord-refactor) color and shape. Sing or play into your mic and watch the pitch trace scroll by, or load a track and sing over it on the same timeline as its waveform and pitch contour. Either can be exported as MIDI.

This is the TypeScript/Vite rewrite of the pitch features from [`pitchy-test`](https://github.com/revaporated/pitchy-test) (Create React App, plain JS, Mar–Apr 2025). `pitchy-test` is kept only as a reference. See [What didn't carry over](#what-didnt-carry-over).

## Run it

```bash
npm install
npm run dev      # Vite dev server
npm run build    # tsc -b && vite build
npm run lint
```

Needs a Node version that Vite 7 supports (20.19+ or 22.12+). The browser will ask for microphone permission the first time you start the mic. Use `localhost` or HTTPS, since `getUserMedia` won't work on plain HTTP.

## Pages

| Route | What it does |
|---|---|
| `/` | **Live.** Mic pitch on a rolling graph, independent of any audio. Controls, stats, MIDI recording, fullscreen. Stopping the mic freezes the graph so you can inspect the last few seconds. |
| `/studio` | **Studio.** Everything in Live, plus a track. The pitch graph shares the waveform's x axis, so your pitch is drawn at the song position you sang it, on top of the track's own pitch contour. Use it to learn or transcribe a track. Headphones recommended. |

`/songs` redirects to `/studio`.

### Studio in detail

- **Mic and playback are separate.** Start the mic from the controls. *Only detect while the track is playing* (on by default) pauses detection whenever the track is paused.
- **Record take.** While on, mic pitch is written onto the take whenever the track plays. The take is stored by song time, so it stays put when you seek, loop or pause. Singing over a passage again replaces just that passage (punch-in). *Clear take* wipes it.
- **Reference contour.** When a track loads, a Web Worker runs pitchy over the whole file (`src/workers/referencePitch.worker.ts`) and the result is drawn as a wide translucent line colored by note. *Reference clarity* sets how confident a frame must be to show. Works best on tracks with one clear melodic line; on dense mixes it follows whatever is loudest.
- **Sync offset.** Mic input and speaker output both add latency, so an uncalibrated take lands slightly late. Sing along with a clear part of the track and move the slider until your line sits on the reference.
- **Exports.** *Take MIDI* and *Reference MIDI* turn either contour into notes (see [Recording to MIDI](#recording-to-midi)) using the current filters.
- Click the pitch graph to seek. Pan/select, scroll/scrub, loop and hover timecode work as on the waveform.

## Recording to MIDI

Live: press record, play or sing, press stop, then download. Studio: *Take MIDI* or *Reference MIDI*. All three go through `src/utils/notes.ts`:

1. apply the current detection filter
2. 5-frame median smoothing
3. round to semitones and split on pitch changes and gaps over 60 ms
4. drop notes shorter than 60 ms (80 ms for the reference), which removes scoops and blips
5. merge same-pitch neighbours across short gaps

`src/utils/midi.ts` writes a format-0 file at 120 bpm with exact timing (no grid quantization). Raw frames are kept, so you can change thresholds and download again.

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
  main.tsx                 routes: / (Live), /studio
  App.tsx                  Live page
  pages/Studio.tsx         Studio page
  audio/
    pitchEngine.ts         mic -> worklet -> raw frames (framework-free)
    frames.ts              FrameRing (Live history), PitchTrack (song-time grid for take + reference)
    playbackClock.ts       performance time -> song position for an <audio> element
  worklets/                pitch-detector.worklet.ts + AudioWorklet type declarations
  workers/                 referencePitch.worker.ts (offline contour of the loaded track)
  hooks/                   usePitchEngine (+ useEngineStats), usePitchSettings, useLiveRecording,
                           useReferenceTrack, useAudioFile, useAudioPlayback
  components/              PitchGraph (shared by both modes), PitchControls, PitchStats,
                           StudioControls, WaveformViewer, PlaybackControls, RecordingControls,
                           AudioUpload, NavBar
  utils/                   pitch.ts, notes.ts, midi.ts, waveform.ts
```

## Known issues

- **Sync offset is manual.** There's no automatic latency calibration yet.
- **Overdubs replace.** Re-singing a passage overwrites it; there's no multi-take history.
- **Reference contour is monophonic.** It's one pitchy estimate per 10 ms, so chords and dense mixes give a noisy line.
- **Only MP3 files load** (`useAudioFile` checks the type).
- **No automated tests in the repo**, and the template's favicon and page title are still in `index.html`.
- `midi-writer-js` and `meyda` are still in `package.json` but unused.

## What didn't carry over

Features still only in `pitchy-test`:

- Chroma detector (meyda), at `/chroma`.
- Metronome and tick marks, and the separate time-based graph.
- Pitch deviation meter (tuner view).

Items that were on `pitchy-test`'s TODO and aren't built in either repo: clarity grace period, audio preprocessing, tempo detection, dark mode. (Minimum note duration now exists for MIDI export, and settings persist.)

## Stack

React 19, TypeScript 5.9, Vite 7, Tailwind 4, React Router 7, pitchy 4, react-icons. (`meyda` and `midi-writer-js` are installed but unused.)
