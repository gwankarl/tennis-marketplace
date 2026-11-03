import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { BuyerOverview } from '../../../app/features/identity/components/buyer-overview';
import { LoginForm } from '../../../app/features/identity/components/login-form';

function renderLogin(
  options: {
    formError?: string;
    needsVerification?: true;
    logoutNotice?: string;
  } = {},
) {
  const router = createMemoryRouter(
    [
      {
        path: '/login',
        element: (
          <LoginForm
            csrfToken='csrf-token'
            returnTo='/account'
            logoutNotice={options.logoutNotice}
            actionData={{
              email: '',
              formError: options.formError,
              needsVerification: options.needsVerification,
            }}
          />
        ),
      },
    ],
    { initialEntries: ['/login'] },
  );

  return render(<RouterProvider router={router} />);
}

describe('authentication UI', () => {
  it('renders accessible login fields and does not repopulate a password', () => {
    renderLogin();

    expect(
      screen.getByRole('heading', { name: 'Sign in to Tennis Xpress' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute(
      'autocomplete',
      'email',
    );
    expect(screen.getByLabelText('Password')).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('links verification-required feedback to resend', () => {
    renderLogin({
      formError: 'Verify your email address before signing in.',
      needsVerification: true,
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/verify your email/i);
    expect(
      screen.getByRole('link', { name: /request another verification email/i }),
    ).toHaveAttribute('href', '/resend-verification');
  });

  it('explains when browser logout succeeded but backend revocation was uncertain', () => {
    renderLogin({
      logoutNotice:
        'This browser has been signed out, but server-side session revocation could not be confirmed.',
    });

    expect(screen.getByRole('status')).toHaveTextContent(
      /revocation could not be confirmed/i,
    );
  });

  it('renders the protected buyer overview without a credential field', () => {
    const accountRouter = createMemoryRouter(
      [
        {
          path: '/account',
          element: (
            <BuyerOverview
              user={{
                id: '00000000-0000-4000-8000-000000000001',
                email: 'player@example.test',
                firstName: 'Test',
                lastName: 'Player',
                isAdministrator: false,
                workspaces: ['buyer'],
              }}
              csrfToken='session-bound-csrf'
            />
          ),
        },
      ],
      { initialEntries: ['/account'] },
    );

    render(<RouterProvider router={accountRouter} />);

    expect(
      screen.getByRole('heading', { name: 'Your Tennis Xpress account' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/player@example\.test/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Sign out' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/session credential/i)).toBeNull();
  });
});
