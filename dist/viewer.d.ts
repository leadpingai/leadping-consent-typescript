import type { eventWithTime } from '@rrweb/types';
interface EvidenceExport {
    receipt: {
        evidenceSha256: string;
    };
    evidence: {
        payload: string;
        signature: string;
        publicKey: string;
        signingKeyId: string;
    };
    batches: (string | null)[];
}
/** Checks exact bytes and signature before any captured DOM is rendered. Trust the key fingerprint separately. */
export declare function verifyEvidence(bundle: EvidenceExport): Promise<{
    events: eventWithTime[];
    complete: boolean;
    disclosure: string;
    keyFingerprint: string;
}>;
/** Mount only in the dedicated CSP-restricted viewer page. Original page scripts are never enabled. */
export declare function mountEvidence(root: HTMLElement, bundle: EvidenceExport): Promise<() => void>;
export {};
