import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBuffer, utf8Length } from '../dist/esm/event-buffer.js';

test('UTF-8 sizing matches encoder including surrogate edge cases', () => {
  for (const input of ['', 'abc', 'é', '🌍', '\ud800', '\udfff', '漢字', 'a🌍é漢\ud800'])
    assert.equal(utf8Length(input), new TextEncoder().encode(input).length);
});

test('batches preserve contiguous event numbering and serialize each event once', () => {
  const buffer = new EventBuffer();
  for (let n = 0; n < 100; n++) buffer.append(JSON.stringify({ type: 3, timestamp: n }));
  const first = buffer.seal();
  assert.equal(first.firstEventNumber, 0);
  assert.equal(first.lastEventNumber, 99);
  assert.equal(JSON.parse(first.body).events.length, 100);
  buffer.append('{"type":3,"timestamp":101}');
  const second = buffer.seal();
  assert.equal(second.number, 1);
  assert.equal(second.firstEventNumber, 100);
  assert.equal(buffer.byteLength, 0);
  assert.equal(buffer.seal(), undefined);
});

test('oversized events fail instead of dropping data', () => {
  const buffer = new EventBuffer();
  assert.throws(() => buffer.append('x'.repeat(262145)), /limit/);
  assert.equal(buffer.count, 0);
});

test('session batch limit is enforced', () => {
  const buffer = new EventBuffer();
  for (let n = 0; n < 256; n++) { buffer.append('{}'); buffer.seal(); }
  buffer.append('{}');
  assert.throws(() => buffer.seal(), /session batch limit/);
});
