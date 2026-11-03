import { useEffect, useRef } from 'react';
import { Form, Link, useNavigation } from 'react-router';
import type {
  RegistrationActionData,
  RegistrationField,
} from './registration.types';

interface RegistrationFormProps {
  csrfToken: string;
  actionData?: RegistrationActionData;
}

const FIELD_LABELS: Record<RegistrationField, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  password: 'Password',
  confirmPassword: 'Confirm password',
  termsAccepted: 'Development notice',
};

export function RegistrationForm({
  csrfToken,
  actionData,
}: RegistrationFormProps) {
  const summaryRef = useRef<HTMLDivElement>(null);
  const navigation = useNavigation();
  const submitting = navigation.state === 'submitting';
  const errors = actionData?.errors ?? {};
  const hasErrors = Boolean(
    actionData?.formError || Object.keys(errors).length,
  );

  useEffect(() => {
    if (hasErrors) {
      summaryRef.current?.focus();
    }
  }, [actionData, hasErrors]);

  if (actionData?.success) {
    return (
      <main>
        <h1>Registration request received</h1>
        <p>
          If this email address can be registered, follow the verification link
          if an email arrives.
        </p>
        <p>
          Need another verification email?{' '}
          <Link to='/resend-verification'>Request one</Link>
        </p>
        <p>
          Already verified? <Link to='/login'>Sign in</Link>
        </p>
      </main>
    );
  }

  return (
    <main className='registration'>
      <h1>Create your Tennis Xpress account</h1>

      <p className='registration__notice'>
        <strong>Development notice:</strong> Approved Terms and Privacy policies
        are pending. Registration is for development only; do not use real
        personal information. Verification email delivery is handled
        asynchronously.
      </p>

      {hasErrors && (
        <div
          ref={summaryRef}
          className='registration__errors'
          role='alert'
          aria-labelledby='registration-error-title'
          tabIndex={-1}
        >
          <h2 id='registration-error-title'>Please review your registration</h2>
          {actionData?.formError && <p>{actionData.formError}</p>}
          {Object.entries(errors).length > 0 && (
            <ul>
              {Object.entries(errors).map(([field, message]) => (
                <li key={field}>
                  <a href={`#${field}`}>
                    {FIELD_LABELS[field as RegistrationField]}: {message}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Form method='post' noValidate>
        <input type='hidden' name='_csrfToken' value={csrfToken} />

        <div className='registration__field'>
          <label htmlFor='firstName'>First name</label>
          <input
            id='firstName'
            name='firstName'
            autoComplete='given-name'
            required
            defaultValue={actionData?.values.firstName ?? ''}
            aria-invalid={Boolean(errors.firstName)}
            aria-describedby={errors.firstName ? 'firstName-error' : undefined}
          />
          {errors.firstName && (
            <p id='firstName-error' className='registration__field-error'>
              {errors.firstName}
            </p>
          )}
        </div>

        <div className='registration__field'>
          <label htmlFor='lastName'>Last name</label>
          <input
            id='lastName'
            name='lastName'
            autoComplete='family-name'
            required
            defaultValue={actionData?.values.lastName ?? ''}
            aria-invalid={Boolean(errors.lastName)}
            aria-describedby={errors.lastName ? 'lastName-error' : undefined}
          />
          {errors.lastName && (
            <p id='lastName-error' className='registration__field-error'>
              {errors.lastName}
            </p>
          )}
        </div>

        <div className='registration__field'>
          <label htmlFor='email'>Email</label>
          <input
            id='email'
            name='email'
            type='email'
            autoComplete='email'
            required
            defaultValue={actionData?.values.email ?? ''}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'email-error' : undefined}
          />
          {errors.email && (
            <p id='email-error' className='registration__field-error'>
              {errors.email}
            </p>
          )}
        </div>

        <div className='registration__field'>
          <label htmlFor='password'>Password</label>
          <input
            id='password'
            name='password'
            type='password'
            autoComplete='new-password'
            required
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? 'password-error' : undefined}
          />
          {errors.password && (
            <p id='password-error' className='registration__field-error'>
              {errors.password}
            </p>
          )}
        </div>

        <div className='registration__field'>
          <label htmlFor='confirmPassword'>Confirm password</label>
          <input
            id='confirmPassword'
            name='confirmPassword'
            type='password'
            autoComplete='new-password'
            required
            aria-invalid={Boolean(errors.confirmPassword)}
            aria-describedby={
              errors.confirmPassword ? 'confirmPassword-error' : undefined
            }
          />
          {errors.confirmPassword && (
            <p id='confirmPassword-error' className='registration__field-error'>
              {errors.confirmPassword}
            </p>
          )}
        </div>

        <div className='registration__field'>
          <label className='registration__checkbox' htmlFor='termsAccepted'>
            <input
              id='termsAccepted'
              name='termsAccepted'
              type='checkbox'
              required
              defaultChecked={actionData?.values.termsAccepted ?? false}
              aria-invalid={Boolean(errors.termsAccepted)}
              aria-describedby={
                errors.termsAccepted ? 'termsAccepted-error' : undefined
              }
            />
            I acknowledge the development notice above. Approved Terms and
            Privacy policies are pending.
          </label>
          {errors.termsAccepted && (
            <p id='termsAccepted-error' className='registration__field-error'>
              {errors.termsAccepted}
            </p>
          )}
        </div>

        <button type='submit' disabled={submitting}>
          {submitting ? 'Submitting…' : 'Create account'}
        </button>
      </Form>
    </main>
  );
}
