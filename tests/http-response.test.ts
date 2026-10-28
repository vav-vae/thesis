import test from 'node:test';
import assert from 'node:assert/strict';
import { readJsonResponse } from '../src/lib/http-response.ts';

test('plain-text upload limit produces guidance instead of JSON syntax error', async () => {
  await assert.rejects(readJsonResponse(new Response('Request Entity Too Large', { status: 413 }), 'Upload failed.'), /upload is too large.*Reload LiBot/);
});

test('JSON upload limit preserves the backend reason', async () => {
  await assert.rejects(
    readJsonResponse(new Response(JSON.stringify({ detail: 'Combined decoded image dimensions exceed the processing limit.' }), { status: 413 }), 'Upload failed.'),
    /Combined decoded image dimensions exceed the processing limit/,
  );
});
test('plain-text size limit remains readable even behind a proxy returning 200', async () => {
  await assert.rejects(readJsonResponse(new Response('Request Entity Too Large'), 'Upload failed.'), /upload is too large/);
});
test('HTML gateway errors do not leak parser errors', async () => {
  await assert.rejects(readJsonResponse(new Response('<html>Gateway timeout</html>', { status: 504 }), 'Failed.'), /processor timed out/);
});
test('JSON API errors retain the reason and retry guidance', async () => {
  await assert.rejects(readJsonResponse(new Response(JSON.stringify({ detail: 'Too many attempts.' }), { status: 429, headers: { 'Retry-After': '30' } }), 'Failed.'), /Too many attempts.*30 seconds/);
});
test('valid JSON passes through', async () => {
  assert.deepEqual(await readJsonResponse(new Response('{"success":true}'), 'Failed.'), { success: true });
});
