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
  /** Called on terminal capture failures; never includes captured values. */
  onError?: (error: Error) => void;
}

export interface SealedBatch {
  number: number;
  firstEventNumber: number;
  lastEventNumber: number;
  body: string;
}
