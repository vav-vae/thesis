import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedPromise, mapWithConcurrency } from '../src/lib/promise-cache.ts';

test('rechecking a photo set shares pending and successful uploads', async () => {
  const cache = new Map<object, Promise<string>>();
  const photo = {};
  let calls = 0;
  let finish!: (url: string) => void;
  const upload = () => {
    calls += 1;
    return new Promise<string>((resolve) => { finish = resolve; });
  };
  const first = cachedPromise(cache, photo, upload);
  const second = cachedPromise(cache, photo, upload);
  assert.equal(first, second);
  assert.equal(calls, 1);
  finish('https://example.com/photo.jpg');
  await first;
  assert.equal(await cachedPromise(cache, photo, upload), 'https://example.com/photo.jpg');
  assert.equal(calls, 1);
  assert.equal(await cachedPromise(cache, {}, async () => 'other'), 'other');
});

test('failed uploads are evicted so the same photo can be retried', async () => {
  const cache = new Map<string, Promise<string>>();
  await assert.rejects(cachedPromise(cache, 'photo', async () => { throw new Error('offline'); }), /offline/);
  assert.equal(cache.has('photo'), false);
  assert.equal(await cachedPromise(cache, 'photo', async () => 'uploaded'), 'uploaded');
});

test('larger upload sets keep at most three operations active and preserve photo order', async () => {
  let active = 0;
  let peak = 0;
  const items = Array.from({ length: 40 }, (_, index) => index);
  const results = await mapWithConcurrency(items, 3, async (item) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, item % 3));
    active -= 1;
    return `photo-${item}`;
  });
  assert.equal(peak, 3);
  assert.equal(active, 0);
  assert.deepEqual(results, items.map((item) => `photo-${item}`));
});

test('upload failures stop queued work and propagate the original error', async () => {
  const started: number[] = [];
  await assert.rejects(mapWithConcurrency([0, 1, 2, 3], 2, async (item) => {
    started.push(item);
    if (item === 0) throw new Error('upload failed');
    return 'ok';
  }), /upload failed/);
  assert.deepEqual(started, [0, 1]);
});
