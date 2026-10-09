import { CaptureRejectedError } from './capture-rejected-error.js';
import { ConsentCapture } from './capture.js';
import { ReplayLimitExceededError } from './replay-limit-exceeded-error.js';
import type { CaptureSession, Recipient } from './types.js';
export { ConsentCapture } from './capture.js';
export { ReplayLimitExceededError } from './replay-limit-exceeded-error.js';

/** Attach the Leadping-hosted capture and submission flow to a form. */
export async function attach(script: HTMLScriptElement): Promise<void> {
  const domainId = script.dataset.domainId;
  if (!domainId) throw new Error('data-domain-id is required.');
  const form = document.querySelector(script.dataset.form ?? '#lead-form');
  if (!(form instanceof HTMLFormElement)) throw new Error('Leadping form was not found.');
  if (form.dataset.leadpingAttached) throw new Error('Leadping is already attached to this form.');
  form.dataset.leadpingAttached = 'true';
  const disclosure = form.querySelector('[data-leadping-disclosure]');
  const checkbox = form.querySelector('[data-leadping-consent]');
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  form.append(status);
  let capture: ConsentCapture | undefined;
  let submitted = false;
  const fail = (error: unknown): void => {
    status.textContent = error instanceof ReplayLimitExceededError ? error.message
      : 'Unable to complete consent capture. Please reload to start again.';
    form.dispatchEvent(new CustomEvent('leadping:error', { detail: error }));
  };
  const origin = new URL(script.dataset.apiUrl ?? 'https://consent.leadping.ai');
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/')
    throw new Error('Leadping requires an HTTPS API origin.');
  const portal = new URL(script.dataset.portalUrl ?? (origin.hostname === 'consent-local.leadping.ai'
    ? 'https://certificate-local.leadping.ai' : 'https://certificate.leadping.ai'));
  if (portal.protocol !== 'https:' || portal.username || portal.password || portal.search || portal.hash || portal.pathname !== '/')
    throw new Error('Leadping requires an HTTPS portal origin.');
  const endpoint = `${origin.origin}/api/consent`;
  const progress = (stage: string): void => {
    form.dispatchEvent(new CustomEvent('leadping:progress', { detail: { stage } }));
  };
  const post = async (path: string, body: unknown): Promise<Response> => {
    const attempts = path.endsWith('/sessions') ? 5 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let retryDelay = 500 * 2 ** attempt;
      try {
        const response = await fetch(endpoint + path, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'omit', redirect: 'error', body: JSON.stringify(body),
          signal: AbortSignal.timeout(attempts > 1 ? 15000 : 30000),
        });
        if (response.ok) return response;
        if (response.status < 500 && response.status !== 408 && response.status !== 429)
          throw new CaptureRejectedError(`Leadping request failed (${response.status}).`);
        const retryAfter = response.headers.get('Retry-After');
        if (retryAfter) {
          const milliseconds = /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
          if (Number.isFinite(milliseconds)) retryDelay = Math.max(retryDelay, Math.min(120000, milliseconds));
        }
        throw new Error(`Leadping request failed (${response.status}).`);
      } catch (error) {
        if (error instanceof CaptureRejectedError || attempt === attempts - 1) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
    throw new Error('Leadping session could not be started.');
  };
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitted || !capture || !form.reportValidity()) return;
    if (!(checkbox instanceof HTMLInputElement) || !checkbox.checked) {
      status.textContent = 'Please check the consent box before submitting.';
      return;
    }
    submitted = true;
    status.textContent = 'Submitting…';
    const values = new FormData(form);
    const recipient: Recipient = {};
    for (const key of ['firstName', 'lastName', 'email', 'phone'] as const) {
      const value = values.get(key);
      if (typeof value === 'string' && value) recipient[key] = value;
    }
    try {
      const consentCapture = await capture.finish(recipient);
      const certificate = { certificateId: consentCapture.sessionId };
      const certificateUrl = `${portal.origin}/${certificate.certificateId}`;
      status.textContent = `Submission saved. Certificate: ${certificate.certificateId}. `;
      const link = document.createElement('a');
      link.href = certificateUrl; link.textContent = 'View certificate and replay';
      link.target = '_blank'; link.rel = 'noopener noreferrer'; status.append(link);
      form.dispatchEvent(new CustomEvent('leadping:success', { detail: { certificateId: certificate.certificateId, certificateUrl } }));
    } catch (error) {
      fail(error);
      if (!(error instanceof ReplayLimitExceededError))
        status.textContent = 'Submission could not be confirmed. Keep the certificate ID and check before starting another recording.';
    } finally { capture.dispose(); }
  });
  status.textContent = 'Loading consent…';
  try {
    if (!(disclosure instanceof HTMLElement) || !(checkbox instanceof HTMLInputElement))
      throw new Error('Add data-leadping-disclosure and data-leadping-consent inside the form.');
    const pageUrl = location.href;
    const observedDisclosure = disclosure.textContent ?? '';
    capture = new ConsentCapture({ apiUrl: origin.origin + '/api',
      session: async () => (await post(`/domains/${encodeURIComponent(domainId)}/sessions`, { pageUrl, disclosure: observedDisclosure })).json() as Promise<CaptureSession>,
      form, disclosure, checkbox, issueCertificate: true, onError: fail, onProgress: stage => {
        status.textContent = stage === 'uploading' ? 'Saving recording…' : 'Saving submission and requesting certificate…';
        progress(stage);
      } });
    window.addEventListener('pagehide', () => { capture?.dispose(); }, { once: true });
    await capture.ready;
    const certificateId = capture.sessionId!;
    const certificateUrl = `${portal.origin}/${certificateId}`;
    for (const [name, value] of Object.entries({ leadping_certificate_id: certificateId, leadping_certificate_url: certificateUrl })) {
      const input = document.createElement('input');
      input.type = 'hidden'; input.name = name; input.value = value;
      form.append(input);
    }
    if (!submitted) status.textContent = '';
    form.dispatchEvent(new CustomEvent('leadping:ready', { detail: { certificateId, certificateUrl,
      maxReplaySeconds: capture.maxReplaySeconds } }));
  } catch (error) { capture?.dispose(); fail(error); throw error; }
}

const script = document.currentScript;
if (script instanceof HTMLScriptElement && script.dataset.domainId) {
  const start = (): void => { void attach(script).catch(error => console.error('Leadping consent initialization failed:', error)); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
