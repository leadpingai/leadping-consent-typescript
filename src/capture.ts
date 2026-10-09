import { record } from 'rrweb';
import type { eventWithTime } from '@rrweb/types';
import { EventBuffer, utf8Length } from './event-buffer.js';
import { CaptureTransport } from './transport.js';
import { ReplayDeadline } from './replay-deadline.js';
import { ReplayLimitExceededError } from './replay-limit-exceeded-error.js';
import type { CaptureOptions, CaptureReference, CaptureSession, Recipient, SealedBatch } from './types.js';

/** One form recording per document, matching rrweb's document-level recorder. */
export class ConsentCapture {
  private static active?: ConsentCapture;
  private readonly browser = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screenWidth: screen.width,
    screenHeight: screen.height,
    colorDepth: screen.colorDepth,
    pixelRatio: window.devicePixelRatio,
    hardwareConcurrency: navigator.hardwareConcurrency,
    maxTouchPoints: navigator.maxTouchPoints,
  };
  private readonly buffer = new EventBuffer();
  private readonly deadline = new ReplayDeadline();
  private transport?: CaptureTransport;
  /** Resolves when the service session is available and validated. Recording starts before this. */
  readonly ready: Promise<void>;
  /** Allocated as soon as the session is ready; this does not assert that submission is saved. */
  get sessionId(): string | undefined { return this.session?.sessionId; }
  /** The server-selected duration limit, available after ready resolves. */
  get maxReplaySeconds(): number | undefined { return this.session?.maxReplaySeconds; }
  private session?: CaptureSession;
  private readonly observedDisclosure: string;
  private disposed = false;
  private readonly pending: (SealedBatch | undefined)[] = [];
  private head = 0;
  private queuedBytes = 0;
  private sending?: Promise<void>;
  private stopRecording?: () => void;
  private interval?: ReturnType<typeof setInterval>;
  private expiry?: ReturnType<typeof setTimeout>;
  private failure?: Error;
  private stopped = false;
  private finished?: Promise<CaptureReference>;

  constructor(private readonly options: CaptureOptions) {
    if (ConsentCapture.active) throw new Error('Only one consent recorder may run in a document.');
    const url = new URL(options.apiUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      throw new Error('Capture API requires an HTTPS URL without credentials.');
    if (!options.form.contains(options.checkbox) || !options.form.contains(options.disclosure) ||
      options.checkbox.type !== 'checkbox' || options.checkbox.checked || options.checkbox.defaultChecked)
      throw new Error('Form requires an unchecked consent control and disclosure.');
    this.observedDisclosure = options.disclosure.textContent ?? '';
    this.ready = Promise.resolve().then(() => typeof options.session === 'function' ? options.session() : options.session)
      .then(session => {
        if (this.disposed || this.failure) throw this.failure ?? new Error('Recorder is disposed.');
        if (!/^[0-9a-f-]{36}$/i.test(session.sessionId) || session.form.origin !== location.origin ||
          session.form.disclosure !== this.observedDisclosure)
          throw new Error('Form does not match the approved disclosure.');
        this.deadline.configure(session.expiresAt, session.maxReplaySeconds);
        this.session = session;
        this.transport = new CaptureTransport(url.href.replace(/\/$/, '') + '/consent/sessions/' + session.sessionId, session.uploadToken);
        if (!this.stopped) this.expiry = setTimeout(() => this.fail(new ReplayLimitExceededError()), this.deadline.remainingMilliseconds);
      });
    void this.ready.then(this.backgroundFlush).catch(error => this.fail(error));
    ConsentCapture.active = this;
    try {
      this.stopRecording = record({
        emit: this.emit,
        // Override rrweb defaults as well as Leadping selectors: preserve original values.
        maskAllInputs: false,
        maskInputOptions: {},
        maskTextClass: /$^/,
        blockClass: /$^/,
        ignoreClass: '',
        slimDOMOptions: {},
        inlineStylesheet: true,
        inlineImages: true,
        recordCanvas: false,
        recordCrossOriginIframes: false,
        collectFonts: false,
        sampling: { mousemove: 100, mouseInteraction: true, scroll: 150, input: 'all', media: 1000 },
        errorHandler: () => { this.fail(new Error('The page could not be fully recorded.')); return true; },
      });
      if (!this.stopRecording || this.failure) throw this.failure ?? new Error('Recorder failed to start.');
      options.checkbox.addEventListener('change', this.consentChanged);
      document.addEventListener('visibilitychange', this.visibilityChanged);
      this.interval = setInterval(this.backgroundFlush, 1000);
      record.addCustomEvent('leadping.disclosure', { disclosure: this.observedDisclosure });
    } catch (error) { this.dispose(); throw error; }
  }

  /** Invoke before submitting your form; send the returned reference to your trusted backend with the lead. */
  finish(recipient: Recipient): Promise<CaptureReference> {
    return this.finished ??= this.finishCore(recipient);
  }

  /** Flush pending capture without stopping the recorder. Never silently discards a failed batch. */
  async flush(): Promise<void> {
    if (this.failure) throw this.failure;
    this.seal();
    await this.ready;
    if (this.failure || this.disposed) throw this.failure ?? new Error('Recorder is disposed.');
    while (this.head < this.pending.length || this.sending) {
      this.sending ??= this.send();
      await this.sending;
    }
    if (this.failure) throw this.failure;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.transport?.dispose();
    this.pending.length = 0;
    this.queuedBytes = 0;
    this.buffer.clear();
  }

  private async finishCore(recipient: Recipient): Promise<CaptureReference> {
    if (this.stopped || this.failure) throw this.failure ?? new Error('Recorder is stopped.');
    try { this.deadline.assertWithinLimit(); }
    catch (error) { this.fail(error as Error); throw error; }
    const observedDisclosure = this.options.disclosure.textContent ?? '';
    if (observedDisclosure !== this.observedDisclosure)
      throw new Error('The disclosure changed during capture. Start a new approved form session.');
    const accepted = this.options.checkbox.checked;
    record.addCustomEvent('leadping.submit', { accepted });
    this.stop();
    // Keep the finish request small. Large last-moment DOM changes still use the batch path.
    const assertion = { accepted, observedDisclosure, recipient, browser: this.browser };
    const finalBatch = this.session?.supportsFinalBatch && this.buffer.byteLength <= 8192 &&
      utf8Length(JSON.stringify(assertion)) + this.buffer.byteLength + 256 <= 32768 ? this.buffer.seal() : undefined;
    this.options.onProgress?.('uploading');
    await this.flush();
    this.deadline.assertWithinLimit();
    this.options.onProgress?.('submitting');
    await this.transport!.put(this.options.issueCertificate ? '/submission/certificate' : '/submission', JSON.stringify({
      lastBatchNumber: this.buffer.lastBatchNumber, lastEventNumber: this.buffer.lastEventNumber,
      ...assertion,
      finalBatch: finalBatch ? JSON.parse(finalBatch.body) : undefined,
    }));
    return { sessionId: this.session!.sessionId, uploadToken: this.session!.uploadToken };
  }

  private readonly emit = (event: eventWithTime): void => {
    if (this.stopped || this.failure) return;
    try {
      const serialized = JSON.stringify(event);
      if (!this.buffer.canAppend(serialized)) this.seal();
      if (!this.buffer.canAppend(serialized)) {
        for (const batch of this.buffer.fragment(serialized, event.type, event.timestamp)) this.enqueue(batch);
        this.backgroundFlush();
      } else this.buffer.append(serialized);
      if (this.buffer.byteLength >= 64 * 1024) this.backgroundFlush();
    } catch (error) { this.fail(error instanceof Error ? error : new Error('Recording could not be buffered.')); }
  };

  private seal(): void {
    const batch = this.buffer.seal();
    if (!batch) return;
    this.enqueue(batch);
  }

  private enqueue(batch: SealedBatch): void {
    // Large snapshots retain binary slices, not a base64/JSON copy per queued request.
    // A slow/offline connection must fail explicitly instead of exhausting browser memory.
    if (this.queuedBytes + batch.retainedBytes > 128 * 1024 * 1024)
      throw new Error('Recording upload backlog exceeded 128 MiB. Check your connection.');
    this.pending.push(batch);
    this.queuedBytes += batch.retainedBytes;
  }

  private async send(): Promise<void> {
    // Defer so this.sending is assigned before this function can finish.
    await Promise.resolve();
    try {
      // Batches are immutable and individually numbered. Completion order need not match
      // recording order; submission still waits for every durable acknowledgment.
      await Promise.all(Array.from({ length: 3 }, async () => {
        while (!this.failure && !this.disposed && this.head < this.pending.length) {
          const index = this.head++;
          const batch = this.pending[index]!;
          if (batch.fragmented && !this.session?.supportsEventFragments)
            throw new Error('The consent service must be updated to support large page recordings.');
          await this.transport!.put('/batches/' + batch.number, batch.body);
          this.queuedBytes -= batch.retainedBytes;
          this.pending[index] = undefined;
        }
      }));
      // A concurrent flush may append after the last worker exits but before this continuation.
      if (this.head === this.pending.length) { this.pending.length = 0; this.head = 0; }
    } catch (error) {
      this.transport?.dispose();
      this.fail(error instanceof Error ? error : new Error('Capture upload failed.'));
      throw this.failure;
    } finally { this.sending = undefined; }
  }

  private readonly consentChanged = (): void => {
    record.addCustomEvent('leadping.consent', { accepted: this.options.checkbox.checked });
    // Start draining while the visitor moves from consenting to submitting.
    if (this.options.checkbox.checked) this.backgroundFlush();
  };
  private readonly visibilityChanged = (): void => { if (document.visibilityState === 'hidden') this.backgroundFlush(); };
  private readonly backgroundFlush = (): void => { void this.flush().catch(error => this.fail(error)); };

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    this.stop();
    this.pending.length = 0;
    this.queuedBytes = 0;
    this.buffer.clear();
    this.transport?.dispose();
    this.options.onError?.(error);
  }

  private stop(): void {
    this.stopped = true;
    this.stopRecording?.();
    this.stopRecording = undefined;
    clearInterval(this.interval);
    clearTimeout(this.expiry);
    this.options.checkbox.removeEventListener('change', this.consentChanged);
    document.removeEventListener('visibilitychange', this.visibilityChanged);
    if (ConsentCapture.active === this) ConsentCapture.active = undefined;
  }
}
