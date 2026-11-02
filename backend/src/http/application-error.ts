export type ApplicationErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'VALIDATION_ERROR';

export interface ApplicationErrorDetail {
  field: string;
  code: string;
  message: string;
}

/**
 * An expected application outcome with a safe public message.
 * It contains no HTTP status or response-construction behavior.
 */
export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    message: string,
    readonly details?: readonly ApplicationErrorDetail[],
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}
