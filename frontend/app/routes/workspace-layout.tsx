import { data, Outlet, useLoaderData } from 'react-router';
import type { LinksFunction } from 'react-router';
import { WorkspaceShell } from '../components/workspace-shell';
import stylesheet from '../components/workspace-shell.css?url';
import { loadWorkspaceAccess } from '../features/identity/server/workspace-access.server';

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: stylesheet },
];

export async function loader({ request }: { request: Request }) {
  const result = await loadWorkspaceAccess(request, '/account');

  if (result.state === 'redirect') {
    return result.response;
  }

  if (result.state === 'unavailable') {
    return data(
      { state: 'unavailable' as const },
      { status: 503, headers: result.headers },
    );
  }

  if (result.state === 'forbidden') {
    return data(
      { state: 'forbidden' as const },
      { status: 403, headers: result.headers },
    );
  }

  return data(
    {
      state: 'ready' as const,
      user: result.user,
      csrfToken: result.csrfToken,
    },
    { headers: result.headers },
  );
}

export function headers({ loaderHeaders }: { loaderHeaders: Headers }) {
  const responseHeaders = new Headers(loaderHeaders);
  responseHeaders.set('Cache-Control', 'no-store, max-age=0');
  responseHeaders.set('Pragma', 'no-cache');
  return responseHeaders;
}

export default function WorkspaceLayoutRoute() {
  const result = useLoaderData<typeof loader>();

  if (result.state === 'unavailable') {
    return (
      <main>
        <h1>Workspace temporarily unavailable</h1>
        <p role='status'>
          We could not confirm your session. Please try again shortly.
        </p>
      </main>
    );
  }

  if (result.state !== 'ready') {
    return (
      <main>
        <h1>Workspace unavailable</h1>
        <p role='status'>This workspace is not available to this account.</p>
      </main>
    );
  }

  return (
    <WorkspaceShell user={result.user} csrfToken={result.csrfToken}>
      <Outlet />
    </WorkspaceShell>
  );
}

export function ErrorBoundary() {
  return (
    <main>
      <h1>Workspace temporarily unavailable</h1>
      <p>Please try again shortly.</p>
    </main>
  );
}
