import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPTURE_GUIDE, CAPTURE_VIEWS, MAX_CAPTURE_IMAGES, rearCameraPitch } from '../src/lib/capture-guide.ts';

test('all three capture modes give overlap guidance and have room for bridging shots', () => {
  assert.deepEqual(CAPTURE_VIEWS, ['around', 'top', 'bottom']);
  assert.equal(MAX_CAPTURE_IMAGES, 24);
  for (const view of CAPTURE_VIEWS) assert.match(CAPTURE_GUIDE[view].direction, /30–50% overlap/);
});

test('rear camera tilt works in portrait and both landscape orientations', () => {
  assert.ok(Math.abs(rearCameraPitch(90, 0)!) < 1e-6);
  assert.ok(Math.abs(rearCameraPitch(0, 90)!) < 1e-6);
  assert.ok(Math.abs(rearCameraPitch(0, -90)!) < 1e-6);
  assert.equal(rearCameraPitch(180, 0), 90); // rear lens up
  assert.equal(rearCameraPitch(0, 0), -90); // rear lens down
  assert.ok(Math.abs(rearCameraPitch(150, 0)! - 60) < 1e-6);
  assert.ok(Math.abs(rearCameraPitch(30, 0)! + 60) < 1e-6);
});

test('missing or invalid motion data never reports a ready tilt', () => {
  assert.equal(rearCameraPitch(null, 0), null);
  assert.equal(rearCameraPitch(0, null), null);
  assert.equal(rearCameraPitch(NaN, 0), null);
});
