# Leadping Consent SDK

Add consent capture to your form with a regular script tag. The script obtains its session, uploads the recording, and submits the lead directly to Leadping. No customer backend, API key, npm install, or module script is required.

## Add it to your page

Leadping must first register your public form ID and website origin. Replace `YOUR_PUBLIC_FORM_ID` below with that ID.

```html
<form id="lead-form">
  <label>Email <input name="email" type="email" required></label>
  <label>Phone <input name="phone" type="tel"></label>
  <label>
    <input type="checkbox" data-leadping-consent required>
    <span data-leadping-disclosure></span>
  </label>
  <button type="submit">Submit</button>
</form>
<script
  src="https://cdn.jsdelivr.net/gh/leadpingai/leadping-consent-typescript@main/dist/leadping-consent.min.js"
  data-form-id="YOUR_PUBLIC_FORM_ID"
  defer>
</script>
```

The script fills in the approved disclosure, records the page, and handles form submission. Use it as the form's submission handler; remove competing handlers that also submit the same lead. Keep the checkbox unchecked initially. The recorder preserves document content and unmasked input values across the whole page.

Use input names `firstName`, `lastName`, `email`, and `phone` for the recipient fields you collect. Only these fields and the capture reference are submitted by the embed. Arbitrary custom intake fields are not supported by this embed yet.

For production, replace `@main` with a tag or commit SHA containing the built `dist` files. The repository must be public for jsDelivr.

### Options

| Script attribute | Default | Purpose |
| --- | --- | --- |
| `data-form-id` | Required | Public form ID registered by Leadping. This is not an API key. |
| `data-form` | `#lead-form` | CSS selector for your form. |
| `data-api-url` | `https://consent.leadping.ai` | Leadping capture-service origin; useful for configured test environments. |

Only one recorder can run per document. The script displays loading, submission, and failure messages inside the form. It emits `leadping:ready`, `leadping:success`, and `leadping:error` events on the form for optional custom UI. It does not automatically retry uncertain lead submissions.

### Existing applications

The classic script exposes `window.LeadpingConsent.ConsentCapture` and `window.LeadpingConsent.attach(scriptElement)`. If the script has `data-form-id`, attachment is automatic; do not attach it a second time.

The existing ES module remains available at `dist/browser/leadping-consent.min.js`. Import `ConsentCapture` from it when you need manual lifecycle control. The classic embed is at **`dist/leadping-consent.min.js`**; these two files serve different integration styles.

## Leadping deployment setup

The embed requires the accompanying consent Worker update. Publishing the JavaScript alone does not deploy these routes:

- `POST /consent/forms/{formId}/sessions`
- `POST /consent/forms/{formId}/leads`

Leadping operators configure approved forms in `CONSENT_FORMS_JSON` and store `CONSENT_EMBED_SOURCES_JSON` as a **Worker secret**. Its value maps each approved source ID to its Leadping API origin and source API key:

```json
{
  "SOURCE_ID": {
    "apiUrl": "https://api.leadping.ai",
    "sourceKey": "SERVER_SIDE_SOURCE_API_KEY"
  }
}
```

Use the API origin appropriate to the environment. Never place this secret in public form configuration or customer HTML. The Worker checks the registered origin, rate-limits requests, and forwards only supported fields. The existing Leadping intake service remains responsible for validating the source and claiming the consent evidence for the recipient.

Deploy and configure the Worker before distributing the embed. Verify session creation, recording uploads, and an accepted lead against the deployed environment before treating an installation as complete.

## Reference

<details>
<summary><strong>API reference, recording behavior, and evidence replay</strong></summary>

## API reference

### `new ConsentCapture(options)`

Recording begins immediately when construction succeeds.

| Option | Type | Description |
| --- | --- | --- |
| `apiUrl` | `string` | HTTPS capture-service origin, without credentials, a query string, or a fragment. |
| `session` | `CaptureSession` | Session supplied by the Leadping integration. |
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

</details>

<details>
<summary><strong>Building and publishing the SDK</strong></summary>

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

</details>

## Troubleshooting

| Problem | Check |
| --- | --- |
| Form rejected during initialization | Exact origin and disclosure text, unchecked checkbox defaults, and both elements inside the form. |
| Invalid or expired session | Obtain a fresh session from Leadping; check the expiry and client clock. |
| Only one recorder may run | Dispose the previous instance before starting another. |
| Capture upload rejected or never acknowledged | Capture-service URL, session token/expiry, allowed origin, network connectivity, and service response. |
| jsDelivr returns 404 | The repository is public and the requested branch, tag, or commit actually contains the file under `dist/`. |
| `dist` is not updated after pushing | Check the `build` and `publish-dist` jobs, token write permissions, and branch protection. |
