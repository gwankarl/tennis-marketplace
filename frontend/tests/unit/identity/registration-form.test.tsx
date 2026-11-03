import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { RegistrationForm } from '../../../app/features/identity/components/registration-form';
import type { RegistrationActionData } from '../../../app/features/identity/registration.types';

function renderForm(actionData?: RegistrationActionData) {
  const router = createMemoryRouter(
    [
      {
        path: '/register',
        element: (
          <RegistrationForm
            csrfToken='test-csrf-token'
            actionData={actionData}
          />
        ),
      },
    ],
    { initialEntries: ['/register'] },
  );

  return render(<RouterProvider router={router} />);
}

const values = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.test',
  termsAccepted: true,
};

describe('RegistrationForm', () => {
  it('renders accessible fields and the development policy notice', () => {
    renderForm();

    expect(
      screen.getByRole('heading', {
        name: 'Create your Tennis Xpress account',
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('First name')).toHaveAttribute(
      'autocomplete',
      'given-name',
    );
    expect(screen.getByLabelText('Confirm password')).toBeRequired();
    expect(
      screen.getByText(/Registration is for development only/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /terms|privacy/i })).toBeNull();
  });

  it('links field errors to their inputs and focuses the summary', async () => {
    renderForm({
      formKey: 'error-1',
      values,
      errors: {
        email: 'Enter a valid email address.',
        confirmPassword: 'Passwords do not match.',
      },
    });

    expect(screen.getByLabelText('Email')).toHaveAttribute(
      'aria-describedby',
      'email-error',
    );
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await waitFor(() =>
      expect(
        screen.getByRole('alert', { name: 'Please review your registration' }),
      ).toHaveFocus(),
    );
  });

  it('shows the generic acknowledgement and a resend link', () => {
    renderForm({ formKey: 'success-1', values, success: true });

    expect(
      screen.getByRole('heading', { name: 'Registration request received' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /If this email address can be registered, follow the verification link if an email arrives\./i,
      ),
    ).toBeInTheDocument();

    const resendLink = screen.getByRole('link', { name: 'Request one' });
    expect(resendLink).toHaveAttribute('href', '/resend-verification');
    expect(screen.queryByText(/delivery is not enabled/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull();
  });
});
