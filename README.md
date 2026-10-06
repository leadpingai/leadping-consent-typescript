# Leadping Consent SDK

Record consent on your website and receive a certificate ID. The consent service stores the evidence; the consent portal shows the certificate and replay. This SDK does not create leads or call the main Leadping API.

## Add one script to your form

Register your website's allowed origins with the consent service, then replace `YOUR_PUBLIC_DOMAIN_ID` below. This identifier is public, not an API key.

```html
<form id="lead-form">
  <label>Email <input name="email" type="email" required></label>
  <label><input type="checkbox" data-leadping-consent required>
    <span data-leadping-disclosure>I agree to the terms displayed on this page.</span>
  </label>
  <button type="submit">Submit</button>
</form>
<script
  src="https://cdn.jsdelivr.net/gh/leadpingai/leadping-consent-typescript@main/dist/leadping-consent.min.js"
  data-domain-id="YOUR_PUBLIC_DOMAIN_ID"
  defer>
</script>
```

Use your actual disclosure text. The script records that text; it does not supply or approve it. It captures the current page URL automatically, including its query string and fragment. The recorder captures the whole document with unmasked input values.

On submission the script finalizes recording, obtains a certificate, and displays its ID and link at `https://certificate.leadping.ai/certificates/{id}`. No customer backend or source API key is required. The script owns form submission; remove competing submission handlers.

For production replace `@main` with a version tag or commit that includes `dist`. Use the classic script at `dist/leadping-consent.min.js`, not the ES module under `dist/browser`.

## Options and events

| Attribute | Purpose |
| --- | --- |
| `data-domain-id` | Required public website registration ID. |
| `data-form` | Form selector; defaults to `#lead-form`. |
| `data-api-url` | Consent API origin; defaults to `https://consent.leadping.ai`. The SDK appends `/api`. |
| `data-portal-url` | Certificate portal origin; defaults to `https://certificate.leadping.ai`. Using the local API automatically selects the local portal. |

Recipient inputs use `firstName`, `lastName`, `email`, and `phone`. Supply at least email or phone. The checkbox must start unchecked and the disclosure must stay unchanged during capture. Only one recorder runs per document.

```js
document.querySelector('#lead-form').addEventListener('leadping:success', event => {
  const { certificateId, certificateUrl } = event.detail;
  console.log(certificateId, certificateUrl);
});
```

`leadping:ready` signals that recording has started; `leadping:error` reports a failure. `window.LeadpingConsent` exposes `ConsentCapture` and `attach(scriptElement)` for advanced use. Do not attach twice when `data-domain-id` already starts the embed automatically.

## Consent service setup

Leadping operates the API and portal; you do not deploy a backend. Ask Leadping to register your domain ID and exact website origins. For Leadping operators, `CONSENT_DOMAINS_JSON` has this format:

```json
[{ "id": "demo-domain", "origins": ["https://example.com", "https://www.example.com"] }]
```

The browser uses `POST /api/consent/domains/{id}/sessions`, uploads recording batches, then calls `POST /api/consent/certificates` with the session capability. No main Leadping source credentials are used.

Certificate URLs are shareable access links: anyone with the ID can view the certificate and recording. Treat those links as sensitive when recordings contain personal information.

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
| `dist/browser/*.map` | Browser source maps. |
| `dist/browser/*.LEGAL.txt` | Dependency license notices. |
| `dist/*.js` and `dist/*.d.ts` | ESM modules and TypeScript declarations for package consumers. |

The build also emits `dist/browser/index.js` for the consent service's existing SDK paths. This is bundled and minified as well.

### Publishing workflow

- Pull requests build and test the SDK and upload artifacts.
- Pushes to `main` additionally commit updated `dist/` files as `leadpingai-bot`. The workflow needs permission to push to `main`, including any branch-rule requirements.
- A `v*` tag matching `package.json` publishes a GitHub Release containing browser files, source maps, license notices, checksums, a browser archive, and the typed npm tarball.

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
