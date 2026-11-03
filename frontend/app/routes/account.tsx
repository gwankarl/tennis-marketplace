import { data, redirect, useActionData, useLoaderData } from 'react-router';
import {
  BuyerOverview,
  BuyerOverviewUnavailable,
} from '../features/identity/components/buyer-overview';
import {
  runLogoutAction,
  type LogoutActionData,
} from '../features/identity/server/logout-action.server';
import { loadCurrentSession } from '../lib/security/auth-session.server';
import { createSessionCsrfToken } from '../lib/security/csrf.server';
import {
  clearSessionCookie,
  readSessionCredential,
} from '../lib/security/session-cookie.server';

function privateHeaders(): Headers {
  return new Headers({
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
  });
}

export async function loader({ request }: { request: Request }) {
  const cookieHeader = request.headers.get('cookie');
  const session = await loadCurrentSession(cookieHeader);

  if (session.kind === 'anonymous') {
    return redirect('/login?returnTo=/account', {
      headers: privateHeaders(),
    });
  }

  if (session.kind === 'unauthenticated') {
    const headers = privateHeaders();
    headers.append('Set-Cookie', clearSessionCookie());

    return redirect('/login?returnTo=/account', { headers });
  }

  if (session.kind === 'unavailable') {
    return data(
      { state: 'unavailable' as const },
      { status: 503, headers: privateHeaders() },
    );
  }

  const credential = readSessionCredential(cookieHeader);

  if (!credential) {
    const headers = privateHeaders();
    headers.append('Set-Cookie', clearSessionCookie());

    return redirect('/login?returnTo=/account', { headers });
  }

  return data(
    {
      state: 'authenticated' as const,
      user: session.user,
      csrfToken: createSessionCsrfToken(credential),
    },
    { headers: privateHeaders() },
  );
}

export async function action({ request }: { request: Request }) {
  const result = await runLogoutAction(request);

  if (result.redirectTo) {
    return redirect(result.redirectTo, { headers: result.headers });
  }

  return data(result.data ?? {}, { headers: result.headers });
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
  return <BuyerOverviewUnavailable />;
}

export default function AccountRoute() {
  const result = useLoaderData<typeof loader>();
  const actionData = useActionData() as LogoutActionData | undefined;

  return result.state === 'authenticated' ? (
    <BuyerOverview
      user={result.user}
      csrfToken={result.csrfToken}
      logoutError={actionData?.formError}
    />
  ) : (
    <BuyerOverviewUnavailable />
  );
}
