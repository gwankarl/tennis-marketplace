import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ResendVerificationForm } from '../../../app/features/identity/components/resend-verification-form';
import type { ResendVerificationActionData } from '../../../app/features/identity/resend-verification.types';

function renderForm(
  actionData?: ResendVerificationActionData,
  waitForAction?: () => Promise<void>,
) {
  const router = createMemoryRouter(
    [
      {
        path: '/resend-verification',
        action: async () => {
          await waitForAction?.();
          return null;
        },
        element: (
          <ResendVerificationForm
            csrfToken='test-csrf-token'
            actionData={actionData}
          />
        ),
      },
    ],
    { initialEntries: ['/resend-verification'] },
  );

  return render(<RouterProvider router={router} />);
}

describe('ResendVerificationForm', () => {
  it('renders an accessible email form with the CSRF token', () => {
    renderForm();

    expect(
      screen.getByRole('heading', {
        name: 'Request another verification email',
      }),
    ).toBeInTheDocument();

    expect(screen.getByLabelText('Email')).toHaveAttribute(
      'autocomplete',
      'email',
    );
    expect(screen.getByLabelText('Email')).toBeRequired();
    expect(screen.getByDisplayValue('test-csrf-token')).toHaveAttribute(
      'name',
      '_csrfToken',
    );
    expect(
      screen.getByRole('button', { name: 'Send verification email' }),
    ).toBeEnabled();
  });

  it('links the email error to the field and focuses the error summary', async () => {
    renderForm({
      email: 'bad-address',
      emailError: 'Enter a valid email address.',
    });

    expect(screen.getByLabelText('Email')).toHaveAttribute(
      'aria-describedby',
      'resend-email-error',
    );
    expect(screen.getByLabelText('Email')).toHaveAttribute(
      'aria-invalid',
      'true',
    );

    await waitFor(() =>
      expect(
        screen.getByRole('alert', {
          name: 'Please review your request',
        }),
      ).toHaveFocus(),
    );
  });

  it('shows a general error without account-specific details', () => {
    renderForm({
      email: 'player@example.test',
      formError: 'Please try again later.',
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Please try again later.',
    );
    expect(screen.getByLabelText('Email')).toHaveValue('player@example.test');
  });

  it('replaces the form with the same generic acknowledgement', () => {
    renderForm({
      email: '',
      success: true,
    });

    expect(
      screen.getByRole('heading', { name: 'Request received' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'If an account needs verification, instructions may be sent.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Send verification email' }),
    ).toBeNull();
  });

  it('disables duplicate submission while the action is pending', async () => {
    let finishAction!: () => void;
    const actionPending = new Promise<void>((resolve) => {
      finishAction = resolve;
    });

    renderForm(undefined, () => actionPending);

    fireEvent.submit(screen.getByLabelText('Email').closest('form')!);

    const button = screen.getByRole('button', { name: 'Sending…' });
    await waitFor(() => expect(button).toBeDisabled());

    await act(async () => {
      finishAction();
    });
  });
});
