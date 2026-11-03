import { Form, useNavigation } from 'react-router';
import type { SessionUser } from '../../lib/auth-session.server';

export function BuyerOverview({
  user,
  csrfToken,
  logoutError,
}: {
  user: SessionUser;
  csrfToken: string;
  logoutError?: string;
}) {
  const navigation = useNavigation();
  const signingOut = navigation.state === 'submitting';

  return (
    <main>
      <h1>Your Tennis Xpress account</h1>
      <p>Welcome, {user.firstName}.</p>
      <p>You are signed in as {user.email}.</p>

      {logoutError && <p role='alert'>{logoutError}</p>}

      <Form method='post'>
        <input type='hidden' name='_csrfToken' value={csrfToken} />
        <button type='submit' disabled={signingOut}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </Form>
    </main>
  );
}

export function BuyerOverviewUnavailable() {
  return (
    <main>
      <h1>Account temporarily unavailable</h1>
      <p>
        We could not confirm your session right now. Please try again shortly.
      </p>
    </main>
  );
}
