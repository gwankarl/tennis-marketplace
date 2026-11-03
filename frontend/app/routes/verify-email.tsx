import {
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from 'react-router';
import type { LinksFunction } from 'react-router';
import { EmailVerificationPage } from '../features/identity/components/email-verification-page';
import {
  loadEmailVerificationPage,
  submitEmailVerification,
  type VerificationActionData,
  type VerificationLoaderData,
} from '../features/identity/server/email-verification-flow.server';
import stylesheet from '../features/identity/components/email-verification-page.css?url';
import { createCsrfToken } from '../lib/security/csrf.server';

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: stylesheet },
];

export async function loader({ request }: { request: Request }) {
  const result = loadEmailVerificationPage(request);

  if (result.redirectTo) {
    return redirect(result.redirectTo, { headers: result.headers });
  }

  return data(result.data, { headers: result.headers });
}

export async function action({ request }: { request: Request }) {
  const csrfToken = createCsrfToken();
  const result = await submitEmailVerification(request, csrfToken);

  return data(result.data, { headers: result.headers });
}

/** Retain staging-cookie headers while enforcing privacy headers on all states. */
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
  responseHeaders.set('Referrer-Policy', 'strict-origin');

  return responseHeaders;
}

export function ErrorBoundary() {
  return (
    <main className='email-verification'>
      <h1>Confirmation unavailable</h1>
      <p>Reopen the verification link from your email and try again.</p>
    </main>
  );
}

export default function VerifyEmailRoute() {
  const loaderData = useLoaderData() as VerificationLoaderData;
  const actionData = useActionData() as VerificationActionData | undefined;
  const navigation = useNavigation();

  return (
    <EmailVerificationPage
      csrfToken={loaderData.csrfToken}
      pageState={loaderData.state}
      actionData={actionData}
      pending={navigation.state === 'submitting'}
    />
  );
}
