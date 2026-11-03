import { serverEnv } from '../../../config/server-env.server';
import {
  requestApi,
  type ApiClientFailure,
  type RuntimeSchema,
} from '../../../lib/api-client.server';
import { isTrustedRegistrationRequest } from '../../../lib/security/csrf.server';
import type { ResendVerificationActionData } from '../resend-verification.types';

interface ResendAcknowledgement {
  data: {
    message: 'If an account needs verification, instructions may be sent.';
  };
}

const acknowledgementSchema: RuntimeSchema<ResendAcknowledgement> = {
  parse(value) {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('data' in value) ||
      typeof value.data !== 'object' ||
      value.data === null ||
      !('message' in value.data) ||
      value.data.message !==
        'If an account needs verification, instructions may be sent.' ||
      Object.keys(value).length !== 1 ||
      Object.keys(value.data).length !== 1
    ) {
      throw new Error('Invalid resend verification acknowledgement.');
    }

    return {
      data: {
        message: 'If an account needs verification, instructions may be sent.',
      },
    };
  },
};

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function validEmail(value: string): boolean {
  const email = value.trim();

  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function safeFailure(
  failure: ApiClientFailure,
  email: string,
): ResendVerificationActionData {
  if (failure.kind === 'backend' && failure.code === 'VALIDATION_ERROR') {
    const hasEmailFieldError = (failure.details ?? []).some(
      (detail) =>
        detail.field === 'email' &&
        (detail.code === 'FIELD_REQUIRED' || detail.code === 'FIELD_INVALID'),
    );

    if (hasEmailFieldError) {
      return {
        email,
        emailError: 'Enter a valid email address.',
      };
    }
  }

  if (failure.kind === 'backend' && failure.code === 'RATE_LIMITED') {
    return {
      email,
      formError: 'Too many requests. Please wait and try again later.',
    };
  }

  return {
    email,
    formError: 'We could not process your request. Please try again later.',
  };
}

/**
 * Validates the same email format used by registration, applies the existing
 * same-origin CSRF check, and returns only safe UI state.
 */
export async function runResendVerificationAction(
  request: Request,
): Promise<ResendVerificationActionData> {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return {
      email: '',
      formError: 'Please reload the page and try again.',
    };
  }

  const emailInput = textField(formData, 'email');
  const email = emailInput.trim();
  const csrfToken = textField(formData, '_csrfToken');

  if (!isTrustedRegistrationRequest(request.headers.get('origin'), csrfToken)) {
    return {
      email,
      formError: 'Your form expired. Reload the page and try again.',
    };
  }

  if (!validEmail(emailInput)) {
    return {
      email,
      emailError: 'Enter a valid email address.',
    };
  }

  const result = await requestApi(
    serverEnv.API_BASE_URL,
    '/api/v1/auth/resend-verification',
    acknowledgementSchema,
    {
      method: 'POST',
      jsonBody: { email: email.toLowerCase() },
    },
  );

  if (result.ok) {
    return {
      email: '',
      success: true,
    };
  }

  return safeFailure(result.error, email);
}
