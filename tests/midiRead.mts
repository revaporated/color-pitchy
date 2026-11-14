/** Minimal Standard MIDI File reader for tests: tempo map, time signature, track names, notes. */
export type ReadNote = { midi: number; startTick: number; endTick: number; start: number; end: number; track: number };
export type ReadMidi = {
  format: number;
  ppq: number;
  tracks: number;
  tempos: { tick: number; us: number }[];
  timeSignature: { numerator: number; denominator: number } | null;
  names: string[];
  notes: ReadNote[];
  secondsAt: (tick: number) => number;
};

export function readMidi(bytes: Uint8Array): ReadMidi {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== 'MThd') throw new Error('not a MIDI file');
  const format = view.getUint16(8);
  const tracks = view.getUint16(10);
  const ppq = view.getUint16(12);
  const tempos: { tick: number; us: number }[] = [];
  const names: string[] = [];
  const raw: Omit<ReadNote, 'start' | 'end'>[] = [];
  let timeSignature: ReadMidi['timeSignature'] = null;
  let at = 14;
  for (let t = 0; t < tracks; t += 1) {
    if (tag(at) !== 'MTrk') throw new Error('bad track');
    const end = at + 8 + view.getUint32(at + 4);
    at += 8;
    let tick = 0;
    const open = new Map<number, number>();
    const vlq = () => {
      let v = 0;
      for (;;) {
        const b = bytes[at++];
        v = (v << 7) | (b & 0x7f);
        if (!(b & 0x80)) return v;
      }
    };
    while (at < end) {
      tick += vlq();
      const status = bytes[at++];
      if (status === 0xff) {
        const type = bytes[at++];
        const len = vlq();
        const data = bytes.subarray(at, at + len);
        at += len;
        if (type === 0x51) tempos.push({ tick, us: (data[0] << 16) | (data[1] << 8) | data[2] });
        if (type === 0x58) timeSignature = { numerator: data[0], denominator: 2 ** data[1] };
        if (type === 0x03) names.push(new TextDecoder().decode(data));
      } else {
        const kind = status & 0xf0;
        const pitch = bytes[at++];
        const velocity = bytes[at++];
        if (kind === 0x90 && velocity > 0) open.set(pitch, tick);
        else if (kind === 0x80 || kind === 0x90) {
          const startTick = open.get(pitch);
          if (startTick !== undefined) raw.push({ midi: pitch, startTick, endTick: tick, track: t });
          open.delete(pitch);
        }
      }
    }
    at = end;
  }
  tempos.sort((a, b) => a.tick - b.tick);
  const secondsAt = (tick: number) => {
    let seconds = 0;
    let lastTick = 0;
    let us = 500_000;
    for (const tempo of tempos) {
      if (tempo.tick >= tick) break;
      seconds += ((tempo.tick - lastTick) * us) / ppq / 1e6;
      lastTick = tempo.tick;
      us = tempo.us;
    }
    return seconds + ((tick - lastTick) * us) / ppq / 1e6;
  };
  const notes = raw
    .map((note) => ({ ...note, start: secondsAt(note.startTick), end: secondsAt(note.endTick) }))
    .sort((a, b) => a.startTick - b.startTick || a.midi - b.midi);
  return { format, ppq, tracks, tempos, timeSignature, names, notes, secondsAt };
}
