import { useEffect, useRef } from 'react';
import { Form, useNavigation } from 'react-router';
import type { ResendVerificationActionData } from './resend-verification.types';
import './resend-verification-form.css';

interface ResendVerificationFormProps {
  csrfToken: string;
  actionData?: ResendVerificationActionData;
}

export function ResendVerificationForm({
  csrfToken,
  actionData,
}: ResendVerificationFormProps) {
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
      <main className='resend-verification'>
        <section role='status' aria-live='polite'>
          <h1>Request received</h1>
          <p>If an account needs verification, instructions may be sent.</p>
        </section>
      </main>
    );
  }

  return (
    <main className='resend-verification' aria-busy={submitting}>
      <h1>Request another verification email</h1>
      <p>Enter the email address used to register.</p>

      {hasError && (
        <div
          ref={summaryRef}
          className='resend-verification__errors'
          role='alert'
          aria-labelledby='resend-verification-error-title'
          tabIndex={-1}
        >
          <h2 id='resend-verification-error-title'>
            Please review your request
          </h2>
          {actionData?.formError && <p>{actionData.formError}</p>}
          {actionData?.emailError && (
            <p>
              <a href='#resend-email'>Email: {actionData.emailError}</a>
            </p>
          )}
        </div>
      )}

      <Form
        method='post'
        action='/resend-verification'
        noValidate
        className='resend-verification__form'
      >
        <input type='hidden' name='_csrfToken' value={csrfToken} />

        <div className='resend-verification__field'>
          <label htmlFor='resend-email'>Email</label>
          <input
            id='resend-email'
            name='email'
            type='email'
            autoComplete='email'
            required
            defaultValue={actionData?.email ?? ''}
            aria-invalid={Boolean(actionData?.emailError)}
            aria-describedby={
              actionData?.emailError ? 'resend-email-error' : undefined
            }
          />
          {actionData?.emailError && (
            <p
              id='resend-email-error'
              className='resend-verification__field-error'
            >
              {actionData.emailError}
            </p>
          )}
        </div>

        <button type='submit' disabled={submitting}>
          {submitting ? 'Sending…' : 'Send verification email'}
        </button>
      </Form>
    </main>
  );
}
