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
  number: number;
  firstEventNumber: number;
  lastEventNumber: number;
  body: string;
}
