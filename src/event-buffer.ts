import type { SealedBatch } from './types.js';

/** UTF-8 size without allocating an encoded copy of each event. */
export function utf8Length(value: string): number {
  let bytes = value.length;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x80) continue;
    if (c < 0x800) bytes++;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < value.length &&
      value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { bytes += 2; i++; }
    else bytes += 2;
  }
  return bytes;
}

/** Bounded append buffer. Serialize once, clear references after each batch, never shift event arrays. */
export class EventBuffer {
  private readonly events: string[] = [];
  private bytes = 0;
  private nextEvent = 0;
  private nextBatch = 0;
  readonly maxBytes = 256 * 1024 - 128;

  get byteLength(): number { return this.bytes; }
  get count(): number { return this.events.length; }
  get lastEventNumber(): number { return this.nextEvent - 1; }
  get lastBatchNumber(): number { return this.nextBatch - 1; }

  canAppend(serialized: string): boolean {
    return this.events.length < 4096 && this.bytes + utf8Length(serialized) + 1 <= this.maxBytes;
  }

  append(serialized: string): void {
    const size = utf8Length(serialized) + 1;
    if (size > this.maxBytes || this.bytes + size > this.maxBytes || this.events.length >= 4096)
      throw new Error('Recording event exceeds the capture buffer limit.');
    this.events.push(serialized);
    this.bytes += size;
    this.nextEvent++;
  }

  seal(): SealedBatch | undefined {
    if (this.events.length === 0) return;
    if (this.nextBatch >= 1024) throw new Error('Recording exceeded the session batch limit.');
    const first = this.nextEvent - this.events.length;
    const body = `{"firstEventNumber":${first},"events":[${this.events.join(',')}]}`;
    this.events.length = 0;
    this.bytes = 0;
    return { number: this.nextBatch++, firstEventNumber: first, lastEventNumber: this.nextEvent - 1, body };
  }
}
