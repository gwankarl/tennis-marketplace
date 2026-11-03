import { useEffect, useRef } from 'react';
import { Form, Link, useNavigation } from 'react-router';
import type { ForgotPasswordActionData } from '../forgot-password.types';

interface ForgotPasswordFormProps {
  csrfToken: string;
  actionData?: ForgotPasswordActionData;
}

export function ForgotPasswordForm({
  csrfToken,
  actionData,
}: ForgotPasswordFormProps) {
  const summaryRef = useRef<HTMLDivElement>(null);
  const navigation = useNavigation();
  const submitting = navigation.state === 'submitting';
  const hasError = Boolean(actionData?.emailError || actionData?.formError);

  useEffect(() => {
    if (hasError) {
      summaryRef.current?.focus();
    }
  }, [actionData, hasError]);

  if (actionData?.success) {
    return (
      <main className='forgot-password'>
        <section role='status' aria-live='polite'>
          <h1>Request received</h1>
          <p>
            If an account is eligible for a password reset, instructions may be
            sent.
          </p>
          <p>
            <Link to='/login'>Return to sign in</Link>
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className='forgot-password' aria-busy={submitting}>
      <h1>Forgot your password?</h1>
      <p>Enter the email address associated with your account.</p>

      {hasError && (
        <div
          ref={summaryRef}
          className='forgot-password__errors'
          role='alert'
          aria-labelledby='forgot-password-error-title'
          tabIndex={-1}
        >
          <h2 id='forgot-password-error-title'>Please review your request</h2>
          {actionData?.formError && <p>{actionData.formError}</p>}
          {actionData?.emailError && (
            <p>
              <a href='#email'>Email: {actionData.emailError}</a>
            </p>
          )}
        </div>
      )}

      <Form
        method='post'
        action='/forgot-password'
        noValidate
        className='forgot-password__form'
      >
        <input type='hidden' name='_csrfToken' value={csrfToken} />

        <div className='forgot-password__field'>
          <label htmlFor='email'>Email</label>
          <input
            id='email'
            name='email'
            type='email'
            autoComplete='email'
            required
            defaultValue={actionData?.email ?? ''}
            aria-invalid={Boolean(actionData?.emailError)}
            aria-describedby={
              actionData?.emailError ? 'forgot-password-email-error' : undefined
            }
          />
          {actionData?.emailError && (
            <p
              id='forgot-password-email-error'
              className='forgot-password__field-error'
            >
              {actionData.emailError}
            </p>
          )}
        </div>

        <button type='submit' disabled={submitting}>
          {submitting ? 'Submitting…' : 'Send reset instructions'}
        </button>
      </Form>

      <p>
        <Link to='/login'>Return to sign in</Link>
      </p>
    </main>
  );
}
