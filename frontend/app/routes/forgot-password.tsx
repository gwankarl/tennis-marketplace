import {
  data,
  useActionData,
  useLoaderData,
  type LinksFunction,
} from 'react-router';
import { ForgotPasswordForm } from '../features/identity/components/forgot-password-form';
import { runForgotPasswordAction } from '../features/identity/server/forgot-password-action.server';
import type { ForgotPasswordActionData } from '../features/identity/forgot-password.types';
import { createCsrfToken } from '../lib/security/csrf.server';
import stylesheet from '../features/identity/components/forgot-password-form.css?url';

function noStoreHeaders(): Headers {
  return new Headers({
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer',
  });
}

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: stylesheet },
];

export async function loader() {
  return data({ csrfToken: createCsrfToken() }, { headers: noStoreHeaders() });
}

export async function action({ request }: { request: Request }) {
  const result = await runForgotPasswordAction(request);
  return data(result.data, { headers: result.headers });
}

export function headers({
  loaderHeaders,
  actionHeaders,
}: {
  loaderHeaders: Headers;
  actionHeaders: Headers;
}) {
  const responseHeaders = new Headers(loaderHeaders);

  actionHeaders.forEach((value, key) => {
    responseHeaders.set(key, value);
  });

  responseHeaders.set('Cache-Control', 'no-store, max-age=0');
  responseHeaders.set('Pragma', 'no-cache');
  responseHeaders.set('Referrer-Policy', 'no-referrer');

  return responseHeaders;
}

export function ErrorBoundary() {
  return (
    <main className='forgot-password'>
      <h1>Request unavailable</h1>
      <p>Please reload the page and try again.</p>
    </main>
  );
}

export default function ForgotPasswordRoute() {
  const { csrfToken } = useLoaderData<typeof loader>();
  const actionData = useActionData() as ForgotPasswordActionData | undefined;

  return <ForgotPasswordForm csrfToken={csrfToken} actionData={actionData} />;
}
