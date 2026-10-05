# Leadping Consent SDK

Capture a form session, record the disclosure and consent interaction, and attach the capture reference to a lead submitted through your backend.

The SDK provides browser recording and a separate evidence verification/replay API. Session creation, lead acceptance, and evidence export are handled by Leadping services. The hosted evidence-viewer website lives in the main Leadping repository.

## How it works

1. Your backend requests a capture session from Leadping using its source API key and an approved form configuration.
2. Your page displays the session's exact disclosure and starts `ConsentCapture` with an unchecked consent checkbox.
3. The SDK records document activity and uploads batches using the session's short-lived upload token.
4. On form submission, await `capture.finish(recipient)` to upload the remaining recording and submission assertion.
5. Send the returned `consentCapture` reference and the same recipient data to your backend, which submits the lead to Leadping.

`finish()` completes the browser capture; it does not create a lead or establish that the lead is approved for contact.

## Get the SDK

### Browser module through jsDelivr

For a public repository with the built files committed to `main`:

```html
<script type="module">
  import { ConsentCapture } from
    'https://cdn.jsdelivr.net/gh/leadpingai/leadping-consent-typescript@main/dist/browser/leadping-consent.min.js';

  // Initialize ConsentCapture after obtaining a session from your backend.
</script>
```

The browser bundle includes its dependencies. It is an ES module: use `import` or a module script, rather than expecting a global variable from a regular script tag.

For a production integration, replace `main` with a commit SHA or version tag that contains the built `dist` files. This pins the code your page loads. Updating `main` does not guarantee an immediate CDN cache refresh.

### TypeScript application

The package name is `@leadping/consent`. This repository currently produces an npm-compatible tarball; its workflow does **not** publish the package to the npm registry.

Download the `.tgz` asset from a published GitHub release and install it locally, for example for version `0.1.0`:

```sh
npm install ./leadping-consent-0.1.0.tgz
```

Then import the SDK and its types:

```ts
import { ConsentCapture, type CaptureSession } from '@leadping/consent';
```

You can also build and package a local checkout with `npm ci`, `npm run build`, and `npm pack`.

## Capture a form

The following example uses two routes implemented by **your application**:

| Route | Responsibility |
| --- | --- |
| `POST /api/consent-session` | Request a session from Leadping on the server and return the `CaptureSession` JSON. |
| `POST /api/lead` | Accept the recipient and capture reference, then forward them through the normal Leadping lead-intake flow. |

These are example application routes, not routes provided by this SDK. Keep the Leadping source API key on your server.

### Form markup

Keep the form disabled until session setup succeeds. The disclosure is populated from the approved session before recording starts.

```html
<form id="lead-form">
  <fieldset id="lead-fields" disabled>
    <label>
      Email
      <input type="email" name="email" required>
    </label>
    <label>
      Phone
      <input type="tel" name="phone">
    </label>
    <label>
      <input id="consent-checkbox" type="checkbox" required>
      <span id="consent-disclosure"></span>
    </label>
    <button id="submit-lead" type="submit">Submit</button>
  </fieldset>
  <p id="form-status" role="status" aria-live="polite"></p>
</form>
```

### Initialize and submit

Run this code after the form exists, such as from a module script. With the CDN bundle, replace the package import with the jsDelivr import above and remove the TypeScript annotations.

```ts
import { ConsentCapture, type CaptureSession } from '@leadping/consent';

const form = document.querySelector<HTMLFormElement>('#lead-form')!;
const fields = document.querySelector<HTMLFieldSetElement>('#lead-fields')!;
const disclosure = document.querySelector<HTMLElement>('#consent-disclosure')!;
const checkbox = document.querySelector<HTMLInputElement>('#consent-checkbox')!;
const submit = document.querySelector<HTMLButtonElement>('#submit-lead')!;
const status = document.querySelector<HTMLElement>('#form-status')!;

async function initialize(): Promise<void> {
  const response = await fetch('/api/consent-session', { method: 'POST' });
  if (!response.ok) throw new Error('Unable to start consent capture.');
  const session: CaptureSession = await response.json();

  disclosure.textContent = session.form.disclosure;

  const capture = new ConsentCapture({
    apiUrl: 'https://consent.leadping.ai',
    session,
    form,
    disclosure,
    checkbox,
    onError: () => {
      submit.disabled = true;
      status.textContent = 'Recording stopped. Please start a new form session.';
    },
  });

  fields.disabled = false;
  let submitting = false;

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting || submit.disabled) return;
    submitting = true;
    submit.disabled = true;

    const data = new FormData(form);
    const recipient = {
      email: String(data.get('email') ?? ''),
      phone: String(data.get('phone') ?? ''),
    };

    try {
      const consentCapture = await capture.finish(recipient);
      const result = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...recipient, consentCapture }),
      });
      if (!result.ok) throw new Error('Lead submission was not confirmed.');
      status.textContent = 'Submitted. Thank you.';
    } catch {
      // A lost response does not prove that your backend rejected the lead.
      // Resolve uncertain outcomes through your application's retry/status flow.
      status.textContent = 'Submission could not be confirmed. Please contact support.';
    } finally {
      capture.dispose();
    }
  });
}

void initialize().catch(() => {
  status.textContent = 'Unable to start the form. Please reload and try again.';
});
```

In a component-based application, also call `capture.dispose()` when the component unmounts. Do not dispose while `finish()` is still uploading.

### Backend responsibilities

- Authenticate server-to-server to the Leadping API's `POST /consent/sessions` endpoint. Choose the approved form ID and URL on the server; do not trust arbitrary browser-supplied form definitions.
- Return the capture session to the requesting page. Its `form.origin` must exactly match the page's `location.origin`, including the scheme and any port.
- Forward the returned `consentCapture` object with the recipient and other required intake fields to `POST /leads/intake` on the Leadping API.
- When retrying an uncertain lead submission, reuse the same capture reference and recipient data. Do not start a new recording simply because the lead response was lost.

The SDK's `apiUrl` points to the **capture upload service**. Session creation and lead intake go through the Leadping API via your backend.

## API reference

### `new ConsentCapture(options)`

Recording begins immediately when construction succeeds.

| Option | Type | Description |
| --- | --- | --- |
| `apiUrl` | `string` | HTTPS capture-service origin, without credentials, a query string, or a fragment. |
| `session` | `CaptureSession` | Session returned by your backend. |
| `form` | `HTMLFormElement` | Form containing the disclosure and checkbox. |
| `disclosure` | `HTMLElement` | Element whose `textContent` exactly matches `session.form.disclosure`. |
| `checkbox` | `HTMLInputElement` | Consent checkbox; both `checked` and `defaultChecked` must initially be false. |
| `onError` | `(error: Error) => void` | Reports terminal recording failures. Handle constructor exceptions and rejected method promises separately. |

Only one recorder may be active per document. The session must be unexpired and have no more than one hour remaining when recording starts. Do not rewrite the disclosure while recording.

### Methods

| Method | Returns | Behavior |
| --- | --- | --- |
| `finish(recipient)` | `Promise<CaptureReference>` | Stops recording, awaits pending uploads, submits the checkbox state and recipient, then returns `{ sessionId, uploadToken }`. |
| `flush()` | `Promise<void>` | Uploads pending recording data without stopping capture. |
| `dispose()` | `void` | Stops recording and timers, removes listeners, and aborts transport requests. Does not finalize or flush the recording. |

`Recipient` accepts optional `firstName`, `lastName`, `email`, and `phone` strings. Your form and backend determine which fields are required.

`finish()` uses the first call's recipient and returns the same promise on later calls. A failed finalization cannot be restarted on that instance. It records the checkbox's current state, including `false`; use your form's validation rules when acceptance is required.

### Recording behavior

The recorder operates on the **whole document**, not just the supplied form. It preserves text and input values without masking, so page content and entered values can become part of the evidence. Canvas and cross-origin iframe recording are disabled.

Pending data is flushed every three seconds, on a page visibility change to hidden, and as batches grow. Await `finish()` before navigation; background flushing is not a guarantee that uploads will complete during page unload.

Uploads use bounded retries for transient failures. Buffer, backlog, and session limits cause capture to fail explicitly rather than silently discard events. The SDK does not persist an offline recording queue across reloads.

## Verify and replay evidence

Replay is a separate import so capture pages do not need to load the replay bundle:

```ts
import { verifyEvidence, mountEvidence } from '@leadping/consent/viewer';

// bundle is the parsed JSON from an authorized Leadping evidence export.
const verified = await verifyEvidence(bundle);
console.log(verified.complete, verified.disclosure, verified.keyFingerprint);

// Use a dedicated, CSP-restricted viewer page for mounting evidence.
const disposeReplay = await mountEvidence(document.querySelector('#replay')!, bundle);
// Call disposeReplay() when closing or replacing the replay.
```

The equivalent browser module is `dist/browser/leadping-consent-viewer.min.js`. Replay also needs `dist/browser/replay.css`.

`verifyEvidence()` checks the payload digest, signature against the included public key, batch hashes, event sequence, and manifest completeness. Verify the returned public-key fingerprint against a trusted value independently: a matching signature alone does not establish who supplied the included key.

`mountEvidence()` verifies before rendering and provides playback controls for complete recordings. Incomplete recordings display their status without starting replay. Use it on a dedicated page with a restrictive Content Security Policy; the hosted viewer implementation is maintained in the main Leadping repository. Captured page scripts are not enabled during replay, and unavailable external resources can affect visual fidelity.

## Build and distribution

Use Node.js 24, matching CI:

```sh
npm ci
npm run build
npm test
```

`npm run benchmark` runs the buffer benchmark. Edit `src/`, then regenerate `dist/`; generated output is committed so jsDelivr can serve it.

| Output | Purpose |
| --- | --- |
| `dist/browser/leadping-consent.min.js` | Bundled browser capture SDK. |
| `dist/browser/leadping-consent-viewer.min.js` | Bundled evidence verification and replay API. |
| `dist/browser/replay.css` | Replay styles. |
| `dist/browser/*.map` | Browser source maps. |
| `dist/browser/*.LEGAL.txt` | Dependency license notices. |
| `dist/*.js` and `dist/*.d.ts` | ESM modules and TypeScript declarations for package consumers. |

The build also emits `dist/browser/index.js` and `dist/browser/viewer.js` for the consent service's existing SDK paths. These are bundled and minified as well.

### Publishing workflow

- Pull requests build and test the SDK and upload artifacts.
- Pushes to `main` additionally commit updated `dist/` files as `leadpingai-bot`. The workflow needs permission to push to `main`, including any branch-rule requirements.
- A `v*` tag matching `package.json` publishes a GitHub Release containing browser files, source maps, CSS, license notices, checksums, a browser archive, and the typed npm tarball.

To make a versioned jsDelivr URL available, wait for the `dist` commit, pull it, and tag that commit. The release workflow creates downloadable assets but does not insert files into an existing tag. The package version must match the tag, for example `0.1.0` and `v0.1.0`.

## Troubleshooting

| Problem | Check |
| --- | --- |
| Form rejected during initialization | Exact origin and disclosure text, unchecked checkbox defaults, and both elements inside the form. |
| Invalid or expired session | Obtain a fresh session from your backend; check the expiry and client clock. |
| Only one recorder may run | Dispose the previous instance before starting another. |
| Capture upload rejected or never acknowledged | Capture-service URL, session token/expiry, allowed origin, network connectivity, and service response. |
| jsDelivr returns 404 | The repository is public and the requested branch, tag, or commit actually contains the file under `dist/`. |
| `dist` is not updated after pushing | Check the `build` and `publish-dist` jobs, token write permissions, and branch protection. |
