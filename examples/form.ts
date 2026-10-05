import { ConsentCapture, type CaptureSession } from '../src/index.js';

// Your backend authenticates to POST /consent/sessions with its source key.
// It supplies the approved form ID and URL; do not accept arbitrary client-supplied form definitions.
const bootstrap = await fetch('/api/consent-session', { method: 'POST' });
if (!bootstrap.ok) throw new Error('Unable to start consent capture.');
const session: CaptureSession = await bootstrap.json();
const form = document.querySelector<HTMLFormElement>('#lead-form')!;
const disclosure = document.querySelector<HTMLElement>('#consent-disclosure')!;
const checkbox = document.querySelector<HTMLInputElement>('#consent-checkbox')!;
disclosure.textContent = session.form.disclosure;
const capture = new ConsentCapture({ apiUrl: 'https://consent.leadping.ai', session, form, disclosure, checkbox });
form.addEventListener('submit', async event => {
  event.preventDefault();
  const fields = new FormData(form);
  const recipient = {
    firstName: String(fields.get('firstName') ?? ''), lastName: String(fields.get('lastName') ?? ''),
    email: String(fields.get('email') ?? ''), phone: String(fields.get('phone') ?? ''),
  };
  const consentCapture = await capture.finish(recipient);
  // Your backend forwards the reference with LeadIntakeRequest to POST /leads/intake.
  // Use the same reference and recipient when retrying an uncertain submission outcome.
  const response = await fetch('/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...recipient, consentCapture }) });
  if (!response.ok) throw new Error('Lead submission was not accepted.');
  capture.dispose();
});
