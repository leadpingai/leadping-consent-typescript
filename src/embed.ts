import { ConsentCapture } from './capture.js';
import type { CaptureSession, Recipient } from './types.js';
export { ConsentCapture } from './capture.js';

/** Attach the Leadping-hosted capture and submission flow to a form. */
export async function attach(script: HTMLScriptElement): Promise<void> {
  const formId = script.dataset.formId;
  if (!formId) throw new Error('data-form-id is required.');
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
  let ready = false;
  let submitted = false;
  const fail = (error: unknown): void => {
    ready = false;
    status.textContent = 'Unable to complete consent capture. Please reload to start again.';
    form.dispatchEvent(new CustomEvent('leadping:error', { detail: error }));
  };
  const origin = new URL(script.dataset.apiUrl ?? 'https://consent.leadping.ai');
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/')
    throw new Error('Leadping requires an HTTPS API origin.');
  const endpoint = `${origin.origin}/consent/forms/${encodeURIComponent(formId)}`;
  const post = async (path: string, body: unknown): Promise<Response> => {
    const response = await fetch(endpoint + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'omit', redirect: 'error', body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Leadping request failed (${response.status}).`);
    return response;
  };
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!ready || submitted || !capture || !form.reportValidity()) return;
    if (!(checkbox instanceof HTMLInputElement) || !checkbox.checked) {
      status.textContent = 'Please check the consent box before submitting.';
      return;
    }
    submitted = true;
    ready = false;
    status.textContent = 'Submitting…';
    const values = new FormData(form);
    const recipient: Recipient = {};
    for (const key of ['firstName', 'lastName', 'email', 'phone'] as const) {
      const value = values.get(key);
      if (typeof value === 'string' && value) recipient[key] = value;
    }
    let sendingLead = false;
    try {
      const consentCapture = await capture.finish(recipient);
      sendingLead = true;
      await post('/leads', { ...recipient, consentCapture });
      status.textContent = 'Submitted. Thank you.';
      form.dispatchEvent(new CustomEvent('leadping:success'));
    } catch (error) {
      fail(error);
      if (sendingLead) status.textContent = 'Submission could not be confirmed. Please contact support before trying again.';
    } finally { capture.dispose(); }
  });
  status.textContent = 'Loading consent…';
  try {
    if (!(disclosure instanceof HTMLElement) || !(checkbox instanceof HTMLInputElement))
      throw new Error('Add data-leadping-disclosure and data-leadping-consent inside the form.');
    const session = await (await post('/sessions', { pageUrl: location.origin + location.pathname })).json() as CaptureSession;
    disclosure.textContent = session.form.disclosure;
    checkbox.checked = false;
    capture = new ConsentCapture({ apiUrl: origin.origin, session, form, disclosure, checkbox, onError: fail });
    window.addEventListener('pagehide', () => { ready = false; capture?.dispose(); }, { once: true });
    ready = true;
    status.textContent = '';
    form.dispatchEvent(new CustomEvent('leadping:ready'));
  } catch (error) { capture?.dispose(); fail(error); throw error; }
}

const script = document.currentScript;
if (script instanceof HTMLScriptElement && script.dataset.formId) {
  const start = (): void => { void attach(script).catch(error => console.error('Leadping consent initialization failed:', error)); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
