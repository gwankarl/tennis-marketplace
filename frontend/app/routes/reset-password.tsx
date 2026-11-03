import {
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type LinksFunction,
} from 'react-router';
import { PasswordResetForm } from '../features/identity/components/password-reset-form';
import {
  loadPasswordResetPage,
  submitPasswordReset,
} from '../features/identity/server/password-reset-flow.server';
import type {
  PasswordResetActionData,
  PasswordResetLoaderData,
} from '../features/identity/password-reset.types';
import stylesheet from '../features/identity/components/password-reset-form.css?url';

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: stylesheet },
];

export async function loader({ request }: { request: Request }) {
  const result = loadPasswordResetPage(request);

  if (result.redirectTo) {
    return redirect(result.redirectTo, { headers: result.headers });
  }

  return data(result.data, { headers: result.headers });
}

export async function action({ request }: { request: Request }) {
  const result = await submitPasswordReset(request);
  return data(result.data, { headers: result.headers });
}

/**
 * Retain the two independent Set-Cookie values on successful reset while
 * enforcing privacy headers on loader, action, redirect, and error responses.
 */
export function headers({
  loaderHeaders,
  actionHeaders,
}: {
  loaderHeaders: Headers;
  actionHeaders: Headers;
}) {
  const responseHeaders = new Headers();

  const copyHeaders = (source: Headers) => {
    const getSetCookie = (source as Headers & { getSetCookie?: () => string[] })
      .getSetCookie;
    const cookies = getSetCookie?.call(source) ?? [];

    source.forEach((value, key) => {
      if (key.toLowerCase() !== 'set-cookie') {
        responseHeaders.set(key, value);
      }
    });

    if (cookies.length > 0) {
      for (const cookie of cookies) {
        responseHeaders.append('Set-Cookie', cookie);
      }
    } else {
      const cookie = source.get('set-cookie');
      if (cookie) {
        responseHeaders.append('Set-Cookie', cookie);
      }
    }
  };

  copyHeaders(loaderHeaders);
  copyHeaders(actionHeaders);

  responseHeaders.set('Cache-Control', 'no-store, max-age=0');
  responseHeaders.set('Pragma', 'no-cache');
  responseHeaders.set('Referrer-Policy', 'no-referrer');

  return responseHeaders;
}

export function ErrorBoundary() {
  return (
    <main className='password-reset'>
      <h1>Password reset unavailable</h1>
      <p>Reopen the reset link from your email and try again.</p>
    </main>
  );
}

export default function ResetPasswordRoute() {
  const loaderData = useLoaderData<typeof loader>() as PasswordResetLoaderData;
  const actionData = useActionData() as PasswordResetActionData | undefined;
  const navigation = useNavigation();

  return (
    <PasswordResetForm
      csrfToken={loaderData.csrfToken}
      pageState={loaderData.state}
      actionData={actionData}
      pending={navigation.state === 'submitting'}
    />
  );
}
