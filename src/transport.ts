import { CaptureRejectedError } from './capture-rejected-error.js';
import { ReplayLimitExceededError } from './replay-limit-exceeded-error.js';

/** Bounded retry transport. A resolved request means durable server acknowledgment. */
export class CaptureTransport {
  private readonly abort = new AbortController();

  constructor(private readonly baseUrl: string, private readonly token: string) {}

  async put(path: string, json: string): Promise<void> {
    let body: BodyInit = json;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json', 'X-Leadping-Capture-Token': this.token,
    };
    // Compress once per batch, then reuse the same bytes for retries.
    if (json.length > 4096 && typeof CompressionStream !== 'undefined') {
      body = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
      headers['Content-Encoding'] = 'gzip';
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      let retryDelay = Math.min(8000, 500 * 2 ** attempt) + Math.random() * 250;
      try {
        const response = await fetch(this.baseUrl + path, {
          method: 'PUT', headers, body, credentials: 'omit', redirect: 'error',
          signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(15000)]),
        });
        if (response.ok) return;
        if (response.status === 410) throw new ReplayLimitExceededError();
        if (response.status < 500 && response.status !== 408 && response.status !== 429)
          throw new CaptureRejectedError(`Capture rejected (${response.status}).`);
        const retryAfter = response.headers.get('Retry-After');
        if (retryAfter) {
          const milliseconds = /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
          if (Number.isFinite(milliseconds))
            retryDelay = Math.max(retryDelay, Math.min(120000, milliseconds));
        }
      } catch (error) {
        if (error instanceof CaptureRejectedError || error instanceof ReplayLimitExceededError || this.abort.signal.aborted) throw error;
      }
      if (attempt === 4) break;
      await this.delay(retryDelay);
    }
    throw new Error('Capture upload could not be acknowledged.');
  }

  dispose(): void { this.abort.abort(); }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.abort.signal.throwIfAborted();
      const onAbort = () => { clearTimeout(timer); reject(this.abort.signal.reason); };
      const timer = setTimeout(() => { this.abort.signal.removeEventListener('abort', onAbort); resolve(); }, ms);
      this.abort.signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
