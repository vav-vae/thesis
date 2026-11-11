import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPTURE_GUIDE, CAPTURE_VIEWS, captureAlignment, capturePitchReady, captureTargetPitch, normalizeHeading, rearCameraHeading, rearCameraPitch, shortestTurn } from '../src/lib/capture-guide.ts';

test('all three capture modes give overlap guidance', () => {
  assert.deepEqual(CAPTURE_VIEWS, ['around', 'top', 'bottom']);
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

test('lens heading agrees for equivalent portrait and landscape poses', () => {
  const almostNorth = (heading: number | null) => {
    assert.notEqual(heading, null);
    assert.ok(Math.abs(shortestTurn(heading!, 0)) < 1e-6);
  };
  almostNorth(rearCameraHeading(0, 90, 0));
  almostNorth(rearCameraHeading(90, 0, -90));
  almostNorth(rearCameraHeading(270, 0, 90));
  assert.equal(rearCameraHeading(0, 0, 90), 270);
  assert.equal(rearCameraHeading(0, 0, -90), 90);
});

test('missing sensor data and vertical lens directions have no usable heading', () => {
  assert.equal(rearCameraHeading(null, 90, 0), null);
  assert.equal(rearCameraHeading(NaN, 90, 0), null);
  assert.equal(rearCameraHeading(0, null, 0), null);
  assert.equal(rearCameraHeading(0, 0, 0), null);
  assert.equal(rearCameraHeading(0, 180, 0), null);
});

test('turns take the short route through north', () => {
  assert.equal(normalizeHeading(-10), 350);
  assert.equal(shortestTurn(355, 25), 30);
  assert.equal(shortestTurn(25, 355), -30);
});

test('ready guidance requires a measured tilt matching the selected view', () => {
  for (const view of CAPTURE_VIEWS) {
    assert.equal(capturePitchReady(view, null), false);
    assert.equal(capturePitchReady(view, NaN), false);
  }
  assert.equal(capturePitchReady('around', 4), true);
  assert.equal(capturePitchReady('around', 8), false);
  assert.equal(capturePitchReady('around', 20), false);
  assert.equal(capturePitchReady('top', 0), false);
  assert.equal(capturePitchReady('top', 30), true);
  assert.equal(capturePitchReady('top', 45), false);
  assert.equal(capturePitchReady('bottom', 45), false);
  assert.equal(capturePitchReady('bottom', -30), true);
});

test('ceiling and floor rings guide both tilt and the next turn', () => {
  for (const [view, tilt] of [['top', 60], ['bottom', -60]] as const) {
    const next = captureAlignment(view, 'ring', tilt, 350, 350);
    assert.equal(next.turn, 30);
    assert.equal(next.direction, 'right');
    assert.equal(next.ready, false);
    assert.match(next.message, /Turn right 30°/);
    assert.equal(captureAlignment(view, 'ring', tilt, 20, 350).ready, true);
    assert.equal(captureAlignment(view, 'ring', tilt, 35, 350).direction, 'left');
    assert.equal(captureAlignment(view, 'ring', 0, 20, 350).direction, view === 'top' ? 'up' : 'down');
    assert.equal(captureAlignment(view, 'ring', tilt, null, 350).ready, false);
    assert.equal(captureAlignment(view, 'ring', null, 20, 350).ready, false);
  }
});

test('vertical rows bridge the scene in steps no larger than thirty degrees', () => {
  for (const view of ['top', 'bottom'] as const) {
    const targets = [0, ...(['bridge', 'ring', 'pole'] as const).map(phase => captureTargetPitch(view, phase))];
    assert.deepEqual(targets.map(Math.abs), [0, 30, 60, 90]);
    for (let index = 1; index < targets.length; index++) assert.ok(Math.abs(targets[index] - targets[index - 1]) <= 30);
    const bridge = captureAlignment(view, 'bridge', targets[1], 30, 0);
    assert.equal(bridge.ready, true);
  }
});

test('overhead and directly below use vertical targets without a heading', () => {
  const up = captureAlignment('top', 'pole', 90, null, 100);
  const down = captureAlignment('bottom', 'pole', -90, null, 100);
  assert.equal(up.targetPitch, 90);
  assert.equal(down.targetPitch, -90);
  assert.equal(up.ready, true);
  assert.equal(down.ready, true);
  assert.equal(up.turn, null);
  assert.equal(down.turn, null);
  assert.equal(captureAlignment('top', 'pole', 45, null, null).direction, 'up');
  assert.equal(captureAlignment('bottom', 'pole', -45, null, null).direction, 'down');
  assert.equal(capturePitchReady('top', 90), false);
  assert.equal(capturePitchReady('bottom', -90), false);
  assert.equal(capturePitchReady('top', NaN, 'pole'), false);
  assert.equal(capturePitchReady('bottom', -100, 'pole'), false);
});
