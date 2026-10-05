import { ConsentCapture } from './capture.js';
export { ConsentCapture } from './capture.js';
/** Attach the Leadping-hosted capture and submission flow to a form. */
export async function attach(script) {
    const domainId = script.dataset.domainId;
    if (!domainId)
        throw new Error('data-domain-id is required.');
    const form = document.querySelector(script.dataset.form ?? '#lead-form');
    if (!(form instanceof HTMLFormElement))
        throw new Error('Leadping form was not found.');
    if (form.dataset.leadpingAttached)
        throw new Error('Leadping is already attached to this form.');
    form.dataset.leadpingAttached = 'true';
    const disclosure = form.querySelector('[data-leadping-disclosure]');
    const checkbox = form.querySelector('[data-leadping-consent]');
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    form.append(status);
    let capture;
    let ready = false;
    let submitted = false;
    const fail = (error) => {
        ready = false;
        status.textContent = 'Unable to complete consent capture. Please reload to start again.';
        form.dispatchEvent(new CustomEvent('leadping:error', { detail: error }));
    };
    const origin = new URL(script.dataset.apiUrl ?? 'https://consent-api.leadping.ai');
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/')
        throw new Error('Leadping requires an HTTPS API origin.');
    const portal = new URL(script.dataset.portalUrl ?? (origin.hostname === 'consent-api-local.leadping.ai'
        ? 'https://consent-portal-local.leadping.ai' : 'https://consent-portal.leadping.ai'));
    if (portal.protocol !== 'https:' || portal.username || portal.password || portal.search || portal.hash || portal.pathname !== '/')
        throw new Error('Leadping requires an HTTPS portal origin.');
    const endpoint = `${origin.origin}/api/consent`;
    const post = async (path, body) => {
        const response = await fetch(endpoint + path, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            credentials: 'omit', redirect: 'error', body: JSON.stringify(body),
            signal: AbortSignal.timeout(30000),
        });
        if (!response.ok)
            throw new Error(`Leadping request failed (${response.status}).`);
        return response;
    };
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!ready || submitted || !capture || !form.reportValidity())
            return;
        if (!(checkbox instanceof HTMLInputElement) || !checkbox.checked) {
            status.textContent = 'Please check the consent box before submitting.';
            return;
        }
        submitted = true;
        ready = false;
        status.textContent = 'Submitting…';
        const values = new FormData(form);
        const recipient = {};
        for (const key of ['firstName', 'lastName', 'email', 'phone']) {
            const value = values.get(key);
            if (typeof value === 'string' && value)
                recipient[key] = value;
        }
        let issuingCertificate = false;
        try {
            const consentCapture = await capture.finish(recipient);
            issuingCertificate = true;
            const certificate = await (await post('/certificates', consentCapture)).json();
            if (!/^[0-9a-f-]{36}$/i.test(certificate.certificateId))
                throw new Error('Invalid certificate response.');
            const certificateUrl = `${portal.origin}/certificates/${certificate.certificateId}`;
            status.textContent = `Certificate received: ${certificate.certificateId}. `;
            const link = document.createElement('a');
            link.href = certificateUrl;
            link.textContent = 'View certificate and replay';
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            status.append(link);
            form.dispatchEvent(new CustomEvent('leadping:success', { detail: { certificateId: certificate.certificateId, certificateUrl } }));
        }
        catch (error) {
            fail(error);
            if (issuingCertificate)
                status.textContent = 'Certificate issuance could not be confirmed. Please check before starting another recording.';
        }
        finally {
            capture.dispose();
        }
    });
    status.textContent = 'Loading consent…';
    try {
        if (!(disclosure instanceof HTMLElement) || !(checkbox instanceof HTMLInputElement))
            throw new Error('Add data-leadping-disclosure and data-leadping-consent inside the form.');
        const session = await (await post(`/domains/${encodeURIComponent(domainId)}/sessions`, { pageUrl: location.href, disclosure: disclosure.textContent ?? '' })).json();
        checkbox.checked = false;
        capture = new ConsentCapture({ apiUrl: origin.origin + '/api', session, form, disclosure, checkbox, onError: fail });
        window.addEventListener('pagehide', () => { ready = false; capture?.dispose(); }, { once: true });
        ready = true;
        status.textContent = '';
        form.dispatchEvent(new CustomEvent('leadping:ready'));
    }
    catch (error) {
        capture?.dispose();
        fail(error);
        throw error;
    }
}
const script = document.currentScript;
if (script instanceof HTMLScriptElement && script.dataset.domainId) {
    const start = () => { void attach(script).catch(error => console.error('Leadping consent initialization failed:', error)); };
    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', start, { once: true });
    else
        start();
}
