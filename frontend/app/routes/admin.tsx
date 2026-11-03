import { data, useLoaderData } from 'react-router';
import { WorkspaceOverview } from '../components/workspace-overview';
import { loadWorkspaceAccess } from '../features/identity/server/workspace-access.server';

export async function loader({ request }: { request: Request }) {
  const result = await loadWorkspaceAccess(request, '/admin', 'administrator');

  if (result.state === 'redirect') return result.response;
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

  return data({ state: 'ready' as const }, { headers: result.headers });
}

export function headers({ loaderHeaders }: { loaderHeaders: Headers }) {
  const result = new Headers(loaderHeaders);
  result.set('Cache-Control', 'no-store, max-age=0');
  result.set('Pragma', 'no-cache');
  return result;
}

export default function AdministratorRoute() {
  const result = useLoaderData<typeof loader>();

  if (result.state === 'unavailable') {
    return (
      <main>
        <h1>Administrator workspace</h1>
        <p role='status'>Workspace access is temporarily unavailable.</p>
      </main>
    );
  }
  if (result.state === 'forbidden') {
    return (
      <main>
        <h1>Access denied</h1>
        <p role='status'>
          This account is not permitted to use the administrator workspace.
        </p>
      </main>
    );
  }

  return (
    <WorkspaceOverview
      title='Administrator Workspace'
      workspaceName='Administrator'
    />
  );
}
