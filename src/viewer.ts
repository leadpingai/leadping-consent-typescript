import { Replayer } from 'rrweb';
import type { eventWithTime } from '@rrweb/types';

interface EvidenceExport {
  receipt: { evidenceSha256: string };
  evidence: { payload: string; signature: string; publicKey: string; signingKeyId: string };
  batches: (string | null)[];
}

const decode = (value: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const hex = (value: ArrayBuffer): string => Array.from(new Uint8Array(value), b => b.toString(16).padStart(2, '0')).join('');

/** Checks exact bytes and signature before any captured DOM is rendered. Trust the key fingerprint separately. */
export async function verifyEvidence(bundle: EvidenceExport): Promise<{ events: eventWithTime[]; complete: boolean; disclosure: string; keyFingerprint: string }> {
  const payload = decode(bundle.evidence.payload);
  const digest = hex(await crypto.subtle.digest('SHA-256', payload));
  if (digest !== bundle.receipt.evidenceSha256) throw new Error('Evidence digest does not match the receipt.');
  const keyBytes = decode(bundle.evidence.publicKey);
  const key = await crypto.subtle.importKey('spki', keyBytes, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, decode(bundle.evidence.signature), payload))
    throw new Error('Evidence signature is invalid.');
  const evidence = JSON.parse(new TextDecoder().decode(payload)) as {
    version: number; recordingComplete: boolean; batchHashes: (string | null)[];
    session: { form: { disclosure: string } }; submission: { lastEventNumber: number };
  };
  if (evidence.version !== 1 || evidence.batchHashes.length !== bundle.batches.length || bundle.batches.length > 256)
    throw new Error('Invalid evidence manifest.');
  const events: eventWithTime[] = [];
  let nextEvent = 0;
  let complete = true;
  for (let i = 0; i < bundle.batches.length; i++) {
    const encoded = bundle.batches[i];
    if (encoded == null) {
      if (evidence.batchHashes[i] != null) throw new Error('Evidence batch is missing.');
      complete = false;
      continue;
    }
    const bytes = decode(encoded);
    if (hex(await crypto.subtle.digest('SHA-256', bytes)) !== evidence.batchHashes[i]) throw new Error('Recording batch was modified.');
    const batch = JSON.parse(new TextDecoder().decode(bytes)) as { number: number; firstEventNumber: number; lastEventNumber: number; events: eventWithTime[] };
    if (batch.number !== i || batch.firstEventNumber !== nextEvent) complete = false;
    if (batch.lastEventNumber !== batch.firstEventNumber + batch.events.length - 1) throw new Error('Invalid event sequence.');
    // Don't use spread: large batches can exceed the JavaScript argument limit.
    for (const event of batch.events) events.push(event);
    nextEvent = batch.lastEventNumber + 1;
  }
  complete &&= nextEvent === evidence.submission.lastEventNumber + 1;
  if (complete !== evidence.recordingComplete) throw new Error('Recording completeness disagrees with the signed manifest.');
  return { events, complete, disclosure: evidence.session.form.disclosure, keyFingerprint: hex(await crypto.subtle.digest('SHA-256', keyBytes)) };
}

/** Mount only in the dedicated CSP-restricted viewer page. Original page scripts are never enabled. */
export async function mountEvidence(root: HTMLElement, bundle: EvidenceExport): Promise<() => void> {
  const verified = await verifyEvidence(bundle);
  root.replaceChildren();
  const status = document.createElement('p');
  status.textContent = verified.complete ? 'Recording complete' : 'Recording incomplete — some events were not captured';
  const disclosure = document.createElement('blockquote');
  disclosure.textContent = verified.disclosure;
  const integrity = document.createElement('p');
  integrity.textContent = `Signature matches included key ${bundle.evidence.signingKeyId}. Verify this fingerprint independently: ${verified.keyFingerprint}`;
  const fidelity = document.createElement('p');
  fidelity.textContent = 'Replay reconstructs recorded DOM events. External resources are blocked; unavailable images, fonts and cross-origin styles may differ.';
  root.append(status, disclosure, integrity, fidelity);
  if (!verified.complete) return () => root.replaceChildren();
  const controls = document.createElement('div');
  const stage = document.createElement('div');
  root.append(controls, stage);
  const player = new Replayer(verified.events, { root: stage, skipInactive: true, showWarning: false, showDebug: false, UNSAFE_replayCanvas: false });
  player.iframe.setAttribute('sandbox', 'allow-same-origin');
  function button(text: string, action: () => void): void {
    const element = document.createElement('button');
    element.textContent = text;
    element.addEventListener('click', action);
    controls.append(element);
  }
  button('Play', () => player.play());
  button('Pause', () => player.pause());
  button('Consent', () => {
    const target = verified.events.find(event => event.type === 5 && event.data.tag === 'leadping.consent');
    if (target) player.play(Math.max(0, target.timestamp - verified.events[0]!.timestamp));
  });
  button('Submission', () => {
    const target = verified.events.find(event => event.type === 5 && event.data.tag === 'leadping.submit');
    if (target) player.play(Math.max(0, target.timestamp - verified.events[0]!.timestamp));
  });
  return () => { player.destroy(); root.replaceChildren(); };
}
