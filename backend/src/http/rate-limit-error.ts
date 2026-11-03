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

export class ResendVerificationRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Resend verification IP limit exceeded.');
    this.name = 'ResendVerificationRateLimitError';
  }
}

/** Trusted marker emitted only by the login service's configured limiter. */
export class LoginRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Login attempt limit exceeded.');
    this.name = 'LoginRateLimitError';
  }
}
