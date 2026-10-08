import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CaptureTransport } from '../dist/esm/transport.js';

test('transient failure retries identical bytes and waits for acknowledgment', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => { requests.push(init); return new Response(null, { status: requests.length === 1 ? 503 : 204 }); };
  try {
    const transport = new CaptureTransport('https://consent.example', 'capability');
    await transport.put('/batches/0', JSON.stringify({ value: 'a'.repeat(5000) }));
    assert.equal(requests.length, 2);
    assert.equal(requests[0].body, requests[1].body);
    assert.equal(requests[0].headers['Content-Encoding'], 'gzip');
    assert.equal(requests[0].credentials, 'omit');
  } finally { globalThis.fetch = original; }
});

test('permanent conflict is not retried', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 409 }); };
  try {
    await assert.rejects(new CaptureTransport('https://consent.example', 'capability').put('/batches/0', '{}'), /409/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('expired recording returns a specific error without retrying', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 410 }); };
  try {
    await assert.rejects(new CaptureTransport('https://consent.example', 'capability').put('/submission/certificate', '{}'),
      error => error.code === 'replay_limit_exceeded');
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
