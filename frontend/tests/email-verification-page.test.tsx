import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { EmailVerificationPage } from '../app/features/identity/email-verification-page';
import type {
  VerificationActionData,
  VerificationPageState,
} from '../app/features/identity/email-verification-flow.server';

function renderPage(
  pageState: VerificationPageState = 'ready',
  actionData?: VerificationActionData,
  pending = false,
) {
  const router = createMemoryRouter(
    [
      {
        path: '/verify-email',
        element: (
          <EmailVerificationPage
            csrfToken='test-csrf'
            pageState={pageState}
            actionData={actionData}
            pending={pending}
          />
        ),
      },
    ],
    { initialEntries: ['/verify-email'] },
  );

  return render(<RouterProvider router={router} />);
}

describe('EmailVerificationPage', () => {
  it('renders an explicit accessible confirmation form without a token field', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { name: 'Confirm your email address' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify email' })).toBeEnabled();
    expect(screen.queryByRole('textbox', { name: /token/i })).toBeNull();
    expect(
      screen
        .getByRole('button', { name: 'Verify email' })
        .closest('form')
        ?.querySelector('[name="token"]'),
    ).toBeNull();
    expect(screen.getByDisplayValue('test-csrf')).toHaveAttribute(
      'name',
      '_csrfToken',
    );
  });

  it('shows success without login or account details', () => {
    renderPage('ready', { state: 'success' });

    expect(
      screen.getByRole('heading', { name: 'Email verified' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verify email' })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('offers a resend link for missing or unusable verification links', () => {
    const { unmount } = renderPage('invalid');

    expect(
      screen.getByText(/invalid, expired, or has already been used/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request one' })).toHaveAttribute(
      'href',
      '/resend-verification',
    );

    unmount();
    renderPage('missing');

    expect(
      screen.getByRole('heading', { name: 'Verification link required' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request one' })).toHaveAttribute(
      'href',
      '/resend-verification',
    );
  });

  it('keeps the form available for retry after a temporary failure', () => {
    renderPage('ready', { state: 'temporary-failure' });

    expect(
      screen.getByRole('heading', {
        name: 'Verification temporarily unavailable',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify email' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Request one' })).toHaveAttribute(
      'href',
      '/resend-verification',
    );
  });

  it('shows pending state and prevents a second submission', () => {
    renderPage('ready', undefined, true);

    expect(screen.getByRole('status')).toHaveTextContent(/verifying/i);
    expect(screen.getByRole('button', { name: 'Verifying…' })).toBeDisabled();
  });

  it('shows a safe form-expired state after CSRF rejection', () => {
    renderPage('ready', { state: 'csrf-failure' });

    expect(
      screen.getByRole('heading', { name: 'Confirmation form expired' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verify email' })).toBeNull();
  });
});
