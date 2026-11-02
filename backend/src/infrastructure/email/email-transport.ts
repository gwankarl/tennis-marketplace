export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailTransport {
  /** Performs one transport attempt. Retry policy belongs to delivery work. */
  send(message: OutboundEmail): Promise<void>;
}

export type EmailTransportFailureKind = 'transient' | 'permanent';

/** Sanitized transport failure; SMTP details and message data are not retained. */
export class EmailTransportError extends Error {
  constructor(readonly failureKind: EmailTransportFailureKind = 'transient') {
    super('Email transport attempt failed.');
    this.name = 'EmailTransportError';
  }
}
