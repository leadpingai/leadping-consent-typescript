import type { SealedBatch } from './types.js';
/** UTF-8 size without allocating an encoded copy of each event. */
export declare function utf8Length(value: string): number;
/** Bounded append buffer. Serialize once, clear references after each batch, never shift event arrays. */
export declare class EventBuffer {
    private readonly events;
    private bytes;
    private nextEvent;
    private nextBatch;
    readonly maxBytes: number;
    get byteLength(): number;
    get count(): number;
    get lastEventNumber(): number;
    get lastBatchNumber(): number;
    canAppend(serialized: string): boolean;
    append(serialized: string): void;
    seal(): SealedBatch | undefined;
}
