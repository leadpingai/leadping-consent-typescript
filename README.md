# Leadping Consent SDK

The browser SDK for Leadping consent capture. It records a visitor's form interaction and sends the recording directly to Leadping.

## Integration status

The recording SDK is implemented. The complete copy-and-paste customer integration is not yet implemented:

- Capture uploads go directly to Leadping using a short-lived session token.
- The current session-creation and lead-intake endpoints require a source API key intended for server-side use.
- The SDK currently expects an existing session; it does not bootstrap one from a public form identifier or submit a lead itself.

Leadping needs to provide browser-safe session creation and lead submission before this can be offered as a standalone customer embed. **Do not put a source API key in the page to work around this.**

The examples below document the current recording API for Leadping integration work. They are not a finished customer installation guide.

## Load the SDK

Use the browser module directly; no npm installation or build tool is required:

```js
import { ConsentCapture } from
  'https://cdn.jsdelivr.net/gh/leadpingai/leadping-consent-typescript@main/dist/browser/leadping-consent.min.js';
```

Use this import inside a `<script type="module">` or another JavaScript module. The repository must be public and the referenced commit must contain `dist`. For production, replace `@main` with a version tag or commit SHA containing the built files.

## Current recording API

Once the Leadping integration has supplied a `CaptureSession`, initialize the recorder with the form elements:

```js
// session is supplied by Leadping; it contains a short-lived upload token.
const form = document.querySelector('#lead-form');
const disclosure = document.querySelector('#consent-disclosure');
const checkbox = document.querySelector('#consent-checkbox');

// Both elements must be inside form. The checkbox must start unchecked.
disclosure.textContent = session.form.disclosure;

const capture = new ConsentCapture({
  apiUrl: 'https://consent.leadping.ai',
  session,
  form,
  disclosure,
  checkbox,
  onError: error => {
    // Disable submission and show a recording failure in the form.
    console.error('Consent capture stopped:', error);
  },
});
```

Before completing submission, wait for the recording to finish:

```js
const consentCapture = await capture.finish({
  email: 'visitor@example.com',
  phone: '+15555550123',
});

// The Leadping integration must associate this reference with the lead.
// finish() returns { sessionId, uploadToken }; it does not create the lead.
capture.dispose();
```

Only dispose after uploads finish, or when abandoning the form. In a component framework, dispose when the component unmounts. Handle rejected promises from `finish()` and constructor errors in addition to `onError`.

### What the page must provide

- A form containing the disclosure element and consent checkbox.
- An initially unchecked checkbox, with no `checked` HTML attribute.
- The exact disclosure returned in the session, without edits.
- An origin matching the session's approved origin.

The recorder captures the **whole document, including unmasked input values**. Use it on the page intended for consent capture. Only one recorder can run per document.

## TypeScript applications

The package is not published to npm. For internal integration, download a `.tgz` from a published GitHub release or build one with `npm pack` after running `npm ci` and `npm run build`.

```sh
npm install ./leadping-consent-0.1.0.tgz
```

```ts
import { ConsentCapture, type CaptureSession } from '@leadping/consent';
```

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
