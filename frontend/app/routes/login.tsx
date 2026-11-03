import { data, redirect, useActionData, useLoaderData } from 'react-router';
import type { LinksFunction } from 'react-router';
import { LoginForm } from '../features/identity/components/login-form';
import {
  runLoginAction,
  type LoginActionResult,
} from '../features/identity/server/login-action.server';
import type { LoginActionData } from '../features/identity/login.types';
import { createCsrfToken } from '../lib/security/csrf.server';
import { returnToFromRequestUrl } from '../lib/security/return-to.server';
import stylesheet from '../features/identity/components/login-form.css?url';

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: stylesheet },
];

export async function loader({ request }: { request: Request }) {
  return data(
    {
      csrfToken: createCsrfToken(),
      returnTo: returnToFromRequestUrl(request.url),
      logoutNotice:
        new URL(request.url).searchParams.get('logout') === 'success'
          ? 'You have signed out.'
          : new URL(request.url).searchParams.get('logout') === 'unconfirmed'
            ? 'This browser has been signed out, but server-side session revocation could not be confirmed.'
            : undefined,
    },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        Pragma: 'no-cache',
      },
    },
  );
}

export async function action({ request }: { request: Request }) {
  const result: LoginActionResult = await runLoginAction(request);

  if (result.redirectTo) {
    return redirect(result.redirectTo, { headers: result.headers });
  }

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

  return responseHeaders;
}

export function ErrorBoundary() {
  return (
    <main className='login'>
      <h1>Sign-in unavailable</h1>
      <p>Please reload the page and try again.</p>
    </main>
  );
}

export default function LoginRoute() {
  const { csrfToken, returnTo, logoutNotice } = useLoaderData<typeof loader>();
  const actionData = useActionData() as LoginActionData | undefined;

  return (
    <LoginForm
      csrfToken={csrfToken}
      returnTo={returnTo}
      logoutNotice={logoutNotice}
      actionData={actionData}
    />
  );
}
