import { serverEnv } from '../../../config/server-env.server';
import {
  requestApi,
  type ApiClientFailure,
  type RuntimeSchema,
} from '../../../lib/api-client.server';
import { isTrustedRegistrationRequest } from '../../../lib/security/csrf.server';
import type {
  ForgotPasswordActionData,
  ForgotPasswordActionResult,
} from '../forgot-password.types';

interface PasswordResetAcknowledgement {
  data: {
    message: 'If an account is eligible for a password reset, instructions may be sent.';
  };
}

const acknowledgementSchema: RuntimeSchema<PasswordResetAcknowledgement> = {
  parse(value) {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('data' in value) ||
      typeof value.data !== 'object' ||
      value.data === null ||
      !('message' in value.data) ||
      value.data.message !==
        'If an account is eligible for a password reset, instructions may be sent.' ||
      Object.keys(value).length !== 1 ||
      Object.keys(value.data).length !== 1
    ) {
      throw new Error('Invalid password reset acknowledgement.');
    }

    return {
      data: {
        message:
          'If an account is eligible for a password reset, instructions may be sent.',
      },
    };
  },
};

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function safeEmail(value: string): string {
  return value.trim().slice(0, 254);
}

function validEmail(value: string): boolean {
  const email = value.trim();

  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function noStoreHeaders(): Headers {
  return new Headers({
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer',
  });
}

function safeFailure(
  failure: ApiClientFailure,
  email: string,
): ForgotPasswordActionData {
  if (failure.kind === 'backend' && failure.code === 'VALIDATION_ERROR') {
    const emailFieldError = (failure.details ?? []).some(
      (detail) =>
        detail.field === 'email' &&
        (detail.code === 'FIELD_REQUIRED' || detail.code === 'FIELD_INVALID'),
    );

    if (emailFieldError) {
      return { email, emailError: 'Enter a valid email address.' };
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

/** Requests recovery without returning account existence or backend details. */
export async function runForgotPasswordAction(
  request: Request,
): Promise<ForgotPasswordActionResult> {
  const headers = noStoreHeaders();
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return {
      data: {
        email: '',
        formError: 'Please reload the page and try again.',
      },
      headers,
    };
  }

  const emailInput = textField(formData, 'email');
  const email = safeEmail(emailInput);
  const csrfToken = textField(formData, '_csrfToken');

  if (!isTrustedRegistrationRequest(request.headers.get('origin'), csrfToken)) {
    return {
      data: {
        email,
        formError: 'Your form expired. Reload the page and try again.',
      },
      headers,
    };
  }

  if (!validEmail(emailInput)) {
    return {
      data: {
        email,
        emailError: 'Enter a valid email address.',
      },
      headers,
    };
  }

  const result = await requestApi(
    serverEnv.API_BASE_URL,
    '/api/v1/auth/request-password-reset',
    acknowledgementSchema,
    {
      method: 'POST',
      jsonBody: { email: email.toLowerCase() },
    },
  );

  if (result.ok) {
    return {
      data: { email: '', success: true },
      headers,
    };
  }

  return {
    data: safeFailure(result.error, email),
    headers,
  };
}
