import { Form, Link } from 'react-router';
import type {
  VerificationActionData,
  VerificationPageState,
} from './email-verification-flow.server';
import './email-verification-page.css';

interface EmailVerificationPageProps {
  csrfToken: string;
  pageState: VerificationPageState;
  actionData?: VerificationActionData;
  pending: boolean;
}

export function EmailVerificationPage({
  csrfToken,
  pageState,
  actionData,
  pending,
}: EmailVerificationPageProps) {
  const state = actionData?.state ?? pageState;
  const canSubmit = state === 'ready' || state === 'temporary-failure';

  return (
    <main className='email-verification' aria-busy={pending}>
      {state === 'success' && (
        <section role='status' aria-live='polite'>
          <h1>Email verified</h1>
          <p>Your email address is verified.</p>
          <p>
            <Link to='/login'>Sign in</Link>
          </p>
        </section>
      )}

      {state === 'ready' && (
        <>
          <h1>Confirm your email address</h1>
          <p>Submit this form to verify your email address.</p>
        </>
      )}

      {state === 'missing' && (
        <section role='status'>
          <h1>Verification link required</h1>
          <p>Open the verification link from your email to continue.</p>
        </section>
      )}

      {state === 'invalid' && (
        <section role='alert'>
          <h1>Verification link unavailable</h1>
          <p>This link is invalid, expired, or has already been used.</p>
        </section>
      )}

      {state === 'csrf-failure' && (
        <section role='alert'>
          <h1>Confirmation form expired</h1>
          <p>Reopen the verification link from your email and try again.</p>
        </section>
      )}

      {state === 'temporary-failure' && (
        <section role='alert'>
          <h1>Verification temporarily unavailable</h1>
          <p>Please try again shortly.</p>
        </section>
      )}

      {canSubmit && (
        <Form method='post' action='/verify-email' reloadDocument>
          <input type='hidden' name='_csrfToken' value={csrfToken} />
          {pending && (
            <p role='status' aria-live='polite'>
              Verifying your email address…
            </p>
          )}
          <button type='submit' disabled={pending}>
            {pending ? 'Verifying…' : 'Verify email'}
          </button>
        </Form>
      )}
      {(state === 'missing' ||
        state === 'invalid' ||
        state === 'temporary-failure') && (
        <p>
          Need another verification email?{' '}
          <Link to='/resend-verification'>Request one</Link>
        </p>
      )}
    </main>
  );
}
