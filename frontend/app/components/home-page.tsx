import type { ApiConnectionStatus } from '../lib/api-health.server';

interface HomePageProps {
  apiStatus: ApiConnectionStatus;
}

export function HomePage({ apiStatus }: HomePageProps) {
  const statusText = apiStatus === 'available' ? 'Available' : 'Unavailable';

  return (
    <main>
      <h1>Tennis Xpress</h1>
      <p>
        Development placeholder — the application foundation is being built.
      </p>
      <p aria-live='polite'>API connection: {statusText}</p>
    </main>
  );
}
