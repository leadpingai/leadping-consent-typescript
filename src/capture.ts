import { record } from 'rrweb';
import type { eventWithTime } from '@rrweb/types';
import { EventBuffer } from './event-buffer.js';
import { CaptureTransport } from './transport.js';
import type { CaptureOptions, CaptureReference, Recipient, SealedBatch } from './types.js';

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
  private readonly transport: CaptureTransport;
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
    if (!/^[0-9a-f-]{36}$/i.test(options.session.sessionId) || options.session.form.origin !== location.origin ||
      !options.form.contains(options.checkbox) || !options.form.contains(options.disclosure) ||
      options.checkbox.type !== 'checkbox' || options.checkbox.checked || options.checkbox.defaultChecked ||
      options.disclosure.textContent !== options.session.form.disclosure)
      throw new Error('Form does not match the approved disclosure and unchecked consent control.');
    const remaining = Date.parse(options.session.expiresAt) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 60 * 60 * 1000)
      throw new Error('Invalid or expired capture session.');
    this.transport = new CaptureTransport(url.href.replace(/\/$/, '') + '/consent/sessions/' + options.session.sessionId, options.session.uploadToken);
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
      this.interval = setInterval(this.backgroundFlush, 3000);
      this.expiry = setTimeout(() => this.fail(new Error('Capture session expired.')), remaining);
      record.addCustomEvent('leadping.disclosure', { formId: options.session.form.id });
    } catch (error) { this.stop(); throw error; }
  }

  /** Invoke before submitting your form; send the returned reference to your trusted backend with the lead. */
  finish(recipient: Recipient): Promise<CaptureReference> {
    return this.finished ??= this.finishCore(recipient);
  }

  /** Flush pending capture without stopping the recorder. Never silently discards a failed batch. */
  async flush(): Promise<void> {
    if (this.failure) throw this.failure;
    this.seal();
    while (this.head < this.pending.length || this.sending) {
      this.sending ??= this.send();
      await this.sending;
    }
    if (this.failure) throw this.failure;
  }

  dispose(): void { this.stop(); this.transport.dispose(); }

  private async finishCore(recipient: Recipient): Promise<CaptureReference> {
    if (this.stopped || this.failure) throw this.failure ?? new Error('Recorder is stopped.');
    const observedDisclosure = this.options.disclosure.textContent ?? '';
    if (observedDisclosure !== this.options.session.form.disclosure)
      throw new Error('The disclosure changed during capture. Start a new approved form session.');
    const accepted = this.options.checkbox.checked;
    record.addCustomEvent('leadping.submit', { accepted });
    this.stop();
    await this.flush();
    await this.transport.put('/submission', JSON.stringify({
      lastBatchNumber: this.buffer.lastBatchNumber, lastEventNumber: this.buffer.lastEventNumber,
      accepted, observedDisclosure, recipient, browser: this.browser,
    }));
    return { sessionId: this.options.session.sessionId, uploadToken: this.options.session.uploadToken };
  }

  private readonly emit = (event: eventWithTime): void => {
    if (this.stopped || this.failure) return;
    try {
      const serialized = JSON.stringify(event);
      if (!this.buffer.canAppend(serialized)) this.seal();
      this.buffer.append(serialized);
      if (this.buffer.byteLength >= 64 * 1024) this.backgroundFlush();
    } catch { this.fail(new Error('Recording exceeded its memory or event size limit.')); }
  };

  private seal(): void {
    const batch = this.buffer.seal();
    if (!batch) return;
    // UTF-16 string budget including queued/retrying batches. One in-flight compressed copy is additional.
    if (this.queuedBytes + batch.body.length * 2 > 2 * 1024 * 1024)
      throw new Error('Recording upload backlog exceeded 2 MiB.');
    this.pending.push(batch);
    this.queuedBytes += batch.body.length * 2;
  }

  private async send(): Promise<void> {
    // Defer so this.sending is assigned before this function can finish.
    await Promise.resolve();
    try {
      while (this.head < this.pending.length) {
        const batch = this.pending[this.head]!;
        await this.transport.put('/batches/' + batch.number, batch.body);
        this.queuedBytes -= batch.body.length * 2;
        this.pending[this.head] = undefined;
        this.head++;
        if (this.head === this.pending.length) { this.pending.length = 0; this.head = 0; }
      }
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error('Capture upload failed.'));
      throw this.failure;
    } finally { this.sending = undefined; }
  }

  private readonly consentChanged = (): void => record.addCustomEvent('leadping.consent', { accepted: this.options.checkbox.checked });
  private readonly visibilityChanged = (): void => { if (document.visibilityState === 'hidden') this.backgroundFlush(); };
  private readonly backgroundFlush = (): void => { void this.flush().catch(error => this.fail(error)); };

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    this.stop();
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
