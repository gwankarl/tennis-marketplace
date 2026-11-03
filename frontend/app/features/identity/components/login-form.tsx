import { useEffect, useRef } from 'react';
import { Form, Link, useNavigation } from 'react-router';
import type { LoginActionData } from '../login.types';

interface LoginFormProps {
  csrfToken: string;
  returnTo: string;
  actionData?: LoginActionData;
  logoutNotice?: string;
}

export function LoginForm({
  csrfToken,
  returnTo,
  actionData,
  logoutNotice,
}: LoginFormProps) {
  const summaryRef = useRef<HTMLDivElement>(null);
  const navigation = useNavigation();
  const submitting = navigation.state === 'submitting';
  const hasErrors = Boolean(
    actionData?.formError ||
    actionData?.emailError ||
    actionData?.passwordError,
  );

  useEffect(() => {
    if (hasErrors) {
      summaryRef.current?.focus();
    }
  }, [actionData, hasErrors]);

  return (
    <main className='login'>
      <h1>Sign in to Tennis Xpress</h1>

      {logoutNotice && <p role='status'>{logoutNotice}</p>}

      {hasErrors && (
        <div
          ref={summaryRef}
          className='login__errors'
          role='alert'
          aria-labelledby='login-error-title'
          tabIndex={-1}
        >
          <h2 id='login-error-title'>Sign-in problem</h2>
          {actionData?.formError && <p>{actionData.formError}</p>}
          {actionData?.emailError && (
            <p>
              <a href='#email'>Email: {actionData.emailError}</a>
            </p>
          )}
          {actionData?.passwordError && (
            <p>
              <a href='#password'>Password: {actionData.passwordError}</a>
            </p>
          )}
          {actionData?.needsVerification && (
            <p>
              <Link to='/resend-verification'>
                Request another verification email
              </Link>
            </p>
          )}
        </div>
      )}

      <Form method='post' noValidate>
        <input type='hidden' name='_csrfToken' value={csrfToken} />
        <input type='hidden' name='_returnTo' value={returnTo} />

        <div className='login__field'>
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
              actionData?.emailError ? 'email-error' : undefined
            }
          />
          {actionData?.emailError && (
            <p id='email-error' className='login__field-error'>
              {actionData.emailError}
            </p>
          )}
        </div>

        <div className='login__field'>
          <label htmlFor='password'>Password</label>
          <input
            id='password'
            name='password'
            type='password'
            autoComplete='current-password'
            required
            aria-invalid={Boolean(actionData?.passwordError)}
            aria-describedby={
              actionData?.passwordError ? 'password-error' : undefined
            }
          />
          {actionData?.passwordError && (
            <p id='password-error' className='login__field-error'>
              {actionData.passwordError}
            </p>
          )}
        </div>

        <button type='submit' disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </Form>

      <p>
        Need an account? <Link to='/register'>Create one</Link>
      </p>
    </main>
  );
}
