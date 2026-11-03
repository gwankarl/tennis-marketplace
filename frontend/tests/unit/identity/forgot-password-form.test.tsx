import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ForgotPasswordForm } from '../../../app/features/identity/components/forgot-password-form';
import type { ForgotPasswordActionData } from '../../../app/features/identity/forgot-password.types';

function renderForm(actionData?: ForgotPasswordActionData) {
  const router = createMemoryRouter(
    [
      {
        path: '/forgot-password',
        element: (
          <ForgotPasswordForm
            csrfToken='test-csrf-token'
            actionData={actionData}
          />
        ),
      },
    ],
    { initialEntries: ['/forgot-password'] },
  );

  return render(<RouterProvider router={router} />);
}

describe('ForgotPasswordForm', () => {
  it('renders an accessible email form without password fields', () => {
    renderForm();

    expect(
      screen.getByRole('heading', { name: 'Forgot your password?' }),
    ).toBeInTheDocument();

    const email = screen.getByLabelText('Email');
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('autocomplete', 'email');
    expect(email).toBeRequired();

    expect(document.querySelector('input[name="_csrfToken"]')).toHaveValue(
      'test-csrf-token',
    );
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it('links and focuses the field-error summary', async () => {
    renderForm({
      email: 'invalid-email',
      emailError: 'Enter a valid email address.',
      formError: 'Please review the request.',
    });

    const email = screen.getByLabelText('Email');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAttribute(
      'aria-describedby',
      'forgot-password-email-error',
    );
    expect(
      screen.getByText('Enter a valid email address.'),
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(
        screen.getByRole('alert', { name: 'Please review your request' }),
      ).toHaveFocus(),
    );
  });

  it('shows the generic acknowledgement and a sign-in link', () => {
    renderForm({ email: '', success: true });

    expect(
      screen.getByRole('heading', { name: 'Request received' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'If an account is eligible for a password reset, instructions may be sent.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Return to sign in' }),
    ).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
