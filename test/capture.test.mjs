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

function fixture(session) {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  globalThis.screen = {};
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.location = { origin: 'https://form.example' };
  globalThis.document = new EventTarget();
  const checkbox = Object.assign(new EventTarget(), { type: 'checkbox', checked: false, defaultChecked: false });
  const disclosure = { textContent: 'I agree.' };
  const capture = new ConsentCapture({ apiUrl: 'https://capture.example', session,
    form: { contains: element => element === checkbox || element === disclosure }, checkbox, disclosure });
  return { capture, checkbox };
}
const session = () => ({ sessionId: '10000000-0000-0000-0000-000000000001', uploadToken: 'token',
  expiresAt: new Date(Date.now() + 600000).toISOString(), form: { id: 'form', origin: location.origin, disclosure: 'I agree.' } });

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
