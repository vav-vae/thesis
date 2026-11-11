import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpResponseError, readJsonResponse } from '../src/lib/http-response.ts';

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

test('HTTP failures retain status and correlation IDs for development logs', async () => {
  const response = new Response(JSON.stringify({ detail: 'Photo 7 exceeds the processing limit.' }), {
    status: 413, headers: { 'X-Request-ID': 'request-123', 'X-Vercel-ID': 'iad1::123', 'Content-Type': 'application/json' },
  });
  await assert.rejects(readJsonResponse(response, 'Failed.'), (error) => {
    assert.ok(error instanceof HttpResponseError);
    assert.equal(error.status, 413);
    assert.equal(error.requestId, 'request-123');
    assert.equal(error.vercelId, 'iad1::123');
    assert.match(error.message, /Photo 7/);
    return true;
  });
});

test('typed validation errors identify the field without logging its supplied input', async () => {
  const response = new Response(JSON.stringify({ detail: [{ loc: ['body', 'image_urls', 6], msg: 'Invalid image URL', input: 'sensitive-input' }] }), { status: 422 });
  await assert.rejects(readJsonResponse(response, 'Failed.'), (error) => {
    assert.ok(error instanceof HttpResponseError);
    assert.match(error.message, /body.image_urls.6: Invalid image URL/);
    assert.doesNotMatch(error.message, /sensitive-input/);
    return true;
  });
});
