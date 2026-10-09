// node test/large-browser.mjs <path-to-Leadping.Certificate/wwwroot/viewer/replay.js>
// Uses the real recorder and viewer with a local transport fixture; no remote evidence is created.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

if (!process.argv[2]) throw new Error('Pass the built certificate replay.js path.');
const viewer = resolve(process.argv[2]);
const html = `<!doctype html><html><head><title>Large consent recording</title></head><body>
<h1>Large consent recording</h1><form id="form">
<label>Email <input id="email" name="email"></label>
<label><input id="agree" type="checkbox"><span id="disclosure">I agree.</span></label><button>Submit</button>
</form><p id="status">Starting</p><div id="replay"></div><script type="module" src="/test.js"></script></body></html>`;
const script = `
import { ConsentCapture } from '/sdk.js';
import { verifyEvidence, mountEvidence } from '/viewer.js';
const text = 'Large-page evidence 🌍漢é '.repeat(250000);
const content = document.createElement('div');
content.hidden = true;
content.textContent = text;
document.body.append(content);
const style = document.createElement('style');
style.textContent = Array.from({length:20000}, (_,i) => '.unused-' + i + '{color:rgb(12,34,56)}').join('');
document.head.append(style);
const batches = new Map();
const attempts = new Map();
window.result = { maxRequestBytes: 0, retryCount: 0 };
window.fetch = async (url, init) => {
  let body = init.body;
  if (init.headers['Content-Encoding'])
    body = await new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  window.result.maxRequestBytes = Math.max(window.result.maxRequestBytes, new TextEncoder().encode(body).length);
  const parsed = JSON.parse(body);
  if (String(url).includes('/batches/')) {
    const number = Number(String(url).split('/').at(-1));
    const previous = batches.get(number);
    if (previous && previous !== body) throw new Error('Retry changed evidence.');
    batches.set(number, body);
    const count = attempts.get(number) ?? 0;
    attempts.set(number, count + 1);
    // Simulate an acknowledgment lost after durable storage.
    if (number === 2 && count === 0) { window.result.retryCount++; return new Response(null, {status:503}); }
    if (number === 0) await new Promise(resolve => setTimeout(resolve, 150));
  } else window.submission = parsed;
  return new Response(null, {status:204});
};
const form = document.querySelector('#form');
const capture = new ConsentCapture({ apiUrl:'https://capture.example', form,
  disclosure:document.querySelector('#disclosure'), checkbox:document.querySelector('#agree'),
  session:{ sessionId:'10000000-0000-0000-0000-000000000001', uploadToken:'test-only',
    supportsEventFragments:true, expiresAt:new Date(Date.now()+600000).toISOString(), maxReplaySeconds:600,
    form:{id:'test',origin:location.origin,disclosure:'I agree.'} },
  onError:error => { document.querySelector('#status').textContent = error.message; }
});
await capture.ready;
document.querySelector('#status').textContent = 'Ready';
form.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await capture.finish({email:document.querySelector('#email').value});
    capture.dispose();
    const b64 = bytes => { let text=''; for(let i=0;i<bytes.length;i+=8192) text+=String.fromCharCode(...bytes.subarray(i,i+8192)); return btoa(text); };
    const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)), b=>b.toString(16).padStart(2,'0')).join('');
    const encoded = [...batches].sort((a,b)=>a[0]-b[0]).map(([number,body])=>{
      const batch=JSON.parse(body);
      return new TextEncoder().encode(JSON.stringify({number,...batch,
        lastEventNumber:batch.firstEventNumber+(batch.events?.length ?? 1)-1}));
    });
    const payload = new TextEncoder().encode(JSON.stringify({version:1,recordingComplete:true,
      batchHashes:await Promise.all(encoded.map(hash)),session:{form:{disclosure:'I agree.'}},submission:window.submission}));
    const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
    const signature=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,payload));
    const publicKey=new Uint8Array(await crypto.subtle.exportKey('spki',keys.publicKey));
    const bundle={receipt:{evidenceSha256:await hash(payload)},evidence:{payload:b64(payload),signature:b64(signature),
      publicKey:b64(publicKey),signingKeyId:'test'},batches:encoded.map(b64)};
    const verified=await verifyEvidence(bundle);
    window.result.complete=verified.complete;
    window.result.textPreserved=JSON.stringify(verified.events).includes(text);
    window.result.inputPreserved=JSON.stringify(verified.events).includes('large-test@example.com');
    window.result.batchCount=encoded.length;
    window.result.snapshotBytes=new TextEncoder().encode(JSON.stringify(verified.events.find(e=>e.type===2))).length;
    await mountEvidence(document.querySelector('#replay'),bundle);
    document.querySelector('#status').textContent='Verified and replay mounted';
  } catch(error) { document.querySelector('#status').textContent=error.stack; }
});
`;
createServer(async (req, res) => {
  try {
    if(req.url==='/') { res.setHeader('Content-Type','text/html'); return res.end(html); }
    res.setHeader('Content-Type','text/javascript');
    if(req.url==='/test.js') return res.end(script);
    if(req.url==='/sdk.js') return res.end(await readFile(new URL('../dist/browser/index.js',import.meta.url)));
    if(req.url==='/viewer.js') return res.end(await readFile(viewer));
    res.writeHead(404); res.end();
  } catch { res.writeHead(500); res.end(); }
}).listen(5371,'127.0.0.1',()=>console.log('Large recording fixture: http://127.0.0.1:5371'));
