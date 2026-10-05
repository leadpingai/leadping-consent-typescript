// Local-only manual/browser automation fixture. No production credentials or services.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
const html = `<!doctype html><html><head><title>Leadping Consent browser verification</title></head><body>
<link rel="stylesheet" href="/sdk/replay.css"><h1>Leadping Consent browser verification</h1><form id="form"><label>Email <input id="email" name="email"></label>
<label><input id="agree" type="checkbox"><span id="disclosure">I agree.</span></label><button>Submit</button></form>
<p id="status">Starting</p><section id="replay"></section><script type="module" src="/test.js"></script></body></html>`;
const script = `
import { ConsentCapture } from '/sdk/index.js';
import { mountEvidence } from '/sdk/viewer.js';
const batches = [];
const nativeFetch = window.fetch.bind(window);
window.captureErrors = [];
window.fetch = async (url, init) => {
  let text;
  if (init.headers['Content-Encoding'] === 'gzip') text = await new Response(new Blob([init.body]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  else text = init.body;
  const data = JSON.parse(text);
  if (String(url).includes('/batches/')) batches.push(data);
  else window.submission = data;
  return new Response(null, { status: 204 });
};
const form = document.querySelector('#form');
const capture = new ConsentCapture({ apiUrl: 'https://capture.example', form,
  disclosure: document.querySelector('#disclosure'), checkbox: document.querySelector('#agree'),
  session: { sessionId: '10000000-0000-0000-0000-000000000001', uploadToken: 'test-only', expiresAt: new Date(Date.now()+600000).toISOString(),
    form: { id:'test', sourceId:'test', origin:location.origin, disclosure:'I agree.', sellers:['Test'], channels:['sms'], approvedForContact:false } },
  onError: error => window.captureErrors.push(error.message)
});
document.querySelector('#status').textContent = 'Ready';
form.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await capture.finish({email: document.querySelector('#email').value});
    const encoder = new TextEncoder();
    const b64 = bytes => btoa(Array.from(bytes,b => String.fromCharCode(b)).join(''));
    const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)), b => b.toString(16).padStart(2,'0')).join('');
    const encoded = batches.map((batch, number) => encoder.encode(JSON.stringify({number, ...batch, lastEventNumber:batch.firstEventNumber+batch.events.length-1})));
    const payload = encoder.encode(JSON.stringify({version:1, recordingComplete:true, batchHashes:await Promise.all(encoded.map(hash)),
      session:{form:{disclosure:'I agree.'}}, submission:window.submission}));
    const keys = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
    const signature = new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,payload));
    const publicKey = new Uint8Array(await crypto.subtle.exportKey('spki',keys.publicKey));
    window.bundle = {receipt:{evidenceSha256:await hash(payload)}, evidence:{payload:b64(payload),signature:b64(signature),publicKey:b64(publicKey),signingKeyId:'test'}, batches:encoded.map(b64)};
    window.inputPreserved = JSON.stringify(batches).includes('private@example.com');
    await nativeFetch('/export', {method:'POST',body:JSON.stringify(window.bundle)});
    await mountEvidence(document.querySelector('#replay'),window.bundle);
    document.querySelector('#status').textContent = 'Captured and verified';
  } catch(error) { window.captureErrors.push(error.message); document.querySelector('#status').textContent = error.message; }
});`;
createServer(async (req, res) => {
  try {
    if (req.url === '/export' && req.method === 'POST') {
      const parts = []; for await (const part of req) parts.push(part);
      await writeFile(new URL('../../../../artifacts/consent-browser-fixture.json', import.meta.url), Buffer.concat(parts));
      return res.end();
    }
    if (/^\/viewer\/[a-z.-]+$/.test(req.url ?? '')) {
      res.setHeader('Content-Type',req.url.endsWith('.html')?'text/html':req.url.endsWith('.css')?'text/css':'text/javascript');
      return res.end(await readFile(new URL('../viewer/' + req.url.split('/').pop(), import.meta.url)));
    }
    if (req.url === '/') { res.setHeader('Content-Type','text/html'); return res.end(html); }
    if (req.url === '/test.js') { res.setHeader('Content-Type','text/javascript'); return res.end(script); }
    const path = req.url?.match(/^\/sdk\/([a-z.-]+)$/)?.[1];
    if (!path) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', path.endsWith('.css') ? 'text/css' : 'text/javascript');
    res.end(await readFile(new URL('../dist/browser/' + path, import.meta.url)));
  } catch { res.writeHead(500); res.end(); }
}).listen(5369, '127.0.0.1', () => console.log('Consent browser fixture listening on 127.0.0.1:5369'));
