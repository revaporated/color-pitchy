/**
 * Runs the app's own analysis code on the Tangerine export in debug-exports/
 * and prints the numbers that analysis changes are measured against. Also
 * writes a beat-aligned reference MIDI to open in Signal.
 *
 *   npm run measure
 *
 * Output: stdout, plus debug-exports/measure-tangerine.txt and
 * debug-exports/tangerine-reference.mid. Takes about 15 s.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const exportsDir = join(root, 'debug-exports');

// The workers post their results to `self`; capture them here.
let result: any;
(globalThis as any).self = {
  onmessage: null,
  postMessage(message: any) {
    if (message.type === 'result') result = message;
    if (message.type === 'error') throw new Error(message.message);
  },
};
await import('../src/workers/referencePitch.worker.ts');
const referenceWorker = (globalThis as any).self.onmessage;
const { detectBeats } = await import('../src/workers/beats.worker.ts');
const { PitchTrack } = await import('../src/audio/frames.ts');
const { NoteSet } = await import('../src/audio/noteSet.ts');
const { BeatGrid } = await import('../src/audio/beatGrid.ts');
const { buildMidiFile, buildTempoMap } = await import('../src/utils/midi.ts');
const { analysisWindowSize } = await import('../src/hooks/useReferenceTrack.ts');
const { readMidi } = await import('../tests/midiRead.mts');

const lines: string[] = [];
const log = (line: string) => {
  console.log(line);
  lines.push(line);
};

const wavName = readdirSync(exportsDir).find((name) => name.endsWith('.wav'));
if (!wavName) throw new Error(`No .wav in ${exportsDir}`);
const buf = readFileSync(join(exportsDir, wavName));
const channels = buf.readUInt16LE(22);
const rate0 = buf.readUInt32LE(24);
let offset = 12;
while (buf.toString('ascii', offset, offset + 4) !== 'data') offset += 8 + buf.readUInt32LE(offset + 4);
const frames = buf.readUInt32LE(offset + 4) / (2 * channels);
offset += 8;
// Same downmix and 2x decimation as workers/trackPrep.worker.ts.
const step = rate0 >= 32000 ? 2 : 1;
const rate = rate0 / step;
const mono = new Float32Array(Math.floor(frames / step));
for (let i = 0; i < mono.length; i += 1) {
  let sum = 0;
  for (let k = 0; k < step; k += 1) {
    for (let c = 0; c < channels; c += 1) sum += buf.readInt16LE(offset + ((i * step + k) * channels + c) * 2) / 32768;
  }
  mono[i] = sum / (channels * step);
}
const duration = mono.length / rate;
log(`${wavName}: ${rate0} Hz x${channels}, ${duration.toFixed(2)} s`);

// Reference analysis, split into 4 slices like the app on a machine with 5+ cores.
const settings = { method: 'topVoice' as const, smoothing: 4, windowMs: 0, minMidi: 48, maxMidi: 96 };
const gridHz = 100;
const windowSize = analysisWindowSize(settings, rate);
const half = windowSize / 2;
const bins = Math.ceil(duration * gridHz) + 1;
const frequency = new Float32Array(bins);
const clarity = new Float32Array(bins);
let t0 = performance.now();
for (let part = 0, parts = 4; part < parts; part += 1) {
  const binStart = Math.floor((bins * part) / parts);
  const binEnd = Math.floor((bins * (part + 1)) / parts);
  const sampleStart = Math.max(0, Math.round((binStart / gridHz) * rate) - half);
  const sampleEnd = Math.min(mono.length, Math.round(((binEnd - 1) / gridHz) * rate) - half + windowSize);
  const samples = mono.slice(sampleStart, Math.max(sampleStart, sampleEnd));
  referenceWorker({ data: { ...settings, samples, sampleOffset: sampleStart, sampleRate: rate, gridHz, windowSize, binStart, binEnd } });
  frequency.set(result.frequency, binStart);
  clarity.set(result.clarity, binStart);
}
log(`reference: top voice, smoothing 4, C3-C7, window ${windowSize} (${Math.round(performance.now() - t0)} ms)`);

// Contour runs: stretches of frames on one semitone (clarity >= 0.8).
const runs: [number | null, number][] = [];
let current: number | null | undefined;
let length = 0;
for (let i = 0; i < bins; i += 1) {
  const note = frequency[i] > 0 && clarity[i] >= 0.8 ? Math.round(69 + 12 * Math.log2(frequency[i] / 440)) : null;
  if (note === current) length += 1;
  else {
    if (length) runs.push([current as number | null, length]);
    current = note;
    length = 1;
  }
}
runs.push([current as number | null, length]);
const voiced = runs.filter(([note]) => note !== null);
let flips = 0;
for (let i = 1; i < runs.length - 1; i += 1) {
  const [a] = runs[i - 1];
  const [b, len] = runs[i];
  const [c] = runs[i + 1];
  if (len <= 3 && a !== null && b !== null && c !== null && a === c && a !== b) flips += 1;
}
const row = (label: string, value: number, baseline: number) =>
  log(`  ${label.padEnd(34)} ${String(value).padStart(6)}   baseline ${baseline}${value === baseline ? '' : '  <-- CHANGED'}`);
log('contour');
row('runs', voiced.length, 1467);
row('runs <= 30 ms', voiced.filter(([, n]) => n <= 3).length, 183);
row('A-B-A flips', flips, 12);
row('runs >= 100 ms', voiced.filter(([, n]) => n >= 10).length, 987);

// Notes as Studio builds them (reference clarity 0.8, graph range C2-C7).
const track = PitchTrack.fromArrays(frequency, clarity, gridHz);
const noteSet = NoteSet.fromContour(track, duration, { clarityThreshold: 0.8, centsThreshold: 50, minMidi: 36, maxMidi: 96 }, { medianWindow: 1, minDuration: 0.05 });
const notes = noteSet.notes;
const lengths = notes.map((n: any) => n.end - n.start).sort((a: number, b: number) => a - b);
log('notes');
row('notes', notes.length, 1160);
row('notes < 100 ms', lengths.filter((d: number) => d < 0.1).length, 215);
row('median length (ms)', Math.round(1000 * lengths[lengths.length >> 1]), 180);

// Beats.
t0 = performance.now();
const { beats, bpm } = detectBeats(mono, rate);
log(`beats (${Math.round(performance.now() - t0)} ms)`);
row('beats', beats.length, 689);
row('bpm x10', Math.round(bpm * 10), 1523);

// MIDI export with the beat grid, read back.
const grid = new BeatGrid(beats, 1, 4, 0);
const bytes = buildMidiFile(notes, { beats: grid, trackName: 'Tangerine reference' });
const file = readMidi(bytes);
const map = buildTempoMap(grid, notes[notes.length - 1].end)!;
const shift = map.beatTimes[0];
let worst = 0;
file.notes.forEach((note: any, i: number) => {
  worst = Math.max(worst, Math.abs(note.start + shift - notes[i].start), Math.abs(note.end + shift - notes[i].end));
});
let offBeat = 0;
for (let i = 0; i < grid.count; i += 1) {
  if (Math.abs(map.toTick(grid.times[i]) / map.ppq - (i + map.firstBeat)) > 1e-6) offBeat += 1;
}
log('midi export');
log(`  format ${file.format}, ${file.tracks} tracks, ${file.tempos.length} tempo events, ${file.timeSignature?.numerator}/${file.timeSignature?.denominator}, ${file.notes.length} notes`);
log(`  grid beat 0 is file beat ${map.firstBeat}; beats not on a whole quarter: ${offBeat}`);
log(`  worst note time error after read-back: ${(worst * 1000).toFixed(3)} ms (limit 1.5)  ${worst < 0.0015 ? 'OK' : 'FAIL'}`);
log(`  file starts ${(-shift).toFixed(3)} s before the audio (padding to a downbeat)`);
writeFileSync(join(exportsDir, 'tangerine-reference.mid'), bytes);
log('  wrote debug-exports/tangerine-reference.mid');

writeFileSync(join(exportsDir, 'measure-tangerine.txt'), `${new Date().toISOString()}\n${lines.join('\n')}\n`);
