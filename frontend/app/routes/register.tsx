import { useActionData, useLoaderData, type LinksFunction } from 'react-router';
import { RegistrationForm } from '../features/identity/registration-form';
import { runRegistrationAction } from '../features/identity/registration-action.server';
import type { RegistrationActionData } from '../features/identity/registration.types';
import { createCsrfToken } from '../lib/csrf.server';
import stylesheet from '../features/identity/registration-form.css?url';

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: stylesheet },
];

export async function loader() {
  return { csrfToken: createCsrfToken() };
}

export async function action({ request }: { request: Request }) {
  return runRegistrationAction(request);
}

export default function RegisterRoute() {
  const { csrfToken } = useLoaderData<typeof loader>();
  const actionData = useActionData() as RegistrationActionData | undefined;

  return (
    <RegistrationForm
      key={actionData?.formKey ?? 'initial'}
      csrfToken={csrfToken}
      actionData={actionData}
    />
  );
}
