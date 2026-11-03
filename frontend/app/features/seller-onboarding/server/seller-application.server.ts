import { serverEnv } from '../../../config/server-env.server';
import {
  requestApi,
  type ApiClientFailure,
  type RuntimeSchema,
} from '../../../lib/api-client.server';
import { isTrustedSessionRequest } from '../../../lib/security/csrf.server';
import {
  clearSessionCookie,
  readSessionCredential,
} from '../../../lib/security/session-cookie.server';
import { loadWorkspaceAccess } from '../../identity/server/workspace-access.server';
import type {
  SellerApplicationActionData,
  SellerApplicationDraft,
  SellerApplicationField,
  SellerApplicationFieldErrors,
  SellerApplicationFormValues,
  SellerApplicationLoaderData,
} from '../seller-application.types';

const API_PATH = '/api/v1/seller-applications/me';

const formFields: SellerApplicationField[] = [
  'sellerType',
  'applicantRelationship',
  'proposedStoreName',
  'privateContactPhone',
  'city',
  'neighborhood',
  'sellerDescription',
  'inventoryCondition',
  'fulfillmentOption',
  'businessTradingName',
  'businessContactName',
  'registrationStatus',
  'registrationReference',
  'privateOperatingAddress',
];

const expectedDraftKeys = [
  'id',
  'status',
  ...formFields,
  'createdAt',
  'updatedAt',
];

interface DraftResponse {
  data: { application: SellerApplicationDraft | null };
}

export interface SellerApplicationFlowResult<T> {
  data?: T;
  headers?: Headers;
  redirectTo?: string;
  response?: Response;
  status?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isOneOf(value: unknown, choices: readonly string[]): boolean {
  return (
    value === null || (typeof value === 'string' && choices.includes(value))
  );
}

function isDraft(value: unknown): value is SellerApplicationDraft {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== expectedDraftKeys.length ||
    !expectedDraftKeys.every((key) => key in value) ||
    typeof value.id !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(value.id) ||
    value.status !== 'draft' ||
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    typeof value.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.updatedAt))
  ) {
    return false;
  }

  return (
    isOneOf(value.sellerType, ['individual', 'commercial']) &&
    isOneOf(value.applicantRelationship, [
      'owner',
      'authorized_representative',
    ]) &&
    isNullableString(value.proposedStoreName) &&
    isNullableString(value.privateContactPhone) &&
    isNullableString(value.city) &&
    isNullableString(value.neighborhood) &&
    isNullableString(value.sellerDescription) &&
    isOneOf(value.inventoryCondition, ['new', 'used', 'both']) &&
    isOneOf(value.fulfillmentOption, ['pickup', 'local_delivery', 'both']) &&
    isNullableString(value.businessTradingName) &&
    isNullableString(value.businessContactName) &&
    isOneOf(value.registrationStatus, [
      'registered',
      'registration_pending',
      'not_registered',
    ]) &&
    isNullableString(value.registrationReference) &&
    isNullableString(value.privateOperatingAddress)
  );
}

const draftResponseSchema: RuntimeSchema<DraftResponse> = {
  parse(value) {
    if (
      !isRecord(value) ||
      Object.keys(value).length !== 1 ||
      !isRecord(value.data) ||
      Object.keys(value.data).length !== 1 ||
      !('application' in value.data) ||
      (value.data.application !== null && !isDraft(value.data.application))
    ) {
      throw new Error('Invalid seller application response.');
    }

    return {
      data: {
        application: value.data.application as SellerApplicationDraft | null,
      },
    };
  },
};

function privateHeaders(): Headers {
  return new Headers({
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
  });
}

function loginRedirect(): string {
  return '/login?returnTo=%2Fseller-application';
}

function isUnauthenticated(failure: ApiClientFailure): boolean {
  return (
    failure.kind === 'backend' &&
    failure.status === 401 &&
    failure.code === 'UNAUTHENTICATED'
  );
}

function blockedMessage(failure: ApiClientFailure): string | undefined {
  if (
    failure.kind === 'backend' &&
    failure.status === 403 &&
    failure.code === 'FORBIDDEN'
  ) {
    return 'An active, email-verified account is required to manage a seller application.';
  }

  if (
    failure.kind === 'backend' &&
    failure.status === 409 &&
    failure.code === 'CONFLICT'
  ) {
    return 'This account cannot start or edit a seller application.';
  }

  return undefined;
}

async function callDraftApi(
  method: 'GET' | 'POST' | 'PATCH',
  credential: string,
  jsonBody?: unknown,
) {
  return requestApi(serverEnv.API_BASE_URL, API_PATH, draftResponseSchema, {
    method,
    sessionCredential: credential,
    ...(method === 'GET' ? {} : { jsonBody }),
  });
}

export async function loadSellerApplicationDraft(
  request: Request,
): Promise<SellerApplicationFlowResult<SellerApplicationLoaderData>> {
  const access = await loadWorkspaceAccess(request, '/seller-application');

  if (access.state === 'redirect') {
    return { response: access.response };
  }

  if (access.state === 'unavailable') {
    return {
      data: {
        state: 'unavailable',
        message: 'Your seller application is temporarily unavailable.',
      },
      headers: access.headers,
      status: 503,
    };
  }

  if (access.state === 'forbidden') {
    return {
      data: {
        state: 'blocked',
        message: 'This account cannot manage a seller application.',
      },
      headers: access.headers,
      status: 403,
    };
  }

  const credential = readSessionCredential(request.headers.get('cookie'));

  if (!credential) {
    access.headers.append('Set-Cookie', clearSessionCookie());
    return {
      redirectTo: loginRedirect(),
      headers: access.headers,
    };
  }

  const result = await callDraftApi('GET', credential);

  if (result.ok) {
    return {
      data: {
        state: 'ready',
        application: result.data.data.application,
        csrfToken: access.csrfToken,
      },
      headers: access.headers,
    };
  }

  if (isUnauthenticated(result.error)) {
    access.headers.append('Set-Cookie', clearSessionCookie());
    return { redirectTo: loginRedirect(), headers: access.headers };
  }

  const blocked = blockedMessage(result.error);

  return {
    data: blocked
      ? { state: 'blocked', message: blocked }
      : {
          state: 'unavailable',
          message: 'Your seller application is temporarily unavailable.',
        },
    headers: access.headers,
    status: blocked ? 403 : 503,
  };
}

function textField(formData: FormData, name: SellerApplicationField): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function csrfField(formData: FormData): string {
  const value = formData.get('_csrfToken');
  return typeof value === 'string' ? value : '';
}

function readFormValues(formData: FormData): SellerApplicationFormValues {
  return Object.fromEntries(
    formFields.map((field) => [field, textField(formData, field)]),
  ) as SellerApplicationFormValues;
}

function apiPayload(values: SellerApplicationFormValues) {
  const nullableChoice = (value: string) => (value === '' ? null : value);

  return {
    sellerType: nullableChoice(values.sellerType),
    applicantRelationship: nullableChoice(values.applicantRelationship),
    proposedStoreName: values.proposedStoreName,
    privateContactPhone: values.privateContactPhone,
    city: values.city,
    neighborhood: values.neighborhood,
    sellerDescription: values.sellerDescription,
    inventoryCondition: nullableChoice(values.inventoryCondition),
    fulfillmentOption: nullableChoice(values.fulfillmentOption),
    businessTradingName: values.businessTradingName,
    businessContactName: values.businessContactName,
    registrationStatus: nullableChoice(values.registrationStatus),
    registrationReference: values.registrationReference,
    privateOperatingAddress: values.privateOperatingAddress,
  };
}

const safeFieldMessages: Record<SellerApplicationField, string> = {
  sellerType: 'Choose an available seller type.',
  applicantRelationship: 'Choose your relationship to the business.',
  proposedStoreName: 'Check the proposed store name.',
  privateContactPhone: 'Enter a valid contact phone number.',
  city: 'Check the city.',
  neighborhood: 'Check the neighborhood.',
  sellerDescription: 'Check the seller description.',
  inventoryCondition: 'Choose an available inventory condition.',
  fulfillmentOption: 'Choose an available fulfillment option.',
  businessTradingName: 'Check the business or trading name.',
  businessContactName: 'Check the business contact name.',
  registrationStatus: 'Choose an available registration status.',
  registrationReference: 'Check the registration reference.',
  privateOperatingAddress: 'Check the operating address.',
};

function validationFieldErrors(
  failure: ApiClientFailure,
): SellerApplicationFieldErrors {
  const errors: SellerApplicationFieldErrors = {};

  if (failure.kind !== 'backend' || failure.code !== 'VALIDATION_ERROR') {
    return errors;
  }

  for (const detail of failure.details ?? []) {
    if (detail.code !== 'FIELD_INVALID' && detail.code !== 'FIELD_REQUIRED') {
      continue;
    }

    if (formFields.includes(detail.field as SellerApplicationField)) {
      const field = detail.field as SellerApplicationField;
      errors[field] = safeFieldMessages[field];
    }
  }

  return errors;
}

function safeFailureMessage(failure: ApiClientFailure): string {
  const blocked = blockedMessage(failure);

  if (blocked) return blocked;

  if (failure.kind === 'backend' && failure.code === 'VALIDATION_ERROR') {
    return 'Check the highlighted fields and save the draft again.';
  }

  if (failure.kind === 'backend' && failure.status === 429) {
    return 'Please wait before trying again.';
  }

  return 'We could not save the draft. Please try again later.';
}

function actionFailure(
  failure: ApiClientFailure,
  values: SellerApplicationFormValues,
  headers: Headers,
): SellerApplicationFlowResult<SellerApplicationActionData> {
  if (isUnauthenticated(failure)) {
    headers.append('Set-Cookie', clearSessionCookie());
    return { redirectTo: loginRedirect(), headers };
  }

  return {
    data: {
      values,
      fieldErrors: validationFieldErrors(failure),
      formError: safeFailureMessage(failure),
    },
    headers,
  };
}

export async function runSellerApplicationAction(
  request: Request,
): Promise<SellerApplicationFlowResult<SellerApplicationActionData>> {
  const access = await loadWorkspaceAccess(request, '/seller-application');

  if (access.state === 'redirect') {
    return { response: access.response };
  }

  if (access.state === 'unavailable') {
    return {
      data: { formError: 'Your session is temporarily unavailable.' },
      headers: access.headers,
      status: 503,
    };
  }

  if (access.state === 'forbidden') {
    return {
      data: { formError: 'This account cannot manage a seller application.' },
      headers: access.headers,
      status: 403,
    };
  }

  const headers = access.headers;
  const credential = readSessionCredential(request.headers.get('cookie'));

  if (!credential) {
    headers.append('Set-Cookie', clearSessionCookie());
    return { redirectTo: loginRedirect(), headers };
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return {
      data: { formError: 'Reload the page and try again.' },
      headers,
    };
  }

  const values = readFormValues(formData);

  if (
    request.method !== 'POST' ||
    !isTrustedSessionRequest(
      request.headers.get('origin'),
      csrfField(formData),
      credential,
    )
  ) {
    return {
      data: {
        values,
        formError: 'Your form expired. Reload the page and try again.',
      },
      headers,
    };
  }

  const current = await callDraftApi('GET', credential);

  if (!current.ok) {
    return actionFailure(current.error, values, headers);
  }

  if (current.data.data.application === null) {
    // Create an empty draft first. A concurrent tab may create it between GET
    // and POST; the following PATCH then saves this form's latest values.
    const created = await callDraftApi('POST', credential, {});

    if (!created.ok) {
      return actionFailure(created.error, values, headers);
    }
  }

  const updated = await callDraftApi('PATCH', credential, apiPayload(values));

  if (!updated.ok) {
    return actionFailure(updated.error, values, headers);
  }

  return {
    data: {
      values,
      application: updated.data.data.application ?? undefined,
      success: true,
    },
    headers,
  };
}
