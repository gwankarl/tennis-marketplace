import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { PasswordResetForm } from '../../../app/features/identity/components/password-reset-form';
import type {
  PasswordResetActionData,
  PasswordResetLoaderData,
} from '../../../app/features/identity/password-reset.types';

function renderForm(
  pageState: PasswordResetLoaderData['state'] = 'ready',
  actionData?: PasswordResetActionData,
  pending = false,
) {
  const router = createMemoryRouter(
    [
      {
        path: '/reset-password',
        element: (
          <PasswordResetForm
            csrfToken='test-csrf-token'
            pageState={pageState}
            actionData={actionData}
            pending={pending}
          />
        ),
      },
    ],
    { initialEntries: ['/reset-password'] },
  );

  return render(<RouterProvider router={router} />);
}

describe('PasswordResetForm', () => {
  it('renders accessible password fields without exposing a token', () => {
    renderForm();

    expect(
      screen.getByRole('heading', { name: 'Choose a new password' }),
    ).toBeInTheDocument();

    expect(screen.getByLabelText('New password')).toHaveAttribute(
      'autocomplete',
      'new-password',
    );
    expect(screen.getByLabelText('Confirm new password')).toBeRequired();
    expect(document.querySelector('input[name="token"]')).toBeNull();
    expect(document.querySelector('input[name="_csrfToken"]')).toHaveValue(
      'test-csrf-token',
    );
    expect(document.querySelector('form')).toHaveAttribute(
      'action',
      '/reset-password/submit',
    );
  });

  it('shows linked field errors and focuses the error summary without repopulating passwords', async () => {
    renderForm('ready', {
      state: 'validation-error',
      passwordError: 'Choose a different password.',
      confirmPasswordError: 'Passwords do not match.',
    });

    expect(screen.getByLabelText('New password')).toHaveAttribute(
      'aria-describedby',
      'password-error',
    );
    expect(screen.getByLabelText('Confirm new password')).toHaveAttribute(
      'aria-describedby',
      'confirm-password-error',
    );
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm new password')).toHaveValue('');

    await waitFor(() =>
      expect(
        screen.getByRole('alert', { name: 'Please review your password' }),
      ).toHaveFocus(),
    );
  });

  it('shows a safe missing-link state and a forgot-password link', () => {
    renderForm('missing');

    expect(
      screen.getByRole('heading', { name: 'Password reset link required' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Request reset instructions' }),
    ).toHaveAttribute('href', '/forgot-password');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the same safe unavailable state for an invalid link', () => {
    renderForm('invalid');

    expect(
      screen.getByRole('heading', { name: 'Password reset link unavailable' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/invalid, expired, or has already been used/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows success and a sign-in link without rendering the form', () => {
    renderForm('ready', { state: 'success' });

    expect(
      screen.getByRole('heading', { name: 'Password reset complete' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each([
    ['rate-limited', 'Too many attempts. Please wait and try again later.'],
    [
      'temporary-failure',
      'We could not reset your password. Please try again later.',
    ],
  ] as const)('keeps the form available after %s', (state, formError) => {
    renderForm('ready', { state, formError });

    expect(screen.getByRole('alert')).toHaveTextContent(formError);
    expect(
      screen.getByRole('button', { name: 'Reset password' }),
    ).toBeEnabled();
  });

  it('announces pending submission and prevents a duplicate submission', () => {
    renderForm('ready', undefined, true);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Resetting your password…',
    );
    expect(screen.getByRole('button', { name: 'Resetting…' })).toBeDisabled();
  });

  it('asks the user to reload after a CSRF failure', () => {
    renderForm('ready', {
      state: 'csrf-failure',
      formError: 'Your form expired. Reload the page and try again.',
    });

    expect(
      screen.getByRole('heading', { name: 'Reset form expired' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Reload reset form' }),
    ).toHaveAttribute('href', '/reset-password');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
