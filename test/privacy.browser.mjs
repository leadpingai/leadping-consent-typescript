import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

// Requires the agent-browser CLI and its browser installation. Only synthetic data
// is used. HTTP replaces the transport boundary; rrweb, encoding, and replay are real.
const executable = process.env.AGENT_BROWSER_EXECUTABLE ?? (process.platform === 'win32'
  ? join(process.env.APPDATA, 'npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe') : 'agent-browser');

const secrets = ['PASSWORD_INITIAL', 'PASSWORD_TYPED', 'PASSWORD_REVEALED', 'PASSWORD_ADDED',
  'PASSWORD_AUTOCOMPLETE', 'HIDDEN_TOKEN', 'BLOCK_INITIAL', 'BLOCK_CHANGED', 'BLOCK_ADDED',
  'IGNORE_INITIAL', 'IGNORE_TYPED', 'MASK_INITIAL', 'MASK_CHANGED', 'EXCLUDED_INITIAL', 'EXCLUDED_CHANGED'];

const html = `<!doctype html><html><head><title>Synthetic consent privacy test</title></head><body>
  <form id="consent"><p id="disclosure">I agree to receive messages.</p>
    <input id="email" type="email" value="recipient@example.invalid">
    <label><input id="agree" type="checkbox">I agree</label>
  </form>
  <input id="password" type="password" value="PASSWORD_INITIAL">
  <input id="token" type="hidden" value="HIDDEN_TOKEN">
  <input id="autocomplete" type="text" autocomplete="current-password" value="PASSWORD_AUTOCOMPLETE">
  <div class="rr-block" title="BLOCK_INITIAL"><span id="blocked">BLOCK_INITIAL</span></div>
  <div class="rr-ignore"><input id="ignored" value="IGNORE_INITIAL"></div>
  <div class="rr-mask"><span id="masked">MASK_INITIAL</span></div>
  <div data-leadping-exclude><span id="excluded">EXCLUDED_INITIAL</span></div>
  <div>${'Public page context. '.repeat(18000)}</div>
  <script type="module" src="/fixture.js"></script>
</body></html>`;

const fixture = `
import { ConsentCapture } from '/capture.js';
import { Replayer } from '/rrweb.js';
const nativeFetch = window.fetch.bind(window);
window.fetch = (url, init) => new URL(url, location.href).origin === 'https://capture.invalid'
  ? nativeFetch(new URL(url).pathname, init) : nativeFetch(url, init);
const tick = () => new Promise(resolve => setTimeout(resolve, 30));
function options() {
  return { apiUrl: 'https://capture.invalid', form: document.querySelector('#consent'),
    disclosure: document.querySelector('#disclosure'), checkbox: document.querySelector('#agree'),
    session: { sessionId: '10000000-0000-0000-0000-000000000001', uploadToken: 'synthetic-token',
      maxReplaySeconds: 600, expiresAt: new Date(Date.now() + 600000).toISOString(),
      supportsEventFragments: true, supportsFinalBatch: true,
      form: { id: 'synthetic-form', origin: location.origin, disclosure: 'I agree to receive messages.' } } };
}
function input(id, value) {
  const element = document.getElementById(id);
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}
window.runPrivacyCapture = async () => {
  const capture = new ConsentCapture(options());
  try {
    await capture.ready;
    await tick();
    input('password', 'PASSWORD_TYPED');
    input('ignored', 'IGNORE_TYPED');
    input('email', 'updated@example.invalid');
    document.getElementById('blocked').textContent = 'BLOCK_CHANGED';
    document.getElementById('blocked').setAttribute('title', 'BLOCK_CHANGED');
    document.getElementById('masked').textContent = 'MASK_CHANGED';
    document.getElementById('excluded').textContent = 'EXCLUDED_CHANGED';
    await tick();
    document.getElementById('password').type = 'text';
    input('password', 'PASSWORD_REVEALED');
    document.getElementById('password').setAttribute('value', 'PASSWORD_REVEALED');
    const added = document.createElement('input');
    added.type = 'password'; added.value = 'PASSWORD_ADDED';
    document.body.append(added);
    const blocked = document.createElement('div');
    blocked.className = 'rr-block'; blocked.textContent = 'BLOCK_ADDED';
    document.body.append(blocked);
    document.getElementById('agree').checked = true;
    document.getElementById('agree').dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    await capture.finish({ email: 'recipient@example.invalid' });
  } finally { capture.dispose(); }
  return true;
};
window.testExcludedEvidence = () => {
  document.getElementById('agree').checked = false;
  const disclosure = document.getElementById('disclosure');
  disclosure.className = 'rr-block';
  try { const capture = new ConsentCapture(options()); capture.dispose(); return false; }
  catch (error) { return error.message.includes('excluded or masked'); }
  finally { disclosure.className = ''; }
};
window.replayStored = async () => {
  const events = await (await nativeFetch('/stored-events')).json();
  const root = document.createElement('div'); document.body.append(root);
  const replay = new Replayer(events, { root, showWarning: false });
  try {
    replay.pause(events.at(-1).timestamp - events[0].timestamp + 1);
    await tick();
    return { serialized: JSON.stringify(events), html: replay.iframe.contentDocument.documentElement.outerHTML };
  } finally { replay.destroy(); root.remove(); }
};
window.privacyFixtureReady = true;
`;

function assemble(rows) {
  const events = [];
  let parts = [];
  let nextEvent = 0;
  for (const row of rows) {
    assert.equal(row.firstEventNumber, nextEvent);
    if (row.eventFragment) {
      const fragment = row.eventFragment;
      assert.equal(fragment.index, parts.length);
      parts.push(Buffer.from(fragment.data, 'base64'));
      if (parts.length === fragment.count) {
        const bytes = Buffer.concat(parts);
        assert.equal(bytes.length, fragment.byteLength);
        events.push(JSON.parse(bytes.toString('utf8')));
        parts = [];
        nextEvent++;
      }
    } else {
      assert.equal(parts.length, 0);
      events.push(...row.events);
      nextEvent += row.events.length;
    }
  }
  assert.equal(parts.length, 0);
  return events;
}

test('synthetic secrets never enter snapshots, input events, saved batches, or replay', { timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leadping-consent-privacy-'));
  const session = `consent-privacy-${process.pid}`;
  const cli = async (...args) => {
    const stdout = await new Promise((resolve, reject) => {
      const child = spawn(executable, ['--session', session, ...args, '--json'], { windowsHide: true });
      let output = '', error = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { error += chunk; });
      child.on('error', reject);
      // The Windows browser daemon may inherit pipe handles. Wait for the CLI's
      // exit rather than waiting for every daemon-owned pipe to close.
      child.on('exit', code => {
        child.stdout.destroy(); child.stderr.destroy();
        if (code === 0) resolve(output); else reject(new Error(error || output));
      });
    });
    const result = JSON.parse(stdout);
    assert.equal(result.success, true, result.error);
    return result.data;
  };
  const bundle = await build({ entryPoints: ['src/capture.ts'], bundle: true, write: false, format: 'esm' });
  const rrweb = await readFile('node_modules/rrweb/dist/rrweb.js');
  const saved = [];
  let storedEvents = [];
  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'PUT' && request.url.startsWith('/consent/sessions/')) {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const bytes = Buffer.concat(chunks);
        const json = request.headers['content-encoding'] === 'gzip' ? gunzipSync(bytes) : bytes;
        const path = join(directory, `${saved.length}.json`);
        saved.push({ url: request.url, path });
        await writeFile(path, json);
        response.writeHead(204).end();
      } else {
        const assets = { '/': ['text/html', html], '/fixture.js': ['text/javascript', fixture],
          '/capture.js': ['text/javascript', bundle.outputFiles[0].text], '/rrweb.js': ['text/javascript', rrweb],
          '/stored-events': ['application/json', JSON.stringify(storedEvents)] };
        const asset = assets[request.url];
        if (!asset) { response.writeHead(404).end(); return; }
        response.writeHead(200, { 'Content-Type': asset[0] }).end(asset[1]);
      }
    } catch (error) { response.writeHead(500).end(String(error)); }
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    await cli('open', `http://127.0.0.1:${server.address().port}`);
    await cli('wait', '--fn', 'window.privacyFixtureReady === true');
    await cli('eval', 'window.runPrivacyCapture()');
    const rows = await Promise.all(saved.map(async item => {
      const json = await readFile(item.path, 'utf8');
      for (const secret of secrets) assert.ok(!json.includes(secret), `saved payload leaked ${secret}`);
      return { ...item, body: JSON.parse(json) };
    }));
    const submission = rows.find(row => row.url.endsWith('/submission'))?.body;
    assert.ok(submission);
    assert.equal(submission.accepted, true);
    assert.equal(submission.observedDisclosure, 'I agree to receive messages.');
    assert.equal(submission.recipient.email, 'recipient@example.invalid');
    const batches = rows.filter(row => row.url.includes('/batches/'))
      .sort((a, b) => Number(a.url.split('/').at(-1)) - Number(b.url.split('/').at(-1))).map(row => row.body);
    if (submission.finalBatch) batches.push(submission.finalBatch);
    assert.ok(batches.some(batch => batch.eventFragment), 'exercise fragmented snapshots and compressed uploads');
    storedEvents = assemble(batches);
    assert.equal(storedEvents.length - 1, submission.lastEventNumber);
    assert.ok(storedEvents.some(event => event.type === 2), 'full snapshot is retained');
    assert.ok(storedEvents.some(event => event.type === 3 && event.data.source === 5), 'real input events are retained');
    for (const secret of secrets) assert.ok(!JSON.stringify(storedEvents).includes(secret), `recorded event leaked ${secret}`);
    assert.ok(storedEvents.some(event => event.data.tag === 'leadping.consent' && event.data.payload.accepted));
    assert.ok(storedEvents.some(event => event.data.tag === 'leadping.submit' && event.data.payload.accepted));
    const replay = (await cli('eval', 'window.replayStored()')).result;
    for (const secret of secrets) {
      assert.ok(!replay.serialized.includes(secret), `stored replay leaked ${secret}`);
      assert.ok(!replay.html.includes(secret), `rendered replay leaked ${secret}`);
    }
    assert.ok(replay.html.includes('I agree to receive messages.'));
    assert.equal((await cli('eval', 'window.testExcludedEvidence()')).result, true);
    assert.equal(saved.length, rows.length, 'excluded disclosure must not upload through custom events');
  } finally {
    await cli('close').catch(() => {});
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
