import { data, redirect, useActionData, useLoaderData } from 'react-router';
import type { LinksFunction } from 'react-router';
import { SellerApplicationDraftForm } from '../features/seller-onboarding/components/seller-application-draft-form';
import stylesheet from '../features/seller-onboarding/components/seller-application-draft-form.css?url';
import {
  loadSellerApplicationDraft,
  runSellerApplicationAction,
} from '../features/seller-onboarding/server/seller-application.server';
import type {
  SellerApplicationActionData,
  SellerApplicationLoaderData,
} from '../features/seller-onboarding/seller-application.types';

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: stylesheet },
];

export async function loader({ request }: { request: Request }) {
  const result = await loadSellerApplicationDraft(request);

  if (result.response) return result.response;
  if (result.redirectTo) {
    return redirect(result.redirectTo, { headers: result.headers });
  }

  return data(result.data!, {
    headers: result.headers,
    ...(result.status ? { status: result.status } : {}),
  });
}

export async function action({ request }: { request: Request }) {
  const result = await runSellerApplicationAction(request);

  if (result.response) return result.response;
  if (result.redirectTo) {
    return redirect(result.redirectTo, { headers: result.headers });
  }

  return data(result.data!, {
    headers: result.headers,
    ...(result.status ? { status: result.status } : {}),
  });
}

export function headers({
  loaderHeaders,
  actionHeaders,
}: {
  loaderHeaders: Headers;
  actionHeaders: Headers;
}) {
  const responseHeaders = new Headers(loaderHeaders);

  actionHeaders.forEach((value, key) => responseHeaders.set(key, value));
  responseHeaders.set('Cache-Control', 'no-store, max-age=0');
  responseHeaders.set('Pragma', 'no-cache');

  return responseHeaders;
}

export function ErrorBoundary() {
  return (
    <main>
      <h1>Seller application unavailable</h1>
      <p>Please try again later.</p>
    </main>
  );
}

export default function SellerApplicationRoute() {
  const loaderData = useLoaderData() as SellerApplicationLoaderData;
  const actionData = useActionData() as SellerApplicationActionData | undefined;

  if (loaderData.state !== 'ready') {
    return (
      <main>
        <h1>Seller application</h1>
        <p role='status'>{loaderData.message}</p>
      </main>
    );
  }

  return (
    <SellerApplicationDraftForm
      application={actionData?.application ?? loaderData.application}
      csrfToken={loaderData.csrfToken}
      actionData={actionData}
    />
  );
}
