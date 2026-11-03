import { useEffect, useRef } from 'react';
import { Link, useFetcher } from 'react-router';
import type {
  PasswordResetActionData,
  PasswordResetLoaderData,
} from '../password-reset.types';
import './password-reset-form.css';

interface PasswordResetFormProps {
  csrfToken: string;
  pageState: PasswordResetLoaderData['state'];
  actionData?: PasswordResetActionData;
  pending?: boolean;
}

export function PasswordResetForm({
  csrfToken,
  pageState,
  actionData: initialActionData,
  pending = false,
}: PasswordResetFormProps) {
  const summaryRef = useRef<HTMLDivElement>(null);
  const fetcher = useFetcher<PasswordResetActionData>();
  const actionData = fetcher.data ?? initialActionData;
  const submitting = pending || fetcher.state === 'submitting';
  const state = actionData?.state ?? pageState;
  const hasErrors = Boolean(
    actionData?.formError ||
    actionData?.passwordError ||
    actionData?.confirmPasswordError,
  );

  useEffect(() => {
    if (hasErrors) {
      summaryRef.current?.focus();
    }
  }, [actionData, hasErrors]);

  if (state === 'success') {
    return (
      <main className='password-reset'>
        <section role='status' aria-live='polite'>
          <h1>Password reset complete</h1>
          <p>Your password has been changed. Sign in with your new password.</p>
          <p>
            <Link to='/login'>Sign in</Link>
          </p>
        </section>
      </main>
    );
  }

  if (state === 'missing') {
    return (
      <main className='password-reset'>
        <section role='status'>
          <h1>Password reset link required</h1>
          <p>Open the password reset link from your email to continue.</p>
          <p>
            <Link to='/forgot-password'>Request reset instructions</Link>
          </p>
        </section>
      </main>
    );
  }

  if (state === 'invalid') {
    return (
      <main className='password-reset'>
        <section role='alert'>
          <h1>Password reset link unavailable</h1>
          <p>This link is invalid, expired, or has already been used.</p>
          <p>
            <Link to='/forgot-password'>Request new reset instructions</Link>
          </p>
        </section>
      </main>
    );
  }

  if (state === 'csrf-failure') {
    return (
      <main className='password-reset'>
        <section role='alert'>
          <h1>Reset form expired</h1>
          <p>Reload the reset page and try again.</p>
          <p>
            <a href='/reset-password'>Reload reset form</a>
          </p>
        </section>
      </main>
    );
  }

  const canSubmit =
    pageState === 'ready' &&
    (state === 'ready' ||
      state === 'validation-error' ||
      state === 'rate-limited' ||
      state === 'temporary-failure');

  return (
    <main className='password-reset' aria-busy={submitting}>
      <h1>Choose a new password</h1>
      <p>Use a password between 15 and 128 characters.</p>

      {hasErrors && (
        <div
          ref={summaryRef}
          className='password-reset__errors'
          role='alert'
          aria-labelledby='password-reset-error-title'
          tabIndex={-1}
        >
          <h2 id='password-reset-error-title'>Please review your password</h2>
          {actionData?.formError && <p>{actionData.formError}</p>}
          {actionData?.passwordError && (
            <p>
              <a href='#password'>Password: {actionData.passwordError}</a>
            </p>
          )}
          {actionData?.confirmPasswordError && (
            <p>
              <a href='#confirmPassword'>
                Confirm password: {actionData.confirmPasswordError}
              </a>
            </p>
          )}
        </div>
      )}

      {canSubmit && (
        <fetcher.Form
          method='post'
          action='/reset-password/submit'
          noValidate
          className='password-reset__form'
        >
          <input type='hidden' name='_csrfToken' value={csrfToken} />

          {submitting && (
            <p role='status' aria-live='polite'>
              Resetting your password…
            </p>
          )}

          <div className='password-reset__field'>
            <label htmlFor='password'>New password</label>
            <input
              id='password'
              name='password'
              type='password'
              autoComplete='new-password'
              required
              aria-invalid={Boolean(actionData?.passwordError)}
              aria-describedby={
                actionData?.passwordError ? 'password-error' : undefined
              }
            />
            {actionData?.passwordError && (
              <p id='password-error' className='password-reset__field-error'>
                {actionData.passwordError}
              </p>
            )}
          </div>

          <div className='password-reset__field'>
            <label htmlFor='confirmPassword'>Confirm new password</label>
            <input
              id='confirmPassword'
              name='confirmPassword'
              type='password'
              autoComplete='new-password'
              required
              aria-invalid={Boolean(actionData?.confirmPasswordError)}
              aria-describedby={
                actionData?.confirmPasswordError
                  ? 'confirm-password-error'
                  : undefined
              }
            />
            {actionData?.confirmPasswordError && (
              <p
                id='confirm-password-error'
                className='password-reset__field-error'
              >
                {actionData.confirmPasswordError}
              </p>
            )}
          </div>

          <button type='submit' disabled={submitting}>
            {submitting ? 'Resetting…' : 'Reset password'}
          </button>
        </fetcher.Form>
      )}

      {(state === 'rate-limited' || state === 'temporary-failure') && (
        <p>
          <Link to='/forgot-password'>Request reset instructions</Link>
        </p>
      )}
    </main>
  );
}
