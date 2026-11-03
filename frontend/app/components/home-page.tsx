import { Link } from 'react-router';
import type { ApiConnectionStatus } from '../lib/api-health.server';

interface HomePageProps {
  apiStatus: ApiConnectionStatus;
}

export function HomePage({ apiStatus }: HomePageProps) {
  const statusText = apiStatus === 'available' ? 'Available' : 'Unavailable';

  return (
    <main>
      <h1>Tennis Xpress</h1>
      <p>Sign in or create an account to get started.</p>
      <p>
        <Link to='/login'>Sign in</Link>
      </p>
      <p>
        <Link to='/register'>Create an account</Link>
      </p>
      <p aria-live='polite'>API connection: {statusText}</p>
    </main>
  );
}
