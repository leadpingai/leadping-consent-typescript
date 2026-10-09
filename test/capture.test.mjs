import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/capture.ts'], bundle: true, write: false, format: 'esm', plugins: [{
  name: 'recorder-boundary', setup(build) {
    build.onResolve({ filter: /^rrweb$/ }, () => ({ path: 'rrweb', namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `
      export const record = options => { globalThis.emitCapture = options.emit; options.emit({type:2,timestamp:1,data:{}}); return () => {}; };
      record.addCustomEvent = (tag, data) => globalThis.emitCapture({type:5,timestamp:2,data:{tag,payload:data}});
    ` }));
  }
}] });
const { ConsentCapture } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

function fixture(session, options = {}) {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  globalThis.screen = {};
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.location = { origin: 'https://form.example' };
  globalThis.document = new EventTarget();
  const checkbox = Object.assign(new EventTarget(), { type: 'checkbox', checked: false, defaultChecked: false });
  const disclosure = { textContent: 'I agree.' };
  const capture = new ConsentCapture({ apiUrl: 'https://capture.example', session,
    form: { contains: element => element === checkbox || element === disclosure }, checkbox, disclosure, ...options });
  return { capture, checkbox };
}
const session = () => ({ sessionId: '10000000-0000-0000-0000-000000000001', uploadToken: 'token',
  expiresAt: new Date(Date.now() + 600000).toISOString(), maxReplaySeconds: 600,
  form: { id: 'form', origin: location.origin, disclosure: 'I agree.' } });

test('large early snapshots and mutations drain completely before submission with bounded requests', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    let text = init.body;
    if (init.headers['Content-Encoding'])
      text = await new Response(new Blob([text]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    assert.ok(Buffer.byteLength(text) <= 262144);
    requests.push({ url, body: JSON.parse(text) });
    return new Response(null, { status: 204 });
  };
  let resolve;
  const { capture } = fixture(() => new Promise(done => { resolve = done; }));
  const snapshot = { type: 2, timestamp: 3, data: { text: '🌍漢é'.repeat(700000) } };
  const mutation = { type: 3, timestamp: 4, data: { text: 'y'.repeat(1000000) } };
  try {
    emitCapture(snapshot);
    emitCapture(mutation);
    const finished = capture.finish({ email: 'test@example.com' });
    await Promise.resolve();
    assert.equal(requests.length, 0);
    resolve({ ...session(), supportsEventFragments: true, supportsFinalBatch: true });
    await finished;
    assert.ok(requests.at(-1).url.endsWith('/submission'));
    const batches = requests.filter(r => r.url.includes('/batches/'))
      .sort((a,b) => Number(a.url.split('/').at(-1)) - Number(b.url.split('/').at(-1)));
    for (const expected of [snapshot, mutation]) {
      const chunks = batches.map(b => b.body.eventFragment).filter(f => f?.timestamp === expected.timestamp);
      assert.ok(chunks.length > 1);
      const restored = Buffer.concat(chunks.map(f => Buffer.from(f.data, 'base64'))).toString('utf8');
      assert.deepEqual(JSON.parse(restored), expected);
    }
    assert.equal(requests.at(-1).body.lastEventNumber, 4);
  } finally { capture.dispose(); globalThis.fetch = original; }
});

test('large recordings fail explicitly against a service without fragment support', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async url => { requests.push(url); return new Response(null, { status: 204 }); };
  const { capture } = fixture(async () => session());
  try {
    emitCapture({ type: 2, timestamp: 3, data: { text: 'x'.repeat(300000) } });
    await assert.rejects(capture.finish({}), /service must be updated/);
    assert.ok(requests.every(url => !url.includes('/submission')));
  } finally { capture.dispose(); globalThis.fetch = original; }
});

test('streams before submission and closes with only one request containing the final events', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    return new Response(null, { status: 204 });
  };
  const { capture, checkbox } = fixture(async () => ({ ...session(), supportsFinalBatch: true }));
  try {
    await capture.ready;
    await capture.flush();
    emitCapture({ type: 3, timestamp: 3, data: { text: 'streamed input' } });
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.ok(requests.some(r => r.body.events?.some(e => e.data.text === 'streamed input')));
    const before = requests.length;
    checkbox.checked = true;
    await capture.finish({ email: 'test@example.com' });
    assert.equal(requests.length, before + 1);
    const submission = requests.at(-1);
    assert.ok(submission.url.endsWith('/submission'));
    assert.ok(submission.body.finalBatch.events.some(e => e.data.tag === 'leadping.submit'));
    const events = requests.slice(0, -1).flatMap(r => r.body.events).concat(submission.body.finalBatch.events);
    assert.equal(submission.body.lastEventNumber, events.length - 1);
    assert.equal(submission.body.lastBatchNumber, before);
  } finally { capture.dispose(); globalThis.fetch = original; }
});

test('large final changes drain as batches instead of exceeding the finish request limit', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    let body = init.body;
    if (init.headers['Content-Encoding']) body = await new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    requests.push({ url, body: JSON.parse(body) });
    return new Response(null, { status: 204 });
  };
  const { capture } = fixture(async () => ({ ...session(), supportsFinalBatch: true }));
  try {
    await capture.ready;
    await capture.flush();
    emitCapture({ type: 3, timestamp: 3, data: { text: 'x'.repeat(10000) } });
    const before = requests.length;
    await capture.finish({ email: 'test@example.com' });
    assert.equal(requests.length, before + 2);
    assert.ok(requests.at(-2).url.includes('/batches/'));
    assert.equal(requests.at(-1).body.finalBatch, undefined);
  } finally { capture.dispose(); globalThis.fetch = original; }
});

test('records early input and consent, then drains in order before submitting', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const requests = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); return new Response(null, { status: 204 }); };
  const { capture, checkbox } = fixture(() => pending);
  try {
    emitCapture({ type: 3, timestamp: 3, data: { text: 'early@example.com' } });
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    const finished = capture.finish({ email: 'early@example.com' });
    await Promise.resolve();
    assert.equal(requests.length, 0);
    resolve(session());
    await finished;
    assert.ok(requests[0].url.endsWith('/batches/0'));
    const events = requests.filter(r => r.url.includes('/batches/')).flatMap(r => r.body.events);
    assert.equal(events[0].type, 2);
    assert.ok(events.some(e => e.data.text === 'early@example.com'));
    assert.ok(events.some(e => e.data.tag === 'leadping.consent' && e.data.payload.accepted));
    assert.ok(requests.at(-1).url.endsWith('/submission'));
    assert.equal(requests.at(-1).body.lastEventNumber, events.length - 1);
    assert.equal(checkbox.checked, true);
  } finally { capture.dispose(); globalThis.fetch = original; }
});

test('rejects a mismatched eventual session without uploading early evidence', async () => {
  const { capture } = fixture(async () => ({ ...session(), form: { ...session().form, disclosure: 'Different' } }));
  try {
    await assert.rejects(capture.ready, /approved disclosure/);
    await assert.rejects(capture.finish({}), /approved disclosure/);
  } finally { capture.dispose(); }
});

test('disposing while the service is pending prevents late initialization', async () => {
  let resolve;
  const { capture } = fixture(() => new Promise(done => { resolve = done; }));
  await Promise.resolve();
  capture.dispose();
  resolve(session());
  await assert.rejects(capture.ready, /disposed/);
});

test('drains batches with bounded concurrency and never submits ahead of an acknowledgment', async () => {
  const original = globalThis.fetch;
  const uploads = [];
  let submitted = false;
  let active = 0;
  let peak = 0;
  globalThis.fetch = (url) => {
    if (url.endsWith('/submission')) {
      submitted = true;
      assert.equal(active, 0);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    active++;
    peak = Math.max(peak, active);
    return new Promise(resolve => uploads.push({ url, done: () => {
      active--;
      resolve(new Response(null, { status: 204 }));
    } }));
  };
  let resolve;
  const { capture } = fixture(() => new Promise(done => { resolve = done; }));
  try {
    // Seal separately while session creation is pending so all workers have work.
    const flushes = [];
    for (let i = 0; i < 7; i++) {
      emitCapture({ type: 3, timestamp: i + 3, data: { text: `event-${i}` } });
      flushes.push(capture.flush());
    }
    const finished = capture.finish({ email: 'test@example.com' });
    await Promise.resolve();
    resolve(session());
    const tick = () => new Promise(done => setImmediate(done));
    await tick();
    assert.equal(uploads.length, 3);
    assert.equal(submitted, false);
    // Hold batch zero while other workers continue; ordering is in the batch numbers.
    for (let i = 1; i < 8; i++) {
      assert.ok(uploads[i], `batch ${i} should be scheduled`);
      uploads[i].done();
      await tick();
      assert.equal(submitted, false);
    }
    uploads[0].done();
    await Promise.all([...flushes, finished]);
    assert.equal(peak, 3);
    assert.equal(submitted, true);
    assert.equal(new Set(uploads.map(upload => upload.url)).size, 8);
  } finally { capture.dispose(); globalThis.fetch = original; }
});

test('a failed parallel upload prevents submission and aborts outstanding requests', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, signal: init.signal });
    return new Response(null, { status: url.endsWith('/batches/0') ? 409 : 204 });
  };
  const { capture } = fixture(async () => session());
  try {
    await assert.rejects(capture.finish({ email: 'test@example.com' }), /409/);
    assert.ok(requests.length);
    assert.ok(requests.every(request => !request.url.endsWith('/submission')));
    assert.ok(requests.every(request => request.signal.aborted));
  } finally { capture.dispose(); globalThis.fetch = original; }
});

test('exposes the allocated ID before submission and requests the certificate in the final save', async () => {
  const original = globalThis.fetch;
  const requests = [];
  const stages = [];
  globalThis.fetch = async url => {
    requests.push(url);
    return new Response(null, { status: url.endsWith('/submission/certificate') ? 202 : 204 });
  };
  const { capture } = fixture(async () => session(), { issueCertificate: true, onProgress: stage => stages.push(stage) });
  try {
    await capture.ready;
    assert.equal(capture.sessionId, session().sessionId);
    assert.ok(requests.every(url => !url.includes('/submission')));
    const reference = await capture.finish({ email: 'test@example.com' });
    assert.equal(reference.sessionId, capture.sessionId);
    assert.ok(requests.at(-1).endsWith('/submission/certificate'));
    assert.deepEqual(stages, ['uploading', 'submitting']);
  } finally { capture.dispose(); globalThis.fetch = original; }
});

test('submission checks elapsed time even before a suspended tab can run its expiry timer', async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const requests = [];
  const failures = [];
  globalThis.fetch = async url => { requests.push(url); return new Response(null, { status: 204 }); };
  const { capture } = fixture(async () => session(), { onError: error => failures.push(error) });
  try {
    await capture.ready;
    await capture.flush();
    const before = requests.length;
    Date.now = () => originalNow() + 600_001;
    await assert.rejects(capture.finish({ email: 'test@example.com' }), error => error.code === 'replay_limit_exceeded');
    assert.equal(requests.length, before, 'must not send submission after the deadline');
    assert.equal(failures[0].code, 'replay_limit_exceeded');
    assert.match(failures[0].message, /wasn't captured/);
  } finally { Date.now = originalNow; capture.dispose(); globalThis.fetch = originalFetch; }
});
