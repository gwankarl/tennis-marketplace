import { useEffect, useRef } from 'react';
import { Form, useNavigation } from 'react-router';
import type { ProfileActionData, UserProfile } from '../profile.types';

export function UserProfileForm({
  profile,
  csrfToken,
  actionData,
}: {
  profile: UserProfile;
  csrfToken: string;
  actionData?: ProfileActionData;
}) {
  const navigation = useNavigation();
  const summaryRef = useRef<HTMLDivElement>(null);
  const pending = navigation.state === 'submitting';
  const hasErrors = Boolean(
    actionData?.formError ||
    actionData?.firstNameError ||
    actionData?.lastNameError,
  );

  useEffect(() => {
    if (hasErrors) {
      summaryRef.current?.focus();
    }
  }, [actionData, hasErrors]);

  return (
    <main className='user-profile'>
      <h1>User Profile</h1>

      {actionData?.success && (
        <p role='status'>Your profile has been updated.</p>
      )}

      {hasErrors && (
        <div
          ref={summaryRef}
          className='user-profile__errors'
          role='alert'
          aria-labelledby='profile-error-title'
          tabIndex={-1}
        >
          <h2 id='profile-error-title'>There is a problem</h2>
          {actionData?.formError && <p>{actionData.formError}</p>}
          {actionData?.firstNameError && (
            <p>
              <a href='#firstName'>First name: {actionData.firstNameError}</a>
            </p>
          )}
          {actionData?.lastNameError && (
            <p>
              <a href='#lastName'>Last name: {actionData.lastNameError}</a>
            </p>
          )}
        </div>
      )}

      <dl>
        <dt>Email</dt>
        <dd>{profile.email}</dd>
        <dt>Email verification</dt>
        <dd>{profile.emailVerified ? 'Verified' : 'Not verified'}</dd>
        <dt>Account created</dt>
        <dd>{profile.createdAt.slice(0, 10)}</dd>
      </dl>

      <Form method='post' noValidate>
        <input type='hidden' name='_csrfToken' value={csrfToken} />

        <div className='user-profile__field'>
          <label htmlFor='firstName'>First name</label>
          <input
            id='firstName'
            name='firstName'
            type='text'
            autoComplete='given-name'
            required
            defaultValue={actionData?.firstName ?? profile.firstName}
            aria-invalid={Boolean(actionData?.firstNameError)}
            aria-describedby={
              actionData?.firstNameError ? 'firstName-error' : undefined
            }
          />
          {actionData?.firstNameError && (
            <p id='firstName-error' className='user-profile__field-error'>
              {actionData.firstNameError}
            </p>
          )}
        </div>

        <div className='user-profile__field'>
          <label htmlFor='lastName'>Last name</label>
          <input
            id='lastName'
            name='lastName'
            type='text'
            autoComplete='family-name'
            required
            defaultValue={actionData?.lastName ?? profile.lastName}
            aria-invalid={Boolean(actionData?.lastNameError)}
            aria-describedby={
              actionData?.lastNameError ? 'lastName-error' : undefined
            }
          />
          {actionData?.lastNameError && (
            <p id='lastName-error' className='user-profile__field-error'>
              {actionData.lastNameError}
            </p>
          )}
        </div>

        <button type='submit' disabled={pending}>
          {pending ? 'Saving…' : 'Save profile'}
        </button>
      </Form>
    </main>
  );
}
