import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCaptureDiagnostic } from '../src/lib/capture-diagnostics.ts';
import { HttpResponseError } from '../src/lib/http-response.ts';

test('diagnostics connect HTTP failures to the precise stage, photo, and request', () => {
  const error = new HttpResponseError('Upload quota exceeded.', new Response('', { status: 429, headers: { 'X-Request-ID': 'abc123', 'Retry-After': '30' } }));
  const log = formatCaptureDiagnostic(new Error('Photo upload failed.', { cause: error }), {
    stage: 'Photo upload', photoIndex: 6, photoCount: 40,
    file: { name: 'ceiling-7.jpg', size: 123456, type: 'image/jpeg' },
    endpoint: 'https://example.com/upload', durationMs: 125, online: true,
  });
  for (const expected of ['Stage: Photo upload', 'Photo: 7', 'ceiling-7.jpg', '40 photos', 'HTTP: 429', 'Request ID: abc123', 'Retry after: 30', 'Upload quota exceeded', 'Elapsed: 125 ms']) assert.ok(log.includes(expected), expected);
});

test('Firebase codes and nested causes stay readable while credentials are redacted', () => {
  const error = Object.assign(new Error('Access denied. Bearer secret-token'), { code: 'permission-denied' });
  const log = formatCaptureDiagnostic(error, {
    stage: 'Save room tour', endpoint: 'https://user:password@example.com/path?token=private#fragment',
    detail: 'Token: eyJhbGciOiJSUzI1NiJ9.cGF5bG9hZA.c2lnbmF0dXJl',
  });
  assert.match(log, /Error code: permission-denied/);
  assert.match(log, /https:\/\/example.com\/path/);
  assert.match(log, /Bearer \[redacted\]/);
  assert.doesNotMatch(log, /secret-token|password|private|fragment|eyJhbGci/);
});
