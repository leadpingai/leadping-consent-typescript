import { CaptureRejectedError } from './capture-rejected-error.js';
/** Serial, bounded retry transport. A resolved request means durable server acknowledgment. */
export class CaptureTransport {
    baseUrl;
    token;
    abort = new AbortController();
    constructor(baseUrl, token) {
        this.baseUrl = baseUrl;
        this.token = token;
    }
    async put(path, json) {
        let body = json;
        const headers = {
            'Content-Type': 'application/json', 'X-Leadping-Capture-Token': this.token,
        };
        // Compress once per batch, then reuse the same bytes for retries.
        if (json.length > 4096 && typeof CompressionStream !== 'undefined') {
            body = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
            headers['Content-Encoding'] = 'gzip';
        }
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                const response = await fetch(this.baseUrl + path, {
                    method: 'PUT', headers, body, credentials: 'omit', redirect: 'error',
                    signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(15000)]),
                });
                if (response.ok)
                    return;
                if (response.status < 500 && response.status !== 408 && response.status !== 429)
                    throw new CaptureRejectedError(`Capture rejected (${response.status}).`);
            }
            catch (error) {
                if (error instanceof CaptureRejectedError || this.abort.signal.aborted)
                    throw error;
            }
            if (attempt === 4)
                break;
            await this.delay(Math.min(8000, 500 * 2 ** attempt) + Math.random() * 250);
        }
        throw new Error('Capture upload could not be acknowledged.');
    }
    dispose() { this.abort.abort(); }
    delay(ms) {
        return new Promise((resolve, reject) => {
            this.abort.signal.throwIfAborted();
            const onAbort = () => { clearTimeout(timer); reject(this.abort.signal.reason); };
            const timer = setTimeout(() => { this.abort.signal.removeEventListener('abort', onAbort); resolve(); }, ms);
            this.abort.signal.addEventListener('abort', onAbort, { once: true });
        });
    }
}
