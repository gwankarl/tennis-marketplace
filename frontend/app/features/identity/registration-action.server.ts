import { randomUUID } from 'node:crypto';
import { serverEnv } from '../../config/server-env.server';
import { isTrustedRegistrationRequest } from '../../lib/csrf.server';
import {
  requestApi,
  type ApiClientFailure,
  type RuntimeSchema,
} from '../../lib/api-client.server';
import type {
  RegistrationActionData,
  RegistrationField,
  RegistrationFormErrors,
  RegistrationFormValues,
} from './registration.types';

interface RegistrationPayload {
  data: { message: 'Registration request received.' };
}

const acknowledgementSchema: RuntimeSchema<RegistrationPayload> = {
  parse(value) {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('data' in value) ||
      typeof value.data !== 'object' ||
      value.data === null ||
      !('message' in value.data) ||
      value.data.message !== 'Registration request received.' ||
      Object.keys(value).length !== 1 ||
      Object.keys(value.data).length !== 1
    ) {
      throw new Error('Invalid registration acknowledgement.');
    }

    return { data: { message: 'Registration request received.' } };
  },
};

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function formValues(formData: FormData): RegistrationFormValues {
  return {
    firstName: textField(formData, 'firstName'),
    lastName: textField(formData, 'lastName'),
    email: textField(formData, 'email'),
    termsAccepted: formData.get('termsAccepted') === 'on',
  };
}

function validateForm(
  values: RegistrationFormValues,
  password: string,
  confirmPassword: string,
): RegistrationFormErrors {
  const errors: RegistrationFormErrors = {};
  const nameCharacters = /^[\p{L}\p{M} '\u2019\u2010-\u2015-]+$/u;

  for (const field of ['firstName', 'lastName'] as const) {
    const rawValue = values[field];
    const normalizedValue = rawValue.trim();
    const codePoints = Array.from(normalizedValue).length;

    if (
      /\p{Cc}/u.test(rawValue) ||
      codePoints < 1 ||
      codePoints > 100 ||
      !nameCharacters.test(normalizedValue) ||
      !/\p{L}/u.test(normalizedValue)
    ) {
      errors[field] = 'Enter a valid name using 1 to 100 characters.';
    }
  }

  const email = values.email.trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'Enter a valid email address.';
  }

  const passwordLength = Array.from(password).length;
  if (passwordLength < 15 || passwordLength > 128) {
    errors.password = 'Password must be between 15 and 128 characters.';
  }

  if (password !== confirmPassword) {
    errors.confirmPassword = 'Passwords do not match.';
  }

  if (!values.termsAccepted) {
    errors.termsAccepted = 'Acknowledge the development registration notice.';
  }

  return errors;
}

const FIELD_MESSAGES: Partial<Record<RegistrationField, string>> = {
  firstName: 'Enter a valid first name.',
  lastName: 'Enter a valid last name.',
  email: 'Enter a valid email address.',
  password: 'Choose a different password.',
  termsAccepted: 'Acknowledge the development registration notice.',
};

function mapBackendFailure(
  failure: ApiClientFailure,
): Pick<RegistrationActionData, 'errors' | 'formError'> {
  if (failure.kind === 'backend' && failure.code === 'VALIDATION_ERROR') {
    const errors: RegistrationFormErrors = {};

    for (const detail of failure.details ?? []) {
      const field = detail.field as RegistrationField;
      if (
        Object.hasOwn(FIELD_MESSAGES, field) &&
        detail.code === 'PASSWORD_COMPROMISED' &&
        field === 'password'
      ) {
        errors.password = 'Choose a different password.';
      } else if (
        Object.hasOwn(FIELD_MESSAGES, field) &&
        (detail.code === 'FIELD_REQUIRED' || detail.code === 'FIELD_INVALID')
      ) {
        errors[field] =
          field === 'password'
            ? 'Choose a different password.'
            : FIELD_MESSAGES[field];
      }
    }

    if (Object.keys(errors).length > 0) {
      return { errors };
    }

    return {
      formError: 'Please review the information and try again.',
    };
  }

  if (failure.kind === 'backend' && failure.code === 'RATE_LIMITED') {
    return {
      formError: 'Too many registration attempts. Please wait and try again.',
    };
  }

  if (failure.kind === 'backend' && failure.code === 'SERVICE_UNAVAILABLE') {
    return {
      formError:
        'Registration is temporarily unavailable. Please try again shortly.',
    };
  }

  return {
    formError: 'We could not submit your registration. Please try again later.',
  };
}

/**
 * Validates browser form input, verifies origin and CSRF token, and forwards
 * only the backend registration contract. Passwords are never returned in
 * action data, including on validation or API failures.
 */
export async function runRegistrationAction(
  request: Request,
): Promise<RegistrationActionData> {
  const formKey = randomUUID();
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return {
      formKey,
      values: {
        firstName: '',
        lastName: '',
        email: '',
        termsAccepted: false,
      },
      formError: 'Please reload the page and try again.',
    };
  }

  const values = formValues(formData);
  const csrfToken = textField(formData, '_csrfToken');

  if (!isTrustedRegistrationRequest(request.headers.get('origin'), csrfToken)) {
    return {
      formKey,
      values,
      formError: 'Your form expired. Reload the page and try again.',
    };
  }

  const password = textField(formData, 'password');
  const confirmPassword = textField(formData, 'confirmPassword');
  const errors = validateForm(values, password, confirmPassword);

  if (Object.keys(errors).length > 0) {
    return { formKey, values, errors };
  }

  const result = await requestApi(
    serverEnv.API_BASE_URL,
    '/api/v1/auth/register',
    acknowledgementSchema,
    {
      method: 'POST',
      jsonBody: {
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        email: values.email.trim().toLowerCase(),
        password,
        termsAccepted: true,
      },
    },
  );

  if (result.ok) {
    return { formKey, values, success: true };
  }

  return {
    formKey,
    values,
    ...mapBackendFailure(result.error),
  };
}
