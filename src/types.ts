export interface ConsentForm {
  id: string;
  sourceId?: string;
  origin: string;
  disclosure: string;
  sellers?: string[];
  channels?: string[];
  approvedForContact?: boolean;
}

/** Obtain from your backend. Never put a Leadping source API key in the browser. */
export interface CaptureSession {
  /** The service accepts large events split into bounded, ordered fragments. */
  supportsEventFragments?: boolean;
  /** The service accepts a small final recording batch with submission. */
  supportsFinalBatch?: boolean;
  sessionId: string;
  uploadToken: string;
  expiresAt: string;
  /** Maximum elapsed recording time including idle time, supplied by the service. */
  maxReplaySeconds: number;
  form: ConsentForm;
}

export interface Recipient {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
}

export interface CaptureReference {
  sessionId: string;
  uploadToken: string;
}

/**
 * Replay masks input values and excludes credential/hidden controls. Use rr-block,
 * rr-ignore, or data-leadping-exclude on an element to exclude its subtree; rr-mask
 * or data-leadping-mask masks text. Keep the disclosure and consent control visible.
 */
export interface CaptureOptions {
  /** Absolute HTTPS API origin; no credentials or query string. */
  apiUrl: string;
  /** A session or a factory that obtains one. Capture starts immediately while the factory is pending. */
  session: CaptureSession | (() => Promise<CaptureSession>);
  form: HTMLFormElement;
  disclosure: HTMLElement;
  checkbox: HTMLInputElement;
  /** For public domain sessions, durably request a certificate with the final submission. */
  issueCertificate?: boolean;
  /** Called on terminal capture failures; never includes captured values. */
  onError?: (error: Error) => void;
  /** Submission stages; no captured values or upload credentials are included. */
  onProgress?: (stage: 'uploading' | 'submitting') => void;
}

export interface SealedBatch {
  /** Retained queue memory; fragment bodies are encoded only while uploading. */
  retainedBytes: number;
  fragmented?: boolean;
  number: number;
  firstEventNumber: number;
  lastEventNumber: number;
  body: string;
}
