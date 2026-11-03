import { data, redirect, useActionData, useLoaderData } from 'react-router';
import type { LinksFunction } from 'react-router';
import { UserProfileForm } from '../features/identity/components/user-profile-form';
import stylesheet from '../features/identity/components/user-profile-form.css?url';
import {
  loadUserProfile,
  runProfileAction,
} from '../features/identity/server/profile-action.server';
import type {
  ProfileActionData,
  ProfileLoaderData,
} from '../features/identity/profile.types';

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: stylesheet },
];

export async function loader({ request }: { request: Request }) {
  const result = await loadUserProfile(request);

  if (result.redirectTo) {
    return redirect(result.redirectTo, { headers: result.headers });
  }

  return data(result.data!, { headers: result.headers });
}

export async function action({ request }: { request: Request }) {
  const result = await runProfileAction(request);

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
    <main>
      <h1>User Profile unavailable</h1>
      <p>Your profile could not be loaded. Please try again later.</p>
    </main>
  );
}

export default function ProfileRoute() {
  const loaderData = useLoaderData() as ProfileLoaderData;
  const actionData = useActionData() as ProfileActionData | undefined;

  if (loaderData.state === 'unavailable') {
    return (
      <main>
        <h1>User Profile</h1>
        <p role='status'>{loaderData.message}</p>
      </main>
    );
  }

  return (
    <UserProfileForm
      profile={loaderData.profile}
      csrfToken={loaderData.csrfToken}
      actionData={actionData}
    />
  );
}
