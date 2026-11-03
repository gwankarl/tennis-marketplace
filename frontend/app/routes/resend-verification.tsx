import { useActionData, useLoaderData, type LinksFunction } from 'react-router';
import { ResendVerificationForm } from '../features/identity/components/resend-verification-form';
import { runResendVerificationAction } from '../features/identity/server/resend-verification-action.server';
import type { ResendVerificationActionData } from '../features/identity/resend-verification.types';
import { createCsrfToken } from '../lib/security/csrf.server';
import stylesheet from '../features/identity/components/resend-verification-form.css?url';

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: stylesheet },
];

export async function loader() {
  return { csrfToken: createCsrfToken() };
}

export async function action({ request }: { request: Request }) {
  return runResendVerificationAction(request);
}

export default function ResendVerificationRoute() {
  const { csrfToken } = useLoaderData<typeof loader>();
  const actionData = useActionData() as
    | ResendVerificationActionData
    | undefined;

  return (
    <ResendVerificationForm
      csrfToken={csrfToken}
      actionData={actionData}
    />
  );
}