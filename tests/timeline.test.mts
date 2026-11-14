import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimelineView } from '../src/audio/timelineView.ts';

const view = () => {
  const v = new TimelineView(100);
  v.width = 500;
  v.contentWidth = 3000; // a 30 s song
  v.duration = 30;
  return v;
};

test('time and x convert both ways with the scroll', () => {
  const v = view();
  v.scrollLeft = 250;
  assert.equal(v.timeToX(5), 250);
  assert.equal(v.xToTime(250), 5);
  assert.equal(v.startTime, 2.5);
  assert.equal(v.endTime, 7.5);
  for (const t of [0, 1.234, 29.9]) assert.ok(Math.abs(v.xToTime(v.timeToX(t)) - t) < 1e-12);
  assert.equal(v.clampedTimeAt(-1000), 0);
  assert.equal(v.clampedTimeAt(10_000), 30);
});

test('centering the playhead stops at both ends of the song', () => {
  const v = view();
  assert.equal(v.maxScroll, 2500);
  assert.equal(v.centeredScroll(10), 750);
  assert.equal(v.centeredScroll(1), 0);
  assert.equal(v.centeredScroll(29), 2500);
  v.contentWidth = 300; // shorter than the view
  assert.equal(v.centeredScroll(2), 0);
});

test('the playhead stays inside the view and on whole device pixels', () => {
  const v = view();
  assert.equal(v.playheadXFor(10, 750, 1, 2), 250);
  assert.equal(v.playheadXFor(10.001, 750, 2, 2), 250); // 250.1 -> 250 at 2x
  assert.equal(v.playheadXFor(10.003, 750, 2, 2), 250.5);
  assert.equal(v.playheadXFor(0, 750, 1, 2), 0);
  assert.equal(v.playheadXFor(30, 750, 1, 2), 498);
});
