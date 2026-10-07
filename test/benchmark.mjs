import { performance } from 'node:perf_hooks';
import { EventBuffer } from '../dist/esm/event-buffer.js';
const samples = [];
let bytes = 0;
for (let run = 0; run < 10; run++) {
  const buffer = new EventBuffer();
  const started = performance.now();
  for (let i = 0; i < 10000; i++) {
    // Includes event construction/serialization, not rrweb's DOM observer or network.
    buffer.append(JSON.stringify({ type: 3, timestamp: i * 100, data: { source: 1, positions: [{ x: i % 1000, y: 100, id: 1, timeOffset: 0 }] } }));
    if (buffer.byteLength >= 65536) bytes += buffer.seal().body.length;
  }
  buffer.seal();
  samples.push(performance.now() - started);
}
samples.sort((a,b) => a-b);
console.log(JSON.stringify({ eventsPerRun: 10000, medianMs: samples[5], p90Ms: samples[8], serializedBytes: bytes, scope: 'event construction, serialization and batching only' }));
