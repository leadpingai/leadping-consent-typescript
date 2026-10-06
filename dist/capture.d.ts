import type { CaptureOptions, CaptureReference, Recipient } from './types.js';
/** One form recording per document, matching rrweb's document-level recorder. */
export declare class ConsentCapture {
    private readonly options;
    private static active?;
    private readonly browser;
    private readonly buffer;
    private readonly transport;
    private readonly pending;
    private head;
    private queuedBytes;
    private sending?;
    private stopRecording?;
    private interval?;
    private expiry?;
    private failure?;
    private stopped;
    private finished?;
    constructor(options: CaptureOptions);
    /** Invoke before submitting your form; send the returned reference to your trusted backend with the lead. */
    finish(recipient: Recipient): Promise<CaptureReference>;
    /** Flush pending capture without stopping the recorder. Never silently discards a failed batch. */
    flush(): Promise<void>;
    dispose(): void;
    private finishCore;
    private readonly emit;
    private seal;
    private send;
    private readonly consentChanged;
    private readonly visibilityChanged;
    private readonly backgroundFlush;
    private fail;
    private stop;
}
