/**
 * Trusted marker for the registration limiter's configured error builder.
 * The central handler recognizes this class, not arbitrary status/code fields.
 */
export class RegistrationRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Registration request limit exceeded.');
    this.name = 'RegistrationRateLimitError';
  }
}
